import * as sqlite from '../db/sqlite.js';
import { getAccountStats } from './account-stats.js';

/**
 * Future whole-account public-stats toggle.
 * Always true for now — flip when accounts.public_stats_enabled (or similar) ships.
 */
export function accountAllowsPublicStats(_accountId) {
  return true;
}

function parseMatchDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let iso = raw;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    if (!/[zZ]$/.test(iso)) iso += 'Z';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC calendar YYYY-MM-DD for date-filter comparison (deterministic on the server). */
export function matchDateYmd(match) {
  const d = parseMatchDate(match?.completedAt || match?.startedAt);
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

export function normalizeLeaderboardScope({ eventQuery, dateFrom, dateTo } = {}) {
  const event = String(eventQuery || '').trim();
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  return {
    eventQuery: event.slice(0, 60),
    dateFrom: ymd.test(from) ? from : '',
    dateTo: ymd.test(to) ? to : '',
  };
}

export function scopeHasFilter(scope) {
  return !!(scope?.eventQuery || scope?.dateFrom || scope?.dateTo);
}

export function matchPassesScopeFilters(match, scope) {
  const eventQuery = String(scope?.eventQuery || '').trim().toLowerCase();
  if (eventQuery) {
    const info = String(match?.gameInfo || '').toLowerCase();
    if (!info.includes(eventQuery)) return false;
  }
  const dateFrom = String(scope?.dateFrom || '').trim();
  const dateTo = String(scope?.dateTo || '').trim();
  if (dateFrom || dateTo) {
    const ymd = matchDateYmd(match);
    if (!ymd) return false;
    if (dateFrom && ymd < dateFrom) return false;
    if (dateTo && ymd > dateTo) return false;
  }
  return true;
}

function resolveMatchResult(match) {
  const raw = match?.winnerSlot != null ? String(match.winnerSlot) : '';
  if (raw === '1' || raw === '2') return { winnerSlot: raw, isDraw: false };
  if (raw === 'draw' || raw === 'tie' || raw === '0') return { winnerSlot: null, isDraw: true };
  const scores = match?.scores;
  if (!scores || typeof scores !== 'object') return { winnerSlot: null, isDraw: false };
  const p1 = Number(scores.p1) || 0;
  const p2 = Number(scores.p2) || 0;
  if (p1 > p2) return { winnerSlot: '1', isDraw: false };
  if (p2 > p1) return { winnerSlot: '2', isDraw: false };
  return { winnerSlot: null, isDraw: true };
}

/** Re-aggregate player rows from a filtered match list (completed matches only for W/L). */
export function statsFromMatches(matches) {
  const playerMap = new Map();
  function touch(id, name) {
    const display = String(name || '').trim();
    const key = String(id || '').trim() || display.toLowerCase();
    if (!key) return null;
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        id: key,
        name: display || key,
        gamesWon: 0,
        gamesDrawn: 0,
        gamesLost: 0,
        racksWon: 0,
        racksLost: 0,
        highestBreak: 0,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 0,
        ballsPotted: 0,
        fouls: 0,
        createdAt: null,
        lastPlayedAt: null,
      });
    } else if (display) {
      playerMap.get(key).name = display;
    }
    return playerMap.get(key);
  }

  for (const match of matches || []) {
    const p1 = touch(match.player1Id, match.player1Name);
    const p2 = touch(match.player2Id, match.player2Name);
    if (!p1 || !p2) continue;
    if (match.status && match.status !== 'completed') continue;

    if (match.scores && match.gameType !== 'game4') {
      const s1 = Number(match.scores.p1) || 0;
      const s2 = Number(match.scores.p2) || 0;
      p1.racksWon += s1;
      p1.racksLost += s2;
      p2.racksWon += s2;
      p2.racksLost += s1;
    }

    const result = resolveMatchResult(match);
    if (result.winnerSlot === '1' || result.winnerSlot === '2') {
      const winner = result.winnerSlot === '1' ? p1 : p2;
      const loser = result.winnerSlot === '1' ? p2 : p1;
      winner.gamesWon += 1;
      loser.gamesLost += 1;
    } else if (result.isDraw) {
      p1.gamesDrawn += 1;
      p2.gamesDrawn += 1;
    }

    p1.highestBreak = Math.max(p1.highestBreak, Number(match.highestBreakP1) || 0);
    p2.highestBreak = Math.max(p2.highestBreak, Number(match.highestBreakP2) || 0);
    p1.highestRun = Math.max(p1.highestRun, Number(match.highestRunP1) || 0);
    p2.highestRun = Math.max(p2.highestRun, Number(match.highestRunP2) || 0);
    p1.breakAndRuns += Number(match.breakAndRunsP1) || 0;
    p2.breakAndRuns += Number(match.breakAndRunsP2) || 0;
    p1.tableRuns += Number(match.tableRunsP1) || 0;
    p2.tableRuns += Number(match.tableRunsP2) || 0;
    p1.ballsPotted += Number(match.ballsP1) || 0;
    p2.ballsPotted += Number(match.ballsP2) || 0;
    p1.fouls += Number(match.foulsP1) || 0;
    p2.fouls += Number(match.foulsP2) || 0;
    const playedAt = match.completedAt || match.startedAt;
    if (playedAt) {
      if (!p1.lastPlayedAt || playedAt > p1.lastPlayedAt) p1.lastPlayedAt = playedAt;
      if (!p2.lastPlayedAt || playedAt > p2.lastPlayedAt) p2.lastPlayedAt = playedAt;
    }
  }
  return { matches: matches || [], players: Array.from(playerMap.values()) };
}

function sanitizePlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    gamesWon: Number(player.gamesWon) || 0,
    gamesDrawn: Number(player.gamesDrawn) || 0,
    gamesLost: Number(player.gamesLost) || 0,
    racksWon: Number(player.racksWon) || 0,
    racksLost: Number(player.racksLost) || 0,
    highestBreak: Number(player.highestBreak) || 0,
    highestRun: Number(player.highestRun) || 0,
    breakAndRuns: Number(player.breakAndRuns) || 0,
    tableRuns: Number(player.tableRuns) || 0,
    ballsPotted: Number(player.ballsPotted) || 0,
    fouls: Number(player.fouls) || 0,
    createdAt: player.createdAt || null,
    lastPlayedAt: player.lastPlayedAt || null,
  };
}

function sanitizeMatch(match) {
  if (!match) return null;
  return {
    id: match.id,
    startEventId: match.startEventId,
    roomId: match.roomId || null,
    tableLabel: match.tableLabel || null,
    player1Id: match.player1Id || null,
    player2Id: match.player2Id || null,
    player1Name: match.player1Name,
    player2Name: match.player2Name,
    gameType: match.gameType || 'game1',
    gameInfo: match.gameInfo || '',
    startedAt: match.startedAt || null,
    completedAt: match.completedAt || null,
    durationSeconds: match.durationSeconds ?? null,
    status: match.status || 'completed',
    winnerSlot: match.winnerSlot ?? null,
    scores: match.scores || null,
    racks: Array.isArray(match.racks) ? match.racks : [],
    highestBreakP1: Number(match.highestBreakP1) || 0,
    highestBreakP2: Number(match.highestBreakP2) || 0,
    highestRunP1: Number(match.highestRunP1) || 0,
    highestRunP2: Number(match.highestRunP2) || 0,
    breakAndRunsP1: Number(match.breakAndRunsP1) || 0,
    breakAndRunsP2: Number(match.breakAndRunsP2) || 0,
    tableRunsP1: Number(match.tableRunsP1) || 0,
    tableRunsP2: Number(match.tableRunsP2) || 0,
    ballsP1: Number(match.ballsP1) || 0,
    ballsP2: Number(match.ballsP2) || 0,
    foulsP1: Number(match.foulsP1) || 0,
    foulsP2: Number(match.foulsP2) || 0,
  };
}

function matchInvolvesPlayer(match, playerId) {
  const id = String(playerId || '').trim();
  if (!id || !match) return false;
  return String(match.player1Id || '') === id || String(match.player2Id || '') === id;
}

function sortLeaderboardPlayers(players) {
  return (players || []).slice().sort((a, b) => {
    const aPlayed = (Number(a.gamesWon) || 0) + (Number(a.gamesDrawn) || 0) + (Number(a.gamesLost) || 0) > 0;
    const bPlayed = (Number(b.gamesWon) || 0) + (Number(b.gamesDrawn) || 0) + (Number(b.gamesLost) || 0) > 0;
    if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
    if (!aPlayed) {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    }
    let cmp = (b.gamesWon || 0) - (a.gamesWon || 0);
    if (!cmp) cmp = (b.gamesDrawn || 0) - (a.gamesDrawn || 0);
    if (!cmp) cmp = (b.racksWon || 0) - (a.racksWon || 0);
    if (!cmp) {
      cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    }
    return cmp;
  });
}

/**
 * @returns {{ player: object, matches: object[] } | null}
 */
export function getPublicPlayerStats(playerId, limit = 5000) {
  const row = sqlite.getAccountPlayerById(playerId);
  if (!row) return null;
  if (!accountAllowsPublicStats(row.account_id)) return null;

  const stats = getAccountStats(row.account_id, limit);
  const matches = (stats.matches || [])
    .filter((m) => matchInvolvesPlayer(m, row.id))
    .map(sanitizeMatch)
    .filter(Boolean);

  const fromRoster = (stats.players || []).find((p) => String(p.id) === String(row.id));
  const fromMatches = statsFromMatches(matches.filter((m) => m.status === 'completed')).players
    .find((p) => String(p.id) === String(row.id));

  const player = sanitizePlayer({
    ...(fromRoster || {}),
    ...(fromMatches || {}),
    id: row.id,
    name: row.name || fromRoster?.name || fromMatches?.name || row.id,
    createdAt: row.created_at || fromRoster?.createdAt || null,
  });

  return { player, matches };
}

/**
 * Live leaderboard for a stored share scope.
 * @returns {{ eventQuery: string, dateFrom: string, dateTo: string, players: object[] } | null}
 */
export function getPublicLeaderboardByToken(token, limit = 5000) {
  const share = sqlite.getLeaderboardShare(token);
  if (!share) return null;
  if (!accountAllowsPublicStats(share.account_id)) return null;

  const scope = {
    eventQuery: share.event_query || '',
    dateFrom: share.date_from || '',
    dateTo: share.date_to || '',
  };
  if (!scopeHasFilter(scope)) return null;

  const stats = getAccountStats(share.account_id, limit);
  const scopedMatches = (stats.matches || []).filter(
    (m) => m && m.status === 'completed' && matchPassesScopeFilters(m, scope)
  );
  const aggregated = statsFromMatches(scopedMatches);
  const rosterById = new Map((stats.players || []).map((p) => [String(p.id), p]));
  for (const p of aggregated.players) {
    const src = rosterById.get(String(p.id));
    if (src?.createdAt) p.createdAt = src.createdAt;
    if (src?.name) p.name = src.name;
  }

  return {
    eventQuery: scope.eventQuery,
    dateFrom: scope.dateFrom || null,
    dateTo: scope.dateTo || null,
    players: sortLeaderboardPlayers(aggregated.players).map(sanitizePlayer),
  };
}
