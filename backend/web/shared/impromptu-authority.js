/**
 * Impromptu table scoring authority — applies the same Cloud command vocabulary
 * as the OBS dock (cloud_commands.js), publishing mobile-compatible live state.
 * Hosted on the account-owner mobile session (no dock / overlay).
 */
import {
  clampScore,
  parseRaceTarget,
  isRaceLocked,
  truncatePlayerName,
  winnerSlotFromScores,
} from './scoreboard-helpers.js?v=8.0.0';

const POOL_BALL_COUNTS = {
  game1: 15, game2: 9, game3: 10, game4: 15,
  game5: 15, game6: 15, game7: 15, game8: 15,
};

const SNOOKER_POINTS = {
  'ball 1': 1, 'ball 2': 2, 'ball 3': 3, 'ball 4': 4,
  'ball 5': 5, 'ball 6': 6, 'ball 7': 7, 'ball 8': 20,
};

/** Dock foul picker keys (control_panel data-foul) — mobile SNOOKER_FOUL_POINTS uses these. */
const SNOOKER_FOUL_BY_KEY = {
  white: 4,
  yellow: 4,
  green: 4,
  brown: 4,
  blue: 5,
  pink: 6,
  black: 7,
  gold: 20,
};

const SNOOKER_FOUL_TARGET_DEFS = [
  { key: 'white', file: 'snooker-white-small.png', alt: 'White' },
  { key: 'yellow', file: 'snooker-yellow-small.png', alt: 'Yellow' },
  { key: 'green', file: 'snooker-green-small.png', alt: 'Green' },
  { key: 'brown', file: 'snooker-brown-small.png', alt: 'Brown' },
  { key: 'blue', file: 'snooker-blue-small.png', alt: 'Blue' },
  { key: 'pink', file: 'snooker-pink-small.png', alt: 'Pink' },
  { key: 'black', file: 'snooker-black-small.png', alt: 'Black' },
  { key: 'gold', file: 'snooker-gold-small.png', alt: 'Gold' },
];

function buildSnookerFoulTargets(state) {
  return SNOOKER_FOUL_TARGET_DEFS
    .filter((t) => t.key !== 'gold' || state.snookerGoldEnabled === true)
    .map((t) => ({ key: t.key, file: t.file, alt: t.alt }));
}

function resolveSnookerFoulPoints(foulKey) {
  const key = String(foulKey || '').trim().toLowerCase();
  if (SNOOKER_FOUL_BY_KEY[key] != null) return SNOOKER_FOUL_BY_KEY[key];
  // Legacy ball_N / ball N keys from early impromptu publishes.
  const n = parseInt(key.replace(/\D/g, ''), 10);
  if (Number.isFinite(n) && n >= 1 && n <= 7) return Math.max(4, n);
  if (n === 8) return 20;
  return 4;
}

/** Yellow → black clearance order (dock parity). */
const SNOOKER_CLEARANCE_ORDER = [2, 3, 4, 5, 6, 7];

function snookerBallNum(ballId) {
  const m = String(ballId || '').match(/^ball\s+(\d+)$/i);
  return m ? parseInt(m[1], 10) : NaN;
}

function ensureSnookerFrameState(state) {
  if (state._snookerPhase !== 'color') state._snookerPhase = 'red';
  const reds = Number(state._snookerRedsPotted);
  state._snookerRedsPotted = Number.isFinite(reds)
    ? Math.min(15, Math.max(0, reds))
    : 0;
  if (!state._snookerCleared || typeof state._snookerCleared !== 'object') {
    state._snookerCleared = {};
  }
  state._snookerFreeBallOffered = !!state._snookerFreeBallOffered;
  state._snookerFoulAwaitingPlayerChange = !!state._snookerFoulAwaitingPlayerChange;
  state._snookerGoldenBallFouled = !!state._snookerGoldenBallFouled;
}

function isSnookerColorCleared(state, num) {
  return !!(state._snookerCleared && state._snookerCleared[`ball ${num}`]);
}

function markSnookerColorCleared(state, num) {
  if (!state._snookerCleared) state._snookerCleared = {};
  state._snookerCleared[`ball ${num}`] = true;
}

function getNextSnookerClearanceColor(state) {
  for (const n of SNOOKER_CLEARANCE_ORDER) {
    if (!isSnookerColorCleared(state, n)) return n;
  }
  return null;
}

function resetSnookerFrame(state) {
  state._snookerPhase = 'red';
  state._snookerRedsPotted = 0;
  state._snookerCleared = {};
  state._snookerBreak = 0;
  state._snookerFreeBallOffered = false;
  state._snookerFoulAwaitingPlayerChange = false;
  state._snookerGoldenBallFouled = false;
}

function isSnookerGoldenBallAvailable(state) {
  if (state.snookerGoldEnabled !== true || state.gameType !== 'game8') return false;
  if (state._snookerGoldenBallFouled || isSnookerColorCleared(state, 8)) return false;
  if (!isSnookerColorCleared(state, 7)) return false;
  const pts = state.activePlayer === '2'
    ? (Number(state.p2Balls) || 0)
    : (Number(state.p1Balls) || 0);
  return pts >= 147;
}

const POCKET_RACK_TARGET = 8;

function isPocketScoreGame(state) {
  return state.gameType === 'game5' || state.gameType === 'game6';
}

function isStraightPool(state) {
  return state.gameType === 'game4';
}

function isBallFoulPenaltyGame(state) {
  return state.gameType === 'game4' || state.gameType === 'game5' || state.gameType === 'game6';
}

/** Dock allows ball counters below zero on foul; keep the same range. */
function clampSignedScore(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(999, Math.max(-999, n));
}

function objectBallCount(state) {
  const snooker = state.gameType === 'game8';
  return snooker ? 7 : (POOL_BALL_COUNTS[state.gameType || 'game1'] || 15);
}

function hasFadedObjectBalls(state) {
  const faded = state._potted || {};
  const count = objectBallCount(state);
  for (let n = 1; n <= count; n += 1) {
    if (faded[`ball ${n}`]) return true;
  }
  return false;
}

