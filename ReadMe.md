# 🧠 Remote ARsistance

**Remote ARsistance** is a session-based support tool for Specs. Its expert web portal is branded **RelayView**. A field technician shares live camera frames with a remote expert, who can speak back through a two-way voice call, send chat, and place annotations.

> ⚡ Ideal for remote support, field repair, inspection workflows, and collaborative XR tasks.

---

## 🎥 Demo Video

[![Remote ARsistance Demo](https://img.youtube.com/vi/8dSow1P_gng/hqdefault.jpg)](https://youtu.be/8dSow1P_gng)

## 🚀 Features

### 📡 1. Live Video Streaming (from Spectacles)
- Spectacles camera feed is encoded in base64 and streamed in real-time to the web client using the Camera Module & Websocket.
- Efficient data transfer over WebSocket with frame boundary management.
- Frame decoding and display on `<canvas>` element.

---

### 🔐 Session Login  
🔄 Real-time session binding between Specs and the web client using six-character codes displayed as `XXX-XXX`.


![Session Login](./Previews/loginPreview.jpg)
![Session Management](./Previews/login.gif)

---

### 💬 2. Two-Way Chat System  
🔊 Exchange guidance and instructions between remote expert and AR user using text based chat system.

![Chat Interaction](./Previews/chatPreview.jpg)

---

### 🖊️ 3. Real-Time Annotation  
🖱️ Click-to-annotate from web reflects in AR view instantly.

![Annotation](./Previews/annotate.gif)

---

### 🔄 4. Session Management
- Unique **session codes** ensure private, one-to-one connections.
- Spectacles won’t stream unless a web client joins the same session.
- Auto cleanup on disconnection.

---

### 🎙️ 5. ASR Module (Automatic Speech Recognition)
- Real-time speech-to-text using Lens Studio's `AsrModule`.
- Spectacles user can talk — message appears instantly on web.

### 📞 6. Two-Way Voice Call
- The expert starts a call from the web portal and grants microphone access.
- Specs and the browser exchange live PCM audio through the session WebSocket.
- The expert can mute the microphone or end the call.

---

## 🛠️ Tech Stack

| Part             | Tech                                    |
|------------------|-----------------------------------------|
| AR Glasses       | Spectacles (via Lens Studio scripting)  |
| Web Backend      | Node.js + Express + WebSocket (ws)      |
| Frontend         | HTML5, Canvas, JavaScript               |
| Voice Input      | Lens Studio `AsrModule` + Web Speech API|
| Camera Stream      | Lens Studio `CameraModule` + Base64 Encoding|
| UI Rendering     | Live canvas, DOM-based chat & prompt UI |

---

### 📁 Project Structure
```
Remote ARsistance/
│
├── Websocket Server/                 # Node.js backend
│   ├── node_modules/                 # Dependencies
│   ├── public/                       # Static frontend for remote viewer
│   │   └── index.html                # Live stream + annotation + chat UI
│   ├── package.json                  # NPM config
│   ├── package-lock.json             # NPM lockfile
│   └── server.js                     # Core WebSocket + session logic
│
├── Remote ARsistance LS/             # Lens Studio project folder
│   └── Assets/
│       ├── Addons/                   # Optional LS plugins
│       ├── Materials/                # Shaders, PBR materials, etc.
│       ├── Meshes/                   # Any imported 3D geometry
│       ├── Others/                   # Misc. files
│       ├── Physics/                  # AR physics assets
│       ├── Prefabs/                  # AR overlays or interactive prefabs
│       └── Scripts/
│           ├── Modules/              # Helper or shared modules
│           ├── AnnotationRenderer.js     # Draws annotation UI from web
│           ├── ASRHandler.js             # Uses speech API to convert to text
│           ├── CameraStream.js          # Captures video feed and sends to web
│           ├── SessionManager.js        # Handles session creation/login
│           ├── WebSocketClient.js       # Client logic to talk to Node WS server
│           └── MainController.js        # Central coordinator (initializes flow)
│
└── README.md                         # Documentation with feature highlights
```

---

## 📦 Server Setup

The backend server uses **Node.js**, **Express**, and **WebSocket (ws)** to manage real-time streaming, annotation, chat, and session handling between Spectacles and the web client.

### 🛠️ Prerequisites

* Node.js (v16+ recommended)
* [Ngrok](https://ngrok.com/) (for WSS tunneling when testing on Spectacles)

### 📁 Install Dependencies

```bash
cd Websocket\ Server/
npm install
```

### ▶️ Start the Server

```bash
node server.js
```

This will start the WebSocket + static server on:

```
http://localhost:8080
```

You can open this in your browser to test the live stream UI.

---

## 🌐 Localhost vs WSS (Important!)

### ✅ Works on Lens Studio Editor (Preview Mode):

* You can set the WebSocket server to `ws://localhost:8080`
* Works directly when previewing inside Lens Studio editor

### ❌ Won’t Work on Spectacles Device:

* Spectacles **require secure `wss://` WebSocket**
* `localhost` or `ws://` will **fail silently** on-device

---

## 🚇 Use Ngrok for Secure Tunnel (For Spectacles Testing)

To bridge your localhost to a secure WebSocket endpoint:

```bash
ngrok http 8080
```

You’ll get a secure URL like:

```
https://random-subdomain.ngrok.io
```

Convert that to WebSocket:

```
wss://random-subdomain.ngrok.io
```

> 💡 **Inside Lens Studio**:
> Pass only the server host to the existing `wssURL` input. The scene currently points to the deployed Cloud Run host. See [DEPLOYMENT.md](DEPLOYMENT.md) for device setup.
> The script will add the `wss://` prefix automatically. 
```js
 let socket = script.internetModule.createWebSocket("wss://" + script.wssURL);
```




---


## 🧪 How It Works

1. **Specs user** starts the Lens → The server generates a session code (e.g., `KD87FZ24`)
2. **Web Client** enters the code on the browser → joins the session
3. Once connected:
   - Spectacles stream begins
   - Chat + ASR are enabled
   - Web can annotate directly on live feed
   - Expert can start a two-way voice call
4. If specs user disconnects, the session is cleaned up and auto-refreshes on web.

---

## 🔐 Security & Constraints
- One Spectacles + One Web client per session.
- Sessions are unique, private, and ephemeral.

---

## ✨ Future Work
- Multi-user conferencing
- Drawings, Shapes etc.

---

## 🧠 Made With Love by Krazyy Krunal

> ⚙️ *All Things Krazyy* | XR for Real Impact
