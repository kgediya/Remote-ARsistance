const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8080);
const MAX_FRAME = 512 * 1024;
const MAX_AUDIO = 65536;
const SESSION_TTL = 30 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const END = '|||FRAME_END|||';
const DEBUG_LOGS = process.env.DEBUG_LOGS === '1';

function createServer() {
  const SERVER_REGION = (process.env.RELAYVIEW_REGION || '').trim().toUpperCase();
  const app = express();
  app.disable('x-powered-by');
  app.get(['/healthz', '/api/health'], (_req, res) => res.json({ status: 'ok', region: SERVER_REGION || 'US' }));
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, maxPayload: MAX_FRAME + 32, perMessageDeflate: false });
  const sessions = new Map();
  const attempts = new Map();
  let nextConnectionId = 0;
  function debug(event, fields = {}) {
    if (DEBUG_LOGS) console.log(JSON.stringify({ event, ...fields }));
  }

  function send(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
  function code() {
    let value;
    do {
      const core = Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
      value = SERVER_REGION ? `${SERVER_REGION}-${core}` : core;
    } while (sessions.has(value));
    return value;
  }
  function resolveSession(raw) {
    if (typeof raw !== 'string') return null;
    const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!clean) return null;

    const full = raw.trim().toUpperCase();
    if (sessions.has(full)) return { session: sessions.get(full), code: full };
    if (sessions.has(clean)) return { session: sessions.get(clean), code: clean };

    if (/^[A-Z]{2}[A-HJ-NP-Z2-9]{6}$/.test(clean)) {
      const formatted = clean.slice(0, 2) + '-' + clean.slice(2);
      if (sessions.has(formatted)) return { session: sessions.get(formatted), code: formatted };
      const stripped = clean.slice(2);
      if (sessions.has(stripped)) return { session: sessions.get(stripped), code: stripped };
    }

    if (/^[A-HJ-NP-Z2-9]{6}$/.test(clean)) {
      if (SERVER_REGION) {
        const prefixed = `${SERVER_REGION}-${clean}`;
        if (sessions.has(prefixed)) return { session: sessions.get(prefixed), code: prefixed };
      }
    }
    return null;
  }
  function paired(session) {
    return session && session.specs?.readyState === WebSocket.OPEN && session.web?.readyState === WebSocket.OPEN;
  }
  function leave(ws) {
    const session = sessions.get(ws.sessionCode);
    if (!session || session[ws.role] !== ws) return;
    const peerRole = ws.role === 'specs' ? 'web' : 'specs';
    const peer = session[peerRole];
    const hadCall = session.callActive;
    session[ws.role] = null;
    session.callActive = false;
    debug('peer-left', { peer: ws.debugId, role: ws.role, session: session.debugId });
    if (hadCall) {
      send(peer, { action: 'call-state', state: 'stop', reason: 'peer-disconnected' });
    }
    send(peer, { status: 'peer-left', role: ws.role });
    if (ws.role === 'specs') sessions.delete(ws.sessionCode);
    else session.lastActivity = Date.now();
  }

  wss.on('connection', (ws, req) => {
    ws.debugId = ++nextConnectionId;
    debug('socket-open', { peer: ws.debugId, origin: req.headers.origin || 'none' });
    ws._socket?.setNoDelay(true);
    if (wss.clients.size > 100) { ws.close(1013, 'Server busy'); return; }
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://' + req.headers.host;
    const localOrigin = 'http://' + req.headers.host;
    if (req.headers.origin && req.headers.origin !== allowedOrigin &&
        !(process.env.NODE_ENV !== 'production' && req.headers.origin === localOrigin)) {
      ws.close(1008, 'Origin denied');
      return;
    }
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw, binary) => {
      if (binary) {
        const session = sessions.get(ws.sessionCode);
        if (!paired(session) || raw.length < 3 || raw.length > MAX_AUDIO ||
            raw[0] !== 0x41 || !session.callActive) return;
        const target = ws.role === 'specs' ? session.web : session.specs;
        if (target?.readyState === WebSocket.OPEN && target.bufferedAmount < MAX_AUDIO * 4) {
          session.lastActivity = Date.now();
          target.send(raw, { binary: true, compress: false });
          session.audioPackets = (session.audioPackets || 0) + 1;
          if (ws.role === 'specs') {
            session.specsAudio = (session.specsAudio || 0) + 1;
            if (session.specsAudio === 1 || session.specsAudio % 150 === 0)
              debug('audio-from-specs', { session: session.debugId, count: session.specsAudio, bytes: raw.length });
          } else {
            session.webAudio = (session.webAudio || 0) + 1;
            if (session.webAudio === 1 || session.webAudio % 200 === 0)
              debug('audio-from-web', { session: session.debugId, count: session.webAudio, bytes: raw.length });
          }
        }
        return;
      }
      const value = raw.toString();
      if (value.endsWith(END)) {
        const session = sessions.get(ws.sessionCode);
        const frame = value.slice(0, -END.length);
        if (ws.role !== 'specs' || !paired(session) || frame.length > MAX_FRAME || frame.length < 100) return;
        session.lastActivity = Date.now();
        // Strict backpressure: drop stale video frame if web socket buffer has > 64KB pending
        if (session.web.bufferedAmount < 65536) {
          session.web.send(value);
          session.frames = (session.frames || 0) + 1;
          if (session.frames === 1 || session.frames % 80 === 0)
            debug('video-relay', { session: session.debugId, frames: session.frames, bytes: frame.length });
        }
        return;
      }
      let msg;
      try { msg = JSON.parse(value); } catch { send(ws, { error: 'Invalid JSON' }); return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.action === 'create-session' && !ws.role) {
        if (sessions.size >= 100) { send(ws, { error: 'Server busy' }); return; }
        const sessionCode = code();
        sessions.set(sessionCode, { specs: ws, web: null, lastActivity: Date.now(), debugId: ws.debugId });
        ws.role = 'specs';
        ws.sessionCode = sessionCode;
        send(ws, { status: 'created', sessionCode, region: SERVER_REGION || 'US' });
        debug('session-created', { session: ws.debugId, sessionCode, region: SERVER_REGION });
        return;
      }
      if (msg.action === 'join-session' && !ws.role) {
        const address = req.socket.remoteAddress || 'unknown';
        const attempt = attempts.get(address) || { count: 0, until: Date.now() + 60000 };
        if (Date.now() > attempt.until) { attempt.count = 0; attempt.until = Date.now() + 60000; }
        attempt.count++;
        attempts.set(address, attempt);
        if (attempt.count > 20) { send(ws, { error: 'Too many attempts. Try again shortly.' }); return; }

        const match = resolveSession(msg.sessionCode);
        if (msg.role !== 'web' || !match || !match.session || !match.session.specs || match.session.web) {
          send(ws, { error: (!match || msg.role !== 'web') ? 'Invalid session code' : 'Session unavailable' });
          return;
        }
        const session = match.session;
        session.web = ws;
        session.lastActivity = Date.now();
        ws.role = 'web';
        ws.sessionCode = match.code;
        send(ws, { status: 'joined', sessionCode: match.code, region: SERVER_REGION || 'US' });
        send(session.specs, { status: 'joined', sessionCode: match.code });
        debug('session-joined', { session: session.debugId, peer: ws.debugId, sessionCode: match.code, region: SERVER_REGION });
        return;
      }
      const session = sessions.get(ws.sessionCode);
      if (!paired(session)) { send(ws, { error: 'No active peer' }); return; }
      session.lastActivity = Date.now();
      if (msg.action === 'ping' && Number.isFinite(msg.sentAt)) {
        send(ws, { action: 'pong', sentAt: msg.sentAt });
      } else if (msg.action === 'chat' && ws.role === 'web' && typeof msg.data?.message === 'string') {
        const message = msg.data.message.trim().slice(0, 500);
        if (message) {
          const payload = { action: 'chat', from: 'web', data: { message } };
          send(session.specs, payload); send(session.web, payload);
        }
      } else if (msg.action === 'specs-chat' && ws.role === 'specs' && typeof msg.text === 'string') {
        const message = msg.text.trim().slice(0, 500);
        if (message) {
          const payload = { action: 'chat', from: 'specs', data: { message } };
          send(session.web, payload); send(session.specs, payload);
        }
      } else if (msg.action === 'annotate' && ws.role === 'web') {
        const data = msg.data;
        if (data?.type === 'text' && typeof data.label === 'string' &&
            data.label.trim().length > 0 && data.label.length <= 80 &&
            Number.isFinite(data.x) && Number.isFinite(data.y) &&
            data.x >= 0 && data.x <= 1 && data.y >= 0 && data.y <= 1) {
          send(session.specs, { action: 'annotate', data: { type: 'text', label: data.label.trim(), x: data.x, y: data.y } });
        }
      } else if (msg.action === 'call-state' && ws.role === 'web') {
        if (msg.state === 'start' || msg.state === 'stop') {
          session.callActive = msg.state === 'start';
          debug('call-state', { session: session.debugId, state: msg.state });
          send(session.specs, { action: 'call-state', state: msg.state });
          send(session.web, { action: 'call-state', state: msg.state });
        }
      } else if (msg.action === 'network-stat' && ws.role === 'web' && Number.isFinite(msg.rtt)) {
        send(session.specs, { action: 'network-stat', rtt: Math.max(1, Math.round(msg.rtt)) });
      } else if (msg.action === 'mic-status' && ws.role === 'specs') {
        send(session.web, { action: 'mic-status', status: msg.status, message: msg.message });
      }
    });
    ws.on('close', (code, reason) => {
      debug('socket-close', { peer: ws.debugId, code, reason: reason.toString() });
      leave(ws);
    });
    ws.on('error', error => {
      debug('socket-error', { peer: ws.debugId, message: error.message });
      leave(ws);
    });
  });

  const timer = setInterval(() => {
    for (const [address, attempt] of attempts) if (Date.now() > attempt.until) attempts.delete(address);
    for (const [sessionCode, session] of sessions) {
      if (Date.now() - session.lastActivity > SESSION_TTL) {
        send(session.specs, { status: 'expired' }); send(session.web, { status: 'expired' });
        session.specs?.close(1000, 'Session expired'); session.web?.close(1000, 'Session expired');
        sessions.delete(sessionCode);
      }
    }
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 30000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

if (require.main === module) createServer().listen(PORT, () => console.log('Remote ARsistance listening on ' + PORT));
module.exports = { createServer };
