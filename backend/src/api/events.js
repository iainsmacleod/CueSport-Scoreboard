import * as sqlite from '../db/sqlite.js';
import { resolveAccountFromRequest } from './accounts.js';
import { getAccountStats, pairSessionEvents } from '../stats/account-stats.js';

const GAME_TYPE_IDS = new Set(['game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8']);

function normalizePlayerName(name) {
  return String(name || '').trim().slice(0, 20);
}

function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function toSqliteDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function clampScore(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 999);
}

function deriveWinnerSlot(p1, p2) {
  if (p1 > p2) return '1';
  if (p2 > p1) return '2';
  return null;
}

function findPairByStartId(accountId, startEventId) {
  const events = sqlite.getAccountSessionEvents(accountId, 10000);
  return pairSessionEvents(events).find((pair) => pair.start && pair.start.id === startEventId) || null;
}

function assertEventAccount(event, accountId) {
  return event && sqlite.roomBelongsToAccount(event.room_id, accountId);
}

export async function registerEventRoutes(app) {
  app.get('/api/rooms/:roomId/events', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { roomId } = request.params;
    if (!sqlite.roomBelongsToAccount(roomId, account.id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const limit = parseInt(request.query.limit || '100', 10);
    return sqlite.getMatchEvents(roomId, limit);
  });

  app.get('/api/stats', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const limit = parseInt(request.query.limit || '5000', 10);
    return getAccountStats(account.id, limit);
  });

  app.patch('/api/stats/matches/:startEventId', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { startEventId } = request.params;
    const pair = findPairByStartId(account.id, startEventId);
    if (!pair?.start || !assertEventAccount(pair.start, account.id)) {
      return reply.code(404).send({ error: 'Match not found' });
    }
    if (!pair.end) {
      return reply.code(400).send({ error: 'Only completed matches can be edited' });
    }

    const body = request.body || {};
    const player1Name = normalizePlayerName(body.player1Name);
    const player2Name = normalizePlayerName(body.player2Name);
    const gameType = GAME_TYPE_IDS.has(body.gameType) ? body.gameType : (pair.start.payload?.gameType || 'game1');
    if (!player1Name || !player2Name) {
      return reply.code(400).send({ error: 'Both player names are required' });
    }
    if (namesEqual(player1Name, player2Name)) {
      return reply.code(400).send({ error: 'Players must be different' });
    }
    const scores = {
      p1: clampScore(body.scores?.p1 ?? pair.end.payload?.scores?.p1 ?? 0),
      p2: clampScore(body.scores?.p2 ?? pair.end.payload?.scores?.p2 ?? 0),
    };
    const winnerSlot = deriveWinnerSlot(scores.p1, scores.p2);
    const completedAt = toSqliteDateTime(body.completedAt);

    const gameInfo = String(body.gameInfo != null ? body.gameInfo : (pair.start.payload?.gameInfo || '')).trim().slice(0, 60);
    const startPayload = {
      ...(pair.start.payload || {}),
      player1: player1Name,
      player2: player2Name,
      gameType,
      gameInfo,
    };
    const endPayload = {
      ...(pair.end.payload || {}),
      winnerSlot,
      scores,
      gameInfo,
      reason: pair.end.payload?.reason || 'edited',
      highestBreakP1: gameType === 'game8'
        ? clampScore(body.highestBreakP1 ?? pair.end.payload?.highestBreakP1 ?? 0)
        : 0,
      highestBreakP2: gameType === 'game8'
        ? clampScore(body.highestBreakP2 ?? pair.end.payload?.highestBreakP2 ?? 0)
        : 0,
      highestRunP1: gameType === 'game4'
        ? clampScore(body.highestRunP1 ?? pair.end.payload?.highestRunP1 ?? 0)
        : 0,
      highestRunP2: gameType === 'game4'
        ? clampScore(body.highestRunP2 ?? pair.end.payload?.highestRunP2 ?? 0)
        : 0,
      breakAndRunsP1: clampScore(body.breakAndRunsP1 ?? pair.end.payload?.breakAndRunsP1 ?? 0),
      breakAndRunsP2: clampScore(body.breakAndRunsP2 ?? pair.end.payload?.breakAndRunsP2 ?? 0),
      tableRunsP1: clampScore(body.tableRunsP1 ?? pair.end.payload?.tableRunsP1 ?? 0),
      tableRunsP2: clampScore(body.tableRunsP2 ?? pair.end.payload?.tableRunsP2 ?? 0),
      ballsP1: clampScore(body.ballsP1 ?? pair.end.payload?.ballsP1 ?? 0),
      ballsP2: clampScore(body.ballsP2 ?? pair.end.payload?.ballsP2 ?? 0),
      foulsP1: clampScore(body.foulsP1 ?? pair.end.payload?.foulsP1 ?? 0),
      foulsP2: clampScore(body.foulsP2 ?? pair.end.payload?.foulsP2 ?? 0),
    };

    sqlite.updateMatchEvent(pair.start.id, { payload: startPayload });
    sqlite.updateMatchEvent(pair.end.id, { payload: endPayload, createdAt: completedAt || undefined });
    sqlite.upsertAccountPlayer(account.id, player1Name);
    sqlite.upsertAccountPlayer(account.id, player2Name);
    return { ok: true };
  });

  app.delete('/api/stats/matches/:startEventId', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { startEventId } = request.params;
    const pair = findPairByStartId(account.id, startEventId);
    if (!pair?.start || !assertEventAccount(pair.start, account.id)) {
      return reply.code(404).send({ error: 'Match not found' });
    }
    const deleted = sqlite.deleteMatchEvents([pair.start.id, pair.end?.id]);
    return { ok: true, deleted };
  });

  app.patch('/api/stats/players', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const fromName = normalizePlayerName(request.body?.from);
    const toName = normalizePlayerName(request.body?.to);
    if (!fromName || !toName) {
      return reply.code(400).send({ error: 'from and to names are required' });
    }
    if (namesEqual(fromName, toName)) {
      return { ok: true, updated: 0 };
    }
    const events = sqlite.getAccountSessionEvents(account.id, 10000);
    let updated = 0;
    for (const ev of events) {
      if (ev.event_type !== 'session:start') continue;
      if (!sqlite.roomBelongsToAccount(ev.room_id, account.id)) continue;
      const payload = { ...(ev.payload || {}) };
      let changed = false;
      if (namesEqual(payload.player1, fromName)) {
        payload.player1 = toName;
        changed = true;
      }
      if (namesEqual(payload.player2, fromName)) {
        payload.player2 = toName;
        changed = true;
      }
      if (changed) {
        sqlite.updateMatchEvent(ev.id, { payload });
        updated += 1;
      }
    }
    sqlite.renameAccountPlayerRoster(account.id, fromName, toName);
    return { ok: true, updated };
  });

  app.get('/api/streams', async () => {
    return sqlite.getActiveLiveStreams(30);
  });
}
