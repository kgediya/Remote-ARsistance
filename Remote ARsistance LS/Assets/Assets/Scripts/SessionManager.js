// SessionManager.js - Session lifecycle & dynamic HUD management for pure immersive view
const ChatUI = require("./ChatUI");

function initSession(script, socket, onJoined, onLeft) {
    let joined = false;
    let currentCode = "";
    const sessionText = script.sessionCodeText;
    const codeTransform = sessionText ? sessionText.getSceneObject().getComponent("Component.ScreenTransform") : null;

    function formatSessionCode(code) {
        if (!code) return "";
        var clean = ("" + code).toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (clean.length === 8) {
            return clean.slice(0, 2) + "-" + clean.slice(2, 5) + "-" + clean.slice(5);
        }
        if (clean.length === 6) {
            return clean.slice(0, 3) + "-" + clean.slice(3);
        }
        return code;
    }

    function applyCenterHud(code, subtext) {
        if (!sessionText) return;
        sessionText.size = 18;
        try {
            if (global.HorizontalAlignment) sessionText.horizontalAlignment = HorizontalAlignment.Center;
            if (global.VerticalAlignment) sessionText.verticalAlignment = VerticalAlignment.Center;
        } catch (_) {}

        if (codeTransform && global.Rect) {
            codeTransform.anchors = Rect.create(-0.95, 0.95, -0.80, 0.80);
        }

        try {
            const bg = sessionText.backgroundSettings;
            if (bg) bg.enabled = true;
        } catch (_) {}

        if (!code) {
            sessionText.text = subtext ? subtext : "⏳ CONNECTING TO RELAYVIEW...";
            return;
        }

        const formatted = formatSessionCode(code);
        const portalText = "HAVE EXPERT JOIN AT:\nrelayview.allthingskrazyy.com";
        const cleanSub = subtext ? subtext.replace(/^[⏳▶⚠●🌐\s]+/, "").trim() : "";
        sessionText.text = formatted + "\n\n" + portalText + (cleanSub ? "\n" + cleanSub : "");
    }

    function applyTopRightHud(code, inCall) {
        if (!sessionText) return;
        sessionText.size = 10;
        try {
            if (global.HorizontalAlignment) sessionText.horizontalAlignment = HorizontalAlignment.Right;
            if (global.VerticalAlignment) sessionText.verticalAlignment = VerticalAlignment.Top;
        } catch (_) {}

        if (codeTransform && global.Rect) {
            // Anchor to top-right corner to leave center completely immersive
            codeTransform.anchors = Rect.create(0.35, 0.94, 0.78, 0.95);
        }

        try {
            const bg = sessionText.backgroundSettings;
            if (bg) {
                bg.enabled = true;
                if (inCall) {
                    bg.fill.color = new vec4(0.04, 0.18, 0.14, 0.85);
                }
            }
        } catch (_) {}

        const formatted = formatSessionCode(code);
        sessionText.text = inCall ? ("● LIVE · 📞 IN CALL · " + formatted) : ("● LIVE · " + formatted);
    }

    function setCallActive(inCall) {
        if (!joined) return;
        applyTopRightHud(currentCode, !!inCall);
    }

    applyCenterHud("", "⏳ RELAYVIEW · CONNECTING...");

    socket.addEventListener("open", function () {
        print("[ARsistance][socket] open state=" + socket.readyState);
        if (socket.readyState !== 1) return;
        socket.send(JSON.stringify({ action: "create-session" }));
        ChatUI.showAlert("Connecting to RelayView server…", 3.0);
    });

    socket.addEventListener("message", function (event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }

        if (msg.status === "created" && msg.sessionCode) {
            print("[ARsistance][session] created: " + msg.sessionCode);
            currentCode = msg.sessionCode;
            global.sessionCode = currentCode;
            applyCenterHud(currentCode, "▶ SHARE CODE WITH EXPERT");
            ChatUI.showAlert("Share code with expert to join at relayview.allthingskrazyy.com", 6.0);
        } else if (msg.status === "joined" && msg.sessionCode === global.sessionCode && !joined) {
            print("[ARsistance][session] expert joined - transitioning HUD to top-right");
            joined = true;
            // Move HUD code to top-right corner for pure immersive view
            applyTopRightHud(currentCode, false);
            ChatUI.showAlert("⚡ Expert connected · Live guidance active", 4.0);
            onJoined();
        } else if (msg.status === "peer-left" && joined) {
            print("[ARsistance][session] expert left");
            joined = false;
            // Restore HUD to center so technician can see code again
            applyCenterHud(currentCode, "EXPERT DISCONNECTED · WAITING");
            ChatUI.showAlert("⚠ Expert disconnected · Waiting for expert to rejoin", 6.0);
            onLeft();
        } else if (msg.status === "expired") {
            print("[ARsistance][session] expired");
            joined = false;
            applyCenterHud(currentCode, "SESSION EXPIRED · RESTART LENS");
            ChatUI.showAlert("Session expired. Please restart the Lens.", 8.0);
            onLeft();
        } else if (msg.error) {
            print("[ARsistance][session] server error: " + msg.error);
            ChatUI.showAlert("Error: " + msg.error, 5.0);
        }
    });

    socket.addEventListener("close", function (event) {
        print("[ARsistance][socket] closed code=" + event.code + " reason=" + event.reason);
        joined = false;
        applyCenterHud(currentCode, "CONNECTION LOST");
        ChatUI.showAlert("Connection lost. Check Wi-Fi or reset Lens.", 7.0);
        onLeft();
    });

    socket.addEventListener("error", function (event) {
        print("[ARsistance][socket] error: " + event);
        applyCenterHud(currentCode, "NETWORK ERROR");
        ChatUI.showAlert("Network error. Verify Spectacles internet access.", 7.0);
    });

    function isJoinedFn() { return joined; }
    isJoinedFn.isJoined = isJoinedFn;
    isJoinedFn.setCallActive = setCallActive;
    isJoinedFn.getCode = function () { return currentCode; };
    return isJoinedFn;
}

exports.initSession = initSession;
