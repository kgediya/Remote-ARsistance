// SessionManager.js

function generateSessionCode(length = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < length; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function initSession(script, socket, role = "specs", onSuccess) {
    let sessionCode = generateSessionCode();
    global.sessionCode = sessionCode;
   
    if (script.chatText) {
        script.chatText.text = "Visit Web Portal & Enter The \nLogin Code: " + sessionCode;
    }

    socket.addEventListener("open", () => {
        socket.send(JSON.stringify({
            action: "join-session",
            role: role,
            sessionCode: sessionCode
        }));
    });

    socket.addEventListener("message", (event) => {
        try {
            let msg = JSON.parse(event.data);
            if (msg.status === "joined" && msg.sessionCode === sessionCode && typeof onSuccess === "function") {
                print("Session joined: " + sessionCode);
                onSuccess(); // Trigger ASR + Camera after session ack
            }
        } catch (e) {}
    });

    return sessionCode;
}

exports.initSession = initSession;
exports.generateSessionCode = generateSessionCode;