function maybeAwardPocketRack(state, playerSlot) {
  const slot = playerSlot === '2' || playerSlot === 2
    ? '2'
    : (playerSlot === '1' || playerSlot === 1
      ? '1'
      : (state.activePlayer === '2' ? '2' : '1'));
  const balls = Number(slot === '2' ? state.p2Balls : state.p1Balls) || 0;
  if (balls < POCKET_RACK_TARGET) return false;
  if (slot === '2') state.p2Score = clampScore((Number(state.p2Score) || 0) + 1);
  else state.p1Score = clampScore((Number(state.p1Score) || 0) + 1);
  prepareNextRackOrFrame(state, slot, { skipTrackerReset: false });
  return true;
}

/**
 * Dock postScore("add") setup for the next rack/frame:
 * zero ball counters, clear tracker (except Straight continuous),
 * reset snooker sequence on frame award, wipe undo, re-prompt breaker.
 * keepBallId: leave that ball faded through a brief win cooldown (8/9/10 game ball).
 */
function prepareNextRackOrFrame(state, winnerSlot, options = {}) {
  const skipTrackerReset = !!options.skipTrackerReset || isStraightPool(state);
  const keepBallId = options.keepBallId ? String(options.keepBallId) : '';
  state.p1Balls = 0;
  state.p2Balls = 0;
  state._undo = [];

  if (state.gameType === 'game8') {
    resetSnookerFrame(state);
    state.foulsP1 = 0;
    state.foulsP2 = 0;
    state._cooldown = null;
  } else if (!skipTrackerReset) {
    if (keepBallId) {
      state._potted = { [keepBallId]: true };
      state._pocketOwners = {
        [keepBallId]: (winnerSlot === '2' ? '2' : '1'),
      };
      startTrackerCooldown(state, keepBallId, 'rack_win');
    } else {
      state._potted = {};
      state._pocketOwners = {};
      state._cooldown = null;
    }
    state.playerBallSet = 'p1Open';
    state._ballSetOpenLastPotSlot = '';
    state._ballSetOpenSamePlayerPots = 0;
  }

  const raceTo = parseRaceTarget(state.raceInfo, state.gameType);
  if (isBreakerPromptEnabled(state) && !isRaceLocked(state.p1Score, state.p2Score, raceTo)) {
    state.rackBreakerSlot = '';
    if (winnerSlot === '1' || winnerSlot === '2') {
      state.lastRackWinnerSlot = winnerSlot;
    }
  }
}

function getGameWinningBallId(gameType) {
  if (gameType === 'game1') return 'ball 8';
  if (gameType === 'game2') return 'ball 9';
  if (gameType === 'game3') return 'ball 10';
  return null;
}

const TRACKER_COOLDOWN_MS = 500;
const EIGHT_LOW_GROUP = [1, 2, 3, 4, 5, 6, 7];
const EIGHT_HIGH_GROUP = [9, 10, 11, 12, 13, 14, 15];

function countFadedObjectBalls(state) {
  let count = 0;
  for (let n = 1; n <= 15; n += 1) {
    if (n === 8) continue;
    if (state._potted && state._potted[`ball ${n}`]) count += 1;
  }
  return count;
}

function areAllEightBallObjectBallsPotted(state) {
  for (let n = 1; n <= 15; n += 1) {
    if (n === 8) continue;
    if (!(state._potted && state._potted[`ball ${n}`])) return false;
  }
  return true;
}

function isEightBallGroupFullyPotted(state, numbers) {
  if (!numbers || !numbers.length) return false;
  return numbers.every((n) => !!(state._potted && state._potted[`ball ${n}`]));
}

function arePrecedingObjectBallsPotted(state, winNum) {
  for (let n = 1; n < winNum; n += 1) {
    if (!(state._potted && state._potted[`ball ${n}`])) return false;
  }
  return true;
}

function getEightBallGroupBallNumbersForSlot(state, slot) {
  if (state.useBallSet !== true) return null;
  const set = state.playerBallSet || 'p1Open';
  if (set !== 'p1red/smalls' && set !== 'p1yellow/bigs') return null;
  const selection = state.ballSelection || 'american';
  const p1HasLowGroup = selection === 'international'
    ? set === 'p1yellow/bigs'
    : set === 'p1red/smalls';
  const p1Group = p1HasLowGroup ? EIGHT_LOW_GROUP : EIGHT_HIGH_GROUP;
  if (slot === '1' || slot === 1) return p1Group;
  return p1HasLowGroup ? EIGHT_HIGH_GROUP : EIGHT_LOW_GROUP;
}

function isUnassignedEightBallClearForWin(state) {
  const active = state.activePlayer === '2' ? '2' : '1';
  if (getEightBallGroupBallNumbersForSlot(state, active)) return false;
  return isEightBallGroupFullyPotted(state, EIGHT_LOW_GROUP)
    || isEightBallGroupFullyPotted(state, EIGHT_HIGH_GROUP)
    || areAllEightBallObjectBallsPotted(state);
}

function getBallSetValueForPottedBall(num, activeSlot, selection) {
  let p1GetsRedSmalls;
  if (selection === 'international') {
    p1GetsRedSmalls = num >= 9 && num <= 15;
  } else {
    p1GetsRedSmalls = num >= 1 && num <= 7;
  }
  if (activeSlot === '1') {
    return p1GetsRedSmalls ? 'p1red/smalls' : 'p1yellow/bigs';
  }
  return p1GetsRedSmalls ? 'p1yellow/bigs' : 'p1red/smalls';
}

/** Auto-assign Chosen Ball while Open (8-Ball / Custom) — dock maybeAssignBallSetFromPot. */
function maybeAssignBallSetFromPot(state, ballId) {
  if (state.useBallSet !== true) return;
  if (state.gameType !== 'game1' && state.gameType !== 'game7') return;
  if ((state.playerBallSet || 'p1Open') !== 'p1Open') return;
  const num = snookerBallNum(ballId);
  if (!Number.isFinite(num) || num === 8 || num < 1 || num > 15) return;

  const active = state.activePlayer === '2' ? '2' : '1';
  if (state.gameType === 'game1') {
    const lastPotSlot = state._ballSetOpenLastPotSlot || '';
    let samePlayerPots = Number(state._ballSetOpenSamePlayerPots) || 0;
    if (lastPotSlot === active) samePlayerPots += 1;
    else samePlayerPots = 1;
    state._ballSetOpenLastPotSlot = active;
    state._ballSetOpenSamePlayerPots = samePlayerPots;
    const playerChanged = lastPotSlot !== '' && lastPotSlot !== active;
    const breaker = String(state.rackBreakerSlot || '');
    const onBreakVisit = (breaker === '1' || breaker === '2')
      && active === breaker
      && (lastPotSlot === '' || lastPotSlot === breaker);
    if (onBreakVisit && samePlayerPots < 2) return;
    if (!breaker && !playerChanged && samePlayerPots < 2) return;
  }

  state.playerBallSet = getBallSetValueForPottedBall(num, active, state.ballSelection || 'american');
  state._ballSetOpenLastPotSlot = '';
  state._ballSetOpenSamePlayerPots = 0;
}

