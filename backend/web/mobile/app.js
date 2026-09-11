import {
  CloudClient,
  devLogin,
  createGuestLink,
  fetchGuestLinks,
  revokeGuestLink,
  fetchPlayers,
  GAME_TYPES,
} from '../shared/cloud-client.js?v=8.0.0.3';
import {
  parseRaceTarget,
  isRaceLocked,
  normalizePlayerName,
  truncatePlayerName,
} from '../shared/scoreboard-helpers.js?v=8.0.0';

const TOKEN_KEY = 'cuesport_token';
let client = null;
let roomId = '';
let lastState = {};
let raceDirty = false;
let gameInfoDirty = false;
let dockPresent = false;
/** Keep trying to stay joined (admin or guest) until sign-out / revoke. */
let wantConnection = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectInFlight = false;
/** Bumps on every connect attempt so superseded joins cannot clear the reconnect UI. */
let connectEpoch = 0;
let connectionHiddenAt = 0;
/** Ignore pageshow/visibility ensureConnection until the first boot connect is kicked off. */
let bootConnectStarted = false;

let guestToken = '';
let isGuestMode = false;
/** @type {'control' | 'setup' | 'replay' | 'share'} */
let activeView = 'control';
/** Only auto-open Setup once per connection when names still look like defaults. */
let initialViewChosen = false;
let cachedGuestShareUrl = '';
let cachedGuestShareToken = '';
let cachedGuestShareLabel = '';
let guestShareRevealed = false;
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
      hint.innerHTML = 'Using saved login from this browser. Tap <strong>Connect</strong> to open this table. Use <strong>Clear Saved Login</strong> to sign in with a different secret.';
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
  // Guests get full match controls (Restart/End/Call); replay and share stay admin-only.
  ['adminPlayersPanel', 'viewReplay', 'viewShare'].forEach((id) => show(id, false));
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.add('hidden'));
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) replayBtn.classList.add('hidden');
  const shareBtn = document.getElementById('navShareBtn');
  if (shareBtn) shareBtn.classList.add('hidden');
  const dash = document.getElementById('dashboardLink');
  if (dash) dash.classList.add('hidden');
}

function showMobileNav(visible) {
  const nav = document.getElementById('mobileBottomNav');
  if (!nav) return;
  nav.classList.toggle('hidden', !visible);
  document.body.classList.toggle('has-mobile-nav', !!visible);
}

function isReplayEnabled(state = lastState) {
  return !!(state && state.replayEnabled);
}

function syncReplayNavVisibility(state = lastState) {
  if (isGuestMode) return;
  const enabled = isReplayEnabled(state);
  const replayBtn = document.getElementById('navReplayBtn');
  if (replayBtn) {
    replayBtn.classList.toggle('hidden', !enabled);
  }
  if (!enabled && activeView === 'replay') {
    setActiveView('control');
  }
}

function setActiveView(view) {
  if (view !== 'control' && view !== 'setup' && view !== 'replay' && view !== 'share') {
    view = 'control';
  }
  if (isGuestMode && (view === 'replay' || view === 'share')) view = 'control';
  if (view === 'replay' && !isReplayEnabled()) view = 'control';
  activeView = view;
  show('viewControl', view === 'control');
  show('viewSetup', view === 'setup');
  show('viewReplay', view === 'replay' && !isGuestMode && isReplayEnabled());
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
    replayBtn.classList.toggle('hidden', isGuestMode || !isReplayEnabled());
    replayBtn.classList.toggle('active', view === 'replay');
    replayBtn.setAttribute('aria-current', view === 'replay' ? 'page' : 'false');
  }
  const shareBtn = document.getElementById('navShareBtn');
  if (shareBtn) {
    shareBtn.classList.toggle('active', view === 'share');
    shareBtn.setAttribute('aria-current', view === 'share' ? 'page' : 'false');
  }

  if (view === 'share') {
    hideGuestShareDetails();
    ensureGuestShareLink({ refreshList: true, forceHide: true })
      .catch((err) => setError(err.message || 'Failed to create guest link'));
  } else {
    hideGuestShareDetails();
  }
}

/** Empty or placeholder dock names → send user to Setup first. */
function isDefaultPlayerName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return true;
  return (
    n === 'player 1' ||
    n === 'player 2' ||
    n === 'player1' ||
    n === 'player2' ||
    n === 'p1' ||
    n === 'p2' ||
    n === 'player/team 1' ||
    n === 'player/team 2' ||
    n === 'player / team 1' ||
    n === 'player / team 2'
  );
}

/** True when either name is still a placeholder — prefer Setup so names get set. */
function needsMatchSetup(state) {
  if (!state || typeof state !== 'object') return true;
  return isDefaultPlayerName(state.player1Name) || isDefaultPlayerName(state.player2Name);
}

/** Default Control; Setup only when names are still placeholders (Player 1 / Player 2). */
function maybeChooseInitialView(state) {
  if (initialViewChosen) return;
  if (!state || typeof state !== 'object' || !Object.keys(state).length) return;
  initialViewChosen = true;
  setActiveView(needsMatchSetup(state) ? 'setup' : 'control');
}

function guestUrlFromLink(link) {
  if (!link) return '';
  if (link.path) return `${window.location.origin}${link.path}`;
  if (link.url) return link.url;
  if (link.token) return `${window.location.origin}/g/${link.token}`;
  return '';
}

function syncShareActionButtons({ enable = false } = {}) {
  const copyBtn = document.getElementById('shareCopyBtn');
  const shareBtn = document.getElementById('shareNativeBtn');
  const revealBtn = document.getElementById('shareRevealBtn');
  const useShare = typeof navigator.share === 'function';
  if (copyBtn) {
    copyBtn.classList.toggle('hidden', useShare);
    copyBtn.disabled = !(enable && !useShare);
  }
  if (shareBtn) {
    shareBtn.classList.toggle('hidden', !useShare);
    shareBtn.disabled = !(enable && useShare);
  }
  if (revealBtn) {
    revealBtn.disabled = !cachedGuestShareUrl;
    revealBtn.textContent = guestShareRevealed ? 'Hide' : 'Show';
  }
}

function setGuestShareRevealed(revealed) {
  guestShareRevealed = !!revealed && !!cachedGuestShareUrl;
  const wrap = document.getElementById('shareQrWrap');
  const urlEl = document.getElementById('shareUrl');
  const qr = document.getElementById('shareQrImg');
  const placeholder = document.getElementById('shareQrPlaceholder');
  const status = document.getElementById('shareStatus');
  if (wrap) wrap.classList.toggle('is-obscured', !guestShareRevealed);
  if (urlEl) urlEl.classList.toggle('is-obscured', !guestShareRevealed);

  if (qr) {
    if (guestShareRevealed && cachedGuestShareUrl) {
      const base = window.location.origin.replace(/\/$/, '');
      qr.src = `${base}/api/qr?size=220&margin=2&data=${encodeURIComponent(cachedGuestShareUrl)}`;
      qr.classList.remove('hidden');
    } else {
      qr.removeAttribute('src');
      qr.classList.add('hidden');
    }
  }
  if (placeholder) placeholder.classList.toggle('hidden', guestShareRevealed && !!cachedGuestShareUrl);

  if (urlEl) {
    if (guestShareRevealed && cachedGuestShareUrl) {
      urlEl.textContent = cachedGuestShareUrl;
      urlEl.classList.remove('hidden');
    } else if (cachedGuestShareUrl) {
      urlEl.textContent = 'Hidden — press Show';
      urlEl.classList.remove('hidden');
    } else {
      urlEl.textContent = '';
      urlEl.classList.add('hidden');
    }
  }

  if (status) {
    if (!cachedGuestShareUrl) {
      status.textContent = 'Preparing link…';
      status.classList.remove('hidden');
    } else {
      const label = cachedGuestShareLabel || 'Guest link';
      status.textContent = guestShareRevealed ? `${label} — visible` : `${label} — hidden`;
      status.classList.remove('hidden');
    }
  }

  syncShareActionButtons({ enable: guestShareRevealed });
}

