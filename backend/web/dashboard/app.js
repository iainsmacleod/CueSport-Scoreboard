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
  createApiKey,
  fetchApiKey,
  revokeApiKey,
  invalidateAllSessions,
  revokeAllGuestLinks,
  GAME_TYPES,
} from '../shared/cloud-client.js?v=8.0.0';

const TOKEN_KEY = 'cuesport_token';
const SERVER_KEY = 'cuesport_server';

let dashClient = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastTablesFingerprint = '';
let wantLiveFeed = false;
let lastQuota = null;
let statsData = null;
let statsLoaded = false;
let statsLoading = false;
let selectedPlayerKey = '';
let playerDetailOpponentFilter = '';
let playerDetailGameFilter = '';

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

function showApiKeyDisplay(apiKey) {
  const el = document.getElementById('newKeyDisplay');
  if (!el) return;
  const key = String(apiKey || '').trim();
  if (!key) {
    el.dataset.apiKey = '';
    el.textContent = '';
    show('newKeyDisplay', false);
    return;
  }
  el.dataset.apiKey = key;
  el.textContent = `API Key (Click to copy): ${key}`;
  show('newKeyDisplay', true);
}

async function copyDisplayedApiKey() {
  const el = document.getElementById('newKeyDisplay');
  if (!el || el.classList.contains('hidden')) return;
  const key = el.dataset.apiKey || '';
  if (!key) return;
  const ok = await copyTextToClipboard(key);
  if (ok) {
    showKeyCopyNotice('API key copied to clipboard');
    setError('');
  } else {
    setError('Unable to copy automatically — select and copy the key manually.');
  }
}

