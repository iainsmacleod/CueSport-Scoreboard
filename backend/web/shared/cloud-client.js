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
    this.handlers = { state: [], command: [], joined: [], error: [], presence: [] };
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

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl());
      this.ws.onopen = () => {
        const msg = { type: 'join', client: this.client };
        if (this.guestToken) {
          msg.guest_token = this.guestToken;
          msg.client = 'mobile_guest';
        } else if (this.roomId) {
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
          if (data.state && typeof data.state === 'object' && Object.keys(data.state).length) {
            this.lastState = data.state;
            this.handlers.state.forEach((fn) => fn(data.state));
          }
          this.handlers.joined.forEach((fn) => fn(data));
          resolve(data);
        } else if (data.type === 'state') {
          this.lastState = data.state || {};
          this.handlers.state.forEach((fn) => fn(this.lastState));
        } else if (data.type === 'error') {
          this.handlers.error.forEach((fn) => fn(data));
          if (!this.connected) reject(new Error(data.message || data.code));
        } else if (data.type === 'presence') {
          this.handlers.presence.forEach((fn) => fn(data.clients || []));
        }
      };
      this.ws.onerror = () => reject(new Error('WebSocket error'));
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
    if (this.ws) this.ws.close();
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

export async function devLogin(serverUrl, email) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Login failed');
  }
  return res.json();
}

export async function fetchMe(serverUrl, token) {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Unauthorized');
  return res.json();
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
  if (!res.ok) throw new Error('Failed to create API key');
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
