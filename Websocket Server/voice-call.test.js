const { test } = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../Remote ARsistance LS/Assets/Assets/Scripts/VoiceCall');

test('Lens voice call captures PCM and plays received PCM', async () => {
  global.Audio = { PlaybackMode: { LowLatency: 'low-latency' } };
  global.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  global.print = () => {};
  const sent = [];
  const listeners = {};
  let update;
  let outputFrame;
  const microphone = {
    maxFrameSize: 128,
    isOfType: name => name === 'Provider.MicrophoneAudioProvider',
    start() {}, stop() {},
    getAudioFramePCM16(frame) { frame[0] = -32768; frame[1] = 32767; return { x: 2 }; }
  };
  const output = {
    maxFrameSize: 128,
    isOfType: name => name === 'Provider.AudioOutputProvider',
    getPreferredFrameSize: () => 2,
    enqueueAudioFrame(frame) { outputFrame = frame; }
  };
  const player = { play() {}, stop() {} };
  const script = {
    microphoneAudio: { control: microphone },
    audioOutput: { control: output },
    getSceneObject: () => ({ createComponent: () => player }),
    createEvent: () => ({ bind: fn => { update = fn; } })
  };
  const socket = {
    readyState: 1,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    send: packet => sent.push(packet)
  };
  const call = init(script, socket, () => true);
  listeners.message({ data: JSON.stringify({ action: 'call-state', state: 'start' }) });
  assert.equal(call.isCalling(), true);
  update();
  assert.deepEqual(Array.from(sent[0]), [0x41, 0, 128, 255, 127]);
  listeners.message({ data: { bytes: async () => Uint8Array.from([0x41, 0, 128, 255, 127]) } });
  await new Promise(resolve => setImmediate(resolve));
  update();
  assert.equal(outputFrame[0], -1);
  assert.ok(outputFrame[1] > .99);
  listeners.message({ data: JSON.stringify({ action: 'call-state', state: 'stop' }) });
  assert.equal(call.isCalling(), false);
});

test('Lens voice call detects mic stall and triggers stall callback', async () => {
  let stalled = false;
  const sent = [];
  const listeners = {};
  let update;
  const microphone = {
    maxFrameSize: 128,
    isOfType: name => name === 'Provider.MicrophoneAudioProvider',
    start() {}, stop() {},
    getAudioFramePCM16: () => ({ x: 0 })
  };
  const output = {
    maxFrameSize: 128,
    isOfType: name => name === 'Provider.AudioOutputProvider',
    getPreferredFrameSize: () => 0
  };
  const script = {
    microphoneAudio: { control: microphone },
    audioOutput: { control: output },
    getSceneObject: () => ({ createComponent: () => ({ play() {}, stop() {} }) }),
    createEvent: () => ({ bind: fn => { update = fn; } })
  };
  const socket = {
    readyState: 1,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    send: packet => sent.push(packet)
  };
  init(script, socket, () => true, null, null, () => { stalled = true; });
  listeners.message({ data: JSON.stringify({ action: 'call-state', state: 'start' }) });
  for (let i = 0; i < 305; i++) {
    update();
  }
  assert.equal(stalled, true);
  const statusMsg = sent.find(s => typeof s === 'string' && s.includes('mic-status'));
  assert.ok(statusMsg, 'mic-status notification should be sent to peer');
  assert.ok(statusMsg.includes('waiting'));
});
