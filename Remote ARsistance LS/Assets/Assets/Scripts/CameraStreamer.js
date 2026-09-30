// CameraStreamer.js - Captures Spectacles camera and streams frames over WebSocket
const ChatUI = require("./ChatUI");

let currentSocket = null;
let currentIsActive = null;
let cameraTexture = null;
let frameRegistration = null;
let busy = false;
let busySince = 0;
let lastFrame = 0;
let sentFrames = 0;

// Dynamic latency profiles: adapts compression & frame timing without ever mutating texture memory or causing blur
const PROFILES = [
    { name: "crisp", quality: CompressionQuality.IntermediateQuality, minInterval: 125 },
    { name: "balanced", quality: CompressionQuality.LowQuality, minInterval: 135 },
    { name: "fast", quality: CompressionQuality.LowQuality, minInterval: 155 }
];

let currentProfileIdx = 1; // Start at balanced
let cleanFrameCount = 0;
let congestedFrameCount = 0;
let messageListenerBound = false;

function applyProfile(idx) {
    if (idx === currentProfileIdx || idx < 0 || idx >= PROFILES.length) return;
    currentProfileIdx = idx;
    const p = PROFILES[currentProfileIdx];
    print("[ARsistance][camera] streaming quality profile adapted to: " + p.name);
}

function handleNetworkStat(rtt) {
    if (rtt < 140) {
        applyProfile(0); // Crisp: IntermediateQuality (ultra-sharp details)
    } else if (rtt > 230) {
        applyProfile(2); // Fast: LowQuality, 155ms (lightweight, strict real-time, never blurry)
    } else {
        applyProfile(1); // Balanced: LowQuality, 135ms
    }
}

function startStreaming(script, socket, cameraModule, isActive) {
    currentSocket = socket;
    currentIsActive = isActive;

    if (!messageListenerBound && socket) {
        messageListenerBound = true;
        socket.addEventListener("message", function (event) {
            if (typeof event.data !== "string") return;
            let msg;
            try { msg = JSON.parse(event.data); } catch (_) { return; }
            if (msg.action === "network-stat" && Number.isFinite(msg.rtt)) {
                handleNetworkStat(msg.rtt);
            }
        });
    }

    if (cameraTexture) {
        print("[ARsistance][camera] resuming camera stream with updated socket");
        return;
    }

    print("[ARsistance][camera] requesting camera stream");
    try {
        const request = CameraModule.createCameraRequest();
        request.cameraId = global.deviceInfoSystem.isEditor() ?
            CameraModule.CameraId.Default_Color : CameraModule.CameraId.Left_Color;
        request.imageSmallerDimension = 360;
        cameraTexture = cameraModule.requestCamera(request);
        if (!cameraTexture || !cameraTexture.control) {
            throw new Error("camera texture control unavailable");
        }
    } catch (error) {
        print("[ARsistance][camera] request failed: " + error);
        ChatUI.showAlert("Camera stream unavailable: " + error, 6.0);
        return;
    }

    print("[ARsistance][camera] camera ready, binding frame handler");

    frameRegistration = function () {
        if (!currentIsActive || !currentIsActive()) return;
        if (!currentSocket || currentSocket.readyState !== 1) return;

        const now = Date.now();

        // Watchdog: If previous frame encoding hung or dropped callback for > 1000ms, unlock
        if (busy) {
            if (now - busySince > 1000) {
                print("[ARsistance][camera] encoding watchdog timeout, unlocking frame loop");
                busy = false;
            } else {
                return;
            }
        }

        // Strict backpressure limit: Never queue frames if socket buffer has > 32KB pending.
        if (currentSocket.bufferedAmount && currentSocket.bufferedAmount > 32768) return;

        const profile = PROFILES[currentProfileIdx];
        if (now - lastFrame < profile.minInterval) return;
        lastFrame = now;
        busy = true;
        busySince = now;

        // Dynamic adaptation based on socket buffer health:
        if (currentSocket.bufferedAmount && currentSocket.bufferedAmount > 16384) {
            congestedFrameCount++;
            cleanFrameCount = 0;
            if (congestedFrameCount >= 3 && currentProfileIdx < PROFILES.length - 1) {
                applyProfile(currentProfileIdx + 1);
                congestedFrameCount = 0;
            }
        } else {
            cleanFrameCount++;
            congestedFrameCount = 0;
            if (cleanFrameCount >= 35 && currentProfileIdx > 0) {
                applyProfile(currentProfileIdx - 1);
                cleanFrameCount = 0;
            }
        }

        try {
            if (script.preview && script.preview.mainPass) {
                script.preview.mainPass.baseTex = cameraTexture;
            }
            if (script.screenCropTex && script.screenCropTex.control) {
                script.screenCropTex.control.inputTexture = cameraTexture;
            }

            if (!script.renderTarget) {
                busy = false;
                return;
            }

            Base64.encodeTextureAsync(script.renderTarget, function (base64) {
                busy = false;
                if (!currentIsActive || !currentIsActive()) return;
                if (!currentSocket || currentSocket.readyState !== 1) return;
                if (base64 && base64.length <= 524288) {
                    try {
                        currentSocket.send(base64 + "|||FRAME_END|||");
                        sentFrames++;
                        if (sentFrames === 1 || sentFrames % 80 === 0) {
                            print("[ARsistance][camera] streaming active (" + profile.name + "), frame=" + sentFrames + " (" + base64.length + "B)");
                        }
                    } catch (error) {
                        print("[ARsistance][camera] send exception: " + error);
                    }
                }
            }, function (error) {
                busy = false;
                print("[ARsistance][camera] encoding error: " + error);
            }, profile.quality, EncodingType.Jpg);
        } catch (e) {
            busy = false;
            print("[ARsistance][camera] frame capture error: " + e);
        }
    };

    cameraTexture.control.onNewFrame.add(frameRegistration);
}

function stopStreaming() {
    print("[ARsistance][camera] stopping camera stream");
    currentIsActive = null;
    busy = false;
    busySince = 0;
}

exports.startStreaming = startStreaming;
exports.stopStreaming = stopStreaming;
