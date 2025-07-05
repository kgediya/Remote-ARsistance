function init(script, socket, asrModule) {
    global.chatText = '';

         
    function onTranscriptionUpdate(eventArgs) {
        let text = eventArgs.text;
        if (eventArgs.isFinal && text.length > 1) {
            global.chatText = text;
         
            global.behaviorSystem.sendCustomTrigger("chat-ready");
            print("Chat-sent: " + text);
        }
    }

    function onTranscriptionError(code) {
        const errMap = {
            [AsrModule.AsrStatusCode.InternalError]: "Internal Error",
            [AsrModule.AsrStatusCode.Unauthenticated]: "Unauthenticated",
            [AsrModule.AsrStatusCode.NoInternet]: "No Internet"
        };
        print("ASR Error: " + (errMap[code] || code));
    }

    let options = AsrModule.AsrTranscriptionOptions.create();
    options.silenceUntilTerminationMs = 1000;
    options.mode = AsrModule.AsrMode.HighAccuracy;
    options.onTranscriptionUpdateEvent.add(onTranscriptionUpdate);
    options.onTranscriptionErrorEvent.add(onTranscriptionError);

    asrModule.startTranscribing(options);
}

exports.init = init;