function hideGuestShareDetails() {
  guestShareRevealed = false;
  setGuestShareRevealed(false);
}

function selectGuestShareLink(link, { keepReveal = false } = {}) {
  const nextToken = link?.token || '';
  const tokenChanged = nextToken !== cachedGuestShareToken;
  const stayRevealed = keepReveal && !tokenChanged && guestShareRevealed;
  cachedGuestShareToken = nextToken;
  cachedGuestShareUrl = guestUrlFromLink(link);
  cachedGuestShareLabel = link?.label || '';
  setGuestShareRevealed(stayRevealed);
  const list = document.getElementById('guestLinkList');
  if (!list) return;
  list.querySelectorAll('.guest-link-item').forEach((row) => {
    row.classList.toggle('is-current', row.dataset.token === cachedGuestShareToken);
  });
}

async function ensureGuestShareLink({ refreshList = false, forceHide = true } = {}) {
  if (guestSharePromise) return guestSharePromise;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!roomId || !token) {
    throw new Error('Sign in required to create a guest control link');
  }
  const status = document.getElementById('shareStatus');
  if (status) {
    status.textContent = 'Preparing link…';
    status.classList.remove('hidden');
  }
  if (forceHide) hideGuestShareDetails();
  guestSharePromise = (async () => {
    let links = await fetchGuestLinks(window.location.origin, token, roomId);
    const owner = (links || []).find((g) => g.label === 'OBS Dock Owner');
    if (!links.length || !owner) {
      const created = await createGuestLink(window.location.origin, token, roomId, 'OBS Dock Owner');
      links = await fetchGuestLinks(window.location.origin, token, roomId);
      if (!links.length) {
        links = [{ token: created.token, path: created.path, url: created.url, label: created.label, connected: 0 }];
      }
    }
    const chosen = links.find((g) => g.token === cachedGuestShareToken)
      || links.find((g) => g.label === 'OBS Dock Owner')
      || links[0];
    selectGuestShareLink(chosen, { keepReveal: !forceHide });
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
    li.className = 'token-list-item guest-link-item';
    li.dataset.token = g.token || '';
    const isOwner = g.label === 'OBS Dock Owner';
    if (isOwner) li.classList.add('is-owner');
    const n = Number(g.connected) || 0;
    const label = document.createElement('span');
    const status = n > 0 ? `${n} connected` : 'Offline';
    label.textContent = `${g.label || 'Guest'} · ${formatLocalDateTime(g.created_at) || g.created_at} · ${status}`;
    if (g.token === cachedGuestShareToken) li.classList.add('is-current');

    const actions = document.createElement('div');
    actions.className = 'token-list-actions';
    if (isOwner) {
      const badge = document.createElement('span');
      badge.className = 'dash-guest-owner-badge';
      badge.textContent = 'Default';
      actions.appendChild(badge);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn danger';
    btn.textContent = 'Revoke';
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const msg = isOwner
        ? 'Revoke OBS Dock Owner? Anyone using this default guest link will be disconnected.'
        : 'Revoke this guest link? Anyone using it will be disconnected.';
      if (!window.confirm(msg)) return;
      try {
        await revokeGuestLink(window.location.origin, localStorage.getItem(TOKEN_KEY), g.token);
        if (cachedGuestShareToken === g.token) {
          cachedGuestShareToken = '';
          cachedGuestShareUrl = '';
          cachedGuestShareLabel = '';
          guestShareRevealed = false;
        }
        await ensureGuestShareLink({ refreshList: true, forceHide: true });
      } catch (err) {
        setError(err.message);
      }
    });
    actions.appendChild(btn);

    li.addEventListener('click', () => {
      const same = g.token === cachedGuestShareToken;
      selectGuestShareLink(g, { keepReveal: same });
    });
    li.appendChild(label);
    li.appendChild(actions);
    list.appendChild(li);
  });
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
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!roomId || !token) throw new Error('Sign in required to create a guest control link');
        const nameInput = document.getElementById('shareNewLinkName');
        const name = String(nameInput?.value || '').trim();
        if (!name) {
          setError('Enter a name for this guest link.');
          nameInput?.focus();
          return;
        }
        const created = await createGuestLink(window.location.origin, token, roomId, name);
        if (nameInput) nameInput.value = '';
        cachedGuestShareToken = created.token;
        cachedGuestShareUrl = guestUrlFromLink(created);
        cachedGuestShareLabel = created.label || name;
        guestShareRevealed = false;
        await ensureGuestShareLink({ forceHide: true });
      } catch (err) {
        setError(err.message || 'Failed to create guest link');
      }
    });
  }
  document.getElementById('shareNewLinkName')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('shareNewLinkBtn')?.click();
    }
  });
  document.getElementById('shareRevealBtn')?.addEventListener('click', () => {
    if (!cachedGuestShareUrl) return;
    setGuestShareRevealed(!guestShareRevealed);
  });
  const copyBtn = document.getElementById('shareCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!guestShareRevealed || !cachedGuestShareUrl) {
        setError('Press Show before copying the link.');
        return;
      }
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
      if (!guestShareRevealed || !cachedGuestShareUrl || typeof navigator.share !== 'function') {
        if (!guestShareRevealed) setError('Press Show before sharing the link.');
        return;
      }
      try {
        await navigator.share({
          title: 'CueSport guest control link',
          url: cachedGuestShareUrl,
        });
      } catch (err) {
        if (err && err.name !== 'AbortError') setError(err.message || 'Share failed');
      }
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activeView === 'share') {
      hideGuestShareDetails();
    }
  });
  window.addEventListener('pageshow', () => {
    if (activeView === 'share') hideGuestShareDetails();
  });
  syncShareActionButtons();
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

function connectionIsOpen() {
  return !!(client && typeof client.isOpen === 'function' && client.isOpen());
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function setReconnectBanner(visible, message) {
  const banner = document.getElementById('reconnectBanner');
  const text = document.getElementById('reconnectBannerText');
  if (!banner) return;
  if (text && message) text.textContent = message;
  banner.classList.toggle('hidden', !visible);
}

function scheduleReconnect() {
  if (!wantConnection) return;
  clearReconnectTimer();
  const delay = Math.min(10000, 800 * (2 ** Math.min(reconnectAttempt, 4)));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectQuiet().catch(() => {});
  }, delay);
}

/**
 * Soft reconnect without bouncing back to the Connecting splash when possible.
 * Not a poll — only runs on close, visibility return, online, or Reconnect tap.
 */
