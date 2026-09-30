// VoiceCall.js - Two-way low-latency PCM audio call for Spectacles & RelayView
try {
    // Require VoiceMLModule to activate SnapOS hardware audio driver & bystander rejection
    require("LensStudio:VoiceMLModule");
} catch (_) {}

const SAMPLE_RATE = 16000;
const MAX_QUEUED_SAMPLES = 2400; // 150ms max jitter buffer for strict low latency

function init(script, socket, isJoined, onCallStart, onCallStop, onMicStalled) {
    if (!script.microphoneAudio || !script.audioOutput) {
        print("[ARsistance][call] voice assets not wired in MainController");
        return null;
    }
    const microphone = script.microphoneAudio.control;
    const output = script.audioOutput.control;
    if (!microphone || !output ||
        !microphone.isOfType("Provider.MicrophoneAudioProvider") ||
        !output.isOfType("Provider.AudioOutputProvider")) {
        print("[ARsistance][call] voice assets have invalid provider types");
        return null;
    }

    print("[ARsistance][call] mic default sampleRate: " + microphone.sampleRate + ", maxFrameSize: " + microphone.maxFrameSize);

    try {
        microphone.sampleRate = SAMPLE_RATE;
        output.sampleRate = SAMPLE_RATE;
    } catch (e) {
        print("[ARsistance][call] failed to configure sample rate: " + e);
    }

    print("[ARsistance][call] configured sampleRate -> mic: " + microphone.sampleRate + ", output: " + output.sampleRate);

    const micFrame = new Int16Array(microphone.maxFrameSize || 16384);

    let player = null;
    try {
        player = script.getSceneObject().createComponent("Component.AudioComponent");
        player.audioTrack = script.audioOutput;
        if (global.Audio && Audio.PlaybackMode) {
            player.playbackMode = Audio.PlaybackMode.LowLatency;
        }
    } catch (e) {
        print("[ARsistance][call] player component creation error: " + e);
    }

    let calling = false;
    let sentAudioPackets = 0;
    let zeroTicks = 0;
    let stallPrompted = false;
    let queued = [];
    let readOffset = 0;
    let queuedSamples = 0;

    function stop() {
        if (!calling) return;
        calling = false;
        stallPrompted = false;
        print("[ARsistance][call] voice call ended (preserving audio hardware to prevent camera crash)");
        queued = [];
        readOffset = 0;
        queuedSamples = 0;
        zeroTicks = 0;
        if (onCallStop) {
            try { onCallStop(); } catch (e) { print("[ARsistance][call] onCallStop error: " + e); }
        }
    }

    function start() {
        if (calling || !isJoined()) return;
        calling = true;
        sentAudioPackets = 0;
        zeroTicks = 0;
        print("[ARsistance][call] starting voice call");

        try {
            microphone.start();
            print("[ARsistance][call] microphone.start() executed successfully");
        } catch (e) {
            print("[ARsistance][call] microphone.start exception: " + e);
        }

        try {
            if (player) player.play(-1);
            print("[ARsistance][call] player.play(-1) executed successfully");
        } catch (e) {
            print("[ARsistance][call] player.play exception: " + e);
        }

        if (onCallStart) {
            try { onCallStart(); } catch (e) { print("[ARsistance][call] onCallStart error: " + e); }
        }
    }

    socket.addEventListener("message", function (event) {
        if (typeof event.data === "string") {
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            if (msg.action === "call-state") {
                if (msg.state === "start") start();
                if (msg.state === "stop") stop();
            }
            return;
        }
        if (!calling || !event.data || !event.data.bytes) return;
        event.data.bytes().then(function (bytes) {
            if (!calling || bytes.length < 3 || bytes[0] !== 0x41 || (bytes.length - 1) % 2) return;
            const count = (bytes.length - 1) / 2;
            const frame = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                let value = bytes[1 + i * 2] | (bytes[2 + i * 2] << 8);
                if (value >= 32768) value -= 65536;
                frame[i] = value / 32768.0;
            }
            queued.push(frame);
            queuedSamples += count;
            while (queuedSamples > MAX_QUEUED_SAMPLES && queued.length) {
                queuedSamples -= queued[0].length - readOffset;
                queued.shift();
                readOffset = 0;
            }
        }).catch(function (e) { print("[ARsistance][call] voice receive error: " + e); });
    });

    socket.addEventListener("close", stop);

    const updateEvent = script.createEvent("UpdateEvent");
    updateEvent.bind(function () {
        if (!calling || !isJoined()) return;

        // Capture microphone frame using standard Snap Spectacles Float32Array API
        try {
            const frameSize = microphone.maxFrameSize || 16384;
            const audioFrame = new Float32Array(frameSize);
            let shape = (typeof microphone.getAudioFrame === "function") ? microphone.getAudioFrame(audioFrame) : null;
            let count = (shape && isFinite(shape.x)) ? (shape.x | 0) : 0;
            let usingPCM = false;

            // Fallback to PCM16 provider method if Float32 had 0 samples
            if (count <= 0 && typeof microphone.getAudioFramePCM16 === "function") {
                shape = microphone.getAudioFramePCM16(micFrame);
                count = (shape && isFinite(shape.x)) ? (shape.x | 0) : 0;
                if (count > 0) usingPCM = true;
            }

            if (count > 0 && socket.readyState === 1) {
                zeroTicks = 0;
                if (stallPrompted) {
                    stallPrompted = false;
                    print("[ARsistance][call] mic recovered - audio flow active");
                }
                const sendCount = Math.min(count, 2048);
                const packet = new Uint8Array(sendCount * 2 + 1);
                packet[0] = 0x41; // 'A' packet tag
                if (usingPCM) {
                    for (let i = 0; i < sendCount; i++) {
                        packet[1 + i * 2] = micFrame[i] & 255;
                        packet[2 + i * 2] = (micFrame[i] >> 8) & 255;
                    }
                } else {
                    for (let i = 0; i < sendCount; i++) {
                        const s = Math.max(-1.0, Math.min(1.0, audioFrame[i]));
                        const val = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
                        packet[1 + i * 2] = val & 255;
                        packet[2 + i * 2] = (val >> 8) & 255;
                    }
                }
                socket.send(packet);
                sentAudioPackets++;
                if (sentAudioPackets === 1 || sentAudioPackets % 150 === 0) {
                    print("[ARsistance][call] mic streaming: sent " + sentAudioPackets + " packets (" + sendCount + " samples, " + (usingPCM ? "pcm16" : "float32") + ")");
                }
            } else {
                zeroTicks++;
                if (zeroTicks === 1 || zeroTicks % 60 === 0) {
                    print("[ARsistance][call] mic waiting: shape.x=" + (shape ? shape.x : "null") + ", maxFrameSize=" + frameSize);
                }
                if (!stallPrompted && zeroTicks >= 300 && sentAudioPackets === 0) {
                    stallPrompted = true;
                    print("[ARsistance][call] mic stall detected (no audio frames captured after call start)");
                    if (onMicStalled) {
                        try { onMicStalled(); } catch (e) { print("[ARsistance][call] onMicStalled callback error: " + e); }
                    }
                    if (socket && socket.readyState === 1) {
                        try {
                            socket.send(JSON.stringify({
                                action: "mic-status",
                                status: "waiting",
                                message: "Technician's microphone is silent. If issue persists, please restart Spectacles."
                            }));
                        } catch (_) {}
                    }
                }
            }
        } catch (e) {
            print("[ARsistance][call] mic capture exception: " + e);
        }

        // Dequeue audio frame and play
        try {
            const size = output.getPreferredFrameSize() | 0;
            if (size <= 0 || size > output.maxFrameSize) return;
            const samples = new Float32Array(size);
            let offset = 0;
            while (offset < size && queued.length) {
                const first = queued[0];
                const take = Math.min(size - offset, first.length - readOffset);
                samples.set(first.subarray(readOffset, readOffset + take), offset);
                offset += take;
                readOffset += take;
                queuedSamples -= take;
                if (readOffset === first.length) {
                    queued.shift();
                    readOffset = 0;
                }
            }
            output.enqueueAudioFrame(samples, new vec3(size, 1, 1));
        } catch (e) {
            print("[ARsistance][call] audio output exception: " + e);
        }
    });

    return { stop: stop, isCalling: function () { return calling; } };
}

exports.init = init;
