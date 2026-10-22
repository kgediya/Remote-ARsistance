(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const END = '|||FRAME_END|||';
  const MAX_FRAME = 524288;
  let socket = null;
  let call = null;
  let connected = false;
  let recognition = null;
  let newestFrame = 0;
  let lastFrameAt = 0;
  let toastTimer = null;
  let modalType = null;
  let annotationPoint = null;
  let modalOpener = null;
  let activeCode = '';
  let currentRegion = null;

  const REGION_GATEWAYS = {
    'IN': {
      code: 'IN',
      name: 'Mumbai, India (asia-south1)',
      short: 'Mumbai',
      host: 'remote-arsistance-597953322753.asia-south1.run.app'
    },
    'US': {
      code: 'US',
      name: 'Iowa, USA (us-central1)',
      short: 'US Central',
      host: 'remote-arsistance-597953322753.us-central1.run.app'
    },
    'EU': {
      code: 'EU',
      name: 'Belgium, Europe (europe-west1)',
      short: 'Europe',
      host: 'remote-arsistance-597953322753.europe-west1.run.app'
    }
  };

  const displayCode = code => {
    if (!code) return '';
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z]{2}[A-HJ-NP-Z2-9]{6}$/.test(clean)) {
      return clean.slice(0, 2) + '-' + clean.slice(2, 5) + '-' + clean.slice(5);
    }
    if (clean.length > 3) {
      return clean.slice(0, 3) + '-' + clean.slice(3);
    }
    return clean;
  };

  function showToast(message, tone = 'info', duration = 6000) {
    clearTimeout(toastTimer);
    $('status').textContent = message;
    $('toast').dataset.tone = tone;
    $('toast').hidden = false;
    if (duration) toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
  }
  $('dismissToast').addEventListener('click', () => {
    clearTimeout(toastTimer);
    $('toast').hidden = true;
  });

  function setCallState(message) {
    const active = call?.active === true;
    $('callButton').classList.toggle('active', active);
    $('callButton').querySelector('span').textContent = active ? 'End call' : 'Start call';
    $('muteButton').disabled = !active;
    $('callState').textContent = active ? (call.muted ? 'Connected · Microphone muted' : 'Connected · Microphone on') : 'Start a call to speak with the technician';
    if (!active) {
      $('muteButton').querySelector('span').textContent = 'Mute';
      $('muteIcon').setAttribute('href', '#i-mic');
    }
    if (message === 'Call connected') showToast('Voice call connected', 'success');
  }

  let isReconnecting = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;
  let reconnectTimer = null;
  let userLeaving = false;

  function setFeedState(state) {
    const live = state === 'live';
    const stalled = state === 'stalled';
    $('liveIndicator').classList.toggle('live', live);
    $('feedBadge').classList.toggle('live', live);
    $('feedBadge').classList.toggle('stalled', stalled);
    $('feedBadge').lastChild.textContent = live ? ' LIVE VIEW' : (stalled ? ' FEED PAUSED' : ' WAITING FOR FEED');
  }

  function checkFeedHealth() {
    if (!connected) return;
    const now = performance.now();
    if (!lastFrameAt) {
      setFeedState('waiting');
      return;
    }
    const diff = now - lastFrameAt;
    if (diff > 8000) {
      setFeedState('stalled');
      $('feedWarning').hidden = false;
      $('feedWarningTitle').textContent = 'Camera feed interrupted';
      $('feedWarningText').textContent = 'No camera frames received for ' + Math.round(diff / 1000) + 's. Checking technician connection…';
    } else if (diff > 4000) {
      setFeedState('stalled');
    } else {
      setFeedState('live');
      $('feedWarning').hidden = true;
    }
  }

  function clearView(full = true) {
    lastFrameAt = 0;
    newestFrame++;
    $('liveCanvas').hidden = true;
    if ($('annotationCanvas')) $('annotationCanvas').hidden = true;
    if ($('annotationToolbar')) $('annotationToolbar').hidden = true;
    $('videoPlaceholder').hidden = false;
    $('feedWarning').hidden = true;
    $('latency').textContent = 'Measuring connection…';
    if (full) {
      $('chatLog').replaceChildren($('chatEmpty'));
      $('chatEmpty').hidden = false;
      if (typeof clearAllAnnotationsInternal === 'function') clearAllAnnotationsInternal(false);
    }
    setFeedState('waiting');
  }

  function reset(message, tone = 'info') {
    clearTimeout(reconnectTimer);
    userLeaving = false;
    isReconnecting = false;
    reconnectAttempts = 0;
    const oldSocket = socket;
    socket = null;
    connected = false;
    call?.stop(false);
    call = null;
    oldSocket?.close();
    closeModal();
    $('reconnectBanner').hidden = true;
    $('joinButton').disabled = false;
    $('joinButton').querySelector('span').textContent = 'Connect to technician';
    $('joinPanel').hidden = false;
    $('sessionPanel').hidden = true;
    $('sessionCode').value = '';
    activeCode = '';
    document.title = 'RelayView — Remote assistance, in focus';
    clearView(true);
    setCallState();
    if (message) showToast(message, tone, tone === 'error' ? 9000 : 6000);
  }

  function attemptReconnect() {
    if (!activeCode || userLeaving) return;
    clearTimeout(reconnectTimer);
    reconnectAttempts++;
    $('reconnectBanner').hidden = false;
    $('reconnectRetryBtn').hidden = false;
    $('reconnectMessage').textContent = 'Connection lost. Reconnecting to technician (attempt ' + reconnectAttempts + ' of ' + MAX_RECONNECT + ')…';
    connectSession(activeCode, true);
  }

  function send(payload) {
    if (!connected || socket?.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
  function fitCanvas() {
    const canvas = $('liveCanvas');
    const annCanvas = $('annotationCanvas');
    if (canvas.hidden || !canvas.width || !canvas.height) return;
    const stage = $('videoStage');
    const scale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    const w = Math.floor(canvas.width * scale) + 'px';
    const h = Math.floor(canvas.height * scale) + 'px';
    canvas.style.width = w;
    canvas.style.height = h;
    if (annCanvas) {
      if (annCanvas.width !== canvas.width || annCanvas.height !== canvas.height) {
        annCanvas.width = canvas.width;
        annCanvas.height = canvas.height;
      }
      annCanvas.style.width = w;
      annCanvas.style.height = h;
      annCanvas.hidden = false;
      if (typeof renderAnnotations === 'function') renderAnnotations();
    }
    const toolbar = $('annotationToolbar');
    if (toolbar && connected) toolbar.hidden = false;
  }
  window.addEventListener('resize', fitCanvas);

  function showFrame(base64) {
    if (!base64 || base64.length < 100 || base64.length > MAX_FRAME) return;
    const frameNumber = ++newestFrame;
    const canvas = $('liveCanvas');

    if (window.createImageBitmap) {
      try {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        createImageBitmap(blob).then(bitmap => {
          if (frameNumber !== newestFrame || !connected) {
            bitmap.close();
            return;
          }
          const resized = canvas.width !== bitmap.width || canvas.height !== bitmap.height;
          if (resized) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          canvas.hidden = false;
          $('videoPlaceholder').hidden = true;
          $('feedWarning').hidden = true;
          lastFrameAt = performance.now();
          setFeedState('live');
          if (resized) fitCanvas();
        }).catch(() => {});
      } catch {
        /* Drop corrupted frame gracefully */
      }
    } else {
      const image = new Image();
      image.onload = () => {
        if (frameNumber !== newestFrame || !connected) return;
        const resized = canvas.width !== image.width || canvas.height !== image.height;
        if (resized) {
          canvas.width = image.width;
          canvas.height = image.height;
        }
        canvas.getContext('2d').drawImage(image, 0, 0);
        canvas.hidden = false;
        $('videoPlaceholder').hidden = true;
        $('feedWarning').hidden = true;
        lastFrameAt = performance.now();
        setFeedState('live');
        if (resized) fitCanvas();
      };
      image.src = 'data:image/jpeg;base64,' + base64;
    }
  }

  setInterval(() => {
    if (!connected) return;
    send({ action: 'ping', sentAt: performance.now() });
    checkFeedHealth();
  }, 2000);

  function appendMessage(from, text) {
    $('chatEmpty').hidden = true;
    const own = from !== 'specs';
    const item = document.createElement('div');
    item.className = 'message ' + (own ? 'expert' : 'technician');
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('strong');
    name.textContent = own ? 'You' : 'Technician';
    const time = document.createElement('span');
    time.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    meta.append(name, time);
    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = text;
    item.append(meta, body);
    $('chatLog').append(item);
    while ($('chatLog').children.length > 101) $('chatLog').children[1].remove();
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  }

  $('sessionCode').addEventListener('input', event => {
    let raw = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let formatted = raw;
    let detectedRegion = null;

    const prefix = raw.slice(0, 2);
    if (REGION_GATEWAYS[prefix]) {
      raw = raw.slice(0, 8);
      detectedRegion = REGION_GATEWAYS[prefix];
      if (raw.length > 5) {
        formatted = raw.slice(0, 2) + '-' + raw.slice(2, 5) + '-' + raw.slice(5);
      } else if (raw.length > 2) {
        formatted = raw.slice(0, 2) + '-' + raw.slice(2);
      }
    } else {
      raw = raw.slice(0, 6);
      if (raw.length > 3) {
        formatted = raw.slice(0, 3) + '-' + raw.slice(3);
      }
    }
    event.target.value = formatted;

    const hint = $('regionHint');
    if (hint) {
      if (detectedRegion) {
        hint.hidden = false;
        $('regionHintText').textContent = 'Direct route: ' + detectedRegion.name;
      } else {
        hint.hidden = true;
      }
    }
  });

  function connectSession(code, isResume = false) {
    if (socket) {
      try { socket.close(); } catch { /* ignore */ }
    }
    connected = false;

    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let targetHost = location.host;
    let selectedRegion = null;

    const cleanPrefix = clean.slice(0, 2);
    if (REGION_GATEWAYS[cleanPrefix] && clean.length > 2) {
      targetHost = REGION_GATEWAYS[cleanPrefix].host;
      selectedRegion = REGION_GATEWAYS[cleanPrefix];
    }
    currentRegion = selectedRegion;

    if (!isResume) {
      $('joinButton').disabled = true;
      $('joinButton').querySelector('span').textContent = 'Connecting…';
      showToast(selectedRegion ? `Connecting via ${selectedRegion.name}…` : 'Connecting to technician…', 'info', 0);
    }

    const wsProto = (location.protocol === 'https:' || targetHost.includes('.run.app')) ? 'wss://' : 'ws://';
    const ws = new WebSocket(wsProto + targetHost);
    ws.binaryType = 'arraybuffer';
    socket = ws;
    call = new RemoteCall(ws, setCallState, () => {
      showToast("Technician's audio is silent. Ask technician to check their XR / Spatial Glasses if issue persists.", 'warning', 8500);
    });

    ws.onopen = () => {
      if (socket === ws) ws.send(JSON.stringify({ action: 'join-session', role: 'web', sessionCode: code }));
    };

    ws.onmessage = event => {
      if (socket !== ws) return;
      if (event.data instanceof ArrayBuffer) { call?.play(event.data); return; }
      if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
        event.data.arrayBuffer().then(buf => call?.play(buf)).catch(() => {});
        return;
      }
      if (typeof event.data !== 'string') return;
      if (event.data.endsWith(END)) { showFrame(event.data.slice(0, -END.length)); return; }
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.status === 'joined') {
        connected = true;
        isReconnecting = false;
        reconnectAttempts = 0;
        clearTimeout(reconnectTimer);
        activeCode = msg.sessionCode;
        $('activeCode').textContent = displayCode(activeCode);
        $('joinPanel').hidden = true;
        $('sessionPanel').hidden = false;
        $('reconnectBanner').hidden = true;
        $('toast').hidden = true;
        document.title = 'Live session — RelayView';
        if (!isResume) {
          clearView(true);
        } else {
          clearView(false);
        }
        if (msg.region && REGION_GATEWAYS[msg.region]) {
          currentRegion = REGION_GATEWAYS[msg.region];
        }
        setCallState();
        showToast(isResume ? 'Reconnected to technician!' : 'Connected. Waiting for technician’s camera feed.', 'success');
      } else if (msg.status === 'peer-left') {
        call?.stop(false);
        setFeedState('stalled');
        $('feedWarning').hidden = false;
        $('feedWarningTitle').textContent = 'Technician disconnected';
        $('feedWarningText').textContent = 'Technician left or device went offline. Waiting for technician to reconnect…';
        $('reconnectBanner').hidden = false;
        $('reconnectMessage').textContent = 'Technician disconnected. Retaining session for reconnect…';
        $('reconnectRetryBtn').hidden = true;
        showToast('Technician disconnected. Waiting for reconnect…', 'error', 8000);
      } else if (msg.status === 'expired') {
        reset('This session expired. Ask for a new code.', 'error');
      } else if (msg.error) {
        if (!connected) {
          if (isResume && reconnectAttempts < MAX_RECONNECT) {
            reconnectTimer = setTimeout(attemptReconnect, Math.min(1000 * Math.pow(1.5, reconnectAttempts), 8000));
          } else {
            reset(msg.error, 'error');
          }
        } else {
          showToast(msg.error, 'error');
        }
      } else if (msg.action === 'pong' && Number.isFinite(msg.sentAt)) {
        const rtt = Math.max(0, Math.round(performance.now() - msg.sentAt));
        const regPrefix = currentRegion?.short ? `${currentRegion.short} · ` : '';
        $('latency').textContent = `${regPrefix}Network RTT ${rtt} ms`;
        send({ action: 'network-stat', rtt });
      } else if (msg.action === 'call-state' && msg.state === 'stop') {
        call?.stop(false);
        showToast('Voice call ended by peer.', 'info', 4000);
      } else if (msg.action === 'mic-status' && msg.status === 'waiting') {
        showToast(msg.message || "Technician's mic is silent. If issue persists, please have technician check their XR / Spatial Glasses.", 'warning', 8500);
      } else if (msg.action === 'annotation-feedback' && msg.data) {
        if (typeof updatePlacementStatus === 'function') {
          updatePlacementStatus(msg.data.placementMode, msg.data.surfaceHit, msg.data.distanceMeters);
        }
      } else if (msg.action === 'chat' && typeof msg.data?.message === 'string') {
        appendMessage(msg.from, msg.data.message);
      }
    };

    ws.onerror = () => {
      if (socket !== ws) return;
      if (isResume && reconnectAttempts < MAX_RECONNECT) {
        reconnectTimer = setTimeout(attemptReconnect, Math.min(1000 * Math.pow(1.5, reconnectAttempts), 8000));
      } else if (!connected && !isResume) {
        reset('Could not connect. Check the code and try again.', 'error');
      }
    };

    ws.onclose = event => {
      if (socket !== ws) return;
      if (userLeaving) return;
      if (connected) {
        connected = false;
        call?.stop(false);
        if (reconnectAttempts < MAX_RECONNECT) {
          $('reconnectBanner').hidden = false;
          $('reconnectRetryBtn').hidden = false;
          $('reconnectMessage').textContent = 'Connection interrupted. Reconnecting (attempt ' + (reconnectAttempts + 1) + ' of ' + MAX_RECONNECT + ')…';
          reconnectTimer = setTimeout(attemptReconnect, Math.min(1000 * Math.pow(1.5, reconnectAttempts), 8000));
        } else {
          $('reconnectBanner').hidden = false;
          $('reconnectRetryBtn').hidden = false;
          $('reconnectMessage').textContent = 'Connection lost. Unable to auto-reconnect. You can retry or exit.';
          showToast('Connection lost. Please retry or start a new session.', 'error', 9000);
        }
      } else if (isResume) {
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectTimer = setTimeout(attemptReconnect, Math.min(1000 * Math.pow(1.5, reconnectAttempts), 8000));
        } else {
          $('reconnectMessage').textContent = 'Connection lost. Unable to auto-reconnect.';
          $('reconnectRetryBtn').hidden = false;
        }
      } else {
        reset(event?.reason || 'Unable to join this session.', 'error');
      }
    };
  }

  $('reconnectRetryBtn').addEventListener('click', () => {
    reconnectAttempts = 0;
    attemptReconnect();
  });
  $('reconnectLeaveBtn').addEventListener('click', () => {
    userLeaving = true;
    reset('You left the session.', 'info');
  });

  $('joinForm').addEventListener('submit', event => {
    event.preventDefault();
    const code = $('sessionCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^([A-Z]{2})?[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      showToast("Enter the session code (e.g. IN-XXX-XXX or XXX-XXX) shown on the technician's XR / Spatial Glasses.", 'error');
      $('sessionCode').focus();
      return;
    }
    userLeaving = false;
    connectSession(code, false);
  });

  $('callButton').addEventListener('click', async () => {
    if (!connected || !call) return;
    if (call.active) { call.stop(); return; }
    $('callButton').disabled = true;
    try { await call.start(); }
    catch (error) { showToast(error.message || 'Could not start the call.', 'error'); }
    finally { $('callButton').disabled = false; setCallState(); }
  });
  $('muteButton').addEventListener('click', () => {
    if (!call?.active) return;
    const muted = call.toggleMute();
    $('muteButton').querySelector('span').textContent = muted ? 'Unmute' : 'Mute';
    $('muteIcon').setAttribute('href', muted ? '#i-mic-off' : '#i-mic');
    setCallState();
  });
  $('chatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('chatForm').requestSubmit();
    }
  });
  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    const message = $('chatInput').value.trim();
    if (!message) return;
    if (send({ action: 'chat', data: { message } })) $('chatInput').value = '';
    else showToast('Connection lost. Message not sent.', 'error');
  });
  $('copyCodeButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(displayCode(activeCode));
      showToast('Session code copied.', 'success');
    } catch {
      showToast('Could not copy the code. Select it manually.', 'error');
    }
  });

  function openModal(type, point = null) {
    modalType = type;
    annotationPoint = point;
    modalOpener = document.activeElement;
    const annotation = type === 'annotation';
    $('modalKicker').textContent = annotation ? 'ANNOTATION' : 'END SESSION';
    $('modalTitle').textContent = annotation ? 'Add a note to their view' : 'Leave this session?';
    $('modalDescription').textContent = annotation ? 'The note appears at the point you selected in the technician’s view.' : 'Your live view, conversation, and voice call will end.';
    $('modalInputWrap').hidden = !annotation;
    $('modalConfirm').textContent = annotation ? 'Place note' : 'Leave session';
    $('modalConfirm').classList.toggle('button-danger', !annotation);
    $('modalInput').value = '';
    $('modal').hidden = false;
    document.body.classList.add('modal-open');
    (annotation ? $('modalInput') : $('modalCancel')).focus();
  }
  function closeModal() {
    $('modal').hidden = true;
    document.body.classList.remove('modal-open');
    modalType = null;
    annotationPoint = null;
    modalOpener?.focus?.();
    modalOpener = null;
  }
  // ==========================================
  // SPATIAL DOODLE ANNOTATION ENGINE (PHASES 1-7)
  // ==========================================
  let annotations = [];
  let undoStack = [];
  let redoStack = [];
  let activeTool = "circle";
  let activeColor = "#FFD84D";
  let activeStrokeWidth = 4;
  let isDrawing = false;
  let currentStroke = [];
  let labelTargetPoint = null;

  // 3D Wearer Perspective Mock Simulation State (Phase 7)
  let isSimMode = false;
  let simYaw = 0;
  let simPitch = 0;
  let simDragging = false;
  let simLastX = 0;
  let simLastY = 0;

  function updateUndoRedoButtons() {
    const undoBtn = $("btnUndo");
    const redoBtn = $("btnRedo");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function updatePlacementStatus(mode, surfaceHit, distMeters) {
    const badge = $("placementBadge");
    const text = $("placementText");
    if (!badge || !text) return;
    badge.classList.remove("mode-a", "mode-b", "mode-c");
    const distStr = distMeters ? " (" + Number(distMeters).toFixed(1) + "m)" : "";
    if (mode === "A" || surfaceHit) {
      badge.classList.add("mode-a");
      text.textContent = "SURFACE ANCHORED" + distStr;
    } else if (mode === "B") {
      badge.classList.add("mode-b");
      text.textContent = "APPROXIMATE" + distStr;
    } else {
      badge.classList.add("mode-c");
      text.textContent = "OVERLAY";
    }
  }

  function clearAllAnnotationsInternal(notifyPeer = true) {
    if (annotations.length > 0 && notifyPeer) {
      undoStack.push({ type: "clear", previous: [...annotations] });
      redoStack = [];
      updateUndoRedoButtons();
    }
    annotations = [];
    currentStroke = [];
    isDrawing = false;
    renderAnnotations();
    if (notifyPeer) {
      send({ action: "clear-annotations" });
      showToast("All annotations cleared.", "info");
    }
  }

  // --- Geometry Algorithms (Phase 2 & 7) ---
  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) {
      return Math.hypot(p.x - a.x, p.y - a.y);
    }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  }

  function rdpSimplify(points, epsilon = 0.003) {
    if (points.length <= 2) return points;
    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = distanceToSegment(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
      const right = rdpSimplify(points.slice(maxIdx), epsilon);
      return left.slice(0, -1).concat(right);
    } else {
      return [first, last];
    }
  }

  function catmullRomSpline(points, subdivisions = 4) {
    if (points.length < 3) return points;
    const res = [];
    const p = [points[0], ...points, points[points.length - 1]];

    for (let i = 0; i < p.length - 3; i++) {
      const p0 = p[i], p1 = p[i + 1], p2 = p[i + 2], p3 = p[i + 3];
      for (let step = 0; step < subdivisions; step++) {
        const t = step / subdivisions;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (
          (2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        );
        const y = 0.5 * (
          (2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        );
        res.push({ x, y });
      }
    }
    res.push(points[points.length - 1]);
    return res;
  }

  function smoothCircle(points) {
    if (!points.length) return { cx: 0.5, cy: 0.5, rx: 0.05, ry: 0.05 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = Math.max(0.015, (maxX - minX) / 2);
    const ry = Math.max(0.015, (maxY - minY) / 2);
    return { cx, cy, rx, ry };
  }

  function getNormalizedCoords(event) {
    const canvas = $("annotationCanvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  // --- Rendering Vector Annotations (Phase 2 & 7) ---
  function renderAnnotations() {
    const canvas = $("annotationCanvas");
    if (!canvas || canvas.hidden) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Mock 3D Wearer Perspective Simulation (Phase 7)
    if (isSimMode) {
      renderSimulatedHeadsetView(ctx, w, h);
      return;
    }

    // Smooth handoff to 3D Mixed Reality composited stream
    let needsReRender = false;
    const now = Date.now();
    for (const ann of annotations) {
      const age = now - (ann.committedAt || 0);
      if (age < 220) {
        const opacity = Math.max(0, 1 - (age / 220));
        ctx.save();
        ctx.globalAlpha = opacity;
        drawSingleAnnotation(ctx, ann, w, h);
        ctx.restore();
        needsReRender = true;
      }
    }

    // Render live drawing stroke preview (immediate 0ms feedback)
    if (isDrawing && currentStroke.length > 0) {
      const previewAnn = {
        tool: activeTool,
        type: activeTool,
        points: currentStroke,
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        label: ""
      };
      drawSingleAnnotation(ctx, previewAnn, w, h, true);
    }

    if (needsReRender) {
      requestAnimationFrame(renderAnnotations);
    }
  }

  function drawSingleAnnotation(ctx, ann, w, h, isPreview = false) {
    if (!ann.points || !ann.points.length) return;

    const baseWidth = (ann.strokeWidth || 4) * (w / 480);
    const haloWidth = baseWidth + 4;
    const color = ann.color || "#FFD84D";
    const haloColor = "rgba(11, 16, 20, 0.75)";

    ctx.save();

    if (ann.type === "circle") {
      const circle = smoothCircle(ann.points);
      const cx = circle.cx * w;
      const cy = circle.cy * h;
      const rx = circle.rx * w;
      const ry = circle.ry * h;

      // Halo outline for contrast
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = haloWidth;
      ctx.stroke();

      // Vibrant colored outline
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = baseWidth;
      ctx.stroke();

    } else if (ann.type === "arrow") {
      const pts = ann.points.length > 3 ? catmullRomSpline(ann.points) : ann.points;
      if (pts.length < 2) { ctx.restore(); return; }

      // Shaft
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = haloColor;
      ctx.lineWidth = haloWidth;
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = baseWidth;
      ctx.stroke();

      // Arrowhead tangent
      const tip = pts[pts.length - 1];
      const prev = pts[Math.max(0, pts.length - 3)];
      const dx = (tip.x - prev.x) * w;
      const dy = (tip.y - prev.y) * h;
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(18, baseWidth * 3.5);
      const headAngle = Math.PI / 6.0;

      const lx = tip.x * w + headLen * Math.cos(angle + Math.PI - headAngle);
      const ly = tip.y * h + headLen * Math.sin(angle + Math.PI - headAngle);
      const rx = tip.x * w + headLen * Math.cos(angle + Math.PI + headAngle);
      const ry = tip.y * h + headLen * Math.sin(angle + Math.PI + headAngle);

      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(tip.x * w, tip.y * h);
      ctx.lineTo(rx, ry);

      ctx.strokeStyle = haloColor;
      ctx.lineWidth = haloWidth;
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = baseWidth;
      ctx.stroke();

    } else if (ann.type === "pen") {
      const pts = ann.points.length > 3 ? catmullRomSpline(ann.points) : ann.points;
      if (!pts.length) { ctx.restore(); return; }

      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = haloColor;
      ctx.lineWidth = haloWidth;
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = baseWidth;
      ctx.stroke();

    } else if (ann.type === "label" || ann.type === "text") {
      const pt = ann.points[0];
      const px = pt.x * w;
      const py = pt.y * h;
      const labelText = ann.label || "Target Note";

      // Leader line
      const offsetX = 30;
      const offsetY = -40;
      const bx = Math.max(10, Math.min(w - 180, px + offsetX));
      const by = Math.max(25, Math.min(h - 35, py + offsetY));

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Target pin circle
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Rounded background pill
      ctx.font = "bold 13px 'DM Sans', sans-serif";
      const metrics = ctx.measureText(labelText);
      const boxW = metrics.width + 24;
      const boxH = 28;
      const rx = 14;

      ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.roundRect(bx - 4, by - boxH / 2, boxW, boxH, rx);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, bx + 8, by);
    }

    ctx.restore();
  }

  // --- Phase 7: Mock 3D Wearer Perspective Simulation ---
  function renderSimulatedHeadsetView(ctx, w, h) {
    // 3D Background with horizon and ground grid
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, "#080e14");
    skyGrad.addColorStop(1, "#121d24");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // Horizon with yaw/pitch shift
    const horizonY = h * 0.5 + simPitch * h * 0.8;
    ctx.strokeStyle = "rgba(66, 217, 245, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();

    // Perspective floor lines
    ctx.strokeStyle = "rgba(66, 217, 245, 0.08)";
    for (let x = -w; x <= w * 2; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x - simYaw * 300, h);
      ctx.lineTo(w * 0.5 - simYaw * 50, horizonY);
      ctx.stroke();
    }

    // Unproject & render 3D annotations
    let offScreenLeft = 0;
    let offScreenRight = 0;

    for (const ann of annotations) {
      if (!ann.points || !ann.points.length) continue;
      // Transform normalized points relative to virtual head pose
      const transformedPoints = ann.points.map(pt => {
        // Center offset relative to camera center (0.5, 0.5)
        const relX = pt.x - 0.5;
        const relY = pt.y - 0.5;
        // Apply yaw & pitch rotation in 3D
        const rotX = relX * Math.cos(-simYaw) - (-1.2) * Math.sin(-simYaw);
        const rotZ = relX * Math.sin(-simYaw) + (-1.2) * Math.cos(-simYaw);
        const rotY = relY - simPitch * 0.8;

        // Project back to perspective view
        const fovScale = 0.8 / Math.abs(rotZ);
        const projX = (0.5 + rotX * fovScale);
        const projY = (0.5 + rotY * fovScale);
        return { x: projX, y: projY, z: rotZ };
      });

      // Check if annotation is off-screen
      const centerPt = transformedPoints[Math.floor(transformedPoints.length / 2)];
      if (centerPt.x < 0.05) offScreenLeft++;
      else if (centerPt.x > 0.95) offScreenRight++;

      const simAnn = { ...ann, points: transformedPoints };
      drawSingleAnnotation(ctx, simAnn, w, h);
    }

    // Directional Guidance Indicator (Phase 6 requirement in simulation)
    if (offScreenLeft > 0) {
      drawGuidanceIndicator(ctx, 20, h * 0.5, "< " + offScreenLeft + " Off-screen AR Marker", true);
    }
    if (offScreenRight > 0) {
      drawGuidanceIndicator(ctx, w - 20, h * 0.5, offScreenRight + " Off-screen AR Marker >", false);
    }

    // Simulation Banner
    ctx.save();
    ctx.fillStyle = "rgba(66, 217, 245, 0.15)";
    ctx.strokeStyle = "#42D9F5";
    ctx.lineWidth = 1.5;
    ctx.roundRect(w * 0.5 - 160, h - 42, 320, 30, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#42D9F5";
    ctx.font = "bold 11px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("3D WEARER SIMULATION · DRAG TO ROTATE HEAD", w * 0.5, h - 27);
    ctx.restore();
  }

  function drawGuidanceIndicator(ctx, x, y, text, isLeft) {
    ctx.save();
    ctx.font = "bold 11px 'Space Grotesk', sans-serif";
    const tw = ctx.measureText(text).width + 20;
    const bx = isLeft ? x : x - tw;

    ctx.fillStyle = "rgba(255, 216, 77, 0.22)";
    ctx.strokeStyle = "#FFD84D";
    ctx.lineWidth = 1.5;
    ctx.roundRect(bx, y - 14, tw, 28, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#FFD84D";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 10, y);
    ctx.restore();
  }

  // --- Interaction & Event Listeners (Phase 1) ---
  const annCanvas = $("annotationCanvas");
  if (annCanvas) {
    annCanvas.addEventListener("pointerdown", event => {
      if (!connected || !lastFrameAt) return;
      event.preventDefault();
      annCanvas.setPointerCapture(event.pointerId);

      if (isSimMode) {
        simDragging = true;
        simLastX = event.clientX;
        simLastY = event.clientY;
        return;
      }

      const pt = getNormalizedCoords(event);
      if (!pt) return;

      if (activeTool === "eraser") {
        eraseAtPoint(pt);
        return;
      }

      if (activeTool === "label") {
        labelTargetPoint = pt;
        openModal("annotation", pt);
        return;
      }

      isDrawing = true;
      currentStroke = [pt];
      renderAnnotations();
    });

    annCanvas.addEventListener("pointermove", event => {
      if (isSimMode && simDragging) {
        const dx = event.clientX - simLastX;
        const dy = event.clientY - simLastY;
        simYaw += dx * 0.006;
        simPitch = Math.max(-0.5, Math.min(0.5, simPitch + dy * 0.006));
        simLastX = event.clientX;
        simLastY = event.clientY;
        renderAnnotations();
        return;
      }

      if (!isDrawing) return;
      event.preventDefault();
      const pt = getNormalizedCoords(event);
      if (!pt) return;

      const last = currentStroke[currentStroke.length - 1];
      const distSq = (pt.x - last.x) ** 2 + (pt.y - last.y) ** 2;
      // Configurable point spacing
      if (distSq > 0.00003) {
        currentStroke.push(pt);
        renderAnnotations();
      }
    });

    annCanvas.addEventListener("pointerup", event => {
      if (isSimMode) {
        simDragging = false;
        try { annCanvas.releasePointerCapture(event.pointerId); } catch (_) {}
        return;
      }

      if (!isDrawing) return;
      event.preventDefault();
      isDrawing = false;
      try { annCanvas.releasePointerCapture(event.pointerId); } catch (_) {}

      if (currentStroke.length >= 2) {
        commitCurrentStroke();
      } else {
        currentStroke = [];
        renderAnnotations();
      }
    });

    annCanvas.addEventListener("pointercancel", () => {
      isDrawing = false;
      simDragging = false;
      currentStroke = [];
      renderAnnotations();
    });
  }

  function commitCurrentStroke() {
    const simplified = rdpSimplify(currentStroke, 0.0025);
    const ann = {
      id: "ann_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
      tool: activeTool,
      type: activeTool,
      points: simplified,
      color: activeColor,
      strokeWidth: activeStrokeWidth,
      frameId: newestFrame,
      timestamp: Date.now(),
      committedAt: Date.now(),
      eventType: "commit"
    };

    annotations.push(ann);
    undoStack.push({ type: "add", annotation: ann });
    redoStack = [];
    updateUndoRedoButtons();
    currentStroke = [];
    renderAnnotations();

    send({ action: "annotate", data: ann });
  }

  function eraseAtPoint(pt) {
    let nearestIdx = -1;
    let nearestDist = Infinity;
    const threshold = 0.04; // Normalized distance threshold

    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      if (!ann.points) continue;
      for (let j = 0; j < ann.points.length - 1; j++) {
        const d = distanceToSegment(pt, ann.points[j], ann.points[j + 1]);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
    }

    if (nearestIdx !== -1 && nearestDist <= threshold) {
      const removed = annotations.splice(nearestIdx, 1)[0];
      undoStack.push({ type: "delete", annotation: removed });
      redoStack = [];
      updateUndoRedoButtons();
      renderAnnotations();
      send({ action: "annotate", data: { eventType: "delete", id: removed.id } });
      showToast("Annotation removed.", "info", 2000);
    }
  }

  // --- Toolbar Controls & Listeners ---
  const toolBtns = [
    { id: "toolCircle", tool: "circle" },
    { id: "toolArrow", tool: "arrow" },
    { id: "toolPen", tool: "pen" },
    { id: "toolLabel", tool: "label" },
    { id: "toolEraser", tool: "eraser" }
  ];

  toolBtns.forEach(({ id, tool }) => {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeTool = tool;
      toolBtns.forEach(t => $(t.id)?.classList.toggle("active", t.tool === tool));
    });
  });

  // Palette swatches
  document.querySelectorAll(".color-swatch").forEach(swatch => {
    swatch.addEventListener("click", () => {
      document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
      swatch.classList.add("active");
      activeColor = swatch.getAttribute("data-color");
    });
  });

  // Stroke width buttons
  document.querySelectorAll(".stroke-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".stroke-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeStrokeWidth = parseInt(btn.getAttribute("data-width"), 10) || 4;
    });
  });

  // Undo / Redo
  $("btnUndo")?.addEventListener("click", () => {
    if (!undoStack.length) return;
    const action = undoStack.pop();
    if (action.type === "add") {
      annotations = annotations.filter(a => a.id !== action.annotation.id);
      redoStack.push(action);
      send({ action: "annotate", data: { eventType: "delete", id: action.annotation.id } });
    } else if (action.type === "delete") {
      annotations.push(action.annotation);
      redoStack.push(action);
      send({ action: "annotate", data: action.annotation });
    } else if (action.type === "clear") {
      annotations = [...action.previous];
      redoStack.push(action);
      annotations.forEach(a => send({ action: "annotate", data: a }));
    }
    updateUndoRedoButtons();
    renderAnnotations();
  });

  $("btnRedo")?.addEventListener("click", () => {
    if (!redoStack.length) return;
    const action = redoStack.pop();
    if (action.type === "add") {
      annotations.push(action.annotation);
      undoStack.push(action);
      send({ action: "annotate", data: action.annotation });
    } else if (action.type === "delete") {
      annotations = annotations.filter(a => a.id !== action.annotation.id);
      undoStack.push(action);
      send({ action: "annotate", data: { eventType: "delete", id: action.annotation.id } });
    } else if (action.type === "clear") {
      annotations = [];
      undoStack.push(action);
      send({ action: "clear-annotations" });
    }
    updateUndoRedoButtons();
    renderAnnotations();
  });

  // Clear all with confirmation
  $("btnClearAll")?.addEventListener("click", () => {
    if (annotations.length === 0) return;
    if (confirm("Clear all annotations in the technician’s AR view?")) {
      clearAllAnnotationsInternal(true);
    }
  });

  // 3D Wearer Perspective Simulation Toggle
  $("btnSimPreview")?.addEventListener("click", () => {
    isSimMode = !isSimMode;
    $("btnSimPreview").classList.toggle("active", isSimMode);
    simYaw = 0;
    simPitch = 0;
    renderAnnotations();
    showToast(isSimMode ? "3D Wearer Simulation: Drag mouse to look around." : "Returned to live drawing view.", "info", 3500);
  });

  // Keyboard shortcuts (Phase 1)
  document.addEventListener("keydown", event => {
    if ($("modal") && !$("modal").hidden) return;
    if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;

    if (event.key === "c" || event.key === "C") $("toolCircle")?.click();
    else if (event.key === "a" || event.key === "A") $("toolArrow")?.click();
    else if (event.key === "p" || event.key === "P") $("toolPen")?.click();
    else if (event.key === "l" || event.key === "L") $("toolLabel")?.click();
    else if (event.key === "e" || event.key === "E") $("toolEraser")?.click();
    else if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      event.preventDefault();
      $("btnUndo")?.click();
    } else if ((event.ctrlKey || event.metaKey) && (event.key === "y" || (event.shiftKey && event.key === "Z"))) {
      event.preventDefault();
      $("btnRedo")?.click();
    }
  });
  $('leaveButton').addEventListener('click', () => openModal('leave'));
  $('modalCancel').addEventListener('click', closeModal);
  $('modalX').addEventListener('click', closeModal);
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) closeModal(); });
  $('modalForm').addEventListener('submit', event => {
    event.preventDefault();
    if (modalType === 'annotation') {
      const label = $('modalInput').value.trim().slice(0, 80);
      if (!label) { $('modalInput').focus(); return; }
      const pt = annotationPoint || labelTargetPoint || { x: 0.5, y: 0.5 };
      const ann = {
        id: "ann_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        tool: "label",
        type: "label",
        points: [pt],
        label: label,
        color: activeColor || "#FFD84D",
        strokeWidth: activeStrokeWidth || 4,
        frameId: newestFrame,
        timestamp: Date.now(),
        committedAt: Date.now(),
        eventType: "commit"
      };
      annotations.push(ann);
      undoStack.push({ type: "add", annotation: ann });
      redoStack = [];
      updateUndoRedoButtons();
      renderAnnotations();
      if (send({ action: "annotate", data: ann })) {
        showToast("Label placed in technician’s AR view.", "success");
      } else {
        showToast("Connection lost. Label not placed.", "error");
      }
      closeModal();
    } else if (modalType === 'leave') {
      userLeaving = true;
      reset('You left the session.', 'info');
      document.title = 'RelayView — Remote assistance, in focus';
    }
  });
  document.addEventListener('keydown', event => {
    if ($('modal').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...$('modal').querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(el => !el.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    recognition = new Recognition();
    $('micButton').hidden = false;
    recognition.onresult = event => {
      $('chatInput').value = event.results[0][0].transcript;
      $('chatForm').requestSubmit();
    };
    recognition.onerror = () => showToast('Dictation unavailable. You can type your message.', 'error');
    $('micButton').addEventListener('click', () => {
      try { recognition.start(); } catch { showToast('Dictation is already running.', 'info'); }
    });
  }
  window.addEventListener('beforeunload', () => socket?.close());
})();