async function reconnectQuiet(options = {}) {
  if (!wantConnection || reconnectInFlight) return;
  const force = !!(options && options.force);
  if (!force && connectionIsOpen()) {
    setReconnectBanner(false);
    return;
  }
  reconnectInFlight = true;
  setReconnectBanner(true, 'Reconnecting…');
  try {
    await connect({ quiet: true });
    if (!wantConnection) return;
    if (connectionIsOpen()) {
      reconnectAttempt = 0;
      setReconnectBanner(false);
      return;
    }
    // Join resolved but socket already gone (race / deploy) — keep CTA visible.
    setReconnectBanner(true, 'Connection lost — tap Reconnect');
    scheduleReconnect();
  } catch (err) {
    if (!wantConnection) return;
    if (shouldClearSavedLogin(err)) {
      forceRelogin(reloginMessage(err), { clearToken: true });
      return;
    }
    setReconnectBanner(true, 'Connection lost — tap Reconnect');
    scheduleReconnect();
  } finally {
    reconnectInFlight = false;
  }
}

function ensureConnection(options = {}) {
  if (!wantConnection) return;
  const force = !!(options && options.force);
  if (!force && connectionIsOpen()) {
    setReconnectBanner(false);
    return;
  }
  clearReconnectTimer();
  reconnectAttempt = 0;
  reconnectQuiet({ force: true }).catch(() => {});
}

/** Controls require a live cloud socket AND a dock in the room. */
function controlsEnabled() {
  return !!(connectionIsOpen() && dockPresent);
}

function updateControlsLock() {
  const locked = !controlsEnabled();
  document.body.classList.toggle('controls-locked', locked);
  if (locked) {
    closeScoringPickers();
  }
  const live = document.getElementById('liveBoard');
  if (live) {
    live.setAttribute('aria-disabled', locked ? 'true' : 'false');
    if (locked) live.title = controlLockMessage();
    else live.removeAttribute('title');
  }
  syncSaveIcons();
}

function wireClientLifecycle(c) {
  c.on('presence', (clients) => {
    if (client !== c) return;
    dockPresent = (clients || []).includes('dock');
    setConnectionStatus(dockPresent ? 'connected' : 'waiting');
  });
  c.on('close', () => {
    if (client !== c) return;
    dockPresent = false;
    setConnectionStatus('disconnected');
    if (wantConnection) {
      setReconnectBanner(true, 'Connection lost — tap Reconnect');
      scheduleReconnect();
    }
  });
}

function show(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function showConnecting() {
  show('connectingSection', true);
  show('loginSection', false);
  show('controlSection', false);
  showMobileNav(false);
  initialViewChosen = false;
}

function showLogin() {
  show('connectingSection', false);
  show('loginSection', true);
  show('controlSection', false);
  showMobileNav(false);
  initialViewChosen = false;
  syncLoginPanel();
}

function showControl() {
  show('connectingSection', false);
  show('loginSection', false);
  show('controlSection', true);
  showMobileNav(true);
}

/** Auth failures that require discarding the saved admin login. */
function shouldClearSavedLogin(err) {
  const code = err?.code || '';
  if (
    code === 'session_revoked' ||
    code === 'invalid_token' ||
    code === 'room_forbidden' ||
    code === 'auth_required'
  ) {
    return true;
  }
  const msg = String(err?.message || err || '');
  // Network / timeout must NOT clear the token — that breaks mobile resume.
  if (isTransientConnectError(err)) return false;
  return /session revoked|unauthorized|invalid token|expired token/i.test(msg);
}

function isTransientConnectError(err) {
  const code = err?.code || '';
  return (
    code === 'connect_timeout' ||
    code === 'connection_closed' ||
    code === 'websocket_error' ||
    code === 'connection_failed'
  );
}

function reloginMessage(err) {
  const code = err?.code || '';
  if (code === 'session_revoked') {
    return 'Signed out everywhere. Sign in again to reconnect.';
  }
  if (code === 'room_forbidden') {
    return 'This room belongs to another account. Sign in with the dev secret for that account, or open the mobile link from your dashboard.';
  }
  if (code === 'control_connection_limit') {
    return err.message || 'Too many devices controlling this table. Disconnect another phone or upgrade your plan.';
  }
  if (code === 'invalid_token' || code === 'auth_required') {
    return 'Saved login expired. Sign in again to reconnect.';
  }
  if (isTransientConnectError(err)) {
    return 'Couldn\'t connect — check your network and tap Reconnect.';
  }
  return err?.message || err?.code || 'Connection failed. Sign in again.';
}

/** Keep the control shell + reconnect CTA; never wipe the token. */
function stayConnectedWithRetry(message) {
  wantConnection = true;
  dockPresent = false;
  setConnectionStatus('disconnected');
  show('connectingSection', false);
  show('loginSection', false);
  show('controlSection', true);
  showMobileNav(true);
  setReconnectBanner(true, message || 'Connection lost — tap Reconnect');
  setError('');
  scheduleReconnect();
}

/**
 * Leave Connecting/Control, optionally wipe cuesport_token, and show login with a reason.
 * Used for revoke, expired token, and hung connect recovery.
 */
function forceRelogin(reason, { clearToken = true } = {}) {
  wantConnection = false;
  clearReconnectTimer();
  setReconnectBanner(false);
  if (clearToken) localStorage.removeItem(TOKEN_KEY);
  if (client) {
    try { client.disconnect(); } catch (_) { /* ignore */ }
    client = null;
  }
  dockPresent = false;
  setConnectionStatus('disconnected');
  showLogin();
  setError(reason || '');
  syncLoginPanel();
}

function setError(msg) {
  const text = msg || '';
  const onLogin = !document.getElementById('loginSection')?.classList.contains('hidden');
  const loginErr = document.getElementById('loginError');
  const pageErr = document.getElementById('error');
  if (loginErr) {
    loginErr.textContent = onLogin ? text : '';
    loginErr.classList.toggle('hidden', !onLogin || !text);
  }
  if (pageErr) {
    pageErr.textContent = onLogin ? '' : text;
    pageErr.classList.toggle('hidden', onLogin || !text);
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
  if (state.timestamp && state.timestamp !== prevTs) {
    lastBallGridKey = '';
  }
  maybeChooseInitialView(state);
  resolvePendingBreakerFromState(state);

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
      // One Pocket: pots credit the selected Scoring Player (may not be the shooter).
      slotQuestion.textContent = state.gameType === 'game6' ? 'Scoring Player' : 'Active Player';
    }
  }
  if (slotP1 && slotP2) {
    slotP1.textContent = p1Name || 'P1';
    slotP2.textContent = p2Name || 'P2';
    slotP1.classList.remove('selected', 'rack-breaker-match-locked', 'rack-breaker-inactive', 'rack-breaker-current');
    slotP2.classList.remove('selected', 'rack-breaker-match-locked', 'rack-breaker-inactive', 'rack-breaker-current');
    slotP1.disabled = false;
    slotP2.disabled = false;
    const breakerPending = isCommandPending('select_breaker');
    if (slotMode === 'breaker' || slotMode === 'match_locked') {
      slotP1.classList.toggle('rack-breaker-match-locked', slotMode === 'match_locked');
      slotP2.classList.toggle('rack-breaker-match-locked', slotMode === 'match_locked');
      // Keep clickable when match-locked so tap can open End Match (same as dock).
      // While select_breaker is in flight, disable both to prevent double-send.
      if (breakerPending && slotMode === 'breaker') {
        slotP1.disabled = true;
        slotP2.disabled = true;
      }
    } else {
      // Active (or off): highlight current player — names live here now.
      // Current active player cannot be re-selected (avoids false switch events).
      slotP1.classList.toggle('selected', active === '1');
      slotP2.classList.toggle('selected', active === '2');
      slotP1.classList.toggle('rack-breaker-inactive', active !== '1');
      slotP2.classList.toggle('rack-breaker-inactive', active !== '2');
      slotP1.classList.toggle('rack-breaker-current', active === '1');
      slotP2.classList.toggle('rack-breaker-current', active === '2');
      slotP1.disabled = active === '1';
      slotP2.disabled = active === '2';
    }
  }

  // Form fields — always sync from dock (including empty), unless the user has unsaved edits
  if (state.player1Name != null) document.getElementById('p1Name').value = state.player1Name;
  if (state.player2Name != null) document.getElementById('p2Name').value = state.player2Name;
  if (state.raceInfo != null) {
    raceDirty = applyCommittedTextField('raceInput', state.raceInfo, raceDirty);
  }
  if (state.gameInfo != null) {
    gameInfoDirty = applyCommittedTextField('gameInfoInput', state.gameInfo, gameInfoDirty);
  }
  syncSaveIcons();
  syncSelectFromState('gameTypeSelect', 'gameType', state.gameType);
  syncSetupFieldsFromState(state);

  const metaParts = [
    gameTypeLabel(state.gameType),
    state.raceInfo ? `${state.raceLabel || 'Race'} ${state.raceInfo}` : null,
    (state.gameInfo || '').trim() || null,
  ].filter(Boolean);
  document.getElementById('liveMeta').textContent = metaParts.join(' · ');

  syncMatchActionButtons(state);
  syncReplayPanel(state);
  syncReplayNavVisibility(state);

  renderBallGrid(state);
}

