import {
  fetchPublicConfig,
  devLogin,
  fetchMe,
  createApiKey,
  createGuestLink,
  GAME_TYPES,
} from '../shared/cloud-client.js';

const TOKEN_KEY = 'cuesport_token';
const SERVER_KEY = 'cuesport_server';

function show(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function setError(msg) {
  const el = document.getElementById('error');
  if (msg) {
    el.textContent = msg;
    show('error', true);
  } else {
    show('error', false);
  }
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
  const meta = [
    gameTypeLabel(st.gameType),
    st.raceInfo ? `${st.raceLabel || 'Race'} ${st.raceInfo}` : null,
    st.gameInfo || null,
  ].filter(Boolean).join(' · ');
  const label = room.dock_label || room.label || 'Table';
  const inst = room.instance_key ? ` (${room.instance_key})` : '';

  const card = document.createElement('article');
  card.className = 'table-card panel';
  card.innerHTML = `
    <div class="table-card-head">
      <h3>${label}${inst}</h3>
      <span class="table-status online">Dock online</span>
    </div>
    <p class="table-players">${p1} vs ${p2}</p>
    <p class="table-score">${scoreLine}</p>
    <p class="table-meta">${meta || 'No match info yet'}</p>
    <div class="table-actions">
      <a class="btn primary" href="${serverUrl.replace(/\/$/, '')}/m/${room.id}">Control</a>
      <button type="button" class="btn guest-link-btn" data-room="${room.id}">Guest link</button>
    </div>
    <p class="guest-url hidden" data-guest-for="${room.id}"></p>
  `;
  return card;
}

async function renderDashboard() {
  const token = getToken();
  if (!token) {
    show('loginSection', true);
    show('dashboardSection', false);
    return;
  }
  try {
    const me = await fetchMe(getServerUrl(), token);
    show('loginSection', false);
    show('dashboardSection', true);
    document.getElementById('userEmail').textContent = me.account.email;

    const container = document.getElementById('tableCards');
    container.innerHTML = '';
    const activeRooms = (me.rooms || []).filter((room) => room.dock_connected);
    if (!activeRooms.length) {
      container.innerHTML = '<p class="hint">No docks online. Enable CueSport Cloud on an OBS dock — connected tables appear here automatically.</p>';
    } else {
      activeRooms.forEach((room) => {
        container.appendChild(formatTableCard(room, getServerUrl()));
      });
    }

    container.querySelectorAll('.guest-link-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const data = await createGuestLink(getServerUrl(), getToken(), btn.dataset.room);
          const el = container.querySelector(`[data-guest-for="${btn.dataset.room}"]`);
          if (el) {
            const server = getServerUrl().replace(/\/$/, '');
            const url = data.path ? `${server}${data.path}` : data.url;
            el.innerHTML = `Guest scorer: <a href="${url}" target="_blank" rel="noopener">${url}</a>`;
            el.classList.remove('hidden');
          }
        } catch (err) {
          setError(err.message);
        }
      });
    });

    const keyList = document.getElementById('keyList');
    keyList.innerHTML = '';
    (me.api_keys || []).forEach((k) => {
      const li = document.createElement('li');
      li.textContent = `${k.label} — created ${k.created_at}`;
      keyList.appendChild(li);
    });
  } catch (err) {
    localStorage.removeItem(TOKEN_KEY);
    setError(err.message);
    renderDashboard();
  }
}

document.querySelectorAll('.dash-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    show('tabControl', which === 'control');
    show('tabStats', which === 'stats');
  });
});

document.getElementById('devLoginBtn').addEventListener('click', async () => {
  setError('');
  const email = document.getElementById('devEmail').value.trim();
  if (!email) return setError('Email required');
  try {
    const data = await devLogin(getServerUrl(), email);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(SERVER_KEY, getServerUrl());
    if (data.api_key) {
      document.getElementById('newKeyDisplay').textContent = `New API key (copy now): ${data.api_key}`;
      show('newKeyDisplay', true);
    }
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  }
});

document.getElementById('createKeyBtn').addEventListener('click', async () => {
  try {
    const created = await createApiKey(getServerUrl(), getToken(), 'Dashboard key');
    document.getElementById('newKeyDisplay').textContent = `New API key (copy now): ${created.key}`;
    show('newKeyDisplay', true);
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  renderDashboard();
});

document.getElementById('googleBtn').addEventListener('click', async () => {
  const config = await fetchPublicConfig(getServerUrl());
  if (config.supabaseUrl && config.supabaseAnonKey) {
    window.location.href = `${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.href)}`;
  } else {
    setError('Google OAuth not configured. Use dev login.');
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
