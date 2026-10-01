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
    $('videoPlaceholder').hidden = false;
    $('feedWarning').hidden = true;
    $('latency').textContent = 'Measuring connection…';
    if (full) {
      $('chatLog').replaceChildren($('chatEmpty'));
      $('chatEmpty').hidden = false;
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
    if (canvas.hidden || !canvas.width || !canvas.height) return;
    const stage = $('videoStage');
    const scale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    canvas.style.width = Math.floor(canvas.width * scale) + 'px';
    canvas.style.height = Math.floor(canvas.height * scale) + 'px';
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

    if (raw.startsWith('IN') || raw.startsWith('US')) {
      raw = raw.slice(0, 8);
      if (raw.startsWith('IN')) detectedRegion = REGION_GATEWAYS.IN;
      if (raw.startsWith('US')) detectedRegion = REGION_GATEWAYS.US;
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
        $('regionHintText').textContent = '⚡ Low-latency route: ' + detectedRegion.name;
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

    if (clean.startsWith('IN') && clean.length > 2) {
      targetHost = REGION_GATEWAYS.IN.host;
      selectedRegion = REGION_GATEWAYS.IN;
    } else if (clean.startsWith('US') && clean.length > 2) {
      targetHost = REGION_GATEWAYS.US.host;
      selectedRegion = REGION_GATEWAYS.US;
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
      showToast("Technician's audio is silent. Check Spectacles or ask technician to restart device if issue persists.", 'warning', 8500);
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
        showToast(msg.message || "Technician's mic is silent. If issue persists, please have technician restart Spectacles.", 'warning', 8500);
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

    ws.onclose = () => {
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
        reset('Unable to join this session.', 'error');
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
      showToast('Enter the session code (e.g. IN-XXX-XXX or XXX-XXX) shown on Spectacles.', 'error');
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
  $('liveCanvas').addEventListener('click', event => {
    if (!connected || !lastFrameAt) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) openModal('annotation', { x, y });
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
      if (send({ action: 'annotate', data: { type: 'text', label, ...annotationPoint } })) showToast('Note placed in the technician’s view.', 'success');
      else showToast('Connection lost. Note not placed.', 'error');
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
