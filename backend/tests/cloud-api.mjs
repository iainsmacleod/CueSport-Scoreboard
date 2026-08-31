#!/usr/bin/env node
/**
 * CueSport Cloud API + WebSocket smoke tests (headless).
 * Usage: node tests/cloud-api.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000
 */
import WebSocket from 'ws';

const BASE = (process.argv[2] || process.env.CLOUD_TEST_URL || 'http://localhost:3000').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');

let passed = 0;
let failed = 0;

function assert(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function wsJoin({ roomId, client, accessToken, apiKey, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket join timeout'));
    }, timeoutMs);

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('open', () => {
      const msg = { type: 'join', room_id: roomId, client };
      if (accessToken) msg.access_token = accessToken;
      if (apiKey) msg.api_key = apiKey;
      ws.send(JSON.stringify(msg));
    });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (data.type === 'joined') {
        clearTimeout(timer);
        resolve({ ws, data });
      } else if (data.type === 'error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(data.message || data.code || 'join error'));
      }
    });
  });
}

function wsOnce(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function run() {
  console.log(`CueSport Cloud API tests → ${BASE}\n`);

  // Health & static assets
  const health = await fetchJson('/health');
  assert('GET /health ok', health.ok && health.body.ok === true);

  const css = await fetch(`${BASE}/web/shared/styles.css`);
  assert('GET /web/shared/styles.css', css.ok);

  const ballImg = await fetch(`${BASE}/images/balls/8ball_small.png`);
  assert('GET /images/balls/8ball_small.png', ballImg.ok);

  const undoImg = await fetch(`${BASE}/images/balls/undo-small.png`);
  assert('GET /images/balls/undo-small.png', undoImg.ok);

  const dashJs = await fetch(`${BASE}/web/dashboard/app.js`);
  assert('GET /web/dashboard/app.js', dashJs.ok);

  const dashHtml = await fetch(`${BASE}/dashboard`);
  assert('GET /dashboard HTML', dashHtml.ok);

  const config = await fetchJson('/api/config/public');
  assert('GET /api/config/public', config.ok && config.body.allowDevAuth !== undefined);

  // Dev auth
  const email = `smoke-${Date.now()}@cuesport.test`;
  const login = await fetchJson('/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert('POST /api/auth/dev-login', login.ok);
  assert('Dev token prefix dev:', login.body.access_token?.startsWith('dev:'));
  assert('Dev login returns room', !!login.body.room?.id);

  const token = login.body.access_token;
  const roomId = login.body.room.id;

  const me = await fetchJson('/api/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert('GET /api/me with dev token', me.ok && me.body.account?.email === email);

  // Create API key
  const keyRes = await fetchJson('/api/api-keys', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ label: 'smoke-test' }),
  });
  assert('POST /api/api-keys', keyRes.ok && keyRes.body.key?.length === 32);
  const apiKey = keyRes.body.key;

  // WebSocket: mobile dev token (regression for payload.sub crash)
  let mobileJoin;
  try {
    mobileJoin = await wsJoin({ roomId, client: 'mobile', accessToken: token });
    assert('WS join mobile + dev token', mobileJoin.data.room_id === roomId);
    mobileJoin.ws.close();
  } catch (e) {
    assert('WS join mobile + dev token', false, e.message);
  }

  // WebSocket: dock api key
  let dockJoin;
  try {
    dockJoin = await wsJoin({ roomId, client: 'dock', apiKey });
    assert('WS join dock + api_key', dockJoin.data.room_id === roomId);
  } catch (e) {
    assert('WS join dock + api_key', false, e.message);
  }

  // Command relay dock → mobile
  if (dockJoin) {
    try {
      const mobile2 = await wsJoin({ roomId, client: 'mobile', accessToken: token });
      const cmdPromise = wsOnce(mobile2.ws);
      dockJoin.ws.send(JSON.stringify({
        type: 'command',
        room_id: roomId,
        action: 'score_add',
        payload: { player: '1' },
        source: 'dock',
      }));
      const received = await cmdPromise;
      assert('Command relay dock → mobile', received.type === 'command' && received.action === 'score_add');
      mobile2.ws.close();
      dockJoin.ws.close();
    } catch (e) {
      assert('Command relay dock → mobile', false, e.message);
      dockJoin.ws.close();
    }
  }

  // Invalid dev token rejected gracefully (no 500)
  try {
    await wsJoin({ roomId, client: 'mobile', accessToken: 'dev:' });
    assert('Empty dev token rejected', false, 'should have failed');
  } catch (e) {
    assert('Empty dev token rejected', /invalid|token|access/i.test(e.message), e.message);
  }

  // Wrong room forbidden
  try {
    await wsJoin({
      roomId: '00000000-0000-0000-0000-000000000000',
      client: 'mobile',
      accessToken: token,
    });
    assert('Wrong room rejected', false, 'should have failed');
  } catch (e) {
    assert('Wrong room rejected', /room|forbidden|not found/i.test(e.message), e.message);
  }

  // Session + state persistence
  const dock2 = await wsJoin({ roomId, client: 'dock', apiKey }).catch(() => null);
  if (dock2) {
    dock2.ws.send(JSON.stringify({
      type: 'session',
      room_id: roomId,
      action: 'start',
      payload: { gameType: 'game1', player1: 'A', player2: 'B' },
    }));
    dock2.ws.send(JSON.stringify({
      type: 'state',
      room_id: roomId,
      state: { player1Name: 'A', player2Name: 'B', p1Score: 1, p2Score: 0, gameType: 'game1' },
    }));
    await sleep(200);
    const events = await fetchJson(`/api/rooms/${roomId}/events?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert('Events persisted', events.ok && Array.isArray(events.body) && events.body.length > 0);
    dock2.ws.close();
  } else {
    assert('Events persisted', false, 'dock join failed');
  }

  const streams = await fetchJson('/api/streams');
  assert('GET /api/streams', streams.ok && Array.isArray(streams.body));

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