/**
 * Dock resolveTrackerGameBallPot — before the game ball is marked faded.
 * @returns {'win'|'loss'|'early_reject'|null}
 */
function resolveTrackerGameBallAction(state, ballId) {
  const winningId = getGameWinningBallId(state.gameType);
  if (!winningId || ballId !== winningId) return null;
  const gt = state.gameType;

  if (gt === 'game2' || gt === 'game3') {
    const winNum = snookerBallNum(ballId);
    if (state.earlyGameBallEnabled || arePrecedingObjectBallsPotted(state, winNum)) {
      return 'win';
    }
    return 'early_reject';
  }

  if (gt === 'game1') {
    const othersDown = countFadedObjectBalls(state);
    if (othersDown === 0) {
      return state.earlyGameBallEnabled ? 'win' : 'early_reject';
    }
    const active = state.activePlayer === '2' ? '2' : '1';
    const group = getEightBallGroupBallNumbersForSlot(state, active);
    if ((group && isEightBallGroupFullyPotted(state, group))
      || isUnassignedEightBallClearForWin(state)
      || areAllEightBallObjectBallsPotted(state)) {
      return 'win';
    }
    return 'loss';
  }

  return 'win';
}

function startTrackerCooldown(state, ballId, mode) {
  state._cooldown = {
    ballId,
    mode,
    until: Date.now() + TRACKER_COOLDOWN_MS,
  };
}

function clearTrackerCooldownState(state) {
  const cd = state._cooldown;
  if (!cd || !cd.ballId) return false;
  const ballId = cd.ballId;
  state._cooldown = null;
  if (!state.gameScoringLocked) {
    if (state._potted) state._potted[ballId] = false;
    if (state._pocketOwners) delete state._pocketOwners[ballId];
  }
  return true;
}

/** Award rack to winnerSlot; keep game ball faded through a short cooldown (dock parity). */
function awardTrackerRack(state, winnerSlot, ballId) {
  if (winnerSlot === '2') state.p2Score = clampScore((Number(state.p2Score) || 0) + 1);
  else state.p1Score = clampScore((Number(state.p1Score) || 0) + 1);
  prepareNextRackOrFrame(state, winnerSlot, { skipTrackerReset: false, keepBallId: ballId });
}

/** 14.1 Continuous: when one object ball remains, restore pocketed balls (no score/breaker change). */
function maybeStraightPoolRerack(state) {
  if (!isStraightPool(state)) return false;
  const count = objectBallCount(state);
  const fadedIds = [];
  let remaining = 0;
  for (let n = 1; n <= count; n += 1) {
    const id = `ball ${n}`;
    if (state._potted && state._potted[id]) fadedIds.push(id);
    else remaining += 1;
  }
  if (remaining !== 1 || fadedIds.length === 0) return false;
  for (const id of fadedIds) {
    state._potted[id] = false;
    if (state._pocketOwners) delete state._pocketOwners[id];
  }
  return true;
}

const BREAKER_PROMPT_GAMES = new Set([
  'game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8',
]);

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function ballFile(n, style) {
  if (style === 'snooker') {
    const map = {
      1: 'snooker-red-small.png',
      2: 'snooker-yellow-small.png',
      3: 'snooker-green-small.png',
      4: 'snooker-brown-small.png',
      5: 'snooker-blue-small.png',
      6: 'snooker-pink-small.png',
      7: 'snooker-black-small.png',
      8: 'snooker-gold-small.png',
      10: 'snooker-freeball-small.png',
      11: 'foul-small.png',
    };
    return map[n] || 'snooker-red-small.png';
  }
  // Match mobile ballImageFile / dock updateControlPanelBallImages.
  if (style === 'international') {
    if (n >= 1 && n <= 7) return 'yellow-international-small-ball.png';
    if (n === 8) return 'international-8-small-ball.png';
    return 'red-international-small-ball.png';
  }
  if (style === 'unity') return `${n}-ball-unity-small.png`;
  if (style === 'ultimate') return `ultimate-${n}ball-small.png`;
  return `${n}ball_small.png`;
}

function dualScoreMode(state) {
  const gt = state.gameType;
  return gt === 'game5' || gt === 'game6' || gt === 'game8'
    || (gt === 'game7' && state.pointBased === 'yes');
}

/** Match dock rack-breaker prompt: both players + pool/snooker game types. */
function isBreakerPromptEnabled(state) {
  if (state.player1Enabled === false || state.player2Enabled === false) return false;
  return BREAKER_PROMPT_GAMES.has(state.gameType || 'game1');
}

function hasRackBreakerSlot(state) {
  const slot = String(state.rackBreakerSlot || '');
  return slot === '1' || slot === '2';
}