const BALL_IMG = '/web/images/balls';
let lastBallGridKey = '';
let lastStateSeq = 0;

/**
 * Hold local setup edits until dock state echoes the same value (no wall-clock TTL).
 * Cleared on echo match, command send failure, or explicit clearPendingSetup.
 */
const pendingSetupSync = {};

/** In-flight remote commands waiting for dock-authoritative state (no optimistic UI). */
const pendingCommands = {};

function markSetupPending(key, value) {
  pendingSetupSync[key] = { value: String(value) };
}

function clearPendingSetup(key) {
  if (key) delete pendingSetupSync[key];
  else Object.keys(pendingSetupSync).forEach((k) => delete pendingSetupSync[k]);
}

function shouldSyncSetupFromState(key, stateValue) {
  const pending = pendingSetupSync[key];
  if (!pending) return true;
  if (String(stateValue) === pending.value) {
    delete pendingSetupSync[key];
    return true;
  }
  return false;
}

function markCommandPending(action, meta) {
  pendingCommands[action] = { ...(meta || {}), since: Date.now() };
}

function clearCommandPending(action) {
  if (action) delete pendingCommands[action];
  else Object.keys(pendingCommands).forEach((k) => delete pendingCommands[k]);
}

function isCommandPending(action) {
  return !!pendingCommands[action];
}

