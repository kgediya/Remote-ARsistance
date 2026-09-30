// ChatUI.js - Elevated in-lens chat and notification interface for Spectacles AR
let chatText = null;
let transform = null;
let ttsModule = null;
let decayEvent = null;
let alertEvent = null;
let currentMessage = "";
let currentSender = "";
let isDecayed = false;
let isAlertActive = false;

const DECAY_DELAY_SEC = 12;

function init(script) {
    if (!script.chatText) return null;
    chatText = script.chatText;
    ttsModule = script.textToSpeech;

    const sceneObject = chatText.getSceneObject();
    transform = sceneObject.getComponent("Component.ScreenTransform");

    // Configure lower-third subtitle region for natural AR gaze
    if (transform && global.Rect) {
        transform.anchors = Rect.create(-0.85, 0.85, -0.92, -0.62);
    }

    // Configure text wrapping and sizing
    try {
        if (global.HorizontalOverflow) {
            chatText.horizontalOverflow = HorizontalOverflow.Wrap;
        }
        if (global.VerticalAlignment) {
            chatText.verticalAlignment = VerticalAlignment.Bottom;
        }
        if (global.HorizontalAlignment) {
            chatText.horizontalAlignment = HorizontalAlignment.Center;
        }
    } catch (_) {}

    chatText.size = 11;

    // High-contrast glassmorphic AR card background
    try {
        const bg = chatText.backgroundSettings;
        if (bg) {
            bg.enabled = true;
            bg.fill.color = new vec4(0.06, 0.09, 0.12, 0.88);
            bg.cornerRadius = 0.35;
            if (bg.margins) {
                bg.margins.left = 1.0;
                bg.margins.right = 1.0;
                bg.margins.top = 0.6;
                bg.margins.bottom = 0.6;
            }
        }
    } catch (_) {}

    // Outline for crisp legibility in high-ambient lighting
    try {
        const outline = chatText.outlineSettings;
        if (outline) {
            outline.enabled = true;
            outline.fill.color = new vec4(0.0, 0.0, 0.0, 0.85);
            outline.size = 0.1;
        }
    } catch (_) {}

    // Setup auto-decay timer to minimize messages and preserve immersive view
    try {
        decayEvent = script.createEvent("DelayedCallbackEvent");
        decayEvent.bind(function () {
            if (isAlertActive) return;
            minimizeCard();
        });

        alertEvent = script.createEvent("DelayedCallbackEvent");
        alertEvent.bind(function () {
            isAlertActive = false;
            restoreCurrentMessage();
        });
    } catch (_) {}

    return exports;
}

function expandCard() {
    isDecayed = false;
    if (transform && global.Rect) {
        transform.anchors = Rect.create(-0.85, 0.85, -0.92, -0.62);
    }
    if (chatText) {
        chatText.size = 11;
        try {
            if (chatText.backgroundSettings) {
                chatText.backgroundSettings.fill.color = new vec4(0.06, 0.09, 0.12, 0.88);
            }
        } catch (_) {}
    }
}

function minimizeCard() {
    isDecayed = true;
    if (!chatText || !currentMessage) {
        if (chatText) chatText.text = "";
        return;
    }
    // Truncate to compact discreet pill
    const preview = currentMessage.length > 36 ? currentMessage.slice(0, 34) + "…" : currentMessage;
    const prefix = currentSender === "expert" ? "▶ " : "🎙 ";
    chatText.text = prefix + preview;
    chatText.size = 9;

    if (transform && global.Rect) {
        transform.anchors = Rect.create(-0.70, 0.70, -0.94, -0.80);
    }
    try {
        if (chatText.backgroundSettings) {
            chatText.backgroundSettings.fill.color = new vec4(0.06, 0.09, 0.12, 0.55);
        }
    } catch (_) {}
}

function restoreCurrentMessage() {
    if (!chatText) return;
    if (!currentMessage) {
        chatText.text = "";
        return;
    }
    if (isDecayed) {
        minimizeCard();
    } else {
        renderCard(currentSender, currentMessage);
    }
}

function renderCard(sender, message) {
    if (!chatText) return;
    expandCard();
    currentSender = sender;
    currentMessage = message;

    if (sender === "expert") {
        chatText.text = "▶ EXPERT GUIDANCE\n\"" + message + "\"";
    } else if (sender === "specs") {
        chatText.text = "🎙 YOU (VOICE)\n\"" + message + "\"";
    } else {
        chatText.text = message;
    }

    if (decayEvent) {
        decayEvent.reset(DECAY_DELAY_SEC);
    }
}

function showExpertMessage(message) {
    if (!message) return;
    isAlertActive = false;
    renderCard("expert", message);

    // Voice playback via TTS for hands-free workflow
    if (ttsModule && global.TextToSpeech) {
        try {
            const options = TextToSpeech.Options.create();
            ttsModule.synthesize(message, options, function (track) {
                if (chatText) {
                    const audio = chatText.getSceneObject().createComponent("Component.AudioComponent");
                    audio.audioTrack = track;
                    audio.play(1);
                }
            }, function (_error, description) {
                print("[ARsistance][tts] error: " + description);
            });
        } catch (e) {
            print("[ARsistance][tts] exception: " + e);
        }
    }
}

function showVoiceMessage(message) {
    if (!message) return;
    isAlertActive = false;
    renderCard("specs", message);
}

function showListening(interimText) {
    if (!chatText) return;
    expandCard();
    const preview = interimText && interimText.length > 30 ? interimText.slice(-30) : interimText;
    chatText.text = "🎙 Listening… \"" + (preview || "") + "\"";
    if (decayEvent) decayEvent.cancel();
}

function showAlert(text, durationSec) {
    if (!chatText) return;
    expandCard();
    isAlertActive = true;
    chatText.text = text;
    const dur = durationSec || 3.5;
    if (alertEvent) {
        alertEvent.reset(dur);
    }
}

function clear() {
    currentMessage = "";
    currentSender = "";
    isAlertActive = false;
    isDecayed = false;
    if (decayEvent) decayEvent.cancel();
    if (alertEvent) alertEvent.cancel();
    if (chatText) chatText.text = "";
}

exports.init = init;
exports.showExpertMessage = showExpertMessage;
exports.showVoiceMessage = showVoiceMessage;
exports.showListening = showListening;
exports.showAlert = showAlert;
exports.clear = clear;
