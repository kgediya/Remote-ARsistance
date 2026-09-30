class RemoteCall {
  constructor(socket, onState, onStall) {
    this.socket = socket;
    this.onState = onState;
    this.onStall = onStall;
    this.active = false;
    this.muted = false;
    this.nextPlayback = 0;
    this.context = null;
    this.stream = null;
    this.capture = null;
    this.receivedPackets = 0;
    this.stallTimer = null;
  }
  async start() {
    if (this.active) return;
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      throw new Error('Voice calling requires a secure HTTPS connection or localhost.');
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      throw new Error('Microphone or AudioWorklet is not supported in this browser.');
    }
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    } catch (e) {
      throw new Error('Could not initialize audio system: ' + (e.message || e));
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
    } catch (err) {
      this.stop(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission denied. Allow microphone access in your browser to speak.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('No microphone found on your device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw new Error('Microphone is busy or already in use by another application.');
      }
      throw new Error('Could not access microphone: ' + (err.message || err.name));
    }

    try {
      await this.context.audioWorklet.addModule('/call-capture-worklet.js');
      const source = this.context.createMediaStreamSource(this.stream);
      this.capture = new AudioWorkletNode(this.context, 'pcm-capture');
      const silent = this.context.createGain();
      silent.gain.value = 0;
      source.connect(this.capture);
      this.capture.connect(silent).connect(this.context.destination);
      this.capture.port.onmessage = event => {
        if (this.active && this.socket?.readyState === WebSocket.OPEN &&
            this.socket.bufferedAmount < 32768) {
          try { this.socket.send(event.data); } catch { /* ignore drop */ }
        }
      };
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      if (this.socket.readyState !== WebSocket.OPEN) {
        throw new Error('Session disconnected before call connected.');
      }
      this.active = true;
      this.receivedPackets = 0;
      this.socket.send(JSON.stringify({ action: 'call-state', state: 'start' }));
      this.onState('Call connected');

      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        if (this.active && this.receivedPackets === 0) {
          if (this.onStall) this.onStall();
        }
      }, 7500);
    } catch (error) {
      this.stop(false);
      throw error;
    }
  }
  stop(notify = true) {
    clearTimeout(this.stallTimer);
    this.stallTimer = null;
    this.receivedPackets = 0;
    if (notify && this.active && this.socket?.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify({ action: 'call-state', state: 'stop' })); } catch { /* ignore */ }
    }
    const wasActive = this.active;
    this.active = false;
    this.muted = false;
    try { this.capture?.disconnect(); } catch { /* ignore */ }
    try { this.stream?.getTracks().forEach(track => track.stop()); } catch { /* ignore */ }
    try { this.context?.close(); } catch { /* ignore */ }
    this.capture = null;
    this.stream = null;
    this.context = null;
    this.nextPlayback = 0;
    if (wasActive) {
      this.onState('Call ended');
    }
  }
  toggleMute() {
    if (!this.active || !this.stream) return false;
    this.muted = !this.muted;
    for (const track of this.stream.getAudioTracks()) track.enabled = !this.muted;
    return this.muted;
  }
  play(packet) {
    if (!this.active || !this.context || packet.byteLength < 3 ||
        packet.byteLength > 65536 || packet.byteLength % 2 !== 1) return;
    try {
      if (this.context.state === 'suspended') {
        this.context.resume();
      }
      const view = new DataView(packet);
      if (view.getUint8(0) !== 0x41) return;
      this.receivedPackets = (this.receivedPackets || 0) + 1;
      if (this.stallTimer && this.receivedPackets >= 1) {
        clearTimeout(this.stallTimer);
        this.stallTimer = null;
      }
      if (!this._loggedReceive) {
        this._loggedReceive = true;
        console.log('[RelayView][call] receiving audio packets from Spectacles (' + packet.byteLength + 'B)');
      }
      const count = (packet.byteLength - 1) / 2;
      const buffer = this.context.createBuffer(1, count, 16000);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(1 + i * 2, true) / 32768;
      const now = this.context.currentTime;
      if (this.nextPlayback < now || this.nextPlayback > now + .25) this.nextPlayback = now + .04;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start(this.nextPlayback);
      this.nextPlayback += buffer.duration;
    } catch {
      /* Drop corrupted packet gracefully */
    }
  }
}
window.RemoteCall = RemoteCall;
