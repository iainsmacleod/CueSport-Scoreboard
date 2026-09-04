import * as sqlite from '../db/sqlite.js';

function tableLabel(event) {
  const instance = (event.instance_key || '').trim();
  if (event.dock_label && event.dock_label !== 'Main table' && event.dock_label !== 'Default Room') {
    return event.dock_label;
  }
  if (instance && instance !== 'default') return instance;
  return event.room_label || 'Table';
}

export function pairSessionEvents(events) {
  const chronological = events.slice().reverse();
  const byKey = new Map();
  const unmatchedByRoom = new Map();
  const records = [];

  function pushUnmatched(roomId, rec) {
    if (!unmatchedByRoom.has(roomId)) unmatchedByRoom.set(roomId, []);
    unmatchedByRoom.get(roomId).push(rec);
  }

  function takeUnmatched(roomId, rec) {
    const stack = unmatchedByRoom.get(roomId);
    if (!stack) return;
    const idx = rec ? stack.indexOf(rec) : stack.length - 1;
    if (idx >= 0) stack.splice(idx, 1);
  }

  for (const ev of chronological) {
    if (ev.event_type === 'session:start') {
      const key = ev.payload?.sessionId || ev.session_id || ev.id;
      const rec = { start: ev, end: null };
      byKey.set(key, rec);
      records.push(rec);
      pushUnmatched(ev.room_id, rec);
    } else if (ev.event_type === 'session:end') {
      const key = ev.payload?.matchId || ev.payload?.sessionId || ev.session_id;
      let rec = key ? byKey.get(key) : null;
      if (!rec) {
        const stack = unmatchedByRoom.get(ev.room_id) || [];
        rec = stack[stack.length - 1] || null;
      }
      if (rec) {
        rec.end = ev;
        takeUnmatched(ev.room_id, rec);
      }
    }
  }
  return records;
}

