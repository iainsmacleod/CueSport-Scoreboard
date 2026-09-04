#!/usr/bin/env node
/**
 * CueSport Cloud API + WebSocket smoke tests (headless).
 * Usage: node tests/cloud-api.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

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

function waitForWsErrorThenClose(ws, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('kick timeout')), timeoutMs);
    let err = null;
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'error') err = data;
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      resolve(err || { code: 'closed' });
    });
  });
}

function wsJoin({ roomId, client, accessToken, apiKey, guestToken, timeoutMs = 8000 }) {
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
      const msg = { type: 'join', client };
      if (guestToken) {
        msg.guest_token = guestToken;
        msg.client = 'mobile_guest';
      } else if (roomId) {
        msg.room_id = roomId;
      }
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
  if (health.body.ballImages === false) {
    console.warn('  WARN  ballImages:false on /health — rebuild Docker image with common/images');
  }

  const css = await fetch(`${BASE}/web/shared/styles.css`);
  assert('GET /web/shared/styles.css', css.ok);

  const ballImg = await fetch(`${BASE}/web/images/balls/8ball_small.png`);
  assert('GET /web/images/balls/8ball_small.png', ballImg.ok);

  const ballImgLegacy = await fetch(`${BASE}/images/balls/8ball_small.png`);
  assert('GET /images/balls/8ball_small.png', ballImgLegacy.ok);

  const undoImg = await fetch(`${BASE}/web/images/balls/undo-small.png`);
  assert('GET /web/images/balls/undo-small.png', undoImg.ok);

  const dashJs = await fetch(`${BASE}/web/dashboard/app.js`);
  assert('GET /web/dashboard/app.js', dashJs.ok);

  const dashHtml = await fetch(`${BASE}/dashboard`);
  assert('GET /dashboard HTML', dashHtml.ok);

  const config = await fetchJson('/api/config/public');
  assert('GET /api/config/public', config.ok && config.body.allowDevAuth !== undefined);

  // Dev auth
  const devSecret = process.env.DEV_AUTH_SECRET || '';
  if (!devSecret) {
    console.warn('  SKIP  dev auth tests — set DEV_AUTH_SECRET in backend/.env');
  } else {
    const login = await fetchJson('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: devSecret }),
    });
    assert('POST /api/auth/dev-login', login.ok);
    assert('Dev token prefix dev:', login.body.access_token?.startsWith('dev:'));
    assert('Dev login returns room', !!login.body.room?.id);

    const badLogin = await fetchJson('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'definitely-wrong-secret' }),
    });
    assert('Invalid dev secret returns 401', badLogin.status === 401);
    assert('Invalid dev secret error message', badLogin.body.error === 'Invalid dev auth secret');

    const token = login.body.access_token;
    const roomId = login.body.room.id;
    const devAccountEmail = process.env.DEV_AUTH_ACCOUNT_EMAIL || 'dev@local';

    const me = await fetchJson('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert('GET /api/me with dev token', me.ok && me.body.account?.email === devAccountEmail);
    assert('GET /api/me includes quota', !!me.body.quota?.limits?.maxApiKeys);

    // Create API key (or use existing from prior runs / auto-created on first login)
    let apiKey = null;
    const keyRes = await fetchJson('/api/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'smoke-test' }),
    });
    if (keyRes.ok) {
      assert('POST /api/api-keys', keyRes.body.key?.length === 32);
      apiKey = keyRes.body.key;
      const viewRes = await fetchJson(`/api/api-keys/${keyRes.body.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert('GET /api/api-keys/:keyId', viewRes.ok && viewRes.body.key === apiKey);
    } else {
      assert('POST /api/api-keys at limit or ok', keyRes.status === 403 && keyRes.body.code === 'api_key_limit');
      // Need a key for dock tests — create by revoking one first
      const keys = me.body.api_keys || [];
      if (keys[0]) {
        await fetchJson(`/api/api-keys/${keys[0].id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const retry = await fetchJson('/api/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ label: 'smoke-test-retry' }),
        });
        assert('POST /api/api-keys after revoke', retry.ok && retry.body.key?.length === 32);
        apiKey = retry.body.key;
      } else {
        assert('Have API key for dock tests', false, 'no keys and create failed');
      }
    }

    // Revoke + recreate cycle
    const me2 = await fetchJson('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const smokeKey = (me2.body.api_keys || []).find((k) => k.label === 'smoke-test' || k.label === 'smoke-test-retry');
    if (smokeKey) {
      const revoked = await fetchJson(`/api/api-keys/${smokeKey.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert('DELETE /api/api-keys', revoked.ok);
      const recreate = await fetchJson('/api/api-keys', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'smoke-test-2' }),
      });
      assert('Recreate API key after revoke', recreate.ok && recreate.body.key?.length === 32);
      apiKey = recreate.body.key;
    }

    // Invalidate sessions — old token dies, fresh token works
    const invalidated = await fetchJson('/api/sessions/invalidate-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert('POST /api/sessions/invalidate-all', invalidated.ok);
    assert('Sign Out Everywhere does not keep this session', !invalidated.body.access_token);
    const staleMe = await fetchJson('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    assert('Old token rejected after invalidate', staleMe.status === 401);
    const relogin = await fetchJson('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: devSecret }),
    });
    let tokenFresh = relogin.body.access_token;
    const meFresh = await fetchJson('/api/me', { headers: { Authorization: `Bearer ${tokenFresh}` } });
    assert('Fresh login works after invalidate', meFresh.ok);

    // Live admin mobile is disconnected (not just token-invalidated)
    try {
      const mobileLive = await wsJoin({ roomId, client: 'mobile', accessToken: tokenFresh });
      assert('WS join mobile + dev token', mobileLive.data.room_id === roomId);
      const kickedP = waitForWsErrorThenClose(mobileLive.ws);
      const kickInv = await fetchJson('/api/sessions/invalidate-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert('Sign Out Everywhere ok', kickInv.ok && !kickInv.body.access_token);
      const kicked = await kickedP;
      assert('Sign Out Everywhere disconnects mobile WS', kicked.code === 'session_revoked');
      const relogin2 = await fetchJson('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: devSecret }),
      });
      tokenFresh = relogin2.body.access_token;
    } catch (e) {
      assert('WS join mobile + disconnect on Sign Out Everywhere', false, e.message);
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
        const mobile2 = await wsJoin({ roomId, client: 'mobile', accessToken: tokenFresh });
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
        accessToken: tokenFresh,
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
      dock2.ws.send(JSON.stringify({
        type: 'session',
        room_id: roomId,
        action: 'end',
        payload: { matchId: 'smoke-match', winnerSlot: '1', scores: { p1: 5, p2: 2 }, reason: 'race_complete' },
      }));
      await sleep(200);
      const events = await fetchJson(`/api/rooms/${roomId}/events?limit=5`, {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert('Events persisted', events.ok && Array.isArray(events.body) && events.body.length > 0);

      const statsUnauth = await fetchJson('/api/stats');
      assert('GET /api/stats unauthorized', statsUnauth.status === 401);
      const stats = await fetchJson('/api/stats', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert('GET /api/stats', stats.ok && Array.isArray(stats.body.players) && Array.isArray(stats.body.matches));
      const editable = (stats.body.matches || []).find((m) => m.startEventId && m.status === 'completed');
      if (editable) {
        const patched = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'Alice',
            player2Name: 'Bob',
            gameType: 'game1',
            scores: { p1: 3, p2: 7 },
          }),
        });
        assert('PATCH /api/stats/matches/:id', patched.ok && patched.body.ok === true);
        const patchedWithExtras = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'Alice',
            player2Name: 'Bob',
            gameType: 'game1',
            scores: { p1: 3, p2: 7 },
            breakAndRunsP1: 1,
            breakAndRunsP2: 0,
            tableRunsP1: 0,
            tableRunsP2: 2,
            ballsP1: 12,
            ballsP2: 18,
          }),
        });
        assert('PATCH match extras', patchedWithExtras.ok && patchedWithExtras.body.ok === true);
        const statsAfterExtras = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const updatedMatch = (statsAfterExtras.body.matches || []).find((m) => m.startEventId === editable.startEventId);
        assert(
          'Stats include B&R / TR / balls',
          !!updatedMatch &&
            updatedMatch.breakAndRunsP1 === 1 &&
            updatedMatch.tableRunsP2 === 2 &&
            updatedMatch.ballsP2 === 18
        );
        assert(
          'Winner derived from scores',
          !!updatedMatch && updatedMatch.winnerSlot === '2'
        );

        const snookerExtras = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'Alice',
            player2Name: 'Bob',
            gameType: 'game8',
            scores: { p1: 3, p2: 2 },
            highestBreakP1: 42,
            highestBreakP2: 28,
            foulsP1: 4,
            foulsP2: 1,
            ballsP1: 20,
            ballsP2: 15,
          }),
        });
        assert('PATCH snooker foul extras', snookerExtras.ok && snookerExtras.body.ok === true);
        const statsAfterSnooker = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const snookerMatch = (statsAfterSnooker.body.matches || []).find((m) => m.startEventId === editable.startEventId);
        assert(
          'Stats include snooker fouls',
          !!snookerMatch &&
            snookerMatch.gameType === 'game8' &&
            snookerMatch.foulsP1 === 4 &&
            snookerMatch.foulsP2 === 1 &&
            snookerMatch.highestBreakP1 === 42
        );
        const alicePlayer = (statsAfterSnooker.body.players || []).find((p) => p.name === 'Alice');
        assert(
          'Player rollup includes fouls',
          !!alicePlayer && alicePlayer.fouls === 4,
          alicePlayer ? String(alicePlayer.fouls) : 'missing'
        );
        const renamed = await fetchJson('/api/stats/players', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: 'Alice', to: 'Alicia' }),
        });
        assert('PATCH /api/stats/players', renamed.ok && renamed.body.updated >= 1);
        const deleted = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert('DELETE /api/stats/matches/:id', deleted.ok && deleted.body.ok === true);
      } else {
        assert('PATCH /api/stats/matches/:id', false, 'no completed match to edit');
      }
      dock2.ws.close();
    } else {
      assert('Events persisted', false, 'dock join failed');
    }

    const guestLink = await fetchJson(`/api/rooms/${roomId}/guest-link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenFresh}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'smoke-guest' }),
    });
    assert('POST /api/rooms/:roomId/guest-link', guestLink.ok && !!guestLink.body.token);
    if (guestLink.ok && guestLink.body.token) {
      try {
        const guestWs = await wsJoin({ guestToken: guestLink.body.token });
        assert('WS join guest token', guestWs.data.client === 'mobile_guest');
        const guestKickedP = waitForWsErrorThenClose(guestWs.ws);
        const revAll = await fetchJson('/api/guest-links/revoke-all', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert('POST /api/guest-links/revoke-all', revAll.ok && Number(revAll.body.revoked) >= 1);
        const guestKicked = await guestKickedP;
        assert('Revoke All Guest Sessions disconnects guests', guestKicked.code === 'guest_revoked');
      } catch (e) {
        assert('Guest WS disconnect on revoke-all', false, e.message);
      }
    }
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
