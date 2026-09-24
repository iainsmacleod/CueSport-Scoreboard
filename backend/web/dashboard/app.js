import {
  CloudClient,
  fetchPublicConfig,
  devLogin,
  fetchMe,
  fetchAccountStats,
  fetchPlayers,
  updateAccountMatch,
  deleteAccountMatch,
  renameAccountPlayer,
  deleteAccountPlayer,
  createApiKey,
  createImpromptuRoom,
  fetchApiKey,
  revokeApiKey,
  patchApiKey,
  deleteRoom,
  invalidateAllSessions,
  revokeAllGuestLinks,
  revokeAllApiKeys,
  fetchBillingPlans,
  startBillingCheckout,
  openBillingPortal,
  setSimulatedPlan,
  GAME_TYPES,
} from '../shared/cloud-client.js?v=8.3.0';
import {
  computeDurationSeconds,
  formatDurationSeconds,
  enrichRacksWithDuration,
  sumRackDurationSeconds,
} from '../shared/match-racks.js?v=8.0.0';
import {
  getStoredAccessToken,
  setStoredAccessToken,
  ensureSupabaseAuth,
  signInWithGoogleIdToken,
  adoptOAuthHashSession,
  getFreshAccessToken,
  signOutSupabaseSession,
} from '../shared/supabase-session.js?v=8.3.0';

const SERVER_KEY = 'cuesport_server';
const DASH_TAB_KEY = 'cuesport_dashboard_tab';
const DASH_TABS = new Set(['tables', 'stats', 'settings', 'account', 'admin']);

const DOCK_KEY_ROLE_LABELS = {
  administrator: 'Administrator',
  trusted_operator: 'Trusted Operator',
  operator: 'Operator',
};

const DOCK_KEY_ROLE_DESCRIPTIONS = {
  administrator: [
    'Write matches',
    'View all history',
    'Edit or delete any match',
    'Rename or delete players',
    'Share the table’s default guest QR',
    'Create additional guest links for this table',
  ],
  trusted_operator: [
    'Write matches',
    'View all history',
    'Edit or delete only matches this key recorded',
    'Share the table’s default guest QR',
    'Create additional guest links for this table',
  ],
  operator: [
    'Write matches',
    'View all history',
    'Cannot edit or delete recorded matches',
    'Can share/copy the table’s default guest QR',
    'Cannot create additional guest links',
  ],
};

function dockKeyRoleLabel(role) {
  return DOCK_KEY_ROLE_LABELS[role] || DOCK_KEY_ROLE_LABELS.trusted_operator;
}

function dockKeyRoleDescriptionItems(role) {
  return DOCK_KEY_ROLE_DESCRIPTIONS[role] || DOCK_KEY_ROLE_DESCRIPTIONS.trusted_operator;
}

function updateDockKeyRoleDescription(role) {
  const descEl = document.getElementById('dashCreateKeyRoleDesc');
  if (!descEl) return;
  const items = dockKeyRoleDescriptionItems(role || selectedDockKeyRole());
  descEl.innerHTML =
    '<strong class="dash-role-access-title">Access</strong>' +
    `<ul class="dash-role-access-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

let dashClient = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastTablesFingerprint = '';
let lastDashboardRooms = [];
let wantLiveFeed = false;
let lastQuota = null;
let statsData = null;
let statsLoaded = false;
let statsLoading = false;
let statsRefreshQueued = false;
let statsRefreshTimer = null;
let selectedPlayerKey = '';
/** When set, overview player filter matches this roster/player id exactly (autocomplete pick). */
let statsPlayerFilterId = '';
let playerRenameEditing = false;
let playerDetailOpponentFilter = '';
let playerDetailGameFilter = '';

/** Leaderboard: sort full dataset, then paginate (page UI appears when needed). */
const LEADERBOARD_PAGE_SIZE = 50;
/** Recent Matches: same page size; sort (via recentMatches) then paginate. */
const MATCHES_PAGE_SIZE = 50;
const LEADERBOARD_SORT_DEFAULTS = {
  name: 'asc',
  matches: 'desc',
  winPct: 'desc',
  racks: 'desc',
  dateAdded: 'desc',
  lastPlayed: 'desc',
};
let leaderboardSortKey = 'matches';
let leaderboardSortDir = 'desc';
let leaderboardPage = 1;
let matchesPage = 1;
/** Distinct non-empty gameInfo values from the loaded stats blob (event filter autocomplete). */
let cachedEventInfoOptions = [];
/** Expanded rack/frame breakdowns in match lists (collapsed by default). */
const expandedMatchRacks = new Set();
let isPlatformAdminUser = false;
/** Platform admin or self-host owner may simulate catalog plan limits. */
let canSimulatePlanUser = false;
let adminAccountsCache = [];
let adminSelectedId = '';
let adminSearchTimer = null;
/** Platform admin: empty = own account; `__all__` = every tenant; otherwise one tenant. */
let platformViewAccountId = '';
/** Sentinel for platform-admin cross-tenant Tables/Stats view. */
const PLATFORM_VIEW_ALL = '__all__';
let platformAccountsForFilter = [];
let ownDashboardRooms = [];
/** Near-live poll for platform-admin All accounts / other-tenant Tables view. */
const PLATFORM_TABLES_POLL_MS = 8000;
let platformTablesPollTimer = null;
let platformTablesPollInFlight = false;

function show(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
  if (id === 'dashboardSection') {
    document.body.classList.toggle('has-dash-nav', !!visible);
    const tabs = document.querySelector('.dash-tabs');
    if (tabs) {
      if (visible) tabs.removeAttribute('hidden');
      else tabs.setAttribute('hidden', '');
    }
  }
}

function finishDashboardBoot() {
  const boot = document.getElementById('dashboardBoot');
  if (!boot) return;
  boot.setAttribute('aria-busy', 'false');
  boot.classList.add('hidden');
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

let dashConfirmResolver = null;

/**
 * In-page confirm (more reliable than window.confirm on mobile / embedded browsers).
 * @returns {Promise<boolean>}
 */
function confirmDashAction({
  title = 'Confirm',
  message = '',
  messageHtml = '',
  confirmLabel = 'Confirm',
  danger = false,
} = {}) {
  const modal = document.getElementById('dashConfirmModal');
  const titleEl = document.getElementById('dashConfirmTitle');
  const msgEl = document.getElementById('dashConfirmMessage');
  const okBtn = document.getElementById('dashConfirmOkBtn');
  const cancelBtn = document.getElementById('dashConfirmCancelBtn');
  if (!modal || !okBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message || title));
  }
  if (dashConfirmResolver) {
    dashConfirmResolver(false);
    dashConfirmResolver = null;
  }
  if (titleEl) titleEl.textContent = title;
  if (msgEl) {
    if (messageHtml) {
      msgEl.innerHTML = messageHtml;
    } else {
      msgEl.textContent = message;
    }
  }
  const label = confirmLabel || 'Confirm';
  let okIcon = 'check';
  if (/revoke access/i.test(label)) okIcon = 'stopSign';
  else if (/remove|delete|revoke/i.test(label)) okIcon = 'trash';
  else if (/kick/i.test(label)) okIcon = 'kick';
  else if (/sign out/i.test(label)) okIcon = 'logOut';
  else if (/complimentary|gift|trial/i.test(label)) okIcon = 'gift';
  setDashActionButtonContent(okBtn, {
    icon: okIcon,
    label,
    title: label,
  });
  setDashActionButtonContent(cancelBtn, {
    icon: 'cancel',
    label: 'Cancel',
    title: 'Cancel',
  });
  okBtn.classList.toggle('danger', !!danger);
  okBtn.classList.toggle('primary', !danger);
  okBtn.classList.toggle('cancel', false);
  cancelBtn.classList.add('cancel');
  modal.classList.remove('hidden');
  okBtn.focus();
  return new Promise((resolve) => {
    dashConfirmResolver = resolve;
  });
}

function closeDashConfirm(result) {
  const modal = document.getElementById('dashConfirmModal');
  if (modal) modal.classList.add('hidden');
  const resolve = dashConfirmResolver;
  dashConfirmResolver = null;
  if (resolve) resolve(!!result);
}

let dockKeyModalMode = 'create';
let dockKeyModalKey = null;
let activeDockKeys = [];

function setDockKeyModalError(message = '') {
  const error = document.getElementById('dashCreateKeyError');
  if (!error) return;
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

function selectedDockKeyRole() {
  const select = document.getElementById('dashCreateKeyRole');
  return (select && select.value) || 'trusted_operator';
}

function setDockKeyRole(role) {
  const value = role || 'trusted_operator';
  const select = document.getElementById('dashCreateKeyRole');
  if (select) select.value = DOCK_KEY_ROLE_LABELS[value] ? value : 'trusted_operator';
  updateDockKeyRoleDescription(select?.value || 'trusted_operator');
}

function closeDockKeyModal() {
  const modal = document.getElementById('dashCreateKeyModal');
  if (modal) modal.classList.add('hidden');
  setDockKeyModalError('');
  dockKeyModalMode = 'create';
  dockKeyModalKey = null;
}

function openDockKeyModal({ mode = 'create', key = null } = {}) {
  const modal = document.getElementById('dashCreateKeyModal');
  const titleEl = document.getElementById('dashCreateKeyTitle');
  const hintEl = document.getElementById('dashCreateKeyHint');
  const nameWrap = document.getElementById('dashCreateKeyLabel')?.closest('.stats-filter');
  const roleWrap = document.getElementById('dashCreateKeyRoleWrap');
  const submit = document.getElementById('dashCreateKeySubmitBtn');
  const cancelBtn = document.getElementById('dashCreateKeyCancelBtn');
  const nameInput = document.getElementById('dashCreateKeyLabel');
  if (!modal) return;
  setDockKeyModalError('');
  const editing = mode === 'edit' || mode === 'role' || mode === 'rename';
  dockKeyModalMode = editing ? 'edit' : 'create';
  dockKeyModalKey = editing ? key : null;
  if (titleEl) {
    titleEl.textContent = editing
      ? `Edit Dock Key — ${key?.label || 'Dock Key'}`
      : 'Create Dock Key';
  }
  if (hintEl) {
    hintEl.textContent = editing
      ? 'Update the unique seat name/label and role. Remove a key and create a new one to replace a leaked secret.'
      : 'Choose a unique name for each seat. Remove a key and create a new one to replace a leaked secret.';
  }
  if (nameWrap) nameWrap.classList.remove('hidden');
  if (roleWrap) roleWrap.classList.remove('hidden');
  const submitLabel = editing ? 'Save' : 'Create';
  const submitIcon = editing ? 'save' : 'plus';
  if (submit) {
    submit.classList.add('save');
    submit.classList.remove('primary', 'danger', 'cancel');
  }
  if (cancelBtn) {
    cancelBtn.classList.add('cancel');
    cancelBtn.classList.remove('primary', 'danger', 'save');
  }
  setDashActionButtonContent(submit, {
    icon: submitIcon,
    label: submitLabel,
    title: submitLabel,
  });
  setDashActionButtonContent(cancelBtn, {
    icon: 'cancel',
    label: 'Cancel',
    title: 'Cancel',
  });
  if (nameInput) {
    nameInput.value = editing ? String(key?.label || '') : '';
  }
  setDockKeyRole(key?.role || 'trusted_operator');
  modal.classList.remove('hidden');
  nameInput?.focus();
  if (editing && nameInput) nameInput.select();
}

async function submitDockKeyModal() {
  const nameInput = document.getElementById('dashCreateKeyLabel');
  try {
    setError('');
    setDockKeyModalError('');
    const label = String(nameInput?.value || '').trim().slice(0, 40);
    if (!label) {
      setDockKeyModalError('Enter a name (1–40 characters) for this dock key.');
      nameInput?.focus();
      return;
    }
    const duplicateName = activeDockKeys.some((key) => (
      key.id !== dockKeyModalKey?.id
      && String(key.label || '').trim().toLowerCase() === label.toLowerCase()
    ));
    if (duplicateName) {
      setDockKeyModalError('Dock Key names must be unique within your account. Choose a different name.');
      nameInput?.focus();
      nameInput?.select();
      return;
    }
    const role = selectedDockKeyRole();
    if (dockKeyModalMode === 'edit') {
      if (!dockKeyModalKey?.id) return;
      const result = await patchApiKey(getServerUrl(), getToken(), dockKeyModalKey.id, {
        label,
        role,
      });
      closeDockKeyModal();
      if (result.api_keys) renderApiKeys(result.api_keys);
      if (result.rooms) {
        renderDebugRooms(result.rooms);
        renderTableCards(result.rooms);
      }
      if (!result.api_keys) await renderDashboard();
      return;
    }
    const created = await createApiKey(getServerUrl(), getToken(), label, role);
    closeDockKeyModal();
    if (created.quota) renderQuota(created.quota);
    await renderDashboard();
    if (created.key && created.label) {
      revealKeyInList(created.label, created.key);
    }
  } catch (err) {
    setDockKeyModalError(err.message || 'Could not save this Dock Key.');
  }
}

let keyCopyNoticeTimer = null;

function showKeyCopyNotice(msg) {
  const el = document.getElementById('keyCopyNotice');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
  if (keyCopyNoticeTimer) clearTimeout(keyCopyNoticeTimer);
  if (msg) {
    keyCopyNoticeTimer = setTimeout(() => {
      el.textContent = '';
      el.classList.add('hidden');
      keyCopyNoticeTimer = null;
    }, 2500);
  }
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

function revealKeyInList(labelPrefix, key) {
  if (!key || !labelPrefix) return;
  const row = [...document.querySelectorAll('#keyList .token-list-item')].find((el) => {
    const span = el.querySelector('.api-key-summary');
    return span && (span.dataset.summary || '').startsWith(`${labelPrefix} —`);
  });
  const span = row?.querySelector('.api-key-summary');
  if (span) revealApiKeyInSummary(span, key);
}

function getServerUrl() {
  const origin = (window.location.origin || '').replace(/\/$/, '');
  const saved = (localStorage.getItem(SERVER_KEY) || '').replace(/\/$/, '');
  // Always use the origin serving this page. A stale cuesport_server (old tunnel,
  // LAN IP, previous host) makes login hang or fail with no useful feedback on
  // phones — while a clean/incognito profile works because storage is empty.
  if (saved && saved !== origin) {
    try {
      localStorage.setItem(SERVER_KEY, origin);
    } catch (_) { /* ignore */ }
  }
  return origin || window.location.origin;
}

function getToken() {
  return getStoredAccessToken();
}

/** Clear the local dashboard session; optionally return to the public homepage. */
function localSignOut({ clearServer = false, redirectHome = false } = {}) {
  setStoredAccessToken('');
  const config = dashPublicConfigCache;
  if (config) {
    signOutSupabaseSession(config).catch(() => {});
  }
  if (clearServer) localStorage.removeItem(SERVER_KEY);
  wantLiveFeed = false;
  stopLiveFeed();
  stopPlatformTablesPolling();
  lastTablesFingerprint = '';
  lastAccount = null;
  lastDashboardRooms = [];
  ownDashboardRooms = [];
  statsData = null;
  statsLoaded = false;
  setPlatformAdminUi(false);
  setError('');
  try {
    window.google?.accounts?.id?.disableAutoSelect?.();
  } catch (_) { /* ignore */ }
  if (redirectHome) {
    window.location.assign('/');
    return;
  }
  show('loginSection', true);
  show('dashboardSection', false);
  if (dashPublicConfigCache) {
    initOfficialGoogleButton(dashPublicConfigCache).catch(() => {});
  }
}

function gameTypeLabel(id) {
  const g = GAME_TYPES.find((x) => x.id === id);
  return g ? g.label : (id || '—');
}

/** Match mobile Setup gate — placeholders mean the table still needs names. */
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

function formatTableCard(room, serverUrl) {
  const st = room.live_state || {};
  const p1 = st.player1Name || 'P1';
  const p2 = st.player2Name || 'P2';
  const dual = st.dualScoreMode || st.gameType === 'game8';
  const primaryLabel = st.primaryScoreLabel || (st.gameType === 'game8' ? 'Frames' : 'Racks');
  const secondaryRaw = st.secondaryScoreLabel || (st.gameType === 'game8' ? 'Points' : 'Balls');
  const secondaryLabel = /^points?$/i.test(String(secondaryRaw).trim())
    ? 'Current Point'
    : secondaryRaw;
  const scoreHtml = dual
    ? `<p class="table-score table-score-current">${st.p1Balls ?? 0} – ${st.p2Balls ?? 0} ${secondaryLabel}</p>` +
      `<p class="table-score table-score-primary">${st.p1Score ?? 0}–${st.p2Score ?? 0} ${primaryLabel}</p>`
    : `<p class="table-score">${st.p1Score ?? 0} – ${st.p2Score ?? 0}</p>`;
  const isImpromptu = room.kind === 'impromptu';
  const matchTitle = [
    gameTypeLabel(st.gameType),
    st.raceInfo ? `${st.raceLabel || 'Race'} ${st.raceInfo}` : null,
    st.gameInfo || null,
  ].filter(Boolean).join(' · ') || (isImpromptu && !st.gameType ? 'Ready to set up' : 'Match in progress');
  const controlUrl = (() => {
    const base = `${serverUrl.replace(/\/$/, '')}/m/${room.id}`;
    if (!isImpromptu) return base;
    // Only force Setup when names are still placeholders; otherwise open Control.
    const needsSetup = isDefaultPlayerName(st.player1Name) || isDefaultPlayerName(st.player2Name);
    return needsSetup ? `${base}?tab=setup` : base;
  })();

  const connectionName = isImpromptu
    ? (String(room.dock_label || room.label || '').trim() || 'Ad-hoc Table')
    : (String(room.api_key_label || room.dock_label || '').trim() || 'OBS Dock Connected');
  const accountEmail = String(room.account_email || room.accountEmail || '').trim();
  const adminOnline = !!(room.authority_connected || room.live);
  const guestOnline = !!room.guest_connected;
  let statusClass = 'offline';
  let statusLabel = connectionName;
  if (isImpromptu) {
    // Owner (Admin) wins over Guest when both are present — guests relay to authority.
    if (adminOnline) {
      statusClass = 'online';
      statusLabel = 'Ad-hoc · Admin';
    } else if (guestOnline) {
      statusClass = 'guest';
      statusLabel = 'Ad-hoc · Guest';
    } else {
      statusClass = 'offline';
      statusLabel = 'Ad-hoc · Ready';
    }
  } else {
    statusClass = room.dock_connected ? 'online' : 'offline';
  }

  const card = document.createElement('a');
  card.className = 'table-card panel' + (isImpromptu ? ' table-card-impromptu' : '');
  card.href = controlUrl;
  card.innerHTML = `
    <p class="table-status ${statusClass}">${escapeHtml(statusLabel)}</p>
    ${accountEmail ? `<p class="table-account-email">${escapeHtml(accountEmail)}</p>` : ''}
    <h3>${matchTitle}</h3>
    <p class="table-players">${p1} vs ${p2}</p>
    ${scoreHtml}
  `;
  return card;
}

function tablesFingerprint(rooms) {
  const active = (rooms || []).filter((room) => (
    room.kind === 'impromptu' || room.dock_connected || room.live
  ));
  return JSON.stringify(active.map((room) => ({
    id: room.id,
    kind: room.kind || 'dock',
    account_id: room.account_id || room.accountId || null,
    account_email: room.account_email || room.accountEmail || null,
    instance_key: room.instance_key || null,
    dock_label: room.dock_label || null,
    api_key_label: room.api_key_label || null,
    authority_connected: !!room.authority_connected,
    guest_connected: !!room.guest_connected,
    live_state: room.live_state || {},
  })));
}

let tablesSetupIndex = 0;
let tablesSetupTimer = null;
let tablesSetupPaused = false;

function renderTablesSetupCarousel() {
  const track = document.getElementById('tablesSetupTrack');
  const slides = Array.from(track?.querySelectorAll('.tables-setup-slide') || []);
  if (!track || !slides.length) return;
  tablesSetupIndex = (tablesSetupIndex + slides.length) % slides.length;
  track.style.transform = `translateX(-${tablesSetupIndex * 100}%)`;
  slides.forEach((slide, index) => {
    const active = index === tablesSetupIndex;
    slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    slide.toggleAttribute('inert', !active);
    const media = slide.querySelector('.tables-setup-media');
    if (media) media.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('#tablesSetupDots button').forEach((dot, index) => {
    dot.classList.toggle('active', index === tablesSetupIndex);
    dot.setAttribute('aria-selected', index === tablesSetupIndex ? 'true' : 'false');
  });
  const count = document.getElementById('tablesSetupStepCount');
  if (count) count.textContent = `Step ${tablesSetupIndex + 1} of ${slides.length}`;
}

function stopTablesSetupTimer() {
  if (tablesSetupTimer) clearInterval(tablesSetupTimer);
  tablesSetupTimer = null;
}

function startTablesSetupTimer() {
  stopTablesSetupTimer();
  const startRow = document.getElementById('tablesStartRow');
  if (tablesSetupPaused || !startRow || startRow.classList.contains('hidden')) return;
  tablesSetupTimer = setInterval(() => {
    tablesSetupIndex += 1;
    renderTablesSetupCarousel();
  }, 8000);
}

function setTablesSetupPaused(paused) {
  tablesSetupPaused = !!paused;
  document.querySelectorAll('.tables-setup-media').forEach((media) => {
    media.setAttribute('aria-pressed', tablesSetupPaused ? 'true' : 'false');
    media.setAttribute('aria-label', tablesSetupPaused ? 'Resume setup guide' : 'Pause setup guide');
  });
  document.querySelectorAll('.tables-setup-pause-indicator').forEach((indicator) => {
    indicator.classList.toggle('hidden', !tablesSetupPaused);
  });
  if (tablesSetupPaused) stopTablesSetupTimer();
  else startTablesSetupTimer();
}

function goToTablesSetupSlide(index) {
  tablesSetupIndex = index;
  renderTablesSetupCarousel();
  startTablesSetupTimer();
}

function setTablesOnboardingVisible(visible) {
  const startRow = document.getElementById('tablesStartRow');
  if (startRow) startRow.classList.toggle('hidden', !visible);
  if (visible) {
    renderTablesSetupCarousel();
    startTablesSetupTimer();
  } else {
    stopTablesSetupTimer();
  }
  syncCreateImpromptuCardState();
}

function formatCreateImpromptuCard() {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'table-card table-card-create panel';
  card.dataset.action = 'create-impromptu';
  card.innerHTML = `
    <span class="table-card-create-plus" aria-hidden="true">+</span>
    <span class="table-card-create-label">Create Ad-hoc Table</span>
    <span class="table-card-create-hint">No stream? Still track the match</span>
    <span class="table-card-create-detail">League nights, side tables, and multi-table events — score from phone without OBS.</span>
  `;
  applyImpromptuCreateCardContent(card);
  return card;
}

/** @returns {{ mode: 'create'|'needs_plan'|'at_limit'|'blocked', used?: number, max?: number, plan?: string }} */
function getImpromptuCreateGate() {
  if (isViewingOtherAccount()) return { mode: 'blocked' };
  const needsPlan = !!(lastAccount && lastAccount.needs_plan) && !isPlatformAdminUser;
  if (needsPlan) return { mode: 'needs_plan' };
  if (!lastQuota) return { mode: 'create' };
  if (lastQuota.platform_admin_unlimited || lastQuota.self_host_unrestricted) return { mode: 'create' };
  const limits = lastQuota.limits || {};
  const usage = lastQuota.usage || {};
  if (limits.maxImpromptuTables == null) return { mode: 'create' };
  const used = usage.impromptuTables || 0;
  const max = limits.maxImpromptuTables;
  if (used >= max) {
    const plan = String(lastQuota.tierDisplayName || lastAccount?.subscription_tier_display || 'your plan')
      .replace(/\s*\(simulated\)\s*$/i, '');
    return { mode: 'at_limit', used, max, plan };
  }
  return { mode: 'create', used, max };
}

function canCreateImpromptuTable() {
  return getImpromptuCreateGate().mode === 'create';
}

function applyImpromptuCreateCardContent(card, gate = getImpromptuCreateGate()) {
  if (!card) return;
  const plus = card.querySelector('.table-card-create-plus');
  const label = card.querySelector('.table-card-create-label');
  const hint = card.querySelector('.table-card-create-hint');
  const detail = card.querySelector('.table-card-create-detail');
  const isUpgrade = gate.mode === 'needs_plan' || gate.mode === 'at_limit';
  card.classList.toggle('table-card-create-upgrade', isUpgrade);
  card.dataset.action = isUpgrade ? 'upgrade-impromptu' : 'create-impromptu';

  if (gate.mode === 'needs_plan') {
    if (plus) plus.innerHTML = dashActionIcon('unlock');
    if (label) label.textContent = 'Choose a plan';
    if (hint) hint.textContent = 'Ad-hoc tables need an active subscription';
    if (detail) detail.textContent = 'Unlock cloud scoring seats, then create dockless tables from here.';
    card.title = 'Choose a plan to unlock ad-hoc tables';
    card.setAttribute('aria-label', 'Choose a plan to unlock ad-hoc tables');
    return;
  }

  if (gate.mode === 'at_limit') {
    if (plus) plus.innerHTML = dashActionIcon('unlock');
    if (label) label.textContent = 'Ad-hoc seats full';
    if (hint) hint.textContent = `${gate.used}/${gate.max} in use on ${gate.plan}`;
    if (detail) {
      detail.textContent =
        'End/Destroy an Ad-hoc match to free a seat, or upgrade for more ad-hoc tables.';
    }
    card.title = 'Ad-hoc limit reached — upgrade or free a seat';
    card.setAttribute('aria-label', 'Ad-hoc limit reached — upgrade or free a seat');
    return;
  }

  if (plus) plus.textContent = '+';
  if (label) label.textContent = 'Create Ad-hoc Table';
  if (hint) hint.textContent = 'No stream? Still track the match';
  if (detail) {
    detail.textContent =
      'League nights, side tables, and multi-table events — score from phone without OBS.';
  }
  card.title =
    'Create a dockless table for scoring without OBS — league nights, side tables, and multi-table events';
  card.setAttribute('aria-label', 'Create Ad-hoc Table');
}

function openSubscriptionUpgradePrompt() {
  setActiveDashTab(isPlatformAdminUser ? 'admin' : 'account');
  document.getElementById('accountSubscriptionSection')?.scrollIntoView?.({
    behavior: 'smooth',
    block: 'start',
  });
}

function syncCreateImpromptuCardState() {
  const gate = getImpromptuCreateGate();
  const blocked = gate.mode === 'blocked';
  document.querySelectorAll('.table-card-create').forEach((btn) => {
    applyImpromptuCreateCardContent(btn, gate);
    btn.disabled = blocked;
    btn.classList.toggle('is-disabled', blocked);
  });
}

function initTablesSetupCarousel() {
  const track = document.getElementById('tablesSetupTrack');
  const dots = document.getElementById('tablesSetupDots');
  const slides = Array.from(track?.querySelectorAll('.tables-setup-slide') || []);
  if (!track || !dots || !slides.length) return;
  slides.forEach((slide) => {
    const media = slide.querySelector('.tables-setup-media');
    if (!media) return;
    media.classList.add('carousel-click-pause-target');
    media.tabIndex = 0;
    media.setAttribute('role', 'button');
    media.setAttribute('aria-label', 'Pause setup guide');
    media.setAttribute('aria-pressed', 'false');
    const indicator = document.createElement('span');
    indicator.className = 'carousel-pause-indicator tables-setup-pause-indicator hidden';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 5h4v14H7V5zm6 0h4v14h-4V5z"/></svg><span>Paused</span>';
    media.appendChild(indicator);
    media.addEventListener('click', () => setTablesSetupPaused(!tablesSetupPaused));
    media.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setTablesSetupPaused(!tablesSetupPaused);
    });
  });
  dots.innerHTML = '';
  slides.forEach((slide, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Show step ${index + 1}: ${slide.dataset.setupTitle || ''}`);
    dot.addEventListener('click', () => goToTablesSetupSlide(index));
    dots.appendChild(dot);
  });
  document.getElementById('tablesSetupPrev')?.addEventListener('click', () => {
    goToTablesSetupSlide(tablesSetupIndex - 1);
  });
  document.getElementById('tablesSetupNext')?.addEventListener('click', () => {
    goToTablesSetupSlide(tablesSetupIndex + 1);
  });
  document.getElementById('tablesSetupCarousel')?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') goToTablesSetupSlide(tablesSetupIndex - 1);
    if (event.key === 'ArrowRight') goToTablesSetupSlide(tablesSetupIndex + 1);
  });
  document.getElementById('tablesSetupOpenKeysBtn')?.addEventListener('click', () => {
    setActiveDashTab('settings');
    document.getElementById('dockKeysPanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
  renderTablesSetupCarousel();
}

function renderTableCards(rooms) {
  const fp = tablesFingerprint(rooms);
  if (fp === lastTablesFingerprint) return;
  lastTablesFingerprint = fp;

  const container = document.getElementById('tableCards');
  container.innerHTML = '';
  const activeRooms = (rooms || []).filter((room) => (
    room.kind === 'impromptu' || room.dock_connected || room.live
  ));
  if (!activeRooms.length) {
    const viewingAnotherAccount = isViewingOtherAccount();
    setTablesOnboardingVisible(!viewingAnotherAccount);
    if (viewingAnotherAccount) {
      container.innerHTML = '<p class="hint">No docks or ad-hoc tables are currently active for this account.</p>';
    }
    syncCreateImpromptuCardState();
    return;
  }
  setTablesOnboardingVisible(false);
  activeRooms.forEach((room) => {
    container.appendChild(formatTableCard(room, getServerUrl()));
  });
  if (!isViewingOtherAccount()) {
    container.appendChild(formatCreateImpromptuCard());
  }
  syncCreateImpromptuCardState();
}

function formatComplimentaryUntil(trialEndsAt) {
  if (!trialEndsAt) return '—';
  const d = parseUtcDate(trialEndsAt);
  if (!d) return String(trialEndsAt);
  const active = d.getTime() > Date.now();
  return `${active ? 'Until' : 'Ended'} ${d.toLocaleString()}`;
}

function formatMoneyFromStripe(unitAmount, currency, interval) {
  if (unitAmount == null || !Number.isFinite(Number(unitAmount))) return null;
  const cur = String(currency || 'usd').toUpperCase();
  const amount = Number(unitAmount) / 100;
  let formatted;
  try {
    formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(amount);
  } catch {
    formatted = `$${amount.toFixed(2)}`;
  }
  const iv = String(interval || 'month').toLowerCase();
  if (iv === 'month') return `${formatted}/mo`;
  if (iv === 'year') return `${formatted}/yr`;
  return `${formatted}/${iv}`;
}

function formatBillingDate(iso) {
  if (!iso) return null;
  const d = parseUtcDate(iso) || new Date(iso);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isComplimentaryActive(account) {
  if (!account?.trial_ends_at) return false;
  if (account.is_complimentary === true) return true;
  const d = parseUtcDate(account.trial_ends_at);
  return !!(d && d.getTime() > Date.now());
}

function buildAccountPlanLineHtml(account, quota) {
  const display = quota?.tierDisplayName || account?.subscription_tier_display || account?.subscription_tier || '—';
  const platformUnlimited = !!(quota?.platform_admin_unlimited || (isPlatformAdminUser && quota?.limits?.maxApiKeys == null));
  const simulatedLabel = String(display).replace(/\s*\(simulated\)\s*$/i, '');

  if (quota?.self_host_unrestricted) {
    return 'Self-hosted deployment — unrestricted access (no subscription required)';
  }

  if (dashPublicConfigCache?.allowDevAuth && quota?.simulated_plan && quota.simulated_plan !== 'unrestricted') {
    return `Self-hosted — simulating ${escapeHtml(simulatedLabel)} limits`;
  }

  if (isPlatformAdminUser) {
    return platformUnlimited
      ? 'Platform admin — unrestricted quotas (no plan required)'
      : `Platform admin — simulating ${escapeHtml(simulatedLabel)} limits`;
  }

  if (isComplimentaryActive(account)) {
    const until = formatBillingDate(account.trial_ends_at) || formatComplimentaryUntil(account.trial_ends_at);
    const tierLabel = account.subscription_tier_display || display;
    return `Complimentary · ${escapeHtml(tierLabel)} · until ${escapeHtml(until)} <span class="hint">(no card / not billed)</span>`;
  }

  const summary = account?.billing_summary;
  const status = String(account?.subscription_status || '').toLowerCase();
  const stripeStatus = String(summary?.status || status).toLowerCase();
  const planName = summary?.planName || account?.subscription_tier_display || display;
  const priceLabel = formatMoneyFromStripe(summary?.unitAmount, summary?.currency, summary?.interval);

  if (stripeStatus === 'trialing' || account?.is_trialing) {
    const ends = formatBillingDate(summary?.trialEnd || summary?.currentPeriodEnd);
    const then = priceLabel ? ` · then ${escapeHtml(priceLabel)}` : '';
    const endBit = ends ? ` · ends ${escapeHtml(ends)}` : '';
    return `${escapeHtml(planName)} · Free trial${endBit}${then}`;
  }

  if (stripeStatus === 'active' || stripeStatus === 'past_due' || account?.stripe_subscription_id) {
    const renews = formatBillingDate(summary?.currentPeriodEnd);
    const priceBit = priceLabel ? ` · ${escapeHtml(priceLabel)}` : '';
    if (stripeStatus === 'past_due') {
      return `${escapeHtml(planName)}${priceBit} · payment past due`;
    }
    const renewBit = renews ? ` · renews ${escapeHtml(renews)}` : '';
    return `${escapeHtml(planName)}${priceBit}${renewBit}`;
  }

  if (account?.needs_plan) {
    return 'Inactive — choose a plan in <a href="#billingPanel" class="dash-account-link">Account</a> to unlock Cloud';
  }

  return `Plan: ${escapeHtml(display)}`;
}

function renderQuota(quota, account = null) {
  lastQuota = quota || null;
  const el = document.getElementById('quotaSummary');
  const planLine = document.getElementById('accountPlanLine');
  const hint = document.getElementById('apiKeyLimitHint');
  const createBtn = document.getElementById('createKeyBtn');
  if (!quota) {
    if (el) el.textContent = '';
    if (planLine) planLine.textContent = '';
    if (hint) hint.classList.add('hidden');
    if (createBtn) createBtn.disabled = false;
    syncCreateImpromptuCardState();
    return;
  }
  const { tier, tierDisplayName, limits, usage } = quota;
  const display = tierDisplayName || tier;
  const needsPlan = !!(account && account.needs_plan);
  const platformUnlimited = !!(quota.platform_admin_unlimited || (isPlatformAdminUser && limits.maxApiKeys == null));
  if (planLine) {
    planLine.innerHTML = buildAccountPlanLineHtml(account, quota);
  }
  if (el) {
    el.classList.toggle('hidden', needsPlan);
    if (needsPlan) {
      el.textContent = '';
    } else if (platformUnlimited || limits.maxApiKeys == null) {
      el.textContent =
        `Dock seats (keys) ${usage.apiKeys} · Ad-hoc ${usage.impromptuTables || 0} · Mobile/guest unrestricted per table`;
    } else {
      el.textContent =
        `Dock seats (keys) ${usage.apiKeys}/${limits.maxApiKeys} · ` +
        `Ad-hoc ${usage.impromptuTables || 0}/${limits.maxImpromptuTables ?? '—'} · ` +
        `Mobile/guest up to ${limits.maxControlConnectionsPerRoom} per table`;
    }
  }
  const atKeyLimit = !platformUnlimited
    && limits.maxApiKeys != null
    && usage.apiKeys >= limits.maxApiKeys;
  const blocked = (!isPlatformAdminUser && needsPlan) || atKeyLimit;
  if (createBtn) createBtn.disabled = blocked;
  syncCreateImpromptuCardState();
  if (hint) {
    if (isPlatformAdminUser && !atKeyLimit) {
      hint.classList.add('hidden');
    } else if (needsPlan && !isPlatformAdminUser) {
      hint.textContent = 'Choose a plan on the Tables tab (or under Account) to unlock OBS Dock Keys.';
      hint.classList.remove('hidden');
    } else if (atKeyLimit) {
      hint.textContent = `Dock key limit reached (${limits.maxApiKeys} on ${display}). Each key connects one dock — remove an unused key to create another.`;
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }
}

function syncSimulatedPlanSelect(me) {
  const wrap = document.getElementById('simulatedPlanWrap');
  const select = document.getElementById('simulatedPlanSelect');
  const canSimulate = !!(
    me?.can_simulate_plan
    || me?.is_platform_admin
    || isPlatformAdminUser
    || canSimulatePlanUser
    || dashPublicConfigCache?.allowDevAuth
  );
  if (typeof me?.can_simulate_plan === 'boolean') {
    canSimulatePlanUser = me.can_simulate_plan;
  } else if (me?.is_platform_admin || dashPublicConfigCache?.allowDevAuth) {
    canSimulatePlanUser = true;
  }
  wrap?.classList.toggle('hidden', !canSimulate);
  document.getElementById('simulatedPlanHint')?.classList.toggle('hidden', !canSimulate);
  if (!canSimulate || !select) return;
  const options = Array.isArray(me?.simulated_plan_options) && me.simulated_plan_options.length
    ? me.simulated_plan_options
    : [
      { id: 'unrestricted', label: 'Unrestricted' },
      { id: 'streamer', label: 'Streamer' },
      { id: 'tournament_organizer', label: 'Tournament Organizer' },
      { id: 'league_director', label: 'League Director' },
      { id: 'network_organization', label: 'Network Organization' },
    ];
  const selected = me?.account?.simulated_plan
    || me?.quota?.simulated_plan
    || 'unrestricted';
  select.innerHTML = options.map((opt) =>
    `<option value="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</option>`
  ).join('');
  select.value = options.some((o) => o.id === selected) ? selected : 'unrestricted';
}

async function onSimulatedPlanChange(event) {
  const select = event?.target;
  if (!select || !canSimulatePlanUser) return;
  const tier = select.value || 'unrestricted';
  try {
    const result = await setSimulatedPlan(getServerUrl(), getToken(), tier);
    if (lastAccount) {
      lastAccount.simulated_plan = result.simulated_plan || tier;
    }
    if (result.quota) renderQuota(result.quota, lastAccount);
    syncSimulatedPlanSelect({
      can_simulate_plan: true,
      is_platform_admin: isPlatformAdminUser,
      account: { simulated_plan: result.simulated_plan || tier },
      quota: result.quota,
      simulated_plan_options: null,
    });
    const me = await fetchMe(getServerUrl(), getToken()).catch(() => null);
    if (me) {
      lastAccount = { ...lastAccount, ...(me.account || {}) };
      if (me.quota) renderQuota(me.quota, lastAccount);
      syncSimulatedPlanSelect(me);
    }
  } catch (err) {
    setError(err.message || 'Could not update simulated plan');
    await renderDashboard();
  }
}

let lastAccount = null;
let lastBillingCatalog = null;

function setBillingNotice(msg) {
  const els = [
    document.getElementById('billingNotice'),
    document.getElementById('tablesBillingNotice'),
  ].filter(Boolean);
  els.forEach((el) => {
    if (!msg) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = msg;
    el.classList.remove('hidden');
  });
}

function billingTermsAccepted() {
  return !!(
    document.getElementById('billingAcceptTerms')?.checked
    || document.getElementById('tablesBillingAcceptTerms')?.checked
  );
}

function buildNeedsPlanStatusText(account, plansPayload, streamerTrialDays, streamerPrice) {
  let planBit;
  if (streamerTrialDays != null) {
    const thenBit = streamerPrice
      ? ` After the trial you are charged ${streamerPrice} automatically unless you cancel.`
      : ' After the trial you are charged the Streamer monthly price automatically unless you cancel.';
    planBit = `Streamer includes a ${streamerTrialDays}-day free trial (card required at Checkout; cancel before it ends to avoid charges).${thenBit}`;
  } else if (plansPayload?.trialConfigured && plansPayload?.trialEligible === false) {
    planBit = streamerPrice
      ? `Streamer bills ${streamerPrice} immediately (free trial already used on this email).`
      : 'Streamer has no free trial left on this email — subscribe to continue.';
  } else if (streamerPrice) {
    planBit = `Streamer bills ${streamerPrice}.`;
  } else {
    planBit = 'Choose Streamer or another plan to continue.';
  }
  return `Your account has no Cloud access until you choose a plan. ${planBit} Tournament Organizer and League Director bill monthly immediately (no free trial).`;
}

function fillBillingPlanPicker(grid, account, billingMeta, plansPayload) {
  if (!grid) return;
  grid.innerHTML = '';
  const plans = plansPayload?.plans || [];
  plans.forEach((plan) => {
    const card = document.createElement('div');
    card.className = 'billing-plan-card';
    const isCurrent = account?.subscription_tier === plan.id
      && !account?.needs_plan
      && !isComplimentaryActive(account);
    if (isCurrent) {
      card.classList.add('is-current');
      const currentBadge = document.createElement('span');
      currentBadge.className = 'billing-plan-current-badge';
      currentBadge.textContent = 'Current plan';
      card.appendChild(currentBadge);
    }
    const limits = plan.limits || {};
    const h = document.createElement('h3');
    h.textContent = plan.displayName || plan.id;
    const p = document.createElement('p');
    p.className = 'billing-plan-limits';
    p.textContent =
      `${limits.maxApiKeys ?? '—'} dock keys · ${limits.maxImpromptuTables ?? '—'} ad-hoc tables · `
      + `up to ${limits.maxControlConnectionsPerRoom ?? '—'} mobile/guest per table`;
    card.appendChild(h);
    card.appendChild(p);

    const priceLabel = formatMoneyFromStripe(plan.unitAmount, plan.currency, plan.interval);
    if (priceLabel || plan.trialDays) {
      const priceEl = document.createElement('p');
      priceEl.className = 'billing-plan-price hint';
      if (plan.trialDays && priceLabel) {
        priceEl.textContent = `${plan.trialDays}-day free trial, then ${priceLabel}`;
      } else if (plan.trialDays) {
        priceEl.textContent = `${plan.trialDays}-day free trial (card required)`;
      } else if (priceLabel) {
        priceEl.textContent = priceLabel;
      }
      card.appendChild(priceEl);
    }

    if (plan.contact) {
      const a = document.createElement('a');
      a.className = 'btn secondary';
      a.textContent = 'Contact for pricing';
      let contactHref = String(plan.contactUrl || plansPayload?.contactUrl || '').trim();
      if (contactHref.startsWith('http://') || contactHref.startsWith('https://')) {
        contactHref = '';
      }
      if (contactHref && !contactHref.startsWith('mailto:') && contactHref.includes('@')) {
        contactHref = `mailto:${contactHref}`;
      }
      a.href = contactHref.startsWith('mailto:') ? contactHref : 'mailto:';
      card.appendChild(a);
    } else if (plan.checkout && billingMeta?.stripeConfigured) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      if (account?.needs_plan || isComplimentaryActive(account)) {
        btn.textContent = plan.trialDays ? 'Start free trial' : 'Subscribe';
      } else {
        btn.textContent = 'Switch / subscribe';
      }
      btn.addEventListener('click', () => checkoutTier(plan.id));
      card.appendChild(btn);
    } else {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Checkout unavailable on this server.';
      card.appendChild(note);
    }
    grid.appendChild(card);
  });
}

async function startPortal() {
  try {
    setBillingNotice('Opening billing portal…');
    const result = await openBillingPortal(getServerUrl(), getToken());
    if (result?.url) {
      window.location.href = result.url;
      return;
    }
    setBillingNotice('Billing portal did not return a URL.');
  } catch (err) {
    setBillingNotice(err.message || 'Could not open billing portal');
  }
}

async function checkoutTier(tierId) {
  if (!billingTermsAccepted()) {
    setBillingNotice('Accept the Terms of Service and Privacy Policy before checkout.');
    return;
  }
  try {
    setBillingNotice('Starting Checkout…');
    const result = await startBillingCheckout(getServerUrl(), getToken(), tierId, true);
    if (result?.url) {
      window.location.href = result.url;
      return;
    }
    setBillingNotice('Checkout did not return a URL.');
  } catch (err) {
    setBillingNotice(err.message || 'Checkout failed');
  }
}

const SUBSCRIBE_INTENT_KEY = 'cuesport_subscribe_tier';
const SUBSCRIBE_TIERS = new Set(['streamer', 'tournament_organizer', 'league_director']);

function clearSubscribeIntentFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('subscribe')) return;
  params.delete('subscribe');
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, '', next);
}

