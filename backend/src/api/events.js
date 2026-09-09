import * as sqlite from '../db/sqlite.js';
import { resolveAccountFromRequest } from './accounts.js';
import { getAccountStats, pairSessionEvents } from '../stats/account-stats.js';
import {
  clampScore,
  normalizePlayerDisplayName,
} from '../lib/scoreboard-helpers.js';
import { broadcastRoomCommand, notifyAccountTables } from '../ws/room-hub.js';

const GAME_TYPE_IDS = new Set(['game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8']);

function normalizePlayerName(name) {
  return normalizePlayerDisplayName(name);
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

function deriveWinnerSlot(p1, p2) {
  if (p1 > p2) return '1';
  if (p2 > p1) return '2';
  return 'draw';
}

/** Normalize editable rack/frame rows from the dock/dashboard editor. */
function normalizeCloudRacks(rawRacks) {
  if (!Array.isArray(rawRacks)) return null;
  const racks = [];
  rawRacks.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const slotRaw = raw.winnerSlot != null ? String(raw.winnerSlot) : String(raw.winnerId || '');
    const winnerSlot = slotRaw === '1' || slotRaw === '2' ? slotRaw : null;
    if (!winnerSlot) return;
    const entry = {
      rackNumber: clampScore(raw.rackNumber) || (index + 1),
      winnerSlot,
      foulsP1: clampScore(raw.foulsP1),
      foulsP2: clampScore(raw.foulsP2),
    };
    if (raw.timestamp) entry.timestamp = String(raw.timestamp);
    if (raw.startedAt) entry.startedAt = String(raw.startedAt);
    const dur = Number(raw.durationSeconds);
    if (Number.isFinite(dur) && dur >= 0) {
      entry.durationSeconds = Math.round(dur);
    }
    if (raw.frameScore && typeof raw.frameScore === 'object') {
      entry.frameScore = {
        p1: clampScore(raw.frameScore.p1),
        p2: clampScore(raw.frameScore.p2),
      };
    }
    if (raw.highestBreakP1 != null || raw.highestBreakP2 != null) {
      entry.highestBreakP1 = clampScore(raw.highestBreakP1);
      entry.highestBreakP2 = clampScore(raw.highestBreakP2);
    }
    if (raw.highestRunP1 != null || raw.highestRunP2 != null) {
      entry.highestRunP1 = clampScore(raw.highestRunP1);
      entry.highestRunP2 = clampScore(raw.highestRunP2);
    }
    if (raw.breakAndRun) entry.breakAndRun = true;
    if (raw.tableRun) entry.tableRun = true;
    if (raw.breakerSlot === '1' || raw.breakerSlot === '2') {
      entry.breakerSlot = String(raw.breakerSlot);
    }
    if (raw.ballsP1 != null || raw.ballsP2 != null) {
      entry.ballsP1 = clampScore(raw.ballsP1);
      entry.ballsP2 = clampScore(raw.ballsP2);
    }
    racks.push(entry);
  });
  // Re-number sequentially after filtering incomplete rows.
  racks.forEach((r, i) => { r.rackNumber = i + 1; });
  return racks;
}

function aggregateExtrasFromRacks(racks, gameType) {
  const extras = {
    scores: { p1: 0, p2: 0 },
    highestBreakP1: 0,
    highestBreakP2: 0,
    highestRunP1: 0,
    highestRunP2: 0,
    breakAndRunsP1: 0,
    breakAndRunsP2: 0,
    tableRunsP1: 0,
    tableRunsP2: 0,
    foulsP1: 0,
    foulsP2: 0,
  };
  const isStraight = gameType === 'game4';
  const isSnooker = gameType === 'game8';
  (racks || []).forEach((r) => {
    if (r.winnerSlot === '1') extras.scores.p1 += 1;
    else if (r.winnerSlot === '2') extras.scores.p2 += 1;
    extras.foulsP1 += clampScore(r.foulsP1);
    extras.foulsP2 += clampScore(r.foulsP2);
    if (isSnooker) {
      extras.highestBreakP1 = Math.max(extras.highestBreakP1, clampScore(r.highestBreakP1));
      extras.highestBreakP2 = Math.max(extras.highestBreakP2, clampScore(r.highestBreakP2));
    }
    if (isStraight) {
      extras.highestRunP1 = Math.max(
        extras.highestRunP1,
        clampScore(r.highestRunP1 != null ? r.highestRunP1 : r.highestBreakP1)
      );
      extras.highestRunP2 = Math.max(
        extras.highestRunP2,
        clampScore(r.highestRunP2 != null ? r.highestRunP2 : r.highestBreakP2)
      );
    }
    if (r.breakAndRun) {
      if (r.winnerSlot === '1') extras.breakAndRunsP1 += 1;
      else if (r.winnerSlot === '2') extras.breakAndRunsP2 += 1;
    }
    if (r.tableRun) {
      if (r.winnerSlot === '1') extras.tableRunsP1 += 1;
      else if (r.winnerSlot === '2') extras.tableRunsP2 += 1;
    }
  });
  return extras;
}

function findPairByStartId(accountId, startEventId) {
  const events = sqlite.getAccountSessionEvents(accountId, 10000);
  return pairSessionEvents(events).find((pair) => pair.start && pair.start.id === startEventId) || null;
}

