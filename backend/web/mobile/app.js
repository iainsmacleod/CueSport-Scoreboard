import {
  CloudClient,
  devLogin,
  createGuestLink,
  GAME_TYPES,
} from '../shared/cloud-client.js';

const TOKEN_KEY = 'cuesport_token';
let client = null;
let roomId = '';
let lastState = {};
let syncTimer = null;
let dockPresent = false;

let guestToken = '';
let isGuestMode = false;
/** @type {'control' | 'setup' | 'replay' | 'share'} */
let activeView = 'control';
let cachedGuestShareUrl = '';
let guestSharePromise = null;

function pathContext() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const gIdx = parts.indexOf('g');
  if (gIdx >= 0 && parts[gIdx + 1]) return { guestToken: parts[gIdx + 1] };
  const mIdx = parts.indexOf('m');
  if (mIdx >= 0 && parts[mIdx + 1]) return { roomId: parts[mIdx + 1] };
  return {};
}

function applyGuestUI() {
  const title = document.getElementById('pageTitle');
  if (title) title.textContent = 'CueSport Scoreboard Guest Control';
  show('loginSection', false);
  show('controlSection', true);
  ['adminPlayersPanel', 'matchPanel', 'viewReplay', 'viewShare'].forEach((id) => show(id, false));
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.add('hidden'));
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) replayBtn.classList.add('hidden');
  const shareBtn = document.getElementById('navShareBtn');
  if (shareBtn) shareBtn.classList.add('hidden');
  const dash = document.getElementById('dashboardLink');
  if (dash) dash.classList.add('hidden');
  showMobileNav(true);
  setActiveView('control');
}

function showMobileNav(visible) {
  const nav = document.getElementById('mobileBottomNav');
  if (!nav) return;
  nav.classList.toggle('hidden', !visible);
  document.body.classList.toggle('has-mobile-nav', !!visible);
}

function setActiveView(view) {
  if (view !== 'control' && view !== 'setup' && view !== 'replay' && view !== 'share') {
    view = 'control';
  }
  if (isGuestMode && (view === 'replay' || view === 'share')) view = 'control';
  activeView = view;
  show('viewControl', view === 'control');
  show('viewSetup', view === 'setup');
  show('viewReplay', view === 'replay' && !isGuestMode);
  show('viewShare', view === 'share' && !isGuestMode);

  const toggleBtn = document.getElementById('navToggleSetupBtn');
  if (toggleBtn) {
    const showControlLabel = view === 'setup';
    toggleBtn.dataset.mode = showControlLabel ? 'control' : 'setup';
    const label = document.getElementById('navToggleSetupLabel');
    if (label) label.textContent = showControlLabel ? 'Control' : 'Setup';
    toggleBtn.setAttribute('aria-label', showControlLabel ? 'Control' : 'Setup');
    toggleBtn.classList.toggle('active', view === 'setup');
  }
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) replayBtn.classList.toggle('active', view === 'replay');
  const shareBtn = document.getElementById('navShareBtn');
  if (shareBtn) shareBtn.classList.toggle('active', view === 'share');

  if (view === 'share') {
    ensureGuestShareLink().catch((err) => setError(err.message || 'Failed to create guest link'));
  }
}

async function ensureGuestShareLink() {
  if (cachedGuestShareUrl) {
    renderShareLink(cachedGuestShareUrl);
    return cachedGuestShareUrl;
  }
  if (guestSharePromise) return guestSharePromise;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!roomId || !token) {
    throw new Error('Sign in required to create a public control link');
  }
  const status = document.getElementById('shareStatus');
  if (status) {
    status.textContent = 'Preparing link…';
    status.classList.remove('hidden');
  }
  guestSharePromise = createGuestLink(window.location.origin, token, roomId)
    .then((data) => {
      const url = data.path
        ? `${window.location.origin}${data.path}`
        : data.url;
      cachedGuestShareUrl = url;
      renderShareLink(url);
      return url;
    })
    .finally(() => {
      guestSharePromise = null;
    });
  return guestSharePromise;
}