/** Clear pending select_breaker once dock state confirms or rejects the choice. */
function resolvePendingBreakerFromState(state) {
  const pending = pendingCommands.select_breaker;
  if (!pending) return;
  const slot = String(pending.slot || '');
  const dockSlot = String(state.rackBreakerSlot || '');
  if ((slot === '1' || slot === '2') && dockSlot === slot) {
    clearCommandPending('select_breaker');
    return;
  }
  const seq = typeof state.stateSeq === 'number' ? state.stateSeq : null;
  // Newer dock publish after our command that still awaits breaker → command did not apply.
  if (
    seq != null &&
    pending.expectAfterSeq != null &&
    seq > pending.expectAfterSeq &&
    (state.awaitingBreaker === true || state.playerSlotMode === 'breaker')
  ) {
    clearCommandPending('select_breaker');
  }
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

/**
 * Dock publishes awaitingBreaker / playerSlotMode / rackBreakerSlot.
 * Trust those fields; only fall back when older docks omit them.
 */
function inferAwaitingBreaker(state) {
  if (!state || state.gameScoringLocked) return false;
  if (typeof state.awaitingBreaker === 'boolean') return state.awaitingBreaker;
  if (state.ballGrid && typeof state.ballGrid.awaitingBreaker === 'boolean') {
    return state.ballGrid.awaitingBreaker;
  }
  if (state.playerSlotMode === 'breaker') return true;
  if (state.playerSlotMode === 'active' || state.playerSlotMode === 'off' || state.playerSlotMode === 'match_locked') {
    return false;
  }
  const slot = String(state.rackBreakerSlot || '');
  if (slot === '1' || slot === '2') return false;
  return isBreakerPromptGame(state);
}

function inferPlayerSlotMode(state) {
  if (!isBreakerPromptGame(state)) return 'off';
  const dockMode = state.playerSlotMode;
  if (dockMode === 'breaker' || dockMode === 'match_locked' || dockMode === 'active' || dockMode === 'off') {
    return dockMode;
  }
  if (typeof state.awaitingBreaker === 'boolean') {
    if (state.gameScoringLocked) return 'match_locked';
    return state.awaitingBreaker ? 'breaker' : 'active';
  }
  const slot = String(state.rackBreakerSlot || '');
  if (slot === '1' || slot === '2') return 'active';
  if (state.gameScoringLocked) return 'match_locked';
  return 'breaker';
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
      if (action === 'open_respot_picker') {
        openPoolRespotPicker();
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

function foulCounterPlayerLabel(name, fallback) {
  const raw = truncatePlayerName(name);
  return raw || fallback;
}

function updateMobileRackFoulDisplay(state) {
  const counter = document.getElementById('rackFoulCounter');
  if (!counter) return;
  const snapshot = state && state.ballGrid;
  const show = isBallScoringOn(state) || !!(snapshot && snapshot.visible);
  counter.classList.toggle('hidden', !show);
  if (!show) return;
  const foulsP1 = Number(
    snapshot && snapshot.foulsP1 != null ? snapshot.foulsP1 : state.foulsP1
  ) || 0;
  const foulsP2 = Number(
    snapshot && snapshot.foulsP2 != null ? snapshot.foulsP2 : state.foulsP2
  ) || 0;
  const p1NameEl = document.getElementById('rackFoulP1Name');
  const p2NameEl = document.getElementById('rackFoulP2Name');
  const p1Count = document.getElementById('rackFoulP1');
  const p2Count = document.getElementById('rackFoulP2');
  const p1Wrap = document.getElementById('rackFoulP1Wrap');
  const p2Wrap = document.getElementById('rackFoulP2Wrap');
  // Same 20-char limit as Setup name fields (not a shorter first-name clip).
  if (p1NameEl) {
    p1NameEl.textContent = foulCounterPlayerLabel(state.player1Name, 'P1');
  }
  if (p2NameEl) {
    p2NameEl.textContent = foulCounterPlayerLabel(state.player2Name, 'P2');
  }
  if (p1Count) p1Count.textContent = String(foulsP1);
  if (p2Count) p2Count.textContent = String(foulsP2);
  const active = String(state.activePlayer || '1');
  if (p1Wrap) p1Wrap.classList.toggle('is-active', active === '1');
  if (p2Wrap) p2Wrap.classList.toggle('is-active', active === '2');
  const snooker = !!(snapshot && snapshot.snooker) || state.gameType === 'game8';
  const period = snooker ? 'frame' : 'rack';
  counter.title = `Fouls this ${period}`;

  const statsRow = document.getElementById('rackSnookerStatsRow');
  const breakGroup = document.getElementById('rackBreakGroup');
  const statsSep = document.getElementById('rackSnookerStatsSep');
  const ptsValue = document.getElementById('rackPointsRemainingValue');
  const breakLabel = document.getElementById('rackCurrentBreakLabel');
  const breakBallsEl = document.getElementById('rackBreakBalls');
  const currentBreak = Number(
    snapshot && snapshot.snookerCurrentBreak != null
      ? snapshot.snookerCurrentBreak
      : state.snookerCurrentBreak
  ) || 0;
  const pointsRemaining = Number(
    snapshot && snapshot.snookerPointsRemaining != null
      ? snapshot.snookerPointsRemaining
      : state.snookerPointsRemaining
  ) || 0;
  const breakBalls = (
    snapshot && Array.isArray(snapshot.snookerBreakBalls)
      ? snapshot.snookerBreakBalls
      : (Array.isArray(state.snookerBreakBalls) ? state.snookerBreakBalls : [])
  );
  const showBreak = snooker && currentBreak > 0;
  if (statsRow) statsRow.classList.toggle('hidden', !snooker);
  if (breakGroup) breakGroup.classList.toggle('hidden', !showBreak);
  if (statsSep) statsSep.classList.toggle('hidden', !showBreak);
  if (ptsValue && snooker) ptsValue.textContent = String(pointsRemaining);
  if (breakLabel) breakLabel.textContent = `Break ${currentBreak}`;
  if (breakBallsEl) {
    breakBallsEl.innerHTML = '';
    if (showBreak) {
      breakBalls.forEach((ball) => {
        if (!ball || !(ball.count > 0)) return;
        const el = document.createElement('span');
        el.className = 'rack-break-ball';
        el.style.setProperty('--break-ball-color', ball.color || '#90a4ae');
        el.dataset.ball = ball.key || '';
        el.title = `${ball.key || 'ball'} × ${ball.count}`;
        el.setAttribute('aria-label', `${ball.key || 'ball'} potted ${ball.count} times`);
        el.textContent = String(ball.count);
        breakBallsEl.appendChild(el);
      });
    }
  }
}

function isSnookerGameState(state, snapshot) {
  return !!(snapshot && snapshot.snooker) ||
    state.gameType === 'game8' ||
    state.ballSelection === 'snooker';
}

/** Bank / One Pocket — same rule as dock isPoolRespotGame(). */
function isPoolRespotGameType(state) {
  return state.gameType === 'game5' || state.gameType === 'game6';
}

function isTrackerActionControlId(id) {
  return id === 'poolFoulBtn' || id === 'poolRespotBtn' || id === 'snookerUndoBtn';
}

function findSnapshotBall(snapshot, id) {
  if (!snapshot || !Array.isArray(snapshot.balls)) return null;
  return snapshot.balls.find((b) => b && b.id === id) || null;
}

/**
 * Action-row controls mirror the dock per game type:
 * - Snooker: Free Ball, Foul (picker), Undo
 * - Bank / One Pocket: Foul, Respot, Undo
 * - Other pool: Foul, Undo
 */
function appendActionBallsForGame(grid, state, snapshot, { locked, awaiting, canUndo, undoTitle }) {
  const snooker = isSnookerGameState(state, snapshot);
  if (snooker) {
    const b10 = findSnapshotBall(snapshot, 'ball 10');
    const freeOffered = state.snookerFreeBallOffered === true;
    // When offered, keep tappable even if dock disable flag raced the publish.
    const freeDisabled = locked || (!freeOffered && (b10 ? !!b10.disabled : true));
    appendBallButton(grid, {
      src: resolveBallImageSrc(state, 'ball 10', (b10 && b10.file) || 'snooker-freeball-small.png'),
      title: (b10 && b10.title) || 'Free Ball',
      faded: false,
      disabled: freeOffered && !locked ? false : freeDisabled,
      awaiting,
      clicked: !!(b10 && b10.clicked),
      extraClass: 'freeball-btn',
      action: 'snooker_ball',
      payload: { ballId: 'ball 10' },
    });
    const b11 = findSnapshotBall(snapshot, 'ball 11');
    appendBallButton(grid, {
      src: resolveBallImageSrc(state, 'ball 11', (b11 && b11.file) || 'foul-small.png'),
      title: 'Foul',
      faded: false,
      disabled: locked || !!(b11 && b11.disabled),
      awaiting,
      action: 'open_foul_picker',
      payload: { ballId: 'ball 11' },
    });
  } else {
    const foul = findSnapshotBall(snapshot, 'poolFoulBtn');
    appendBallButton(grid, {
      src: `${BALL_IMG}/${ballImageBasename(foul && foul.file) || 'foul-small.png'}`,
      title: 'Foul',
      faded: false,
      disabled: locked || !!(foul && foul.disabled),
      awaiting,
      action: 'pool_foul',
      payload: { ballId: 'poolFoulBtn' },
    });
    if (isPoolRespotGameType(state)) {
      const respot = findSnapshotBall(snapshot, 'poolRespotBtn');
      appendBallButton(grid, {
        src: `${BALL_IMG}/${ballImageBasename(respot && respot.file) || 'respot-small.png'}`,
        title: 'Respot',
        faded: false,
        disabled: locked || (respot ? !!respot.disabled : true),
        awaiting,
        action: 'open_respot_picker',
        payload: { ballId: 'poolRespotBtn' },
      });
    }
  }
  appendUndoButton(grid, { canUndo, title: undoTitle });
}

function renderBallGrid(state) {
  const panel = document.getElementById('ballGridPanel');
  const grid = document.getElementById('ballGrid');
  const hint = document.getElementById('ballGridHint');
  const snapshot = state.ballGrid;
  updateMobileRackFoulDisplay(state);
  const awaiting = inferAwaitingBreaker(state);
  const locked = !!(state.gameScoringLocked || (snapshot && snapshot.locked));
  if (locked) {
    closeScoringPickers();
  }
  const snooker = isSnookerGameState(state, snapshot);
  const canUndo = state.canUndo === true || (snapshot && snapshot.canUndo === true);
  const undoTitle = snooker
    ? 'Undo last pot, foul, or player change'
    : 'Undo last scoring action (pots, fouls, breaker, player change)';
  const useSnapshot = !!(snapshot && Array.isArray(snapshot.balls) && snapshot.balls.length);
  const ballSig = useSnapshot
    ? snapshot.balls.map((b) => `${b.id}:${b.file || ''}:${b.disabled ? 1 : 0}:${b.faded ? 1 : 0}:${b.hidden ? 1 : 0}:${b.clicked ? 1 : 0}`).join('|')
    : '';
  const key = JSON.stringify({
    ballSig,
    ballSelection: state.ballSelection || 'american',
    snooker,
    awaiting,
    locked,
    canUndo,
    freeBall: !!state.snookerFreeBallOffered,
    ballState: state.ballState,
    ballScoringEnabled: state.ballScoringEnabled,
    gameType: state.gameType,
    rackBreakerSlot: state.rackBreakerSlot,
    foulsP1: snapshot && snapshot.foulsP1 != null ? snapshot.foulsP1 : state.foulsP1,
    foulsP2: snapshot && snapshot.foulsP2 != null ? snapshot.foulsP2 : state.foulsP2,
    activePlayer: state.activePlayer,
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
    } else if (state.snookerFreeBallOffered && snooker) {
      hint.textContent = 'Free ball available';
      hint.classList.remove('hidden');
    } else if (!useSnapshot && snooker) {
      hint.textContent = 'Waiting for ball state from dock…';
      hint.classList.remove('hidden');
    } else {
      hint.textContent = '';
      hint.classList.add('hidden');
    }
  }

  const actionOpts = { locked, awaiting, canUndo, undoTitle };

  if (useSnapshot) {
    snapshot.balls.forEach((b) => {
      if (!b || b.hidden || isTrackerActionControlId(b.id)) return;
      // Snooker Free Ball / Foul live on the action row — not as object pots.
      if (snooker && (b.id === 'ball 10' || b.id === 'ball 11')) return;
      appendBallButton(grid, {
        src: resolveBallImageSrc(state, b.id, b.file),
        title: b.title,
        faded: !!b.faded,
        disabled: !!b.disabled || locked,
        awaiting,
        cooldown: !!b.cooldown,
        clicked: !!b.clicked,
        action: snooker ? 'snooker_ball' : 'toggle_pot',
        payload: { ballId: b.id },
      });
    });
    appendActionBallsForGame(grid, state, snapshot, actionOpts);
    return;
  }

  const gt = state.gameType;
  const selection = state.ballSelection || 'american';
  if (snooker) {
    // Object colors until dock snapshot arrives; action row still usable.
    for (let i = 1; i <= 8; i++) {
      if (i === 8 && state.snookerGoldEnabled !== true) continue;
      appendBallButton(grid, {
        src: `${BALL_IMG}/${ballImageFile(i, 'snooker')}`,
        title: `Ball ${i}`,
        faded: false,
        disabled: locked,
        awaiting,
        action: 'snooker_ball',
        payload: { ballId: `ball ${i}` },
      });
    }
    appendActionBallsForGame(grid, state, snapshot, actionOpts);
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
  appendActionBallsForGame(grid, state, snapshot, actionOpts);
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
  if (!controlsEnabled() || (lastState && lastState.gameScoringLocked)) return;
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

function closePoolRespotPicker() {
  const modal = document.getElementById('poolRespotModal');
  const hint = document.getElementById('poolRespotHint');
  if (modal) modal.classList.add('hidden');
  if (hint) hint.textContent = '';
}

/** Close foul / respot pickers without sending a command (safe cancel). */
function closeScoringPickers() {
  closeSnookerFoulPicker();
  closePoolRespotPicker();
}

function isScoringPickerOpen() {
  const foul = document.getElementById('snookerFoulModal');
  const respot = document.getElementById('poolRespotModal');
  return !!(foul && !foul.classList.contains('hidden'))
    || !!(respot && !respot.classList.contains('hidden'));
}

function selectSnookerFoul(foulKey) {
  closeSnookerFoulPicker();
  sendCmd('snooker_foul', { foulKey });
}

function wireSnookerFoulModal() {
  document.getElementById('snookerFoulCancel')?.addEventListener('click', closeSnookerFoulPicker);
  document.getElementById('snookerFoulBackdrop')?.addEventListener('click', closeSnookerFoulPicker);
}

function openPoolRespotPicker() {
  if (!controlsEnabled() || (lastState && lastState.gameScoringLocked)) return;
  const modal = document.getElementById('poolRespotModal');
  const container = document.getElementById('poolRespotTargets');
  const hint = document.getElementById('poolRespotHint');
  if (!modal || !container) return;

  const snapshot = lastState && lastState.ballGrid;
  const faded = (snapshot && Array.isArray(snapshot.balls) ? snapshot.balls : [])
    .filter((b) => b && !b.hidden && b.faded && !b.foul && !b.respot &&
      b.id !== 'poolFoulBtn' && b.id !== 'poolRespotBtn' && b.id !== 'snookerUndoBtn');
  container.innerHTML = '';
  if (hint) {
    hint.textContent = faded.length
      ? 'Choose a ball to return to the table (no score change)'
      : 'No potted balls to respot';
    hint.classList.toggle('hidden', !faded.length);
  }
  faded.forEach((b) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'foul-target-btn';
    btn.title = b.title || b.id;
    const img = document.createElement('img');
    img.src = resolveBallImageSrc(lastState || {}, b.id, b.file);
    img.alt = b.title || b.id;
    btn.appendChild(img);
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button === 0) {
        e.preventDefault();
      }
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectPoolRespot(b.id);
    });
    container.appendChild(btn);
  });
  modal.classList.remove('hidden');
}

function selectPoolRespot(ballId) {
  closePoolRespotPicker();
  if (ballId) sendCmd('respot_ball', { ballId });
}

function wirePoolRespotModal() {
  document.getElementById('poolRespotCancel')?.addEventListener('click', closePoolRespotPicker);
  document.getElementById('poolRespotBackdrop')?.addEventListener('click', closePoolRespotPicker);
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' && event.key !== 'Esc') return;
  if (!isScoringPickerOpen()) return;
  event.preventDefault();
  closeScoringPickers();
});

