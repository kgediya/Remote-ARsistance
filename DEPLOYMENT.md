# Remote ARsistance deployment

The system has three parts: a Specs Lens, a Node.js WebSocket service, and the web expert interface served by that service. The Lens scene wires `MainController` to the Internet Module, camera preview, render target, crop texture, chat and code text, TTS, Instant World Hit Test, microphone audio, and audio output. The server creates a six-character session displayed as `XXX-XXX`; the expert joins with that code. Camera frames, chat, annotations, and live voice are relayed only while both peers are connected.

## Local editor check

1. Run `cd "Websocket Server" && npm ci && npm test && npm start`.
2. Open `Remote ARsistance LS/Remote ARsistance.esproj` in Lens Studio 5.15 or later. The scene's `MainController.wssURL` is set to the deployed Cloud Run host. For local editor-only testing, set it to `localhost:8080`.
3. In Lens Studio 5.15 Preview, set **Device Type Override** to **Spectacles**, then reset the preview. The project now saves this override in its Preview preferences; check it in the panel if the editor has already loaded older preferences. It should display a `XXX-XXX` code after connecting. WebSocket support in the editor requires the Spectacles device override.
4. Open `https://relayview.allthingskrazyy.com` (or `https://remote-arsistance-4o3z4dbrga-uc.a.run.app` / `http://localhost:8080`), enter the code, then check live frames, chat in both directions, speech transcription, and click annotations on a tracked surface. Click **Start call** to grant browser microphone access and test speech in both directions. The browser microphone requires HTTPS except on localhost.

The project is saved with Lens Studio 5.15.4. The expert portal is branded RelayView; the Lens and its server protocol remain Remote ARsistance. The join and call flow has been manually verified on physical Specs. Repeat device checks for each release because static JavaScript and server tests cannot validate camera permission, microphone permission, speaker playback, ASR, scene rendering, or hit-test behavior.

### Device join diagnostics

Debug logging is enabled. Send the updated Lens to Spectacles, open Lens Studio's **Logger** panel for the connected device, and filter for `[ARsistance]`. Start the Lens, note the session code, and join from the web portal. The expected sequence is `socket open`, `session created`, `expert joined`, `camera requesting`, `camera ready`, `ASR starting`, and `camera sent frame 1`. The last message before a crash identifies the failing stage. Camera setup exceptions are logged and shown in the Lens rather than escaping the join handler. Logs report state and frame sizes, never camera images, audio, transcriptions, or session codes.

Cloud Run records corresponding `session-created`, `session-joined`, `video-relay`, `audio-relay`, and socket-close events. Read them with `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="remote-arsistance" AND jsonPayload.event!=""' --project krazyy-krunal --limit 50 --format='table(timestamp,jsonPayload)'`.

## Device deployment

1. For Google Cloud Run, sign in with `gcloud auth login`, select a billed project, then run `REMOTE_ARSISTANCE_GCP_PROJECT=your-project-id ./deploy-cloud-run.sh`. The script deploys to `us-central1` by default (enabling custom domain mappings) with one warm instance, one maximum instance, and a 60-minute WebSocket timeout. Set `REMOTE_ARSISTANCE_GCP_REGION` if needed (e.g. `asia-south1` for India).
2. **Regional Routing (Solution 1)**: Deployments can be tagged with `RELAYVIEW_REGION=IN` (Mumbai, `asia-south1`) or `RELAYVIEW_REGION=US` (Iowa, `us-central1`). When configured, session codes are generated with their region tag (e.g. `IN-XXX-XXX`). The web expert portal parses the prefix and automatically connects its WebSocket to the nearest regional Cloud Run instance, dropping cross-continent latency from ~260ms to 15–30ms.
3. The Cloud Run URL and custom domain `https://relayview.allthingskrazyy.com` serve both the web app and secure WebSocket connections. Set `ALLOWED_ORIGIN` if deploying behind a separate origin.
4. In Lens Studio, `MainController.wssURL` is configured to the regional server (default: `remote-arsistance-597953322753.asia-south1.run.app` for India, or `relayview.allthingskrazyy.com` for US). Enter a host only; the script adds `wss://`. Device builds must never use `localhost`.
5. Build the Lens for Specs, accept the camera, microphone, and internet permission prompts, and run a two-device check with a browser on a separate network. Test call start, mute, hangup, reconnect, and speaker echo.

`GET /api/health` returns `{ "status": "ok", "region": "IN" }`. Sessions expire after 30 minutes of inactivity. The server limits payload size, join attempts, concurrent connections, and queued video and audio frames. Session codes are generated with Node's cryptographic random number generator. The code grants access to the live camera and call, so share it only with the intended expert. Cloud Run can close WebSockets at the configured 60-minute timeout; both users must rejoin after a connection closes.

## Protocol

The Lens sends `{"action":"create-session"}` after the WebSocket opens. The server replies with `{"status":"created","sessionCode":"..."}`. The browser sends `{"action":"join-session","role":"web","sessionCode":"..."}`; both peers receive `status: joined`. Chat, annotations, and call state use JSON messages. JPEG frames are base64 strings terminated by `|||FRAME_END|||`. Voice frames are binary PCM16 mono at 16 kHz, prefixed with byte `0x41`. The browser starts and stops the call with `call-state` messages. A peer disconnect sends `status: peer-left`; the Lens keeps its code available for another expert.
