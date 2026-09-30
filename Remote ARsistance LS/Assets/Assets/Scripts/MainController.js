//@input Component.Image preview
//@input Asset.InternetModule internetModule
//@input string wssURL
//@input Component.Camera perspectiveCam
//@input Asset.Texture renderTarget
//@input Component.LookAtComponent lookAt
//@input Component.ScriptComponent instantWorldHitTest
//@input Component.Text chatText
//@input Component.Text sessionCodeText
//@input Asset.TextToSpeechModule textToSpeech
//@input Asset.Texture screenCropTex
//@input Asset.AudioTrackAsset microphoneAudio
//@input Asset.AudioTrackAsset audioOutput

const cameraModule = require('LensStudio:CameraModule');
const asrModule = require('LensStudio:AsrModule');

const ChatUI = require("./ChatUI");
const SocketManager = require("./SocketManager");
const CameraStreamer = require("./CameraStreamer");
const ASRHandler = require("./ASRHandler");
const AnnotationRenderer = require("./AnnotationRenderer");
const SessionManager = require("./SessionManager");
const VoiceCall = require("./VoiceCall");

// Initialize elevated AR Chat & HUD UI
ChatUI.init(script);

// Initialize WebSocket connection
const socket = SocketManager.initSocket(script);
if (socket) {
    print("[ARsistance][main] Lens started, WebSocket initializing");
    let active = false;
    let voiceCall = null;

    const isJoined = SessionManager.initSession(script, socket, function () {
        print("[ARsistance][main] expert joined; activating camera");
        active = true;
        try {
            CameraStreamer.startStreaming(script, socket, cameraModule, function () { return active; });
        } catch (error) {
            print("[ARsistance][main] camera startup exception: " + error);
            ChatUI.showAlert("Camera error: " + error, 5.0);
        }
    }, function () {
        print("[ARsistance][main] expert disconnected");
        active = false;
        CameraStreamer.stopStreaming();
        if (voiceCall) voiceCall.stop();
        ASRHandler.stop(asrModule);
    });

    SocketManager.setHandlers(script, socket, AnnotationRenderer.renderTextAnnotation);

    voiceCall = VoiceCall.init(script, socket, isJoined, function () {
        print("[ARsistance][call] voice call connected - updating HUD and disabling voice-to-text");
        // Disable voice-to-text completely during voice call
        ASRHandler.stop(asrModule);

        // Show call status in the in-lens HUD
        if (isJoined.setCallActive) {
            isJoined.setCallActive(true);
        }
        ChatUI.showAlert("🎙 Voice call connected", 3.0);
    }, function () {
        print("[ARsistance][call] voice call ended - restoring HUD");
        // Restore in-lens HUD to normal live view
        if (isJoined.setCallActive) {
            isJoined.setCallActive(false);
        }
        ChatUI.showAlert("Voice call ended", 2.5);

        // Keep voice-to-text stopped to prevent audio hardware collision & camera crash
        ASRHandler.stop(asrModule);
    }, function () {
        print("[ARsistance][call] mic stall detected - prompting user on Spectacles HUD");
        ChatUI.showAlert("⚠️ Mic silent · Check Spectacles\nRestart device if issue persists", 7.0);
    });

    if (global.behaviorSystem) {
        global.behaviorSystem.addCustomTriggerResponse("chat-ready", function () {
            if (isJoined() && socket.readyState === 1 && global.chatText) {
                try {
                    socket.send(JSON.stringify({ action: "specs-chat", text: global.chatText }));
                } catch (e) {
                    print("[ARsistance][main] chat send error: " + e);
                }
            }
        });
    }
}