function getResetActionLabel(state = lastState) {
  return 'Restart Match';
}

/** Same rule as control_panel getRaceTarget / isGameScoringLocked. */
function getRaceTargetFromState(state) {
  return parseRaceTarget(state?.raceInfo, state?.gameType);
}

function isRaceCompleteFromState(state) {
  if (!state) return false;
  return isRaceLocked(state.p1Score, state.p2Score, getRaceTargetFromState(state));
}

/**
 * Match control_panel: one danger button morphs Restart Match ↔ End Match.
 * Call Match only when racks exist and the race is not complete.
 */
function syncMatchActionButtons(state) {
  // Same gate as control_panel isRaceComplete() / isGameScoringLocked()
  const locked = isRaceCompleteFromState(state);
  const canCall = !locked && state.canCallGame === true;
  // Prefer dock flag; fall back to local score/breaker heuristics.
  const canReset = state.canResetScores != null
    ? state.canResetScores === true
    : (locked ||
      (Number(state.p1Score) || 0) !== 0 ||
      (Number(state.p2Score) || 0) !== 0 ||
      (Number(state.p1Balls) || 0) !== 0 ||
      (Number(state.p2Balls) || 0) !== 0 ||
      !!(state.rackBreakerSlot));

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
    resetBtn.disabled = !canReset;
  }

  const callBtn = document.getElementById('callMatchBtn');
  if (callBtn) {
    callBtn.classList.toggle('hidden', !canCall);
    callBtn.disabled = !canCall;
  }
}

/**
 * Stream tab: account-owner OBS start/stop, plus monitoring/clips when available.
 */
