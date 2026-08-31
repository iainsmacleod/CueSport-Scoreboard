import {
  fetchPublicConfig,
  devLogin,
  fetchMe,
  createApiKey,
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

    const roomList = document.getElementById('roomList');
    roomList.innerHTML = '';
    me.rooms.forEach((room) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${room.label}</strong><br><code>${room.id}</code>`;
      roomList.appendChild(li);
    });

    const keyList = document.getElementById('keyList');
    keyList.innerHTML = '';
    (me.api_keys || []).forEach((k) => {
      const li = document.createElement('li');
      li.textContent = `${k.label} — created ${k.created_at}`;
      keyList.appendChild(li);
    });

    if (me.rooms[0]) {
      const link = document.getElementById('mobileLink');
      link.href = `${getServerUrl().replace(/\/$/, '')}/m/${me.rooms[0].id}`;
    }
  } catch (err) {
    localStorage.removeItem(TOKEN_KEY);
    setError(err.message);
    renderDashboard();
  }
}

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
