import {
  CloudClient,
  devLogin,
  createGuestLink,
  fetchGuestLinks,
  revokeGuestLink,
  fetchPlayers,
  GAME_TYPES,
} from '../shared/cloud-client.js?v=7.2.3-guest-room';

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
let cachedGuestShareToken = '';
let guestSharePromise = null;

function pathContext() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const gIdx = parts.indexOf('g');
  if (gIdx >= 0 && parts[gIdx + 1]) return { guestToken: parts[gIdx + 1] };
  const mIdx = parts.indexOf('m');
  if (mIdx >= 0 && parts[mIdx + 1]) return { roomId: parts[mIdx + 1] };
  return {};
}

function hasSavedLogin() {
  return !!localStorage.getItem(TOKEN_KEY);
}

function syncLoginPanel() {
  const saved = hasSavedLogin();
  const hint = document.getElementById('loginHint');
  const secretRow = document.getElementById('devSecretRow');
  if (saved) {
    if (hint) {
      hint.innerHTML = 'Using saved login from this browser. Tap <strong>Connect</strong> to open this table. Use <strong>Clear saved login</strong> to sign in with a different secret.';
    }
    secretRow?.classList.add('hidden');
  } else {
    if (hint) {
      hint.innerHTML = 'Sign in on the <a href="/dashboard">dashboard</a> first (same browser), or enter your <strong>dev auth secret</strong> once below.';
    }
    secretRow?.classList.remove('hidden');
  }
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

  const controlBtn = document.getElementById('navControlBtn');
  if (controlBtn) {
    controlBtn.classList.toggle('active', view === 'control');
    controlBtn.setAttribute('aria-current', view === 'control' ? 'page' : 'false');
  }
  const setupBtn = document.getElementById('navSetupBtn');
  if (setupBtn) {
    setupBtn.classList.toggle('active', view === 'setup');
    setupBtn.setAttribute('aria-current', view === 'setup' ? 'page' : 'false');
  }
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) {
    replayBtn.classList.toggle('active', view === 'replay');
    replayBtn.setAttribute('aria-current', view === 'replay' ? 'page' : 'false');
  }
  const shareBtn = document.getElementById('navShareBtn');
  if (shareBtn) {
    shareBtn.classList.toggle('active', view === 'share');
    shareBtn.setAttribute('aria-current', view === 'share' ? 'page' : 'false');
  }

  if (view === 'share') {
    ensureGuestShareLink({ refreshList: true }).catch((err) => setError(err.message || 'Failed to create guest link'));
  }
}

function guestUrlFromLink(link) {
  if (!link) return '';
  if (link.path) return `${window.location.origin}${link.path}`;
  if (link.url) return link.url;
  if (link.token) return `${window.location.origin}/g/${link.token}`;
  return '';
}

async function ensureGuestShareLink({ refreshList = false } = {}) {
  if (guestSharePromise) return guestSharePromise;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!roomId || !token) {
    throw new Error('Sign in required to create a public control link');
  }
  const status = document.getElementById('shareStatus');
  if (!cachedGuestShareUrl && status) {
    status.textContent = 'Preparing link…';
    status.classList.remove('hidden');
  }
  guestSharePromise = (async () => {
    let links = await fetchGuestLinks(window.location.origin, token, roomId);
    if (!links.length) {
      const created = await createGuestLink(window.location.origin, token, roomId);
      links = await fetchGuestLinks(window.location.origin, token, roomId);
      if (!links.length) {
        links = [{ token: created.token, path: created.path, url: created.url, label: created.label, connected: 0 }];
      }
    }
    const chosen = links.find((g) => g.token === cachedGuestShareToken) || links[0];
    cachedGuestShareToken = chosen.token;
    cachedGuestShareUrl = guestUrlFromLink(chosen);
    renderShareLink(cachedGuestShareUrl);
    renderGuestLinks(links);
    return cachedGuestShareUrl;
  })()
    .finally(() => {
      guestSharePromise = null;
    });
  return guestSharePromise;
}

