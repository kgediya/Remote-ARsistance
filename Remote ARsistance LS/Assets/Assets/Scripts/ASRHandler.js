// ASRHandler.js - Automatic speech recognition with real-time feedback in AR
const ChatUI = require("./ChatUI");

let started = false;

function init(script, socket, asrModule, isActive) {
    if (started) return;
    if (!asrModule) {
        print("[ARsistance][asr] asrModule is missing");
        return;
    }
    started = true;
    print("[ARsistance][asr] starting transcription");
    global.chatText = "";

    function onTranscriptionUpdate(eventArgs) {
        if (!isActive || !isActive()) return;
        const text = eventArgs.text;
        if (!text || text.length === 0) return;

        if (!eventArgs.isFinal) {
            ChatUI.showListening(text);
        } else if (text.trim().length > 1) {
            global.chatText = text.trim();
            ChatUI.showVoiceMessage(global.chatText);
            if (global.behaviorSystem) {
                global.behaviorSystem.sendCustomTrigger("chat-ready");
            }
            print("[ARsistance][asr] sent final transcription: " + text);
        }
    }

    function onTranscriptionError(code) {
        const errMap = {
            [AsrModule.AsrStatusCode.InternalError]: "Internal Error",
            [AsrModule.AsrStatusCode.Unauthenticated]: "Unauthenticated",
            [AsrModule.AsrStatusCode.NoInternet]: "No Internet"
        };
        const errMsg = errMap[code] || ("Code " + code);
        print("[ARsistance][asr] transcription error: " + errMsg);
    }

    try {
        const options = AsrModule.AsrTranscriptionOptions.create();
        options.silenceUntilTerminationMs = 1200;
        options.mode = AsrModule.AsrMode.HighAccuracy;
        options.onTranscriptionUpdateEvent.add(onTranscriptionUpdate);
        options.onTranscriptionErrorEvent.add(onTranscriptionError);

        const res = asrModule.startTranscribing(options);
        if (res && typeof res.catch === "function") {
            res.catch(function (e) {
                started = false;
                print("[ARsistance][asr] start failed: " + e);
            });
        }
    } catch (e) {
        started = false;
        print("[ARsistance][asr] setup exception: " + e);
    }
}

function stop(asrModule) {
    if (!started) return;
    started = false;
    print("[ARsistance][asr] stopping transcription");
    if (!asrModule) return;
    try {
        const res = asrModule.stopTranscribing();
        if (res && typeof res.catch === "function") {
            res.catch(function (e) {
                print("[ARsistance][asr] stop failed: " + e);
            });
        }
    } catch (e) {
        print("[ARsistance][asr] stop exception: " + e);
    }
}

exports.init = init;
exports.stop = stop;
