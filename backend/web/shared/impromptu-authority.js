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
  'ball 5': 5, 'ball 6': 6, 'ball 7': 7,
};

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
      10: 'snooker-freeball-small.png',
      11: 'foul-small.png',
    };
    return map[n] || 'snooker-red-small.png';
  }
  if (style === 'international') return `${n}ball_international_small.png`;
  if (style === 'unity') return `${n}ball_unity_small.png`;
  if (style === 'ultimate') return `${n}ball_ultimate_small.png`;
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

  for (let n = 1; n <= count; n += 1) {
    const id = `ball ${n}`;
    balls.push({
      id,
      file: ballFile(n, style),
      title: snooker ? `Ball ${n}` : String(n),
      hidden: false,
      faded: !!faded[id],
      disabled: !!state.gameScoringLocked || !!state.awaitingBreaker,
      foul: false,
      respot: false,
      freeball: false,
    });
  }

  if (snooker) {
    balls.push({
      id: 'ball 10', file: ballFile(10, 'snooker'), title: 'Free Ball',
      hidden: false, faded: false, disabled: !!state.gameScoringLocked,
      foul: false, respot: false, freeball: true,
    });
    balls.push({
      id: 'ball 11', file: ballFile(11, 'snooker'), title: 'Foul',
      hidden: false, faded: false, disabled: !!state.gameScoringLocked,
      foul: true, respot: false, freeball: false,
    });
  } else {
    balls.push({
      id: 'poolFoulBtn', file: 'foul-small.png', title: 'Foul',
      hidden: false, faded: false,
      disabled: !!state.gameScoringLocked || !!state.awaitingBreaker,
      foul: true, respot: false, freeball: false,
    });
    balls.push({
      id: 'poolRespotBtn', file: 'respot-small.png', title: 'Respot',
      hidden: false, faded: false, disabled: !!state.gameScoringLocked,
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
    snookerFoulTargets: snooker
      ? [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        key: `ball_${n}`,
        file: ballFile(n, 'snooker'),
        alt: String(n),
      }))
      : [],
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
  );
  state.canResetScores = true;
  state.matchInProgress = !!(
    state.canCallGame || state.gameScoringLocked || state.rackBreakerSlot
    || state.awaitingBreaker
    || (Number(state.p1Score) || 0) > 0 || (Number(state.p2Score) || 0) > 0
    || (Number(state.p1Balls) || 0) > 0 || (Number(state.p2Balls) || 0) > 0
  );
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
    _snookerBreak: state._snookerBreak,
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
  if (liveState?.ballGrid?.balls) {
    for (const b of liveState.ballGrid.balls) {
      if (b?.id && b.faded) base._potted[b.id] = true;
    }
  }
  return refreshDerived(base);
}

/**
 * @returns {{ state, _private, sessionEvents, closeTable, publish }}
 */
export function applyImpromptuCommand(stateIn, action, payload = {}) {
  const state = refreshDerived({ ...(stateIn || createDefaultImpromptuState()) });
  if (!state._potted) state._potted = {};
  if (!state._undo) state._undo = [];
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
      // Dock clears breaker after a rack/frame so the next rack re-prompts.
      if (isBreakerPromptEnabled(state) && !isRaceLocked(state.p1Score, state.p2Score, parseRaceTarget(state.raceInfo, state.gameType))) {
        state.rackBreakerSlot = '';
        state.lastRackWinnerSlot = p;
      }
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
      if (p === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + 1);
      else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + 1);
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
        state.activePlayer = slot;
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
      state._undo = [];
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
      if (ballId === 'poolFoulBtn') {
        pushUndo(state);
        if (state.activePlayer === '2') state.foulsP2 = (Number(state.foulsP2) || 0) + 1;
        else state.foulsP1 = (Number(state.foulsP1) || 0) + 1;
        bumpActivity();
        break;
      }
      if (ballId === 'poolRespotBtn' || ballId === 'ball 11') {
        publish = false;
        break;
      }
      if (ballId === 'ball 10') {
        pushUndo(state);
        if (state.activePlayer === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + 1);
        else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + 1);
        state._snookerBreak = (Number(state._snookerBreak) || 0) + 1;
        bumpActivity();
        break;
      }
      pushUndo(state);
      if (state.gameType === 'game8' && SNOOKER_POINTS[ballId] != null) {
        const pts = SNOOKER_POINTS[ballId];
        if (state.activePlayer === '2') state.p2Balls = clampScore((Number(state.p2Balls) || 0) + pts);
        else state.p1Balls = clampScore((Number(state.p1Balls) || 0) + pts);
        state._snookerBreak = (Number(state._snookerBreak) || 0) + pts;
        if (ballId !== 'ball 1') state._potted[ballId] = true;
      } else {
        state._potted[ballId] = !state._potted[ballId];
      }
      bumpActivity();
      break;
    }
    case 'pool_foul': {
      pushUndo(state);
      if (state.activePlayer === '2') state.foulsP2 = (Number(state.foulsP2) || 0) + 1;
      else state.foulsP1 = (Number(state.foulsP1) || 0) + 1;
      bumpActivity();
      break;
    }
    case 'snooker_foul': {
      pushUndo(state);
      const key = String(payload.foulKey || '');
      const n = parseInt(key.replace(/\D/g, ''), 10);
      const pts = Number.isFinite(n) && n >= 1 && n <= 7 ? Math.max(4, n) : 4;
      if (state.activePlayer === '2') {
        state.p1Balls = clampScore((Number(state.p1Balls) || 0) + pts);
        state.foulsP2 = (Number(state.foulsP2) || 0) + 1;
      } else {
        state.p2Balls = clampScore((Number(state.p2Balls) || 0) + pts);
        state.foulsP1 = (Number(state.foulsP1) || 0) + 1;
      }
      state._snookerBreak = 0;
      bumpActivity();
      break;
    }
    case 'respot_ball': {
      const ballId = payload.ballId ? String(payload.ballId) : '';
      if (!ballId) break;
      pushUndo(state);
      state._potted[ballId] = false;
      bumpActivity();
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
      state._undo = [];
      state._snookerBreak = 0;
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