function renderShareLink(url) {
  const status = document.getElementById('shareStatus');
  const urlEl = document.getElementById('shareUrl');
  const qr = document.getElementById('shareQrImg');
  const copyBtn = document.getElementById('shareCopyBtn');
  const shareBtn = document.getElementById('shareNativeBtn');
  if (status) status.classList.add('hidden');
  if (urlEl) {
    urlEl.textContent = url;
    urlEl.classList.remove('hidden');
  }
  if (qr) {
    const base = window.location.origin.replace(/\/$/, '');
    qr.src = `${base}/api/qr?size=220&margin=2&data=${encodeURIComponent(url)}`;
    qr.classList.remove('hidden');
  }
  if (copyBtn) copyBtn.disabled = false;
  if (shareBtn) shareBtn.disabled = false;
}

function wireMobileNav() {
  const toggleBtn = document.getElementById('navToggleSetupBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setActiveView(activeView === 'setup' ? 'control' : 'setup');
    });
  }
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      setActiveView(activeView === 'replay' ? 'control' : 'replay');
    });
  }
  const shareNavBtn = document.getElementById('navShareBtn');
  if (shareNavBtn) {
    shareNavBtn.addEventListener('click', () => {
      setActiveView(activeView === 'share' ? 'control' : 'share');
    });
  }
  const copyBtn = document.getElementById('shareCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!cachedGuestShareUrl) return;
      try {
        await navigator.clipboard.writeText(cachedGuestShareUrl);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
      } catch (_) {
        setError('Could not copy link');
      }
    });
  }
  const nativeShareBtn = document.getElementById('shareNativeBtn');
  if (nativeShareBtn) {
    nativeShareBtn.addEventListener('click', async () => {
      if (!cachedGuestShareUrl) return;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'CueSport public control link',
            text: 'Join as guest scorer',
            url: cachedGuestShareUrl,
          });
        } catch (err) {
          if (err && err.name !== 'AbortError') setError(err.message || 'Share failed');
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(cachedGuestShareUrl);
        nativeShareBtn.textContent = 'Link copied';
        setTimeout(() => { nativeShareBtn.textContent = 'Share link'; }, 1500);
      } catch (_) {
        setError('Sharing not supported on this device');
      }
    });
  }
}

function setConnectionStatus(kind) {
  const el = document.getElementById('connectionStatus');
  if (!el) return;
  const map = {
    connected: 'Connected',
    waiting: 'Waiting for dock',
    disconnected: 'Disconnected',
  };
  const label = map[kind] || map.disconnected;
  el.classList.remove('connected', 'waiting', 'disconnected');
  el.classList.add(map[kind] ? kind : 'disconnected');
  el.title = label;
  el.setAttribute('aria-label', label);
  updateControlsLock();
}

/** Controls require a live cloud socket AND a dock in the room. */
function controlsEnabled() {
  return !!(client && client.connected && dockPresent);
}

function updateControlsLock() {
  const locked = !controlsEnabled();
  document.body.classList.toggle('controls-locked', locked);
  const live = document.getElementById('liveBoard');
  if (live) {
    live.setAttribute('aria-disabled', locked ? 'true' : 'false');
    if (locked) live.title = controlLockMessage();
    else live.removeAttribute('title');
  }
}

function wireClientLifecycle(c) {
  c.on('presence', (clients) => {
    dockPresent = (clients || []).includes('dock');
    setConnectionStatus(dockPresent ? 'connected' : 'waiting');
  });
  c.on('close', () => {
    dockPresent = false;
    setConnectionStatus('disconnected');
  });
}

function show(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function setError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg || '';
  show('error', !!msg);
}

function setSyncing(on) {
  show('syncHint', !!on);
  if (syncTimer) clearTimeout(syncTimer);
  if (on) {
    syncTimer = setTimeout(() => show('syncHint', false), 4000);
  }
}

function gameTypeLabel(id) {
  const g = GAME_TYPES.find((x) => x.id === id);
  return g ? g.label : (id || '—');
}