function renderGuestLinks(links) {
  const list = document.getElementById('guestLinkList');
  if (!list) return;
  list.innerHTML = '';
  if (!(links || []).length) {
    list.innerHTML = '<li class="hint">No guest links for this table.</li>';
    return;
  }
  links.forEach((g) => {
    const li = document.createElement('li');
    li.className = 'token-list-item';
    const n = Number(g.connected) || 0;
    const label = document.createElement('span');
    const status = n > 0
      ? `${n} connected`
      : 'Offline';
    label.textContent = `${g.label || 'Guest'} · ${g.created_at} · ${status}`;
    if (g.token === cachedGuestShareToken) li.classList.add('is-current');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn danger';
    btn.textContent = 'Revoke';
    btn.addEventListener('click', async () => {
      if (!window.confirm('Revoke this guest link? Anyone using it will be disconnected.')) return;
      try {
        await revokeGuestLink(window.location.origin, localStorage.getItem(TOKEN_KEY), g.token);
        if (cachedGuestShareToken === g.token) {
          cachedGuestShareToken = '';
          cachedGuestShareUrl = '';
        }
        await ensureGuestShareLink({ refreshList: true });
      } catch (err) {
        setError(err.message);
      }
    });
    li.appendChild(label);
    li.appendChild(btn);
    list.appendChild(li);
  });
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
  const controlBtn = document.getElementById('navControlBtn');
  if (controlBtn) {
    controlBtn.addEventListener('click', () => setActiveView('control'));
  }
  const setupBtn = document.getElementById('navSetupBtn');
  if (setupBtn) {
    setupBtn.addEventListener('click', () => setActiveView('setup'));
  }
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => setActiveView('replay'));
  }
  const shareNavBtn = document.getElementById('navShareBtn');
  if (shareNavBtn) {
    shareNavBtn.addEventListener('click', () => setActiveView('share'));
  }
  const newLinkBtn = document.getElementById('shareNewLinkBtn');
  if (newLinkBtn) {
    newLinkBtn.addEventListener('click', async () => {
      if (!window.confirm('Create a new guest link? Existing links stay valid until you revoke them.')) return;
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!roomId || !token) throw new Error('Sign in required to create a public control link');
        const created = await createGuestLink(window.location.origin, token, roomId);
        cachedGuestShareToken = created.token;
        cachedGuestShareUrl = guestUrlFromLink(created);
        await ensureGuestShareLink();
      } catch (err) {
        setError(err.message || 'Failed to create guest link');
      }
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
  const text = msg || '';
  ['loginError', 'error'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  });
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
  syncSelectFromState('gameTypeSelect', 'gameType', state.gameType);
  syncSetupFieldsFromState(state);

  const metaParts = [
    gameTypeLabel(state.gameType),
    state.raceInfo ? `${state.raceLabel || 'Race'} ${state.raceInfo}` : null,
    dual ? `${primaryLabel} + ${secondaryLabel}` : null,
    state.ballScoringEnabled ? 'Ball scoring on' : null,
  ].filter(Boolean);
  document.getElementById('liveMeta').textContent = metaParts.join(' · ');

  syncMatchActionButtons(state);
  syncReplayPanel(state);

  renderBallGrid(state);
}

const BALL_IMG = '/web/images/balls';
let lastBallGridKey = '';
let lastStateSeq = 0;

/** Hold local setup edits until dock state confirms (avoids select/checkbox snap-back). */
const pendingSetupSync = {};

function markSetupPending(key, value) {
  pendingSetupSync[key] = { value: String(value), until: Date.now() + 5000 };
}

function shouldSyncSetupFromState(key, stateValue) {
  const pending = pendingSetupSync[key];
  if (!pending) return true;
  if (Date.now() > pending.until) {
    delete pendingSetupSync[key];
    return true;
  }
  if (String(stateValue) === pending.value) {
    delete pendingSetupSync[key];
    return true;
  }
  return false;
}

function syncSelectFromState(selectId, key, stateValue) {
  if (stateValue == null || stateValue === '') return;
  if (!shouldSyncSetupFromState(key, stateValue)) return;
  const el = document.getElementById(selectId);
  if (el && el.value !== String(stateValue)) el.value = String(stateValue);
}