function assertEventAccount(event, accountId) {
  return !!(event && event.account_id === accountId);
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

    const normalizedRacks = Object.prototype.hasOwnProperty.call(body, 'racks')
      ? normalizeCloudRacks(body.racks)
      : null;
    if (normalizedRacks && normalizedRacks.length === 0) {
      return reply.code(400).send({ error: 'Add at least one rack/frame with a winner' });
    }

    let scores;
    let winnerSlot;
    let rackExtras = null;
    if (normalizedRacks) {
      rackExtras = aggregateExtrasFromRacks(normalizedRacks, gameType);
      scores = rackExtras.scores;
      winnerSlot = deriveWinnerSlot(scores.p1, scores.p2);
    } else {
      scores = {
        p1: clampScore(body.scores?.p1 ?? pair.end.payload?.scores?.p1 ?? 0),
        p2: clampScore(body.scores?.p2 ?? pair.end.payload?.scores?.p2 ?? 0),
      };
      winnerSlot = deriveWinnerSlot(scores.p1, scores.p2);
    }
    const completedAt = toSqliteDateTime(body.completedAt);

    const gameInfo = String(body.gameInfo != null ? body.gameInfo : (pair.start.payload?.gameInfo || '')).trim().slice(0, 60);
    const startPayload = {
      ...(pair.start.payload || {}),
      player1: player1Name,
      player2: player2Name,
      gameType,
      gameInfo,
    };
    const prevEnd = pair.end.payload || {};
    const endPayload = {
      ...prevEnd,
      winnerSlot,
      scores,
      gameInfo,
      reason: prevEnd.reason || 'edited',
      highestBreakP1: gameType === 'game8'
        ? clampScore(rackExtras ? rackExtras.highestBreakP1 : (body.highestBreakP1 ?? prevEnd.highestBreakP1 ?? 0))
        : 0,
      highestBreakP2: gameType === 'game8'
        ? clampScore(rackExtras ? rackExtras.highestBreakP2 : (body.highestBreakP2 ?? prevEnd.highestBreakP2 ?? 0))
        : 0,
      highestRunP1: gameType === 'game4'
        ? clampScore(rackExtras ? rackExtras.highestRunP1 : (body.highestRunP1 ?? prevEnd.highestRunP1 ?? 0))
        : 0,
      highestRunP2: gameType === 'game4'
        ? clampScore(rackExtras ? rackExtras.highestRunP2 : (body.highestRunP2 ?? prevEnd.highestRunP2 ?? 0))
        : 0,
      breakAndRunsP1: clampScore(
        rackExtras ? rackExtras.breakAndRunsP1 : (body.breakAndRunsP1 ?? prevEnd.breakAndRunsP1 ?? 0)
      ),
      breakAndRunsP2: clampScore(
        rackExtras ? rackExtras.breakAndRunsP2 : (body.breakAndRunsP2 ?? prevEnd.breakAndRunsP2 ?? 0)
      ),
      tableRunsP1: clampScore(
        rackExtras ? rackExtras.tableRunsP1 : (body.tableRunsP1 ?? prevEnd.tableRunsP1 ?? 0)
      ),
      tableRunsP2: clampScore(
        rackExtras ? rackExtras.tableRunsP2 : (body.tableRunsP2 ?? prevEnd.tableRunsP2 ?? 0)
      ),
      ballsP1: clampScore(body.ballsP1 ?? prevEnd.ballsP1 ?? 0),
      ballsP2: clampScore(body.ballsP2 ?? prevEnd.ballsP2 ?? 0),
      foulsP1: clampScore(rackExtras ? rackExtras.foulsP1 : (body.foulsP1 ?? prevEnd.foulsP1 ?? 0)),
      foulsP2: clampScore(rackExtras ? rackExtras.foulsP2 : (body.foulsP2 ?? prevEnd.foulsP2 ?? 0)),
    };
    if (normalizedRacks) {
      endPayload.racks = normalizedRacks;
    } else if (Array.isArray(prevEnd.racks)) {
      endPayload.racks = prevEnd.racks;
    }

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
    const abandoned = !pair.end;
    const roomId = pair.start.room_id || null;
    const dockMatchId = pair.start.payload?.sessionId
      || pair.start.payload?.matchId
      || null;
    const cloudSessionId = pair.start.session_id || null;
    const matchKey = dockMatchId || cloudSessionId || null;
    const deleted = sqlite.deleteMatchEvents([pair.start.id, pair.end?.id]);

    let dockNotified = false;
    if (abandoned && roomId) {
      // Open cloud match is gone; clear room session pointer so a later dock end
      // does not pair against a deleted start.
      sqlite.setRoomSessionId(roomId, null);
      // Relay when the room has live sockets (dock must be on this same process).
      dockNotified = broadcastRoomCommand(roomId, 'abandon_match', {
        matchId: matchKey,
        sessionId: matchKey,
        dockMatchId,
        cloudSessionId,
        startEventId: pair.start.id,
        message: 'This match was killed from CueSport Cloud. The game has been cleared.',
      });
    }
    notifyAccountTables(account.id, { immediate: true });

    return { ok: true, deleted, abandoned, dockNotified };
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
      if (ev.account_id !== account.id) continue;
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