function buildBallGrid(state) {
  const gt = state.gameType || 'game1';
  const snooker = gt === 'game8';
  const style = snooker ? 'snooker' : (state.ballSelection || 'american');
  const balls = [];
  const faded = state._potted || {};
  const count = snooker ? 7 : (POOL_BALL_COUNTS[gt] || 15);
  const locked = !!state.gameScoringLocked || !!state.awaitingBreaker;

  if (snooker) ensureSnookerFrameState(state);
  const phase = snooker && state._snookerPhase === 'color' ? 'color' : 'red';
  const reds = snooker ? (Number(state._snookerRedsPotted) || 0) : 0;
  const redsDone = reds >= 15;
  const expectColor = phase === 'color';
  const clearance = snooker && redsDone && !expectColor;
  const nextClearance = clearance ? getNextSnookerClearanceColor(state) : null;
  const allColorsCleared = snooker
    && SNOOKER_CLEARANCE_ORDER.every((n) => isSnookerColorCleared(state, n));

  const cooldown = state._cooldown && state._cooldown.ballId
    ? state._cooldown
    : null;
  const cooldownActive = !!(cooldown && (!cooldown.until || Date.now() < cooldown.until));

  for (let n = 1; n <= count; n += 1) {
    const id = `ball ${n}`;
    let ballFaded = !!faded[id];
    let ballDisabled = locked;
    const onCooldown = cooldownActive && cooldown.ballId === id;

    if (snooker) {
      if (n === 1) {
        // Reds are counted, not individually faded — disable when a color is owed or reds are gone.
        ballFaded = false;
        ballDisabled = locked || expectColor || redsDone;
      } else if (n >= 2 && n <= 7) {
        if (clearance) {
          ballFaded = isSnookerColorCleared(state, n);
          ballDisabled = locked || ballFaded || n !== nextClearance;
        } else {
          // Reds / color-after-red: colors re-spot — never permanently fade.
          ballFaded = false;
          ballDisabled = locked || !expectColor;
        }
      }
    } else if (onCooldown) {
      ballDisabled = true;
      ballFaded = true;
    }

    balls.push({
      id,
      file: ballFile(n, style),
      title: snooker ? `Ball ${n}` : String(n),
      hidden: false,
      faded: ballFaded,
      disabled: ballDisabled,
      cooldown: onCooldown,
      foul: false,
      respot: false,
      freeball: false,
    });
  }

  if (snooker) {
    // Golden Ball: option on → show until fouled/potted; enabled only after black + 147.
    const goldOnTable = state.snookerGoldEnabled === true
      && !state._snookerGoldenBallFouled
      && !isSnookerColorCleared(state, 8);
    balls.push({
      id: 'ball 8',
      file: ballFile(8, 'snooker'),
      title: 'Golden Ball (20-point)',
      hidden: !goldOnTable,
      faded: false,
      disabled: locked || !isSnookerGoldenBallAvailable(state),
      cooldown: false,
      foul: false,
      respot: false,
      freeball: false,
    });
    // Free Ball only after a foul and then an Active Player change (dock parity).
    const freeOffered = !!state._snookerFreeBallOffered;
    const freeBallOk = !locked && freeOffered && !expectColor && !allColorsCleared;
    balls.push({
      id: 'ball 10', file: ballFile(10, 'snooker'), title: 'Free Ball',
      hidden: false, faded: false, disabled: !freeBallOk,
      foul: false, respot: false, freeball: true,
    });
    balls.push({
      id: 'ball 11', file: ballFile(11, 'snooker'), title: 'Foul',
      hidden: false, faded: false, disabled: locked || allColorsCleared,
      foul: true, respot: false, freeball: false,
    });
  } else {
    const pocket = isPocketScoreGame(state);
    balls.push({
      id: 'poolFoulBtn', file: 'foul-small.png', title: 'Foul',
      hidden: false, faded: false,
      disabled: !!state.gameScoringLocked || !!state.awaitingBreaker,
      foul: true, respot: false, freeball: false,
    });
    balls.push({
      id: 'poolRespotBtn', file: 'respot-small.png', title: 'Respot',
      hidden: !pocket,
      faded: false,
      disabled: !!state.gameScoringLocked || !!state.awaitingBreaker || !pocket || !hasFadedObjectBalls(state),
      foul: false, respot: true, freeball: false,
    });
  }

  return {
    visible: true,
    snooker,
    awaitingBreaker: !!state.awaitingBreaker,
    locked: !!state.gameScoringLocked,
    canUndo: (state._undo || []).length > 0 && !state.awaitingBreaker,
    balls,
    snookerFoulTargets: snooker ? buildSnookerFoulTargets(state) : [],
    foulsP1: Number(state.foulsP1) || 0,
    foulsP2: Number(state.foulsP2) || 0,
    snookerCurrentBreak: Number(state._snookerBreak) || 0,
    snookerPointsRemaining: 0,
    snookerScoreMargin: { diff: 0, remaining: 0, display: '0' },
    snookerBreakBalls: [],
  };
}

function refreshDerived(state) {
  const raceTo = parseRaceTarget(state.raceInfo, state.gameType);
  const locked = isRaceLocked(state.p1Score, state.p2Score, raceTo);
  state.gameScoringLocked = locked;
  state.dualScoreMode = dualScoreMode(state);
  state.primaryScoreLabel = state.gameType === 'game8' ? 'Frames'
    : (state.gameType === 'game4' ? 'Balls' : 'Racks');
  state.secondaryScoreLabel = state.gameType === 'game8' ? 'Points' : 'Balls';
  state.raceLabel = state.gameType === 'game8' ? 'Best Of' : 'Race';

  // Parity with dock cloud_relay: ask "Breaking Player?" until a slot is picked.
  state.ballTrackerEnabled = true;
  state.ballScoringEnabled = true;
  state.scoreDisplay = true;
  state.player1Enabled = true;
  state.player2Enabled = true;
  state.breakingPlayerEnabled = true;
  const promptOn = isBreakerPromptEnabled(state);
  const hasBreaker = hasRackBreakerSlot(state);
  state.awaitingBreaker = promptOn && !locked && !hasBreaker;
  state.breakerPromptVisible = promptOn && !hasBreaker;
  if (!promptOn) {
    state.playerSlotMode = 'off';
    state.playerSlotPickerVisible = false;
  } else if (hasBreaker) {
    state.playerSlotMode = 'active';
    state.playerSlotPickerVisible = true;
  } else if (locked) {
    state.playerSlotMode = 'match_locked';
    state.playerSlotPickerVisible = true;
  } else {
    state.playerSlotMode = 'breaker';
    state.playerSlotPickerVisible = true;
  }

  state.canUndo = (state._undo || []).length > 0 && !state.awaitingBreaker;
  state.canCallGame = !locked && (
    (Number(state.p1Score) || 0) > 0
    || (Number(state.p2Score) || 0) > 0
    || (Number(state.p1Balls) || 0) > 0
    || (Number(state.p2Balls) || 0) > 0
    || Object.keys(state._potted || {}).some((k) => state._potted[k])
    || (Number(state._snookerRedsPotted) || 0) > 0
    || Object.keys(state._snookerCleared || {}).some((k) => state._snookerCleared[k])
  );
  state.canResetScores = true;
  state.matchInProgress = !!(
    state.canCallGame || state.gameScoringLocked || state.rackBreakerSlot
    || state.awaitingBreaker
    || (Number(state.p1Score) || 0) > 0 || (Number(state.p2Score) || 0) > 0
    || (Number(state.p1Balls) || 0) > 0 || (Number(state.p2Balls) || 0) > 0
  );
  if (state.gameType === 'game8') {
    ensureSnookerFrameState(state);
    state.snookerPhase = state._snookerPhase;
    state.snookerRedsPotted = state._snookerRedsPotted;
    state.snookerFreeBallOffered = !!state._snookerFreeBallOffered;
  } else {
    state.snookerPhase = 'red';
    state.snookerRedsPotted = 0;
    state.snookerFreeBallOffered = false;
  }
  state.ballGrid = buildBallGrid(state);
  state.timestamp = new Date().toISOString();
  state.streamPublicListed = false;
  state.obsStreaming = false;
  state.streamUrl = '';
  state.replayEnabled = false;
  state.replayControlsEnabled = false;
  state.monitoringActive = false;
  return state;
}

