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
const cameraModule = require('LensStudio:CameraModule');
const asrModule = require('LensStudio:AsrModule');

const SocketManager = require("./SocketManager");
const CameraStreamer = require("./CameraStreamer");
const ASRHandler = require("./ASRHandler");
const AnnotationRenderer = require("./AnnotationRenderer");
const SessionManager = require("./SessionManager")


//Initialize WebSocket
const socket = SocketManager.initSocket(script);

// Bind incoming messages
SocketManager.setHandlers(script, socket, {
    onAnnotation: AnnotationRenderer.renderTextAnnotation,
    onChat: SocketManager.handleChatMessage,
});


// Delay ASR + Stream until session is confirmed
SessionManager.initSession(script, socket, "specs", () => {
    script.chatText.text = "Session Connected Sucessfully"
     script.sessionCodeText.text = "Current Session Code: "+global.sessionCode
    CameraStreamer.startStreaming(script, socket, cameraModule);
   // CameraStreamer.startRendering(script,socket)
    ASRHandler.init(script, socket, asrModule);
    print("Camera & ASR started after session join");
});

// Speech chat send trigger
global.behaviorSystem.addCustomTriggerResponse('chat-ready', () => {
    socket.send(JSON.stringify({ action: 'specs-chat', text: global.chatText }));
    print('Chat Packet Sent Over Socket');
});