function readAndClearSubscribeIntent() {
  const params = new URLSearchParams(window.location.search);
  let tier = String(params.get('subscribe') || '').trim();
  clearSubscribeIntentFromUrl();
  if (!tier) {
    try {
      tier = String(sessionStorage.getItem(SUBSCRIBE_INTENT_KEY) || '').trim();
    } catch {
      tier = '';
    }
  }
  try {
    sessionStorage.removeItem(SUBSCRIBE_INTENT_KEY);
  } catch { /* ignore */ }
  if (!SUBSCRIBE_TIERS.has(tier)) return null;
  return tier;
}

async function consumeSubscribeIntent(account) {
  const tier = readAndClearSubscribeIntent();
  if (!tier) return;
  if (isPlatformAdminUser || account?.is_platform_admin) return;
  if (!account?.needs_plan && !isComplimentaryActive(account)) {
    setBillingNotice('You already have Cloud access. Use Manage Subscription if you need to change plans.');
    return;
  }
  setActiveDashTab('account');
  document.getElementById('accountSubscriptionSection')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const label = tier === 'streamer'
    ? 'Streamer'
    : tier === 'tournament_organizer'
      ? 'Tournament Organizer'
      : 'League Director';
  const ok = await confirmDashAction({
    title: `Continue with ${label}`,
    messageHtml:
      `Continue to Stripe Checkout for <strong>${escapeHtml(label)}</strong>?<br/><br/>`
      + 'By continuing you agree to the '
      + '<a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>'
      + ' and '
      + '<a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.',
    confirmLabel: tier === 'streamer' ? 'Agree & Start Trial' : 'Agree & Subscribe',
    danger: false,
  });
  if (!ok) {
    setBillingNotice('Checkout canceled. Choose a plan anytime under Account.');
    return;
  }
  const termsMain = document.getElementById('billingAcceptTerms');
  const termsTables = document.getElementById('tablesBillingAcceptTerms');
  if (termsMain) termsMain.checked = true;
  if (termsTables) termsTables.checked = true;
  await checkoutTier(tier);
}

function renderBillingPanel(account, billingMeta, plansPayload) {
  const panel = document.getElementById('billingPanel');
  const tablesPromo = document.getElementById('tablesBillingPromo');
  // Platform admins are not billed — access is via PLATFORM_ADMIN_EMAILS, not Stripe.
  const isAdmin = !!(isPlatformAdminUser || account?.is_platform_admin);
  const showBilling = !isAdmin && !!(
    billingMeta?.stripeConfigured
    || account?.needs_plan
    || account?.stripe_customer_id
    || isComplimentaryActive(account)
  );
  const showTablesPromo = !isAdmin && !!account?.needs_plan && !!billingMeta?.stripeConfigured;

  if (panel) panel.classList.toggle('hidden', !showBilling);
  if (tablesPromo) tablesPromo.classList.toggle('hidden', !showTablesPromo);

  if (!showBilling) {
    document.getElementById('manageBillingBtn')?.classList.add('hidden');
    if (!showTablesPromo) return;
  }

  lastBillingCatalog = plansPayload || lastBillingCatalog;
  const statusEl = document.getElementById('billingStatusLine');
  const tablesStatusEl = document.getElementById('tablesBillingStatusLine');
  const grid = document.getElementById('billingPlanPicker');
  const tablesGrid = document.getElementById('tablesBillingPlanPicker');
  const manageBtn = document.getElementById('manageBillingBtn');
  const termsLabel = document.getElementById('billingTermsLabel');
  const tablesTermsLabel = document.getElementById('tablesBillingTermsLabel');
  const display = account?.subscription_tier_display || account?.subscription_tier || '—';
  const status = account?.subscription_status || 'inactive';
  const streamerPlan = (plansPayload?.plans || []).find((p) => p.id === 'streamer');
  const trialEligible = plansPayload?.trialEligible !== false;
  const streamerTrialDays = trialEligible
    ? (streamerPlan?.trialDays ?? plansPayload?.trialDays ?? null)
    : null;
  const streamerPrice = formatMoneyFromStripe(streamerPlan?.unitAmount, streamerPlan?.currency, streamerPlan?.interval);

  let statusText = '';
  if (isComplimentaryActive(account)) {
    const until = formatBillingDate(account.trial_ends_at) || formatComplimentaryUntil(account.trial_ends_at);
    statusText = `Complimentary access until ${until} (${display}) — no card, not billed. You can still subscribe via Stripe below.`;
  } else if (account?.needs_plan) {
    statusText = buildNeedsPlanStatusText(account, plansPayload, streamerTrialDays, streamerPrice);
  } else if (account?.is_trialing) {
    const summary = account.billing_summary;
    const ends = formatBillingDate(summary?.trialEnd || summary?.currentPeriodEnd);
    const price = formatMoneyFromStripe(summary?.unitAmount, summary?.currency, summary?.interval);
    statusText = `Current: ${display} · Free trial${ends ? ` ends ${ends}` : ''}${price ? ` · then ${price}` : ''}. Manage payment methods and cancellation in the Stripe Customer Portal.`;
  } else {
    const summary = account.billing_summary;
    const price = formatMoneyFromStripe(summary?.unitAmount, summary?.currency, summary?.interval);
    const renews = formatBillingDate(summary?.currentPeriodEnd);
    statusText = `Current: ${display} (${status})${price ? ` · ${price}` : ''}${renews ? ` · renews ${renews}` : ''}. Manage payment methods and cancellation in the Stripe Customer Portal.`;
  }

  if (statusEl) statusEl.textContent = statusText;
  if (tablesStatusEl && showTablesPromo) tablesStatusEl.textContent = statusText;

  const canManage = !!(account?.stripe_customer_id && billingMeta?.stripeConfigured);
  manageBtn?.classList.toggle('hidden', !canManage);
  termsLabel?.classList.toggle('hidden', !billingMeta?.stripeConfigured);
  tablesTermsLabel?.classList.toggle('hidden', !billingMeta?.stripeConfigured);

  if (showBilling) fillBillingPlanPicker(grid, account, billingMeta, plansPayload);
  if (showTablesPromo) fillBillingPlanPicker(tablesGrid, account, billingMeta, plansPayload);
}

async function refreshBillingUi(account, billingMeta) {
  if (!account) return;
  if (isPlatformAdminUser || account.is_platform_admin) {
    renderBillingPanel(account, billingMeta, null);
    return;
  }
  let plansPayload = null;
  try {
    if (billingMeta?.stripeConfigured || account.needs_plan) {
      plansPayload = await fetchBillingPlans(getServerUrl(), getToken());
    }
  } catch (err) {
    setBillingNotice(err.message || 'Could not load plans');
  }
  renderBillingPanel(account, billingMeta, plansPayload);
}

function roomCleanupStatus(room) {
  if (room.kind === 'impromptu') {
    if (room.authority_connected || room.live) return 'admin';
    if (room.guest_connected) return 'guest';
    return 'ready';
  }
  if (room.dock_connected) return 'active';
  if (room.cleanup_after) return 'grace';
  if (!room.instance_key) return 'unmapped';
  return 'idle';
}

/** Title is the seat currently mapped to this table (OBS Dock Key N), or impromptu label. */
function connectionDisplayTitle(room) {
  if (room.kind === 'impromptu') {
    return String(room.dock_label || room.label || '').trim() || 'Ad-hoc Table';
  }
  const candidates = [
    room.api_key_label,
    room.dock_label,
    room.label,
  ].filter(Boolean);
  for (const name of candidates) {
    if (/^OBS Dock Key\s+\d+/i.test(String(name))) return String(name);
  }
  for (const name of candidates) {
    const n = String(name);
    if (n && n !== 'Main table' && n !== 'Default Room' && n !== 'Table' && n !== 'Connection' && n !== 'Unassigned connection') {
      return n;
    }
  }
  return 'Unassigned connection';
}

