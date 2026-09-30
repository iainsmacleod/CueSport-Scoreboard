#!/usr/bin/env node
/**
 * session:reopen + keyed discard hardening (finished-match undo / undo-to-start).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuesport-session-reopen-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.ALLOW_DEV_AUTH = 'true';
process.env.DEV_AUTH_SECRET = 'session-reopen-unit-test-secret';
process.env.ACCOUNT_FINGERPRINT_SECRET = 'account-fingerprint-unit-test-secret';

let failed = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  const sqlite = await import('../src/db/sqlite.js');

  const { account } = sqlite.ensureAccount('reopen-unit@example.com', 'auth-reopen-unit');
  const key = sqlite.createApiKey(account.id, 'Reopen dock', 'trusted_operator');
  const room = sqlite.ensureRoomForApiKey(account.id, key.id, {
    instanceKey: 'default',
    label: 'Reopen dock',
  });
  const matchId = 'reopen-match-1';

  sqlite.setRoomSessionId(room.id, matchId);
  sqlite.insertMatchEvent({
    accountId: account.id,
    roomId: room.id,
    sessionId: matchId,
    eventType: 'session:start',
    payload: {
      sessionId: matchId,
      matchId,
      player1: 'A',
      player2: 'B',
      gameType: 'game1',
    },
    sourceClient: 'dock',
    apiKeyId: key.id,
  });
  sqlite.insertMatchEvent({
    accountId: account.id,
    roomId: room.id,
    sessionId: matchId,
    eventType: 'session:end',
    payload: {
      sessionId: matchId,
      matchId,
      reason: 'race_complete',
      winnerSlot: '1',
      scores: { p1: 3, p2: 2 },
      racks: [
        { winnerSlot: '1' },
        { winnerSlot: '2' },
        { winnerSlot: '1' },
        { winnerSlot: '2' },
        { winnerSlot: '1' },
      ],
    },
    sourceClient: 'dock',
    apiKeyId: key.id,
  });
  sqlite.setRoomSessionId(room.id, null);

  const wiped = sqlite.discardRoomSessionEvents(room.id, matchId);
  assert('keyed discard refuses completed start+end pair', wiped === 0, `deleted=${wiped}`);
  const endStill = sqlite.findMatchingSessionEnd(room.id, matchId);
  const startStill = sqlite.findMatchingSessionStart(room.id, matchId);
  assert('completed end still present after refused discard', !!endStill);
  assert('completed start still present after refused discard', !!startStill);

  const reopened = sqlite.reopenRoomMatchSession(room.id, matchId);
  assert('reopen deletes end row', reopened.deleted === 1, JSON.stringify(reopened));
  assert('reopen restores room session id', reopened.sessionId === matchId, JSON.stringify(reopened));
  assert('no end after reopen', !sqlite.findMatchingSessionEnd(room.id, matchId));
  assert('start kept after reopen', !!sqlite.findMatchingSessionStart(room.id, matchId));
  const live = sqlite.getRoomSessionState(room.id);
  assert('room session live after reopen', live?.sessionId === matchId, JSON.stringify(live));

  const openDiscard = sqlite.discardRoomSessionEvents(room.id, matchId);
  assert('keyed discard removes unpaired start after reopen', openDiscard >= 1, `deleted=${openDiscard}`);
  assert('start gone after open discard', !sqlite.findMatchingSessionStart(room.id, matchId));

  console.log(failed ? `\n${failed} failed` : '\nAll session-reopen unit checks passed');
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