function applyState(state) {
  if (!state || typeof state !== 'object') return;
  // Ignore superseded dock publishes (stale in-flight snapshots).
  if (typeof state.stateSeq === 'number') {
    if (state.stateSeq < lastStateSeq) return;
    lastStateSeq = state.stateSeq;
  }
  const prevTs = lastState.timestamp;
  lastState = state;
  setSyncing(false);
  if (state.timestamp && state.timestamp !== prevTs) {
    lastBallGridKey = '';
  }

  const p1Name = state.player1Name != null && state.player1Name !== '' ? state.player1Name : 'P1';
  const p2Name = state.player2Name != null && state.player2Name !== '' ? state.player2Name : 'P2';
  const p1Score = Number(state.p1Score) || 0;
  const p2Score = Number(state.p2Score) || 0;
  const p1Balls = Number(state.p1Balls) || 0;
  const p2Balls = Number(state.p2Balls) || 0;
  const primaryLabel = state.primaryScoreLabel || (state.gameType === 'game8' ? 'Frames' : 'Racks');
  const secondaryLabel = state.secondaryScoreLabel || (state.gameType === 'game8' ? 'Points' : 'Balls');
  const dual = state.dualScoreMode === true ||
    state.gameType === 'game8' ||
    state.gameType === 'game5' ||
    state.gameType === 'game6' ||
    (state.gameType === 'game7' && state.pointBased === 'yes');

  show('dualScoresPanel', dual);
  show('singleScoresPanel', !dual);

  if (dual) {
    document.getElementById('p1PrimaryLabel').textContent = `${p1Name} - ${primaryLabel}`;
    document.getElementById('p2PrimaryLabel').textContent = `${p2Name} - ${primaryLabel}`;
    document.getElementById('p1PrimaryValue').textContent = String(p1Score);
    document.getElementById('p2PrimaryValue').textContent = String(p2Score);
    document.getElementById('p1SecondaryLabel').textContent = `${p1Name} - ${secondaryLabel}`;
    document.getElementById('p2SecondaryLabel').textContent = `${p2Name} - ${secondaryLabel}`;
    document.getElementById('p1SecondaryValue').textContent = String(p1Balls);
    document.getElementById('p2SecondaryValue').textContent = String(p2Balls);
  } else {
    document.getElementById('p1SingleLabel').textContent = `${p1Name} - ${primaryLabel}`;
    document.getElementById('p2SingleLabel').textContent = `${p2Name} - ${primaryLabel}`;
    document.getElementById('p1SingleValue').textContent = String(p1Score);
    document.getElementById('p2SingleValue').textContent = String(p2Score);
  }

  const raceLabel = document.getElementById('raceLabel');
  if (raceLabel) raceLabel.textContent = state.raceLabel || (state.gameType === 'game8' ? 'Best Of' : 'Race');

  const active = String(state.activePlayer || '1');
  const slotMode = inferPlayerSlotMode(state);
  const slotQuestion = document.getElementById('playerSlotQuestion');
  const slotP1 = document.getElementById('playerSlotP1Btn');
  const slotP2 = document.getElementById('playerSlotP2Btn');
  // Always show at top of sticky board (replaces the old name-only live-scores row).
  show('playerSlotPanel', true);
  if (slotQuestion) {
    if (slotMode === 'match_locked') {
      slotQuestion.textContent = 'End Match to Continue';
    } else if (slotMode === 'breaker') {
      slotQuestion.textContent = 'Breaking Player?';
    } else {
      slotQuestion.textContent = 'Active Player';
    }
  }
  if (slotP1 && slotP2) {
    slotP1.textContent = p1Name || 'P1';
    slotP2.textContent = p2Name || 'P2';
    slotP1.classList.remove('selected', 'rack-breaker-match-locked', 'rack-breaker-inactive');
    slotP2.classList.remove('selected', 'rack-breaker-match-locked', 'rack-breaker-inactive');
    if (slotMode === 'breaker' || slotMode === 'match_locked') {
      slotP1.classList.toggle('rack-breaker-match-locked', slotMode === 'match_locked');
      slotP2.classList.toggle('rack-breaker-match-locked', slotMode === 'match_locked');
    } else {
      // Active (or off): highlight current player — names live here now.
      slotP1.classList.toggle('selected', active === '1');
      slotP2.classList.toggle('selected', active === '2');
      slotP1.classList.toggle('rack-breaker-inactive', active !== '1');
      slotP2.classList.toggle('rack-breaker-inactive', active !== '2');
    }
  }

  // Form fields — always sync from dock (including empty)
  if (state.player1Name != null) document.getElementById('p1Name').value = state.player1Name;
  if (state.player2Name != null) document.getElementById('p2Name').value = state.player2Name;
  if (state.raceInfo != null) document.getElementById('raceInput').value = state.raceInfo;
  if (state.gameInfo != null) document.getElementById('gameInfoInput').value = state.gameInfo;
  if (state.gameType) document.getElementById('gameTypeSelect').value = state.gameType;

  const metaParts = [
    gameTypeLabel(state.gameType),
    state.raceInfo ? `${state.raceLabel || 'Race'} ${state.raceInfo}` : null,
    dual ? `${primaryLabel} + ${secondaryLabel}` : null,
    state.ballScoringEnabled ? 'Ball scoring on' : null,
  ].filter(Boolean);
  document.getElementById('liveMeta').textContent = metaParts.join(' · ');

  const callBtn = document.getElementById('callMatchBtn');
  if (callBtn) callBtn.disabled = state.canCallGame === false;

  const resetBtn = document.getElementById('resetScoresBtn');
  if (resetBtn) {
    resetBtn.textContent = getResetActionLabel();
  }

  const replayPanel = document.getElementById('replayPanel');
  if (replayPanel) {
    replayPanel.querySelectorAll('button').forEach((btn) => {
      btn.disabled = state.obsConnected === false;
    });
  }

  renderBallGrid(state);
}