function renderDebugRooms(rooms) {
  const list = document.getElementById('debugRoomList');
  const empty = document.getElementById('debugRoomsEmpty');
  if (!list) return;
  list.innerHTML = '';
  const rows = rooms || [];
  if (empty) empty.classList.toggle('hidden', rows.length > 0);
  rows.forEach((room) => {
    const li = document.createElement('li');
    li.className = 'token-list-item debug-room-item';
    const isImpromptu = room.kind === 'impromptu';
    const status = roomCleanupStatus(room);
    const title = connectionDisplayTitle(room);
    const st = room.live_state || {};
    const gameInfo = String(st.gameInfo || '').trim();
    const meta = document.createElement('div');
    meta.className = 'debug-room-meta';

    const titleRow = document.createElement('div');
    titleRow.className = 'debug-room-title-row';
    const titleEl = document.createElement('strong');
    titleEl.className = 'debug-room-title';
    titleEl.textContent = title;
    titleRow.appendChild(titleEl);
    meta.appendChild(titleRow);

    const details = document.createElement('div');
    details.className = 'debug-room-details';
    if (isImpromptu) {
      details.innerHTML =
        `<span class="hint">Table UUID: ${escapeHtml(room.id)}</span>` +
        (gameInfo ? `<span>event: ${escapeHtml(gameInfo)}</span>` : '') +
        `<span>connection: ad-hoc</span>` +
        `<span>status: ${escapeHtml(status)}</span>` +
        `<span>guest links: ${Number(room.guest_link_count) || 0}</span>`;
    } else {
      details.innerHTML =
        `<span class="hint">OBS Dock UUID: ${escapeHtml(room.id)}</span>` +
        (gameInfo ? `<span>event: ${escapeHtml(gameInfo)}</span>` : '') +
        `<span>instance: ${escapeHtml(room.instance_key || '—')}</span>` +
        `<span>dock: ${room.dock_connected ? 'online' : 'offline'}</span>` +
        `<span>status: ${escapeHtml(status)}</span>` +
        `<span>last seen: ${escapeHtml(formatLocalDateTime(room.last_seen_at) || '—')}</span>` +
        (room.cleanup_after ? `<span>cleanup after: ${escapeHtml(formatLocalDateTime(room.cleanup_after))}</span>` : '') +
        `<span>guest links: ${Number(room.guest_link_count) || 0}</span>`;
    }
    meta.appendChild(details);

    const actions = document.createElement('div');
    actions.className = 'token-list-actions';
    const kickBtn = createDashActionButton({
      className: 'danger',
      icon: 'kick',
      label: 'Kick',
      title: isImpromptu
        ? 'Remove this ad-hoc table from the list'
        : 'Disconnect dock and remove from this list',
    });
    kickBtn.addEventListener('click', async () => {
      const ok = await confirmDashAction({
        title: isImpromptu ? 'Remove Ad-hoc Table' : 'Kick Connection',
        message: isImpromptu
          ? `Remove “${title}”?\n\n` +
            'The ad-hoc seat is freed. Completed match history is kept.'
          : `Kick “${title}”?\n\n` +
            'Clients disconnect and this connection is removed from the list. Completed match history is kept.',
        confirmLabel: isImpromptu ? 'Remove' : 'Kick',
        danger: true,
      });
      if (!ok) return;
      try {
        setError('');
        const result = await deleteRoom(getServerUrl(), getToken(), room.id);
        if (result.quota) renderQuota(result.quota);
        renderDebugRooms(result.rooms || []);
        renderTableCards(result.rooms || []);
        const notice = document.getElementById('debugRoomsNotice');
        if (notice) {
          notice.textContent = isImpromptu
            ? 'Ad-hoc table removed. Completed match history was kept.'
            : 'Connection kicked. Completed match history was kept.';
          notice.classList.remove('hidden');
        }
      } catch (err) {
        setError(err.message);
      }
    });
    actions.appendChild(kickBtn);
    li.appendChild(meta);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function apiKeySummaryText(k) {
  const when = formatLocalDateTime(k.created_at);
  const role = dockKeyRoleLabel(k.role);
  const name = String(k.label || 'OBS Dock Key');
  return when ? `${name} · ${role} — created ${when}` : `${name} · ${role}`;
}

const API_KEY_COPY_ICON_SVG =
  '<svg class="api-key-copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>' +
  '</svg>';

function findApiKeyViewBtn(labelEl) {
  return labelEl?.closest('.token-list-item')?.querySelector('.api-key-view-btn') || null;
}

function setApiKeyViewButtonState(viewBtn, revealed) {
  if (!viewBtn || viewBtn.disabled) return;
  setDashActionButtonContent(viewBtn, {
    icon: revealed ? 'eyeClosed' : 'eyeOpen',
    label: revealed ? 'Hide' : 'View',
    title: revealed ? 'Hide API key' : 'Show API key inline',
  });
}

/** Compact icon+label control (labels hide on narrow viewports). */
function dashActionIcon(kind) {
  const common = 'class="dash-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  if (kind === 'eyeOpen') {
    return `<svg ${common}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  if (kind === 'eyeClosed') {
    return `<svg ${common}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  }
  if (kind === 'refresh') {
    return `<svg ${common}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
  }
  if (kind === 'trash') {
    return `<svg ${common}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
  }
  if (kind === 'gift') {
    return `<svg ${common}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
  }
  if (kind === 'stopSign') {
    return `<svg ${common}><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
  }
  if (kind === 'save') {
    return `<svg ${common}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  }
  if (kind === 'cancel') {
    return `<svg ${common}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  }
  if (kind === 'clearFilters') {
    return `<svg ${common}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/><line x1="16.5" y1="8.5" x2="21.5" y2="13.5"/><line x1="21.5" y1="8.5" x2="16.5" y2="13.5"/></svg>`;
  }
  if (kind === 'plus') {
    return `<svg ${common}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  }
  if (kind === 'back') {
    return `<svg ${common}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
  }
  if (kind === 'key') {
    return `<svg ${common}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
  }
  if (kind === 'unlock') {
    return `<svg ${common}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
  }
  if (kind === 'kick') {
    return `<svg ${common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg>`;
  }
  if (kind === 'share') {
    return `<svg ${common}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
  }
  if (kind === 'edit') {
    return `<svg ${common}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  }
  if (kind === 'check') {
    return `<svg ${common}><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  if (kind === 'copy') {
    return `<svg ${common}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  }
  if (kind === 'mail') {
    return `<svg ${common}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  }
  if (kind === 'sms') {
    return `<svg ${common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  }
  if (kind === 'close') {
    return `<svg ${common}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
  if (kind === 'logIn') {
    return `<svg ${common}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
  }
  if (kind === 'logOut') {
    return `<svg ${common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
  }
  if (kind === 'chevronLeft') {
    return `<svg ${common}><polyline points="15 18 9 12 15 6"/></svg>`;
  }
  if (kind === 'chevronRight') {
    return `<svg ${common}><polyline points="9 18 15 12 9 6"/></svg>`;
  }
  return '';
}

function setDashActionButtonContent(btn, { icon, label, title, className }) {
  if (!btn) return;
  btn.classList.add('dash-action-btn');
  if (className) {
    String(className).split(/\s+/).filter(Boolean).forEach((c) => btn.classList.add(c));
  }
  const iconHtml = dashActionIcon(icon);
  const safeLabel = escapeHtml(label || '');
  btn.innerHTML = `${iconHtml}<span class="dash-action-label">${safeLabel}</span>`;
  if (title) {
    btn.title = title;
    btn.setAttribute('aria-label', title);
  } else if (label) {
    btn.setAttribute('aria-label', label);
  }
}

function createDashActionButton({ className = '', icon, label, title, type = 'button' }) {
  const btn = document.createElement('button');
  btn.type = type;
  btn.className = `btn dash-action-btn ${className}`.trim();
  setDashActionButtonContent(btn, { icon, label, title: title || label });
  return btn;
}

function revealApiKeyInSummary(labelEl, key) {
  if (!labelEl || !key) return;
  labelEl.dataset.revealedKey = key;
  labelEl.classList.add('is-revealed');
  labelEl.classList.remove('is-copied');
  labelEl.title = 'Click to copy';
  labelEl.setAttribute('role', 'button');
  labelEl.tabIndex = 0;
  labelEl.innerHTML =
    `<span class="api-key-value">OBS Dock Key: ${escapeHtml(key)}</span>${API_KEY_COPY_ICON_SVG}`;
  setApiKeyViewButtonState(findApiKeyViewBtn(labelEl), true);
}

function restoreApiKeySummary(labelEl, summaryText) {
  if (!labelEl) return;
  labelEl.textContent = summaryText || labelEl.dataset.summary || '';
  delete labelEl.dataset.revealedKey;
  labelEl.classList.remove('is-revealed', 'is-copied');
  labelEl.removeAttribute('title');
  labelEl.removeAttribute('role');
  labelEl.removeAttribute('tabindex');
  setApiKeyViewButtonState(findApiKeyViewBtn(labelEl), false);
}

async function copyRevealedApiKey(labelEl) {
  const key = labelEl?.dataset?.revealedKey;
  if (!key) return;
  const summary = labelEl.dataset.summary || labelEl.textContent;
  const ok = await copyTextToClipboard(key);
  if (!ok) {
    setError('Unable to copy automatically — select and copy the key manually.');
    return;
  }
  setError('');
  labelEl.classList.remove('is-revealed');
  labelEl.classList.add('is-copied');
  labelEl.removeAttribute('title');
  labelEl.removeAttribute('role');
  labelEl.removeAttribute('tabindex');
  delete labelEl.dataset.revealedKey;
  labelEl.textContent = 'Copied to clipboard';
  setApiKeyViewButtonState(findApiKeyViewBtn(labelEl), false);
  setTimeout(() => {
    restoreApiKeySummary(labelEl, summary);
  }, 1200);
}

function buildApiKeySharePayload(label, key) {
  const server = getServerUrl().replace(/\/$/, '');
  const seat = String(label || 'OBS Dock Key').trim() || 'OBS Dock Key';
  const subject = `OBS Dock Key — ${seat}`;
  const text =
    `OBS Dock Key — ${seat}\n\n` +
    `Key: ${key}\n` +
    `Server: ${server}\n\n` +
    'Paste the key into CueSport Scoreboard → Cloud Connection settings on the OBS dock. ' +
    'Each dock needs its own key.';
  return { subject, text, seat };
}

let pendingShareKey = null;

function closeDashShareKeyModal() {
  const modal = document.getElementById('dashShareKeyModal');
  if (modal) modal.classList.add('hidden');
  pendingShareKey = null;
}

function openDashShareKeyModal({ label, key }) {
  const modal = document.getElementById('dashShareKeyModal');
  const titleEl = document.getElementById('dashShareKeyTitle');
  const msgEl = document.getElementById('dashShareKeyMessage');
  const nativeBtn = document.getElementById('dashShareKeyNativeBtn');
  if (!modal || !key) return;
  pendingShareKey = buildApiKeySharePayload(label, key);
  if (titleEl) titleEl.textContent = `Share “${pendingShareKey.seat}”`;
  if (msgEl) {
    msgEl.textContent =
      'Send this OBS Dock Key by email, text, or your device share sheet. ' +
      'Rename the connection afterward so you remember who received it.';
  }
  if (nativeBtn) {
    nativeBtn.classList.toggle('hidden', typeof navigator.share !== 'function');
  }
  setDashActionButtonContent(nativeBtn, {
    icon: 'share',
    label: 'Share…',
    title: 'Share with device share sheet',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyEmailBtn'), {
    icon: 'mail',
    label: 'Email',
    title: 'Share by email',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeySmsBtn'), {
    icon: 'sms',
    label: 'Text',
    title: 'Share by text message',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyCopyBtn'), {
    icon: 'copy',
    label: 'Copy',
    title: 'Copy share text',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyCloseBtn'), {
    icon: 'close',
    label: 'Close',
    title: 'Close',
  });
  modal.classList.remove('hidden');
}

async function shareApiKeyViaChannel(channel) {
  if (!pendingShareKey) return;
  const { subject, text } = pendingShareKey;
  if (channel === 'native') {
    if (typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: subject, text });
      closeDashShareKeyModal();
    } catch (err) {
      if (err && err.name !== 'AbortError') setError(err.message || 'Share failed');
    }
    return;
  }
  if (channel === 'email') {
    window.location.href =
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    return;
  }
  if (channel === 'sms') {
    // iOS uses &body=, Android commonly accepts ?body=
    window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
    return;
  }
  if (channel === 'copy') {
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      setError('Unable to copy automatically — select and copy the key manually.');
      return;
    }
    setError('');
    showKeyCopyNotice('Share message copied to clipboard.');
    closeDashShareKeyModal();
  }
}

async function shareApiKey(k) {
  try {
    setError('');
    const data = await fetchApiKey(getServerUrl(), getToken(), k.id);
    const key = String(data.key || '').trim();
    if (!key) throw new Error('Key not available');
    // Prefer the native share sheet when available (same idea as guest links).
    if (typeof navigator.share === 'function') {
      const payload = buildApiKeySharePayload(k.label, key);
      try {
        await navigator.share({ title: payload.subject, text: payload.text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // Fall through to email/text modal if the sheet fails.
      }
    }
    openDashShareKeyModal({ label: k.label, key });
  } catch (err) {
    setError(err.message);
  }
}

function renderApiKeys(keys) {
  const keyList = document.getElementById('keyList');
  const revokeAllBtn = document.getElementById('revokeAllDockKeysBtn');
  activeDockKeys = Array.isArray(keys) ? keys : [];
  keyList.innerHTML = '';
  if (revokeAllBtn) revokeAllBtn.disabled = !activeDockKeys.length;
  activeDockKeys.forEach((k) => {
    const li = document.createElement('li');
    li.className = 'token-list-item';
    const label = document.createElement('span');
    const summary = apiKeySummaryText(k);
    label.className = 'api-key-summary';
    label.textContent = summary;
    label.dataset.summary = summary;
    const actions = document.createElement('div');
    actions.className = 'token-list-actions';

    label.addEventListener('click', () => {
      copyRevealedApiKey(label);
    });
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        copyRevealedApiKey(label);
      }
    });

    const viewBtn = createDashActionButton({
      className: 'secondary api-key-view-btn',
      icon: 'eyeOpen',
      label: 'View',
      title: k.viewable === false
        ? 'This key was created before viewable storage. Create a new key to view it later.'
        : 'Show API key inline',
    });
    viewBtn.disabled = k.viewable === false;
    viewBtn.addEventListener('click', async () => {
      if (label.dataset.revealedKey) {
        restoreApiKeySummary(label, label.dataset.summary);
        return;
      }
      try {
        setError('');
        const data = await fetchApiKey(getServerUrl(), getToken(), k.id);
        const key = String(data.key || '').trim();
        if (!key) throw new Error('Key not available');
        revealApiKeyInSummary(label, key);
      } catch (err) {
        setError(err.message);
      }
    });

    const shareBtn = createDashActionButton({
      className: 'secondary',
      icon: 'share',
      label: 'Share',
      title: k.viewable === false
        ? 'This key was created before viewable storage. Create a new key to share it.'
        : 'Share this dock key via email, text, or your device share sheet',
    });
    shareBtn.disabled = k.viewable === false;
    shareBtn.addEventListener('click', () => {
      shareApiKey(k);
    });

    const editBtn = createDashActionButton({
      className: 'secondary',
      icon: 'edit',
      label: 'Edit',
      title: 'Edit name/label and role',
    });
    editBtn.addEventListener('click', () => openDockKeyModal({ mode: 'edit', key: k }));

    const removeBtn = createDashActionButton({
      className: 'danger',
      icon: 'trash',
      label: 'Remove',
      title: 'Free this dock seat and disconnect any dock using it',
    });
    removeBtn.addEventListener('click', async () => {
      const ok = await confirmDashAction({
        title: 'Remove Dock Key',
        message:
          `Remove “${k.label}”?\n\n` +
          'This frees the seat. Any dock using this key will be disconnected.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      try {
        setError('');
        const result = await revokeApiKey(getServerUrl(), getToken(), k.id);
        if (result.quota) renderQuota(result.quota);
        if (Array.isArray(result.api_keys)) renderApiKeys(result.api_keys);
        if (Array.isArray(result.rooms)) {
          ownDashboardRooms = result.rooms;
          if (!isViewingOtherAccount()) {
            lastDashboardRooms = result.rooms;
            renderTableCards(result.rooms);
            renderDebugRooms(result.rooms);
          } else {
            renderDebugRooms(result.rooms);
          }
        }
        const kicked = Number(result.kicked) || 0;
        const notice = document.getElementById('keyRevokeNotice');
        if (notice) {
          const parts = ['Key removed'];
          if (kicked > 0) parts.push(`disconnected ${kicked} dock connection(s)`);
          if (result.room_deleted) parts.push('table removed from dashboard');
          notice.textContent = `${parts[0]}${parts.length > 1 ? ` — ${parts.slice(1).join('; ')}` : ''}.`;
          notice.classList.remove('hidden');
        }
        await renderDashboard();
      } catch (err) {
        setError(err.message);
      }
    });

    actions.appendChild(viewBtn);
    actions.appendChild(editBtn);
    actions.appendChild(shareBtn);
    actions.appendChild(removeBtn);
    li.appendChild(label);
    li.appendChild(actions);
    keyList.appendChild(li);
  });
}

function getActiveDashTab() {
  const active = document.querySelector('.dash-tab.active');
  return active?.dataset?.tab || 'tables';
}

function updatePlatformAccountFilterVisibility(which = getActiveDashTab()) {
  const filterBar = document.getElementById('platformAccountFilterBar');
  if (!filterBar) return;
  const showFilter = isPlatformAdminUser && (which === 'tables' || which === 'stats');
  filterBar.classList.toggle('hidden', !showFilter);
}

function setActiveDashTab(which) {
  if (!DASH_TABS.has(which)) which = 'tables';
  if (which === 'account' && isPlatformAdminUser) which = 'admin';
  if (which === 'admin' && !isPlatformAdminUser) which = 'account';
  localStorage.setItem(DASH_TAB_KEY, which);
  document.querySelectorAll('.dash-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === which);
  });
  show('tabTables', which === 'tables');
  show('tabStats', which === 'stats');
  show('tabSettings', which === 'settings');
  show('tabAccount', which === 'account');
  show('tabAdmin', which === 'admin');
  updatePlatformAccountFilterVisibility(which);
  syncPlatformTablesPolling();
  if (which === 'stats') {
    selectedPlayerKey = '';
    playerDetailOpponentFilter = '';
    playerDetailGameFilter = '';
    playerRenameEditing = false;
    // Use cache when warm; filter changes / mutations still force reload.
    loadAccountStats(false);
  }
  if (which === 'admin') {
    loadAdminAccounts();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function adminAuthHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function adminFetchJson(path, options = {}) {
  const base = getServerUrl().replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...adminAuthHeaders(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.error || body.message || `Request failed (${res.status})`);
    error.code = body.code || null;
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

function isViewingAllAccounts() {
  return !!(isPlatformAdminUser && platformViewAccountId === PLATFORM_VIEW_ALL);
}

function isViewingOtherAccount() {
  if (!isPlatformAdminUser || !platformViewAccountId) return false;
  if (platformViewAccountId === PLATFORM_VIEW_ALL) return true;
  return !!(lastAccount?.id && platformViewAccountId !== lastAccount.id);
}

function resolveForeignAccountEmail(entity = null) {
  if (!isViewingOtherAccount()) return '';
  const email = String(entity?.accountEmail || '').trim()
    || (isViewingAllAccounts() ? '' : getPlatformViewAccountLabel());
  if (!email || email === 'All accounts') return '';
  if (lastAccount?.email && email.toLowerCase() === String(lastAccount.email).toLowerCase()) {
    return '';
  }
  return email;
}

function withForeignAccountWarning(message, entity = null) {
  const email = resolveForeignAccountEmail(entity);
  if (!email) return message;
  return (
    `${message}\n\n` +
    `Warning: this data belongs to another account (${email}), not yours.`
  );
}

/**
 * Confirm a destructive or cross-tenant stats change.
 * Deletes always confirm; foreign-account edits also confirm with an ownership warning.
 */
async function confirmStatsMutation({
  title,
  message,
  confirmLabel,
  danger = false,
  entity = null,
  requireConfirm = true,
} = {}) {
  const foreignEmail = resolveForeignAccountEmail(entity);
  const needsConfirm = requireConfirm || !!foreignEmail;
  if (!needsConfirm) return true;
  return confirmDashAction({
    title: foreignEmail ? `${title} (other account)` : title,
    message: withForeignAccountWarning(message, entity),
    confirmLabel,
    danger,
  });
}

function getPlatformViewAccountLabel() {
  if (!isViewingOtherAccount()) return '';
  if (isViewingAllAccounts()) return 'All accounts';
  const hit = platformAccountsForFilter.find((a) => a.id === platformViewAccountId);
  return hit?.email || platformViewAccountId;
}

function updatePlatformAccountFilterHint() {
  const hint = document.getElementById('platformAccountFilterHint');
  if (!hint) return;
  if (!isPlatformAdminUser) {
    hint.textContent = '';
    return;
  }
  if (isViewingAllAccounts()) {
    hint.textContent =
      'Viewing All accounts — tables refresh every few seconds while this tab is open. You can edit or delete stats with confirmation (extra warning for other accounts). Separate from Dock Key roles and subscription tiers.';
    return;
  }
  if (isViewingOtherAccount()) {
    hint.textContent =
      `Viewing ${getPlatformViewAccountLabel()} — tables refresh every few seconds. Edits/deletes require confirmation and warn that this is not your account. Separate from Dock Key roles and subscription tiers.`;
    return;
  }
  hint.textContent = 'Platform admin: browse one customer or All accounts. Separate from Dock Key roles and subscription tiers.';
}

async function loadPlatformAccountFilterOptions() {
  if (!isPlatformAdminUser || !getToken()) return;
  const data = await adminFetchJson('/api/admin/accounts?limit=200');
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  platformAccountsForFilter = accounts;
  const select = document.getElementById('platformAccountFilter');
  if (!select) return;
  const ownId = lastAccount?.id || '';
  const ownEmail = lastAccount?.email || 'My account';
  const options = [
    `<option value="${PLATFORM_VIEW_ALL}">All accounts</option>`,
    `<option value="">My account (${escapeHtml(ownEmail)})</option>`,
  ];
  accounts
    .filter((a) => a && a.id && a.id !== ownId)
    .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
    .forEach((a) => {
      options.push(`<option value="${escapeHtml(a.id)}">${escapeHtml(a.email || a.id)}</option>`);
    });
  const previous = platformViewAccountId;
  select.innerHTML = options.join('');
  if (previous === PLATFORM_VIEW_ALL) {
    select.value = PLATFORM_VIEW_ALL;
    platformViewAccountId = PLATFORM_VIEW_ALL;
  } else if (previous === '') {
    select.value = '';
    platformViewAccountId = '';
  } else if (previous && accounts.some((a) => a.id === previous)) {
    select.value = previous;
    platformViewAccountId = previous;
  } else {
    select.value = PLATFORM_VIEW_ALL;
    platformViewAccountId = PLATFORM_VIEW_ALL;
  }
  updatePlatformAccountFilterHint();
}

async function applyPlatformAccountFilter(accountId) {
  platformViewAccountId = String(accountId || '').trim();
  if (platformViewAccountId && lastAccount?.id && platformViewAccountId === lastAccount.id) {
    platformViewAccountId = '';
  }
  const select = document.getElementById('platformAccountFilter');
  if (select) select.value = platformViewAccountId;
  updatePlatformAccountFilterHint();
  lastTablesFingerprint = '';
  selectedPlayerKey = '';
  playerDetailOpponentFilter = '';
  playerDetailGameFilter = '';
  playerRenameEditing = false;
  statsLoaded = false;
  statsData = null;
  leaderboardPage = 1;
  matchesPage = 1;
  await refreshTablesForCurrentView();
  syncPlatformTablesPolling();
  const statsTab = document.getElementById('tabStats');
  if (statsTab && !statsTab.classList.contains('hidden')) {
    await loadAccountStats(true);
  }
}

function needsPlatformTablesPolling() {
  if (!getToken() || !isPlatformAdminUser || document.hidden) return false;
  if (!isViewingOtherAccount()) return false;
  return getActiveDashTab() === 'tables';
}

function stopPlatformTablesPolling() {
  if (platformTablesPollTimer) {
    clearInterval(platformTablesPollTimer);
    platformTablesPollTimer = null;
  }
  platformTablesPollInFlight = false;
}

function syncPlatformTablesPolling() {
  if (!needsPlatformTablesPolling()) {
    stopPlatformTablesPolling();
    return;
  }
  if (platformTablesPollTimer) return;
  platformTablesPollTimer = setInterval(() => {
    if (!needsPlatformTablesPolling()) {
      stopPlatformTablesPolling();
      return;
    }
    if (platformTablesPollInFlight) return;
    platformTablesPollInFlight = true;
    refreshTablesForCurrentView({ silent: true })
      .catch(() => { /* ignore background poll errors */ })
      .finally(() => {
        platformTablesPollInFlight = false;
      });
  }, PLATFORM_TABLES_POLL_MS);
}

async function refreshTablesForCurrentView({ silent = false } = {}) {
  if (!getToken()) return;
  if (isViewingAllAccounts()) {
    try {
      const data = await adminFetchJson('/api/admin/tables?limit=200');
      lastDashboardRooms = data.rooms || [];
      renderTableCards(lastDashboardRooms);
      renderDebugRooms(ownDashboardRooms);
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to load all-account tables');
    }
    return;
  }
  if (isViewingOtherAccount()) {
    try {
      const data = await adminFetchJson(
        `/api/admin/accounts/${encodeURIComponent(platformViewAccountId)}/tables`
      );
      lastDashboardRooms = data.rooms || [];
      renderTableCards(lastDashboardRooms);
      renderDebugRooms(ownDashboardRooms);
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to load account tables');
    }
    return;
  }
  lastDashboardRooms = ownDashboardRooms || [];
  renderTableCards(lastDashboardRooms);
  renderDebugRooms(lastDashboardRooms);
}

async function resolvePlayersSearch(query, limit) {
  if (isViewingAllAccounts()) {
    const data = await adminFetchJson(
      `/api/admin/players?` +
      new URLSearchParams({ q: query || '', limit: String(limit || 8) }).toString()
    );
    return data.players || [];
  }
  if (isViewingOtherAccount()) {
    const data = await adminFetchJson(
      `/api/admin/accounts/${encodeURIComponent(platformViewAccountId)}/players?` +
      new URLSearchParams({ q: query || '', limit: String(limit || 8) }).toString()
    );
    return data.players || [];
  }
  return fetchPlayers(getServerUrl(), getToken(), query, limit);
}

function setAdminStatus(msg) {
  const el = document.getElementById('adminStatus');
  if (el) el.textContent = msg || '';
}

function mountAccountContentForRole() {
  const content = document.getElementById('accountContent');
  const destination = document.getElementById(
    isPlatformAdminUser ? 'adminAccountMount' : 'accountUserMount'
  );
  if (content && destination && content.parentElement !== destination) {
    destination.appendChild(content);
  }
}

function updateAccountDeploymentType() {
  const line = document.getElementById('accountDeploymentType');
  if (!line) return;
  const selfHosted = !!dashPublicConfigCache?.allowDevAuth;
  const showDeployment = !!dashPublicConfigCache && (isPlatformAdminUser || selfHosted);
  line.classList.toggle('hidden', !showDeployment);
  line.textContent = showDeployment
    ? `Deployment: ${dashPublicConfigCache.allowDevAuth ? 'Self-hosted' : 'Managed'}`
    : '';
}

function setPlatformAdminUi(enabled) {
  const wasAdmin = isPlatformAdminUser;
  isPlatformAdminUser = !!enabled;
  document.getElementById('dashAdminTabBtn')?.classList.toggle('hidden', !isPlatformAdminUser);
  document.getElementById('dashAccountTabBtn')?.classList.toggle('hidden', isPlatformAdminUser);
  mountAccountContentForRole();
  updateAccountDeploymentType();
  updatePlatformAccountFilterVisibility();
  if (!isPlatformAdminUser) {
    platformViewAccountId = '';
    platformAccountsForFilter = [];
    adminSelectedId = '';
    adminAccountsCache = [];
    const select = document.getElementById('platformAccountFilter');
    if (select) {
      select.innerHTML =
        `<option value="${PLATFORM_VIEW_ALL}">All accounts</option>` +
        '<option value="">My account</option>';
      select.value = PLATFORM_VIEW_ALL;
    }
    updatePlatformAccountFilterHint();
    syncSimulatedPlanSelect({
      can_simulate_plan: !!dashPublicConfigCache?.allowDevAuth,
      is_platform_admin: false,
    });
    const detail = document.getElementById('adminDetailPanel');
    if (detail) detail.classList.add('hidden');
    const activeAdmin = document.querySelector('.dash-tab.active[data-tab="admin"]');
    if (activeAdmin) setActiveDashTab('account');
  } else {
    if (!wasAdmin) platformViewAccountId = PLATFORM_VIEW_ALL;
    const activeAccount = document.querySelector('.dash-tab.active[data-tab="account"]');
    if (activeAccount) setActiveDashTab('admin');
    loadPlatformAccountFilterOptions().catch(() => {});
  }
  syncPlatformTablesPolling();
}

async function loadAdminAccounts() {
  if (!isPlatformAdminUser || !getToken()) return;
  const q = document.getElementById('adminAccountSearch')?.value?.trim() || '';
  setAdminStatus('Loading accounts…');
  try {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    const data = await adminFetchJson(`/api/admin/accounts${qs}`);
    adminAccountsCache = data.accounts || [];
    renderAdminAccountsTable();
    setAdminStatus(
      adminAccountsCache.length
        ? `${adminAccountsCache.length} account${adminAccountsCache.length === 1 ? '' : 's'}`
        : 'No accounts found'
    );
    if (adminSelectedId) {
      const stillThere = adminAccountsCache.some((a) => a.id === adminSelectedId);
      if (stillThere) await loadAdminAccountDetail(adminSelectedId);
      else closeAdminDetail();
    }
  } catch (err) {
    setAdminStatus(err.message || 'Failed to load accounts');
  }
}

function isOwnAdminAccount(accountId) {
  return !!(lastAccount?.id && accountId && lastAccount.id === accountId);
}

function formatAdminTierLabel(value) {
  if (!value) return '—';
  return String(value)
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function adminTierLabel(account) {
  if (account?.is_platform_admin) return 'Platform Admin';
  return formatAdminTierLabel(account?.subscription_tier_display || account?.subscription_tier);
}

function renderAdminAccountsTable() {
  const body = document.getElementById('adminAccountsBody');
  if (!body) return;
  if (!adminAccountsCache.length) {
    body.innerHTML = '<tr><td colspan="8">No accounts</td></tr>';
    return;
  }
  body.innerHTML = adminAccountsCache.map((a) => {
    const classes = [];
    if (a.id === adminSelectedId) classes.push('admin-row-selected');
    if (isOwnAdminAccount(a.id)) classes.push('admin-row-self');
    return `
    <tr data-admin-account-id="${escapeHtml(a.id)}" class="${classes.join(' ')}" tabindex="0">
      <td>${escapeHtml(a.email)}${isOwnAdminAccount(a.id) ? ' <span class="admin-self-badge">You</span>' : ''}</td>
      <td>${escapeHtml(a.subscription_status || '—')}</td>
      <td>${escapeHtml(adminTierLabel(a))}</td>
      <td>${escapeHtml(formatComplimentaryUntil(a.trial_ends_at))}</td>
      <td>${Number(a.api_key_count) || 0}</td>
      <td>${Number(a.dock_room_count) || 0}</td>
      <td>${Number(a.impromptu_room_count) || 0}</td>
      <td>${escapeHtml(a.last_activity_at ? formatLocalDate(a.last_activity_at) : '—')}</td>
    </tr>
  `;
  }).join('');
}

function closeAdminDetail() {
  adminSelectedId = '';
  const panel = document.getElementById('adminDetailPanel');
  if (panel) panel.classList.add('hidden');
  renderAdminAccountsTable();
}

async function loadAdminAccountDetail(accountId) {
  adminSelectedId = accountId;
  renderAdminAccountsTable();
  const panel = document.getElementById('adminDetailPanel');
  const title = document.getElementById('adminDetailTitle');
  const body = document.getElementById('adminDetailBody');
  if (!panel || !body) return;
  panel.classList.remove('hidden');
  body.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const [{ account, quota }, stats] = await Promise.all([
      adminFetchJson(`/api/admin/accounts/${encodeURIComponent(accountId)}`),
      adminFetchJson(`/api/admin/accounts/${encodeURIComponent(accountId)}/stats`).catch(() => null),
    ]);
    if (title) title.textContent = account.email || 'Account';
    const rooms = account.rooms || [];
    const keys = account.api_keys || [];
    const summary = stats?.summary || {};
    const isSelf = isOwnAdminAccount(account.id);
    const selfNote = isSelf
      ? `<p class="hint admin-self-note">This is your platform admin account. Support actions are disabled here — manage your sessions above and keys in Settings.</p>`
      : '';
    const trialBlock = isSelf
      ? ''
      : `
      <h3 class="stats-section-title">Complimentary access</h3>
      <p class="hint">Outside Stripe — no credit card, not billed. Grants Cloud access until the end date. Does not create a subscription. Revoking without an active Stripe plan also revokes all Dock Keys.</p>
      <form class="admin-trial-form" id="adminGrantTrialForm">
        <label>
          Tier
          <select id="adminComplimentaryTier" required>
            <option value="streamer">Streamer</option>
            <option value="tournament_organizer">Tournament Organizer</option>
            <option value="league_director">League Director</option>
          </select>
        </label>
        <label>
          Days (1–90)
          <input id="adminTrialDays" type="number" min="1" max="90" value="14" required />
        </label>
        <button type="submit" class="btn save dash-action-btn">Give Complimentary Access</button>
        <button type="button" class="btn danger dash-action-btn" id="adminEndTrialBtn">Revoke Complimentary Access</button>
      </form>`;
    const deleteBlock = isSelf
      ? ''
      : `
      <h3 class="stats-section-title">Delete Account</h3>
      <p class="hint">Permanently removes Cloud keys, tables, guest links, players, and match history. Any active Stripe subscription will be cancelled. This cannot be undone.</p>
      ${account.deletion_status === 'deleting'
        ? `<p class="error">A previous deletion attempt did not finish. The account remains locked.${account.deletion_error ? ` ${escapeHtml(account.deletion_error)}` : ''} Correct the service configuration and retry below.</p>`
        : ''}
      <form class="admin-delete-form" id="adminDeleteAccountForm">
        <label>
          Type ${escapeHtml(account.email)} to confirm
          <input id="adminDeleteConfirmEmail" type="email" autocomplete="off" required />
        </label>
        <label class="admin-delete-block-check">
          <input id="adminDeleteBlockEmail" type="checkbox" />
          <span>Block future signups from this email</span>
        </label>
        <label class="admin-delete-block-check">
          <input id="adminDeleteAllowTrial" type="checkbox" />
          <span>Allow this email another Streamer trial</span>
        </label>
        <button type="submit" class="btn danger dash-action-btn">Delete Account</button>
      </form>`;
    const invalidateBtn = isSelf
      ? ''
      : '<button type="button" class="btn secondary dash-action-btn" id="adminInvalidateSessionsBtn">Invalidate sessions</button>';
    const keyRows = keys.length
      ? keys.map((k) => `
          <li>
            <span>${escapeHtml(k.label || k.id)} · ${escapeHtml(k.role || '')}</span>
            ${isSelf ? '' : `<button type="button" class="btn danger dash-action-btn" data-admin-revoke-key="${escapeHtml(k.id)}">Revoke</button>`}
          </li>
        `).join('')
      : '<li class="hint">No active keys</li>';
    body.innerHTML = `
      ${selfNote}
      <div class="admin-detail-meta">
        <div><strong>Status:</strong> ${escapeHtml(account.subscription_status || '—')}</div>
        <div><strong>Tier:</strong> ${escapeHtml(adminTierLabel(account))}${
          account.is_platform_admin && account.subscription_tier
            ? ` <span class="hint">(billing field: ${escapeHtml(formatAdminTierLabel(account.subscription_tier))})</span>`
            : ''
        }</div>
        <div><strong>Complimentary:</strong> ${escapeHtml(formatComplimentaryUntil(account.trial_ends_at))}</div>
        <div><strong>Created:</strong> ${escapeHtml(account.created_at ? formatLocalDate(account.created_at) : '—')}</div>
        <div><strong>Quota:</strong> ${
          quota?.limits
            ? `${quota.usage?.apiKeys ?? 0}/${quota.limits.maxApiKeys == null ? '∞' : quota.limits.maxApiKeys} keys · `
              + `${quota.usage?.rooms ?? 0}/${quota.limits.maxRooms == null ? '∞' : quota.limits.maxRooms} OBS · `
              + `${quota.usage?.impromptuTables ?? 0}/${quota.limits.maxImpromptuTables == null ? '∞' : quota.limits.maxImpromptuTables} ad-hoc`
            : '—'
        }</div>
      </div>
      ${trialBlock}
      <div class="admin-detail-actions">
        <button type="button" class="btn secondary dash-action-btn" id="adminViewAccountDataBtn">View tables &amp; stats</button>
        ${invalidateBtn}
      </div>
      ${deleteBlock}
      <h3 class="stats-section-title">Dock keys</h3>
      <ul class="admin-key-list">
        ${keyRows}
      </ul>
      <h3 class="stats-section-title">Tables</h3>
      <ul class="admin-room-list">
        ${rooms.length ? rooms.map((r) => {
          const isImpromptu = r.kind === 'impromptu';
          const kindLabel = isImpromptu ? 'Ad-hoc' : 'OBS';
          const name = isImpromptu
            ? (r.label || r.dock_label || 'Ad-hoc Table')
            : (r.dock_label || r.label || r.id);
          const seen = isImpromptu
            ? (r.last_seen_at ? `Updated ${formatLocalDate(r.last_seen_at)}` : 'No recent activity')
            : (r.last_seen_at ? `Seen ${formatLocalDate(r.last_seen_at)}` : 'No dock seen');
          return `
          <li>
            <span><strong>${escapeHtml(kindLabel)}</strong> · ${escapeHtml(name)} · guests ${Number(r.guest_link_count) || 0}</span>
            <span class="hint">${escapeHtml(seen)}</span>
          </li>
        `;
        }).join('') : '<li class="hint">No tables</li>'}
      </ul>
      <h3 class="stats-section-title">Stats snapshot</h3>
      <div class="admin-stats-summary">
        <span><strong>${Number(summary.matches) || 0}</strong> matches</span>
        <span><strong>${Number(summary.players) || 0}</strong> players</span>
        <span><strong>${Number(summary.tables) || 0}</strong> tables</span>
      </div>
    `;
    const tierSelect = document.getElementById('adminComplimentaryTier');
    if (tierSelect && account.subscription_tier) {
      const t = String(account.subscription_tier);
      if (['streamer', 'tournament_organizer', 'league_director'].includes(t)) {
        tierSelect.value = t;
      }
    }
    setDashActionButtonContent(
      document.getElementById('adminGrantTrialForm')?.querySelector('button[type="submit"]'),
      {
        icon: 'gift',
        label: 'Give Complimentary Access',
        title: 'Give Complimentary Access',
      }
    );
    setDashActionButtonContent(document.getElementById('adminEndTrialBtn'), {
      icon: 'stopSign',
      label: 'Revoke Complimentary Access',
      title: 'Revoke Complimentary Access',
    });
    setDashActionButtonContent(
      document.getElementById('adminDeleteAccountForm')?.querySelector('button[type="submit"]'),
      { icon: 'trash', label: 'Delete Account', title: 'Delete Account' }
    );
  } catch (err) {
    body.innerHTML = `<p class="error">${escapeHtml(err.message || 'Failed to load account')}</p>`;
  }
}

async function adminGrantTrial(days, tier) {
  if (!adminSelectedId || isOwnAdminAccount(adminSelectedId)) return;
  await adminFetchJson(`/api/admin/accounts/${encodeURIComponent(adminSelectedId)}/trial`, {
    method: 'POST',
    body: JSON.stringify({ days, tier }),
  });
  await loadAdminAccounts();
}

async function adminEndTrial() {
  if (!adminSelectedId || isOwnAdminAccount(adminSelectedId)) return;
  const ok = await confirmDashAction({
    title: 'Revoke Complimentary Access',
    message: 'Clear complimentary access for this account? If they have no active Stripe subscription, all Dock Keys will be revoked and connected docks disconnected. Access falls back to Stripe status otherwise.',
    confirmLabel: 'Revoke Access',
    danger: true,
  });
  if (!ok) return;
  await adminFetchJson(`/api/admin/accounts/${encodeURIComponent(adminSelectedId)}/trial`, {
    method: 'DELETE',
  });
  await loadAdminAccounts();
}

async function adminInvalidateSelectedSessions() {
  if (!adminSelectedId || isOwnAdminAccount(adminSelectedId)) return;
  const ok = await confirmDashAction({
    title: 'Invalidate sessions',
    message:
      'Sign this account out everywhere (dashboard and account mobile sessions)?\n\n' +
      'All guest links will also be revoked and guest devices disconnected. OBS Dock Keys are not revoked.',
    confirmLabel: 'Invalidate',
    danger: true,
  });
  if (!ok) return;
  await adminFetchJson(`/api/admin/accounts/${encodeURIComponent(adminSelectedId)}/invalidate-sessions`, {
    method: 'POST',
  });
  setAdminStatus('Sessions invalidated (guests revoked)');
}

async function adminDeleteSelectedAccount(
  confirmEmail,
  blockFutureSignups,
  allowAnotherTrial,
  confirmActiveSubscription = false
) {
  if (!adminSelectedId || isOwnAdminAccount(adminSelectedId)) return false;
  const initialOk = confirmActiveSubscription || await confirmDashAction({
    title: 'Delete Account',
    message: 'Permanently delete this account and all of its Cloud data? This cannot be undone.',
    confirmLabel: 'Continue Deletion',
    danger: true,
  });
  if (!initialOk) return false;

  try {
    await adminFetchJson(`/api/admin/accounts/${encodeURIComponent(adminSelectedId)}/delete`, {
      method: 'POST',
      body: JSON.stringify({
        confirmEmail,
        blockFutureSignups,
        allowAnotherTrial,
        confirmActiveSubscription,
      }),
    });
  } catch (error) {
    if (error.code !== 'active_subscription_confirmation_required') throw error;
    const plans = (error.body?.subscriptions || [])
      .map((subscription) => `${subscription.planName || 'Stripe subscription'} (${subscription.status || 'active'})`)
      .join(', ');
    const confirmed = await confirmDashAction({
      title: 'Cancel Active Subscription and Delete',
      message: `This account still has active Stripe billing${plans ? `: ${plans}` : ''}.\n\nDeleting it will cancel billing immediately and permanently remove its Cloud data. Confirm once more to continue.`,
      confirmLabel: 'Cancel Billing & Delete',
      danger: true,
    });
    if (!confirmed) return false;
    return adminDeleteSelectedAccount(confirmEmail, blockFutureSignups, allowAnotherTrial, true);
  }

  const outcomes = [];
  if (blockFutureSignups) outcomes.push('blocked future signups from that email');
  if (allowAnotherTrial) outcomes.push('reset its Streamer trial eligibility');
  setAdminStatus(`Deleted ${confirmEmail}${outcomes.length ? ` and ${outcomes.join(' and ')}` : ''}.`);
  closeAdminDetail();
  await loadAdminAccounts();
  return true;
}

async function adminUnblockEmail(email) {
  const result = await adminFetchJson('/api/admin/account-blocks/unblock', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  setAdminStatus(result.unblocked
    ? `Future signups from ${email} are allowed again.`
    : `No signup block was found for ${email}.`);
}

async function adminRevokeKey(keyId) {
  if (!adminSelectedId || !keyId || isOwnAdminAccount(adminSelectedId)) return;
  const ok = await confirmDashAction({
    title: 'Revoke dock key',
    message: 'Revoke this dock key and disconnect any dock using it?',
    confirmLabel: 'Revoke',
    danger: true,
  });
  if (!ok) return;
  await adminFetchJson(
    `/api/admin/accounts/${encodeURIComponent(adminSelectedId)}/api-keys/${encodeURIComponent(keyId)}/revoke`,
    { method: 'POST' }
  );
  await loadAdminAccounts();
}

function parseUtcDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let iso = raw;
  // SQLite datetime('now') has no zone — treat as UTC.
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

function formatLocalTime(value) {
  const d = parseUtcDate(value);
  if (!d) return '';
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
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

function formatStatsDate(value) {
  if (!value) return '—';
  return formatLocalDate(value);
}

function formatStatsTime(value) {
  if (!value) return '';
  return formatLocalTime(value);
}

function formatMatchDuration(startedAt, completedAt, durationSeconds) {
  let secs = Number(durationSeconds);
  if (!Number.isFinite(secs) || secs < 0) {
    secs = computeDurationSeconds(startedAt, completedAt);
  }
  return formatDurationSeconds(secs);
}

function getMatchDurationSeconds(match) {
  if (!match) return null;
  let secs = Number(match.durationSeconds);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  secs = computeDurationSeconds(match.startedAt, match.completedAt);
  if (secs != null) return secs;
  return sumRackDurationSeconds(match);
}

/** Recent matches date cell: date / time / duration on separate lines. */
function matchDateCellHtml(value, options = {}) {
  const inProgress = !!options.inProgress;
  const duration = !inProgress
    ? formatMatchDuration(options.startedAt, options.completedAt, options.durationSeconds)
    : '';
  if (!value && !inProgress) {
    return '<span class="stats-match-date">—</span>';
  }
  if (inProgress) {
    const dateStr = value ? formatStatsDate(value) : 'In progress';
    const timeStr = value ? formatStatsTime(value) : '';
    return `<span class="stats-match-date">${escapeHtml(dateStr)}</span>` +
      (timeStr ? `<span class="stats-match-time">${escapeHtml(timeStr)}</span>` : '') +
      `<span class="stats-match-duration">Live</span>`;
  }
  const dateStr = formatStatsDate(value);
  const timeStr = formatStatsTime(value);
  return `<span class="stats-match-date">${escapeHtml(dateStr)}</span>` +
    (timeStr ? `<span class="stats-match-time">${escapeHtml(timeStr)}</span>` : '') +
    (duration ? `<span class="stats-match-duration">${escapeHtml(duration)}</span>` : '');
}

function winPct(won, lost, drawn = 0) {
  const total = (won || 0) + (lost || 0) + (drawn || 0);
  if (!total) return 0;
  return Math.round(((won || 0) / total) * 100);
}

function playerWinPct(player) {
  return winPct(player.gamesWon, player.gamesLost, player.gamesDrawn || 0);
}

function compareLeaderboardPlayers(a, b, key, dir) {
  const aPlayed = (Number(a.gamesWon) || 0) + (Number(a.gamesDrawn) || 0) + (Number(a.gamesLost) || 0) > 0;
  const bPlayed = (Number(b.gamesWon) || 0) + (Number(b.gamesDrawn) || 0) + (Number(b.gamesLost) || 0) > 0;
  // Zero-stat roster players always sit after ranked players, A→Z among themselves.
  if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
  if (!aPlayed && key !== 'name' && key !== 'dateAdded') {
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  }
  const mul = dir === 'asc' ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case 'name':
      cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
      break;
    case 'winPct':
      cmp = playerWinPct(a) - playerWinPct(b);
      if (!cmp) cmp = (a.gamesWon || 0) - (b.gamesWon || 0);
      break;
    case 'racks':
      cmp = (a.racksWon || 0) - (b.racksWon || 0);
      if (!cmp) cmp = (b.racksLost || 0) - (a.racksLost || 0);
      break;
    case 'lastPlayed':
      cmp = String(a.lastPlayedAt || '').localeCompare(String(b.lastPlayedAt || ''));
      break;
    case 'dateAdded':
      cmp = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      break;
    case 'matches':
    default:
      cmp = (a.gamesWon || 0) - (b.gamesWon || 0);
      if (!cmp) cmp = (a.gamesDrawn || 0) - (b.gamesDrawn || 0);
      if (!cmp) cmp = (a.racksWon || 0) - (b.racksWon || 0);
      break;
  }
  if (cmp) return cmp * mul;
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}

/** Standing in the current sort within the event/date scope (kept when name-filtering). */
function sortLeaderboardPlayers(players, key = leaderboardSortKey, dir = leaderboardSortDir) {
  const sortKey = LEADERBOARD_SORT_DEFAULTS[key] ? key : 'matches';
  const sortDir = dir === 'asc' ? 'asc' : 'desc';
  return players.slice().sort((a, b) => compareLeaderboardPlayers(a, b, sortKey, sortDir));
}

/** Sort the full list first, then slice — keeps page N correct when data grows. */
function paginateItems(items, page, pageSize) {
  const total = items.length;
  const size = Math.max(1, pageSize || LEADERBOARD_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / size) || 1);
  const safePage = Math.min(Math.max(1, page || 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: safePage,
    pageSize: size,
    totalPages,
    total,
    startIndex: total ? start : 0,
  };
}

function setLeaderboardSort(key) {
  if (!LEADERBOARD_SORT_DEFAULTS[key]) return;
  if (leaderboardSortKey === key) {
    leaderboardSortDir = leaderboardSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    leaderboardSortKey = key;
    leaderboardSortDir = LEADERBOARD_SORT_DEFAULTS[key];
  }
  leaderboardPage = 1;
  renderAccountStats();
}

function setLeaderboardPage(page) {
  leaderboardPage = Math.max(1, Number(page) || 1);
  renderAccountStats();
}

function setMatchesPage(page) {
  matchesPage = Math.max(1, Number(page) || 1);
  renderAccountStats();
}

/** Split leaderboard headers onto two lines for narrower columns. */
function leaderboardHeaderLines(label) {
  const raw = String(label || '').trim();
  const known = {
    Rank: ['Rank', ''],
    Player: ['Player', ''],
    'Matches W/D/L': ['Matches', 'W/D/L'],
    'Win %': ['Win', '%'],
    'Racks W/L': ['Racks', 'W/L'],
    'Date Added': ['Date', 'Added'],
    'Last Played': ['Last', 'Played'],
    'Last played': ['Last', 'Played'],
  };
  if (Object.prototype.hasOwnProperty.call(known, raw)) return known[raw];
  const idx = raw.lastIndexOf(' ');
  if (idx > 0) return [raw.slice(0, idx), raw.slice(idx + 1)];
  return [raw, ''];
}

function updateLeaderboardSortHeaders() {
  document.querySelectorAll('#statsLeaderboardTable thead th').forEach((th) => {
    const key = th.getAttribute('data-sort-key');
    const sortable = !!key && !!LEADERBOARD_SORT_DEFAULTS[key];
    const label = th.getAttribute('data-label')
      || th.textContent.replace(/[▲▼]\s*$/, '').trim();
    th.setAttribute('data-label', label);
    if (sortable) {
      const active = key === leaderboardSortKey;
      th.classList.toggle('is-sorted', active);
      th.setAttribute('aria-sort', active
        ? (leaderboardSortDir === 'asc' ? 'ascending' : 'descending')
        : 'none');
    } else {
      th.classList.remove('is-sorted');
      th.removeAttribute('aria-sort');
    }
    const arrow = sortable && key === leaderboardSortKey
      ? (leaderboardSortDir === 'asc' ? '▲' : '▼')
      : '';
    const [primary, secondary] = leaderboardHeaderLines(label);
    const secondaryHtml = secondary
      ? `<span class="stats-th-secondary">${escapeHtml(secondary)}</span>`
      : `<span class="stats-th-secondary stats-th-secondary-spacer" aria-hidden="true">&nbsp;</span>`;
    const arrowHtml = arrow
      ? `<span class="sort-arrow" aria-hidden="true">${arrow}</span>`
      : '';
    th.innerHTML = `<span class="stats-th-lines">` +
      `<span class="stats-th-primary">${escapeHtml(primary)}${arrowHtml}</span>` +
      secondaryHtml +
      `</span>`;
  });
}

function renderLeaderboardPager(pageInfo) {
  const pager = document.getElementById('statsLeaderboardPager');
  if (!pager) return;
  if (!pageInfo || pageInfo.total <= pageInfo.pageSize) {
    pager.classList.add('hidden');
    pager.innerHTML = '';
    return;
  }
  pager.classList.remove('hidden');
  const from = pageInfo.startIndex + 1;
  const to = Math.min(pageInfo.startIndex + pageInfo.items.length, pageInfo.total);
  pager.innerHTML = `
    <span class="stats-pager-label">Showing ${from}–${to} of ${pageInfo.total}</span>
    <button type="button" class="btn dash-action-btn" data-leaderboard-page="${pageInfo.page - 1}" ${pageInfo.page <= 1 ? 'disabled' : ''}>${dashActionIcon('chevronLeft')}<span class="dash-action-label">Previous</span></button>
    <span>Page ${pageInfo.page} / ${pageInfo.totalPages}</span>
    <button type="button" class="btn dash-action-btn" data-leaderboard-page="${pageInfo.page + 1}" ${pageInfo.page >= pageInfo.totalPages ? 'disabled' : ''}>${dashActionIcon('chevronRight')}<span class="dash-action-label">Next</span></button>
  `;
}

function renderMatchesPager(pageInfo) {
  const pager = document.getElementById('statsMatchesPager');
  if (!pager) return;
  if (!pageInfo || pageInfo.total <= pageInfo.pageSize) {
    pager.classList.add('hidden');
    pager.innerHTML = '';
    return;
  }
  pager.classList.remove('hidden');
  const from = pageInfo.startIndex + 1;
  const to = Math.min(pageInfo.startIndex + pageInfo.items.length, pageInfo.total);
  pager.innerHTML = `
    <span class="stats-pager-label">Showing ${from}–${to} of ${pageInfo.total}</span>
    <button type="button" class="btn dash-action-btn" data-matches-page="${pageInfo.page - 1}" ${pageInfo.page <= 1 ? 'disabled' : ''}>${dashActionIcon('chevronLeft')}<span class="dash-action-label">Previous</span></button>
    <span>Page ${pageInfo.page} / ${pageInfo.totalPages}</span>
    <button type="button" class="btn dash-action-btn" data-matches-page="${pageInfo.page + 1}" ${pageInfo.page >= pageInfo.totalPages ? 'disabled' : ''}>${dashActionIcon('chevronRight')}<span class="dash-action-label">Next</span></button>
  `;
}

function scoreLine(match) {
  if (isMatchInProgress(match) && !match.scores) return 'Live';
  if (!match.scores) return '—';
  return `${match.scores.p1 ?? 0}–${match.scores.p2 ?? 0}`;
}

function safeHttpUrl(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

/** Prefer match.streamUrl from stats API; fall back to live table state on dashboard. */
function resolveMatchStreamUrl(match) {
  const direct = safeHttpUrl(match && match.streamUrl);
  if (direct) return direct;
  const roomId = match && match.roomId;
  if (!roomId) return '';
  const room = (lastDashboardRooms || []).find((r) => r && r.id === roomId);
  return safeHttpUrl(room && room.live_state && room.live_state.streamUrl);
}

function scoreStackHtml(top, bottom) {
  return `<div class="stats-match-score-stack">` +
    `<span>${escapeHtml(String(top))}</span>` +
    `<span class="stats-match-score-sep" aria-hidden="true">-</span>` +
    `<span>${escapeHtml(String(bottom))}</span>` +
    `</div>`;
}

function scoreCellHtml(match, options = {}) {
  const inProgress = isMatchInProgress(match);
  if (inProgress && !match.scores) {
    const url = resolveMatchStreamUrl(match);
    if (url) {
      return `<a class="stats-match-live-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open stream">Live</a>`;
    }
    return '<span class="stats-match-live-label">Live</span>';
  }
  if (options.viewerRelative && options.playerKey) {
    const slot = matchPlayerSlot(match, options.playerKey);
    const isP1 = slot === '1';
    const own = isP1 ? (match.scores?.p1 ?? 0) : (match.scores?.p2 ?? 0);
    const opp = isP1 ? (match.scores?.p2 ?? 0) : (match.scores?.p1 ?? 0);
    return scoreStackHtml(own, opp);
  }
  if (!match.scores) return escapeHtml('—');
  return scoreStackHtml(match.scores.p1 ?? 0, match.scores.p2 ?? 0);
}

/** Prefer UUID identity; fall back to case-insensitive display name. */
function matchPlayerSlot(match, playerKey) {
  const key = String(playerKey || '').trim();
  if (!key || !match) return null;
  if (match.player1Id && match.player1Id === key) return '1';
  if (match.player2Id && match.player2Id === key) return '2';
  const lower = key.toLowerCase();
  if (String(match.player1Name || '').toLowerCase() === lower) return '1';
  if (String(match.player2Name || '').toLowerCase() === lower) return '2';
  return null;
}

/** Normalize stored winner / scores into a decisive result or draw. */
function resolveMatchResult(match) {
  const raw = match && match.winnerSlot != null ? String(match.winnerSlot) : '';
  if (raw === '1' || raw === '2') {
    return { winnerSlot: raw, isDraw: false };
  }
  if (raw === 'draw' || raw === 'tie' || raw === '0') {
    return { winnerSlot: null, isDraw: true };
  }
  const scores = match && match.scores;
  if (!scores || typeof scores !== 'object') {
    return { winnerSlot: null, isDraw: false };
  }
  const p1 = Number(scores.p1) || 0;
  const p2 = Number(scores.p2) || 0;
  if (p1 > p2) return { winnerSlot: '1', isDraw: false };
  if (p2 > p1) return { winnerSlot: '2', isDraw: false };
  return { winnerSlot: null, isDraw: true };
}

function formatMatchRecord(won, drawn, lost) {
  return `${won || 0}/${drawn || 0}/${lost || 0}`;
}

function completedMatches(data) {
  return (data.matches || []).filter((m) => m.status === 'completed' && m.startEventId);
}

/** Recent matches list: completed + still-active sessions (same idea as dock match history). */
function recentMatches(data) {
  return (data.matches || [])
    .filter((m) => !!m.startEventId)
    .slice()
    .sort((a, b) => {
      const aLive = isMatchInProgress(a) ? 1 : 0;
      const bLive = isMatchInProgress(b) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      const da = a.completedAt || a.startedAt || '';
      const db = b.completedAt || b.startedAt || '';
      return String(db).localeCompare(String(da));
    });
}

function isMatchInProgress(match) {
  return !!(match && match.status && match.status !== 'completed');
}

function statsFromMatches(matches) {
  const playerMap = new Map();
  function touch(id, name, meta = {}) {
    const display = String(name || '').trim();
    const key = String(id || '').trim() || display.toLowerCase();
    if (!key) return null;
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        id: key,
        name: display || key,
        gamesWon: 0,
        gamesDrawn: 0,
        gamesLost: 0,
        racksWon: 0,
        racksLost: 0,
        highestBreak: 0,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 0,
        ballsPotted: 0,
        fouls: 0,
        createdAt: null,
        lastPlayedAt: null,
        accountId: meta.accountId || null,
        accountEmail: meta.accountEmail || null,
      });
    } else {
      const existing = playerMap.get(key);
      if (display) existing.name = display;
      // Preserve All-accounts owner labels when rebuilding from matches.
      if (!existing.accountEmail && meta.accountEmail) existing.accountEmail = meta.accountEmail;
      if (!existing.accountId && meta.accountId) existing.accountId = meta.accountId;
    }
    return playerMap.get(key);
  }
  for (const match of matches) {
    const meta = {
      accountId: match.accountId || null,
      accountEmail: match.accountEmail || null,
    };
    const p1 = touch(match.player1Id, match.player1Name, meta);
    const p2 = touch(match.player2Id, match.player2Name, meta);
    if (!p1 || !p2) continue;

    if (match.scores && match.gameType !== 'game4') {
      const s1 = Number(match.scores.p1) || 0;
      const s2 = Number(match.scores.p2) || 0;
      p1.racksWon += s1;
      p1.racksLost += s2;
      p2.racksWon += s2;
      p2.racksLost += s1;
    }

    const result = resolveMatchResult(match);
    if (result.winnerSlot === '1' || result.winnerSlot === '2') {
      const winner = result.winnerSlot === '1' ? p1 : p2;
      const loser = result.winnerSlot === '1' ? p2 : p1;
      winner.gamesWon += 1;
      loser.gamesLost += 1;
    } else if (result.isDraw) {
      p1.gamesDrawn += 1;
      p2.gamesDrawn += 1;
    }

    p1.highestBreak = Math.max(p1.highestBreak, Number(match.highestBreakP1) || 0);
    p2.highestBreak = Math.max(p2.highestBreak, Number(match.highestBreakP2) || 0);
    p1.highestRun = Math.max(p1.highestRun, Number(match.highestRunP1) || 0);
    p2.highestRun = Math.max(p2.highestRun, Number(match.highestRunP2) || 0);
    p1.breakAndRuns += Number(match.breakAndRunsP1) || 0;
    p2.breakAndRuns += Number(match.breakAndRunsP2) || 0;
    p1.tableRuns += Number(match.tableRunsP1) || 0;
    p2.tableRuns += Number(match.tableRunsP2) || 0;
    p1.ballsPotted += Number(match.ballsP1) || 0;
    p2.ballsPotted += Number(match.ballsP2) || 0;
    p1.fouls += Number(match.foulsP1) || 0;
    p2.fouls += Number(match.foulsP2) || 0;
    const playedAt = match.completedAt || match.startedAt;
    if (playedAt) {
      if (!p1.lastPlayedAt || playedAt > p1.lastPlayedAt) p1.lastPlayedAt = playedAt;
      if (!p2.lastPlayedAt || playedAt > p2.lastPlayedAt) p2.lastPlayedAt = playedAt;
    }
  }
  const players = Array.from(playerMap.values());
  return { matches, players };
}

function getOverviewFilterState() {
  return {
    playerQuery: (document.getElementById('statsPlayerSearch')?.value || '').trim().toLowerCase(),
    playerId: String(statsPlayerFilterId || '').trim(),
    eventQuery: (document.getElementById('statsEventSearch')?.value || '').trim().toLowerCase(),
    dateFrom: String(document.getElementById('statsDateFrom')?.value || '').trim(),
    dateTo: String(document.getElementById('statsDateTo')?.value || '').trim(),
  };
}

/** Local calendar YYYY-MM-DD for comparing with <input type="date"> values. */
function matchDateLocalYmd(match) {
  const d = parseUtcDate(match?.completedAt || match?.startedAt);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Event + date scope (not player name) — ranking universe for Rank. */
function matchPassesScopeFilters(m, filters) {
  if (filters.eventQuery) {
    const info = String(m.gameInfo || '').toLowerCase();
    if (!info.includes(filters.eventQuery)) return false;
  }
  if (filters.dateFrom || filters.dateTo) {
    const ymd = matchDateLocalYmd(m);
    if (!ymd) return false;
    if (filters.dateFrom && ymd < filters.dateFrom) return false;
    if (filters.dateTo && ymd > filters.dateTo) return false;
  }
  return true;
}

/** Autocomplete pick → exact player id; free text → name substring. */
function matchPassesPlayerFilter(m, filters) {
  const playerId = String(filters?.playerId || '').trim();
  if (playerId) {
    return String(m.player1Id || '') === playerId || String(m.player2Id || '') === playerId;
  }
  const playerQuery = String(filters?.playerQuery || '').trim();
  if (!playerQuery) return true;
  return String(m.player1Name || '').toLowerCase().includes(playerQuery)
    || String(m.player2Name || '').toLowerCase().includes(playerQuery);
}

function playerMatchesOverviewPlayerFilter(p, filters) {
  const playerId = String(filters?.playerId || '').trim();
  if (playerId) return String(p?.id || '') === playerId;
  const playerQuery = String(filters?.playerQuery || '').trim();
  if (!playerQuery) return true;
  return String(p?.name || '').toLowerCase().includes(playerQuery);
}

function hasOverviewPlayerFilter(filters) {
  return !!(filters?.playerId || filters?.playerQuery);
}

function matchPassesOverviewFilters(m, filters = getOverviewFilterState()) {
  return matchPassesScopeFilters(m, filters) && matchPassesPlayerFilter(m, filters);
}

function rebuildEventInfoCache(data) {
  const set = new Set();
  for (const m of data?.matches || []) {
    const info = String(m.gameInfo || '').trim();
    if (info) set.add(info);
  }
  cachedEventInfoOptions = Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

function mergeRosterMetaIntoPlayers(filteredPlayers, dataPlayers) {
  const byServerId = new Map((dataPlayers || []).map((p) => [String(p?.id || ''), p]));
  const seen = new Set();
  for (const p of filteredPlayers || []) {
    const id = String(p?.id || '').trim();
    if (!id) continue;
    seen.add(id);
    const src = byServerId.get(id);
    if (!src) continue;
    if (!p.accountEmail && src.accountEmail) p.accountEmail = src.accountEmail;
    if (!p.accountId && src.accountId) p.accountId = src.accountId;
    p.createdAt = src.createdAt || p.createdAt || null;
  }
  return seen;
}

/**
 * Stats for the event/date scope (player name not applied).
 * Zero-stat roster players are included only when no event/date scope is active.
 */
function buildScopedStats(data, filters = getOverviewFilterState()) {
  const scopedMatches = completedMatches(data).filter((m) => matchPassesScopeFilters(m, filters));
  const scoped = statsFromMatches(scopedMatches);
  const seen = mergeRosterMetaIntoPlayers(scoped.players, data.players);
  const hasScope = !!(filters.eventQuery || filters.dateFrom || filters.dateTo);
  if (!hasScope) {
    for (const p of data.players || []) {
      const id = String(p?.id || '').trim();
      if (!id || seen.has(id)) continue;
      const played = (Number(p.gamesWon) || 0) + (Number(p.gamesDrawn) || 0) + (Number(p.gamesLost) || 0) > 0;
      if (played) continue;
      scoped.players.push({ ...p });
      seen.add(id);
    }
  }
  return scoped;
}

/** Scoped stats with optional player narrowing (matches + players). */
function applyStatsFilters(data) {
  const filters = getOverviewFilterState();
  const scoped = buildScopedStats(data, filters);
  if (!hasOverviewPlayerFilter(filters)) return scoped;
  return {
    matches: scoped.matches.filter((m) => matchPassesPlayerFilter(m, filters)),
    players: (scoped.players || []).filter((p) => playerMatchesOverviewPlayerFilter(p, filters)),
  };
}

function findStatsPlayer(playerId) {
  const key = String(playerId || '').trim();
  if (!key) return null;
  return (statsData?.players || []).find((p) => String(p.id) === key) || null;
}

function statsPlayerDisplayName(playerId, fallback = '') {
  const fromStats = findStatsPlayer(playerId);
  if (fromStats?.name) return fromStats.name;
  return fallback || playerId;
}

function setStatsRefreshBusy(busy) {
  const btn = document.getElementById('statsRefreshBtn');
  if (btn) btn.disabled = !!busy;
}

function resetOverviewFilterPages() {
  leaderboardPage = 1;
  matchesPage = 1;
}

function applyOverviewFiltersChanged() {
  selectedPlayerKey = '';
  resetOverviewFilterPages();
  syncStatsClearFiltersBtn();
  if (statsData) renderAccountStats();
}

function overviewFiltersActive(filters = getOverviewFilterState()) {
  return !!(
    filters.playerId
    || filters.playerQuery
    || filters.eventQuery
    || filters.dateFrom
    || filters.dateTo
  );
}

function syncStatsClearFiltersBtn() {
  const btn = document.getElementById('statsClearFiltersBtn');
  if (btn) btn.disabled = !overviewFiltersActive();
}

function clearOverviewFilters() {
  const player = document.getElementById('statsPlayerSearch');
  const event = document.getElementById('statsEventSearch');
  const from = document.getElementById('statsDateFrom');
  const to = document.getElementById('statsDateTo');
  if (player) player.value = '';
  if (event) event.value = '';
  if (from) from.value = '';
  if (to) to.value = '';
  statsPlayerFilterId = '';
  document.querySelectorAll('.stats-date-clear[data-clear-date]').forEach((btn) => {
    btn.hidden = true;
  });
  applyOverviewFiltersChanged();
}

/** Fill player search and stay on overview (do not open player detail).
 * Object with id → exact UUID filter; plain text → name substring. */
function applyPlayerNameFilter(playerOrName) {
  const input = document.getElementById('statsPlayerSearch');
  if (playerOrName && typeof playerOrName === 'object') {
    const label = String(playerOrName.name || '').trim().slice(0, 20);
    const id = String(playerOrName.id || '').trim();
    if (input) input.value = label;
    statsPlayerFilterId = id;
  } else {
    const label = String(playerOrName || '').trim().slice(0, 20);
    if (input) input.value = label;
    statsPlayerFilterId = '';
  }
  applyOverviewFiltersChanged();
}

function renderAccountStats() {
  const overview = document.getElementById('statsOverview');
  const detail = document.getElementById('statsPlayerDetail');
  if (selectedPlayerKey) {
    if (overview) overview.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
    renderPlayerDetail();
    return;
  }
  if (overview) overview.classList.remove('hidden');
  if (detail) detail.classList.add('hidden');

  const summaryEl = document.getElementById('statsSummary');
  const statusEl = document.getElementById('statsStatus');
  const boardBody = document.getElementById('statsLeaderboardBody');
  const matchBody = document.getElementById('statsMatchesBody');
  if (!summaryEl || !boardBody || !matchBody) return;

  if (!statsData) {
    summaryEl.innerHTML = '';
    boardBody.innerHTML = '<tr><td colspan="7" class="dash-stats-empty">No stats loaded.</td></tr>';
    matchBody.innerHTML = '<tr><td colspan="5" class="dash-stats-empty">No stats loaded.</td></tr>';
    updateLeaderboardSortHeaders();
    renderLeaderboardPager(null);
    renderMatchesPager(null);
    return;
  }

  const filters = getOverviewFilterState();
  const scoped = buildScopedStats(statsData, filters);
  const ranked = sortLeaderboardPlayers(scoped.players);
  ranked.forEach((p, index) => {
    p.pos = index + 1;
  });
  let boardPlayers = ranked;
  if (hasOverviewPlayerFilter(filters)) {
    boardPlayers = ranked.filter((p) => playerMatchesOverviewPlayerFilter(p, filters));
  }
  const summaryMatches = hasOverviewPlayerFilter(filters)
    ? scoped.matches.filter((m) => matchPassesPlayerFilter(m, filters))
    : scoped.matches;
  let matchList = recentMatches(statsData).filter((m) => matchPassesOverviewFilters(m, filters));

  const racksPlayed = summaryMatches.reduce((sum, m) => {
    if (!m.scores) return sum;
    return sum + (Number(m.scores.p1) || 0) + (Number(m.scores.p2) || 0);
  }, 0);
  summaryEl.innerHTML = `
    <div class="stats-summary-card"><strong>${summaryMatches.length}</strong><span>Completed matches</span></div>
    <div class="stats-summary-card"><strong>${boardPlayers.length}</strong><span>Players</span></div>
    <div class="stats-summary-card"><strong>${racksPlayed}</strong><span>Racks / frames</span></div>
  `;

  updateLeaderboardSortHeaders();

  if (!boardPlayers.length) {
    const emptyBoard = (hasOverviewPlayerFilter(filters) || filters.eventQuery || filters.dateFrom || filters.dateTo)
      ? 'No players match the current filters.'
      : 'No completed matches yet. Play a race on a connected dock to populate stats.';
    boardBody.innerHTML = `<tr><td colspan="7" class="dash-stats-empty">${emptyBoard}</td></tr>`;
    renderLeaderboardPager(null);
  } else {
    const pageInfo = paginateItems(boardPlayers, leaderboardPage, LEADERBOARD_PAGE_SIZE);
    leaderboardPage = pageInfo.page;
    boardBody.innerHTML = pageInfo.items.map((p) => `
      <tr class="stats-row-clickable" data-player-id="${escapeHtml(p.id)}">
        <td class="stats-pos">${p.pos != null ? p.pos : ''}</td>
        <td>${escapeHtml(p.name)}${p.accountEmail ? `<div class="stats-account-email">${escapeHtml(p.accountEmail)}</div>` : ''}</td>
        <td>${formatMatchRecord(p.gamesWon, p.gamesDrawn, p.gamesLost)}</td>
        <td>${playerWinPct(p)}%</td>
        <td>${p.racksWon}/${p.racksLost}</td>
        <td>${escapeHtml(formatStatsDate(p.createdAt))}</td>
        <td>${escapeHtml(formatStatsDate(p.lastPlayedAt))}</td>
      </tr>
    `).join('');
    renderLeaderboardPager(pageInfo);
  }

  if (!matchList.length) {
    const emptyMatches = (hasOverviewPlayerFilter(filters) || filters.eventQuery || filters.dateFrom || filters.dateTo)
      ? 'No matches match the current filters.'
      : 'No match history yet.';
    matchBody.innerHTML = `<tr><td colspan="5" class="dash-stats-empty">${emptyMatches}</td></tr>`;
    renderMatchesPager(null);
  } else {
    // recentMatches() already sorts (live first, then by date desc); paginate that order.
    const matchPageInfo = paginateItems(matchList, matchesPage, MATCHES_PAGE_SIZE);
    matchesPage = matchPageInfo.page;
    matchBody.innerHTML = matchPageInfo.items.map((m) => matchOverviewRow(m)).join('');
    renderMatchesPager(matchPageInfo);
  }
  if (statusEl && !statsLoading) {
    statusEl.textContent = isViewingOtherAccount()
      ? `Showing ${getPlatformViewAccountLabel()}`
      : '';
  }
}

function matchPairHtml(m) {
  const result = resolveMatchResult(m);
  const playerSpan = (name, winner) => {
    const display = String(name || '').trim();
    const classes = winner ? 'stats-match-player stats-winner' : 'stats-match-player';
    if (!display) {
      return `<span class="${classes}">—</span>`;
    }
    return `<button type="button" class="${classes} stats-match-player-link" data-open-player="${escapeHtml(display)}">${escapeHtml(display)}</button>`;
  };
  return `<div class="stats-match-pair">
    ${playerSpan(m.player1Name, result.winnerSlot === '1')}
    <span class="stats-match-vs">vs</span>
    ${playerSpan(m.player2Name, result.winnerSlot === '2')}
  </div>`;
}

function rackWinnerName(m, rack) {
  const slot = rack && rack.winnerSlot != null ? String(rack.winnerSlot) : '';
  if (slot === '1') return m.player1Name || 'Player 1';
  if (slot === '2') return m.player2Name || 'Player 2';
  return '—';
}

function rackBreakerSlot(rack) {
  const slot = rack && rack.breakerSlot != null ? String(rack.breakerSlot) : '';
  return slot === '1' || slot === '2' ? slot : '';
}

/** Per-rack ball counts when stored on the rack or attributable from match.balls. */
function rackBallCounts(m, rack, rackIndex, timedRacks) {
  if (rack && (rack.ballsP1 != null || rack.ballsP2 != null)) {
    return {
      p1: Number(rack.ballsP1) || 0,
      p2: Number(rack.ballsP2) || 0,
    };
  }
  const balls = Array.isArray(m && m.balls) ? m.balls : [];
  if (!balls.length || !rack) return null;
  const startMs = rack.startedAt ? Date.parse(rack.startedAt) : NaN;
  const endMs = rack.timestamp ? Date.parse(rack.timestamp) : NaN;
  const prev = rackIndex > 0 ? timedRacks[rackIndex - 1] : null;
  const prevEndMs = prev && prev.timestamp ? Date.parse(prev.timestamp) : NaN;
  const windowStart = Number.isFinite(startMs)
    ? startMs
    : (Number.isFinite(prevEndMs) ? prevEndMs : NaN);
  const windowEnd = Number.isFinite(endMs) ? endMs : NaN;
  if (!Number.isFinite(windowEnd)) return null;

  let p1 = 0;
  let p2 = 0;
  const p1Key = String(m.player1Name || '').toLowerCase();
  const p2Key = String(m.player2Name || '').toLowerCase();
  balls.forEach((b) => {
    const ts = b && b.timestamp ? Date.parse(b.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts > windowEnd) return;
    if (Number.isFinite(windowStart) && ts <= windowStart) return;
    const winnerId = b.winnerId != null ? String(b.winnerId) : '';
    if (winnerId === '1' || winnerId === String(m.player1Id || '')) p1 += 1;
    else if (winnerId === '2' || winnerId === String(m.player2Id || '')) p2 += 1;
    else {
      const wName = String(b.winnerName || '').toLowerCase();
      if (wName && wName === p1Key) p1 += 1;
      else if (wName && wName === p2Key) p2 += 1;
    }
  });
  return { p1, p2 };
}

/** Dock-equivalent per-rack/frame breakdown for cloud matches. */
function renderStraightMatchSummary(m, options = {}) {
  const scores = m.scores || m.finalScore || { p1: 0, p2: 0 };
  const p1Score = Number(scores.p1) || 0;
  const p2Score = Number(scores.p2) || 0;
  const hr1 = Number(m.highestRunP1) || 0;
  const hr2 = Number(m.highestRunP2) || 0;
  if (p1Score + p2Score + hr1 + hr2 <= 0) return '';
  const viewerKey = options.viewerPlayerKey || '';
  const viewerSlot = viewerKey ? matchPlayerSlot(m, viewerKey) : null;
  const viewerIsP2 = viewerSlot === '2';
  const playerOrder = viewerIsP2 ? ['2', '1'] : ['1', '2'];
  const winner = m.winnerSlot === '1'
    ? `Winner: ${escapeHtml(m.player1Name || 'Player 1')}`
    : (m.winnerSlot === '2'
      ? `Winner: ${escapeHtml(m.player2Name || 'Player 2')}`
      : 'Score');
  const playerLines = playerOrder.map((slot) => {
    const isP1 = slot === '1';
    const name = isP1 ? (m.player1Name || 'Player 1') : (m.player2Name || 'Player 2');
    const run = isP1 ? hr1 : hr2;
    return `<div class="stats-rack-player-line">
      <span class="stats-rack-player-id"><span class="stats-rack-player-name">${escapeHtml(name)}</span></span>
      <span>Longest Run: ${escapeHtml(String(run))}</span>
    </div>`;
  }).join('');
  const matchLabel = formatDurationSeconds(getMatchDurationSeconds(m));
  const footer = matchLabel
    ? `<div class="stats-match-duration-footer">${escapeHtml(`Match ${matchLabel}`)}</div>`
    : '';
  return `<div class="stats-match-racks-wrap">
    <div class="stats-rack-list">
      <div class="stats-rack-card">
        <div class="stats-rack-primary">
          <span class="stats-rack-score">${escapeHtml(`${p1Score}–${p2Score}`)}</span>
          <span class="stats-rack-outcome">${winner}</span>
        </div>
        <div class="stats-rack-players">${playerLines}</div>
      </div>
    </div>
    ${footer}
  </div>`;
}

function renderMatchRackBreakdown(m, options = {}) {
  if (m.gameType === 'game4') {
    return renderStraightMatchSummary(m, options);
  }
  const timedRacks = enrichRacksWithDuration(m);
  if (!timedRacks.length) return '';
  const viewerKey = options.viewerPlayerKey || '';
  const viewerSlot = viewerKey ? matchPlayerSlot(m, viewerKey) : null;
  const viewerIsP2 = viewerSlot === '2';
  const isSnooker = m.gameType === 'game8';
  const isPoolRunGame = m.gameType === 'game1' || m.gameType === 'game2' || m.gameType === 'game3' ||
    m.gameType === 'game5' || m.gameType === 'game6';
  const showBalls = !isSnooker;

  const durationCell = (r) => formatDurationSeconds(r.durationSeconds) || '—';
  const durationFooter = () => {
    const matchLabel = formatDurationSeconds(sumRackDurationSeconds(m));
    if (!matchLabel) return '';
    return `<div class="stats-match-duration-footer">${escapeHtml(`Match ${matchLabel}`)}</div>`;
  };

  const winnerLabel = (r) => {
    return `Winner: ${escapeHtml(rackWinnerName(m, r))}`;
  };

  const playerOrder = viewerIsP2 ? ['2', '1'] : ['1', '2'];

  const cards = timedRacks.map((r, rackIndex) => {
    const num = escapeHtml(String(r.rackNumber || ''));
    const dur = escapeHtml(durationCell(r));
    const primaryParts = [`<span class="stats-rack-num">#${num}</span>`];
    const f1 = Number(r.foulsP1) || 0;
    const f2 = Number(r.foulsP2) || 0;
    const winnerSlot = r.winnerSlot != null ? String(r.winnerSlot) : '';
    const bSlot = rackBreakerSlot(r);
    // B&R only counts when breaker and winner match; otherwise don't mis-attribute.
    const isBreakAndRun = !!(r.breakAndRun && (!bSlot || bSlot === winnerSlot));
    const isTableRun = !!(r.tableRun && !isBreakAndRun);
    const ballCounts = showBalls ? rackBallCounts(m, r, rackIndex, timedRacks) : null;
    const fs = r.frameScore || { p1: 0, p2: 0 };
    const hb1 = Number(r.highestBreakP1) || 0;
    const hb2 = Number(r.highestBreakP2) || 0;

    if (isSnooker) {
      primaryParts.push(
        `<span class="stats-rack-score">${escapeHtml(`${fs.p1}–${fs.p2}`)}</span>`
      );
    }
    primaryParts.push(`<span class="stats-rack-outcome">${winnerLabel(r)}</span>`);
    primaryParts.push(`<span class="stats-rack-dur">${dur}</span>`);

    const playerLines = playerOrder.map((slot) => {
      const isP1 = slot === '1';
      const name = isP1 ? (m.player1Name || 'Player 1') : (m.player2Name || 'Player 2');
      const nameParts = [];
      if (bSlot === slot) {
        nameParts.push(
          '<img class="stats-rack-broke-icon" src="/web/images/balls/snooker-white-small.png" alt="" title="Broke" />'
        );
      }
      nameParts.push(`<span class="stats-rack-player-name">${escapeHtml(name)}</span>`);
      const parts = [`<span class="stats-rack-player-id">${nameParts.join('')}</span>`];
      if (isSnooker) {
        parts.push(`<span>Points: ${escapeHtml(String(isP1 ? fs.p1 : fs.p2))}</span>`);
      } else if (showBalls && ballCounts) {
        parts.push(`<span>Balls Potted: ${escapeHtml(String(isP1 ? ballCounts.p1 : ballCounts.p2))}</span>`);
      }
      parts.push(`<span>Fouls: ${escapeHtml(String(isP1 ? f1 : f2))}</span>`);
      if (isSnooker) {
        parts.push(`<span>HB: ${escapeHtml(String(isP1 ? hb1 : hb2))}</span>`);
      }
      if (isPoolRunGame && winnerSlot === slot) {
        if (isBreakAndRun) {
          parts.push(
            '<span class="stats-rack-flag" title="Break\'n\'Run" aria-label="Break\'n\'Run">B&amp;R</span>'
          );
        }
        if (isTableRun) {
          parts.push(
            '<span class="stats-rack-flag" title="Table Run" aria-label="Table Run">TR</span>'
          );
        }
      }
      return `<div class="stats-rack-player-line">${parts.join('')}</div>`;
    }).join('');

    return `<div class="stats-rack-card">
      <div class="stats-rack-primary">${primaryParts.join('')}</div>
      <div class="stats-rack-players">${playerLines}</div>
    </div>`;
  }).join('');

  return `<div class="stats-match-racks-wrap">
    <div class="stats-rack-list">${cards}</div>
    ${durationFooter()}
  </div>`;
}

function matchDateOptions(m, inProgress) {
  return {
    inProgress,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
    durationSeconds: getMatchDurationSeconds(m),
  };
}

function matchRackCount(m) {
  if (m && m.gameType === 'game4') {
    const scores = m.scores || m.finalScore || {};
    const pts = (Number(scores.p1) || 0) + (Number(scores.p2) || 0);
    const runs = (Number(m.highestRunP1) || 0) + (Number(m.highestRunP2) || 0);
    return (pts + runs) > 0 ? 1 : 0;
  }
  return enrichRacksWithDuration(m).length;
}

function isMatchRacksExpanded(startEventId) {
  return expandedMatchRacks.has(String(startEventId || ''));
}

function toggleMatchRacksExpanded(startEventId) {
  const id = String(startEventId || '');
  if (!id) return;
  if (expandedMatchRacks.has(id)) {
    expandedMatchRacks.delete(id);
  } else {
    // Only one match racks row expanded at a time.
    expandedMatchRacks.clear();
    expandedMatchRacks.add(id);
  }
  if (selectedPlayerKey) renderPlayerDetail();
  else renderAccountStats();
}

/** Inline action icons (text label hidden on narrow viewports). */
function statsActionIcon(kind) {
  const common = 'class="stats-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
  const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  // Open eye = show racks; closed/slashed = hide
  if (kind === 'eyeOpen') {
    return `<svg ${common} ${stroke}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  if (kind === 'eyeClosed') {
    return `<svg ${common} ${stroke}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  }
  if (kind === 'edit') {
    return `<svg ${common} ${stroke}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  }
  if (kind === 'clear') {
    return `<svg ${common} ${stroke}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  }
  return '';
}

function statsActionButton({ className = '', attrs = '', icon, label, title }) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<button type="button" class="btn stats-action-btn ${className}"${titleAttr} ${attrs}>` +
    `${statsActionIcon(icon)}<span class="stats-action-label">${escapeHtml(label)}</span>` +
    `</button>`;
}

function matchRacksToggleButton(m) {
  if (!matchRackCount(m) || !m.startEventId) return '';
  const expanded = isMatchRacksExpanded(m.startEventId);
  const straight = m.gameType === 'game4';
  return statsActionButton({
    className: 'stats-match-racks-toggle',
    attrs: `data-toggle-racks="${escapeHtml(m.startEventId)}" aria-expanded="${expanded ? 'true' : 'false'}"`,
    // Collapsed → open eye (show); expanded → closed eye (hide)
    icon: expanded ? 'eyeClosed' : 'eyeOpen',
    label: straight ? 'Details' : 'Racks',
    title: expanded
      ? (straight ? 'Hide match details' : 'Hide rack details')
      : (straight ? 'Show match details' : 'Show rack details'),
  });
}

function matchEditButton(startEventId) {
  return statsActionButton({
    className: 'edit',
    attrs: `data-edit-match="${escapeHtml(startEventId)}"`,
    icon: 'edit',
    label: 'Edit',
    title: 'Edit match',
  });
}

function matchAbandonButton(startEventId) {
  return statsActionButton({
    className: 'danger',
    attrs: `data-abandon-match="${escapeHtml(startEventId)}"`,
    icon: 'clear',
    label: 'Kill',
    title: 'Remove this unfinished match from cloud stats',
  });
}

function matchRacksDetailRow(m, colspan, options = {}) {
  if (!isMatchRacksExpanded(m.startEventId)) return '';
  const breakdown = renderMatchRackBreakdown(m, options);
  if (!breakdown) return '';
  return `<tr class="stats-match-racks-row"><td colspan="${colspan}">${breakdown}</td></tr>`;
}

function formatMatchEventCellHtml(m) {
  const game = escapeHtml(gameTypeLabel(m.gameType));
  const info = String(m.gameInfo || '').trim();
  return `<div class="stats-match-event-cell">` +
    `<div class="stats-match-event-game">${game}</div>` +
    (info
      ? `<div class="stats-match-event-name">${escapeHtml(info)}</div>`
      : '') +
    `</div>`;
}

function matchOverviewRow(m) {
  const inProgress = isMatchInProgress(m);
  const actions = [];
  const racksToggle = matchRacksToggleButton(m);
  if (racksToggle) actions.push(racksToggle);
  if (inProgress) {
    actions.push(matchAbandonButton(m.startEventId));
  } else {
    actions.push(matchEditButton(m.startEventId));
  }
  const main = `
    <tr class="${inProgress ? 'stats-match-in-progress' : ''}">
      <td class="stats-match-when">${matchDateCellHtml(m.completedAt || m.startedAt, matchDateOptions(m, inProgress))}${m.accountEmail ? `<div class="stats-account-email">${escapeHtml(m.accountEmail)}</div>` : ''}</td>
      <td class="stats-match-event">${formatMatchEventCellHtml(m)}</td>
      <td class="stats-match-pair-cell">${matchPairHtml(m)}</td>
      <td class="stats-match-score">${scoreCellHtml(m)}</td>
      <td class="stats-match-actions">${actions.join('')}</td>
    </tr>
  `;
  return main + matchRacksDetailRow(m, 5);
}

function playerMatches(playerKey, options = {}) {
  const opponentKey = String(options.opponent || '').trim();
  const gameType = options.gameType || '';
  return recentMatches(statsData || {}).filter((m) => {
    const slot = matchPlayerSlot(m, playerKey);
    if (!slot) return false;
    if (gameType && m.gameType !== gameType) return false;
    if (opponentKey) {
      const opponentId = slot === '1' ? m.player2Id : m.player1Id;
      const opponentName = slot === '1' ? m.player2Name : m.player1Name;
      if (opponentId && opponentId === opponentKey) return true;
      if (String(opponentName || '').toLowerCase() === opponentKey.toLowerCase()) return true;
      return false;
    }
    return true;
  });
}

function populatePlayerDetailFilters(matches) {
  const opponentSelect = document.getElementById('statsPlayerOpponentFilter');
  const gameSelect = document.getElementById('statsPlayerGameFilter');
  if (!opponentSelect || !gameSelect) return;

  const opponents = new Map();
  const games = new Set();
  matches.forEach((m) => {
    const slot = matchPlayerSlot(m, selectedPlayerKey);
    const opponentId = slot === '1' ? m.player2Id : (slot === '2' ? m.player1Id : null);
    const opponentName = slot === '1' ? m.player2Name : (slot === '2' ? m.player1Name : null);
    const opponentKey = String(opponentId || opponentName || '').trim();
    if (opponentKey) opponents.set(opponentKey, String(opponentName || opponentKey).trim());
    if (m.gameType) games.add(m.gameType);
  });

  const opponentOptions = ['<option value="">All opponents</option>'].concat(
    Array.from(opponents.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) =>
        `<option value="${escapeHtml(id)}"${id === playerDetailOpponentFilter ? ' selected' : ''}>${escapeHtml(name)}</option>`
      )
  );
  opponentSelect.innerHTML = opponentOptions.join('');
  if (playerDetailOpponentFilter && !opponents.has(playerDetailOpponentFilter)) {
    playerDetailOpponentFilter = '';
    opponentSelect.value = '';
  }

  const gameOptions = ['<option value="">All games</option>'].concat(
    Array.from(games)
      .sort((a, b) => gameTypeLabel(a).localeCompare(gameTypeLabel(b)))
      .map((gt) =>
        `<option value="${escapeHtml(gt)}"${gt === playerDetailGameFilter ? ' selected' : ''}>${escapeHtml(gameTypeLabel(gt))}</option>`
      )
  );
  gameSelect.innerHTML = gameOptions.join('');
  if (playerDetailGameFilter && !games.has(playerDetailGameFilter)) {
    playerDetailGameFilter = '';
    gameSelect.value = '';
  }
}

function setPlayerRenameEditing(editing, { focus = true } = {}) {
  playerRenameEditing = !!editing;
  const titleView = document.getElementById('statsPlayerTitleView');
  const form = document.getElementById('statsPlayerRenameForm');
  titleView?.classList.toggle('hidden', playerRenameEditing);
  form?.classList.toggle('hidden', !playerRenameEditing);
  if (playerRenameEditing && focus) {
    const input = document.getElementById('statsPlayerRenameInput');
    if (input) {
      input.focus();
      input.select();
    }
  }
}

function balancedSummaryColumns(count, maxPerRow = 4) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 1) return 1;
  if (n <= maxPerRow) return n;
  const rows = Math.ceil(n / maxPerRow);
  return Math.ceil(n / rows);
}

function renderPlayerDetail() {
  const allMatches = playerMatches(selectedPlayerKey);
  const matches = playerMatches(selectedPlayerKey, {
    opponent: playerDetailOpponentFilter,
    gameType: playerDetailGameFilter,
  });
  const filteredStats = statsFromMatches(matches);
  const player = filteredStats.players.find((p) => p.id === selectedPlayerKey)
    || findStatsPlayer(selectedPlayerKey);
  const title = document.getElementById('statsPlayerTitle');
  const summary = document.getElementById('statsPlayerSummary');
  const rename = document.getElementById('statsPlayerRenameInput');
  const body = document.getElementById('statsPlayerMatchesBody');
  const unfilteredName = statsPlayerDisplayName(
    selectedPlayerKey,
    statsFromMatches(allMatches).players.find((p) => p.id === selectedPlayerKey)?.name || ''
  );
  if (!selectedPlayerKey) {
    renderAccountStats();
    return;
  }
  if (title) {
    title.textContent = unfilteredName;
    const email = String(player?.accountEmail || '').trim();
    title.title = email ? `${unfilteredName} · ${email}` : unfilteredName;
  }
  if (rename && document.activeElement !== rename) rename.value = unfilteredName;
  setPlayerRenameEditing(playerRenameEditing, { focus: false });
  const renameBtn = document.getElementById('statsPlayerRenameEditBtn');
  const deleteBtn = document.getElementById('statsPlayerDeleteBtn');
  renameBtn?.classList.remove('hidden');
  deleteBtn?.classList.remove('hidden');
  populatePlayerDetailFilters(allMatches);
  if (summary) {
    const cards = [];
    const gamesWon = player ? (player.gamesWon || 0) : 0;
    const gamesDrawn = player ? (player.gamesDrawn || 0) : 0;
    const gamesLost = player ? (player.gamesLost || 0) : 0;
    const racksWon = player ? (player.racksWon || 0) : 0;
    const racksLost = player ? (player.racksLost || 0) : 0;
    const highestBreak = player ? (player.highestBreak || 0) : 0;
    const highestRun = player ? (player.highestRun || 0) : 0;
    const breakAndRuns = player ? (player.breakAndRuns || 0) : 0;
    const tableRuns = player ? (player.tableRuns || 0) : 0;
    if (gamesWon + gamesDrawn + gamesLost > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${formatMatchRecord(gamesWon, gamesDrawn, gamesLost)}</strong><span>Matches W/D/L</span></div>`);
      cards.push(`<div class="stats-summary-card"><strong>${winPct(gamesWon, gamesLost, gamesDrawn)}%</strong><span>Win %</span></div>`);
    }
    if (racksWon + racksLost > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${racksWon}/${racksLost}</strong><span>Racks W/L</span></div>`);
    }
    if (highestBreak > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${highestBreak}</strong><span>Highest break</span></div>`);
    }
    if (highestRun > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${highestRun}</strong><span>Longest run</span></div>`);
    }
    if (breakAndRuns > 0) {
      cards.push(
        `<div class="stats-summary-card"><strong>${breakAndRuns}</strong>`
        + `<span title="Break'n'Run" aria-label="Break'n'Run">B&amp;R</span></div>`
      );
    }
    if (tableRuns > 0) {
      cards.push(
        `<div class="stats-summary-card"><strong>${tableRuns}</strong>`
        + `<span title="Table Run" aria-label="Table Run">Table runs</span></div>`
      );
    }
    const fouls = player ? (player.fouls || 0) : 0;
    if (fouls > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${fouls}</strong><span>Fouls</span></div>`);
    }
    const ballsPotted = player ? (player.ballsPotted || 0) : 0;
    if (ballsPotted > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${ballsPotted}</strong><span>Balls potted</span></div>`);
    }
    summary.innerHTML = cards.join('');
    summary.classList.toggle('hidden', cards.length === 0);
    if (cards.length) {
      summary.style.setProperty('--stats-summary-cols', String(balancedSummaryColumns(cards.length)));
    } else {
      summary.style.removeProperty('--stats-summary-cols');
    }
  }
  if (!body) return;
  if (!matches.length) {
    body.innerHTML = '<tr><td colspan="5" class="dash-stats-empty">No matches for this player yet.</td></tr>';
    return;
  }
  body.innerHTML = matches.map((m) => {
    const inProgress = isMatchInProgress(m);
    const actions = [];
    const racksToggle = matchRacksToggleButton(m);
    if (racksToggle) actions.push(racksToggle);
    if (inProgress) {
      actions.push(matchAbandonButton(m.startEventId));
    } else {
      actions.push(matchEditButton(m.startEventId));
    }
    const main = `
      <tr class="${inProgress ? 'stats-match-in-progress' : ''}">
        <td class="stats-match-when">${matchDateCellHtml(m.completedAt || m.startedAt, matchDateOptions(m, inProgress))}${m.accountEmail ? `<div class="stats-account-email">${escapeHtml(m.accountEmail)}</div>` : ''}</td>
        <td class="stats-match-pair-cell">${matchPairHtml(m)}</td>
        <td>${formatMatchGameCellHtml(m)}</td>
        <td class="stats-match-score">${scoreCellHtml(m, {
          viewerRelative: true,
          playerKey: selectedPlayerKey,
        })}</td>
        <td class="stats-match-actions">${actions.join('')}</td>
      </tr>
    `;
    return main + matchRacksDetailRow(m, 5, { viewerPlayerKey: selectedPlayerKey });
  }).join('');
}

function formatMatchGameCellHtml(m) {
  const label = escapeHtml(gameTypeLabel(m.gameType));
  const info = String(m.gameInfo || '').trim();
  if (!info) return label;
  return `${label}<div class="stats-match-game-info">${escapeHtml(info)}</div>`;
}

function findMatchByStartId(startEventId) {
  return (statsData?.matches || []).find((m) => m.startEventId === startEventId) || null;
}

function dateInputValue(value) {
  if (!value) return '';
  const d = parseUtcDate(value);
  if (!d) return String(value).slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showsBallsFields(gameType) {
  return gameType === 'game1' || gameType === 'game2' || gameType === 'game3' ||
    gameType === 'game5' || gameType === 'game6' || gameType === 'game7' || gameType === 'game8';
}

function syncMatchExtrasVisibility(gameType) {
  const gt = gameType || document.getElementById('statsMatchGameType')?.value || 'game1';
  const straight = gt === 'game4';
  document.getElementById('statsMatchExtrasBalls')?.classList.toggle('hidden', !showsBallsFields(gt));
  document.getElementById('statsMatchStraightFields')?.classList.toggle('hidden', !straight);
  document.getElementById('statsMatchRacksEditorWrap')?.classList.toggle('hidden', straight);
  const p1 = matchModalPlayerName('1') || matchEditPlayerNames.p1 || 'P1';
  const p2 = matchModalPlayerName('2') || matchEditPlayerNames.p2 || 'P2';
  const setLabel = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setLabel('statsMatchBallsP1Label', `Balls potted · ${p1}`);
  setLabel('statsMatchBallsP2Label', `Balls potted · ${p2}`);
  setLabel('statsMatchScoreP1Label', `Balls · ${p1}`);
  setLabel('statsMatchScoreP2Label', `Balls · ${p2}`);
  setLabel('statsMatchHrP1Label', `Longest run · ${p1}`);
  setLabel('statsMatchHrP2Label', `Longest run · ${p2}`);
  const word = gt === 'game8' ? 'Frame' : 'Rack';
  const words = gt === 'game8' ? 'Frames' : 'Racks';
  const label = document.getElementById('statsMatchRacksEditorLabel');
  const addBtn = document.getElementById('statsMatchAddRackBtn');
  if (label) label.textContent = words;
  if (addBtn) {
    addBtn.classList.add('dash-action-btn');
    setDashActionButtonContent(addBtn, {
      icon: 'plus',
      label: `Add ${word}`,
      title: `Add ${word.toLowerCase()}`,
    });
  }
  updateDashMatchScoreSummary();
}

function removeDashMatchRackAt(index) {
  const preserved = preserveDashRackEditorRows();
  if (index < 0 || index >= preserved.length) return;
  preserved.splice(index, 1);
  renderDashMatchRacksEditor(preserved);
  syncMatchModalSaveEnabled();
}

function fillMatchGameTypes() {
  const select = document.getElementById('statsMatchGameType');
  if (!select || select.options.length) return;
  GAME_TYPES.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    select.appendChild(opt);
  });
}

function setMatchModalError(msg) {
  const el = document.getElementById('statsMatchError');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function closeMatchModal() {
  if (matchModalBusy) return;
  const modal = document.getElementById('statsMatchModal');
  if (modal) modal.classList.add('hidden');
  matchModalBaseline = null;
  setDashMatchModalBusy(false);
  syncMatchModalSaveEnabled();
}

let matchModalBusy = false;

function setMatchModalActionButtons({ saving = false, deleting = false } = {}) {
  const saveBtn = document.getElementById('statsMatchSaveBtn');
  const cancelBtn = document.getElementById('statsMatchCancelBtn');
  const deleteBtn = document.getElementById('statsMatchDeleteBtn');
  const addBtn = document.getElementById('statsMatchAddRackBtn');
  if (saveBtn) {
    setDashActionButtonContent(saveBtn, {
      icon: 'save',
      label: saving ? 'Saving…' : 'Save',
      title: saving ? 'Saving match' : 'Save match',
    });
  }
  if (cancelBtn) {
    setDashActionButtonContent(cancelBtn, {
      icon: 'cancel',
      label: 'Cancel',
      title: 'Cancel editing',
    });
  }
  if (deleteBtn) {
    setDashActionButtonContent(deleteBtn, {
      icon: 'trash',
      label: deleting ? 'Deleting…' : 'Delete',
      title: deleting ? 'Deleting match' : 'Delete match',
    });
  }
  if (addBtn) {
    const gameType = document.getElementById('statsMatchGameType')?.value || 'game1';
    const word = gameType === 'game8' ? 'Frame' : 'Rack';
    setDashActionButtonContent(addBtn, {
      icon: 'plus',
      label: `Add ${word}`,
      title: `Add ${word.toLowerCase()}`,
    });
  }
}

function setDashMatchModalBusy(busy, action = 'save') {
  matchModalBusy = !!busy;
  const modal = document.getElementById('statsMatchModal');
  const form = document.getElementById('statsMatchForm');
  const saveBtn = document.getElementById('statsMatchSaveBtn');
  const cancelBtn = document.getElementById('statsMatchCancelBtn');
  const deleteBtn = document.getElementById('statsMatchDeleteBtn');
  modal?.classList.toggle('is-busy', matchModalBusy);
  modal?.setAttribute('aria-busy', matchModalBusy ? 'true' : 'false');
  form?.querySelectorAll('input, select, textarea, button').forEach((el) => {
    if (el.id === 'statsMatchSaveBtn' || el.id === 'statsMatchCancelBtn' || el.id === 'statsMatchDeleteBtn') return;
    el.disabled = matchModalBusy;
  });
  if (saveBtn) {
    saveBtn.disabled = matchModalBusy ? true : !matchModalHasChanges();
  }
  if (cancelBtn) cancelBtn.disabled = matchModalBusy;
  if (deleteBtn) deleteBtn.disabled = matchModalBusy;
  setMatchModalActionButtons({
    saving: matchModalBusy && action === 'save',
    deleting: matchModalBusy && action === 'delete',
  });
}

function syncMatchModalSaveEnabled() {
  const btn = document.getElementById('statsMatchSaveBtn');
  if (!btn) return;
  if (matchModalBusy) {
    btn.disabled = true;
    return;
  }
  btn.disabled = !matchModalHasChanges();
}

function matchModalPlayerName(slot) {
  const id = slot === '2' ? 'statsMatchP2' : 'statsMatchP1';
  return (document.getElementById(id)?.value || '').trim().slice(0, 20);
}

function syncMatchModalPlayerLabels() {
  matchEditPlayerNames = {
    p1: matchModalPlayerName('1') || 'Player 1',
    p2: matchModalPlayerName('2') || 'Player 2',
  };
  syncMatchExtrasVisibility(document.getElementById('statsMatchGameType')?.value || 'game1');
  updateDashMatchScoreSummary();
}

let matchModalBaseline = null;
let matchEditPlayerNames = { p1: 'Player 1', p2: 'Player 2' };

function numField(id) {
  const n = Number(document.getElementById(id)?.value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clampDashScore(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 999);
}

function readRackExtraFieldsFromRow(row) {
  const entry = {};
  const pts1 = row.querySelector('.stats-rack-pts-p1');
  const hb1 = row.querySelector('.stats-rack-hb-p1');
  const hr1 = row.querySelector('.stats-rack-hr-p1');
  if (pts1) {
    entry.frameScore = {
      p1: clampDashScore(pts1.value),
      p2: clampDashScore(row.querySelector('.stats-rack-pts-p2')?.value),
    };
  }
  if (hb1) {
    entry.highestBreakP1 = clampDashScore(hb1.value);
    entry.highestBreakP2 = clampDashScore(row.querySelector('.stats-rack-hb-p2')?.value);
  }
  const fouls1 = row.querySelector('.stats-rack-fouls-p1');
  if (fouls1) {
    entry.foulsP1 = clampDashScore(fouls1.value);
    entry.foulsP2 = clampDashScore(row.querySelector('.stats-rack-fouls-p2')?.value);
  }
  if (hr1) {
    entry.highestRunP1 = clampDashScore(hr1.value);
    entry.highestRunP2 = clampDashScore(row.querySelector('.stats-rack-hr-p2')?.value);
  }
  return entry;
}

function collectDashMatchRacksFromEditor() {
  const editor = document.getElementById('statsMatchRacksEditor');
  if (!editor) return [];
  const racks = [];
  editor.querySelectorAll('tr.stats-rack-edit-row').forEach((row) => {
    const winnerId = row.querySelector('.stats-rack-winner')?.value || '';
    if (!winnerId) return;
    const entry = { winnerId };
    Object.assign(entry, readRackExtraFieldsFromRow(row));
    const breaker = row.getAttribute('data-breaker-slot');
    if (breaker === '1' || breaker === '2') entry.breakerSlot = breaker;
    racks.push(entry);
  });
  return racks;
}

function preserveDashRackEditorRows() {
  const editor = document.getElementById('statsMatchRacksEditor');
  const preserved = [];
  editor?.querySelectorAll('tr.stats-rack-edit-row').forEach((row) => {
    const entry = { winnerId: row.querySelector('.stats-rack-winner')?.value || '' };
    Object.assign(entry, readRackExtraFieldsFromRow(row));
    const breaker = row.getAttribute('data-breaker-slot');
    if (breaker === '1' || breaker === '2') entry.breakerSlot = breaker;
    preserved.push(entry);
  });
  return preserved;
}

function updateDashMatchScoreSummary() {
  const summary = document.getElementById('statsMatchScoreSummary');
  if (!summary) return;
  const gameType = document.getElementById('statsMatchGameType')?.value || 'game1';
  let p1 = 0;
  let p2 = 0;
  if (gameType === 'game4') {
    p1 = clampDashScore(document.getElementById('statsMatchScoreP1')?.value);
    p2 = clampDashScore(document.getElementById('statsMatchScoreP2')?.value);
  } else {
    const racks = collectDashMatchRacksFromEditor();
    racks.forEach((r) => {
      if (r.winnerId === '1') p1 += 1;
      else if (r.winnerId === '2') p2 += 1;
    });
  }
  summary.textContent = `Match: ${matchEditPlayerNames.p1 || 'Player 1'} ${p1} – ${p2} ${matchEditPlayerNames.p2 || 'Player 2'}`;
}

function renderDashMatchRacksEditor(racks) {
  const editor = document.getElementById('statsMatchRacksEditor');
  if (!editor) return;
  const gameType = document.getElementById('statsMatchGameType')?.value || 'game1';
  const isSnooker = gameType === 'game8';
  const isStraight = gameType === 'game4';
  syncMatchExtrasVisibility(gameType);
  const list = Array.isArray(racks) ? racks.slice() : [];
  const word = gameType === 'game8' ? 'Frame' : 'Rack';
  const words = gameType === 'game8' ? 'frames' : 'racks';
  if (!list.length) {
    editor.innerHTML = `<p class="hint">No ${words} yet. Use Add ${word}.</p>`;
    updateDashMatchScoreSummary();
    return;
  }
  const p1 = escapeHtml(matchEditPlayerNames.p1 || 'Player 1');
  const p2 = escapeHtml(matchEditPlayerNames.p2 || 'Player 2');
  let html = '<table class="stats-table stats-rack-edit-table"><thead><tr><th>#</th><th>Winner</th>';
  if (isSnooker) {
    html += `<th>Pts ${p1}</th><th>Pts ${p2}</th><th>HB ${p1}</th><th>HB ${p2}</th>`;
  } else if (isStraight) {
    html += `<th>Run ${p1}</th><th>Run ${p2}</th>`;
  }
  html += `<th>Fouls ${p1}</th><th>Fouls ${p2}</th><th class="stats-rack-edit-actions-col"></th></tr></thead><tbody>`;
  list.forEach((r, index) => {
    let winnerSlot = '';
    const slot = r.winnerSlot != null ? String(r.winnerSlot) : '';
    if (slot === '1' || r.winnerId === '1' || r.winnerId === 1) winnerSlot = '1';
    else if (slot === '2' || r.winnerId === '2' || r.winnerId === 2) winnerSlot = '2';
    const fs = r.frameScore || {};
    const breakerSlot = r.breakerSlot === '1' || r.breakerSlot === '2' ? r.breakerSlot : '';
    html += `<tr class="stats-rack-edit-row"${breakerSlot ? ` data-breaker-slot="${breakerSlot}"` : ''}><td>${index + 1}</td><td>
      <select class="stats-rack-winner">
        <option value="">—</option>
        <option value="1"${winnerSlot === '1' ? ' selected' : ''}>${p1}</option>
        <option value="2"${winnerSlot === '2' ? ' selected' : ''}>${p2}</option>
      </select></td>`;
    if (isSnooker) {
      html += `<td><input type="number" class="stats-rack-pts-p1" min="0" max="999" value="${clampDashScore(fs.p1)}" /></td>
        <td><input type="number" class="stats-rack-pts-p2" min="0" max="999" value="${clampDashScore(fs.p2)}" /></td>
        <td><input type="number" class="stats-rack-hb-p1" min="0" max="999" value="${clampDashScore(r.highestBreakP1)}" /></td>
        <td><input type="number" class="stats-rack-hb-p2" min="0" max="999" value="${clampDashScore(r.highestBreakP2)}" /></td>`;
    } else if (isStraight) {
      html += `<td><input type="number" class="stats-rack-hr-p1" min="0" max="999" value="${clampDashScore(r.highestRunP1 != null ? r.highestRunP1 : r.highestBreakP1)}" /></td>
        <td><input type="number" class="stats-rack-hr-p2" min="0" max="999" value="${clampDashScore(r.highestRunP2 != null ? r.highestRunP2 : r.highestBreakP2)}" /></td>`;
    }
    html += `<td><input type="number" class="stats-rack-fouls-p1" min="0" max="999" value="${clampDashScore(r.foulsP1)}" /></td>
      <td><input type="number" class="stats-rack-fouls-p2" min="0" max="999" value="${clampDashScore(r.foulsP2)}" /></td>
      <td class="stats-rack-edit-actions">
        <button type="button" class="stats-player-edit-btn stats-player-delete-btn stats-rack-delete-btn" data-rack-index="${index}" title="Delete ${word.toLowerCase()} ${index + 1}" aria-label="Delete ${word.toLowerCase()} ${index + 1}">
          ${dashActionIcon('trash')}
        </button>
      </td></tr>`;
  });
  html += '</tbody></table>';
  editor.innerHTML = html;
  editor.querySelectorAll('.stats-rack-winner').forEach((el) => {
    el.addEventListener('change', () => {
      updateDashMatchScoreSummary();
      syncMatchModalSaveEnabled();
    });
  });
  editor.querySelectorAll('input').forEach((el) => {
    el.addEventListener('input', syncMatchModalSaveEnabled);
  });
  editor.querySelectorAll('.stats-rack-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-rack-index'));
      if (Number.isFinite(idx)) removeDashMatchRackAt(idx);
    });
  });
  updateDashMatchScoreSummary();
}

function serializeDashEditorRacksForCloud(editorRacks) {
  return (editorRacks || []).map((r, index) => {
    const slot = r.winnerId === '1' ? '1' : (r.winnerId === '2' ? '2' : null);
    if (!slot) return null;
    const out = {
      rackNumber: index + 1,
      winnerSlot: slot,
      foulsP1: clampDashScore(r.foulsP1),
      foulsP2: clampDashScore(r.foulsP2),
    };
    if (r.frameScore) {
      out.frameScore = {
        p1: clampDashScore(r.frameScore.p1),
        p2: clampDashScore(r.frameScore.p2),
      };
    }
    if (r.highestBreakP1 != null || r.highestBreakP2 != null) {
      out.highestBreakP1 = clampDashScore(r.highestBreakP1);
      out.highestBreakP2 = clampDashScore(r.highestBreakP2);
    }
    if (r.highestRunP1 != null || r.highestRunP2 != null) {
      out.highestRunP1 = clampDashScore(r.highestRunP1);
      out.highestRunP2 = clampDashScore(r.highestRunP2);
    }
    if (r.breakerSlot === '1' || r.breakerSlot === '2') {
      out.breakerSlot = String(r.breakerSlot);
    }
    return out;
  }).filter(Boolean);
}

function readMatchModalSnapshot() {
  return {
    player1Name: matchModalPlayerName('1'),
    player2Name: matchModalPlayerName('2'),
    gameType: document.getElementById('statsMatchGameType')?.value || 'game1',
    gameInfo: (document.getElementById('statsMatchGameInfo')?.value || '').trim(),
    date: document.getElementById('statsMatchDate')?.value || '',
    ballsP1: numField('statsMatchBallsP1'),
    ballsP2: numField('statsMatchBallsP2'),
    scoreP1: numField('statsMatchScoreP1'),
    scoreP2: numField('statsMatchScoreP2'),
    highestRunP1: numField('statsMatchHrP1'),
    highestRunP2: numField('statsMatchHrP2'),
    racks: serializeDashEditorRacksForCloud(collectDashMatchRacksFromEditor()),
  };
}

function matchModalHasChanges() {
  if (!matchModalBaseline) return false;
  return JSON.stringify(readMatchModalSnapshot()) !== JSON.stringify(matchModalBaseline);
}

function openMatchModal(startEventId) {
  const match = findMatchByStartId(startEventId);
  if (!match || isMatchInProgress(match)) return;
  fillMatchGameTypes();
  const form = document.getElementById('statsMatchForm');
  if (form) {
    form.dataset.player1Id = match.player1Id || '';
    form.dataset.player2Id = match.player2Id || '';
  }
  document.getElementById('statsMatchEventId').value = match.startEventId;
  document.getElementById('statsMatchP1').value = match.player1Name || '';
  document.getElementById('statsMatchP2').value = match.player2Name || '';
  document.getElementById('statsMatchGameType').value = match.gameType || 'game1';
  document.getElementById('statsMatchGameInfo').value = match.gameInfo || '';
  document.getElementById('statsMatchDate').value = dateInputValue(match.completedAt || match.startedAt);
  document.getElementById('statsMatchBallsP1').value = match.ballsP1 || 0;
  document.getElementById('statsMatchBallsP2').value = match.ballsP2 || 0;
  const scores = match.scores || {};
  const scoreP1El = document.getElementById('statsMatchScoreP1');
  const scoreP2El = document.getElementById('statsMatchScoreP2');
  if (scoreP1El) scoreP1El.value = Number(scores.p1) || 0;
  if (scoreP2El) scoreP2El.value = Number(scores.p2) || 0;
  const hr1El = document.getElementById('statsMatchHrP1');
  const hr2El = document.getElementById('statsMatchHrP2');
  if (hr1El) hr1El.value = Number(match.highestRunP1) || 0;
  if (hr2El) hr2El.value = Number(match.highestRunP2) || 0;
  matchEditPlayerNames = {
    p1: match.player1Name || 'Player 1',
    p2: match.player2Name || 'Player 2',
  };
  renderDashMatchRacksEditor(match.racks || []);
  syncMatchExtrasVisibility(match.gameType || 'game1');
  setMatchModalError('');
  setDashMatchModalBusy(false);
  matchModalBaseline = readMatchModalSnapshot();
  syncMatchModalSaveEnabled();
  document.getElementById('statsMatchModal')?.classList.remove('hidden');
}

async function saveMatchModal(event) {
  event.preventDefault();
  if (matchModalBusy) return;
  if (!matchModalHasChanges()) return;
  const startEventId = document.getElementById('statsMatchEventId')?.value;
  if (!startEventId) return;
  const form = document.getElementById('statsMatchForm');
  const p1 = document.getElementById('statsMatchP1').value.trim();
  const p2 = document.getElementById('statsMatchP2').value.trim();
  const dateVal = document.getElementById('statsMatchDate').value;
  const gameType = document.getElementById('statsMatchGameType').value;
  const straight = gameType === 'game4';
  let scores;
  let racks;
  let highestRunP1 = 0;
  let highestRunP2 = 0;
  if (straight) {
    scores = {
      p1: clampDashScore(document.getElementById('statsMatchScoreP1')?.value),
      p2: clampDashScore(document.getElementById('statsMatchScoreP2')?.value),
    };
    racks = [];
    highestRunP1 = clampDashScore(document.getElementById('statsMatchHrP1')?.value);
    highestRunP2 = clampDashScore(document.getElementById('statsMatchHrP2')?.value);
  } else {
    const editorRacks = collectDashMatchRacksFromEditor();
    if (!editorRacks.length) {
      setMatchModalError('Add at least one rack/frame with a winner.');
      return;
    }
    scores = { p1: 0, p2: 0 };
    editorRacks.forEach((r) => {
      if (r.winnerId === '1') scores.p1 += 1;
      else if (r.winnerId === '2') scores.p2 += 1;
    });
    racks = serializeDashEditorRacksForCloud(editorRacks);
  }
  setDashMatchModalBusy(true, 'save');
  try {
    const match = findMatchByStartId(startEventId);
    const ok = await confirmStatsMutation({
      title: 'Save Match',
      message: 'Save changes to this match?',
      confirmLabel: 'Save',
      danger: false,
      entity: match,
      requireConfirm: false, // own-account edits save directly; foreign still confirms
    });
    if (!ok) {
      setDashMatchModalBusy(false);
      return;
    }
    const body = {
      player1Name: p1,
      player2Name: p2,
      player1Id: form?.dataset.player1Id || undefined,
      player2Id: form?.dataset.player2Id || undefined,
      gameType,
      gameInfo: document.getElementById('statsMatchGameInfo').value.trim(),
      scores,
      racks,
      completedAt: dateVal ? `${dateVal}T12:00:00.000Z` : undefined,
      ballsP1: document.getElementById('statsMatchBallsP1').value,
      ballsP2: document.getElementById('statsMatchBallsP2').value,
    };
    if (straight) {
      body.highestRunP1 = highestRunP1;
      body.highestRunP2 = highestRunP2;
    }
    await updateAccountMatch(getServerUrl(), getToken(), startEventId, body);
    matchModalBusy = false;
    closeMatchModal();
    await loadAccountStats(true);
  } catch (err) {
    setDashMatchModalBusy(false);
    setMatchModalError(err.message);
  }
}

async function abandonInProgressMatch(startEventId) {
  const id = String(startEventId || '').trim();
  if (!id) return;
  const match = findMatchByStartId(id);
  const room = match && match.roomId
    ? (lastDashboardRooms || []).find((r) => r && r.id === match.roomId)
    : null;
  const dockOnline = !!(room && room.dock_connected);
  const confirmMsg = dockOnline
    ? 'Kill this unfinished match? It will be removed from cloud stats and the live dock will clear the game (no winner recorded).'
    : 'Kill this unfinished match? It will be removed from cloud stats (no winner recorded). No live dock is connected — if a dock still has this match open, clear it there.';
  const ok = await confirmStatsMutation({
    title: 'Kill Match',
    message: confirmMsg,
    confirmLabel: 'Kill Match',
    danger: true,
    entity: match,
    requireConfirm: true,
  });
  if (!ok) return;
  try {
    setError('');
    await deleteAccountMatch(getServerUrl(), getToken(), id);
    await loadAccountStats(true);
  } catch (err) {
    setError(err.message);
  }
}

async function deleteMatchFromModal() {
  if (matchModalBusy) return;
  const startEventId = document.getElementById('statsMatchEventId')?.value;
  if (!startEventId) return;
  const match = findMatchByStartId(startEventId);
  const ok = await confirmStatsMutation({
    title: 'Delete Match',
    message: 'Delete this match from cloud stats? This cannot be undone.',
    confirmLabel: 'Delete Match',
    danger: true,
    entity: match,
    requireConfirm: true,
  });
  if (!ok) return;
  setDashMatchModalBusy(true, 'delete');
  try {
    await deleteAccountMatch(getServerUrl(), getToken(), startEventId);
    matchModalBusy = false;
    closeMatchModal();
    await loadAccountStats(true);
  } catch (err) {
    setDashMatchModalBusy(false);
    setMatchModalError(err.message);
  }
}

async function loadAccountStats(force = false) {
  if (statsLoading) {
    if (force) statsRefreshQueued = true;
    return;
  }
  if (statsLoaded && !force) {
    renderAccountStats();
    return;
  }
  const token = getToken();
  if (!token) return;
  statsLoading = true;
  setStatsRefreshBusy(true);
  const statusEl = document.getElementById('statsStatus');
  if (statusEl) {
    statusEl.textContent = isViewingOtherAccount()
      ? `Loading stats for ${getPlatformViewAccountLabel()}…`
      : 'Loading cloud stats…';
  }
  let loadOk = false;
  try {
    if (isViewingAllAccounts()) {
      statsData = await adminFetchJson('/api/admin/stats?accountLimit=200&limitPerAccount=500');
    } else if (isViewingOtherAccount()) {
      statsData = await adminFetchJson(
        `/api/admin/accounts/${encodeURIComponent(platformViewAccountId)}/stats`
      );
    } else {
      statsData = await fetchAccountStats(getServerUrl(), token);
    }
    statsLoaded = true;
    rebuildEventInfoCache(statsData);
    loadOk = true;
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || 'Could not load cloud stats.';
  } finally {
    statsLoading = false;
    setStatsRefreshBusy(false);
    // Render after clearing the loading flag so status text can be replaced.
    if (loadOk && statsData) renderAccountStats();
    if (statsRefreshQueued) {
      statsRefreshQueued = false;
      loadAccountStats(true);
    }
  }
}

/** Debounced stats reload when the live tables feed signals match/session changes. */
function scheduleAccountStatsRefreshFromLiveFeed() {
  if (!getToken() || isViewingOtherAccount()) return;
  const statsTab = document.getElementById('tabStats');
  const statsTabVisible = !!(statsTab && !statsTab.classList.contains('hidden'));
  // Keep Recent Matches warm once opened, and always while Stats is visible.
  if (!statsLoaded && !statsTabVisible) return;
  if (statsRefreshTimer) clearTimeout(statsRefreshTimer);
  statsRefreshTimer = setTimeout(() => {
    statsRefreshTimer = null;
    loadAccountStats(true);
  }, 350);
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
  stopPlatformTablesPolling();
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

function liveFeedIsOpen() {
  return !!(dashClient && typeof dashClient.isOpen === 'function' && dashClient.isOpen());
}

/**
 * Reconnect the dashboard live feed after mobile backgrounding / network drops.
 * Mobile browsers often leave a zombie socket (connected=true, no onclose).
 */
function ensureLiveFeed(options = {}) {
  if (!wantLiveFeed || !getToken()) return;
  const force = !!(options && options.force);
  if (!force && liveFeedIsOpen()) return;
  clearReconnect();
  reconnectAttempt = 0;
  connectLiveFeed().catch(() => {});
}

async function connectLiveFeed() {
  let token = getToken();
  if (!wantLiveFeed || !token) return;
  if (dashPublicConfigCache) {
    token = await getFreshAccessToken(dashPublicConfigCache) || token;
  }
  if (!token) return;

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
    ownDashboardRooms = rooms || [];
    if (isViewingOtherAccount()) {
      // Live feed is for the signed-in account; keep Settings connections fresh only.
      renderDebugRooms(ownDashboardRooms);
      return;
    }
    lastDashboardRooms = rooms || [];
    renderTableCards(rooms);
    renderDebugRooms(rooms);
    scheduleAccountStatsRefreshFromLiveFeed();
  });
  client.on('error', (e) => {
    if (
      e.code === 'account_deleting'
      || e.code === 'account_blocked'
      || e.code === 'invalid_token'
      || e.code === 'room_forbidden'
      || e.code === 'session_revoked'
    ) {
      localSignOut({ redirectHome: true });
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

async function applyDashboardMe(me) {
  lastAccount = me.account || null;
  const emailEl = document.getElementById('userEmail');
  if (emailEl) emailEl.textContent = me.account.email;
  canSimulatePlanUser = !!(me.can_simulate_plan || me.is_platform_admin || dashPublicConfigCache?.allowDevAuth);
  setPlatformAdminUi(!!me.is_platform_admin);
  setActiveDashTab(localStorage.getItem(DASH_TAB_KEY) || 'tables');
  renderQuota(me.quota, me.account);
  syncSimulatedPlanSelect(me);
  renderApiKeys(me.api_keys);
  await refreshBillingUi(me.account, me.billing);
  ownDashboardRooms = me.rooms || [];
  if (isViewingOtherAccount()) {
    await refreshTablesForCurrentView();
  } else {
    lastDashboardRooms = me.rooms || [];
    renderTableCards(me.rooms);
    renderDebugRooms(me.rooms);
  }
  if (isPlatformAdminUser) {
    await loadPlatformAccountFilterOptions().catch(() => {});
  }
  show('loginSection', false);
  show('dashboardSection', true);
  finishDashboardBoot();
  wantLiveFeed = true;
  clearReconnect();
  connectLiveFeed().catch(() => {});
  syncPlatformTablesPolling();
  await consumeSubscribeIntent(me.account);
}

async function renderDashboard() {
  let token = getToken();
  if (!token) {
    stopLiveFeed();
    lastTablesFingerprint = '';
    lastAccount = null;
    setPlatformAdminUi(false);
    finishDashboardBoot();
    show('loginSection', true);
    show('dashboardSection', false);
    return;
  }
  try {
    if (dashPublicConfigCache) {
      token = await getFreshAccessToken(dashPublicConfigCache) || token;
    }
    const me = await fetchMe(getServerUrl(), token);
    await applyDashboardMe(me);
  } catch (err) {
    const msg = String(err?.message || '');
    if (dashPublicConfigCache && /unauthorized|invalid|expired|token|session/i.test(msg)) {
      try {
        const refreshed = await getFreshAccessToken(dashPublicConfigCache);
        if (refreshed) {
          const me = await fetchMe(getServerUrl(), refreshed);
          await applyDashboardMe(me);
          return;
        }
      } catch (_) { /* fall through */ }
    }
    stopLiveFeed();
    setStoredAccessToken('');
    if (dashPublicConfigCache) {
      signOutSupabaseSession(dashPublicConfigCache).catch(() => {});
    }
    statsData = null;
    statsLoaded = false;
    lastAccount = null;
    setPlatformAdminUi(false);
    setError(err.message);
    finishDashboardBoot();
    show('loginSection', true);
    show('dashboardSection', false);
  }
}

function formatPlayerPreview(playerOrLastSeen) {
  if (playerOrLastSeen && typeof playerOrLastSeen === 'object') {
    const email = String(playerOrLastSeen.accountEmail || '').trim();
    const seen = formatPlayerPreview(playerOrLastSeen.last_seen_at || playerOrLastSeen.lastPlayedAt);
    return email ? `${email} · ${seen}` : seen;
  }
  const lastSeenAt = playerOrLastSeen;
  if (!lastSeenAt) return 'Saved player';
  const local = formatLocalDate(lastSeenAt);
  if (!local || local === '—') return 'Saved player';
  return `Last seen ${local}`;
}

function openPlayerFromSearch(playerOrName) {
  const input = document.getElementById('statsPlayerSearch');
  let key = '';
  let label = '';
  if (playerOrName && typeof playerOrName === 'object') {
    key = String(playerOrName.id || '').trim();
    label = String(playerOrName.name || '').trim().slice(0, 20);
    if (!key) key = label.toLowerCase();
  } else {
    label = String(playerOrName || '').trim().slice(0, 20);
    const players = statsFromMatches(completedMatches(statsData || {})).players
      .filter((p) => String(p.name || '').toLowerCase() === label.toLowerCase());
    key = players.length === 1 ? players[0].id : label.toLowerCase();
  }
  if (input) input.value = label;
  selectedPlayerKey = key;
  playerDetailOpponentFilter = '';
  playerDetailGameFilter = '';
  playerRenameEditing = false;
  renderAccountStats();
}

function initStatsPlayerSearch() {
  const input = document.getElementById('statsPlayerSearch');
  const list = document.getElementById('statsPlayerAutocomplete');
  if (!input || !list) return;

  let debounceTimer = null;
  let activeIndex = -1;
  let results = [];

  const hideList = () => list.classList.add('hidden');
  const showList = () => list.classList.remove('hidden');

  const highlight = (index) => {
    list.querySelectorAll('.autocomplete-item').forEach((item, i) => {
      item.classList.toggle('autocomplete-active', i === index);
    });
  };

  const applyFreeTextFilter = () => {
    statsPlayerFilterId = '';
    applyOverviewFiltersChanged();
  };

  const refresh = async (options = {}) => {
    const browseAll = !!options.browseAll;
    const query = input.value.trim();
    if (!query && !browseAll) {
      hideList();
      list.innerHTML = '';
      applyFreeTextFilter();
      return;
    }
    applyFreeTextFilter();
    try {
      const found = browseAll
        ? await resolvePlayersSearch('', 250)
        : await resolvePlayersSearch(query, 8);
      results = found || [];
      activeIndex = -1;
      list.innerHTML = '';
      list.classList.toggle('autocomplete-browse', browseAll);

      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'autocomplete-item autocomplete-new';
        empty.textContent = query
          ? `No roster match — filtering for “${query}”`
          : 'No saved players yet.';
        list.appendChild(empty);
        showList();
        return;
      }

      results.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.dataset.index = String(index);
        item.innerHTML = `<span class="autocomplete-name">${escapeHtml(player.name)}</span>`
          + `<span class="autocomplete-preview">${escapeHtml(formatPlayerPreview(player))}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          applyPlayerNameFilter(player);
          hideList();
        });
        list.appendChild(item);
      });
      showList();
      if (browseAll) list.scrollTop = 0;
    } catch (err) {
      console.error('Player search error:', err);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => refresh(), 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) refresh();
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
        const query = input.value.trim();
        if (query) applyPlayerNameFilter(query);
        else applyFreeTextFilter();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, results.length - 1);
      highlight(activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex < 0 ? results.length - 1 : Math.max(activeIndex - 1, 0);
      highlight(activeIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        applyPlayerNameFilter(results[activeIndex]);
        hideList();
      } else if (input.value.trim()) {
        applyPlayerNameFilter(input.value.trim());
        hideList();
      }
    } else if (e.key === 'Escape') {
      hideList();
    }
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) hideList();
  });
}

