import {
  CloudClient,
  devLogin,
  GAME_TYPES,
} from '../shared/cloud-client.js';

const TOKEN_KEY = 'cuesport_token';
let client = null;
let roomId = '';
let lastState = {};
let syncTimer = null;
let dockPresent = false;

function roomFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('m');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return '';
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
  lastState = state;
  setSyncing(false);

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

  document.getElementById('liveP1Name').textContent = p1Name;
  document.getElementById('liveP2Name').textContent = p2Name;
  document.getElementById('liveP1Score').textContent = String(p1Score);
  document.getElementById('liveP2Score').textContent = String(p2Score);

  show('ballsPanel', dual);
  show('liveP1Balls', dual);
  show('liveP2Balls', dual);
  if (dual) {
    document.getElementById('liveP1Balls').textContent = `${secondaryLabel}: ${p1Balls}`;
    document.getElementById('liveP2Balls').textContent = `${secondaryLabel}: ${p2Balls}`;
    document.getElementById('secondaryHeading').textContent = secondaryLabel;
    document.getElementById('p1SecondaryLabel').textContent = `P1 ${secondaryLabel.toLowerCase()}`;
    document.getElementById('p2SecondaryLabel').textContent = `P2 ${secondaryLabel.toLowerCase()}`;
    document.getElementById('p1SecondaryValue').textContent = String(p1Balls);
    document.getElementById('p2SecondaryValue').textContent = String(p2Balls);
  }

  document.getElementById('p1PrimaryLabel').textContent = `P1 ${primaryLabel.toLowerCase()}`;
  document.getElementById('p2PrimaryLabel').textContent = `P2 ${primaryLabel.toLowerCase()}`;
  document.getElementById('p1PrimaryValue').textContent = String(p1Score);
  document.getElementById('p2PrimaryValue').textContent = String(p2Score);

  const raceLabel = document.getElementById('raceLabel');
  if (raceLabel) raceLabel.textContent = state.raceLabel || (state.gameType === 'game8' ? 'Best Of' : 'Race');

  const active = String(state.activePlayer || '1');
  document.getElementById('liveP1').classList.toggle('is-active', active === '1');
  document.getElementById('liveP2').classList.toggle('is-active', active === '2');
  document.getElementById('activeP1Btn').classList.toggle('selected', active === '1');
  document.getElementById('activeP2Btn').classList.toggle('selected', active === '2');

  const breaker = String(state.rackBreakerSlot || '');
  document.getElementById('breakerP1Btn').classList.toggle('selected', breaker === '1');
  document.getElementById('breakerP2Btn').classList.toggle('selected', breaker === '2');

  // Form fields — always sync from dock (including empty)
  if (state.player1Name != null) document.getElementById('p1Name').value = state.player1Name;
  if (state.player2Name != null) document.getElementById('p2Name').value = state.player2Name;
  if (state.raceInfo != null) document.getElementById('raceInput').value = state.raceInfo;
  if (state.gameInfo != null) document.getElementById('gameInfoInput').value = state.gameInfo;
  if (state.gameType) document.getElementById('gameTypeSelect').value = state.gameType;

  const hint = document.getElementById('breakerHint');
  if (state.breakerPromptVisible) {
    hint.textContent = 'Breaking player? — pick breaker below';
  } else {
    hint.textContent = `Active: P${active} | Breaker: ${breaker || '—'}`;
  }

  const statusEl = document.getElementById('matchStatus');
  if (!dockPresent && !state.timestamp && !state.player1Name && p1Score === 0 && p2Score === 0) {
    statusEl.textContent = 'Waiting for dock… enable CueSport Cloud on the control panel';
    statusEl.className = 'match-status warn';
  } else if (state.breakerPromptVisible) {
    statusEl.textContent = 'Choose breaking player';
    statusEl.className = 'match-status warn';
  } else if (state.gameScoringLocked) {
    statusEl.textContent = 'Game locked — start next rack or end match';
    statusEl.className = 'match-status locked';
  } else if (state.matchInProgress || state.canCallGame) {
    statusEl.textContent = 'Match in progress';
    statusEl.className = 'match-status live';
  } else {
    statusEl.textContent = 'Ready';
    statusEl.className = 'match-status';
  }

  const metaParts = [
    gameTypeLabel(state.gameType),
    state.raceInfo ? `${state.raceLabel || 'Race'} ${state.raceInfo}` : null,
    dual ? `${primaryLabel} + ${secondaryLabel}` : null,
    state.ballScoringEnabled ? 'Ball scoring on' : null,
  ].filter(Boolean);
  document.getElementById('liveMeta').textContent = metaParts.join(' · ');

  const callBtn = document.getElementById('callMatchBtn');
  if (callBtn) callBtn.disabled = state.canCallGame === false;

  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) undoBtn.disabled = !state.canUndo;

  const replayPanel = document.getElementById('replayPanel');
  replayPanel.querySelectorAll('button').forEach((btn) => {
    btn.disabled = state.obsConnected === false;
  });

  renderBallGrid(state);
}

const BALL_IMG = '/images/balls';
let lastBallGridKey = '';

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

function appendBallButton(grid, { src, title, faded, disabled, awaiting, action, payload, snooker }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ball-btn';
  btn.title = title;
  const locked = !!disabled || !!awaiting;
  btn.disabled = locked;
  if (faded) btn.classList.add('faded');
  if (locked) btn.classList.add('is-disabled');
  const img = document.createElement('img');
  img.src = src;
  img.alt = title;
  btn.appendChild(img);
  if (!locked) {
    btn.onclick = () => {
      if (!snooker && !faded) btn.classList.add('faded');
      else if (!snooker && faded) btn.classList.remove('faded');
      sendCmd(action, payload);
    };
  }
  grid.appendChild(btn);
}