function snapshotForUndo(state) {
  return {
    p1Score: state.p1Score,
    p2Score: state.p2Score,
    p1Balls: state.p1Balls,
    p2Balls: state.p2Balls,
    foulsP1: state.foulsP1,
    foulsP2: state.foulsP2,
    activePlayer: state.activePlayer,
    _potted: { ...(state._potted || {}) },
    _pocketOwners: { ...(state._pocketOwners || {}) },
    _cooldown: state._cooldown ? { ...state._cooldown } : null,
    _ballSetOpenLastPotSlot: state._ballSetOpenLastPotSlot || '',
    _ballSetOpenSamePlayerPots: Number(state._ballSetOpenSamePlayerPots) || 0,
    _snookerBreak: state._snookerBreak,
    _snookerPhase: state._snookerPhase || 'red',
    _snookerRedsPotted: Number(state._snookerRedsPotted) || 0,
    _snookerCleared: { ...(state._snookerCleared || {}) },
    _snookerFreeBallOffered: !!state._snookerFreeBallOffered,
    _snookerFoulAwaitingPlayerChange: !!state._snookerFoulAwaitingPlayerChange,
    _snookerGoldenBallFouled: !!state._snookerGoldenBallFouled,
    rackBreakerSlot: state.rackBreakerSlot,
    awaitingBreaker: state.awaitingBreaker,
  };
}

function pushUndo(state) {
  if (!state._undo) state._undo = [];
  state._undo.push(snapshotForUndo(state));
  if (state._undo.length > 40) state._undo.shift();
}

function publicState(state) {
  refreshDerived(state);
  const cleaned = { ...state };
  delete cleaned._undo;
  delete cleaned._potted;
  delete cleaned._snookerBreak;
  delete cleaned._snookerPhase;
  delete cleaned._snookerRedsPotted;
  delete cleaned._snookerCleared;
  delete cleaned._snookerFreeBallOffered;
  delete cleaned._snookerFoulAwaitingPlayerChange;
  delete cleaned._snookerGoldenBallFouled;
  delete cleaned._pocketOwners;
  delete cleaned._cooldown;
  delete cleaned._ballSetOpenLastPotSlot;
  delete cleaned._ballSetOpenSamePlayerPots;
  delete cleaned._matchId;
  delete cleaned._cloudStarted;
  delete cleaned._internal;
  cleaned.ballGrid = state.ballGrid;
  return cleaned;
}

export function createDefaultImpromptuState(overrides = {}) {
  const state = {
    player1Name: '',
    player2Name: '',
    player1Id: '',
    player2Id: '',
    p1Score: 0,
    p2Score: 0,
    p1Balls: 0,
    p2Balls: 0,
    foulsP1: 0,
    foulsP2: 0,
    pointBased: 'no',
    gameType: 'game1',
    raceInfo: '',
    gameInfo: '',
    ballSelection: 'american',
    earlyGameBallEnabled: false,
    snookerGoldEnabled: false,
    useBallSet: false,
    playerBallSet: 'p1Open',
    activePlayer: '1',
    rackBreakerSlot: '',
    // awaitingBreaker / playerSlotMode derived in refreshDerived (dock parity).
    _potted: {},
    _undo: [],
    _snookerBreak: 0,
    _snookerPhase: 'red',
    _snookerRedsPotted: 0,
    _snookerCleared: {},
    _snookerFreeBallOffered: false,
    _snookerFoulAwaitingPlayerChange: false,
    _snookerGoldenBallFouled: false,
    _pocketOwners: {},
    _cooldown: null,
    _ballSetOpenLastPotSlot: '',
    _ballSetOpenSamePlayerPots: 0,
    _matchId: null,
    _cloudStarted: false,
    ...overrides,
  };
  return refreshDerived(state);
}

export function hydrateAuthorityState(liveState) {
  const base = createDefaultImpromptuState(liveState || {});
  base._potted = {};
  base._undo = [];
  base._snookerCleared = {};
  base._snookerPhase = liveState?.snookerPhase === 'color' ? 'color' : 'red';
  base._snookerRedsPotted = Number(liveState?.snookerRedsPotted) || 0;
  if (liveState?.ballGrid?.balls) {
    for (const b of liveState.ballGrid.balls) {
      if (!b?.id) continue;
      if (b.faded) {
        const n = snookerBallNum(b.id);
        if (base.gameType === 'game8' && n >= 2 && n <= 7) {
          base._snookerCleared[b.id] = true;
        } else {
          base._potted[b.id] = true;
        }
      }
    }
  }
  return refreshDerived(base);
}

/**
 * @returns {{ state, _private, sessionEvents, closeTable, publish }}
 */