function initStatsEventSearch() {
  const input = document.getElementById('statsEventSearch');
  const list = document.getElementById('statsEventAutocomplete');
  if (!input || !list) return;

  let debounceTimer = null;
  let activeIndex = -1;
  let results = [];

  const hideList = () => list.classList.add('hidden');
  const showList = () => list.classList.remove('hidden');

  const highlight = (index) => {
    list.querySelectorAll('.autocomplete-item').forEach((item, i) => {
      item.classList.toggle('autocomplete-active', i === index);
    });
  };

  const applyEventFilter = (value) => {
    input.value = String(value || '').trim().slice(0, 60);
    applyOverviewFiltersChanged();
  };

  const refresh = (options = {}) => {
    const browseAll = !!options.browseAll;
    const query = input.value.trim().toLowerCase();
    if (!query && !browseAll) {
      hideList();
      list.innerHTML = '';
      applyOverviewFiltersChanged();
      return;
    }
    applyOverviewFiltersChanged();
    results = (cachedEventInfoOptions || []).filter((info) =>
      !query || String(info).toLowerCase().includes(query)
    ).slice(0, browseAll ? 250 : 12);
    activeIndex = -1;
    list.innerHTML = '';
    list.classList.toggle('autocomplete-browse', browseAll);

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'autocomplete-item autocomplete-new';
      empty.textContent = query
        ? `No event match — filtering for “${input.value.trim()}”`
        : 'No event labels in loaded matches.';
      list.appendChild(empty);
      showList();
      return;
    }

    results.forEach((info, index) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.index = String(index);
      item.innerHTML = `<span class="autocomplete-name">${escapeHtml(info)}</span>`;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyEventFilter(info);
        hideList();
      });
      list.appendChild(item);
    });
    showList();
    if (browseAll) list.scrollTop = 0;
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => refresh(), 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim() || cachedEventInfoOptions.length) refresh({ browseAll: !input.value.trim() });
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
        applyEventFilter(input.value);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, results.length - 1);
      highlight(activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex < 0 ? results.length - 1 : Math.max(activeIndex - 1, 0);
      highlight(activeIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        applyEventFilter(results[activeIndex]);
        hideList();
      } else {
        applyEventFilter(input.value);
        hideList();
      }
    } else if (e.key === 'Escape') {
      hideList();
    }
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) hideList();
  });
}