function renderBallGrid(state) {
  const panel = document.getElementById('ballGridPanel');
  const grid = document.getElementById('ballGrid');
  const hint = document.getElementById('ballGridHint');
  const snapshot = state.ballGrid;
  const key = JSON.stringify(snapshot || {
    gameType: state.gameType,
    ballState: state.ballState,
    ballScoringEnabled: state.ballScoringEnabled,
    locked: state.gameScoringLocked,
  });
  if (key === lastBallGridKey) return;
  lastBallGridKey = key;
  grid.innerHTML = '';

  if (snapshot && snapshot.visible) {
    panel.classList.remove('hidden');
    grid.classList.toggle('awaiting-breaker', !!snapshot.awaitingBreaker);
    if (hint) {
      if (snapshot.awaitingBreaker) {
        hint.textContent = 'Choose breaking player first';
        hint.classList.remove('hidden');
      } else if (snapshot.locked) {
        hint.textContent = 'Scoring locked';
        hint.classList.remove('hidden');
      } else {
        hint.textContent = '';
        hint.classList.add('hidden');
      }
    }
    snapshot.balls.forEach((b) => {
      if (b.hidden) return;
      appendBallButton(grid, {
        src: b.file ? `${BALL_IMG}/${b.file}` : `${BALL_IMG}/8ball_small.png`,
        title: b.title,
        faded: !!b.faded,
        disabled: !!b.disabled || !!snapshot.locked,
        awaiting: snapshot.awaitingBreaker,
        snooker: !!snapshot.snooker,
        action: snapshot.snooker ? 'snooker_ball' : 'toggle_pot',
        payload: { ballId: b.id },
      });
    });
    return;
  }

  const gt = state.gameType;
  const selection = state.ballSelection || 'american';
  const awaiting = !!state.breakerPromptVisible && !state.rackBreakerSlot;

  if (gt === 'game8' || selection === 'snooker') {
    panel.classList.remove('hidden');
    grid.classList.toggle('awaiting-breaker', awaiting);
    if (hint) {
      hint.textContent = awaiting ? 'Choose breaking player first' : '';
      hint.classList.toggle('hidden', !awaiting);
    }
    const snookerIds = [1, 2, 3, 4, 5, 6, 7];
    if (state.snookerGoldEnabled) snookerIds.push(8);
    snookerIds.push(10, 11);
    snookerIds.forEach((n) => {
      appendBallButton(grid, {
        src: `${BALL_IMG}/${ballImageFile(n, 'snooker')}`,
        title: `Ball ${n}`,
        faded: false,
        disabled: !!state.gameScoringLocked,
        awaiting,
        snooker: true,
        action: 'snooker_ball',
        payload: { ballId: `ball ${n}` },
      });
    });
    return;
  }
  if (!state.ballScoringEnabled) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  grid.classList.toggle('awaiting-breaker', awaiting);
  if (hint) {
    hint.textContent = awaiting ? 'Choose breaking player first' : '';
    hint.classList.toggle('hidden', !awaiting);
  }
  const max = gt === 'game2' ? 9 : gt === 'game3' ? 10 : 15;
  const style = (gt === 'game2' || gt === 'game3') ? 'american' : selection;
  for (let i = 1; i <= max; i++) {
    const id = `ball ${i}`;
    appendBallButton(grid, {
      src: `${BALL_IMG}/${ballImageFile(i, style)}`,
      title: `Ball ${i}`,
      faded: !!(state.ballState && state.ballState[id]),
      disabled: !!state.gameScoringLocked,
      awaiting,
      snooker: false,
      action: 'toggle_pot',
      payload: { ballId: id },
    });
  }
}

function sendCmd(action, payload) {
  if (!client) return;
  setSyncing(true);
  client.sendCommand(action, payload);
}

function wireCommands() {
  document.querySelectorAll('[data-cmd]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!client) return;
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
  roomId = roomFromPath();
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
  client.on('presence', (clients) => {
    dockPresent = (clients || []).includes('dock');
    document.getElementById('connectionStatus').textContent = dockPresent
      ? 'Connected · dock online'
      : 'Connected · waiting for dock';
    if (!dockPresent && Object.keys(lastState).length === 0) {
      const statusEl = document.getElementById('matchStatus');
      statusEl.textContent = 'Waiting for dock… enable CueSport Cloud on the control panel';
      statusEl.className = 'match-status warn';
    }
  });
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
    document.getElementById('connectionStatus').textContent = 'Connected';
    show('loginSection', false);
    show('controlSection', true);
    dockPresent = (joined.clients || []).includes('dock');
    if (joined.state && Object.keys(joined.state).length) {
      applyState(joined.state);
    } else {
      document.getElementById('matchStatus').textContent = dockPresent
        ? 'Dock online — waiting for first state snapshot…'
        : 'Waiting for dock… enable CueSport Cloud on the control panel';
      document.getElementById('matchStatus').className = 'match-status warn';
    }
    if (dockPresent) {
      document.getElementById('connectionStatus').textContent = 'Connected · dock online';
    }
  } catch (err) {
    setError(err.message);
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
  setError('');
  document.getElementById('connectionStatus').textContent = 'Disconnected';
  show('loginSection', true);
  show('controlSection', false);
});
wireCommands();

if (localStorage.getItem(TOKEN_KEY) && roomFromPath()) {
  connect().catch(() => {});
}
