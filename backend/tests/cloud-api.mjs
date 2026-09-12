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
const SQLITE_PATH_RAW = process.env.SQLITE_PATH
  || path.join(__dirname, '..', 'data', 'cuesport.db');
// Relative SQLITE_PATH values are resolved from backend/ (same as the server), not CWD.
const SQLITE_PATH = path.isAbsolute(SQLITE_PATH_RAW)
  ? SQLITE_PATH_RAW
  : path.resolve(path.join(__dirname, '..'), SQLITE_PATH_RAW);

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

function waitForWsMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    const onMessage = (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!predicate(data)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(data);
    };
    ws.on('message', onMessage);
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
      'Dev login does not mint api_key',
      login.body.api_key == null,
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
    assert(
      'GET /api/me includes is_platform_admin boolean',
      typeof me.body.is_platform_admin === 'boolean'
    );
    assert(
      'GET /api/me includes trial_ends_at',
      me.body.account && Object.prototype.hasOwnProperty.call(me.body.account, 'trial_ends_at')
    );
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

    // Create named OBS Dock Key (required label; default role trusted_operator)
    let apiKey = null;
    let apiKeyId = null;
    const missingLabel = await fetchJson('/api/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert('POST /api/api-keys requires name', missingLabel.status === 400);

    const badRole = await fetchJson('/api/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'bad-role', role: 'owner' }),
    });
    assert('POST /api/api-keys invalid role 400', badRole.status === 400);

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
      assert(
        'POST /api/api-keys default role trusted_operator',
        keyRes.body.role === 'trusted_operator',
        String(keyRes.body.role)
      );
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

    // Remove regenerate path — seat id stays stable; compromise = Remove then Create
    if (apiKeyId && apiKey && roomId) {
      let dockToKick = null;
      try {
        dockToKick = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
        const dockKeyId = dockToKick.data.api_key_id || apiKeyId;
        assert('Dock join reports api_key_id', !!dockToKick.data.api_key_id, JSON.stringify(dockToKick.data));
        assert(
          'Dock join includes role/permissions',
          dockToKick.data.role === 'trusted_operator' && !!dockToKick.data.permissions,
          JSON.stringify({ role: dockToKick.data.role, permissions: dockToKick.data.permissions })
        );
        const regenGone = await fetchJson(`/api/api-keys/${dockKeyId}/regenerate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        assert('POST /api/api-keys/:id/regenerate removed', regenGone.status === 404);

        // Default OBS Dock Owner guest token created on first dock join
        const guestLinks = await fetchJson(`/api/rooms/${roomId}/guest-links`, {
          headers: { 'X-Api-Key': apiKey },
        });
        assert('GET guest-links via dock key', guestLinks.ok);
        const owners = (guestLinks.body.guest_links || []).filter((g) => g.label === 'OBS Dock Owner');
        assert('Dock join creates OBS Dock Owner once', owners.length === 1, `count=${owners.length}`);
        dockToKick.ws.close();
        await sleep(150);
        const dockAgain = await wsJoin({ client: 'dock', apiKey, instanceId: smokeInstance });
        const guestLinks2 = await fetchJson(`/api/rooms/${roomId}/guest-links`, {
          headers: { 'X-Api-Key': apiKey },
        });
        const owners2 = (guestLinks2.body.guest_links || []).filter((g) => g.label === 'OBS Dock Owner');
        assert('Second dock join does not mint second OBS Dock Owner', owners2.length === 1);
        dockAgain.ws.close();
        await sleep(100);
      } catch (e) {
        assert('Dock join role + OBS Dock Owner guest', false, e.message);
        if (dockToKick) try { dockToKick.ws.close(); } catch (_) { /* ignore */ }
      }
    }

    if (apiKeyId) {
      try {
        const renamed = await fetchJson(`/api/api-keys/${apiKeyId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ label: 'browser-test-shared' }),
        });
        assert(
          'PATCH /api/api-keys/:id rename',
          renamed.ok && renamed.body.label === 'browser-test-shared',
          `status=${renamed.status} body=${JSON.stringify(renamed.body)}`,
        );
        const meAfterRename = await fetchJson('/api/me', { headers: { Authorization: `Bearer ${token}` } });
        const keyRow = (meAfterRename.body.api_keys || []).find((k) => k.id === apiKeyId);
        assert('Renamed key appears in /api/me', keyRow?.label === 'browser-test-shared');
      } catch (e) {
        assert('PATCH /api/api-keys/:id rename', false, e.message);
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
      'Relogin does not mint api_key',
      relogin.ok && relogin.body.api_key == null,
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

    // Keys = tables: two Dock Keys with the same instance_id get two rooms
    if (apiKey) {
      const keyBRes = await fetchJson('/api/api-keys', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: `table-b-${Date.now().toString(36)}` }),
      });
      if (keyBRes.ok) {
        let dockA;
        let dockB;
        try {
          dockA = await wsJoin({ client: 'dock', apiKey, instanceId: 'default' });
          dockB = await wsJoin({ client: 'dock', apiKey: keyBRes.body.key, instanceId: 'default' });
          assert(
            'Two keys + default instance → two rooms',
            !!dockA.data.room_id &&
              !!dockB.data.room_id &&
              dockA.data.room_id !== dockB.data.room_id,
            `${dockA.data.room_id} vs ${dockB.data.room_id}`
          );
          const roomA = dockA.data.room_id;
          dockA.ws.close();
          await sleep(100);
          const reconnect = await wsJoin({ client: 'dock', apiKey, instanceId: 'default' });
          assert(
            'Same key reconnect reuses room',
            reconnect.data.room_id === roomA,
            reconnect.data.room_id
          );
          reconnect.ws.close();
          dockA = null;
        } catch (e) {
          assert('Two keys + default instance → two rooms', false, e.message);
        } finally {
          try { dockA?.ws.close(); } catch (_) { /* ignore */ }
          try { dockB?.ws.close(); } catch (_) { /* ignore */ }
          await sleep(100);
          if (keyBRes.body.id) {
            await fetchJson(`/api/api-keys/${keyBRes.body.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
      } else {
        assert(
          'Two keys + default instance → two rooms',
          false,
          `second key create failed: ${keyBRes.status} ${JSON.stringify(keyBRes.body)}`
        );
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

      // Round-trip: unique match → GET /api/stats returns player W/L + match history
      const rtSuffix = Date.now().toString(36).slice(-6);
      const rtSessionId = `stats-rt-${rtSuffix}`;
      const rtP1Name = `RtP1_${rtSuffix}`;
      const rtP2Name = `RtP2_${rtSuffix}`;
      dock2.ws.send(JSON.stringify({
        type: 'session',
        room_id: roomId,
        action: 'start',
        payload: {
          gameType: 'game1',
          player1: rtP1Name,
          player2: rtP2Name,
          sessionId: rtSessionId,
          gameInfo: `CloudStatsRT ${rtSuffix}`,
        },
      }));
      await sleep(1100);
      dock2.ws.send(JSON.stringify({
        type: 'session',
        room_id: roomId,
        action: 'end',
        payload: {
          matchId: rtSessionId,
          sessionId: rtSessionId,
          winnerSlot: '1',
          scores: { p1: 2, p2: 1 },
          reason: 'race_complete',
          breakAndRunsP1: 1,
          tableRunsP2: 1,
          ballsP1: 9,
          ballsP2: 6,
        },
      }));
      await sleep(300);
      const rtStats = await fetchJson('/api/stats', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert(
        'Stats round-trip GET /api/stats',
        rtStats.ok && Array.isArray(rtStats.body.players) && Array.isArray(rtStats.body.matches)
      );
      const rtMatch = (rtStats.body.matches || []).find(
        (m) => m.status === 'completed' &&
          ((m.id === rtSessionId) || (m.player1Name === rtP1Name && m.player2Name === rtP2Name))
      );
      assert('Stats round-trip match in history', !!rtMatch, `session=${rtSessionId}`);
      assert(
        'Stats round-trip match score 2-1',
        !!(rtMatch && rtMatch.scores && rtMatch.scores.p1 === 2 && rtMatch.scores.p2 === 1),
        rtMatch && JSON.stringify(rtMatch.scores)
      );
      assert(
        'Stats round-trip winnerSlot P1',
        !!(rtMatch && String(rtMatch.winnerSlot) === '1'),
        rtMatch && String(rtMatch.winnerSlot)
      );
      const rtPlayer1 = (rtStats.body.players || []).find((p) => p.name === rtP1Name);
      const rtPlayer2 = (rtStats.body.players || []).find((p) => p.name === rtP2Name);
      assert('Stats round-trip P1 on leaderboard', !!rtPlayer1);
      assert('Stats round-trip P2 on leaderboard', !!rtPlayer2);
      assert(
        'Stats round-trip P1 gamesWon ≥ 1',
        !!(rtPlayer1 && rtPlayer1.gamesWon >= 1),
        rtPlayer1 && JSON.stringify(rtPlayer1)
      );
      assert(
        'Stats round-trip P2 gamesLost ≥ 1',
        !!(rtPlayer2 && rtPlayer2.gamesLost >= 1),
        rtPlayer2 && JSON.stringify(rtPlayer2)
      );
      assert(
        'Stats round-trip P1 racksWon ≥ 2',
        !!(rtPlayer1 && rtPlayer1.racksWon >= 2),
        rtPlayer1 && String(rtPlayer1.racksWon)
      );
      assert(
        'Stats round-trip match player ids present',
        !!(rtMatch && rtMatch.player1Id && rtMatch.player2Id &&
          rtMatch.player1Id !== rtMatch.player2Id),
        rtMatch && `${rtMatch.player1Id}/${rtMatch.player2Id}`
      );
      assert(
        'Stats round-trip stamps api_key_id',
        !!(rtMatch && rtMatch.api_key_id === apiKeyId),
        rtMatch && String(rtMatch.api_key_id)
      );

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
        assert(
          'Snooker edit clears prior B&R/TR',
          !!snookerMatch &&
            Number(snookerMatch.breakAndRunsP1 || 0) === 0 &&
            Number(snookerMatch.breakAndRunsP2 || 0) === 0 &&
            Number(snookerMatch.tableRunsP1 || 0) === 0 &&
            Number(snookerMatch.tableRunsP2 || 0) === 0
        );

        const snookerRejectRunOuts = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'Alice',
            player2Name: 'Bob',
            gameType: 'game8',
            racks: [
              { winnerSlot: '1', breakAndRun: true, highestBreakP1: 50, highestBreakP2: 0 },
              { winnerSlot: '2', tableRun: true, highestBreakP1: 0, highestBreakP2: 40 },
            ],
            breakAndRunsP1: 9,
            tableRunsP2: 9,
          }),
        });
        assert('PATCH snooker ignores B&R/TR', snookerRejectRunOuts.ok && snookerRejectRunOuts.body.ok === true);
        const statsAfterSnookerRunOuts = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const snookerNoRunOut = (statsAfterSnookerRunOuts.body.matches || [])
          .find((m) => m.startEventId === editable.startEventId);
        assert(
          'Snooker match stores no B&R/TR',
          !!snookerNoRunOut &&
            Number(snookerNoRunOut.breakAndRunsP1 || 0) === 0 &&
            Number(snookerNoRunOut.breakAndRunsP2 || 0) === 0 &&
            Number(snookerNoRunOut.tableRunsP1 || 0) === 0 &&
            Number(snookerNoRunOut.tableRunsP2 || 0) === 0 &&
            !(snookerNoRunOut.racks || []).some((r) => r.breakAndRun || r.tableRun),
          JSON.stringify({
            br: snookerNoRunOut?.breakAndRunsP1,
            tr: snookerNoRunOut?.tableRunsP2,
            racks: snookerNoRunOut?.racks,
          }),
        );
        const alicePlayer = (statsAfterSnooker.body.players || []).find((p) => p.name === 'Alice');
        assert(
          'Player rollup includes fouls',
          !!alicePlayer && alicePlayer.fouls === 4,
          alicePlayer ? String(alicePlayer.fouls) : 'missing'
        );
        assert('Player has stable id', !!alicePlayer?.id && alicePlayer.id !== 'alice');
        const renamed = await fetchJson('/api/stats/players', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: alicePlayer.id, to: 'Alicia' }),
        });
        assert('PATCH /api/stats/players', renamed.ok && renamed.body.updated >= 1);
        const caseOnlyRename = await fetchJson('/api/stats/players', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: alicePlayer.id, to: 'ALICIA' }),
        });
        assert(
          'PATCH /api/stats/players case-only',
          caseOnlyRename.ok && caseOnlyRename.body.updated >= 1,
          JSON.stringify(caseOnlyRename.body),
        );
        const statsAfterCase = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const aliciaPlayer = (statsAfterCase.body.players || []).find(
          (p) => p.id === alicePlayer.id,
        );
        assert(
          'Case-only rename updates roster display',
          !!aliciaPlayer && aliciaPlayer.name === 'ALICIA',
          aliciaPlayer ? aliciaPlayer.name : 'missing',
        );
        const dupA = crypto.randomUUID();
        const dupB = crypto.randomUUID();
        // Same display name, two ids — allowed in match edit
        const sameNameEdit = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: 'John',
            player2Name: 'John',
            player1Id: dupA,
            player2Id: dupB,
            gameType: 'game1',
            scores: { p1: 1, p2: 0 },
          }),
        });
        assert(
          'PATCH allows duplicate display names with distinct ids',
          sameNameEdit.ok && sameNameEdit.body.ok === true,
          JSON.stringify(sameNameEdit.body),
        );
        const deleted = await fetchJson(`/api/stats/matches/${editable.startEventId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert('DELETE /api/stats/matches/:id', deleted.ok && deleted.body.ok === true);

        // Dedicated player + match for DELETE /api/stats/players/:id
        const victimPlayerId = crypto.randomUUID();
        const opponentPlayerId = crypto.randomUUID();
        const deleteVictimStart = crypto.randomUUID();
        const deleteVictimEnd = crypto.randomUUID();
        const deleteVictimSession = `del-player-${deleteVictimStart.slice(0, 8)}`;
        const seedDb = new Database(SQLITE_PATH);
        seedDb.pragma('foreign_keys = ON');
        seedDb.prepare(
          `INSERT INTO account_players (id, account_id, name, name_normalized, last_seen_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(victimPlayerId, accountId, 'DeleteMe', 'deleteme');
        seedDb.prepare(
          `INSERT INTO account_players (id, account_id, name, name_normalized, last_seen_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(opponentPlayerId, accountId, 'KeepMe', 'keepme');
        seedDb.prepare(
          `INSERT INTO match_events (id, account_id, room_id, session_id, event_type, payload, source_client)
           VALUES (?, ?, ?, ?, 'session:start', ?, 'dock')`
        ).run(
          deleteVictimStart,
          accountId,
          roomId,
          deleteVictimSession,
          JSON.stringify({
            sessionId: deleteVictimSession,
            player1: 'DeleteMe',
            player2: 'KeepMe',
            player1Id: victimPlayerId,
            player2Id: opponentPlayerId,
            gameType: 'game1',
          }),
        );
        seedDb.prepare(
          `INSERT INTO match_events (id, account_id, room_id, session_id, event_type, payload, source_client)
           VALUES (?, ?, ?, ?, 'session:end', ?, 'dock')`
        ).run(
          deleteVictimEnd,
          accountId,
          roomId,
          deleteVictimSession,
          JSON.stringify({
            matchId: deleteVictimSession,
            sessionId: deleteVictimSession,
            scores: { p1: 2, p2: 1 },
            winner: '1',
          }),
        );
        seedDb.close();

        const deletedPlayer = await fetchJson(`/api/stats/players/${encodeURIComponent(victimPlayerId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert(
          'DELETE /api/stats/players/:id',
          deletedPlayer.ok && deletedPlayer.body.ok === true && deletedPlayer.body.rosterDeleted === true,
          JSON.stringify(deletedPlayer.body),
        );
        assert(
          'DELETE player removes matches',
          Number(deletedPlayer.body.deletedMatches) >= 1,
          String(deletedPlayer.body.deletedMatches),
        );
        const statsAfterDeletePlayer = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert(
          'Deleted player gone from roster',
          !(statsAfterDeletePlayer.body.players || []).some((p) => p.id === victimPlayerId),
        );
        assert(
          'Deleted player matches gone',
          !(statsAfterDeletePlayer.body.matches || []).some(
            (m) => m.player1Id === victimPlayerId || m.player2Id === victimPlayerId,
          ),
        );
        const rosterCheck = new Database(SQLITE_PATH, { readonly: true });
        const victimRow = rosterCheck.prepare(
          'SELECT id FROM account_players WHERE id = ? AND account_id = ?'
        ).get(victimPlayerId, accountId);
        const keepRow = rosterCheck.prepare(
          'SELECT id FROM account_players WHERE id = ? AND account_id = ?'
        ).get(opponentPlayerId, accountId);
        rosterCheck.close();
        assert('Deleted player removed from account_players', !victimRow);
        assert('Peer player kept in account_players', !!keepRow);

        // Zero-stat roster players still appear in GET /api/stats (for delete / browse).
        const zeroStatId = crypto.randomUUID();
        const zeroStatDb = new Database(SQLITE_PATH);
        zeroStatDb.pragma('foreign_keys = ON');
        zeroStatDb.prepare(
          `INSERT INTO account_players (id, account_id, name, name_normalized, last_seen_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(zeroStatId, accountId, 'ZeroStatZed', 'zerostatzed');
        zeroStatDb.close();
        const statsWithZero = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const zeroPlayer = (statsWithZero.body.players || []).find((p) => p.id === zeroStatId);
        assert(
          'Zero-stat roster player in GET /api/stats',
          !!zeroPlayer && zeroPlayer.name === 'ZeroStatZed'
            && Number(zeroPlayer.gamesWon || 0) === 0
            && Number(zeroPlayer.gamesLost || 0) === 0,
          JSON.stringify(zeroPlayer),
        );
        const rankedBeforeZero = (statsWithZero.body.players || []).findIndex((p) =>
          (Number(p.gamesWon) || 0) + (Number(p.gamesDrawn) || 0) + (Number(p.gamesLost) || 0) > 0
        );
        const zeroIndex = (statsWithZero.body.players || []).findIndex((p) => p.id === zeroStatId);
        let orderOk = true;
        let seenUnplayed = false;
        for (const p of statsWithZero.body.players || []) {
          const played = (Number(p.gamesWon) || 0) + (Number(p.gamesDrawn) || 0) + (Number(p.gamesLost) || 0) > 0;
          if (!played) seenUnplayed = true;
          else if (seenUnplayed) orderOk = false;
        }
        assert(
          'Zero-stat player listed after ranked players',
          zeroIndex >= 0 && orderOk && (rankedBeforeZero < 0 || zeroIndex > rankedBeforeZero),
          `zero=${zeroIndex} ranked=${rankedBeforeZero} orderOk=${orderOk}`,
        );
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
      const abandonCmdP = waitForWsMessage(
        dock2.ws,
        (d) => d.type === 'command' && d.action === 'abandon_match'
      );
      const abandoned = await fetchJson(`/api/stats/matches/${abandonStartId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      assert('Abandon in-progress match', abandoned.ok && abandoned.body.ok === true && abandoned.body.abandoned === true);
      assert(
        'Abandon notifies connected dock',
        abandoned.body.dockNotified === true
      );
      try {
        const abandonCmd = await abandonCmdP;
        assert(
          'Abandon relays abandon_match command',
          abandonCmd.action === 'abandon_match' &&
            String(abandonCmd.payload?.matchId || '') === abandonSession,
          JSON.stringify(abandonCmd.payload || {})
        );
      } catch (e) {
        assert('Abandon relays abandon_match command', false, e.message);
      }
      const afterAbandon = await fetchJson('/api/stats', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      const liveAfter = (afterAbandon.body.matches || []).find((m) => m.startEventId === abandonStartId);
      assert('Abandoned match removed from stats', !liveAfter);

      dock2.ws.close();
    } else {
      assert('Events persisted', false, 'dock join failed');
    }

    // Dock key roles: dashboard JWT-only, operator/trusted/admin mutation gates, guest-link rules
    // Self-host default quota is 2 OBS Dock Keys — reuse the primary key + one second seat.
    try {
      await wsJoin({ client: 'dashboard', apiKey });
      assert('Dashboard WS join with API key rejected', false, 'should have failed');
    } catch (e) {
      assert(
        'Dashboard WS join with API key rejected',
        e.code === 'dashboard_jwt_required' || /dashboard|sign-in|jwt/i.test(e.message),
        e.message
      );
    }

    let secondKey = null;
    let secondKeyId = null;
    const secondRes = await fetchJson('/api/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenFresh}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'smoke-second', role: 'trusted_operator' }),
    });
    if (secondRes.ok && secondRes.body.key) {
      secondKey = secondRes.body.key;
      secondKeyId = secondRes.body.id;
      assert('Create second trusted key', secondRes.body.role === 'trusted_operator');
    } else {
      assert(
        'Create second trusted key',
        false,
        secondRes.body?.code || secondRes.body?.error || `status=${secondRes.status}`
      );
    }

    const ownMatch = (await fetchJson('/api/stats', {
      headers: { Authorization: `Bearer ${tokenFresh}` },
    })).body?.matches?.find((m) => m.api_key_id === apiKeyId && m.status === 'completed' && m.startEventId);

    if (ownMatch && apiKey) {
      const trustedPatch = await fetchJson(`/api/stats/matches/${ownMatch.startEventId}`, {
        method: 'PATCH',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          player1Name: ownMatch.player1Name,
          player2Name: ownMatch.player2Name,
          gameType: ownMatch.gameType || 'game1',
          scores: ownMatch.scores || { p1: 2, p2: 1 },
        }),
      });
      assert('Trusted PATCH own match OK', trustedPatch.ok, JSON.stringify(trustedPatch.body));
    } else {
      assert('Trusted PATCH own match OK', false, 'no stamped own match');
    }

    if (secondKey && secondKeyId && apiKey) {
      const otherInst = `${smokeInstance}-other`;
      try {
        const otherDock = await wsJoin({ client: 'dock', apiKey: secondKey, instanceId: otherInst });
        const otherRoom = otherDock.data.room_id;
        const otherSession = `other-write-${Date.now().toString(36)}`;
        otherDock.ws.send(JSON.stringify({
          type: 'session',
          room_id: otherRoom,
          action: 'start',
          payload: {
            gameType: 'game1',
            player1: 'OtherP1',
            player2: 'OtherP2',
            sessionId: otherSession,
          },
        }));
        await sleep(200);
        otherDock.ws.send(JSON.stringify({
          type: 'session',
          room_id: otherRoom,
          action: 'end',
          payload: {
            matchId: otherSession,
            sessionId: otherSession,
            winnerSlot: '2',
            scores: { p1: 0, p2: 1 },
            reason: 'race_complete',
          },
        }));
        await sleep(250);
        otherDock.ws.close();
        await sleep(100);
        const otherStats = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const otherMatch = (otherStats.body.matches || []).find(
          (m) => m.api_key_id === secondKeyId && m.status === 'completed'
        );
        assert('Other trusted match stamped', !!otherMatch?.startEventId);
        if (otherMatch) {
          const crossPatch = await fetchJson(`/api/stats/matches/${otherMatch.startEventId}`, {
            method: 'PATCH',
            headers: {
              'X-Api-Key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              player1Name: otherMatch.player1Name,
              player2Name: otherMatch.player2Name,
              gameType: 'game1',
              scores: { p1: 3, p2: 3 },
            }),
          });
          assert('Trusted PATCH other key match 403', crossPatch.status === 403);
          const trustedPlayerDel = await fetchJson(
            `/api/stats/players/${encodeURIComponent(otherMatch.player1Id)}`,
            {
              method: 'DELETE',
              headers: { 'X-Api-Key': apiKey },
            }
          );
          assert('Trusted player delete 403', trustedPlayerDel.status === 403);
        }
      } catch (e) {
        assert('Trusted other-key mutation gates', false, e.message);
      }

      // Flip second seat to operator
      const toOp = await fetchJson(`/api/api-keys/${secondKeyId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenFresh}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'operator' }),
      });
      assert('PATCH second key to operator', toOp.ok && toOp.body.role === 'operator');

      if (ownMatch) {
        const opPatch = await fetchJson(`/api/stats/matches/${ownMatch.startEventId}`, {
          method: 'PATCH',
          headers: {
            'X-Api-Key': secondKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: ownMatch.player1Name,
            player2Name: ownMatch.player2Name,
            gameType: ownMatch.gameType || 'game1',
            scores: { p1: 9, p2: 0 },
          }),
        });
        assert('Operator PATCH match 403', opPatch.status === 403);
        const opDel = await fetchJson(`/api/stats/matches/${ownMatch.startEventId}`, {
          method: 'DELETE',
          headers: { 'X-Api-Key': secondKey },
        });
        assert('Operator DELETE match 403', opDel.status === 403);
        const opPlayer = await fetchJson('/api/stats/players', {
          method: 'PATCH',
          headers: {
            'X-Api-Key': secondKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: ownMatch.player1Id, to: 'Nope' }),
        });
        assert('Operator player rename 403', opPlayer.status === 403);
      }

      try {
        // Reuse the second seat's existing room (selfhost table cap is 2).
        const opDock = await wsJoin({
          client: 'dock',
          apiKey: secondKey,
          instanceId: otherInst,
        });
        const opRoom = opDock.data.room_id;
        const opSession = `op-write-${Date.now().toString(36)}`;
        opDock.ws.send(JSON.stringify({
          type: 'session',
          room_id: opRoom,
          action: 'start',
          payload: { gameType: 'game1', player1: 'OpP1', player2: 'OpP2', sessionId: opSession },
        }));
        await sleep(200);
        opDock.ws.send(JSON.stringify({
          type: 'session',
          room_id: opRoom,
          action: 'end',
          payload: {
            matchId: opSession,
            sessionId: opSession,
            winnerSlot: '1',
            scores: { p1: 1, p2: 0 },
            reason: 'race_complete',
          },
        }));
        await sleep(250);
        const opList = await fetchJson(`/api/rooms/${opRoom}/guest-links`, {
          headers: { 'X-Api-Key': secondKey },
        });
        assert('Operator GET default guest link OK', opList.ok);
        const owners = (opList.body.guest_links || []).filter((g) => g.label === 'OBS Dock Owner');
        assert('Operator room has OBS Dock Owner', owners.length >= 1);
        const opCreate = await fetchJson(`/api/rooms/${opRoom}/guest-link`, {
          method: 'POST',
          headers: {
            'X-Api-Key': secondKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ label: 'op-extra' }),
        });
        assert('Operator POST guest-link 403', opCreate.status === 403);
        if (owners[0]?.token) {
          const opRevoke = await fetchJson(`/api/guest-links/${owners[0].token}`, {
            method: 'DELETE',
            headers: { 'X-Api-Key': secondKey },
          });
          assert('Operator DELETE guest-link 403', opRevoke.status === 403);
        }
        opDock.ws.close();
        await sleep(100);
        const opStats = await fetchJson('/api/stats', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        const opMatch = (opStats.body.matches || []).find((m) => m.id === opSession || m.player1Name === 'OpP1');
        assert('Operator session write still OK', !!opMatch && opMatch.api_key_id === secondKeyId);
      } catch (e) {
        assert('Operator session write / guest gates', false, e.message);
      }

      // Flip second seat to administrator — can mutate matches written by the primary key
      const toAdmin = await fetchJson(`/api/api-keys/${secondKeyId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenFresh}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'administrator' }),
      });
      assert('PATCH second key to administrator', toAdmin.ok && toAdmin.body.role === 'administrator');
      if (ownMatch) {
        const adminPatch = await fetchJson(`/api/stats/matches/${ownMatch.startEventId}`, {
          method: 'PATCH',
          headers: {
            'X-Api-Key': secondKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player1Name: ownMatch.player1Name,
            player2Name: ownMatch.player2Name,
            gameType: ownMatch.gameType || 'game1',
            scores: ownMatch.scores || { p1: 2, p2: 1 },
          }),
        });
        assert('Administrator key PATCH any match OK', adminPatch.ok, JSON.stringify(adminPatch.body));
      }
    }

    if (apiKeyId) {
      const rolePatch = await fetchJson(`/api/api-keys/${apiKeyId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenFresh}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'administrator' }),
      });
      assert(
        'PATCH /api/api-keys/:id role',
        rolePatch.ok && rolePatch.body.role === 'administrator',
        JSON.stringify(rolePatch.body)
      );

      if (apiKey && roomId) {
        let liveDock = null;
        try {
          liveDock = await wsJoin({
            client: 'dock',
            apiKey,
            instanceId: smokeInstance || `role-live-${Date.now()}`,
          });
          const roleWait = waitForWsMessage(liveDock.ws, (d) => d.type === 'role_updated', 5000);
          const livePatch = await fetchJson(`/api/api-keys/${apiKeyId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${tokenFresh}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ role: 'operator' }),
          });
          assert(
            'PATCH role while dock connected',
            livePatch.ok && livePatch.body.role === 'operator' && Number(livePatch.body.notified) >= 1,
            JSON.stringify(livePatch.body)
          );
          const roleMsg = await roleWait;
          assert(
            'Live dock receives role_updated',
            roleMsg.role === 'operator' &&
              roleMsg.permissions &&
              roleMsg.permissions.canEditOwnMatch === false &&
              roleMsg.permissions.canCreateGuestLinks === false,
            JSON.stringify(roleMsg)
          );
          liveDock.ws.close();
          await sleep(100);
        } catch (e) {
          assert('Live dock role update push', false, e.message);
          if (liveDock) try { liveDock.ws.close(); } catch (_) { /* ignore */ }
        }
      }

      await fetchJson(`/api/api-keys/${apiKeyId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenFresh}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'trusted_operator' }),
      });
    }

    if (apiKey && roomId) {
      const trustedExtra = await fetchJson(`/api/rooms/${roomId}/guest-link`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'trusted-extra' }),
      });
      assert('Trusted create extra guest link on own room OK', trustedExtra.ok && !!trustedExtra.body.token);
      const fakeRoom = '00000000-0000-0000-0000-000000000099';
      const otherRoom = await fetchJson(`/api/rooms/${fakeRoom}/guest-link`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'nope' }),
      });
      assert('Trusted guest-link other room 403', otherRoom.status === 403 || otherRoom.status === 404);
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

    const guestLinkNoName = await fetchJson(`/api/rooms/${roomId}/guest-link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenFresh}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: '   ' }),
    });
    assert('POST guest-link requires name', guestLinkNoName.status === 400);

    if (guestLink.ok && guestLink.body.token) {
      const revokeEmptyJson = await fetchJson(`/api/guest-links/${guestLink.body.token}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenFresh}`,
          'Content-Type': 'application/json',
        },
      });
      assert(
        'DELETE guest-link with empty JSON content-type',
        revokeEmptyJson.ok,
        JSON.stringify(revokeEmptyJson.body)
      );

      const guestLink2 = await fetchJson(`/api/rooms/${roomId}/guest-link`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenFresh}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'smoke-guest-2' }),
      });
      assert('POST replacement guest-link', guestLink2.ok && !!guestLink2.body.token);

      try {
        const guestWs = await wsJoin({ guestToken: guestLink2.body.token });
        assert('WS join guest token', guestWs.data.client === 'mobile_guest');

        let secondRejected = false;
        try {
          await wsJoin({ guestToken: guestLink2.body.token });
        } catch (e) {
          secondRejected = e.code === 'guest_link_in_use';
          assert('Second guest join rejected while first active', secondRejected, e.message);
        }
        if (!secondRejected) {
          assert('Second guest join rejected while first active', false, 'expected guest_link_in_use');
        }

        guestWs.ws.close();
        await new Promise((r) => setTimeout(r, 150));
        const guestWs2 = await wsJoin({ guestToken: guestLink2.body.token });
        assert('Guest can reconnect after prior session closes', guestWs2.data.client === 'mobile_guest');

        const guestKickedP = waitForWsErrorThenClose(guestWs2.ws);
        const revAll = await fetchJson('/api/guest-links/revoke-all', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert('POST /api/guest-links/revoke-all', revAll.ok && Number(revAll.body.revoked) >= 1);
        const guestKick = await guestKickedP;
        assert('Guest kicked on revoke-all', guestKick.code === 'guest_revoked');
      } catch (e) {
        assert('Guest token join / one-device / revoke-all', false, e.message);
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

    // --- Platform admin + support trial / Stripe access gate ---
    {
      const { hasCloudSubscriptionAccess } = await import('../src/lib/subscription-access.js');
      assert(
        'Access gate: active allowed',
        hasCloudSubscriptionAccess({ subscription_status: 'active', trial_ends_at: null })
      );
      assert(
        'Access gate: trialing allowed',
        hasCloudSubscriptionAccess({ subscription_status: 'trialing', trial_ends_at: null })
      );
      assert(
        'Access gate: inactive blocked',
        !hasCloudSubscriptionAccess({ subscription_status: 'inactive', trial_ends_at: null })
      );
      const future = new Date(Date.now() + 86400000).toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();
      assert(
        'Access gate: admin support trial unlocks inactive',
        hasCloudSubscriptionAccess({ subscription_status: 'inactive', trial_ends_at: future })
      );
      assert(
        'Access gate: expired support trial blocked',
        !hasCloudSubscriptionAccess({ subscription_status: 'inactive', trial_ends_at: past })
      );

      const adminUnauth = await fetchJson('/api/admin/accounts');
      assert('GET /api/admin/accounts unauthorized', adminUnauth.status === 401);

      const meAdmin = await fetchJson('/api/me', {
        headers: { Authorization: `Bearer ${tokenFresh}` },
      });
      const isAdmin = !!meAdmin.body.is_platform_admin;
      assert('is_platform_admin reflects allowlist', typeof isAdmin === 'boolean');

      if (!isAdmin) {
        const denied = await fetchJson('/api/admin/accounts', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert(
          'Non-admin GET /api/admin/accounts 403',
          denied.status === 403,
          `${denied.status} ${JSON.stringify(denied.body)}`
        );
        const deniedTrial = await fetchJson(`/api/admin/accounts/${accountId}/trial`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ days: 7 }),
        });
        assert('Non-admin POST trial 403', deniedTrial.status === 403);
      } else {
        const listed = await fetchJson('/api/admin/accounts', {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert(
          'Admin GET /api/admin/accounts',
          listed.ok && Array.isArray(listed.body.accounts),
          JSON.stringify(listed.body)
        );
        assert(
          'Admin list includes self',
          (listed.body.accounts || []).some((a) => a.id === accountId)
        );
        const detail = await fetchJson(`/api/admin/accounts/${accountId}`, {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert(
          'Admin GET account detail',
          detail.ok && detail.body.account?.id === accountId && detail.body.quota?.limits,
          JSON.stringify(detail.body)
        );
        const adminStats = await fetchJson(`/api/admin/accounts/${accountId}/stats`, {
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert(
          'Admin GET account stats',
          adminStats.ok && Array.isArray(adminStats.body.players),
          JSON.stringify(adminStats.body)
        );
        const grant = await fetchJson(`/api/admin/accounts/${accountId}/trial`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ days: 7 }),
        });
        assert(
          'Admin grant support trial',
          grant.ok && !!grant.body.trial_ends_at,
          JSON.stringify(grant.body)
        );
        const badDays = await fetchJson(`/api/admin/accounts/${accountId}/trial`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenFresh}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ days: 999 }),
        });
        assert('Admin trial days clamped 400', badDays.status === 400);
        const endTrial = await fetchJson(`/api/admin/accounts/${accountId}/trial`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenFresh}` },
        });
        assert('Admin end support trial', endTrial.ok && endTrial.body.trial_ends_at == null);
      }

      // WS subscription gate: inactive + support trial / trialing (mutate SQLite, restore after)
      if (accountId && apiKey) {
        let gateRoomId = roomId;
        let gateDock = null;
        try {
          // Prefer a fresh dock room — earlier tests may have deleted roomId.
          gateDock = await wsJoin({
            client: 'dock',
            apiKey,
            instanceId: `admin-gate-${Date.now()}`,
          });
          gateRoomId = gateDock.data.room_id;
        } catch (e) {
          assert('Dock ready for subscription gate tests', false, e.message);
          gateRoomId = null;
        }
        if (gateRoomId) {
          const db = new Database(SQLITE_PATH);
          const before = db.prepare(
            'SELECT subscription_status, trial_ends_at FROM accounts WHERE id = ?'
          ).get(accountId);
          try {
            db.prepare(
              `UPDATE accounts SET subscription_status = 'inactive', trial_ends_at = NULL WHERE id = ?`
            ).run(accountId);
            try {
              await wsJoin({ roomId: gateRoomId, client: 'mobile', accessToken: tokenFresh });
              assert('Inactive blocks mobile join', false, 'should have failed');
            } catch (e) {
              assert(
                'Inactive blocks mobile join',
                e.code === 'subscription_required' || /subscription/i.test(e.message),
                e.message
              );
            }

            const trialIso = new Date(Date.now() + 2 * 86400000).toISOString();
            db.prepare(
              `UPDATE accounts SET trial_ends_at = ? WHERE id = ?`
            ).run(trialIso, accountId);
            try {
              const unlocked = await wsJoin({
                roomId: gateRoomId,
                client: 'mobile',
                accessToken: tokenFresh,
              });
              assert('Support trial unlocks mobile', !!unlocked.data?.room_id);
              unlocked.ws.close();
              await sleep(80);
            } catch (e) {
              assert('Support trial unlocks mobile', false, e.message);
            }

            const expiredIso = new Date(Date.now() - 86400000).toISOString();
            db.prepare(
              `UPDATE accounts SET trial_ends_at = ? WHERE id = ?`
            ).run(expiredIso, accountId);
            try {
              await wsJoin({ roomId: gateRoomId, client: 'mobile', accessToken: tokenFresh });
              assert('Expired support trial blocks mobile', false, 'should have failed');
            } catch (e) {
              assert(
                'Expired support trial blocks mobile',
                e.code === 'subscription_required' || /subscription/i.test(e.message),
                e.message
              );
            }

            db.prepare(
              `UPDATE accounts SET subscription_status = 'trialing', trial_ends_at = NULL WHERE id = ?`
            ).run(accountId);
            try {
              const trialing = await wsJoin({
                roomId: gateRoomId,
                client: 'mobile',
                accessToken: tokenFresh,
              });
              assert('Stripe trialing unlocks mobile', !!trialing.data?.room_id);
              trialing.ws.close();
              await sleep(80);
            } catch (e) {
              assert('Stripe trialing unlocks mobile', false, e.message);
            }
          } finally {
            db.prepare(
              `UPDATE accounts SET subscription_status = ?, trial_ends_at = ? WHERE id = ?`
            ).run(before?.subscription_status || 'active', before?.trial_ends_at ?? null, accountId);
            db.close();
          }
        }
        if (gateDock?.ws) {
          try { gateDock.ws.close(); } catch { /* ignore */ }
          await sleep(80);
        }
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