function initStatsOverviewFilters() {
  initStatsPlayerSearch();
  initStatsEventSearch();
  const fromInput = document.getElementById('statsDateFrom');
  const toInput = document.getElementById('statsDateTo');

  const syncDateClearButtons = () => {
    document.querySelectorAll('.stats-date-clear[data-clear-date]').forEach((btn) => {
      const input = document.getElementById(btn.getAttribute('data-clear-date') || '');
      btn.hidden = !(input && input.value);
    });
  };

  const onDateChange = () => {
    syncDateClearButtons();
    applyOverviewFiltersChanged();
  };
  fromInput?.addEventListener('change', onDateChange);
  fromInput?.addEventListener('input', syncDateClearButtons);
  toInput?.addEventListener('change', onDateChange);
  toInput?.addEventListener('input', syncDateClearButtons);

  document.querySelectorAll('.stats-date-clear[data-clear-date]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById(btn.getAttribute('data-clear-date') || '');
      if (!input || !input.value) return;
      input.value = '';
      syncDateClearButtons();
      applyOverviewFiltersChanged();
    });
  });
  syncDateClearButtons();
  syncStatsClearFiltersBtn();

  document.getElementById('statsClearFiltersBtn')?.addEventListener('click', () => {
    if (!overviewFiltersActive()) return;
    clearOverviewFilters();
  });
  document.getElementById('statsRefreshBtn')?.addEventListener('click', () => {
    if (statsLoading) return;
    loadAccountStats(true);
  });
}

