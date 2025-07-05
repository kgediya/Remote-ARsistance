function initSocket(script) {
    let socket = script.internetModule.createWebSocket("wss://" + script.wssURL);
    socket.binaryType = "blob";

    socket.onopen = () => {
        print("WebSocket connected");
        socket.send("Spectacles stream initiated");
    };

    socket.onclose = (event) => {
        print(event.wasClean ? "Socket closed cleanly" : "Socket closed with error: " + event.code);
    };

    socket.onerror = () => {
        print("WebSocket error occurred");
    };

    return socket;
}

function setHandlers(script, socket, { onAnnotation }) {
    socket.onmessage = async (event) => {
        if (typeof event.data === "string" && event.data.startsWith("{")) {
            try {
                let msg = JSON.parse(event.data);

                if (msg.action === "annotate" && onAnnotation) {
                    onAnnotation(script,msg.data);
                }

                if (msg.action === "chat") {
                    handleChatMessage(script, msg);
                }

            } catch (err) {
                print("JSON error: " + err);
            }
        }
    };
}

function handleChatMessage(script, msg) {
    let message = msg.data.message.trim();
    let current = script.chatText.text || "";
    let fromSpecs = msg.from === "specs";

    if (message.length > 0) {
        let lines = (current + "\n" + message).trim().split("\n");
        if (lines.length > 2) lines = lines.slice(-2);
        script.chatText.text = lines.join("\n");

        if (!fromSpecs && script.textToSpeech) {
            let cleanMsg = message.split('Web Admin:')[1] || message;

            let options = TextToSpeech.Options.create();
            script.textToSpeech.synthesize(cleanMsg, options,
                function (audioTrackAsset) {
                    let audioComponent = script.getSceneObject().createComponent('Component.AudioComponent');
                    audioComponent.audioTrack = audioTrackAsset;
                    audioComponent.play(1);
                },
                function (error, desc) {
                    print("TTS error: " + desc);
                }
            );
        }
    }
}

exports.initSocket = initSocket;
exports.setHandlers = setHandlers;
exports.handleChatMessage = handleChatMessage;
