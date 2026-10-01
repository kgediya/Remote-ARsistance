// SocketManager.js - WebSocket client & messaging dispatcher with Geo-Discovery Ping
const ChatUI = require("./ChatUI");

const REGIONAL_ENDPOINTS = [
    {
        region: "IN",
        host: "remote-arsistance-597953322753.asia-south1.run.app",
        name: "Mumbai (asia-south1)"
    },
    {
        region: "US",
        host: "remote-arsistance-597953322753.us-central1.run.app",
        name: "US Central (us-central1)"
    }
];

function pingRegion(internetModule, endpoint) {
    var url = "https://" + endpoint.host + "/api/health";
    return new Promise(function (resolve, reject) {
        if (typeof internetModule.fetch === "function") {
            internetModule.fetch(url).then(function (res) {
                if (res && res.status >= 200 && res.status < 400) {
                    resolve(endpoint);
                } else {
                    reject(new Error("Status " + (res ? res.status : "fail")));
                }
            }).catch(reject);
            return;
        }

        if (global.RemoteServiceHttpRequest && typeof internetModule.performHttpRequest === "function") {
            try {
                var req = RemoteServiceHttpRequest.create();
                req.url = url;
                req.method = RemoteServiceHttpRequest.HttpRequestMethod.Get;
                internetModule.performHttpRequest(req, function (resp) {
                    if (resp && resp.statusCode >= 200 && resp.statusCode < 400) {
                        resolve(endpoint);
                    } else {
                        reject(new Error("Status " + (resp ? resp.statusCode : "fail")));
                    }
                });
                return;
            } catch (err) {
                reject(err);
                return;
            }
        }

        reject(new Error("HTTP unsupported"));
    });
}

function discoverFastestHost(script, callback) {
    var defaultHost = (script.wssURL || "").trim().replace(/^wss?:\/\//, "").replace(/\/$/, "");
    if (!defaultHost) defaultHost = REGIONAL_ENDPOINTS[0].host;

    // Check if running on local mock server in Lens Studio editor
    if (global.deviceInfoSystem && global.deviceInfoSystem.isEditor() && /^localhost(:|$)/.test(defaultHost)) {
        print("[ARsistance][geo] editor localhost detected: " + defaultHost);
        callback(defaultHost);
        return;
    }

    if (!script.internetModule) {
        callback(defaultHost);
        return;
    }

    var settled = false;
    var timerEvent = null;

    function finish(selectedHost, reason) {
        if (settled) return;
        settled = true;
        if (timerEvent && script.removeEvent) {
            try { script.removeEvent(timerEvent); } catch (_) {}
        }
        print("[ARsistance][geo] selected cluster: " + selectedHost + " (" + reason + ")");
        callback(selectedHost);
    }

    // Safety fallback timer (1.8s) so Spectacles connects even if one endpoint is blocked
    if (script.createEvent) {
        try {
            timerEvent = script.createEvent("DelayedCallbackEvent");
            timerEvent.bind(function () { finish(defaultHost, "timeout fallback"); });
            timerEvent.reset(1.8);
        } catch (_) {}
    } else {
        setTimeout(function () { finish(defaultHost, "timeout fallback"); }, 1800);
    }

    // Simultaneous geo-discovery ping (Promise.race)
    REGIONAL_ENDPOINTS.forEach(function (ep) {
        pingRegion(script.internetModule, ep).then(function () {
            finish(ep.host, "ping won: " + ep.name);
        }).catch(function (e) {
            print("[ARsistance][geo] ping error for " + ep.name + ": " + e);
        });
    });
}

function initSocket(script, onReady) {
    if (!script.internetModule) {
        if (ChatUI) ChatUI.showAlert("Internet Module not configured", 8.0);
        if (onReady) onReady(null);
        return null;
    }

    if (typeof onReady === "function") {
        discoverFastestHost(script, function (chosenHost) {
            var isLocal = global.deviceInfoSystem && global.deviceInfoSystem.isEditor() && /^localhost(:|$)/.test(chosenHost);
            var url = (isLocal ? "ws://" : "wss://") + chosenHost;
            print("[ARsistance][socket] creating WebSocket: " + url);
            var ws = script.internetModule.createWebSocket(url);
            onReady(ws);
        });
        return null;
    }

    // Synchronous fallback
    var host = (script.wssURL || "").trim().replace(/^wss?:\/\//, "").replace(/\/$/, "");
    if (!host) host = REGIONAL_ENDPOINTS[0].host;
    var isLocalSync = global.deviceInfoSystem && global.deviceInfoSystem.isEditor() && /^localhost(:|$)/.test(host);
    var syncUrl = (isLocalSync ? "ws://" : "wss://") + host;
    return script.internetModule.createWebSocket(syncUrl);
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
exports.discoverFastestHost = discoverFastestHost;