function syncReplayPanel(state) {
  const monitoring = !!state.monitoringActive;
  const replayPlaying = !!state.replayPlaybackActive;
  const streaming = state.obsStreaming === true;
  // Monitoring implies OBS was usable; don't hide clips if obsConnected lagged false.
  const obsConnected = state.obsConnected === true || monitoring || replayPlaying || streaming;
  const clips = Array.isArray(state.replayClips)
    ? state.replayClips
    : Array.from({ length: 5 }, (_, i) => i < (Number(state.replayClipCount) || 0));

  const hint = document.getElementById('replayObsHint');
  if (hint) hint.classList.toggle('hidden', obsConnected);

  const streamBtn = document.getElementById('streamToggleBtn');
  if (streamBtn) {
    streamBtn.textContent = streaming ? 'Stop Streaming' : 'Start Streaming';
    streamBtn.classList.toggle('stream-active', streaming);
    streamBtn.disabled = !obsConnected;
  }

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
      monitorBtn.disabled = !obsConnected;
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
  const clipNum = (opts.index != null ? Number(opts.index) : 0) + 1;
  const copy = {
    reset_scores: {
      title: resetLabel,
      message: 'Restart this match and clear all scores? This cannot be undone from here.',
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
      message: `Remove Clip ${clipNum} from saved replay history? This cannot be undone from here. NOTE: This does not remove the video from the local machine, delete manually to restore space.`,
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

function fieldDiffersFromCommitted(el, committed) {
  if (!el) return false;
  return String(el.value ?? '').trim() !== String(committed ?? '').trim();
}

/** Keep local edits while dirty; clear dirty when dock state matches the input. */
function applyCommittedTextField(inputId, committed, dirty) {
  const el = document.getElementById(inputId);
  if (!el) return false;
  const next = String(committed ?? '');
  if (!dirty) {
    el.value = next;
    return false;
  }
  if (String(el.value ?? '').trim() === next.trim()) {
    el.value = next;
    return false;
  }
  return true;
}

function syncSaveIcons() {
  const raceBtn = document.getElementById('saveRaceBtn');
  const gameBtn = document.getElementById('saveGameInfoBtn');
  const canSend = controlsEnabled();
  if (raceBtn) {
    raceBtn.classList.toggle('save-pending', raceDirty);
    raceBtn.disabled = !raceDirty || !canSend;
  }
  if (gameBtn) {
    gameBtn.classList.toggle('save-pending', gameInfoDirty);
    gameBtn.disabled = !gameInfoDirty || !canSend;
  }
}

function controlLockMessage() {
  if (!connectionIsOpen()) return 'Not connected to cloud — controls are paused';
  if (!dockPresent) return 'Waiting for dock — controls are paused';
  return 'Controls are paused';
}

function sendCmd(action, payload) {
  if (!controlsEnabled()) {
    setError(controlLockMessage());
    return false;
  }
  const sent = client.sendCommand(action, payload);
  if (!sent) {
    setError('Failed to send command — check connection');
    if (action === 'select_breaker') clearCommandPending('select_breaker');
    if (action === 'set_game_type') clearPendingSetup('gameType');
    if (action === 'set_early_game_ball') clearPendingSetup('earlyGameBall');
    if (action === 'set_snooker_gold') clearPendingSetup('snookerGold');
    if (action === 'set_point_based') clearPendingSetup('pointBased');
    if (action === 'set_ball_selection') clearPendingSetup('ballSelection');
    return false;
  }
  return true;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseUtcDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let iso = raw;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    if (!/[zZ]$/.test(iso)) iso += 'Z';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalDate(value) {
  const d = parseUtcDate(value);
  if (!d) return value ? String(value) : '—';
  return d.toLocaleDateString();
}

function formatLocalDateTime(value) {
  const d = parseUtcDate(value);
  if (!d) return value ? String(value) : '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPlayerPreview(lastSeenAt) {
  if (!lastSeenAt) return 'Saved player';
  const local = formatLocalDate(lastSeenAt);
  if (!local || local === '—') return 'Saved player';
  return `Last seen ${local}`;
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
  const raceInput = document.getElementById('raceInput');
  const gameInfoInput = document.getElementById('gameInfoInput');
  raceInput?.addEventListener('input', () => {
    raceDirty = fieldDiffersFromCommitted(raceInput, lastState.raceInfo);
    syncSaveIcons();
  });
  gameInfoInput?.addEventListener('input', () => {
    gameInfoDirty = fieldDiffersFromCommitted(gameInfoInput, lastState.gameInfo);
    syncSaveIcons();
  });

  document.getElementById('saveRaceBtn').onclick = () => {
    if (!raceDirty || !controlsEnabled()) return;
    sendCmd('set_race', { value: raceInput?.value ?? '' });
  };
  document.getElementById('saveGameInfoBtn').onclick = () => {
    if (!gameInfoDirty || !controlsEnabled()) return;
    sendCmd('set_game_info', { value: gameInfoInput?.value ?? '' });
  };
  syncSaveIcons();

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
        if (isCommandPending('select_breaker')) return;
        markCommandPending('select_breaker', { slot: payload.slot, expectAfterSeq: lastStateSeq });
        // Disable buttons until dock state confirms — no optimistic local mutation.
        const slotP1 = document.getElementById('playerSlotP1Btn');
        const slotP2 = document.getElementById('playerSlotP2Btn');
        if (slotP1) slotP1.disabled = true;
        if (slotP2) slotP2.disabled = true;
        if (!sendCmd('select_breaker', { slot: payload.slot })) {
          if (slotP1) slotP1.disabled = false;
          if (slotP2) slotP2.disabled = false;
        }
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

async function connectGuestSession({ quiet, isCurrent }) {
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
    if (!isCurrent()) return;
    if (e.code === 'guest_revoked' || e.code === 'invalid_guest_token') {
      wantConnection = false;
      clearReconnectTimer();
      setReconnectBanner(false);
      show('controlSection', false);
      showMobileNav(false);
      show('connectingSection', false);
      setConnectionStatus('disconnected');
      setError('This guest link has been revoked.');
      return;
    }
    if (e.code === 'guest_link_in_use') {
      wantConnection = false;
      clearReconnectTimer();
      setReconnectBanner(false);
      show('connectingSection', false);
      setConnectionStatus('disconnected');
      setError(e.message || 'This guest link is already in use on another device.');
      return;
    }
    setError(e.message || e.code || 'Connection failed');
  });
  try {
    const joined = await client.connect();
    if (!isCurrent()) return;
    showControl();
    dockPresent = (joined.clients || []).includes('dock');
    if (joined.state && Object.keys(joined.state).length) {
      applyState(joined.state);
    } else {
      setActiveView('setup');
      initialViewChosen = false;
    }
    setConnectionStatus(dockPresent ? 'connected' : 'waiting');
    reconnectAttempt = 0;
    if (connectionIsOpen()) setReconnectBanner(false);
    else setReconnectBanner(true, 'Connection lost — tap Reconnect');
  } catch (err) {
    if (!isCurrent()) throw err;
    show('connectingSection', false);
    setConnectionStatus('disconnected');
    if (err?.code === 'guest_revoked' || err?.code === 'invalid_guest_token') {
      wantConnection = false;
      clearReconnectTimer();
      setReconnectBanner(false);
      setError('This guest link has been revoked.');
      return;
    }
    if (err?.code === 'guest_link_in_use') {
      wantConnection = false;
      clearReconnectTimer();
      setReconnectBanner(false);
      setError(err.message || 'This guest link is already in use on another device.');
      return;
    }
    if (quiet) {
      setReconnectBanner(true, 'Connection lost — tap Reconnect');
      throw err;
    }
    setError(err.message || 'Connection failed');
  }
}

async function connectAuthenticatedSession({ quiet, isCurrent }) {
  if (!roomId) {
    wantConnection = false;
    showLogin();
    setError('Room ID missing in URL (/m/{room_id})');
    return;
  }

  let token = localStorage.getItem(TOKEN_KEY);
  const secretEl = document.getElementById('devSecret');
  const secret = secretEl ? secretEl.value.trim() : '';

  if (secret) {
    try {
      const data = await devLogin(window.location.origin, secret);
      if (!isCurrent()) return;
      token = data.access_token;
      localStorage.setItem(TOKEN_KEY, token);
      syncLoginPanel();
    } catch (err) {
      if (!isCurrent()) return;
      forceRelogin(err.message || 'Login failed', { clearToken: true });
      return;
    }
  } else if (!token) {
    wantConnection = false;
    showLogin();
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
    if (!isCurrent()) return;
    if (e.code === 'session_revoked') {
      forceRelogin(reloginMessage(e), { clearToken: true });
      return;
    }
    if (e.code === 'invalid_token' || e.code === 'room_forbidden' || e.code === 'auth_required') {
      forceRelogin(reloginMessage(e), { clearToken: true });
      return;
    }
    if (e.code === 'control_connection_limit') {
      // Keep token — user can disconnect another device and retry.
      wantConnection = false;
      clearReconnectTimer();
      if (client) {
        try { client.disconnect(); } catch (_) { /* ignore */ }
        client = null;
      }
      dockPresent = false;
      setConnectionStatus('disconnected');
      setReconnectBanner(false);
      showLogin();
      setError(reloginMessage(e));
      return;
    }
    setError(e.message || e.code || 'Connection failed');
  });

  try {
    const joined = await client.connect();
    if (!isCurrent()) return;
    showControl();
    dockPresent = (joined.clients || []).includes('dock');
    if (joined.state && Object.keys(joined.state).length) {
      applyState(joined.state);
    } else if (!quiet) {
      // No dock state yet — start on Setup so names/game info can be prepared.
      setActiveView('setup');
      initialViewChosen = false;
    }
    setConnectionStatus(dockPresent ? 'connected' : 'waiting');
    reconnectAttempt = 0;
    if (connectionIsOpen()) setReconnectBanner(false);
    else {
      setReconnectBanner(true, 'Connection lost — tap Reconnect');
      scheduleReconnect();
    }
  } catch (err) {
    if (!isCurrent()) throw err;
    if (err?.code === 'control_connection_limit') {
      wantConnection = false;
      clearReconnectTimer();
      if (client) {
        try { client.disconnect(); } catch (_) { /* ignore */ }
        client = null;
      }
      dockPresent = false;
      setConnectionStatus('disconnected');
      setReconnectBanner(false);
      showLogin();
      setError(reloginMessage(err));
      return;
    }
    if (quiet) {
      // Transient drops must not wipe the saved login.
      dockPresent = false;
      setConnectionStatus('disconnected');
      setReconnectBanner(true, 'Connection lost — tap Reconnect');
      throw err;
    }
    // Network blips: keep token and offer Reconnect (do not bounce to login).
    if (isTransientConnectError(err) && localStorage.getItem(TOKEN_KEY)) {
      stayConnectedWithRetry('Connection lost — tap Reconnect');
      return;
    }
    forceRelogin(reloginMessage(err), { clearToken: shouldClearSavedLogin(err) });
  }
}

async function connect(options = {}) {
  const quiet = !!(options && options.quiet);
  const epoch = ++connectEpoch;
  setError('');
  const ctx = pathContext();
  guestToken = ctx.guestToken || '';
  isGuestMode = !!guestToken;
  roomId = ctx.roomId || '';
  wantConnection = true;
  if (quiet) {
    setReconnectBanner(true, 'Reconnecting…');
  } else {
    showConnecting();
    setReconnectBanner(false);
  }

  const isCurrent = () => epoch === connectEpoch;

  if (isGuestMode) {
    return connectGuestSession({ quiet, isCurrent });
  }
  return connectAuthenticatedSession({ quiet, isCurrent });
}

const select = document.getElementById('gameTypeSelect');
GAME_TYPES.forEach((g) => {
  const opt = document.createElement('option');
  opt.value = g.id;
  opt.textContent = g.label;
  select.appendChild(opt);
});

document.getElementById('connectBtn')?.addEventListener('click', connect);
document.getElementById('devSecret')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    connect();
  }
});

