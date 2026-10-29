#!/usr/bin/env node
/**
 * Smoke / unit tests for public player stats + event leaderboard shares.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuesport-public-stats-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.ALLOW_DEV_AUTH = 'true';
process.env.DEV_AUTH_SECRET = 'public-stats-unit-test-secret';
process.env.ACCOUNT_FINGERPRINT_SECRET = 'public-stats-fingerprint-secret';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const dashAppPath = path.join(__dirname, '..', 'web', 'dashboard', 'app.js');
  const dashSrc = fs.readFileSync(dashAppPath, 'utf8');
  const copyDecls = dashSrc.match(/async function copyTextToClipboard\s*\(/g) || [];
  assert('dashboard has single copyTextToClipboard', copyDecls.length === 1, `count=${copyDecls.length}`);

  const sqlite = await import('../src/db/sqlite.js');
  const publicStats = await import('../src/stats/public-stats.js');

  assert('accountAllowsPublicStats defaults true', publicStats.accountAllowsPublicStats('any') === true);
  assert(
    'scopeHasFilter requires at least one field',
    publicStats.scopeHasFilter(publicStats.normalizeLeaderboardScope({})) === false
  );
  assert(
    'scopeHasFilter accepts event only',
    publicStats.scopeHasFilter(publicStats.normalizeLeaderboardScope({ eventQuery: 'Open' })) === true
  );

  const { account } = sqlite.ensureAccount('public-stats@example.com', 'auth-public-stats');
  const p1 = sqlite.createAccountPlayer(account.id, 'Alice');
  const p2 = sqlite.createAccountPlayer(account.id, 'Bob');
  assert('created two players', !!(p1?.id && p2?.id));

  const missing = publicStats.getPublicPlayerStats('00000000-0000-4000-8000-000000000099');
  assert('unknown player returns null', missing == null);

  const emptyPlayer = publicStats.getPublicPlayerStats(p1.id);
  assert('public player payload without matches', !!emptyPlayer?.player && emptyPlayer.player.id === p1.id);
  assert('empty player has no matches', Array.isArray(emptyPlayer.matches) && emptyPlayer.matches.length === 0);
  assert('public player strips accountEmail', emptyPlayer.player.accountEmail == null);

  const key = sqlite.createApiKey(account.id, 'Public stats dock', 'administrator');
  const room = sqlite.ensureRoomForApiKey(account.id, key.id, {
    instanceKey: 'default',
    label: 'Public stats table',
  });
  const matchId = 'public-stats-match-1';
  sqlite.insertMatchEvent({
    accountId: account.id,
    roomId: room.id,
    sessionId: matchId,
    eventType: 'session:start',
    payload: {
      sessionId: matchId,
      matchId,
      player1: 'Alice',
      player2: 'Bob',
      player1Id: p1.id,
      player2Id: p2.id,
      gameType: 'game1',
      gameInfo: 'Spring Open',
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
      scores: { p1: 5, p2: 2 },
      player1: 'Alice',
      player2: 'Bob',
      player1Id: p1.id,
      player2Id: p2.id,
      gameInfo: 'Spring Open',
    },
    sourceClient: 'dock',
    apiKeyId: key.id,
  });

  const alice = publicStats.getPublicPlayerStats(p1.id);
  assert('public player includes match', alice?.matches?.length === 1, `matches=${alice?.matches?.length}`);
  assert('public player win recorded', alice.player.gamesWon === 1, JSON.stringify(alice.player));
  assert('public match has no streamUrl', alice.matches[0].streamUrl == null);

  const rejected = sqlite.upsertLeaderboardShare(account.id, {
    eventQuery: '',
    dateFrom: null,
    dateTo: null,
  });
  // DB allows insert of empty scope; API rejects it. Unit-level create still returns a token —
  // public resolve should refuse empty scope.
  assert('upsert empty scope still returns token shape', !!rejected?.token);
  assert(
    'empty-scope token not publicly resolvable',
    publicStats.getPublicLeaderboardByToken(rejected.token) == null
  );

  const share1 = sqlite.upsertLeaderboardShare(account.id, {
    eventQuery: 'Spring Open',
    dateFrom: null,
    dateTo: null,
  });
  assert('create event share', !!share1?.token && share1.created === true, JSON.stringify(share1));
  const share2 = sqlite.upsertLeaderboardShare(account.id, {
    eventQuery: 'Spring Open',
    dateFrom: null,
    dateTo: null,
  });
  assert('reuse same event share token', share2?.token === share1.token && share2.created === false);

  const board = publicStats.getPublicLeaderboardByToken(share1.token);
  assert('public leaderboard resolves', !!board, 'null board');
  assert('leaderboard keeps event query', board.eventQuery === 'Spring Open');
  assert('leaderboard has Alice', board.players.some((p) => p.id === p1.id && p.gamesWon === 1));
  assert('leaderboard has Bob', board.players.some((p) => p.id === p2.id && p.gamesLost === 1));
  assert('leaderboard players sanitized', board.players.every((p) => p.accountEmail == null));

  const other = publicStats.getPublicLeaderboardByToken('lb_does_not_exist');
  assert('unknown share token returns null', other == null);

  const byId = sqlite.getAccountPlayerById(p1.id);
  assert('getAccountPlayerById finds player', byId?.id === p1.id && byId.account_id === account.id);

  console.log(failed ? `\n${failed} failed` : '\nAll public-stats unit checks passed');
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
