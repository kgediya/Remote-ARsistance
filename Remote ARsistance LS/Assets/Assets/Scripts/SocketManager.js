// SocketManager.js - WebSocket client & messaging dispatcher for Remote ARsistance
const ChatUI = require("./ChatUI");

function initSocket(script) {
    if (!script.internetModule || !script.wssURL) {
        if (ChatUI) ChatUI.showAlert("Set WSS server host in MainController", 8.0);
        return null;
    }
    const host = script.wssURL.trim().replace(/^wss?:\/\//, "").replace(/\/$/, "");
    const url = (global.deviceInfoSystem.isEditor() && /^localhost(:|$)/.test(host) ? "ws://" : "wss://") + host;
    return script.internetModule.createWebSocket(url);
}

function setHandlers(script, socket, onAnnotation) {
    socket.addEventListener("message", function (event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        if (msg.action === "annotate" && onAnnotation) {
            onAnnotation(script, msg.data);
            ChatUI.showAlert("📍 Expert placed a spatial note", 3.0);
        }
        if (msg.action === "chat" && msg.data && typeof msg.data.message === "string") {
            handleChatMessage(script, msg);
        }
    });
}

function handleChatMessage(script, msg) {
    const message = msg.data.message.trim().slice(0, 500);
    if (!message) return;

    if (msg.from === "specs") {
        ChatUI.showVoiceMessage(message);
    } else {
        ChatUI.showExpertMessage(message);
    }
}

exports.initSocket = initSocket;
exports.setHandlers = setHandlers;