function syncCheckboxFromState(checkboxId, key, checked) {
  if (typeof checked !== 'boolean') return;
  if (!shouldSyncSetupFromState(key, checked ? '1' : '0')) return;
  const el = document.getElementById(checkboxId);
  if (el) el.checked = checked;
}

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

function ballImageBasename(file) {
  if (!file) return '';
  return String(file).split('/').pop().split('?')[0];
}

function resolveBallImageSrc(state, ballId, snapshotFile) {
  const file = ballImageBasename(snapshotFile);
  if (file) return `${BALL_IMG}/${file}`;
  const n = parseInt(String(ballId || '').replace(/\D/g, ''), 10);
  if (n >= 1 && n <= 15) {
    const gt = state.gameType;
    const style = (gt === 'game2' || gt === 'game3') ? 'american' : (state.ballSelection || 'american');
    return `${BALL_IMG}/${ballImageFile(n, style)}`;
  }
  return `${BALL_IMG}/8ball_small.png`;
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
    ? snapshot.balls.map((b) => `${b.id}:${b.file || ''}:${b.disabled ? 1 : 0}:${b.faded ? 1 : 0}:${b.hidden ? 1 : 0}:${b.clicked ? 1 : 0}`).join('|')
    : '';
  const key = JSON.stringify({
    ballSig,
    ballSelection: state.ballSelection || 'american',
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
        src: resolveBallImageSrc(state, b.id, b.file),
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

function getResetActionLabel(state = lastState) {
  return state?.gameType === 'game8' ? 'Reset Frame' : 'Reset Rack';
}

/** Same rule as control_panel getRaceTarget / isGameScoringLocked. */
function getRaceTargetFromState(state) {
  const raceString = String(state?.raceInfo || '').trim();
  if (!raceString) return null;
  const matches = raceString.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const target = parseInt(matches[matches.length - 1], 10);
  if (!Number.isFinite(target) || target <= 0) return null;
  // Snooker Best Of N → first to floor(N/2)+1
  if (state?.gameType === 'game8') return Math.floor(target / 2) + 1;
  return target;
}

function isRaceCompleteFromState(state) {
  if (!state) return false;
  const raceTarget = getRaceTargetFromState(state);
  if (raceTarget === null) return false;
  const p1 = Number(state.p1Score) || 0;
  const p2 = Number(state.p2Score) || 0;
  return p1 >= raceTarget || p2 >= raceTarget;
}

/**
 * Match control_panel: one danger button morphs Reset Rack/Frame ↔ End Match.
 * Call Match only when racks exist and the race is not complete.
 */
function syncMatchActionButtons(state) {
  // Same gate as control_panel isRaceComplete() / isGameScoringLocked()
  const locked = isRaceCompleteFromState(state);
  const canCall = !locked && state.canCallGame === true;

  const resetBtn = document.getElementById('resetScoresBtn');
  if (resetBtn) {
    if (locked) {
      resetBtn.textContent = 'End Match';
      resetBtn.dataset.cmd = 'end_match';
    } else {
      resetBtn.textContent = getResetActionLabel(state);
      resetBtn.dataset.cmd = 'reset_scores';
    }
    resetBtn.classList.remove('hidden');
    resetBtn.disabled = false;
  }

  const callBtn = document.getElementById('callMatchBtn');
  if (callBtn) {
    callBtn.classList.toggle('hidden', !canCall);
    callBtn.disabled = !canCall;
  }
}

/**
 * Match control_panel: Instant Replay only while monitoring; clips only when that slot
 * exists; Monitor label reflects start/stop / Replay Active.
 */
function syncReplayPanel(state) {
  const monitoring = !!state.monitoringActive;
  const replayPlaying = !!state.replayPlaybackActive;
  // Monitoring implies OBS was usable; don't hide clips if obsConnected lagged false.
  const obsConnected = state.obsConnected === true || monitoring || replayPlaying;
  const clips = Array.isArray(state.replayClips)
    ? state.replayClips
    : Array.from({ length: 5 }, (_, i) => i < (Number(state.replayClipCount) || 0));

  const hint = document.getElementById('replayObsHint');
  if (hint) hint.classList.toggle('hidden', obsConnected || monitoring || replayPlaying);

  const monitorBtn = document.getElementById('monitorBtn');
  if (monitorBtn) {
    if (replayPlaying) {
      monitorBtn.textContent = 'Replay Active';
      monitorBtn.classList.remove('monitor-active');
      monitorBtn.classList.add('replay-active');
      monitorBtn.disabled = true;
    } else {
      monitorBtn.textContent = monitoring ? 'Stop Monitoring' : 'Resume Monitoring';
      monitorBtn.classList.toggle('monitor-active', monitoring);
      monitorBtn.classList.remove('replay-active');
      monitorBtn.disabled = false;
    }
  }

  const instantBtn = document.getElementById('instantReplayBtn');
  if (instantBtn) {
    // Match control_panel: Instant Replay is tied to monitoring, hidden while a clip plays
    // (monitoring was stopped for playback).
    instantBtn.classList.toggle('hidden', !monitoring || replayPlaying);
    instantBtn.disabled = !monitoring || replayPlaying;
  }

  const clipsRow = document.getElementById('replayClipsRow');
  let anyClip = false;
  document.querySelectorAll('#replayClipsRow .clip-wrap').forEach((wrap) => {
    const idx = parseInt(wrap.dataset.clipIndex, 10);
    const has = !!clips[idx];
    wrap.classList.toggle('hidden', !has);
    if (has) anyClip = true;
    const playBtn = wrap.querySelector('[data-cmd="play_clip"]');
    const clearBtn = wrap.querySelector('.clip-clear');
    if (playBtn) playBtn.disabled = !has || replayPlaying;
    if (clearBtn) clearBtn.disabled = !has || replayPlaying;
  });
  if (clipsRow) {
    clipsRow.classList.toggle('hidden', !anyClip);
  }
}

const MATCH_CONFIRM_CMDS = new Set(['reset_scores', 'end_match', 'call_match_early']);
let pendingMatchConfirm = null;

function getMatchActionConfirmCopy(cmd, opts = {}) {
  const resetLabel = getResetActionLabel();
  const unit = lastState?.gameType === 'game8' ? 'frame' : 'rack';
  const clipNum = (opts.index != null ? Number(opts.index) : 0) + 1;
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
    delete_clip: {
      title: `Clear Clip ${clipNum}`,
      message: `Remove Clip ${clipNum} from saved replay history? This cannot be undone from here.`,
      confirm: 'Clear Clip',
    },
  };
  return copy[cmd] || { title: 'Confirm', message: 'Are you sure?', confirm: 'Confirm' };
}

function closeMatchConfirmModal() {
  pendingMatchConfirm = null;
  document.getElementById('confirmModal')?.classList.add('hidden');
}

function openMatchConfirmModal(cmd, run, opts = {}) {
  const cfg = getMatchActionConfirmCopy(cmd, opts);
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
  const sent = client.sendCommand(action, payload);
  if (!sent) {
    setSyncing(false);
    setError('Failed to send command — check connection');
  }
}

function normalizePlayerName(name) {
  return String(name || '').trim().toLowerCase();
}

function truncatePlayerName(name) {
  return String(name || '').trim().slice(0, 20);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPlayerPreview(lastSeenAt) {
  if (!lastSeenAt) return 'Saved player';
  const d = new Date(lastSeenAt);
  if (Number.isNaN(d.getTime())) return 'Saved player';
  return `Last seen ${d.toLocaleDateString()}`;
}

const playerAutocompleteState = {};

async function searchCloudPlayers(query, limit) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return [];
  return fetchPlayers(window.location.origin, token, query, limit);
}

function dockPlayerName(slot) {
  return truncatePlayerName(slot === '1' ? (lastState.player1Name || '') : (lastState.player2Name || ''));
}

function commitPlayerNameIfChanged(slot) {
  const input = document.getElementById(slot === '1' ? 'p1Name' : 'p2Name');
  if (!input) return;
  const name = truncatePlayerName(input.value);
  if (!name) return;
  if (normalizePlayerName(name) === normalizePlayerName(dockPlayerName(slot))) return;
  sendCmd('set_player_name', { slot, name });
}

function pickPlayerName(slot, name) {
  const input = document.getElementById(slot === '1' ? 'p1Name' : 'p2Name');
  const trimmed = truncatePlayerName(name);
  if (input) input.value = trimmed;
  sendCmd('set_player_name', { slot, name: trimmed });
}

function initPlayerAutocompleteForSlot(slot, inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  playerAutocompleteState[slot] = { activeIndex: -1, results: [], createNewName: null };
  let debounceTimer = null;

  const hideList = () => list.classList.add('hidden');
  const showList = () => list.classList.remove('hidden');

  const refresh = async (options = {}) => {
    const browseAll = !!options.browseAll;
    const query = input.value.trim();
    if (!query && !browseAll) {
      playerAutocompleteState[slot].createNewName = null;
      list.classList.remove('autocomplete-browse');
      hideList();
      list.innerHTML = '';
      return;
    }

    try {
      const results = browseAll
        ? await searchCloudPlayers('', 250)
        : await searchCloudPlayers(query, 8);
      const queryNorm = normalizePlayerName(query);
      const exactExists = !!(queryNorm && results.some(
        (p) => normalizePlayerName(p.name) === queryNorm,
      ));
      const createName = (!browseAll && query && !exactExists) ? truncatePlayerName(query) : null;

      playerAutocompleteState[slot].results = results;
      playerAutocompleteState[slot].createNewName = createName;
      playerAutocompleteState[slot].activeIndex = -1;
      list.innerHTML = '';
      list.classList.toggle('autocomplete-browse', browseAll);

      if (browseAll && results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'autocomplete-item autocomplete-new';
        empty.textContent = 'No saved players yet.';
        list.appendChild(empty);
        showList();
        return;
      }

      if (createName) {
        const createItem = document.createElement('div');
        createItem.className = 'autocomplete-item autocomplete-new';
        createItem.textContent = `Create new player: "${createName}"`;
        createItem.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickPlayerName(slot, createName);
          hideList();
        });
        list.appendChild(createItem);
      }

      results.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.dataset.index = String(createName ? index + 1 : index);
        item.innerHTML = `<span class="autocomplete-name">${escapeHtml(player.name)}</span>`
          + `<span class="autocomplete-preview">${escapeHtml(formatPlayerPreview(player.last_seen_at))}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickPlayerName(slot, player.name);
          hideList();
        });
        list.appendChild(item);
      });

      if (createName || results.length > 0) showList();
      else hideList();
      if (browseAll) list.scrollTop = 0;
    } catch (err) {
      console.error('Player autocomplete error:', err);
    }
  };

  const navCount = () => {
    const state = playerAutocompleteState[slot];
    return (state.createNewName ? 1 : 0) + (state.results?.length || 0);
  };

  const highlight = (index) => {
    list.querySelectorAll('.autocomplete-item').forEach((item, i) => {
      item.classList.toggle('autocomplete-active', i === index);
    });
  };

  const activateIndex = (index) => {
    const state = playerAutocompleteState[slot];
    if (index < 0) return;
    if (state.createNewName) {
      if (index === 0) {
        pickPlayerName(slot, state.createNewName);
        hideList();
        return;
      }
      const player = state.results[index - 1];
      if (player) pickPlayerName(slot, player.name);
      hideList();
      return;
    }
    const player = state.results[index];
    if (player) pickPlayerName(slot, player.name);
    hideList();
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => refresh(), 150);
  });

  input.addEventListener('focus', () => refresh());

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (list.classList.contains('hidden')) commitPlayerNameIfChanged(slot);
    }, 150);
  });

  input.addEventListener('dblclick', (e) => {
    e.preventDefault();
    input.select();
    refresh({ browseAll: true });
  });

  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitPlayerNameIfChanged(slot);
      }
      return;
    }
    const state = playerAutocompleteState[slot];
    const count = navCount();
    if (count === 0) {
      if (e.key === 'Escape') hideList();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.activeIndex = state.activeIndex < 0 ? 0 : Math.min(state.activeIndex + 1, count - 1);
      highlight(state.activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.activeIndex = state.activeIndex < 0 ? count - 1 : Math.max(state.activeIndex - 1, 0);
      highlight(state.activeIndex);
    } else if (e.key === 'Enter' && state.activeIndex >= 0) {
      e.preventDefault();
      activateIndex(state.activeIndex);
    } else if (e.key === 'Escape') {
      hideList();
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) hideList();
  });
}

function wirePlayerAutocomplete() {
  initPlayerAutocompleteForSlot('1', 'p1Name', 'p1Autocomplete');
  initPlayerAutocompleteForSlot('2', 'p2Name', 'p2Autocomplete');
}

function showSetupRow(id, visible) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !visible);
}

function isBallVariantVisible(gameType) {
  return gameType !== 'game2' && gameType !== 'game3' && gameType !== 'game8';
}

function syncSetupVariantOptions(state) {
  const gameType = state?.gameType
    || document.getElementById('gameTypeSelect')?.value
    || 'game1';

  const showBallVariant = isBallVariantVisible(gameType);
  showSetupRow('setupBallVariantLabel', showBallVariant);
  showSetupRow('setupBallVariantRow', showBallVariant);

  const showEarly = gameType === 'game1' || gameType === 'game2' || gameType === 'game3';
  showSetupRow('setupEarlyGameRow', showEarly);
  const earlyLabel = document.getElementById('earlyGameBallLabel');
  if (earlyLabel) {
    earlyLabel.textContent = gameType === 'game1'
      ? 'Win on Break'
      : 'Early Game Ball/Win on Break';
  }

  showSetupRow('setupSnookerGoldRow', gameType === 'game8');
  showSetupRow('setupPointBasedRow', gameType === 'game7');

  const ballSel = document.getElementById('ballSelectionSelect');
  if (ballSel) {
    ballSel.querySelectorAll('option').forEach((opt) => {
      if (opt.value === 'snooker') opt.hidden = gameType !== 'game7';
    });
  }

  const raceLabel = document.getElementById('raceLabel');
  if (raceLabel) {
    raceLabel.textContent = state?.raceLabel || (gameType === 'game8' ? 'Best Of' : 'Race');
  }
}

function syncSetupFieldsFromState(state) {
  if (!state) return;
  if (typeof state.earlyGameBallEnabled === 'boolean') {
    syncCheckboxFromState('earlyGameBallCheckbox', 'earlyGameBall', state.earlyGameBallEnabled);
  }
  if (typeof state.snookerGoldEnabled === 'boolean') {
    syncCheckboxFromState('snookerGoldCheckbox', 'snookerGold', state.snookerGoldEnabled);
  }
  if (state.pointBased != null) {
    syncCheckboxFromState(
      'pointBasedCheckbox',
      'pointBased',
      state.pointBased === 'yes' || state.pointBased === true,
    );
  }
  syncSelectFromState('ballSelectionSelect', 'ballSelection', state.ballSelection);
  syncSetupVariantOptions(state);
}

function wireSetupPanel() {
  document.getElementById('saveRaceBtn').onclick = () => {
    sendCmd('set_race', { value: document.getElementById('raceInput').value });
  };
  document.getElementById('saveGameInfoBtn').onclick = () => {
    sendCmd('set_game_info', { value: document.getElementById('gameInfoInput').value });
  };

  const gameTypeSelect = document.getElementById('gameTypeSelect');
  if (gameTypeSelect) {
    gameTypeSelect.addEventListener('change', () => {
      markSetupPending('gameType', gameTypeSelect.value);
      sendCmd('set_game_type', { gameType: gameTypeSelect.value });
      syncSetupVariantOptions({
        gameType: gameTypeSelect.value,
        ballSelection: document.getElementById('ballSelectionSelect')?.value,
      });
    });
  }

  document.getElementById('earlyGameBallCheckbox')?.addEventListener('change', (e) => {
    markSetupPending('earlyGameBall', e.target.checked ? '1' : '0');
    sendCmd('set_early_game_ball', { enabled: e.target.checked });
  });
  document.getElementById('snookerGoldCheckbox')?.addEventListener('change', (e) => {
    markSetupPending('snookerGold', e.target.checked ? '1' : '0');
    sendCmd('set_snooker_gold', { enabled: e.target.checked });
  });
  document.getElementById('pointBasedCheckbox')?.addEventListener('change', (e) => {
    markSetupPending('pointBased', e.target.checked ? '1' : '0');
    sendCmd('set_point_based', { enabled: e.target.checked });
  });
  document.getElementById('ballSelectionSelect')?.addEventListener('change', (e) => {
    markSetupPending('ballSelection', e.target.value);
    sendCmd('set_ball_selection', { value: e.target.value });
    syncSetupVariantOptions({
      gameType: gameTypeSelect?.value,
      ballSelection: e.target.value,
    });
  });

  syncSetupVariantOptions({});
}

function wireCommands() {
  document.querySelectorAll('[data-cmd]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.disabled || el.classList.contains('hidden')) return;
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
}

function wireReplayClearButtons() {
  document.querySelectorAll('.clip-clear').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled || btn.closest('.clip-wrap')?.classList.contains('hidden')) return;
      if (!controlsEnabled()) {
        setError(controlLockMessage());
        return;
      }
      const index = parseInt(btn.dataset.deleteIndex, 10);
      if (!Number.isFinite(index)) return;
      openMatchConfirmModal(
        'delete_clip',
        () => sendCmd('delete_clip', { index }),
        { index }
      );
    });
  });
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
    client.on('error', (e) => {
      if (e.code === 'guest_revoked' || e.code === 'invalid_guest_token') {
        show('controlSection', false);
        showMobileNav(false);
        setError('This guest link has been revoked.');
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
    return;
  }

  if (!roomId) {
    setError('Room ID missing in URL (/m/{room_id})');
    return;
  }

  let token = localStorage.getItem(TOKEN_KEY);
  const secretEl = document.getElementById('devSecret');
  const secret = secretEl ? secretEl.value.trim() : '';

  if (secret) {
    try {
      const data = await devLogin(window.location.origin, secret);
      token = data.access_token;
      localStorage.setItem(TOKEN_KEY, token);
      syncLoginPanel();
    } catch (err) {
      setError(err.message || 'Login failed');
      return;
    }
  } else if (!token) {
    setError('Sign in on the dashboard first, or enter the dev auth secret.');
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
    if (e.code === 'session_revoked' || e.code === 'invalid_token' || msg.includes('token') || msg.includes("'sub'") || e.code === 'room_forbidden') {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (e.code === 'session_revoked') {
      show('loginSection', true);
      show('controlSection', false);
      showMobileNav(false);
      syncLoginPanel();
      setError('Signed out everywhere. Sign in again to reconnect.');
      return;
    }
    if (e.code === 'room_forbidden') {
      setError('This room belongs to another account. Sign in with the dev secret for that account, or open the mobile link from your dashboard.');
      return;
    }
    if (e.code === 'control_connection_limit') {
      setError(e.message || 'Too many devices controlling this table. Disconnect another phone or upgrade your plan.');
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

document.getElementById('connectBtn')?.addEventListener('click', connect);
document.getElementById('clearTokenBtn')?.addEventListener('click', () => {
  if (!window.confirm('Clear saved login on this device? You will need to sign in again to connect.')) return;
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
  syncLoginPanel();
});
wireCommands();
wireReplayClearButtons();
wireSetupPanel();
wirePlayerAutocomplete();
wireMatchConfirmModal();
wireSnookerFoulModal();
wireMobileNav();
syncLoginPanel();

if (pathContext().guestToken) {
  connect().catch(() => {});
} else if (localStorage.getItem(TOKEN_KEY) && pathContext().roomId) {
  connect().catch(() => {});
}