(function bindDevSecretToggle() {
  const input = document.getElementById('devSecret');
  const toggle = document.getElementById('devSecretToggle');
  if (!input || !toggle) return;
  const common = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const eyeOpen = `<svg ${common}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeClosed = `<svg ${common}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  function syncToggle() {
    const revealed = input.type === 'text';
    toggle.innerHTML = revealed ? eyeClosed : eyeOpen;
    toggle.setAttribute('aria-label', revealed ? 'Hide secret' : 'Show secret');
    toggle.setAttribute('aria-pressed', revealed ? 'true' : 'false');
    toggle.title = revealed ? 'Hide secret' : 'Show secret';
  }
  syncToggle();
  toggle.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    syncToggle();
    input.focus();
  });
}());

document.getElementById('clearTokenBtn')?.addEventListener('click', () => {
  if (!window.confirm('Clear Saved Login on this device? You will return to the main page to sign in again.')) return;
  wantConnection = false;
  clearReconnectTimer();
  localStorage.removeItem(TOKEN_KEY);
  try { client?.disconnect(); } catch (_) { /* ignore */ }
  client = null;
  window.location.href = '/';
});
document.getElementById('reconnectBtn')?.addEventListener('click', () => {
  ensureConnection({ force: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    connectionHiddenAt = Date.now();
    return;
  }
  if (!wantConnection || !bootConnectStarted) return;
  const awayMs = connectionHiddenAt ? Date.now() - connectionHiddenAt : 0;
  connectionHiddenAt = 0;
  // Event-driven only: force a fresh join after a long background (zombie sockets).
  ensureConnection({ force: awayMs >= 15000 || !connectionIsOpen() });
});

window.addEventListener('pageshow', (ev) => {
  if (!wantConnection || !bootConnectStarted) return;
  if (ev.persisted) ensureConnection({ force: true });
  else if (!document.hidden) ensureConnection();
});

window.addEventListener('online', () => {
  if (wantConnection && bootConnectStarted) ensureConnection({ force: true });
});

wireCommands();
wireReplayClearButtons();
wireSetupPanel();
wirePlayerAutocomplete();
wireMatchConfirmModal();
wireSnookerFoulModal();
wirePoolRespotModal();
wireMobileNav();

function startBootConnect(message) {
  wantConnection = true;
  bootConnectStarted = true;
  show('connectingSection', false);
  show('loginSection', false);
  show('controlSection', true);
  showMobileNav(true);
  setConnectionStatus('disconnected');
  setReconnectBanner(true, message || 'Connecting…');
  ensureConnection({ force: true });
}

const boot = pathContext();
if (boot.guestToken) {
  startBootConnect('Connecting…');
} else if (localStorage.getItem(TOKEN_KEY) && boot.roomId) {
  // Single entry point — avoids racing pageshow against a parallel quiet connect.
  startBootConnect('Connecting…');
} else {
  showLogin();
}