const BALL_IMG = '/images/balls';
let lastBallGridKey = '';
let lastStateSeq = 0;

const SNOOKER_FOUL_POINTS = {
  white: 4,
  yellow: 4,
  green: 4,
  brown: 4,
  gold: 20,
  blue: 5,
  pink: 6,
  black: 7,
};

const SNOOKER_FOUL_IMAGES = {
  white: 'snooker-white-small.png',
  yellow: 'snooker-yellow-small.png',
  green: 'snooker-green-small.png',
  brown: 'snooker-brown-small.png',
  blue: 'snooker-blue-small.png',
  pink: 'snooker-pink-small.png',
  black: 'snooker-black-small.png',
  gold: 'snooker-gold-small.png',
};

const BREAKER_GAME_TYPES = new Set([
  'game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8',
]);

function isBallScoringOn(state) {
  if (!state) return false;
  if (state.ballScoringEnabled === true || state.ballTrackerEnabled === true) return true;
  return !!(state.ballGrid && state.ballGrid.visible);
}

function isBreakerPromptGame(state) {
  if (!state || !BREAKER_GAME_TYPES.has(state.gameType || '')) return false;
  if (!isBallScoringOn(state)) return false;
  if (state.player1Enabled === false || state.player2Enabled === false) return false;
  return true;
}

/** Match control_panel: lock balls until rackBreakerSlot is set for this frame. */
function inferAwaitingBreaker(state) {
  if (!state || state.gameScoringLocked) return false;
  const slot = String(state.rackBreakerSlot || '');
  if (slot === '1' || slot === '2') return false;
  if (state.awaitingBreaker === true) return true;
  if (state.ballGrid && state.ballGrid.awaitingBreaker === true) return true;
  return isBreakerPromptGame(state);
}

function inferPlayerSlotMode(state) {
  if (!isBreakerPromptGame(state)) return 'off';
  const slot = String(state.rackBreakerSlot || '');
  if (slot === '1' || slot === '2') return 'active';
  if (state.gameScoringLocked) return 'match_locked';
  return 'breaker';
}

function optimisticSelectBreaker(slot) {
  const s = String(slot);
  if (s !== '1' && s !== '2') return;
  lastState = {
    ...lastState,
    rackBreakerSlot: s,
    activePlayer: s,
    awaitingBreaker: false,
    breakerPromptVisible: false,
    playerSlotMode: 'active',
    ballGrid: lastState.ballGrid
      ? { ...lastState.ballGrid, awaitingBreaker: false }
      : lastState.ballGrid,
  };
  lastBallGridKey = '';
  applyState(lastState);
}