function getServerUrl() {
  return localStorage.getItem(SERVER_KEY) || window.location.origin;
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function goToMainPage() {
  window.location.href = '/';
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
  const primaryLabel = st.primaryScoreLabel || (st.gameType === 'game8' ? 'Frames' : 'Racks');
  const secondaryRaw = st.secondaryScoreLabel || (st.gameType === 'game8' ? 'Points' : 'Balls');
  const secondaryLabel = /^points?$/i.test(String(secondaryRaw).trim())
    ? 'Current Point'
    : secondaryRaw;
  const scoreHtml = dual
    ? `<p class="table-score table-score-current">${st.p1Balls ?? 0} – ${st.p2Balls ?? 0} ${secondaryLabel}</p>` +
      `<p class="table-score table-score-primary">${st.p1Score ?? 0}–${st.p2Score ?? 0} ${primaryLabel}</p>`
    : `<p class="table-score">${st.p1Score ?? 0} – ${st.p2Score ?? 0}</p>`;
  const matchTitle = [
    gameTypeLabel(st.gameType),
    st.raceInfo ? `${st.raceLabel || 'Race'} ${st.raceInfo}` : null,
    st.gameInfo || null,
  ].filter(Boolean).join(' · ') || 'Match in progress';
  const controlUrl = `${serverUrl.replace(/\/$/, '')}/m/${room.id}`;

  const card = document.createElement('a');
  card.className = 'table-card panel';
  card.href = controlUrl;
  card.innerHTML = `
    <p class="table-status online">OBS Dock Connected</p>
    <h3>${matchTitle}</h3>
    <p class="table-players">${p1} vs ${p2}</p>
    ${scoreHtml}
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
      `Plan: ${tier} · OBS Dock Keys ${usage.apiKeys}/${limits.maxApiKeys} · ` +
      `Tables ${usage.rooms}/${limits.maxRooms} · ` +
      `Mobile/guest up to ${limits.maxControlConnectionsPerRoom} per table`;
  }
  const atKeyLimit = usage.apiKeys >= limits.maxApiKeys;
  if (createBtn) createBtn.disabled = atKeyLimit;
  if (hint) {
    if (atKeyLimit) {
      hint.textContent = `OBS Dock Key limit reached (${limits.maxApiKeys} on ${tier}). Revoke a key to create another.`;
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
    const actions = document.createElement('div');
    actions.className = 'token-list-actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn secondary';
    viewBtn.textContent = 'View';
    viewBtn.disabled = k.viewable === false;
    viewBtn.title = k.viewable === false
      ? 'This key was created before viewable storage. Create a new key to view it later.'
      : 'Show API key';
    viewBtn.addEventListener('click', async () => {
      try {
        setError('');
        const data = await fetchApiKey(getServerUrl(), getToken(), k.id);
        showApiKeyDisplay(data.key);
        setActiveDashTab('account');
        const display = document.getElementById('newKeyDisplay');
        if (display) display.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        setError(err.message);
      }
    });

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

    actions.appendChild(viewBtn);
    actions.appendChild(btn);
    li.appendChild(label);
    li.appendChild(actions);
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
  if (which === 'stats') {
    selectedPlayerKey = '';
    playerDetailOpponentFilter = '';
    playerDetailGameFilter = '';
    loadAccountStats();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function formatStatsDate(value) {
  if (!value) return '—';
  const iso = String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

function winPct(won, lost) {
  const total = (won || 0) + (lost || 0);
  if (!total) return 0;
  return Math.round(((won || 0) / total) * 100);
}

function scoreLine(match) {
  if (!match.scores) return '—';
  return `${match.scores.p1 ?? 0}–${match.scores.p2 ?? 0}`;
}

function completedMatches(data) {
  return (data.matches || []).filter((m) => m.status === 'completed' && m.startEventId);
}

function statsFromMatches(matches) {
  const playerMap = new Map();
  function touch(name) {
    const display = String(name || '').trim();
    const key = display.toLowerCase();
    if (!key) return null;
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        id: key,
        name: display,
        gamesWon: 0,
        gamesLost: 0,
        racksWon: 0,
        racksLost: 0,
        highestBreak: 0,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 0,
        ballsPotted: 0,
        fouls: 0,
        lastPlayedAt: null,
      });
    }
    return playerMap.get(key);
  }
  for (const match of matches) {
    const p1 = touch(match.player1Name);
    const p2 = touch(match.player2Name);
    if (!p1 || !p2) continue;
    if (match.winnerSlot === '1' || match.winnerSlot === '2') {
      const winner = match.winnerSlot === '1' ? p1 : p2;
      const loser = match.winnerSlot === '1' ? p2 : p1;
      winner.gamesWon += 1;
      loser.gamesLost += 1;
      if (match.scores) {
        const wRacks = Number(match.winnerSlot === '1' ? match.scores.p1 : match.scores.p2) || 0;
        const lRacks = Number(match.winnerSlot === '1' ? match.scores.p2 : match.scores.p1) || 0;
        winner.racksWon += wRacks;
        winner.racksLost += lRacks;
        loser.racksWon += lRacks;
        loser.racksLost += wRacks;
      }
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
  const players = Array.from(playerMap.values()).sort((a, b) =>
    b.gamesWon - a.gamesWon || b.racksWon - a.racksWon || a.name.localeCompare(b.name)
  );
  return { matches, players };
}

function applyStatsFilters(data) {
  const query = (document.getElementById('statsPlayerSearch')?.value || '').trim().toLowerCase();
  let matches = completedMatches(data);
  if (query) {
    matches = matches.filter((m) =>
      String(m.player1Name || '').toLowerCase().includes(query) ||
      String(m.player2Name || '').toLowerCase().includes(query)
    );
  }
  return statsFromMatches(matches);
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
    boardBody.innerHTML = '<tr><td colspan="6" class="dash-stats-empty">No stats loaded.</td></tr>';
    matchBody.innerHTML = '<tr><td colspan="6" class="dash-stats-empty">No stats loaded.</td></tr>';
    return;
  }

  const filtered = applyStatsFilters(statsData);
  const racksPlayed = filtered.matches.reduce((sum, m) => {
    if (!m.scores) return sum;
    return sum + (Number(m.scores.p1) || 0) + (Number(m.scores.p2) || 0);
  }, 0);
  summaryEl.innerHTML = `
    <div class="stats-summary-card"><strong>${filtered.matches.length}</strong><span>Completed matches</span></div>
    <div class="stats-summary-card"><strong>${filtered.players.length}</strong><span>Players</span></div>
    <div class="stats-summary-card"><strong>${racksPlayed}</strong><span>Racks / frames</span></div>
  `;

  if (!filtered.players.length) {
    boardBody.innerHTML = '<tr><td colspan="6" class="dash-stats-empty">No completed matches yet. Play a race on a connected dock to populate stats.</td></tr>';
  } else {
    boardBody.innerHTML = filtered.players.map((p, index) => `
      <tr class="stats-row-clickable" data-player-id="${escapeHtml(p.id)}">
        <td class="stats-pos">${index + 1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.gamesWon}/${p.gamesLost}</td>
        <td>${winPct(p.gamesWon, p.gamesLost)}%</td>
        <td>${p.racksWon}/${p.racksLost}</td>
        <td>${escapeHtml(formatStatsDate(p.lastPlayedAt))}</td>
      </tr>
    `).join('');
  }

  if (!filtered.matches.length) {
    matchBody.innerHTML = '<tr><td colspan="6" class="dash-stats-empty">No match history yet.</td></tr>';
  } else {
    matchBody.innerHTML = filtered.matches.slice(0, 50).map((m) => matchOverviewRow(m)).join('');
  }
  if (statusEl) statusEl.textContent = '';
}

function matchPairHtml(m) {
  const p1 = escapeHtml(m.player1Name);
  const p2 = escapeHtml(m.player2Name);
  if (m.winnerSlot === '1') return `<span class="stats-winner">${p1}</span> vs ${p2}`;
  if (m.winnerSlot === '2') return `${p1} vs <span class="stats-winner">${p2}</span>`;
  return `${p1} vs ${p2}`;
}

function matchOverviewRow(m) {
  return `
    <tr>
      <td>${escapeHtml(formatStatsDate(m.completedAt || m.startedAt))}</td>
      <td>${escapeHtml(m.gameInfo || '—')}</td>
      <td>${escapeHtml(gameTypeLabel(m.gameType))}</td>
      <td>${matchPairHtml(m)}</td>
      <td>${escapeHtml(scoreLine(m))}</td>
      <td><button type="button" class="btn" data-edit-match="${escapeHtml(m.startEventId)}">Edit</button></td>
    </tr>
  `;
}

function playerMatches(playerKey, options = {}) {
  const key = String(playerKey || '').toLowerCase();
  const opponentKey = String(options.opponent || '').toLowerCase();
  const gameType = options.gameType || '';
  return completedMatches(statsData || {}).filter((m) => {
    const isP1 = String(m.player1Name || '').toLowerCase() === key;
    const isP2 = String(m.player2Name || '').toLowerCase() === key;
    if (!isP1 && !isP2) return false;
    if (gameType && m.gameType !== gameType) return false;
    if (opponentKey) {
      const opponent = String(isP1 ? m.player2Name : m.player1Name || '').toLowerCase();
      if (opponent !== opponentKey) return false;
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
    const isP1 = String(m.player1Name || '').toLowerCase() === selectedPlayerKey;
    const opponentName = isP1 ? m.player2Name : m.player1Name;
    const opponentKey = String(opponentName || '').trim().toLowerCase();
    if (opponentKey) opponents.set(opponentKey, String(opponentName || '').trim());
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

function renderPlayerDetail() {
  const allMatches = playerMatches(selectedPlayerKey);
  const matches = playerMatches(selectedPlayerKey, {
    opponent: playerDetailOpponentFilter,
    gameType: playerDetailGameFilter,
  });
  const filteredStats = statsFromMatches(matches);
  const player = filteredStats.players.find((p) => p.id === selectedPlayerKey) || null;
  const title = document.getElementById('statsPlayerTitle');
  const summary = document.getElementById('statsPlayerSummary');
  const rename = document.getElementById('statsPlayerRenameInput');
  const body = document.getElementById('statsPlayerMatchesBody');
  const unfilteredName = statsFromMatches(allMatches).players.find((p) => p.id === selectedPlayerKey)?.name
    || selectedPlayerKey;
  if (!selectedPlayerKey) {
    renderAccountStats();
    return;
  }
  if (title) title.textContent = unfilteredName;
  if (rename && document.activeElement !== rename) rename.value = unfilteredName;
  populatePlayerDetailFilters(allMatches);
  if (summary) {
    const cards = [];
    const gamesWon = player ? (player.gamesWon || 0) : 0;
    const gamesLost = player ? (player.gamesLost || 0) : 0;
    const racksWon = player ? (player.racksWon || 0) : 0;
    const racksLost = player ? (player.racksLost || 0) : 0;
    const highestBreak = player ? (player.highestBreak || 0) : 0;
    const highestRun = player ? (player.highestRun || 0) : 0;
    const breakAndRuns = player ? (player.breakAndRuns || 0) : 0;
    const tableRuns = player ? (player.tableRuns || 0) : 0;
    if (gamesWon + gamesLost > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${gamesWon}/${gamesLost}</strong><span>Matches W/L</span></div>`);
      cards.push(`<div class="stats-summary-card"><strong>${winPct(gamesWon, gamesLost)}%</strong><span>Win %</span></div>`);
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
      cards.push(`<div class="stats-summary-card"><strong>${breakAndRuns}</strong><span>B&amp;R</span></div>`);
    }
    if (tableRuns > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${tableRuns}</strong><span>Table runs</span></div>`);
    }
    const fouls = player ? (player.fouls || 0) : 0;
    if (fouls > 0) {
      cards.push(`<div class="stats-summary-card"><strong>${fouls}</strong><span>Fouls</span></div>`);
    }
    summary.innerHTML = cards.join('');
    summary.classList.toggle('hidden', cards.length === 0);
  }
  if (!body) return;
  if (!matches.length) {
    body.innerHTML = '<tr><td colspan="8" class="dash-stats-empty">No matches for this filter.</td></tr>';
    return;
  }
  body.innerHTML = matches.map((m) => {
    const isP1 = String(m.player1Name || '').toLowerCase() === selectedPlayerKey;
    const opponent = isP1 ? m.player2Name : m.player1Name;
    let result = '—';
    if (m.winnerSlot === '1' || m.winnerSlot === '2') {
      const won = (m.winnerSlot === '1' && isP1) || (m.winnerSlot === '2' && !isP1);
      result = won ? 'Win' : 'Loss';
    }
    return `
      <tr>
        <td>${escapeHtml(formatStatsDate(m.completedAt || m.startedAt))}</td>
        <td>${escapeHtml(m.gameInfo || '—')}</td>
        <td>${escapeHtml(gameTypeLabel(m.gameType))}</td>
        <td>${escapeHtml(opponent)}</td>
        <td>${escapeHtml(scoreLine(m))}</td>
        <td>${result}</td>
        <td>${escapeHtml(matchExtrasLabel(m))}</td>
        <td><button type="button" class="btn" data-edit-match="${escapeHtml(m.startEventId)}">Edit</button></td>
      </tr>
    `;
  }).join('');
}

function findMatchByStartId(startEventId) {
  return (statsData?.matches || []).find((m) => m.startEventId === startEventId) || null;
}

function dateInputValue(value) {
  if (!value) return '';
  const iso = String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showsHighestBreakFields(gameType) {
  return gameType === 'game8';
}

function showsHighestRunFields(gameType) {
  return gameType === 'game4';
}

function showsRunOutFields(gameType) {
  return gameType === 'game1' || gameType === 'game2' || gameType === 'game3';
}

function showsBallsFields(gameType) {
  return gameType === 'game1' || gameType === 'game2' || gameType === 'game3' ||
    gameType === 'game5' || gameType === 'game6' || gameType === 'game7' || gameType === 'game8';
}

function showsFoulsFields(gameType) {
  return true;
}

function syncMatchExtrasVisibility(gameType) {
  const gt = gameType || document.getElementById('statsMatchGameType')?.value || 'game1';
  document.getElementById('statsMatchExtrasHb')?.classList.toggle('hidden', !showsHighestBreakFields(gt));
  document.getElementById('statsMatchExtrasHr')?.classList.toggle('hidden', !showsHighestRunFields(gt));
  document.getElementById('statsMatchExtrasRuns')?.classList.toggle('hidden', !showsRunOutFields(gt));
  document.getElementById('statsMatchExtrasBalls')?.classList.toggle('hidden', !showsBallsFields(gt));
  document.getElementById('statsMatchExtrasFouls')?.classList.toggle('hidden', !showsFoulsFields(gt));
}

function matchExtrasLabel(m) {
  const parts = [];
  if (showsHighestBreakFields(m.gameType)) {
    const hb1 = Number(m.highestBreakP1) || 0;
    const hb2 = Number(m.highestBreakP2) || 0;
    if (hb1 || hb2) parts.push(`HB ${hb1}/${hb2}`);
  }
  if (showsHighestRunFields(m.gameType)) {
    const hr1 = Number(m.highestRunP1) || 0;
    const hr2 = Number(m.highestRunP2) || 0;
    if (hr1 || hr2) parts.push(`Run ${hr1}/${hr2}`);
  }
  if (showsRunOutFields(m.gameType)) {
    const br = (Number(m.breakAndRunsP1) || 0) + (Number(m.breakAndRunsP2) || 0);
    const tr = (Number(m.tableRunsP1) || 0) + (Number(m.tableRunsP2) || 0);
    if (br) parts.push(`B&R ${br}`);
    if (tr) parts.push(`TR ${tr}`);
  }
  if (showsBallsFields(m.gameType)) {
    const b1 = Number(m.ballsP1) || 0;
    const b2 = Number(m.ballsP2) || 0;
    if (b1 || b2) parts.push(`Balls ${b1}/${b2}`);
  }
  if (showsFoulsFields(m.gameType)) {
    const f1 = Number(m.foulsP1) || 0;
    const f2 = Number(m.foulsP2) || 0;
    if (f1 || f2) parts.push(`Fouls ${f1}/${f2}`);
  }
  return parts.length ? parts.join(' · ') : '—';
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
  const modal = document.getElementById('statsMatchModal');
  if (modal) modal.classList.add('hidden');
  matchModalBaseline = null;
  syncMatchModalSaveEnabled();
}

function matchModalPlayerName(slot) {
  const id = slot === '2' ? 'statsMatchP2' : 'statsMatchP1';
  return (document.getElementById(id)?.value || '').trim().slice(0, 20);
}

function syncMatchModalPlayerLabels() {
  const p1 = matchModalPlayerName('1') || 'P1';
  const p2 = matchModalPlayerName('2') || 'P2';
  const setLabel = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setLabel('statsMatchScoreP1Label', `${p1} score`);
  setLabel('statsMatchScoreP2Label', `${p2} score`);
  setLabel('statsMatchHbP1Label', `Highest break · ${p1}`);
  setLabel('statsMatchHbP2Label', `Highest break · ${p2}`);
  setLabel('statsMatchHrP1Label', `Longest run · ${p1}`);
  setLabel('statsMatchHrP2Label', `Longest run · ${p2}`);
  setLabel('statsMatchBrP1Label', `B&R · ${p1}`);
  setLabel('statsMatchBrP2Label', `B&R · ${p2}`);
  setLabel('statsMatchTrP1Label', `TR · ${p1}`);
  setLabel('statsMatchTrP2Label', `TR · ${p2}`);
  setLabel('statsMatchBallsP1Label', `Balls potted · ${p1}`);
  setLabel('statsMatchBallsP2Label', `Balls potted · ${p2}`);
  setLabel('statsMatchFoulsP1Label', `Fouls · ${p1}`);
  setLabel('statsMatchFoulsP2Label', `Fouls · ${p2}`);
}

let matchModalBaseline = null;

function numField(id) {
  const n = Number(document.getElementById(id)?.value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readMatchModalSnapshot() {
  return {
    player1Name: matchModalPlayerName('1'),
    player2Name: matchModalPlayerName('2'),
    gameType: document.getElementById('statsMatchGameType')?.value || 'game1',
    gameInfo: (document.getElementById('statsMatchGameInfo')?.value || '').trim(),
    scoreP1: numField('statsMatchScoreP1'),
    scoreP2: numField('statsMatchScoreP2'),
    date: document.getElementById('statsMatchDate')?.value || '',
    hbP1: numField('statsMatchHbP1'),
    hbP2: numField('statsMatchHbP2'),
    hrP1: numField('statsMatchHrP1'),
    hrP2: numField('statsMatchHrP2'),
    brP1: numField('statsMatchBrP1'),
    brP2: numField('statsMatchBrP2'),
    trP1: numField('statsMatchTrP1'),
    trP2: numField('statsMatchTrP2'),
    ballsP1: numField('statsMatchBallsP1'),
    ballsP2: numField('statsMatchBallsP2'),
    foulsP1: numField('statsMatchFoulsP1'),
    foulsP2: numField('statsMatchFoulsP2'),
  };
}

function matchModalHasChanges() {
  if (!matchModalBaseline) return false;
  return JSON.stringify(readMatchModalSnapshot()) !== JSON.stringify(matchModalBaseline);
}

function syncMatchModalSaveEnabled() {
  const btn = document.getElementById('statsMatchSaveBtn');
  if (!btn) return;
  btn.disabled = !matchModalHasChanges();
}

function openMatchModal(startEventId) {
  const match = findMatchByStartId(startEventId);
  if (!match) return;
  fillMatchGameTypes();
  document.getElementById('statsMatchEventId').value = match.startEventId;
  document.getElementById('statsMatchP1').value = match.player1Name || '';
  document.getElementById('statsMatchP2').value = match.player2Name || '';
  document.getElementById('statsMatchGameType').value = match.gameType || 'game1';
  document.getElementById('statsMatchGameInfo').value = match.gameInfo || '';
  document.getElementById('statsMatchScoreP1').value = match.scores?.p1 ?? 0;
  document.getElementById('statsMatchScoreP2').value = match.scores?.p2 ?? 0;
  document.getElementById('statsMatchDate').value = dateInputValue(match.completedAt || match.startedAt);
  document.getElementById('statsMatchHbP1').value = match.highestBreakP1 || 0;
  document.getElementById('statsMatchHbP2').value = match.highestBreakP2 || 0;
  document.getElementById('statsMatchHrP1').value = match.highestRunP1 || 0;
  document.getElementById('statsMatchHrP2').value = match.highestRunP2 || 0;
  document.getElementById('statsMatchBrP1').value = match.breakAndRunsP1 || 0;
  document.getElementById('statsMatchBrP2').value = match.breakAndRunsP2 || 0;
  document.getElementById('statsMatchTrP1').value = match.tableRunsP1 || 0;
  document.getElementById('statsMatchTrP2').value = match.tableRunsP2 || 0;
  document.getElementById('statsMatchBallsP1').value = match.ballsP1 || 0;
  document.getElementById('statsMatchBallsP2').value = match.ballsP2 || 0;
  document.getElementById('statsMatchFoulsP1').value = match.foulsP1 || 0;
  document.getElementById('statsMatchFoulsP2').value = match.foulsP2 || 0;
  syncMatchExtrasVisibility(match.gameType || 'game1');
  syncMatchModalPlayerLabels();
  setMatchModalError('');
  matchModalBaseline = readMatchModalSnapshot();
  syncMatchModalSaveEnabled();
  document.getElementById('statsMatchModal')?.classList.remove('hidden');
}

async function saveMatchModal(event) {
  event.preventDefault();
  if (!matchModalHasChanges()) return;
  const startEventId = document.getElementById('statsMatchEventId')?.value;
  if (!startEventId) return;
  const p1 = document.getElementById('statsMatchP1').value.trim();
  const p2 = document.getElementById('statsMatchP2').value.trim();
  const dateVal = document.getElementById('statsMatchDate').value;
  const gameType = document.getElementById('statsMatchGameType').value;
  try {
    await updateAccountMatch(getServerUrl(), getToken(), startEventId, {
      player1Name: p1,
      player2Name: p2,
      gameType,
      gameInfo: document.getElementById('statsMatchGameInfo').value.trim(),
      scores: {
        p1: document.getElementById('statsMatchScoreP1').value,
        p2: document.getElementById('statsMatchScoreP2').value,
      },
      completedAt: dateVal ? `${dateVal}T12:00:00.000Z` : undefined,
      highestBreakP1: document.getElementById('statsMatchHbP1').value,
      highestBreakP2: document.getElementById('statsMatchHbP2').value,
      highestRunP1: document.getElementById('statsMatchHrP1').value,
      highestRunP2: document.getElementById('statsMatchHrP2').value,
      breakAndRunsP1: document.getElementById('statsMatchBrP1').value,
      breakAndRunsP2: document.getElementById('statsMatchBrP2').value,
      tableRunsP1: document.getElementById('statsMatchTrP1').value,
      tableRunsP2: document.getElementById('statsMatchTrP2').value,
      ballsP1: document.getElementById('statsMatchBallsP1').value,
      ballsP2: document.getElementById('statsMatchBallsP2').value,
      foulsP1: document.getElementById('statsMatchFoulsP1').value,
      foulsP2: document.getElementById('statsMatchFoulsP2').value,
    });
    closeMatchModal();
    await loadAccountStats(true);
  } catch (err) {
    setMatchModalError(err.message);
  }
}

async function deleteMatchFromModal() {
  const startEventId = document.getElementById('statsMatchEventId')?.value;
  if (!startEventId) return;
  if (!window.confirm('Delete this match from cloud stats? This cannot be undone.')) return;
  try {
    await deleteAccountMatch(getServerUrl(), getToken(), startEventId);
    closeMatchModal();
    await loadAccountStats(true);
  } catch (err) {
    setMatchModalError(err.message);
  }
}

async function loadAccountStats(force = false) {
  if (statsLoading) return;
  if (statsLoaded && !force) {
    renderAccountStats();
    return;
  }
  const token = getToken();
  if (!token) return;
  statsLoading = true;
  const statusEl = document.getElementById('statsStatus');
  if (statusEl) statusEl.textContent = 'Loading cloud stats…';
  try {
    statsData = await fetchAccountStats(getServerUrl(), token);
    statsLoaded = true;
    renderAccountStats();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || 'Could not load cloud stats.';
  } finally {
    statsLoading = false;
  }
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
      goToMainPage();
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
    statsData = null;
    statsLoaded = false;
    setError(err.message);
    show('loginSection', true);
    show('dashboardSection', false);
  }
}

function formatPlayerPreview(lastSeenAt) {
  if (!lastSeenAt) return 'Saved player';
  const d = new Date(lastSeenAt);
  if (Number.isNaN(d.getTime())) return 'Saved player';
  return `Last seen ${d.toLocaleDateString()}`;
}

function openPlayerFromSearch(name) {
  const trimmed = String(name || '').trim().slice(0, 20);
  const input = document.getElementById('statsPlayerSearch');
  if (input) input.value = trimmed;
  selectedPlayerKey = trimmed.toLowerCase();
  playerDetailOpponentFilter = '';
  playerDetailGameFilter = '';
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
    selectedPlayerKey = '';
    if (statsData) renderAccountStats();
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
        ? await fetchPlayers(getServerUrl(), getToken(), '', 250)
        : await fetchPlayers(getServerUrl(), getToken(), query, 8);
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
          + `<span class="autocomplete-preview">${escapeHtml(formatPlayerPreview(player.last_seen_at))}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          openPlayerFromSearch(player.name);
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
        if (query) openPlayerFromSearch(query);
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
        openPlayerFromSearch(results[activeIndex].name);
        hideList();
      } else if (input.value.trim()) {
        openPlayerFromSearch(input.value.trim());
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

document.querySelectorAll('.dash-tab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveDashTab(tab.dataset.tab));
});

