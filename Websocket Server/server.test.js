const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('./server');

function next(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), 2000);
    ws.once('message', data => { clearTimeout(timer); resolve(data.toString()); });
  });
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('session pairing, role checks, chat, annotation and frame routing', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'ws://127.0.0.1:' + server.address().port;
  const clients = [];
  try {
    const specs = await connect(url); clients.push(specs);
    specs.send(JSON.stringify({ action: 'create-session' }));
    const created = JSON.parse(await next(specs));
    assert.match(created.sessionCode, /^[A-HJ-NP-Z2-9]{6}$/);

    const web = await connect(url); clients.push(web);
    web.send(JSON.stringify({ action: 'join-session', role: 'web', sessionCode: created.sessionCode.slice(0, 3) + '-' + created.sessionCode.slice(3) }));
    assert.equal(JSON.parse(await next(web)).status, 'joined');
    assert.equal(JSON.parse(await next(specs)).status, 'joined');

    web.send(JSON.stringify({ action: 'chat', data: { message: 'Check the valve' } }));
    assert.equal(JSON.parse(await next(specs)).data.message, 'Check the valve');
    assert.equal(JSON.parse(await next(web)).from, 'web');

    web.send(JSON.stringify({ action: 'annotate', data: { type: 'text', label: 'Valve', x: .5, y: .4 } }));
    assert.equal(JSON.parse(await next(specs)).data.label, 'Valve');

    const frame = 'A'.repeat(120) + '|||FRAME_END|||';
    specs.send(frame);
    assert.equal(await next(web), frame);
    const pong = next(web);
    web.send(JSON.stringify({ action: 'ping', sentAt: 123.5 }));
    assert.equal(JSON.parse(await pong).sentAt, 123.5);

    const specsCall = next(specs);
    const webCall = next(web);
    web.send(JSON.stringify({ action: 'call-state', state: 'start' }));
    assert.equal(JSON.parse(await specsCall).state, 'start');
    assert.equal(JSON.parse(await webCall).state, 'start');
    const voice = Buffer.from([0x41, 0, 0, 255, 127]);
    const webVoice = new Promise(resolve => web.once('message', data => resolve(data)));
    specs.send(voice);
    assert.deepEqual(await webVoice, voice);
    const specsVoice = new Promise(resolve => specs.once('message', data => resolve(data)));
    web.send(voice);
    assert.deepEqual(await specsVoice, voice);
    const specsStop = next(specs);
    const webStop = next(web);
    web.send(JSON.stringify({ action: 'call-state', state: 'stop' }));
    assert.equal(JSON.parse(await specsStop).state, 'stop');
    assert.equal(JSON.parse(await webStop).state, 'stop');

    const intruder = await connect(url); clients.push(intruder);
    intruder.send(JSON.stringify({ action: 'join-session', role: 'specs', sessionCode: created.sessionCode }));
    assert.equal(JSON.parse(await next(intruder)).error, 'Invalid session code');
    intruder.send(JSON.stringify({ action: 'chat', data: { message: 'spoof' } }));
    assert.equal(JSON.parse(await next(intruder)).error, 'No active peer');

    web.close();
    assert.equal(JSON.parse(await next(specs)).status, 'peer-left');
  } finally {
    for (const ws of clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});

test('health endpoint responds', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('voice call is automatically stopped if peer drops during active call', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'ws://127.0.0.1:' + server.address().port;
  const clients = [];
  try {
    const specs = await connect(url); clients.push(specs);
    specs.send(JSON.stringify({ action: 'create-session' }));
    const created = JSON.parse(await next(specs));

    const web = await connect(url); clients.push(web);
    web.send(JSON.stringify({ action: 'join-session', role: 'web', sessionCode: created.sessionCode }));
    await next(web);
    await next(specs);

    web.send(JSON.stringify({ action: 'call-state', state: 'start' }));
    await next(specs);
    await next(web);

    const webMessages = [];
    const messagePromise = new Promise(resolve => {
      const handler = data => {
        webMessages.push(JSON.parse(data.toString()));
        if (webMessages.length === 2) {
          web.off('message', handler);
          resolve(webMessages);
        }
      };
      web.on('message', handler);
    });

    // Specs closes unexpectedly while call is active
    specs.close();

    const [stopMsg, peerLeftMsg] = await messagePromise;
    assert.equal(stopMsg.action, 'call-state');
    assert.equal(stopMsg.state, 'stop');
    assert.equal(stopMsg.reason, 'peer-disconnected');
    assert.equal(peerLeftMsg.status, 'peer-left');
  } finally {
    for (const ws of clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});

test('server relays mic-status notification from specs to web client', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'ws://127.0.0.1:' + server.address().port;
  const clients = [];
  try {
    const specs = await connect(url); clients.push(specs);
    specs.send(JSON.stringify({ action: 'create-session' }));
    const created = JSON.parse(await next(specs));

    const web = await connect(url); clients.push(web);
    web.send(JSON.stringify({ action: 'join-session', role: 'web', sessionCode: created.sessionCode }));
    await next(web);
    await next(specs);

    specs.send(JSON.stringify({ action: 'mic-status', status: 'waiting', message: 'Mic silent' }));
    const received = JSON.parse(await next(web));
    assert.equal(received.action, 'mic-status');
    assert.equal(received.status, 'waiting');
    assert.equal(received.message, 'Mic silent');
  } finally {
    for (const ws of clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});