function ballImageFile(n, selection) {
  if (selection === 'international') {
    if (n >= 1 && n <= 7) return 'yellow-international-small-ball.png';
    if (n === 8) return 'international-8-small-ball.png';
    return 'red-international-small-ball.png';
  }
  if (selection === 'unity') return `${n}-ball-unity-small.png`;
  if (selection === 'ultimate') return `ultimate-${n}ball-small.png`;
  if (selection === 'snooker') {
    const files = {
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
    return files[n] || `${n}ball_small.png`;
  }
  return `${n}ball_small.png`;
}

function appendBallButton(grid, { src, title, faded, disabled, awaiting, action, payload, extraClass, cooldown, clicked }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ball-btn' + (extraClass ? ` ${extraClass}` : '');
  btn.title = title;
  btn.setAttribute('aria-label', title || 'Ball');
  btn.dataset.ballId = payload && payload.ballId ? payload.ballId : '';
  const locked = !!disabled || !!awaiting;
  btn.disabled = locked;
  if (faded) btn.classList.add('faded');
  if (cooldown) btn.classList.add('ball-cooldown');
  if (clicked) btn.classList.add('ball-clicked');
  if (locked) btn.classList.add('is-disabled');
  const img = document.createElement('img');
  img.src = src;
  img.alt = title;
  btn.appendChild(img);
  if (!locked && action) {
    btn.onclick = () => {
      if (action === 'open_foul_picker') {
        openSnookerFoulPicker();
        return;
      }
      // Dock owns scoring rules (snooker free ball, rack wins, pocket pots, etc.).
      sendCmd(action, payload);
    };
  }
  grid.appendChild(btn);
}

function appendUndoButton(grid, { canUndo, title }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ball-btn undo-ball';
  btn.title = title || 'Undo last scoring action';
  btn.disabled = !canUndo;
  const img = document.createElement('img');
  img.src = `${BALL_IMG}/undo-small.png`;
  img.alt = 'Undo';
  btn.appendChild(img);
  if (!btn.disabled) {
    btn.onclick = () => sendCmd('undo', {});
  }
  grid.appendChild(btn);
}

function renderBallGrid(state) {
  const panel = document.getElementById('ballGridPanel');
  const grid = document.getElementById('ballGrid');
  const hint = document.getElementById('ballGridHint');
  const snapshot = state.ballGrid;
  const awaiting = inferAwaitingBreaker(state);
  const locked = !!(state.gameScoringLocked || (snapshot && snapshot.locked));
  const canUndo = state.canUndo === true || (snapshot && snapshot.canUndo === true);
  const undoTitle = snapshot && snapshot.snooker
    ? 'Undo last pot or foul'
    : 'Undo last scoring action (pots, fouls, breaker)';
  const useSnapshot = !!(snapshot && Array.isArray(snapshot.balls) && snapshot.balls.length);
  const ballSig = useSnapshot
    ? snapshot.balls.map((b) => `${b.id}:${b.disabled ? 1 : 0}:${b.faded ? 1 : 0}:${b.hidden ? 1 : 0}:${b.clicked ? 1 : 0}`).join('|')
    : '';
  const key = JSON.stringify({
    ballSig,
    snooker: snapshot && snapshot.snooker,
    awaiting,
    locked,
    canUndo,
    freeBall: !!state.snookerFreeBallOffered,
    ballState: state.ballState,
    ballScoringEnabled: state.ballScoringEnabled,
    gameType: state.gameType,
    rackBreakerSlot: state.rackBreakerSlot,
    ts: state.timestamp,
  });
  if (key === lastBallGridKey) return;
  lastBallGridKey = key;
  grid.innerHTML = '';
  grid.classList.toggle('awaiting-breaker', awaiting);

  const showGrid = useSnapshot || isBallScoringOn(state);
  if (!showGrid) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  if (hint) {
    if (awaiting) {
      // Breaker prompt is already in player slot + match status — no extra hint.
      hint.textContent = '';
      hint.classList.add('hidden');
    } else if (locked) {
      hint.textContent = 'Scoring locked';
      hint.classList.remove('hidden');
    } else if (state.snookerFreeBallOffered && snapshot && snapshot.snooker) {
      hint.textContent = 'Free ball available';
      hint.classList.remove('hidden');
    } else if (!useSnapshot && (state.gameType === 'game8' || state.ballSelection === 'snooker')) {
      hint.textContent = 'Waiting for ball state from dock…';
      hint.classList.remove('hidden');
    } else {
      hint.textContent = '';
      hint.classList.add('hidden');
    }
  }

  if (useSnapshot) {
    snapshot.balls.forEach((b) => {
      if (b.hidden) return;
      // Foul is the only local UI exception (dock modal cannot run on the phone).
      // Free ball, colors, reds, and pool pots all go through dock handlers.
      const isFoul = b.foul === true || b.id === 'ball 11';
      appendBallButton(grid, {
        src: b.file ? `${BALL_IMG}/${b.file}` : `${BALL_IMG}/8ball_small.png`,
        title: b.title,
        faded: !!b.faded || !!(state.ballState && state.ballState[b.id]),
        disabled: !!b.disabled || locked,
        awaiting,
        cooldown: !!b.cooldown,
        clicked: !!b.clicked,
        extraClass: b.freeball ? 'freeball-btn' : '',
        action: isFoul ? 'open_foul_picker' : (snapshot.snooker ? 'snooker_ball' : 'toggle_pot'),
        payload: { ballId: b.id },
      });
    });
    appendUndoButton(grid, { canUndo, title: undoTitle });
    return;
  }

  const gt = state.gameType;
  const selection = state.ballSelection || 'american';
  if (gt === 'game8' || selection === 'snooker') {
    appendUndoButton(grid, { canUndo, title: undoTitle });
    return;
  }

  const max = gt === 'game2' ? 9 : gt === 'game3' ? 10 : 15;
  const style = (gt === 'game2' || gt === 'game3') ? 'american' : selection;
  for (let i = 1; i <= max; i++) {
    const id = `ball ${i}`;
    appendBallButton(grid, {
      src: `${BALL_IMG}/${ballImageFile(i, style)}`,
      title: `Ball ${i}`,
      faded: !!(state.ballState && state.ballState[id]),
      disabled: locked,
      awaiting,
      action: 'toggle_pot',
      payload: { ballId: id },
    });
  }
  appendUndoButton(grid, { canUndo, title: undoTitle });
}

function defaultSnookerFoulTargets() {
  return Object.keys(SNOOKER_FOUL_IMAGES)
    .filter((key) => key !== 'gold')
    .map((key) => ({
      key,
      file: SNOOKER_FOUL_IMAGES[key],
      alt: key.charAt(0).toUpperCase() + key.slice(1),
    }));
}

function openSnookerFoulPicker() {
  const modal = document.getElementById('snookerFoulModal');
  const container = document.getElementById('snookerFoulTargets');
  const hint = document.getElementById('snookerFoulHint');
  if (!modal || !container) return;

  const snapshot = lastState.ballGrid;
  const fromDock = snapshot && Array.isArray(snapshot.snookerFoulTargets) && snapshot.snookerFoulTargets.length
    ? snapshot.snookerFoulTargets
    : defaultSnookerFoulTargets();

  container.innerHTML = '';
  fromDock.forEach((target) => {
    const key = target.key;
    const points = SNOOKER_FOUL_POINTS[key];
    if (!points) return;
    const file = target.file || SNOOKER_FOUL_IMAGES[key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'foul-target-btn';
    btn.dataset.foul = key;
    btn.title = `${points}-point foul`;
    const img = document.createElement('img');
    img.src = `${BALL_IMG}/${file}`;
    img.alt = target.alt || key;
    btn.appendChild(img);
    btn.addEventListener('pointerdown', (e) => {
      // preventDefault on pointerdown suppresses the compatibility mouse click that
      // would otherwise land on the ball grid (often Undo) after the modal closes.
      if (e.pointerType !== 'mouse' || e.button === 0) {
        e.preventDefault();
      }
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectSnookerFoul(key);
    });
    btn.addEventListener('pointerenter', () => {
      if (hint) hint.textContent = `${points}-point foul`;
    });
    container.appendChild(btn);
  });

  if (hint) hint.textContent = '';
  modal.classList.remove('hidden');
}

function closeSnookerFoulPicker() {
  const modal = document.getElementById('snookerFoulModal');
  const hint = document.getElementById('snookerFoulHint');
  if (modal) modal.classList.add('hidden');
  if (hint) hint.textContent = '';
}

function selectSnookerFoul(foulKey) {
  closeSnookerFoulPicker();
  sendCmd('snooker_foul', { foulKey });
}

function wireSnookerFoulModal() {
  document.getElementById('snookerFoulCancel')?.addEventListener('click', closeSnookerFoulPicker);
  document.getElementById('snookerFoulBackdrop')?.addEventListener('click', closeSnookerFoulPicker);
}

function getResetActionLabel() {
  return lastState?.gameType === 'game8' ? 'Reset Frame' : 'Reset Rack';
}

const MATCH_CONFIRM_CMDS = new Set(['reset_scores', 'end_match', 'call_match_early']);
let pendingMatchConfirm = null;

function getMatchActionConfirmCopy(cmd) {
  const resetLabel = getResetActionLabel();
  const unit = lastState?.gameType === 'game8' ? 'frame' : 'rack';
  const copy = {
    reset_scores: {
      title: resetLabel,
      message: `Clear the current ${unit} scoreline for this match? This cannot be undone from here.`,
      confirm: resetLabel,
    },
    end_match: {
      title: 'End Match',
      message: 'End the match and clear all scores? Recorded stats will be kept.',
      confirm: 'End Match',
    },
    call_match_early: {
      title: 'Call Match Early',
      message: 'End this match early and keep completed racks/frames in match history? Scores will clear after saving. Please note, this is not ending the frame, this is the entire match — to complete a frame, score it for the appropriate player.',
      confirm: 'Call Match Early',
    },
  };
  return copy[cmd] || { title: 'Confirm', message: 'Are you sure?', confirm: 'Confirm' };
}

function closeMatchConfirmModal() {
  pendingMatchConfirm = null;
  document.getElementById('confirmModal')?.classList.add('hidden');
}

function openMatchConfirmModal(cmd, run) {
  const cfg = getMatchActionConfirmCopy(cmd);
  pendingMatchConfirm = run;
  document.getElementById('confirmModalTitle').textContent = cfg.title;
  document.getElementById('confirmModalMessage').textContent = cfg.message;
  document.getElementById('confirmModalConfirm').textContent = cfg.confirm;
  document.getElementById('confirmModal')?.classList.remove('hidden');
}

function wireMatchConfirmModal() {
  const dismiss = () => closeMatchConfirmModal();
  document.getElementById('confirmModalCancel')?.addEventListener('click', dismiss);
  document.getElementById('confirmModalDismiss')?.addEventListener('click', dismiss);
  document.getElementById('confirmModalBackdrop')?.addEventListener('click', dismiss);
  document.getElementById('confirmModalConfirm')?.addEventListener('click', () => {
    const run = pendingMatchConfirm;
    closeMatchConfirmModal();
    if (run) run();
  });
}

function controlLockMessage() {
  if (!client || !client.connected) return 'Not connected to cloud — controls are paused';
  if (!dockPresent) return 'Waiting for dock — controls are paused';
  return 'Controls are paused';
}

function sendCmd(action, payload) {
  if (!controlsEnabled()) {
    setError(controlLockMessage());
    return;
  }
  setSyncing(true);
  client.sendCommand(action, payload);
}

function wireCommands() {
  document.querySelectorAll('[data-cmd]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!controlsEnabled()) {
        setError(controlLockMessage());
        return;
      }
      const cmd = el.dataset.cmd;
      const payload = {};
      if (el.dataset.player) payload.player = el.dataset.player;
      if (el.dataset.slot) payload.slot = el.dataset.slot;
      if (el.dataset.isp1 != null) payload.isP1 = el.dataset.isp1 === 'true';
      if (el.dataset.index != null) payload.index = parseInt(el.dataset.index, 10);
      if (cmd === 'set_player_name') {
        payload.slot = el.dataset.slot;
        payload.name = document.getElementById(payload.slot === '1' ? 'p1Name' : 'p2Name').value;
      }
      if (cmd === 'player_slot' && payload.slot && inferPlayerSlotMode(lastState) === 'breaker') {
        optimisticSelectBreaker(payload.slot);
        sendCmd('select_breaker', { slot: payload.slot });
        return;
      }
      if (MATCH_CONFIRM_CMDS.has(cmd)) {
        openMatchConfirmModal(cmd, () => sendCmd(cmd, payload));
        return;
      }
      sendCmd(cmd, payload);
    });
  });

  document.getElementById('saveRaceBtn').onclick = () => {
    sendCmd('set_race', { value: document.getElementById('raceInput').value });
  };
  document.getElementById('saveGameInfoBtn').onclick = () => {
    sendCmd('set_game_info', { value: document.getElementById('gameInfoInput').value });
  };
  document.getElementById('saveGameTypeBtn').onclick = () => {
    sendCmd('set_game_type', { gameType: document.getElementById('gameTypeSelect').value });
  };
}