function setActiveStatsPanel(which) {
  const panel = which === 'matches' ? 'matches' : 'leaderboard';
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

document.getElementById('statsRefreshBtn')?.addEventListener('click', () => {
  loadAccountStats(true);
});
document.getElementById('statsPlayerBackBtn')?.addEventListener('click', () => {
  selectedPlayerKey = '';
  playerDetailOpponentFilter = '';
  playerDetailGameFilter = '';
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
document.getElementById('statsPlayerRenameForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fromPlayer = statsFromMatches(completedMatches(statsData || {})).players.find((p) => p.id === selectedPlayerKey);
  const fromName = fromPlayer?.name || selectedPlayerKey;
  const toName = document.getElementById('statsPlayerRenameInput')?.value.trim();
  if (!fromName || !toName) return;
  try {
    const result = await renameAccountPlayer(getServerUrl(), getToken(), fromName, toName);
    selectedPlayerKey = toName.toLowerCase();
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
  }
});
document.getElementById('tabStats')?.addEventListener('click', (event) => {
  const editBtn = event.target.closest('[data-edit-match]');
  if (editBtn) {
    event.preventDefault();
    openMatchModal(editBtn.getAttribute('data-edit-match'));
    return;
  }
  const row = event.target.closest('tr[data-player-id]');
  if (row) {
    selectedPlayerKey = row.getAttribute('data-player-id') || '';
    playerDetailOpponentFilter = '';
    playerDetailGameFilter = '';
    renderAccountStats();
  }
});
document.getElementById('statsMatchForm')?.addEventListener('submit', saveMatchModal);
document.getElementById('statsMatchForm')?.addEventListener('input', () => {
  syncMatchModalPlayerLabels();
  syncMatchModalSaveEnabled();
});
document.getElementById('statsMatchForm')?.addEventListener('change', syncMatchModalSaveEnabled);
document.getElementById('statsMatchCancelBtn')?.addEventListener('click', closeMatchModal);
document.getElementById('statsMatchDeleteBtn')?.addEventListener('click', deleteMatchFromModal);
document.getElementById('statsMatchGameType')?.addEventListener('change', (event) => {
  syncMatchExtrasVisibility(event.target.value);
});
document.getElementById('statsMatchModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'statsMatchModal') closeMatchModal();
});

async function submitDevLogin() {
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
      showApiKeyDisplay(data.api_key);
      setActiveDashTab('account');
    }
    lastTablesFingerprint = '';
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  } finally {
    btn.disabled = false;
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

document.getElementById('createKeyBtn').addEventListener('click', async () => {
  try {
    const created = await createApiKey(getServerUrl(), getToken(), 'OBS Dock Key');
    showApiKeyDisplay(created.key);
    if (created.quota) renderQuota(created.quota);
    await renderDashboard();
  } catch (err) {
    setError(err.message);
  }
});

document.getElementById('newKeyDisplay')?.addEventListener('click', () => {
  copyDisplayedApiKey();
});
document.getElementById('newKeyDisplay')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    copyDisplayedApiKey();
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  if (!window.confirm('Sign out of this dashboard on this device?')) return;
  localStorage.removeItem(TOKEN_KEY);
  stopLiveFeed();
  goToMainPage();
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
  goToMainPage();
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

initStatsPlayerSearch();
initMatchPlayerAutocomplete();

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

function pickMatchPlayerName(slot, name) {
  const input = document.getElementById(slot === '2' ? 'statsMatchP2' : 'statsMatchP1');
  if (!input) return;
  input.value = truncateMatchPlayerName(name);
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
        ? await fetchPlayers(getServerUrl(), getToken(), '', 250)
        : await fetchPlayers(getServerUrl(), getToken(), query, 8);
      results = found || [];
      const queryNorm = normalizeMatchPlayerName(query);
      const exactExists = !!(queryNorm && results.some(
        (p) => normalizeMatchPlayerName(p.name) === queryNorm
      ));
      createNewName = (!browseAll && query && !exactExists) ? truncateMatchPlayerName(query) : null;
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
        createItem.textContent = `Create new player: "${createNewName}"`;
        createItem.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickMatchPlayerName(slot, createNewName);
          hideList();
        });
        list.appendChild(createItem);
      }

      results.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.dataset.index = String(createNewName ? index + 1 : index);
        item.innerHTML = `<span class="autocomplete-name">${escapeHtml(player.name)}</span>`
          + `<span class="autocomplete-preview">${escapeHtml(formatPlayerPreview(player.last_seen_at))}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickMatchPlayerName(slot, player.name);
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
        pickMatchPlayerName(slot, createNewName);
      } else {
        const resultIndex = createNewName ? activeIndex - 1 : activeIndex;
        if (results[resultIndex]) pickMatchPlayerName(slot, results[resultIndex].name);
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
renderDashboard();