export function summarizeAccountStats(events) {
  const pairs = pairSessionEvents(events);
  const playerMap = new Map();
  const tables = new Map();

  function getPlayer(name) {
    const display = String(name || '').trim();
    const key = display.toLowerCase();
    if (!key) return null;
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        id: key,
        name: display,
        gamesWon: 0,
        gamesLost: 0,
        racksWon: 0,
        racksLost: 0,
        highestBreak: 0,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 0,
        ballsPotted: 0,
        fouls: 0,
        lastPlayedAt: null,
      });
    }
    return playerMap.get(key);
  }

  const matches = [];
  for (const pair of pairs) {
    const start = pair.start;
    if (!start) continue;
    const sp = start.payload || {};
    const end = pair.end;
    const ep = end ? (end.payload || {}) : {};
    const p1Name = sp.player1 || '';
    const p2Name = sp.player2 || '';
    if (!p1Name || !p2Name) continue;

    const label = tableLabel(start);
    tables.set(start.room_id, { roomId: start.room_id, label });
    const gameType = sp.gameType || 'game1';
    const isStraight = gameType === 'game4';

    const extras = {
      highestBreakP1: Number(ep.highestBreakP1) || 0,
      highestBreakP2: Number(ep.highestBreakP2) || 0,
      highestRunP1: Number(ep.highestRunP1) || 0,
      highestRunP2: Number(ep.highestRunP2) || 0,
      breakAndRunsP1: Number(ep.breakAndRunsP1) || 0,
      breakAndRunsP2: Number(ep.breakAndRunsP2) || 0,
      tableRunsP1: Number(ep.tableRunsP1) || 0,
      tableRunsP2: Number(ep.tableRunsP2) || 0,
      ballsP1: Number(ep.ballsP1) || 0,
      ballsP2: Number(ep.ballsP2) || 0,
      foulsP1: Number(ep.foulsP1) || 0,
      foulsP2: Number(ep.foulsP2) || 0,
    };
    // Legacy straight sessions stored run length under highestBreak*.
    if (isStraight) {
      if (!extras.highestRunP1 && extras.highestBreakP1) extras.highestRunP1 = extras.highestBreakP1;
      if (!extras.highestRunP2 && extras.highestBreakP2) extras.highestRunP2 = extras.highestBreakP2;
      extras.highestBreakP1 = 0;
      extras.highestBreakP2 = 0;
    }

    const match = {
      id: start.payload?.sessionId || start.session_id || start.id,
      startEventId: start.id,
      endEventId: end ? end.id : null,
      roomId: start.room_id,
      tableLabel: label,
      player1Name: p1Name,
      player2Name: p2Name,
      gameType,
      gameInfo: String(ep.gameInfo != null ? ep.gameInfo : (sp.gameInfo || '')).trim(),
      startedAt: start.created_at,
      completedAt: end ? end.created_at : null,
      status: end ? 'completed' : 'active',
      winnerSlot: ep.winnerSlot != null ? String(ep.winnerSlot) : null,
      scores: ep.scores || null,
      reason: ep.reason || null,
      ...extras,
    };
    matches.push(match);

    if (!end) continue;
    const p1 = getPlayer(p1Name);
    const p2 = getPlayer(p2Name);
    if (!p1 || !p2) continue;

    if (match.winnerSlot === '1' || match.winnerSlot === '2') {
      const winner = match.winnerSlot === '1' ? p1 : p2;
      const loser = match.winnerSlot === '1' ? p2 : p1;
      winner.gamesWon += 1;
      loser.gamesLost += 1;
      if (ep.scores) {
        const wRacks = Number(match.winnerSlot === '1' ? ep.scores.p1 : ep.scores.p2) || 0;
        const lRacks = Number(match.winnerSlot === '1' ? ep.scores.p2 : ep.scores.p1) || 0;
        winner.racksWon += wRacks;
        winner.racksLost += lRacks;
        loser.racksWon += lRacks;
        loser.racksLost += wRacks;
      }
    }

    p1.highestBreak = Math.max(p1.highestBreak, extras.highestBreakP1);
    p2.highestBreak = Math.max(p2.highestBreak, extras.highestBreakP2);
    p1.highestRun = Math.max(p1.highestRun, extras.highestRunP1);
    p2.highestRun = Math.max(p2.highestRun, extras.highestRunP2);
    p1.breakAndRuns += extras.breakAndRunsP1;
    p2.breakAndRuns += extras.breakAndRunsP2;
    p1.tableRuns += extras.tableRunsP1;
    p2.tableRuns += extras.tableRunsP2;
    p1.ballsPotted += extras.ballsP1;
    p2.ballsPotted += extras.ballsP2;
    p1.fouls += extras.foulsP1;
    p2.fouls += extras.foulsP2;

    const playedAt = match.completedAt || match.startedAt;
    if (playedAt) {
      if (!p1.lastPlayedAt || playedAt > p1.lastPlayedAt) p1.lastPlayedAt = playedAt;
      if (!p2.lastPlayedAt || playedAt > p2.lastPlayedAt) p2.lastPlayedAt = playedAt;
    }
  }

  matches.sort((a, b) => String(b.completedAt || b.startedAt || '').localeCompare(String(a.completedAt || a.startedAt || '')));
  const players = Array.from(playerMap.values()).sort((a, b) =>
    b.gamesWon - a.gamesWon || b.racksWon - a.racksWon || a.name.localeCompare(b.name)
  );

  return {
    summary: {
      matches: matches.filter((m) => m.status === 'completed').length,
      players: players.length,
      tables: tables.size,
    },
    players,
    matches,
    tables: Array.from(tables.values()).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Account stats for HTTP and WebSocket dock clients. */
export function getAccountStats(accountId, limit = 5000) {
  const events = sqlite.getAccountSessionEvents(accountId, limit);
  return summarizeAccountStats(events);
}