async function connect() {
  setError('');
  const ctx = pathContext();
  guestToken = ctx.guestToken || '';
  isGuestMode = !!guestToken;
  roomId = ctx.roomId || '';

  if (isGuestMode) {
    applyGuestUI();
    if (client) {
      try { client.disconnect(); } catch (_) { /* ignore */ }
    }
    client = new CloudClient({
      serverUrl: window.location.origin,
      guestToken,
      client: 'mobile_guest',
    });
    client.on('state', applyState);
    wireClientLifecycle(client);
    client.on('error', (e) => setError(e.message || e.code || 'Connection failed'));
    try {
      const joined = await client.connect();
      show('loginSection', false);
      show('controlSection', true);
      showMobileNav(true);
      setActiveView('control');
      dockPresent = (joined.clients || []).includes('dock');
      if (joined.state && Object.keys(joined.state).length) {
        applyState(joined.state);
      }
      setConnectionStatus(dockPresent ? 'connected' : 'waiting');
    } catch (err) {
      setError(err.message);
      setConnectionStatus('disconnected');
    }
    return;
  }

  if (!roomId) {
    setError('Room ID missing in URL (/m/{room_id})');
    return;
  }

  const email = document.getElementById('devEmail').value.trim();
  let token = localStorage.getItem(TOKEN_KEY);

  if (email) {
    try {
      const data = await devLogin(window.location.origin, email);
      token = data.access_token;
      localStorage.setItem(TOKEN_KEY, token);
    } catch (err) {
      setError(err.message || 'Login failed');
      return;
    }
  } else if (!token) {
    setError('Enter the same email you used on the dashboard (dev login)');
    return;
  }

  if (client) {
    try { client.disconnect(); } catch (_) { /* ignore */ }
  }

  client = new CloudClient({
    serverUrl: window.location.origin,
    roomId,
    client: 'mobile',
    accessToken: token,
  });
  client.on('state', applyState);
  wireClientLifecycle(client);
  client.on('error', (e) => {
    const msg = String(e.message || e.code || '');
    if (
      msg.includes('token') ||
      msg.includes("'sub'") ||
      e.code === 'room_forbidden' ||
      e.code === 'invalid_token'
    ) {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (e.code === 'room_forbidden') {
      setError('This room belongs to another account. Use the same email as on the dashboard, or open the mobile link from your dashboard after signing in.');
      return;
    }
    setError(e.message || e.code || 'Connection failed');
  });

  try {
    const joined = await client.connect();
    show('loginSection', false);
    show('controlSection', true);
    showMobileNav(true);
    setActiveView('control');
    dockPresent = (joined.clients || []).includes('dock');
    if (joined.state && Object.keys(joined.state).length) {
      applyState(joined.state);
    }
    setConnectionStatus(dockPresent ? 'connected' : 'waiting');
  } catch (err) {
    setError(err.message);
    setConnectionStatus('disconnected');
  }
}

const select = document.getElementById('gameTypeSelect');
GAME_TYPES.forEach((g) => {
  const opt = document.createElement('option');
  opt.value = g.id;
  opt.textContent = g.label;
  select.appendChild(opt);
});

document.getElementById('connectBtn').addEventListener('click', connect);
document.getElementById('clearTokenBtn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  if (client) {
    try { client.disconnect(); } catch (_) { /* ignore */ }
    client = null;
  }
  dockPresent = false;
  setError('');
  setConnectionStatus('disconnected');
  show('loginSection', true);
  show('controlSection', false);
  showMobileNav(false);
  setActiveView('control');
});
wireCommands();
wireMatchConfirmModal();
wireSnookerFoulModal();
wireMobileNav();

if (pathContext().guestToken) {
  connect().catch(() => {});
} else if (localStorage.getItem(TOKEN_KEY) && pathContext().roomId) {
  connect().catch(() => {});
}