document.querySelectorAll('.dash-tab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveDashTab(tab.dataset.tab));
});

document.getElementById('adminAccountSearch')?.addEventListener('input', () => {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => {
    if (document.getElementById('tabAdmin')?.classList.contains('hidden')) return;
    loadAdminAccounts();
  }, 250);
});

document.getElementById('platformAccountFilter')?.addEventListener('change', (event) => {
  applyPlatformAccountFilter(event.target.value || '').catch((err) => {
    setError(err.message || 'Failed to switch account view');
  });
});

document.getElementById('adminAccountsBody')?.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-admin-account-id]');
  if (!row) return;
  loadAdminAccountDetail(row.getAttribute('data-admin-account-id'));
});

document.getElementById('adminAccountsBody')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('tr[data-admin-account-id]');
  if (!row) return;
  event.preventDefault();
  loadAdminAccountDetail(row.getAttribute('data-admin-account-id'));
});

document.getElementById('adminDetailCloseBtn')?.addEventListener('click', () => closeAdminDetail());

document.getElementById('adminDetailBody')?.addEventListener('submit', async (event) => {
  if (event.target?.id === 'adminDeleteAccountForm') {
    event.preventDefault();
    const confirmEmail = String(document.getElementById('adminDeleteConfirmEmail')?.value || '').trim();
    const blockFutureSignups = !!document.getElementById('adminDeleteBlockEmail')?.checked;
    const allowAnotherTrial = !!document.getElementById('adminDeleteAllowTrial')?.checked;
    try {
      await adminDeleteSelectedAccount(confirmEmail, blockFutureSignups, allowAnotherTrial);
    } catch (err) {
      setAdminStatus(err.message || 'Failed to delete account');
      if (adminSelectedId) await loadAdminAccountDetail(adminSelectedId).catch(() => {});
    }
    return;
  }
  if (event.target?.id !== 'adminGrantTrialForm') return;
  event.preventDefault();
  const days = parseInt(document.getElementById('adminTrialDays')?.value, 10);
  const tier = document.getElementById('adminComplimentaryTier')?.value || 'streamer';
  try {
    await adminGrantTrial(days, tier);
  } catch (err) {
    setAdminStatus(err.message || 'Failed to give complimentary access');
  }
});

