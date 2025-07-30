const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const sessions = {}; // { sessionCode: { specs: ws, web: ws } }

wss.on('connection', (ws) => {
    console.log("New WebSocket connection");

    let buffer = '';

    ws.on('message', (message) => {
        let dataStr = message.toString();

        try {
            const data = JSON.parse(dataStr);

            // Join Session
            if (data.action === 'join-session' && data.sessionCode && data.role) {
                const code = data.sessionCode.toUpperCase();

                if (!sessions[code]) sessions[code] = {};
                const session = sessions[code];

                if (data.role === 'specs') {
                    if (session.specs) {
                        ws.send(JSON.stringify({ error: 'Spectacles already connected to this session' }));
                        ws.close();
                        return;
                    }
                    session.specs = ws;
                } else if (data.role === 'web') {
                    if (session.web) {
                        ws.send(JSON.stringify({ error: 'Web client already connected to this session' }));
                        ws.close();
                        return;
                    }
                    session.web = ws;
                }

                ws.sessionCode = code;
                ws.role = data.role;

                console.log(`${data.role} joined session ${code}`);

                // Only send 'joined' status to Spectacles when both are connected
                if (session.specs && session.web) {
                    if (session.specs.readyState === WebSocket.OPEN) {
                        session.specs.send(JSON.stringify({ status: 'joined', sessionCode: code }));
                    }
                    if (session.web.readyState === WebSocket.OPEN) {
                        session.web.send(JSON.stringify({ status: 'joined', sessionCode: code }));
                    }
                }

                return;
            }

            // Chat / Annotation / Specs-Chat routing
            if (ws.sessionCode && sessions[ws.sessionCode]) {
                const session = sessions[ws.sessionCode];
                const target = ws.role === 'specs' ? session.web : session.specs;

                if (data.action === 'annotate' && data.data && target?.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({ action: 'annotate', data: data.data }));
                    console.log("Annotation forwarded");
                }

                if (data.action === 'chat' && data.data?.message && target?.readyState === WebSocket.OPEN) {
                    session.web.send(JSON.stringify({ action: 'chat', from: 'web', data: { message: "Web Admin: " + data.data.message } }));
                    session.specs.send(JSON.stringify({ action: 'chat', from: 'web', data: { message: "Web Admin: " + data.data.message } }));
                    console.log("Web chat forwarded to specs");
                }

                if (data.action === 'specs-chat' && data.text && target?.readyState === WebSocket.OPEN) {
                    session.web.send(JSON.stringify({ action: 'chat', from: 'specs', data: { message: "Spectacles User: " + data.text } }));
                    session.specs.send(JSON.stringify({ action: 'chat', from: 'specs', data: { message: "Spectacles User: " + data.text } }));
                    console.log("Specs chat forwarded to web");
                }

                return;
            }

        } catch (e) {
            // Not JSON — assume base64 frame
        }

        // Handle base64 frame streaming
        buffer += dataStr;
      
        while (buffer.includes('|||FRAME_END|||')) {
            const frameEndIndex = buffer.indexOf('|||FRAME_END|||');
            const base64Frame = buffer.slice(0, frameEndIndex);
            buffer = buffer.slice(frameEndIndex + '|||FRAME_END|||'.length);

            if (base64Frame.length > 100 && /^[A-Za-z0-9+/=]+$/.test(base64Frame)) {
                if (ws.sessionCode && sessions[ws.sessionCode]) {
                    const session = sessions[ws.sessionCode];
                    const target = session.web;

                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(base64Frame + '|||FRAME_END|||');
                    }
                }
            }
        }
    });

    ws.on('close', () => {
        if (ws.sessionCode && sessions[ws.sessionCode]) {
            const session = sessions[ws.sessionCode];

             if (ws.role === 'specs') {
            // If Spectacles disconnects, disconnect web too
            if (session.web && session.web.readyState === WebSocket.OPEN) {
                session.web.send(JSON.stringify({ error: "Spectacles disconnected. Closing session." }));
                session.web.close();
            }
            delete session.specs;
        }
            if (ws.role === 'web') delete session.web;

            if (!session.specs && !session.web) {
                delete sessions[ws.sessionCode];
            }

            console.log(`${ws.role} disconnected from session ${ws.sessionCode}`);
        }
    });

    ws.on('error', (err) => {
        console.error("WebSocket error:", err);
    });
});

app.use(express.static(path.join(__dirname, 'public')));

server.listen(8080, () => {
    console.log("Server running at http://localhost:8080");
});