export function applyImpromptuCommand(stateIn, action, payload = {}) {
  const state = refreshDerived({ ...(stateIn || createDefaultImpromptuState()) });
  // Clone mutable frame maps so callers keep a stable prior snapshot.
  state._potted = { ...(state._potted || {}) };
  state._snookerCleared = { ...(state._snookerCleared || {}) };
  state._pocketOwners = { ...(state._pocketOwners || {}) };
  if (state._cooldown && typeof state._cooldown === 'object') {
    state._cooldown = { ...state._cooldown };
  }
  if (!state._undo) state._undo = [];
  else state._undo = state._undo.slice();
  const sessionEvents = [];
  let closeTable = false;
  let publish = true;

  function ensureMatchId() {
    if (!state._matchId) state._matchId = uuid();
    return state._matchId;
  }

  function bumpActivity() {
    if (!state._cloudStarted && (state.player1Name || state.player2Name)) {
      const matchId = ensureMatchId();
      state._cloudStarted = true;
      sessionEvents.push({
        action: 'start',
        payload: {
          sessionId: matchId,
          gameType: state.gameType,
          gameInfo: state.gameInfo || '',
          player1: state.player1Name,
          player2: state.player2Name,
          player1Id: state.player1Id || null,
          player2Id: state.player2Id || null,
          reason: 'activity',
        },
      });
    }
  }

  function endMatch(reason, winnerSlot) {
    const matchId = ensureMatchId();
    const raceTo = parseRaceTarget(state.raceInfo, state.gameType);
    let slot = winnerSlot;
    if (slot == null) {
      slot = winnerSlotFromScores({ p1: state.p1Score, p2: state.p2Score }, raceTo);
    }
    if (slot == null) {
      const p1 = Number(state.p1Score) || 0;
      const p2 = Number(state.p2Score) || 0;
      if (p1 > p2) slot = '1';
      else if (p2 > p1) slot = '2';
    }
    if (state._cloudStarted) {
      sessionEvents.push({
        action: 'end',
        payload: {
          matchId,
          sessionId: matchId,
          reason,
          winnerSlot: slot || null,
          scores: { p1: clampScore(state.p1Score), p2: clampScore(state.p2Score) },
          player1: state.player1Name,
          player2: state.player2Name,
          player1Id: state.player1Id || null,
          player2Id: state.player2Id || null,
          gameType: state.gameType,
          gameInfo: state.gameInfo || '',
        },
      });
    } else {
      // No scored session — still free the impromptu seat.
      sessionEvents.push({
        action: 'discard',
        payload: { matchId, sessionId: matchId, reason: 'abandon_match' },
      });
    }
    closeTable = true;
  }

  const scoringLocked = state.gameScoringLocked
    && ['score_add', 'balls_add', 'toggle_pot', 'snooker_ball', 'pool_foul', 'snooker_foul'].includes(action);
  if (scoringLocked) {
    return { state: publicState(state), _private: state, sessionEvents, closeTable: false, publish: false };
  }

  switch (action) {
    case 'score_add': {
      pushUndo(state);
      const p = String(payload.player || '1');
      if (p === '2') state.p2Score = clampScore((Number(state.p2Score) || 0) + 1);
      else state.p1Score = clampScore((Number(state.p1Score) || 0) + 1);
      // Dock postScore("add"): zero balls, reset tracker / snooker frame, re-prompt breaker.
      prepareNextRackOrFrame(state, p);
      bumpActivity();
      break;
    }
    case 'score_sub': {
      pushUndo(state);
      const p = String(payload.player || '1');
      if (p === '2') state.p2Score = clampScore((Number(state.p2Score) || 0) - 1);
      else state.p1Score = clampScore((Number(state.p1Score) || 0) - 1);
      bumpActivity();
      break;
    }
    case 'balls_add': {
      pushUndo(state);
      const p = String(payload.player || '1');
      if (p === '2') state.p2Balls = clampSignedScore((Number(state.p2Balls) || 0) + 1);
      else state.p1Balls = clampSignedScore((Number(state.p1Balls) || 0) + 1);
      if (isPocketScoreGame(state)) {
        maybeAwardPocketRack(state, p);
      }
      bumpActivity();
      break;
    }
    case 'balls_sub': {
      pushUndo(state);
      const p = String(payload.player || '1');
      if (p === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) - 1);
      else state.p1Balls = clampScore((Number(state.p1Balls) || 0) - 1);
      bumpActivity();
      break;
    }
    case 'select_breaker':
    case 'player_slot': {
      const slot = String(payload.slot || (payload.isP1 === false ? '2' : '1'));
      // Recompute prompt flags before deciding — awaitingBreaker may still be stale mid-command.
      const breakerPick = payload.mode === 'breaker'
        || (isBreakerPromptEnabled(state) && !hasRackBreakerSlot(state) && !state.gameScoringLocked);
      pushUndo(state);
      if (breakerPick) {
        state.rackBreakerSlot = slot;
        state.activePlayer = slot;
      } else {
        const prev = state.activePlayer;
        state.activePlayer = slot;
        if (state.gameType === 'game8' && prev !== slot) {
          ensureSnookerFrameState(state);
          state._snookerBreak = 0;
          if (state._snookerFoulAwaitingPlayerChange) {
            state._snookerFoulAwaitingPlayerChange = false;
            state._snookerFreeBallOffered = true;
            state._snookerPhase = 'red';
          } else {
            state._snookerFreeBallOffered = false;
          }
        }
      }
      bumpActivity();
      break;
    }
    case 'toggle_active_player': {
      const target = payload.isP1 === false ? '2' : '1';
      if (state.activePlayer === target) {
        publish = false;
        break;
      }
      pushUndo(state);
      state.activePlayer = target;
      if (state.gameType === 'game8') {
        ensureSnookerFrameState(state);
        state._snookerBreak = 0;
        if (state._snookerFoulAwaitingPlayerChange) {
          state._snookerFoulAwaitingPlayerChange = false;
          state._snookerFreeBallOffered = true;
          state._snookerPhase = 'red';
        } else {
          state._snookerFreeBallOffered = false;
        }
      }
      bumpActivity();
      break;
    }
    case 'set_player_name': {
      const slot = String(payload.slot || '1');
      const name = truncatePlayerName(payload.name);
      const playerId = payload.playerId != null ? String(payload.playerId).trim() : '';
      if (slot === '2') {
        state.player2Name = name;
        state.player2Id = playerId;
      } else {
        state.player1Name = name;
        state.player1Id = playerId;
      }
      break;
    }
    case 'set_race':
      state.raceInfo = String(payload.value != null ? payload.value : '');
      break;
    case 'set_game_info':
      state.gameInfo = String(payload.value != null ? payload.value : '').slice(0, 60);
      break;
    case 'set_game_type': {
      state.gameType = String(payload.gameType || 'game1');
      state._potted = {};
      state._pocketOwners = {};
      state._undo = [];
      resetSnookerFrame(state);
      state.rackBreakerSlot = '';
      if (state.gameType === 'game8') state.ballSelection = 'snooker';
      break;
    }
    case 'set_early_game_ball':
      state.earlyGameBallEnabled = !!payload.enabled;
      break;
    case 'set_snooker_gold':
      state.snookerGoldEnabled = !!payload.enabled;
      break;
    case 'set_point_based':
      state.pointBased = payload.enabled ? 'yes' : 'no';
      break;
    case 'set_ball_selection':
      state.ballSelection = String(payload.value || 'american');
      break;
    case 'set_use_ball_set':
      state.useBallSet = !!payload.enabled;
      break;
    case 'set_player_ball_set':
      state.playerBallSet = String(payload.value || 'p1Open');
      break;
    case 'toggle_pot':
    case 'snooker_ball': {
      const ballId = payload.ballId ? String(payload.ballId) : '';
      if (!ballId) break;
      if (state._cooldown && state._cooldown.ballId === ballId
        && (!state._cooldown.until || Date.now() < state._cooldown.until)) {
        publish = false;
        break;
      }
      if (ballId === 'poolFoulBtn') {
        // Same path as pool_foul (mobile may send either).
        pushUndo(state);
        const fouler = state.activePlayer === '2' ? '2' : '1';
        if (fouler === '2') state.foulsP2 = (Number(state.foulsP2) || 0) + 1;
        else state.foulsP1 = (Number(state.foulsP1) || 0) + 1;
        if (isBallFoulPenaltyGame(state)) {
          if (isStraightPool(state)) {
            if (fouler === '2') state.p2Score = clampSignedScore((Number(state.p2Score) || 0) - 1);
            else state.p1Score = clampSignedScore((Number(state.p1Score) || 0) - 1);
          } else {
            if (fouler === '2') state.p2Balls = clampSignedScore((Number(state.p2Balls) || 0) - 1);
            else state.p1Balls = clampSignedScore((Number(state.p1Balls) || 0) - 1);
          }
        }
        state.activePlayer = fouler === '2' ? '1' : '2';
        bumpActivity();
        break;
      }
      if (ballId === 'poolRespotBtn') {
        publish = false;
        break;
      }
      if (ballId === 'ball 11' && state.gameType === 'game8') {
        publish = false;
        break;
      }

      // Snooker: dock-parity red ↔ color respot, then yellow→black clearance.
      if (state.gameType === 'game8') {
        ensureSnookerFrameState(state);
        const num = snookerBallNum(ballId);
        const phase = state._snookerPhase === 'color' ? 'color' : 'red';
        const reds = Number(state._snookerRedsPotted) || 0;
        const redsDone = reds >= 15;
        const expectColor = phase === 'color';
        const clearance = redsDone && !expectColor;
        const isRed = num === 1;
        const isFreeball = num === 10;
        const isColor = num >= 2 && num <= 7;
        const isGold = num === 8;

        if (isGold) {
          if (!isSnookerGoldenBallAvailable(state)) {
            publish = false;
            break;
          }
          pushUndo(state);
          const pts = SNOOKER_POINTS['ball 8'] || 20;
          if (state.activePlayer === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + pts);
          else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + pts);
          state._snookerBreak = (Number(state._snookerBreak) || 0) + pts;
          markSnookerColorCleared(state, 8);
          state._snookerFreeBallOffered = false;
          state._snookerFoulAwaitingPlayerChange = false;
          bumpActivity();
          break;
        }

        if (isRed) {
          if (expectColor || redsDone) {
            publish = false;
            break;
          }
          pushUndo(state);
          if (state.activePlayer === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + 1);
          else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + 1);
          state._snookerBreak = (Number(state._snookerBreak) || 0) + 1;
          state._snookerRedsPotted = reds + 1;
          state._snookerPhase = 'color';
          state._snookerFreeBallOffered = false;
          state._snookerFoulAwaitingPlayerChange = false;
          bumpActivity();
          break;
        }

        if (isFreeball) {
          if (!state._snookerFreeBallOffered || expectColor
            || SNOOKER_CLEARANCE_ORDER.every((n) => isSnookerColorCleared(state, n))) {
            publish = false;
            break;
          }
          pushUndo(state);
          // Lowest remaining ball points (dock free-ball value).
          let freePts = 1;
          if (redsDone) {
            const next = getNextSnookerClearanceColor(state);
            freePts = next ? (SNOOKER_POINTS[`ball ${next}`] || 1) : 1;
          }
          if (state.activePlayer === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + freePts);
          else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + freePts);
          state._snookerBreak = (Number(state._snookerBreak) || 0) + freePts;
          state._snookerFreeBallOffered = false;
          state._snookerFoulAwaitingPlayerChange = false;
          if (!redsDone) state._snookerPhase = 'color';
          bumpActivity();
          break;
        }

        if (isColor) {
          if (!expectColor && !clearance) {
            publish = false;
            break;
          }
          if (clearance) {
            const nextColor = getNextSnookerClearanceColor(state);
            if (num !== nextColor || isSnookerColorCleared(state, num)) {
              publish = false;
              break;
            }
          }
          const pts = SNOOKER_POINTS[ballId] || 0;
          pushUndo(state);
          if (state.activePlayer === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + pts);
          else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + pts);
          state._snookerBreak = (Number(state._snookerBreak) || 0) + pts;
          if (clearance) {
            // Colors stay down only during final clearance.
            markSnookerColorCleared(state, num);
          }
          // Re-spot after color-on-red; after 15th red's color, phase=red starts clearance.
          state._snookerPhase = 'red';
          bumpActivity();
          break;
        }

        publish = false;
        break;
      }

      // Bank / One Pocket: fade awards a ball; unfade debits the credited owner.
      if (isPocketScoreGame(state)) {
        const nowFaded = !state._potted[ballId];
        pushUndo(state);
        if (nowFaded) {
          const slot = state.activePlayer === '2' ? '2' : '1';
          state._potted[ballId] = true;
          state._pocketOwners[ballId] = slot;
          if (slot === '2') state.p2Balls = clampSignedScore((Number(state.p2Balls) || 0) + 1);
          else state.p1Balls = clampSignedScore((Number(state.p1Balls) || 0) + 1);
          maybeAwardPocketRack(state);
        } else {
          const owner = state._pocketOwners[ballId] || (state.activePlayer === '2' ? '2' : '1');
          state._potted[ballId] = false;
          delete state._pocketOwners[ballId];
          if (owner === '2') {
            const cur = Number(state.p2Balls) || 0;
            if (cur > 0) state.p2Balls = clampSignedScore(cur - 1);
          } else {
            const cur = Number(state.p1Balls) || 0;
            if (cur > 0) state.p1Balls = clampSignedScore(cur - 1);
          }
        }
        bumpActivity();
        break;
      }

      // Straight Pool: every pot +1 primary; unclick −1; 14.1 re-rack at one ball left.
      if (isStraightPool(state)) {
        const nowFaded = !state._potted[ballId];
        pushUndo(state);
        state._potted[ballId] = nowFaded;
        const slot = state.activePlayer === '2' ? '2' : '1';
        if (nowFaded) {
          if (slot === '2') state.p2Score = clampScore((Number(state.p2Score) || 0) + 1);
          else state.p1Score = clampScore((Number(state.p1Score) || 0) + 1);
          maybeStraightPoolRerack(state);
        } else if (slot === '2') {
          state.p2Score = clampScore((Number(state.p2Score) || 0) - 1);
        } else {
          state.p1Score = clampScore((Number(state.p1Score) || 0) - 1);
        }
        bumpActivity();
        break;
      }

      // 8 / 9 / 10-Ball game-ball resolution (dock resolveTrackerGameBallPot).
      const willFade = !state._potted[ballId];
      if (willFade) {
        const gameBallAction = resolveTrackerGameBallAction(state, ballId);
        if (gameBallAction === 'win' || gameBallAction === 'loss') {
          pushUndo(state);
          const active = state.activePlayer === '2' ? '2' : '1';
          const winner = gameBallAction === 'loss'
            ? (active === '2' ? '1' : '2')
            : active;
          awardTrackerRack(state, winner, ballId);
          bumpActivity();
          break;
        }
        if (gameBallAction === 'early_reject') {
          // Early game ball / win-on-break off — brief fade then revive (no rack).
          pushUndo(state);
          state._potted[ballId] = true;
          startTrackerCooldown(state, ballId, 'early_reject');
          bumpActivity();
          break;
        }
      }

      pushUndo(state);
      const nowFaded = !state._potted[ballId];
      state._potted[ballId] = nowFaded;
      if (nowFaded) maybeAssignBallSetFromPot(state, ballId);
      bumpActivity();
      break;
    }
    case 'pool_foul': {
      pushUndo(state);
      const fouler = state.activePlayer === '2' ? '2' : '1';
      if (fouler === '2') state.foulsP2 = (Number(state.foulsP2) || 0) + 1;
      else state.foulsP1 = (Number(state.foulsP1) || 0) + 1;
      if (isBallFoulPenaltyGame(state)) {
        if (isStraightPool(state)) {
          if (fouler === '2') state.p2Score = clampSignedScore((Number(state.p2Score) || 0) - 1);
          else state.p1Score = clampSignedScore((Number(state.p1Score) || 0) - 1);
        } else {
          if (fouler === '2') state.p2Balls = clampSignedScore((Number(state.p2Balls) || 0) - 1);
          else state.p1Balls = clampSignedScore((Number(state.p1Balls) || 0) - 1);
        }
      }
      // Foul hands the table to the opponent (dock parity).
      state.activePlayer = fouler === '2' ? '1' : '2';
      bumpActivity();
      break;
    }
    case 'snooker_foul': {
      pushUndo(state);
      const key = String(payload.foulKey || '');
      const pts = resolveSnookerFoulPoints(key);
      const fouler = state.activePlayer === '2' ? '2' : '1';
      const opponent = fouler === '2' ? '1' : '2';
      if (opponent === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + pts);
      else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + pts);
      if (fouler === '2') state.foulsP2 = (Number(state.foulsP2) || 0) + 1;
      else state.foulsP1 = (Number(state.foulsP1) || 0) + 1;
      ensureSnookerFrameState(state);
      state._snookerBreak = 0;
      state._snookerPhase = 'red';
      // Dock applies foul then switches Active Player — Free Ball is offered on that visit.
      state.activePlayer = opponent;
      state._snookerFoulAwaitingPlayerChange = false;
      state._snookerFreeBallOffered = true;
      if (key === 'gold') {
        state._snookerGoldenBallFouled = true;
        markSnookerColorCleared(state, 8);
      }
      bumpActivity();
      break;
    }
    case 'respot_ball': {
      const ballId = payload.ballId ? String(payload.ballId) : '';
      if (!ballId || !isPocketScoreGame(state) || !state._potted[ballId]) {
        publish = false;
        break;
      }
      pushUndo(state);
      state._potted[ballId] = false;
      delete state._pocketOwners[ballId];
      bumpActivity();
      break;
    }
    case 'clear_tracker_cooldown': {
      if (!clearTrackerCooldownState(state)) {
        publish = false;
        break;
      }
      break;
    }
    case 'undo': {
      const prev = (state._undo || []).pop();
      if (prev) Object.assign(state, prev);
      break;
    }
    case 'reset_scores': {
      if (state._cloudStarted && state._matchId) {
        sessionEvents.push({
          action: 'discard',
          payload: { matchId: state._matchId, sessionId: state._matchId, reason: 'restart_match' },
        });
      }
      state.p1Score = 0;
      state.p2Score = 0;
      state.p1Balls = 0;
      state.p2Balls = 0;
      state.foulsP1 = 0;
      state.foulsP2 = 0;
      state._potted = {};
      state._pocketOwners = {};
      state._undo = [];
      resetSnookerFrame(state);
      state.rackBreakerSlot = '';
      state._cloudStarted = false;
      state._matchId = null;
      break;
    }
    case 'end_match':
      endMatch('end_match');
      break;
    case 'call_match_early': {
      const p1 = Number(state.p1Score) || 0;
      const p2 = Number(state.p2Score) || 0;
      endMatch('call_match_early', p1 === p2 ? null : (p1 > p2 ? '1' : '2'));
      break;
    }
    case 'abandon_match':
    case 'destroy_table': {
      if (state._cloudStarted && state._matchId) {
        sessionEvents.push({
          action: 'discard',
          payload: { matchId: state._matchId, sessionId: state._matchId, reason: 'abandon_match' },
        });
      } else {
        sessionEvents.push({
          action: 'discard',
          payload: { matchId: ensureMatchId(), sessionId: ensureMatchId(), reason: 'abandon_match' },
        });
      }
      closeTable = true;
      break;
    }
    default:
      publish = false;
      break;
  }

  refreshDerived(state);
  return {
    state: publicState(state),
    _private: state,
    sessionEvents,
    closeTable,
    publish,
  };
}
