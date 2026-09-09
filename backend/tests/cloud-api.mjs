#!/usr/bin/env node
/**
 * CueSport Cloud API + WebSocket smoke tests (headless).
 * Usage: node tests/cloud-api.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { pairSessionEvents } from '../src/stats/account-stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BASE = (process.argv[2] || process.env.CLOUD_TEST_URL || 'http://localhost:3000').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const SQLITE_PATH = process.env.SQLITE_PATH
  || path.join(__dirname, '..', 'data', 'cuesport.db');

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

function wsJoin({ roomId, client, accessToken, apiKey, guestToken, timeoutMs = 8000, instanceId }) {
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
      if (instanceId) msg.instance_id = instanceId;
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
        reject(Object.assign(new Error(data.message || data.code || 'join error'), { code: data.code }));
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

  // Unit: pairSessionEvents must clear unmatched stacks using the start's room_id
  // (end.room_id can differ after room delete / remap).
  {
    const events = [
      // Newest first (as returned by getAccountSessionEvents)
      {
        id: 'end-orphan',
        room_id: 'room-a',
        event_type: 'session:end',
        session_id: null,
        payload: { scores: { p1: 2, p2: 1 }, winnerSlot: '1' },
      },
      {
        id: 'end-s2-cross-room',
        room_id: null, // room deleted / remapped on the end row
        event_type: 'session:end',
        session_id: 's2',
        payload: { matchId: 's2', scores: { p1: 0, p2: 1 }, winnerSlot: '2' },
      },
      {
        id: 'start-s2',
        room_id: 'room-a',
        event_type: 'session:start',
        session_id: 's2',
        payload: { sessionId: 's2', player1: 'A', player2: 'B' },
      },
      {
        id: 'start-s1',
        room_id: 'room-a',
        event_type: 'session:start',
        session_id: 's1',
        payload: { sessionId: 's1', player1: 'A', player2: 'B' },
      },
    ];
    const pairs = pairSessionEvents(events);
    const s1 = pairs.find((p) => p.start?.id === 'start-s1');
    const s2 = pairs.find((p) => p.start?.id === 'start-s2');
    assert(
      'pairSessionEvents: keyed end pairs when end.room_id differs',
      !!s2?.end && s2.end.id === 'end-s2-cross-room'
    );
    assert(
      'pairSessionEvents: LIFO end pairs remaining start (not already-ended orphan)',
      !!s1?.end && s1.end.id === 'end-orphan',
      s1?.end ? `got end ${s1.end.id}` : 's1 has no end'
    );
    assert(
      'pairSessionEvents: cross-room end does not steal later LIFO end',
      s2.end?.id === 'end-s2-cross-room',
      s2.end ? `s2 end overwritten to ${s2.end.id}` : 'missing'
    );
  }

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
  const devAccountEmail = (process.env.DEV_AUTH_ACCOUNT_EMAIL || '').trim();
  if (!devSecret || !devAccountEmail) {
    console.warn('  SKIP  dev auth tests — set DEV_AUTH_SECRET and DEV_AUTH_ACCOUNT_EMAIL in backend/.env');
  } else {
    const login = await fetchJson('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: devSecret }),
    });
    assert('POST /api/auth/dev-login', login.ok);
    assert('Dev token prefix dev:', login.body.access_token?.startsWith('dev:'));
    // Rooms are created on dock connect — login may return null room.
    assert('Dev login room optional', login.body.room == null || !!login.body.room?.id);
    assert(
      'Dev login returns api_key plaintext',
      typeof login.body.api_key === 'string' && login.body.api_key.length > 0,
      String(login.body.api_key)
    );

    const badLogin = await fetchJson('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'definitely-wrong-secret' }),
    });
    assert('Invalid dev secret returns 401', badLogin.status === 401);
    assert('Invalid dev secret error message', badLogin.body.error === 'Invalid dev auth secret');

    let token = login.body.access_token;
    let roomId = login.body.room?.id || null;

    const me = await fetchJson('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert('GET /api/me with dev token', me.ok && me.body.account?.email === devAccountEmail);
    assert('GET /api/me includes quota', !!me.body.quota?.limits?.maxApiKeys);
    assert('GET /api/me includes room_cleanup config', !!me.body.room_cleanup?.grace_ms);
    const accountId = me.body.account?.id;

    // Free seats/rooms from prior smoke runs so this account is under tier caps.
    for (const room of me.body.rooms || []) {
      await fetchJson(`/api/rooms/${room.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    for (const k of me.body.api_keys || []) {
      await fetchJson(`/api/api-keys/${k.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    roomId = null;

    const postRoomsGone = await fetchJson('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'should-fail' }),
    });
    assert('POST /api/rooms disabled (410)', postRoomsGone.status === 410);

    // Create API key (or use existing from prior runs / auto-created on first login)
    let apiKey = null;
    let apiKeyId = null;
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
      apiKeyId = keyRes.body.id;
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
        apiKeyId = retry.body.id;
      } else {
        assert('Have API key for dock tests', false, 'no keys and create failed');
      }
    }

    // Dock without key rejected; dock with key creates room
    const smokeInstance = `smoke-${Date.now()}`;
    try {
      await wsJoin({ client: 'dock', accessToken: token, instanceId: 'smoke-no-key' });
      assert('Dock join without api_key rejected', false, 'should have failed');
    } catch (e) {
      assert(
        'Dock join without api_key rejected',
        e.code === 'dock_key_required' || /dock key/i.test(e.message),
        e.message
      );
    }
    if (apiKey) {
      try {
        const boot = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
        roomId = boot.data.room_id;
        assert('Dock join creates room', !!roomId);
        boot.ws.close();
        await sleep(150);
      } catch (e) {
        assert('Dock join creates room', false, e.message);
      }
    }

    // Regenerate the key currently in use (kick live dock), keep seat label
    if (apiKeyId && apiKey && roomId) {
      let dockToKick = null;
      let labelBefore = null;
      try {
        const meKeys = await fetchJson('/api/me', { headers: { Authorization: `Bearer ${token}` } });
        labelBefore = (meKeys.body.api_keys || []).find((k) => k.id === apiKeyId)?.label || null;
        dockToKick = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
        const dockKeyId = dockToKick.data.api_key_id || apiKeyId;
        assert('Dock join reports api_key_id', !!dockToKick.data.api_key_id, JSON.stringify(dockToKick.data));
        const kickedP = waitForWsErrorThenClose(dockToKick.ws);
        const regenerated = await fetchJson(`/api/api-keys/${dockKeyId}/regenerate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        assert('POST /api/api-keys/:id/regenerate', regenerated.ok && regenerated.body.key?.length === 32);
        assert('Regenerate keeps seat label', !labelBefore || regenerated.body.label === labelBefore, regenerated.body.label);
        assert('Regenerate reports kicked', (regenerated.body.kicked || 0) >= 1, `kicked=${regenerated.body.kicked}`);
        const kicked = await kickedP;
        assert('Regenerate kicks dock with api_key_revoked', kicked.code === 'api_key_revoked');
        apiKey = regenerated.body.key;
        apiKeyId = regenerated.body.id;
      } catch (e) {
        assert('Regenerate kicks dock with api_key_revoked', false, e.message);
        if (dockToKick) try { dockToKick.ws.close(); } catch (_) { /* ignore */ }
      }
    }

    if (apiKey && smokeInstance && roomId) {
      try {
        const dockReuse = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
        assert('Dock reconnect same instance reuses room', dockReuse.data.room_id === roomId);
        dockReuse.ws.close();
        await sleep(100);
      } catch (e) {
        assert('Dock reconnect same instance reuses room', false, e.message);
      }
    }

    if (!roomId) {
      assert('Have roomId for remaining tests', false, 'dock did not create a room');
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
    assert(
      'Relogin returns existing api_key plaintext',
      typeof relogin.body.api_key === 'string' && relogin.body.api_key.length > 0,
      String(relogin.body.api_key)
    );
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

    // Option A: one key = one dock seat (reject second dock; keep first)
    if (apiKey) {
      let seatA;
      try {
        seatA = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
        let rejected = false;
        try {
          await wsJoin({ client: 'dock', apiKey, instanceId: `${smokeInstance}-b` });
        } catch (e) {
          rejected = e.code === 'api_key_in_use' || /already in use/i.test(e.message);
          assert('Same API key rejects second dock', rejected, e.message);
        }
        if (!rejected) {
          assert('Same API key rejects second dock', false, 'second dock was allowed');
        }
        assert('First dock kept after conflict', seatA.ws.readyState === 1);
        seatA.ws.close();
        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        assert('Same API key rejects second dock', false, e.message);
        if (seatA) try { seatA.ws.close(); } catch (_) { /* ignore */ }
      }
    }

    // WebSocket: dock api key
    let dockJoin;
    try {
      dockJoin = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
      assert('WS join dock + api_key', dockJoin.data.room_id === roomId);
      roomId = dockJoin.data.room_id;
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
    const dock2 = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance }).catch(() => null);
    if (dock2) {
      dock2.ws.send(JSON.stringify({
        type: 'session',
        room_id: roomId,
        action: 'start',
        payload: { gameType: 'game1', player1: 'A', player2: 'B', sessionId: 'smoke-match' },
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
        payload: { matchId: 'smoke-match', sessionId: 'smoke-match', winnerSlot: '1', scores: { p1: 5, p2: 2 }, reason: 'race_complete' },
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

        const drawPatch = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'Alice',
            player2Name: 'Bob',
            gameType: 'game1',
            scores: { p1: 4, p2: 4 },
          }),
        });
        assert('PATCH match draw scores', drawPatch.ok && drawPatch.body.ok === true);
        const statsAfterDraw = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const drawMatch = (statsAfterDraw.body.matches || []).find((m) => m.startEventId === editable.startEventId);
        assert(
          'Draw winnerSlot from equal scores',
          !!drawMatch && drawMatch.winnerSlot === 'draw' &&
            drawMatch.scores && drawMatch.scores.p1 === 4 && drawMatch.scores.p2 === 4
        );

        const drawRacksPatch = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'Alice',
            player2Name: 'Bob',
            gameType: 'game1',
            racks: [
              { rackNumber: 1, winnerSlot: '1' },
              { rackNumber: 2, winnerSlot: '2' },
            ],
          }),
        });
        assert('PATCH match draw via racks', drawRacksPatch.ok && drawRacksPatch.body.ok === true);
        const statsAfterDrawRacks = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const drawRacksMatch = (statsAfterDrawRacks.body.matches || []).find((m) => m.startEventId === editable.startEventId);
        assert(
          'Draw winnerSlot from tied racks',
          !!drawRacksMatch && drawRacksMatch.winnerSlot === 'draw' &&
            drawRacksMatch.scores && drawRacksMatch.scores.p1 === 1 && drawRacksMatch.scores.p2 === 1
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

      // Abandon an in-progress (unended) match — stats-only discard of session:start
      const abandonStartId = crypto.randomUUID();
      const abandonSession = `abandon-${abandonStartId.slice(0, 8)}`;
      const abandonDb = new Database(SQLITE_PATH);
      abandonDb.pragma('foreign_keys = ON');
      abandonDb.prepare(
        `INSERT INTO match_events (id, account_id, room_id, session_id, event_type, payload, source_client)
         VALUES (?, ?, ?, ?, 'session:start', ?, 'dock')`
      ).run(
        abandonStartId,
        accountId,
        roomId,
        abandonSession,
        JSON.stringify({ sessionId: abandonSession, gameType: 'game1', player1: 'LiveP1', player2: 'LiveP2' })
      );
      abandonDb.close();
      const beforeAbandon = await fetchJson('/api/stats', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      const liveBefore = (beforeAbandon.body.matches || []).find((m) => m.startEventId === abandonStartId);
      assert('Active match appears in stats', !!liveBefore && liveBefore.status === 'active');
      const abandoned = await fetchJson(`/api/stats/matches/${abandonStartId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert('Abandon in-progress match', abandoned.ok && abandoned.body.ok === true && abandoned.body.abandoned === true);
      assert(
        'Abandon reports dock notification flag',
        typeof abandoned.body.dockNotified === 'boolean'
      );
      const afterAbandon = await fetchJson('/api/stats', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      const liveAfter = (afterAbandon.body.matches || []).find((m) => m.startEventId === abandonStartId);
      assert('Abandoned match removed from stats', !liveAfter);

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

        let secondRejected = false;
        try {
          await wsJoin({ guestToken: guestLink.body.token });
        } catch (e) {
          secondRejected = e.code === 'guest_link_in_use';
          assert('Second guest join rejected while first active', secondRejected, e.message);
        }
        if (!secondRejected) {
          assert('Second guest join rejected while first active', false, 'expected guest_link_in_use');
        }

        guestWs.ws.close();
        await new Promise((r) => setTimeout(r, 150));
        const guestWs2 = await wsJoin({ guestToken: guestLink.body.token });
        assert('Guest can reconnect after prior session closes', guestWs2.data.client === 'mobile_guest');

        const guestKickedP = waitForWsErrorThenClose(guestWs2.ws);
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

    // DELETE /api/rooms — disconnects clients; match history kept (tested below via FK)
    if (roomId) {
      const delRoom = await fetchJson(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert('DELETE /api/rooms/:roomId', delRoom.ok && delRoom.body.ok === true);
      const meAfterDel = await fetchJson('/api/me', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      const stillThere = (meAfterDel.body.rooms || []).some((r) => r.id === roomId);
      assert('Deleted room removed from /api/me', !stillThere);
    }

    // Match history is account-scoped: deleting a room must not wipe events (ON DELETE SET NULL).
    if (accountId) {
      try {
        const ephemeralRoomId = crypto.randomUUID();
        const startId = crypto.randomUUID();
        const endId = crypto.randomUUID();
        const sessionKey = `survive-${startId.slice(0, 8)}`;
        const localDb = new Database(SQLITE_PATH);
        localDb.pragma('foreign_keys = ON');
        localDb.prepare(
          'INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)'
        ).run(ephemeralRoomId, accountId, 'ephemeral-stats-room');
        localDb.prepare(
          `INSERT INTO match_events (id, account_id, room_id, session_id, event_type, payload, source_client, created_at)
           VALUES (?, ?, ?, ?, 'session:start', ?, 'dock', ?)`
        ).run(
          startId,
          accountId,
          ephemeralRoomId,
          sessionKey,
          JSON.stringify({ sessionId: sessionKey, gameType: 'game1', player1: 'SurvP1', player2: 'SurvP2' }),
          '2026-01-01 12:00:00'
        );
        localDb.prepare(
          `INSERT INTO match_events (id, account_id, room_id, session_id, event_type, payload, source_client, created_at)
           VALUES (?, ?, ?, ?, 'session:end', ?, 'dock', ?)`
        ).run(
          endId,
          accountId,
          ephemeralRoomId,
          sessionKey,
          JSON.stringify({
            matchId: sessionKey,
            sessionId: sessionKey,
            winnerSlot: '1',
            scores: { p1: 5, p2: 1 },
            reason: 'race_complete',
          }),
          '2026-01-01 12:00:01'
        );
        localDb.prepare('DELETE FROM rooms WHERE id = ?').run(ephemeralRoomId);
        const nulled = localDb.prepare(
          'SELECT account_id, room_id FROM match_events WHERE id = ?'
        ).get(startId);
        localDb.close();
        assert(
          'Room delete nulls match_events.room_id',
          !!nulled && nulled.account_id === accountId && nulled.room_id == null
        );
        const statsSurvive = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const survived = (statsSurvive.body.matches || []).find((m) => m.startEventId === startId);
        assert('GET /api/stats keeps match after room delete', !!survived && survived.player1Name === 'SurvP1');
        assert('Stats players array after room delete', statsSurvive.ok && Array.isArray(statsSurvive.body.players));

        // Cross-check: PATCH still finds match by account_id even with null room_id.
        const patchOrphan = await fetchJson(`/api/stats/matches/${startId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'SurvP1',
            player2Name: 'SurvP2',
            gameType: 'game1',
            scores: { p1: 6, p2: 2 },
          }),
        });
        assert(
          'PATCH match with null room_id',
          patchOrphan.ok && patchOrphan.body.ok === true,
          `${patchOrphan.status} ${JSON.stringify(patchOrphan.body)}`
        );
      } catch (e) {
        assert('Stats survive room delete', false, e.message);
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
