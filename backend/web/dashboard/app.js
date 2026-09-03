import {
  CloudClient,
  fetchPublicConfig,
  devLogin,
  fetchMe,
  createApiKey,
  revokeApiKey,
  invalidateAllSessions,
  revokeAllGuestLinks,
  GAME_TYPES,
} from '../shared/cloud-client.js?v=7.2.3-signout-this-tab';

const TOKEN_KEY = 'cuesport_token';
const SERVER_KEY = 'cuesport_server';

let dashClient = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastTablesFingerprint = '';
let wantLiveFeed = false;
let lastQuota = null;

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

function getServerUrl() {
  return localStorage.getItem(SERVER_KEY) || window.location.origin;
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function gameTypeLabel(id) {
  const g = GAME_TYPES.find((x) => x.id === id);
  return g ? g.label : (id || '—');
}

function formatTableCard(room, serverUrl) {
  const st = room.live_state || {};
  const p1 = st.player1Name || 'P1';
  const p2 = st.player2Name || 'P2';
  const dual = st.dualScoreMode || st.gameType === 'game8';
  const scoreLine = dual
    ? `${st.p1Balls ?? 0} – ${st.p2Balls ?? 0} pts · ${st.p1Score ?? 0}–${st.p2Score ?? 0} ${st.primaryScoreLabel || 'frames'}`
    : `${st.p1Score ?? 0} – ${st.p2Score ?? 0}`;
  const matchTitle = [
    gameTypeLabel(st.gameType),
    st.raceInfo ? `${st.raceLabel || 'Race'} ${st.raceInfo}` : null,
    st.gameInfo || null,
  ].filter(Boolean).join(' · ') || 'Match in progress';
  const instanceKey = (room.instance_key || '').trim();
  const showTableCaption = instanceKey && instanceKey !== 'default';
  const tableCaption = showTableCaption
    ? (room.dock_label && room.dock_label !== 'Main table'
      ? room.dock_label
      : instanceKey)
    : '';
  const controlUrl = `${serverUrl.replace(/\/$/, '')}/m/${room.id}`;

  const card = document.createElement('a');
  card.className = 'table-card panel';
  card.href = controlUrl;
  card.innerHTML = `
    <p class="table-status online">Dock online</p>
    <h3>${matchTitle}</h3>
    <p class="table-players">${p1} vs ${p2}</p>
    <p class="table-score">${scoreLine}</p>
    ${tableCaption ? `<p class="table-caption">${tableCaption}</p>` : ''}
  `;
  return card;
}

function tablesFingerprint(rooms) {
  const active = (rooms || []).filter((room) => room.dock_connected);
  return JSON.stringify(active.map((room) => ({
    id: room.id,
    instance_key: room.instance_key || null,
    dock_label: room.dock_label || null,
    live_state: room.live_state || {},
  })));
}

function renderTableCards(rooms) {
  const fp = tablesFingerprint(rooms);
  if (fp === lastTablesFingerprint) return;
  lastTablesFingerprint = fp;

  const container = document.getElementById('tableCards');
  container.innerHTML = '';
  const activeRooms = (rooms || []).filter((room) => room.dock_connected);
  if (!activeRooms.length) {
    container.innerHTML = '<p class="hint">No docks online. Enable CueSport Cloud on an OBS dock — connected tables appear here automatically.</p>';
    return;
  }
  activeRooms.forEach((room) => {
    container.appendChild(formatTableCard(room, getServerUrl()));
  });
}

function renderQuota(quota) {
  lastQuota = quota || null;
  const el = document.getElementById('quotaSummary');
  const hint = document.getElementById('apiKeyLimitHint');
  const createBtn = document.getElementById('createKeyBtn');
  if (!quota) {
    if (el) el.textContent = '';
    if (hint) hint.classList.add('hidden');
    if (createBtn) createBtn.disabled = false;
    return;
  }
  const { tier, limits, usage } = quota;
  if (el) {
    el.textContent =
      `Plan: ${tier} · API keys ${usage.apiKeys}/${limits.maxApiKeys} · ` +
      `Tables ${usage.rooms}/${limits.maxRooms} · ` +
      `Control connections up to ${limits.maxControlConnectionsPerRoom} per table`;
  }
  const atKeyLimit = usage.apiKeys >= limits.maxApiKeys;
  if (createBtn) createBtn.disabled = atKeyLimit;
  if (hint) {
    if (atKeyLimit) {
      hint.textContent = `API key limit reached (${limits.maxApiKeys} on ${tier}). Revoke a key to create another.`;
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }
}

function renderApiKeys(keys) {
  const keyList = document.getElementById('keyList');
  keyList.innerHTML = '';
  (keys || []).forEach((k) => {
    const li = document.createElement('li');
    li.className = 'token-list-item';
    const label = document.createElement('span');
    label.textContent = `${k.label} — created ${k.created_at}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn danger';
    btn.textContent = 'Revoke';
    btn.addEventListener('click', async () => {
      if (!window.confirm(`Revoke API key “${k.label}”? Docks using it will disconnect.`)) return;
      try {
        const result = await revokeApiKey(getServerUrl(), getToken(), k.id);
        if (result.quota) renderQuota(result.quota);
        await renderDashboard();
      } catch (err) {
        setError(err.message);
      }
    });
    li.appendChild(label);
    li.appendChild(btn);
    keyList.appendChild(li);
  });
}

function setActiveDashTab(which) {
  document.querySelectorAll('.dash-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === which);
  });
  show('tabTables', which === 'tables');
  show('tabStats', which === 'stats');
  show('tabAccount', which === 'account');
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopLiveFeed() {
  wantLiveFeed = false;
  clearReconnect();
  reconnectAttempt = 0;
  if (dashClient) {
    try { dashClient.disconnect(); } catch (_) { /* ignore */ }
    dashClient = null;
  }
}

function scheduleLiveReconnect() {
  if (!wantLiveFeed || !getToken()) return;
  clearReconnect();
  const delay = Math.min(10000, 800 * (2 ** Math.min(reconnectAttempt, 4)));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    connectLiveFeed().catch(() => {});
  }, delay);
}

async function connectLiveFeed() {
  const token = getToken();
  if (!wantLiveFeed || !token) return;

  if (dashClient) {
    try { dashClient.disconnect(); } catch (_) { /* ignore */ }
    dashClient = null;
  }

  const client = new CloudClient({
    serverUrl: getServerUrl(),
    client: 'dashboard',
    accessToken: token,
  });
  dashClient = client;

  client.on('tables', (rooms) => {
    renderTableCards(rooms);
  });
  client.on('error', (e) => {
    if (e.code === 'invalid_token' || e.code === 'room_forbidden' || e.code === 'session_revoked') {
      localStorage.removeItem(TOKEN_KEY);
      stopLiveFeed();
      setError(e.code === 'session_revoked' ? 'Signed out everywhere.' : (e.message || 'Session expired'));
      show('loginSection', true);
      show('dashboardSection', false);
    }
  });
  client.on('close', () => {
    if (dashClient === client) dashClient = null;
    if (wantLiveFeed && getToken()) scheduleLiveReconnect();
  });

  try {
    await client.connect();
    reconnectAttempt = 0;
  } catch (err) {
    if (dashClient === client) dashClient = null;
    scheduleLiveReconnect();
  }
}

async function renderDashboard() {
  const token = getToken();
  if (!token) {
    stopLiveFeed();
    lastTablesFingerprint = '';
    show('loginSection', true);
    show('dashboardSection', false);
    return;
  }
  try {
    const me = await fetchMe(getServerUrl(), token);
    show('loginSection', false);
    show('dashboardSection', true);
    document.getElementById('userEmail').textContent = me.account.email;
    renderQuota(me.quota);
    renderApiKeys(me.api_keys);
    renderTableCards(me.rooms);
    wantLiveFeed = true;
    clearReconnect();
    connectLiveFeed().catch(() => {});
  } catch (err) {
    stopLiveFeed();
    localStorage.removeItem(TOKEN_KEY);
    setError(err.message);
    show('loginSection', true);
    show('dashboardSection', false);
  }
}

document.querySelectorAll('.dash-tab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveDashTab(tab.dataset.tab));
});

document.getElementById('devLoginBtn').addEventListener('click', async () => {
  setError('');
  const secret = document.getElementById('devSecret').value;
  if (!secret) return setError('Dev auth secret required');
  const btn = document.getElementById('devLoginBtn');
  btn.disabled = true;
  try {
    const data = await devLogin(getServerUrl(), secret);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(SERVER_KEY, getServerUrl());
    if (data.api_key) {
      document.getElementById('newKeyDisplay').textContent = `New API key (copy now): ${data.api_key}`;
      show('newKeyDisplay', true);
      setActiveDashTab('account');
    }
    lastTablesFingerprint = '';
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('createKeyBtn').addEventListener('click', async () => {
  try {
    const created = await createApiKey(getServerUrl(), getToken(), 'Dashboard key');
    document.getElementById('newKeyDisplay').textContent = `New API key (copy now): ${created.key}`;
    show('newKeyDisplay', true);
    if (created.quota) renderQuota(created.quota);
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  if (!window.confirm('Sign out of this dashboard on this device?')) return;
  localStorage.removeItem(TOKEN_KEY);
  stopLiveFeed();
  renderDashboard();
});

document.getElementById('invalidateSessionsBtn')?.addEventListener('click', async () => {
  if (!window.confirm('Sign out everywhere? This dashboard, other admin devices, and admin mobile control will be signed out and disconnected. Guest links are not affected.')) {
    return;
  }
  try {
    await invalidateAllSessions(getServerUrl(), getToken());
  } catch (err) {
    setError(err.message);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
  stopLiveFeed();
  setError('');
  renderDashboard();
});

document.getElementById('revokeAllGuestsBtn')?.addEventListener('click', async () => {
  if (!window.confirm('Revoke all guest links and disconnect every guest scorer? They will need a new link to reconnect.')) {
    return;
  }
  try {
    const result = await revokeAllGuestLinks(getServerUrl(), getToken());
    setError('');
    const n = Number(result.revoked) || 0;
    alert(n === 1 ? 'Revoked 1 guest link.' : `Revoked ${n} guest links.`);
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  }
});

document.getElementById('googleBtn').addEventListener('click', async () => {
  const config = await fetchPublicConfig(getServerUrl());
  if (config.supabaseUrl && config.supabaseAnonKey) {
    window.location.href = `${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.href)}`;
  } else {
    setError('Google OAuth not configured. Use dev login.');
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wantLiveFeed && getToken() && (!dashClient || !dashClient.connected)) {
    clearReconnect();
    reconnectAttempt = 0;
    connectLiveFeed().catch(() => {});
  }
});

if (window.location.search.includes('auth=callback') || window.location.hash.includes('access_token')) {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState({}, '', window.location.pathname);
  }
}

renderDashboard();