document.getElementById('adminUnblockEmailForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('adminUnblockEmail');
  const email = String(input?.value || '').trim();
  try {
    await adminUnblockEmail(email);
    if (input) input.value = '';
  } catch (err) {
    setAdminStatus(err.message || 'Failed to unblock email');
  }
});

document.getElementById('adminDetailBody')?.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  try {
    if (target.id === 'adminViewAccountDataBtn') {
      if (!adminSelectedId) return;
      await applyPlatformAccountFilter(adminSelectedId);
      setActiveDashTab('stats');
    } else if (target.id === 'adminEndTrialBtn') {
      await adminEndTrial();
    } else if (target.id === 'adminInvalidateSessionsBtn') {
      await adminInvalidateSelectedSessions();
    } else if (target.dataset.adminRevokeKey) {
      await adminRevokeKey(target.dataset.adminRevokeKey);
    }
  } catch (err) {
    setAdminStatus(err.message || 'Admin action failed');
  }
});

function setActiveStatsPanel(which) {
  const panel = which === 'leaderboard' ? 'leaderboard' : 'matches';
  document.querySelectorAll('.stats-subtab').forEach((tab) => {
    const active = tab.dataset.statsPanel === panel;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.getElementById('statsPanelLeaderboard')?.classList.toggle('hidden', panel !== 'leaderboard');
  document.getElementById('statsPanelMatches')?.classList.toggle('hidden', panel !== 'matches');
}

document.querySelectorAll('.stats-subtab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveStatsPanel(tab.dataset.statsPanel));
});

document.getElementById('statsPanelLeaderboard')?.addEventListener('click', (event) => {
  const pageBtn = event.target.closest('[data-leaderboard-page]');
  if (pageBtn && !pageBtn.disabled) {
    event.preventDefault();
    setLeaderboardPage(pageBtn.getAttribute('data-leaderboard-page'));
    return;
  }
  const th = event.target.closest('th[data-sort-key]');
  if (!th) return;
  event.preventDefault();
  setLeaderboardSort(th.getAttribute('data-sort-key'));
});

document.getElementById('statsPanelMatches')?.addEventListener('click', (event) => {
  const pageBtn = event.target.closest('[data-matches-page]');
  if (pageBtn && !pageBtn.disabled) {
    event.preventDefault();
    setMatchesPage(pageBtn.getAttribute('data-matches-page'));
  }
});

document.getElementById('statsPlayerBackBtn')?.addEventListener('click', () => {
  selectedPlayerKey = '';
  playerDetailOpponentFilter = '';
  playerDetailGameFilter = '';
  playerRenameEditing = false;
  renderAccountStats();
});
document.getElementById('statsPlayerOpponentFilter')?.addEventListener('change', (event) => {
  playerDetailOpponentFilter = event.target.value || '';
  renderPlayerDetail();
});
document.getElementById('statsPlayerGameFilter')?.addEventListener('change', (event) => {
  playerDetailGameFilter = event.target.value || '';
  renderPlayerDetail();
});
document.getElementById('statsPlayerRenameEditBtn')?.addEventListener('click', () => {
  const rename = document.getElementById('statsPlayerRenameInput');
  const title = document.getElementById('statsPlayerTitle');
  if (rename && title) rename.value = title.textContent || '';
  setPlayerRenameEditing(true);
});
document.getElementById('statsPlayerRenameCancelBtn')?.addEventListener('click', () => {
  const form = document.getElementById('statsPlayerRenameForm');
  if (form?.dataset.busy === '1') return;
  const rename = document.getElementById('statsPlayerRenameInput');
  const title = document.getElementById('statsPlayerTitle');
  if (rename && title) rename.value = title.textContent || '';
  setPlayerRenameEditing(false);
});
document.getElementById('statsPlayerRenameForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form?.dataset.busy === '1') return;
  const fromName = statsPlayerDisplayName(selectedPlayerKey);
  const toName = document.getElementById('statsPlayerRenameInput')?.value.trim();
  if (!fromName || !toName) return;
  const player = findStatsPlayer(selectedPlayerKey);
  const ok = await confirmStatsMutation({
    title: 'Rename Player',
    message: `Rename “${fromName}” to “${toName}” in cloud stats?`,
    confirmLabel: 'Rename',
    entity: player,
    requireConfirm: false,
  });
  if (!ok) return;
  const input = document.getElementById('statsPlayerRenameInput');
  const saveBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = document.getElementById('statsPlayerRenameCancelBtn');
  const setBusy = (busy) => {
    form.dataset.busy = busy ? '1' : '0';
    form.classList.toggle('is-busy', !!busy);
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (input) input.disabled = !!busy;
    if (saveBtn) {
      saveBtn.disabled = !!busy;
      saveBtn.textContent = busy ? 'Saving…' : 'Save';
    }
    if (cancelBtn) cancelBtn.disabled = !!busy;
  };
  try {
    setBusy(true);
    const result = await renameAccountPlayer(getServerUrl(), getToken(), selectedPlayerKey, toName);
    selectedPlayerKey = result?.id || selectedPlayerKey;
    playerRenameEditing = false;
    await loadAccountStats(true);
    const updated = Number(result?.updated) || 0;
    const statusEl = document.getElementById('statsStatus');
    if (statusEl) {
      statusEl.textContent = updated === 1
        ? `Renamed ${fromName} → ${toName} in 1 match.`
        : `Renamed ${fromName} → ${toName} in ${updated} matches.`;
    }
  } catch (err) {
    setError(err.message);
  } finally {
    setBusy(false);
  }
});
document.getElementById('statsPlayerDeleteBtn')?.addEventListener('click', async () => {
  if (!selectedPlayerKey) return;
  const playerName = statsPlayerDisplayName(selectedPlayerKey);
  const player = findStatsPlayer(selectedPlayerKey);
  const matchCount = playerMatches(selectedPlayerKey).length;
  const matchLabel = matchCount === 1 ? '1 match' : `${matchCount} matches`;
  const ok = await confirmStatsMutation({
    title: 'Delete Player',
    message:
      `Delete “${playerName}” and ${matchLabel} from cloud stats?\n\n` +
      'This cannot be undone. The player is removed from the account roster and every match involving them is deleted.',
    confirmLabel: 'Delete Player',
    danger: true,
    entity: player,
    requireConfirm: true,
  });
  if (!ok) return;
  const ok2 = await confirmStatsMutation({
    title: 'Confirm Delete',
    message: `Are you absolutely sure you want to permanently delete “${playerName}”?`,
    confirmLabel: 'Delete Permanently',
    danger: true,
    entity: player,
    requireConfirm: true,
  });
  if (!ok2) return;
  try {
    const result = await deleteAccountPlayer(getServerUrl(), getToken(), selectedPlayerKey);
    selectedPlayerKey = '';
    playerRenameEditing = false;
    await loadAccountStats(true);
    const deleted = Number(result?.deletedMatches) || 0;
    const statusEl = document.getElementById('statsStatus');
    if (statusEl) {
      statusEl.textContent = deleted === 1
        ? `Deleted ${playerName} and 1 match from cloud stats.`
        : `Deleted ${playerName} and ${deleted} matches from cloud stats.`;
    }
  } catch (err) {
    setError(err.message);
  }
});
document.getElementById('tabStats')?.addEventListener('click', (event) => {
  const abandonBtn = event.target.closest('[data-abandon-match]');
  if (abandonBtn) {
    event.preventDefault();
    abandonInProgressMatch(abandonBtn.getAttribute('data-abandon-match'));
    return;
  }
  const editBtn = event.target.closest('[data-edit-match]');
  if (editBtn) {
    event.preventDefault();
    openMatchModal(editBtn.getAttribute('data-edit-match'));
    return;
  }
  const racksToggle = event.target.closest('[data-toggle-racks]');
  if (racksToggle) {
    event.preventDefault();
    toggleMatchRacksExpanded(racksToggle.getAttribute('data-toggle-racks'));
    return;
  }
  const openPlayerBtn = event.target.closest('[data-open-player]');
  if (openPlayerBtn) {
    event.preventDefault();
    openPlayerFromSearch(openPlayerBtn.getAttribute('data-open-player') || '');
    return;
  }
  const row = event.target.closest('tr[data-player-id]');
  if (row) {
    selectedPlayerKey = row.getAttribute('data-player-id') || '';
    playerDetailOpponentFilter = '';
    playerDetailGameFilter = '';
    playerRenameEditing = false;
    renderAccountStats();
  }
});
document.getElementById('statsMatchForm')?.addEventListener('submit', saveMatchModal);
document.getElementById('statsMatchForm')?.addEventListener('input', () => {
  syncMatchModalPlayerLabels();
  syncMatchModalSaveEnabled();
});
document.getElementById('statsMatchForm')?.addEventListener('change', syncMatchModalSaveEnabled);
document.getElementById('statsMatchCancelBtn')?.addEventListener('click', () => {
  if (matchModalBusy) return;
  closeMatchModal();
});
document.getElementById('statsMatchDeleteBtn')?.addEventListener('click', deleteMatchFromModal);
document.getElementById('statsMatchGameType')?.addEventListener('change', (event) => {
  const preserved = preserveDashRackEditorRows();
  renderDashMatchRacksEditor(preserved.length ? preserved : collectDashMatchRacksFromEditor());
  syncMatchExtrasVisibility(event.target.value);
  syncMatchModalSaveEnabled();
});
['statsMatchScoreP1', 'statsMatchScoreP2', 'statsMatchHrP1', 'statsMatchHrP2'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => {
    updateDashMatchScoreSummary();
    syncMatchModalSaveEnabled();
  });
});
document.getElementById('statsMatchAddRackBtn')?.addEventListener('click', () => {
  const preserved = preserveDashRackEditorRows();
  preserved.push({ winnerId: '' });
  renderDashMatchRacksEditor(preserved);
  syncMatchModalSaveEnabled();
});
document.getElementById('statsMatchModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'statsMatchModal') closeMatchModal();
});

