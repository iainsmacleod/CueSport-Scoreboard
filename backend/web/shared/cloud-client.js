/** Shared WebSocket client for CueSport Cloud web apps */
export class CloudClient {
  constructor(options = {}) {
    this.serverUrl = (options.serverUrl || window.location.origin).replace(/\/$/, '');
    this.roomId = options.roomId || '';
    this.client = options.client || 'mobile';
    this.accessToken = options.accessToken || '';
    this.apiKey = options.apiKey || '';
    this.guestToken = options.guestToken || '';
    this.ws = null;
    this.handlers = {
      state: [],
      command: [],
      joined: [],
      error: [],
      presence: [],
      close: [],
      tables: [],
    };
    this.lastState = {};
    this.connected = false;
  }

  wsUrl() {
    let base = this.serverUrl;
    if (base.startsWith('https://')) base = base.replace('https://', 'wss://');
    else if (base.startsWith('http://')) base = base.replace('http://', 'ws://');
    return `${base}/ws`;
  }

  on(event, fn) {
    if (this.handlers[event]) this.handlers[event].push(fn);
  }

  connect(options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timeoutId != null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        fn(value);
      };

      const fail = (code, message) => {
        const err = new Error(message || code || 'Connection failed');
        err.code = code || 'connection_failed';
        finish(reject, err);
      };

      try {
        this.ws = new WebSocket(this.wsUrl());
      } catch (err) {
        fail('websocket_error', err.message || 'WebSocket error');
        return;
      }

      timeoutId = setTimeout(() => {
        try {
          if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
          }
        } catch (_) { /* ignore */ }
        this.ws = null;
        this.connected = false;
        fail('connect_timeout', 'Connection timed out — check your network and sign in again.');
      }, timeoutMs);

      this.ws.onopen = () => {
        const msg = { type: 'join', client: this.client };
        if (this.guestToken) {
          msg.guest_token = this.guestToken;
          msg.client = 'mobile_guest';
        } else if (this.client !== 'dashboard' && this.roomId) {
          msg.room_id = this.roomId;
        }
        if (this.accessToken) msg.access_token = this.accessToken;
        else if (this.apiKey) msg.api_key = this.apiKey;
        this.ws.send(JSON.stringify(msg));
      };
      this.ws.onmessage = (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (data.type === 'joined') {
          this.connected = true;
          if (data.room_id) this.roomId = data.room_id;
          if (Array.isArray(data.clients)) {
            this.handlers.presence.forEach((fn) => fn(data.clients));
          }
          if (Array.isArray(data.rooms)) {
            this.handlers.tables.forEach((fn) => fn(data.rooms));
          }
          if (data.state && typeof data.state === 'object' && Object.keys(data.state).length) {
            this.lastState = data.state;
            this.handlers.state.forEach((fn) => fn(data.state));
          }
          this.handlers.joined.forEach((fn) => fn(data));
          finish(resolve, data);
        } else if (data.type === 'state') {
          this.lastState = data.state || {};
          this.handlers.state.forEach((fn) => fn(this.lastState));
        } else if (data.type === 'tables') {
          this.handlers.tables.forEach((fn) => fn(data.rooms || []));
        } else if (data.type === 'error') {
          this.handlers.error.forEach((fn) => fn(data));
          if (!this.connected) {
            fail(data.code || 'connection_failed', data.message || data.code || 'Connection failed');
          }
        } else if (data.type === 'presence') {
          this.handlers.presence.forEach((fn) => fn(data.clients || []));
        }
      };
      this.ws.onerror = () => {
        if (!this.connected) fail('websocket_error', 'WebSocket error');
      };
      this.ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.handlers.close.forEach((fn) => fn({ wasConnected }));
        if (!wasConnected && !settled) {
          fail('connection_closed', 'Connection closed before login completed.');
        }
      };
    });
  }

  sendCommand(action, payload = {}) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({
      type: 'command',
      room_id: this.roomId,
      action,
      payload,
      source: this.client,
      ts: new Date().toISOString(),
    }));
    return true;
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      try { this.ws.close(); } catch (_) { /* ignore */ }
    }
    this.ws = null;
    this.connected = false;
  }
}

export async function fetchPublicConfig(serverUrl) {
  const base = (serverUrl || window.location.origin).replace(/\/$/, '');
  const res = await fetch(`${base}/api/config/public`);
  if (!res.ok) throw new Error('Config fetch failed');
  return res.json();
}

export async function devLogin(serverUrl, secret) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || err.message || defaultDevLoginError(res.status);
    throw new Error(msg);
  }
  return res.json();
}

function defaultDevLoginError(status) {
  if (status === 401) return 'Invalid dev auth secret';
  if (status === 403) return 'Dev auth disabled on this server';
  if (status === 503) return 'Dev auth not configured (set DEV_AUTH_SECRET on the server)';
  if (status === 400) return 'Dev auth secret required';
  return 'Dev login failed';
}

export async function fetchMe(serverUrl, token) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
}

export async function fetchAccountStats(serverUrl, token) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load stats');
  }
  return res.json();
}

export async function updateAccountMatch(serverUrl, token, startEventId, payload) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/stats/matches/${encodeURIComponent(startEventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update match');
  }
  return res.json();
}

export async function deleteAccountMatch(serverUrl, token, startEventId) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/stats/matches/${encodeURIComponent(startEventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete match');
  }
  return res.json();
}

export async function renameAccountPlayer(serverUrl, token, from, to) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/stats/players`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to rename player');
  }
  return res.json();
}

export async function fetchPlayers(serverUrl, token, query = '', limit = 8) {
  const base = serverUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('limit', String(limit));
  const res = await fetch(`${base}/api/players?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load players');
  const data = await res.json();
  return data.players || [];
}

export async function createApiKey(serverUrl, token, label) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/api-keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || 'Failed to create API key');
  }
  return res.json();
}

export async function fetchApiKey(serverUrl, token, keyId) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/api-keys/${encodeURIComponent(keyId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || 'Failed to load API key');
  }
  return res.json();
}

export async function createGuestLink(serverUrl, token, roomId, label) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/rooms/${roomId}/guest-link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ label: label || 'Guest scorer' }),
  });
  if (!res.ok) throw new Error('Failed to create guest link');
  return res.json();
}

export async function revokeApiKey(serverUrl, token, keyId) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to revoke API key');
  }
  return res.json();
}

export async function fetchGuestLinks(serverUrl, token, roomId) {
  const base = serverUrl.replace(/\/$/, '');
  const path = roomId
    ? `/api/rooms/${encodeURIComponent(roomId)}/guest-links`
    : '/api/guest-links';
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load guest links');
  const data = await res.json();
  return data.guest_links || [];
}

export async function revokeGuestLink(serverUrl, token, guestToken) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/guest-links/${encodeURIComponent(guestToken)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to revoke guest link');
  }
  return res.json();
}

export async function revokeAllGuestLinks(serverUrl, token) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/guest-links/revoke-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to revoke guest links');
  }
  return res.json();
}

export async function invalidateAllSessions(serverUrl, token) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/sessions/invalidate-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to invalidate sessions');
  }
  return res.json();
}

export const GAME_TYPES = [
  { id: 'game1', label: '8-Ball' },
  { id: 'game2', label: '9-Ball' },
  { id: 'game3', label: '10-Ball' },
  { id: 'game4', label: 'Straight' },
  { id: 'game5', label: 'Bank' },
  { id: 'game6', label: 'One Pocket' },
  { id: 'game7', label: 'Custom' },
  { id: 'game8', label: 'Snooker' },
];
