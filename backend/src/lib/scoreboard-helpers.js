/**
 * Pure scoreboard helpers for Node API (ESM).
 * Keep formulas identical to common/js/scoreboard_helpers.js.
 */

export function clampScore(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 999);
}

export function truncatePlayerName(name) {
  return String(name || '').trim().slice(0, 20);
}

/** Lowercase trimmed name for roster matching. */
export function normalizePlayerNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Display name: trim + max 20 chars (events / match payloads). */
export function normalizePlayerDisplayName(name) {
  return String(name || '').trim().slice(0, 20);
}

export function parseRaceTarget(raceInfo, gameType) {
  const raceString = String(raceInfo || '').trim();
  if (!raceString) return null;
  const matches = raceString.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const target = parseInt(matches[matches.length - 1], 10);
  if (!Number.isFinite(target) || target <= 0) return null;
  if (gameType === 'game8') {
    return Math.floor(target / 2) + 1;
  }
  return target;
}

export function isRaceLocked(p1Score, p2Score, raceTarget) {
  if (raceTarget === null || raceTarget === undefined) return false;
  const p1 = Number(p1Score) || 0;
  const p2 = Number(p2Score) || 0;
  return p1 >= raceTarget || p2 >= raceTarget;
}

export function resolveWinnerSlot(winnerId, p1Id, p2Id) {
  if (winnerId == null || winnerId === '') return null;
  if (winnerId === '1' || winnerId === 1) return '1';
  if (winnerId === '2' || winnerId === 2) return '2';
  if (p1Id != null && winnerId === p1Id) return '1';
  if (p2Id != null && winnerId === p2Id) return '2';
  return null;
}