async function submitDevLogin() {
  setError('');
  const secretEl = document.getElementById('devSecret');
  // Read after a tick so iOS password autofill has committed into .value
  await new Promise((r) => setTimeout(r, 0));
  const secret = secretEl ? String(secretEl.value || '').trim() : '';
  if (!secret) return setError('Dev auth secret required');
  const btn = document.getElementById('devLoginBtn');
  if (btn) btn.disabled = true;
  try {
    // Drop any prior session so a half-broken token cannot fight the new login.
    setStoredAccessToken('');
    if (dashPublicConfigCache) {
      await signOutSupabaseSession(dashPublicConfigCache).catch(() => {});
    }
    stopLiveFeed();
    const data = await devLogin(getServerUrl(), secret);
    setStoredAccessToken(data.access_token);
    localStorage.setItem(SERVER_KEY, getServerUrl());
    lastTablesFingerprint = '';
    await renderDashboard();
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? 'Login timed out — check your connection and try again.'
      : (err && err.message) || 'Dev login failed';
    // fetch() network failures often surface as TypeError: Failed to fetch
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      setError('Could not reach this server. Clear site data if login keeps failing, then retry.');
    } else {
      setError(msg);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.getElementById('devLoginBtn').addEventListener('click', () => {
  submitDevLogin();
});
document.getElementById('devSecret')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitDevLogin();
  }
});

(function bindDevSecretToggle() {
  const input = document.getElementById('devSecret');
  const toggle = document.getElementById('devSecretToggle');
  if (!input || !toggle) return;
  function syncToggle() {
    const revealed = input.type === 'text';
    toggle.innerHTML = dashActionIcon(revealed ? 'eyeClosed' : 'eyeOpen');
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

document.getElementById('createKeyBtn').addEventListener('click', () => {
  openDockKeyModal({ mode: 'create' });
});

async function createImpromptuTableFromDashboard() {
  const gate = getImpromptuCreateGate();
  if (gate.mode === 'needs_plan' || gate.mode === 'at_limit') {
    openSubscriptionUpgradePrompt();
    return;
  }
  if (gate.mode !== 'create') {
    setError('Ad-hoc tables are unavailable — check your plan or seat limit.');
    return;
  }
  const buttons = Array.from(document.querySelectorAll('.table-card-create'));
  buttons.forEach((btn) => { btn.disabled = true; });
  try {
    setError('');
    const result = await createImpromptuRoom(getServerUrl(), getToken(), 'Ad-hoc Table');
    if (result.quota) renderQuota(result.quota, lastAccount);
    const roomId = result.room?.id;
    if (!roomId) throw new Error('Table created but no id returned');
    window.location.href = `${getServerUrl().replace(/\/$/, '')}/m/${roomId}?tab=setup`;
  } catch (err) {
    setError(err.message || 'Could not create ad-hoc table');
    if (lastQuota) renderQuota(lastQuota, lastAccount);
    else syncCreateImpromptuCardState();
  }
}

document.getElementById('createImpromptuCard')?.addEventListener('click', () => {
  createImpromptuTableFromDashboard();
});
document.getElementById('tableCards')?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action="create-impromptu"], [data-action="upgrade-impromptu"]');
  if (!btn) return;
  event.preventDefault();
  createImpromptuTableFromDashboard();
});

document.getElementById('revokeAllDockKeysBtn')?.addEventListener('click', async () => {
  const revokeAllBtn = document.getElementById('revokeAllDockKeysBtn');
  const notice = document.getElementById('keyRevokeNotice');
  const activeBefore = activeDockKeys.length;
  const ok = await confirmDashAction({
    title: 'Revoke All OBS Dock Keys',
    message:
      'Revoke every OBS Dock Key on this account?\n\n' +
      'All connected docks will be disconnected and their tables removed from the dashboard. The revoked keys cannot be recovered; create and paste new keys to reconnect.',
    confirmLabel: 'Revoke All Keys',
    danger: true,
  });
  if (!ok) return;
  if (revokeAllBtn) revokeAllBtn.disabled = true;
  if (notice) {
    notice.textContent = 'Revoking all OBS Dock Keys…';
    notice.classList.remove('hidden');
  }
  try {
    setError('');
    const result = await revokeAllApiKeys(getServerUrl(), getToken());
    if (result.quota) renderQuota(result.quota, lastAccount);
    // A successful bulk endpoint revokes every key. Clear immediately even if
    // an older server omitted api_keys from its response.
    renderApiKeys(Array.isArray(result.api_keys) ? result.api_keys : []);
    if (Array.isArray(result.rooms)) {
      ownDashboardRooms = result.rooms;
      lastDashboardRooms = result.rooms;
      renderTableCards(result.rooms);
      renderDebugRooms(result.rooms);
    }
    const revoked = Number(result.revoked) || 0;
    const kicked = Number(result.kicked) || 0;
    const roomsDeleted = Number(result.rooms_deleted) || 0;
    if (notice) {
      notice.textContent = revoked
        ? `Revoked ${revoked} OBS Dock Key${revoked === 1 ? '' : 's'}, disconnected ${kicked} dock${kicked === 1 ? '' : 's'}, and removed ${roomsDeleted} table${roomsDeleted === 1 ? '' : 's'}.`
        : 'No active OBS Dock Keys to revoke.';
      notice.classList.remove('hidden');
    }
  } catch (err) {
    // Revocation is committed before dock/table cleanup. If cleanup failed and
    // the endpoint returned 500, refresh so successfully revoked keys still
    // disappear rather than leaving a stale list.
    try {
      const me = await fetchMe(getServerUrl(), getToken());
      const keys = Array.isArray(me.api_keys) ? me.api_keys : [];
      renderApiKeys(keys);
      if (me.quota) renderQuota(me.quota, me.account || lastAccount);
      if (Array.isArray(me.rooms)) {
        ownDashboardRooms = me.rooms;
        lastDashboardRooms = me.rooms;
        renderTableCards(me.rooms);
        renderDebugRooms(me.rooms);
      }
      if (activeBefore > 0 && keys.length === 0) {
        if (notice) {
          notice.textContent = `Revoked ${activeBefore} OBS Dock Key${activeBefore === 1 ? '' : 's'}. Some disconnected table cleanup may still be completing.`;
          notice.classList.remove('hidden');
        }
        return;
      }
    } catch (_) {
      // Report the original revoke failure when the authoritative refresh also fails.
    }
    if (notice) {
      notice.textContent = `Could not revoke all OBS Dock Keys: ${err.message}`;
      notice.classList.remove('hidden');
    }
    setError(err.message);
  } finally {
    if (revokeAllBtn) revokeAllBtn.disabled = !activeDockKeys.length;
  }
});
document.getElementById('simulatedPlanSelect')?.addEventListener('change', onSimulatedPlanChange);
document.getElementById('dashCreateKeyCancelBtn')?.addEventListener('click', () => closeDockKeyModal());
document.getElementById('dashCreateKeySubmitBtn')?.addEventListener('click', () => submitDockKeyModal());
document.getElementById('dashCreateKeyRole')?.addEventListener('change', (event) => {
  updateDockKeyRoleDescription(event.target.value);
});
document.getElementById('dashCreateKeyLabel')?.addEventListener('input', () => {
  setDockKeyModalError('');
});
document.getElementById('dashCreateKeyLabel')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitDockKeyModal();
  }
});

document.getElementById('signOutBtn')?.addEventListener('click', async () => {
  const ok = await confirmDashAction({
    title: 'Sign Out',
    message: 'Sign out of this dashboard on this device?',
    confirmLabel: 'Sign Out',
  });
  if (!ok) return;
  localSignOut({ clearServer: true, redirectHome: true });
});

document.getElementById('invalidateSessionsBtn')?.addEventListener('click', async () => {
  const ok = await confirmDashAction({
    title: 'Clear All Logins',
    message:
      'Clear every saved login and sign out all devices?\n\n' +
      'This dashboard, other admin browsers, and admin mobile control will be signed out and disconnected. ' +
      'All guest links will be revoked and anyone using them will be disconnected ' +
      '(including each table’s default OBS Dock Owner link — those are recreated when needed). ' +
      'OBS Dock Keys are not revoked.',
    confirmLabel: 'Clear All Logins',
    danger: true,
  });
  if (!ok) return;
  try {
    await invalidateAllSessions(getServerUrl(), getToken());
  } catch (err) {
    setError(err.message);
    return;
  }
  localSignOut({ redirectHome: true });
});

document.getElementById('revokeAllGuestsBtn')?.addEventListener('click', async () => {
  const ok = await confirmDashAction({
    title: 'Revoke all guest links',
    message:
      'Revoke every guest link on this account and disconnect anyone using them?\n\n' +
      'This includes named scoring-only guest links and each table’s default OBS Dock Owner link (elevated Stream/Share access).\n\n' +
      'Default OBS Dock Owner links are recreated the next time that table’s dock or Share flow needs them.',
    confirmLabel: 'Revoke all',
    danger: true,
  });
  if (!ok) return;
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

document.addEventListener('click', (event) => {
  const link = event.target?.closest?.('a.dash-account-link');
  if (!link) return;
  event.preventDefault();
  setActiveDashTab(isPlatformAdminUser ? 'admin' : 'account');
  document.getElementById('billingPanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
});

document.getElementById('dashConfirmOkBtn')?.addEventListener('click', () => closeDashConfirm(true));
document.getElementById('dashConfirmCancelBtn')?.addEventListener('click', () => closeDashConfirm(false));
document.getElementById('dashConfirmModal')?.addEventListener('click', (event) => {
  if (event.target && event.target.id === 'dashConfirmModal') closeDashConfirm(false);
});
document.getElementById('dashShareKeyNativeBtn')?.addEventListener('click', () => shareApiKeyViaChannel('native'));
document.getElementById('dashShareKeyEmailBtn')?.addEventListener('click', () => shareApiKeyViaChannel('email'));
document.getElementById('dashShareKeySmsBtn')?.addEventListener('click', () => shareApiKeyViaChannel('sms'));
document.getElementById('dashShareKeyCopyBtn')?.addEventListener('click', () => shareApiKeyViaChannel('copy'));
document.getElementById('dashShareKeyCloseBtn')?.addEventListener('click', () => closeDashShareKeyModal());
document.getElementById('dashShareKeyModal')?.addEventListener('click', (event) => {
  if (event.target && event.target.id === 'dashShareKeyModal') closeDashShareKeyModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // Prefer the top-most dialog.
  const confirmModal = document.getElementById('dashConfirmModal');
  if (confirmModal && !confirmModal.classList.contains('hidden')) {
    event.preventDefault();
    closeDashConfirm(false);
    return;
  }
  const shareModal = document.getElementById('dashShareKeyModal');
  if (shareModal && !shareModal.classList.contains('hidden')) {
    event.preventDefault();
    closeDashShareKeyModal();
  }
});

async function startGoogleOAuthRedirect() {
  const config = await fetchPublicConfig(getServerUrl());
  if (config.supabaseUrl && config.supabasePublishableKey) {
    window.location.href = `${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.href)}`;
  } else {
    setError('Google OAuth is not configured on this server.');
  }
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1' || window.google?.accounts?.id) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

let dashPublicConfigCache = null;
let gsiButtonInitialized = false;

async function handleGoogleCredentialResponse(response) {
  setError('');
  const config = dashPublicConfigCache || await fetchPublicConfig(getServerUrl());
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    setError('Google sign-in is not configured on this server.');
    return;
  }
  if (!response?.credential) {
    setError('Google sign-in did not return a credential.');
    return;
  }
  try {
    stopLiveFeed();
    await signInWithGoogleIdToken(config, response.credential);
    localStorage.setItem(SERVER_KEY, getServerUrl());
    lastTablesFingerprint = '';
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
    await renderDashboard();
  } catch (err) {
    setError(err?.message || 'Google sign-in failed');
  }
}

/**
 * Official Sign in with Google button via GIS renderButton.
 * @see https://developers.google.com/identity/gsi/web/guides/display-button
 * Requires GOOGLE_OAUTH_CLIENT_ID. Falls back to Supabase OAuth redirect otherwise.
 */
async function initOfficialGoogleButton(config) {
  const mount = document.getElementById('googleBtnMount');
  const fallback = document.getElementById('googleBtn');
  if (!mount || !fallback) return;

  const canUseGis = !!(config?.googleOAuthClientId && config?.supabaseUrl && config?.supabasePublishableKey);
  if (!canUseGis) {
    mount.hidden = true;
    mount.replaceChildren();
    fallback.classList.remove('hidden');
    gsiButtonInitialized = false;
    return;
  }

  try {
    await loadScriptOnce('https://accounts.google.com/gsi/client');
    if (!window.google?.accounts?.id) {
      throw new Error('Google Identity Services failed to load');
    }
    if (!gsiButtonInitialized) {
      window.google.accounts.id.initialize({
        client_id: config.googleOAuthClientId,
        callback: handleGoogleCredentialResponse,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      gsiButtonInitialized = true;
    }
    mount.hidden = false;
    mount.replaceChildren();
    const width = Math.min(320, Math.floor(mount.getBoundingClientRect().width || mount.parentElement?.clientWidth || 320));
    window.google.accounts.id.renderButton(mount, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.max(240, width),
    });
    fallback.classList.add('hidden');
  } catch (err) {
    console.warn('Official Google button unavailable — using redirect fallback', err);
    mount.hidden = true;
    fallback.classList.remove('hidden');
    gsiButtonInitialized = false;
  }
}

document.getElementById('googleBtn')?.addEventListener('click', () => {
  startGoogleOAuthRedirect().catch((err) => setError(err.message || 'Google sign-in failed'));
});

document.getElementById('manageBillingBtn')?.addEventListener('click', () => {
  startPortal();
});

{
  const params = new URLSearchParams(window.location.search);
  const billing = params.get('billing');
  const subscribeEarly = String(params.get('subscribe') || '').trim();
  if (['streamer', 'tournament_organizer', 'league_director'].includes(subscribeEarly)) {
    try {
      sessionStorage.setItem('cuesport_subscribe_tier', subscribeEarly);
    } catch { /* ignore */ }
  }
  if (params.get('impromptu') === 'closed') {
    setError('');
    const notice = document.getElementById('impromptuQuotaHint');
    if (notice) notice.textContent = 'Match saved — ad-hoc table closed and seat freed.';
    params.delete('impromptu');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
  } else if (params.get('impromptu') === 'destroyed') {
    setError('');
    const notice = document.getElementById('impromptuQuotaHint');
    if (notice) notice.textContent = 'Ad-hoc table destroyed — seat freed.';
    params.delete('impromptu');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
  }
  if (billing === 'success') {
    setBillingNotice('Checkout complete — subscription status updates when Stripe confirms (usually a few seconds).');
    params.delete('billing');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
  } else if (billing === 'cancel') {
    setBillingNotice('Checkout canceled. You can choose a plan anytime.');
    params.delete('billing');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
  }
}

/** Login UI is driven by /api/config/public — not a user preference cookie. */
let dashAuthCapabilities = {
  google: false,
  selfHost: false,
  hybrid: false,
};

function setDashLoginTitle(mode) {
  const title = document.getElementById('loginSectionTitle');
  if (!title) return;
  // Managed Google auth creates accounts on first sign-in; self-host is sign-in only.
  title.textContent = mode === 'managed' ? 'Sign In/Sign Up' : 'Sign In';
}

function applyDashLoginCapabilities(config) {
  dashPublicConfigCache = config || null;
  updateAccountDeploymentType();
  const google = !!(config?.supabaseUrl && config?.supabasePublishableKey);
  // Dev secret is for self-host / lab only (ALLOW_DEV_AUTH). Official managed sets this false.
  const selfHost = !!(config?.allowDevAuth && config?.devAuthConfigured);
  dashAuthCapabilities = { google, selfHost, hybrid: google && selfHost };

  const managedPane = document.getElementById('dashLoginManagedPane');
  const selfHostPane = document.getElementById('dashLoginSelfHostPane');
  const unavailable = document.getElementById('dashLoginUnavailable');
  const selfHostWrap = document.getElementById('dashShowSelfHostWrap');
  const managedWrap = document.getElementById('dashShowManagedWrap');
  const introManaged = document.getElementById('dashManagedIntroManaged');
  const introHybrid = document.getElementById('dashManagedIntroHybrid');

  introManaged?.classList.toggle('hidden', dashAuthCapabilities.hybrid);
  introHybrid?.classList.toggle('hidden', !dashAuthCapabilities.hybrid);
  selfHostWrap?.classList.toggle('hidden', !dashAuthCapabilities.hybrid);
  managedWrap?.classList.toggle('hidden', !dashAuthCapabilities.hybrid);

  if (!google && !selfHost) {
    managedPane?.classList.add('hidden');
    selfHostPane?.classList.add('hidden');
    unavailable?.classList.remove('hidden');
    setDashLoginTitle('selfhost');
    return;
  }

  unavailable?.classList.add('hidden');
  if (google && !selfHost) {
    // Official / managed production: Google only — no self-host switch.
    managedPane?.classList.remove('hidden');
    selfHostPane?.classList.add('hidden');
    setDashLoginTitle('managed');
    initOfficialGoogleButton(config);
    return;
  }
  if (!google && selfHost) {
    // Pure self-host: server secret only.
    managedPane?.classList.add('hidden');
    selfHostPane?.classList.remove('hidden');
    setDashLoginTitle('selfhost');
    return;
  }
  // Hybrid lab: Google primary; optional switch to server secret.
  managedPane?.classList.remove('hidden');
  selfHostPane?.classList.add('hidden');
  setDashLoginTitle('managed');
  initOfficialGoogleButton(config);
}

function showDashLoginManagedPane() {
  if (!dashAuthCapabilities.google) return;
  setError('');
  document.getElementById('dashLoginManagedPane')?.classList.remove('hidden');
  document.getElementById('dashLoginSelfHostPane')?.classList.add('hidden');
  setDashLoginTitle('managed');
  if (dashPublicConfigCache) initOfficialGoogleButton(dashPublicConfigCache);
}

function showDashLoginSelfHostPane() {
  if (!dashAuthCapabilities.selfHost) return;
  setError('');
  document.getElementById('dashLoginManagedPane')?.classList.add('hidden');
  document.getElementById('dashLoginSelfHostPane')?.classList.remove('hidden');
  setDashLoginTitle('selfhost');
  document.getElementById('devSecret')?.focus();
}

document.getElementById('dashShowSelfHostLink')?.addEventListener('click', (event) => {
  event.preventDefault();
  showDashLoginSelfHostPane();
});
document.getElementById('dashShowManagedLink')?.addEventListener('click', (event) => {
  event.preventDefault();
  showDashLoginManagedPane();
});

fetchPublicConfig(getServerUrl())
  .then(async (config) => {
    applyDashLoginCapabilities(config);
    if (config?.supabaseUrl && config?.supabasePublishableKey) {
      await ensureSupabaseAuth(config);
    }
  })
  .catch(() => {
    // Keep panes hidden until config loads; show unavailable if request fails.
    applyDashLoginCapabilities({});
  });

let liveFeedHiddenAt = 0;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    liveFeedHiddenAt = Date.now();
    stopPlatformTablesPolling();
    return;
  }
  const awayMs = liveFeedHiddenAt ? Date.now() - liveFeedHiddenAt : 0;
  liveFeedHiddenAt = 0;
  // After ~15s away, sockets are often dead without onclose — force a fresh join.
  ensureLiveFeed({ force: awayMs >= 15000 });
  if (needsPlatformTablesPolling()) {
    refreshTablesForCurrentView({ silent: true }).catch(() => {});
  }
  syncPlatformTablesPolling();
});

window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) {
    ensureLiveFeed({ force: true });
  } else if (!document.hidden) {
    ensureLiveFeed();
  }
});

window.addEventListener('online', () => {
  ensureLiveFeed({ force: true });
});

if (window.location.search.includes('auth=callback') || window.location.hash.includes('access_token')) {
  (async () => {
    try {
      const config = dashPublicConfigCache || await fetchPublicConfig(getServerUrl());
      dashPublicConfigCache = config;
      await adoptOAuthHashSession(config);
    } catch (_) {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const token = params.get('access_token');
      if (token) setStoredAccessToken(token);
    }
    history.replaceState({}, '', window.location.pathname + window.location.search);
  })();
}

function initMatchPlayerAutocomplete() {
  initMatchPlayerAutocompleteForSlot('1', 'statsMatchP1', 'statsMatchP1Autocomplete');
  initMatchPlayerAutocompleteForSlot('2', 'statsMatchP2', 'statsMatchP2Autocomplete');
  ['statsMatchP1', 'statsMatchP2'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', syncMatchModalPlayerLabels);
  });
}

function normalizeMatchPlayerName(name) {
  return String(name || '').trim().toLowerCase();
}

function truncateMatchPlayerName(name) {
  return String(name || '').trim().slice(0, 20);
}

function pickMatchPlayerName(slot, playerOrName) {
  const input = document.getElementById(slot === '2' ? 'statsMatchP2' : 'statsMatchP1');
  const form = document.getElementById('statsMatchForm');
  if (!input) return;
  const name = typeof playerOrName === 'object'
    ? playerOrName?.name
    : playerOrName;
  const id = typeof playerOrName === 'object' ? (playerOrName?.id || '') : '';
  input.value = truncateMatchPlayerName(name);
  if (form) {
    if (slot === '2') form.dataset.player2Id = id;
    else form.dataset.player1Id = id;
  }
  syncMatchModalPlayerLabels();
  syncMatchModalSaveEnabled();
}

function initMatchPlayerAutocompleteForSlot(slot, inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  let activeIndex = -1;
  let results = [];
  let createNewName = null;
  let debounceTimer = null;

  const hideList = () => list.classList.add('hidden');
  const showList = () => list.classList.remove('hidden');
  const navCount = () => (createNewName ? 1 : 0) + results.length;

  const highlight = (index) => {
    list.querySelectorAll('.autocomplete-item').forEach((item, i) => {
      item.classList.toggle('autocomplete-active', i === index);
    });
  };

  const refresh = async (options = {}) => {
    const browseAll = !!options.browseAll;
    const query = input.value.trim();
    syncMatchModalPlayerLabels();
    if (!query && !browseAll) {
      createNewName = null;
      list.classList.remove('autocomplete-browse');
      hideList();
      list.innerHTML = '';
      return;
    }

    try {
      const found = browseAll
        ? await resolvePlayersSearch('', 250)
        : await resolvePlayersSearch(query, 8);
      results = found || [];
      const queryNorm = normalizeMatchPlayerName(query);
      const exactExists = !!(queryNorm && results.some(
        (p) => normalizeMatchPlayerName(p.name) === queryNorm
      ));
      createNewName = (!browseAll && query) ? truncateMatchPlayerName(query) : null;
      activeIndex = -1;
      list.innerHTML = '';
      list.classList.toggle('autocomplete-browse', browseAll);

      if (browseAll && !results.length) {
        const empty = document.createElement('div');
        empty.className = 'autocomplete-item autocomplete-new';
        empty.textContent = 'No saved players yet.';
        list.appendChild(empty);
        showList();
        return;
      }

      if (createNewName) {
        const createItem = document.createElement('div');
        createItem.className = 'autocomplete-item autocomplete-new';
        createItem.textContent = exactExists
          ? `Create another player: "${createNewName}"`
          : `Create new player: "${createNewName}"`;
        createItem.addEventListener('mousedown', (e) => {
          e.preventDefault();
          // Clear id so server creates/binds a new roster row for this name.
          pickMatchPlayerName(slot, { name: createNewName, id: '' });
          hideList();
        });
        list.appendChild(createItem);
      }

      results.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.dataset.index = String(createNewName ? index + 1 : index);
        const disambig = exactExists
          ? ` · ${String(player.id || '').slice(0, 8)}`
          : '';
        item.innerHTML = `<span class="autocomplete-name">${escapeHtml(player.name)}${escapeHtml(disambig)}</span>`
          + `<span class="autocomplete-preview">${escapeHtml(formatPlayerPreview(player.last_seen_at))}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickMatchPlayerName(slot, player);
          hideList();
        });
        list.appendChild(item);
      });

      if (createNewName || results.length) showList();
      else hideList();
      if (browseAll) list.scrollTop = 0;
    } catch (err) {
      console.error('Match player autocomplete error:', err);
    }
  };

  input.addEventListener('input', () => {
    // Typing without picking clears bound id until a roster row is selected.
    const form = document.getElementById('statsMatchForm');
    if (form) {
      if (slot === '2') form.dataset.player2Id = '';
      else form.dataset.player1Id = '';
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => refresh(), 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) refresh();
  });
  input.addEventListener('dblclick', (e) => {
    e.preventDefault();
    input.select();
    refresh({ browseAll: true });
  });
  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) return;
    const count = navCount();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, count - 1);
      highlight(activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex < 0 ? count - 1 : Math.max(activeIndex - 1, 0);
      highlight(activeIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex < 0) {
        hideList();
        return;
      }
      if (createNewName && activeIndex === 0) {
        pickMatchPlayerName(slot, { name: createNewName, id: '' });
      } else {
        const resultIndex = createNewName ? activeIndex - 1 : activeIndex;
        if (results[resultIndex]) pickMatchPlayerName(slot, results[resultIndex]);
      }
      hideList();
    } else if (e.key === 'Escape') {
      hideList();
    }
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) hideList();
  });
}

initStatsOverviewFilters();
initMatchPlayerAutocomplete();
setMatchModalActionButtons();
{
  const backBtn = document.getElementById('statsPlayerBackBtn');
  if (backBtn) {
    setDashActionButtonContent(backBtn, {
      icon: 'back',
      label: 'Back',
      title: 'Back to stats',
    });
  }
  setDashActionButtonContent(document.getElementById('statsClearFiltersBtn'), {
    icon: 'clearFilters',
    label: 'Clear',
    title: 'Clear filters',
  });
  setDashActionButtonContent(document.getElementById('statsRefreshBtn'), {
    icon: 'refresh',
    label: 'Refresh',
    title: 'Refresh stats',
  });
  syncStatsClearFiltersBtn();
  const createKeyBtn = document.getElementById('createKeyBtn');
  if (createKeyBtn) {
    setDashActionButtonContent(createKeyBtn, {
      icon: 'key',
      label: 'Create Dock Key',
      title: 'Create a new OBS Dock Key',
    });
  }
  setDashActionButtonContent(document.getElementById('revokeAllDockKeysBtn'), {
    icon: 'stopSign',
    label: 'Revoke All OBS Dock Keys',
    title: 'Revoke every OBS Dock Key',
  });
  setDashActionButtonContent(document.getElementById('statsPlayerRenameForm')?.querySelector('button[type="submit"]'), {
    icon: 'save',
    label: 'Save',
    title: 'Save player name',
  });
  setDashActionButtonContent(document.getElementById('statsPlayerRenameCancelBtn'), {
    icon: 'cancel',
    label: 'Cancel',
    title: 'Cancel rename',
  });
  {
    const cancelBtn = document.getElementById('dashCreateKeyCancelBtn');
    const submitBtn = document.getElementById('dashCreateKeySubmitBtn');
    cancelBtn?.classList.add('cancel');
    submitBtn?.classList.add('save');
    setDashActionButtonContent(cancelBtn, {
      icon: 'cancel',
      label: 'Cancel',
      title: 'Cancel',
    });
    setDashActionButtonContent(submitBtn, {
      icon: 'plus',
      label: 'Create',
      title: 'Create Dock Key',
    });
    updateDockKeyRoleDescription('trusted_operator');
  }
  setDashActionButtonContent(document.getElementById('dashConfirmCancelBtn'), {
    icon: 'cancel',
    label: 'Cancel',
    title: 'Cancel',
  });
  setDashActionButtonContent(document.getElementById('dashConfirmOkBtn'), {
    icon: 'check',
    label: 'Confirm',
    title: 'Confirm',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyNativeBtn'), {
    icon: 'share',
    label: 'Share…',
    title: 'Share with device share sheet',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyEmailBtn'), {
    icon: 'mail',
    label: 'Email',
    title: 'Share by email',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeySmsBtn'), {
    icon: 'sms',
    label: 'Text',
    title: 'Share by text message',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyCopyBtn'), {
    icon: 'copy',
    label: 'Copy',
    title: 'Copy share text',
  });
  setDashActionButtonContent(document.getElementById('dashShareKeyCloseBtn'), {
    icon: 'close',
    label: 'Close',
    title: 'Close',
  });
  setDashActionButtonContent(document.getElementById('devLoginBtn'), {
    icon: 'logIn',
    label: 'Login',
    title: 'Login',
  });
  setDashActionButtonContent(document.getElementById('invalidateSessionsBtn'), {
    icon: 'stopSign',
    label: 'Clear All Logins',
    title: 'Clear All Logins',
  });
  setDashActionButtonContent(document.getElementById('signOutBtn'), {
    icon: 'logOut',
    label: 'Sign Out',
    title: 'Sign Out',
  });
  setDashActionButtonContent(document.getElementById('manageBillingBtn'), {
    icon: 'edit',
    label: 'Manage Subscription',
    title: 'Open Stripe Customer Portal',
  });
}

initTablesSetupCarousel();
renderDashboard();
