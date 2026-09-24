/**
 * Shared local ↔ cloud career stats parity helpers for smoke / scenario pages.
 * Load before test runners: <script src="stats_parity_helpers.js"></script>
 */
(function (global) {
  'use strict';

  const CAREER_KEYS = [
    'gamesWon',
    'gamesDrawn',
    'gamesLost',
    'racksWon',
    'racksLost',
    'breakAndRuns',
    'tableRuns',
    'ballsPotted',
    'highestBreak',
    'highestRun',
    'fouls',
  ];

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Normalize local player.stats / byGameType[g] or cloud player career into one shape.
   * Local ballsWon → ballsPotted; cloud ballsPotted stays ballsPotted.
   */
  function normalizeCareerSnapshot(statsLike) {
    const s = statsLike && typeof statsLike === 'object' ? statsLike : {};
    return {
      gamesWon: num(s.gamesWon),
      gamesDrawn: num(s.gamesDrawn),
      gamesLost: num(s.gamesLost),
      racksWon: num(s.racksWon),
      racksLost: num(s.racksLost),
      breakAndRuns: num(s.breakAndRuns),
      tableRuns: num(s.tableRuns),
      ballsPotted: num(s.ballsPotted != null ? s.ballsPotted : s.ballsWon),
      highestBreak: num(s.highestBreak),
      highestRun: num(s.highestRun),
      fouls: num(s.fouls),
    };
  }

  function typedCareerFromLocalPlayer(player, gameType) {
    if (!player || !player.stats) {
      return normalizeCareerSnapshot(null);
    }
    if (gameType && player.stats.byGameType && player.stats.byGameType[gameType]) {
      return normalizeCareerSnapshot(player.stats.byGameType[gameType]);
    }
    return normalizeCareerSnapshot(player.stats);
  }

  function typedCareerFromCloudPlayer(player, gameType) {
    if (!player) {
      return normalizeCareerSnapshot(null);
    }
    if (gameType && player.byGameType && player.byGameType[gameType]) {
      return normalizeCareerSnapshot(player.byGameType[gameType]);
    }
    return normalizeCareerSnapshot(player);
  }

  function careerDelta(before, after) {
    const a = normalizeCareerSnapshot(before);
    const b = normalizeCareerSnapshot(after);
    const out = {};
    CAREER_KEYS.forEach(function (k) {
      out[k] = b[k] - a[k];
    });
    return out;
  }

  function assertCareerParity(assertFn, suite, localDelta, cloudDelta, label) {
    const left = normalizeCareerSnapshot(localDelta);
    const right = normalizeCareerSnapshot(cloudDelta);
    const mismatches = [];
    CAREER_KEYS.forEach(function (k) {
      if (left[k] !== right[k]) {
        mismatches.push(k + ': local=' + left[k] + ' cloud=' + right[k]);
      }
    });
    const ok = mismatches.length === 0;
    assertFn(
      suite,
      (label || 'local↔cloud career parity') + (ok ? '' : ' — ' + mismatches.join('; ')),
      ok,
      ok ? JSON.stringify(left) : 'local ' + JSON.stringify(left) + ' vs cloud ' + JSON.stringify(right)
    );
    return ok;
  }

  /** Match-level extras from buildCloudMatchExtras / session:end payload. */
  function normalizeMatchExtras(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    return {
      winnerSlot: p.winnerSlot == null ? null : String(p.winnerSlot),
      scoresP1: num(p.scores && p.scores.p1 != null ? p.scores.p1 : p.scoreP1),
      scoresP2: num(p.scores && p.scores.p2 != null ? p.scores.p2 : p.scoreP2),
      breakAndRunsP1: num(p.breakAndRunsP1),
      breakAndRunsP2: num(p.breakAndRunsP2),
      tableRunsP1: num(p.tableRunsP1),
      tableRunsP2: num(p.tableRunsP2),
      ballsP1: num(p.ballsP1),
      ballsP2: num(p.ballsP2),
      highestBreakP1: num(p.highestBreakP1),
      highestBreakP2: num(p.highestBreakP2),
      highestRunP1: num(p.highestRunP1),
      highestRunP2: num(p.highestRunP2),
      foulsP1: num(p.foulsP1),
      foulsP2: num(p.foulsP2),
      rackCount: Array.isArray(p.racks) ? p.racks.length : 0,
    };
  }

  function findCloudPlayerByName(cloudData, name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want || !cloudData || !Array.isArray(cloudData.players)) {
      return null;
    }
    return cloudData.players.find(function (p) {
      return String(p.name || '').trim().toLowerCase() === want;
    }) || null;
  }

  global.StatsParity = {
    CAREER_KEYS: CAREER_KEYS,
    normalizeCareerSnapshot: normalizeCareerSnapshot,
    typedCareerFromLocalPlayer: typedCareerFromLocalPlayer,
    typedCareerFromCloudPlayer: typedCareerFromCloudPlayer,
    careerDelta: careerDelta,
    assertCareerParity: assertCareerParity,
    normalizeMatchExtras: normalizeMatchExtras,
    findCloudPlayerByName: findCloudPlayerByName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
