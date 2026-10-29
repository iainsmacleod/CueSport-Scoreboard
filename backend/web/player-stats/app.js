import { GAME_TYPES } from '../shared/cloud-client.js?v=8.6.0';

const GAME_LABELS = Object.fromEntries(GAME_TYPES.map((g) => [g.id, g.label]));

let playerId = '';
let playerData = null;
let opponentFilter = '';
let gameFilter = '';
let h2hChartMode = 'matches';
let h2hChart = null;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function gameTypeLabel(id) {
  return GAME_LABELS[id] || String(id || '—');
}

function winPct(won, lost, drawn = 0) {
  const total = (Number(won) || 0) + (Number(lost) || 0) + (Number(drawn) || 0);
  if (!total) return 0;
  return Math.round(((Number(won) || 0) / total) * 1000) / 10;
}

function formatMatchRecord(won, drawn, lost) {
  return `${Number(won) || 0}/${Number(drawn) || 0}/${Number(lost) || 0}`;
}

function balancedSummaryColumns(count, maxPerRow = 4) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 1) return 1;
  if (n <= maxPerRow) return n;
  const rows = Math.ceil(n / maxPerRow);
  return Math.ceil(n / rows);
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

function resolveMatchResult(match) {
  const raw = match?.winnerSlot != null ? String(match.winnerSlot) : '';
  if (raw === '1' || raw === '2') return { winnerSlot: raw, isDraw: false };
  if (raw === 'draw' || raw === 'tie' || raw === '0') return { winnerSlot: null, isDraw: true };
  const scores = match?.scores;
  if (!scores || typeof scores !== 'object') return { winnerSlot: null, isDraw: false };
  const p1 = Number(scores.p1) || 0;
  const p2 = Number(scores.p2) || 0;
  if (p1 > p2) return { winnerSlot: '1', isDraw: false };
  if (p2 > p1) return { winnerSlot: '2', isDraw: false };
  return { winnerSlot: null, isDraw: true };
}

function matchPlayerSlot(match, key) {
  const id = String(key || '').trim();
  if (!id || !match) return null;
  if (String(match.player1Id || '') === id) return '1';
  if (String(match.player2Id || '') === id) return '2';
  if (String(match.player1Name || '').toLowerCase() === id.toLowerCase()) return '1';
  if (String(match.player2Name || '').toLowerCase() === id.toLowerCase()) return '2';
  return null;
}

function isMatchInProgress(match) {
  return !!(match && match.status && match.status !== 'completed');
}

function statsFromMatches(matches) {
  const playerMap = new Map();
  function touch(id, name) {
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
      });
    } else if (display) {
      playerMap.get(key).name = display;
    }
    return playerMap.get(key);
  }
  for (const match of matches || []) {
    const p1 = touch(match.player1Id, match.player1Name);
    const p2 = touch(match.player2Id, match.player2Name);
    if (!p1 || !p2) continue;
    if (match.status && match.status !== 'completed') continue;
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
  }
  return { players: Array.from(playerMap.values()), matches };
}

function filteredMatches() {
  const all = playerData?.matches || [];
  return all.filter((m) => {
    const slot = matchPlayerSlot(m, playerId);
    if (!slot) return false;
    if (gameFilter && m.gameType !== gameFilter) return false;
    if (opponentFilter) {
      const opponentId = slot === '1' ? m.player2Id : m.player1Id;
      const opponentName = slot === '1' ? m.player2Name : m.player1Name;
      if (opponentId && opponentId === opponentFilter) return true;
      if (String(opponentName || '').toLowerCase() === opponentFilter.toLowerCase()) return true;
      return false;
    }
    return true;
  });
}

function scoreCellHtml(match) {
  if (isMatchInProgress(match) && !match.scores) return 'Live';
  if (!match.scores) return '—';
  const slot = matchPlayerSlot(match, playerId);
  const p1 = Number(match.scores.p1) || 0;
  const p2 = Number(match.scores.p2) || 0;
  if (slot === '1') return `${p1}–${p2}`;
  if (slot === '2') return `${p2}–${p1}`;
  return `${p1}–${p2}`;
}

function matchPairHtml(m) {
  const slot = matchPlayerSlot(m, playerId);
  const left = slot === '2' ? m.player2Name : m.player1Name;
  const right = slot === '2' ? m.player1Name : m.player2Name;
  return `<span class="stats-match-pair">${escapeHtml(left || '—')} <span class="stats-vs">vs</span> ${escapeHtml(right || '—')}</span>`;
}

function readQueryFilters() {
  const params = new URLSearchParams(window.location.search);
  opponentFilter = String(params.get('opponent') || '').trim();
  gameFilter = String(params.get('game') || '').trim();
}

function writeQueryFilters() {
  const params = new URLSearchParams();
  if (opponentFilter) params.set('opponent', opponentFilter);
  if (gameFilter) params.set('game', gameFilter);
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, '', next);
}

function destroyH2HChart() {
  if (h2hChart) {
    try { h2hChart.destroy(); } catch { /* ignore */ }
    h2hChart = null;
  }
}

function buildH2HWinProgression(matches, pKey, oKey, mode) {
  const completed = (matches || [])
    .filter((m) => m && m.status === 'completed')
    .slice()
    .sort((a, b) => String(a.completedAt || a.startedAt || '').localeCompare(String(b.completedAt || b.startedAt || '')));

  const labels = [0];
  const playerWins = [0];
  const opponentWins = [0];
  let pWins = 0;
  let oWins = 0;
  let played = 0;
  let playerName = '';
  let opponentName = '';
  const rackMode = mode === 'racks';

  for (const m of completed) {
    const slot = matchPlayerSlot(m, pKey);
    if (!slot) continue;
    const oppId = slot === '1' ? m.player2Id : m.player1Id;
    const oppName = slot === '1' ? m.player2Name : m.player1Name;
    const matchesOpp = (oppId && oppId === oKey)
      || String(oppName || '').toLowerCase() === String(oKey).toLowerCase();
    if (!matchesOpp) continue;
    playerName = slot === '1' ? m.player1Name : m.player2Name;
    opponentName = oppName;

    if (rackMode) {
      if (m.gameType === 'game4' || !m.scores) continue;
      const s1 = Number(m.scores.p1) || 0;
      const s2 = Number(m.scores.p2) || 0;
      const pRacks = slot === '1' ? s1 : s2;
      const oRacks = slot === '1' ? s2 : s1;
      const total = pRacks + oRacks;
      if (!total) continue;
      for (let i = 0; i < total; i += 1) {
        played += 1;
        if (i < pRacks) pWins += 1;
        else oWins += 1;
        labels.push(played);
        playerWins.push(pWins);
        opponentWins.push(oWins);
      }
      continue;
    }

    const result = resolveMatchResult(m);
    played += 1;
    if (result.winnerSlot === slot) pWins += 1;
    else if (result.winnerSlot && result.winnerSlot !== slot) oWins += 1;
    labels.push(played);
    playerWins.push(pWins);
    opponentWins.push(oWins);
  }

  return {
    labels,
    playerWins,
    opponentWins,
    playerName: playerName || pKey,
    opponentName: opponentName || oKey,
    xLabel: rackMode ? 'Racks / Frames Played' : 'Matches Played',
    yLabel: rackMode ? 'Racks / Frames Won' : 'Matches Won',
  };
}

function syncH2HChartModeToggle(visible) {
  const toggle = document.getElementById('publicH2HChartModeToggle');
  toggle?.classList.toggle('hidden', !visible);
}

function renderH2HChart(matches) {
  const hint = document.getElementById('publicH2HChartHint');
  const wrap = document.getElementById('publicH2HChartWrap');
  const canvas = document.getElementById('publicH2HChart');
  destroyH2HChart();
  if (!hint || !wrap || !canvas) return;

  if (!opponentFilter) {
    syncH2HChartModeToggle(false);
    hint.textContent = 'Select an opponent to view head-to-head progress.';
    hint.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }

  syncH2HChartModeToggle(true);
  const mode = h2hChartMode === 'racks' ? 'racks' : 'matches';
  const series = buildH2HWinProgression(matches, playerId, opponentFilter, mode);
  if (!series || series.labels.length <= 1) {
    hint.textContent = mode === 'racks'
      ? 'No rack/frame scores vs this opponent (Straight Pool is excluded).'
      : 'No completed head-to-head matches for this opponent.';
    hint.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }

  const ChartLib = window.Chart;
  if (!ChartLib) {
    hint.textContent = 'Chart library failed to load.';
    hint.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }

  hint.classList.add('hidden');
  wrap.classList.remove('hidden');
  const textColor = '#c0caf5';
  const gridColor = 'rgba(65, 72, 104, 0.55)';
  h2hChart = new ChartLib(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        {
          label: series.playerName,
          data: series.playerWins,
          borderColor: '#7aa2f7',
          backgroundColor: '#7aa2f7',
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 5,
        },
        {
          label: series.opponentName,
          data: series.opponentWins,
          borderColor: '#e0af68',
          backgroundColor: '#e0af68',
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, usePointStyle: true } },
      },
      scales: {
        x: {
          title: { display: true, text: series.xLabel, color: textColor },
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: series.yLabel, color: textColor },
          ticks: { color: textColor, precision: 0 },
          grid: { color: gridColor },
        },
      },
    },
  });
}

function populateFilters(allMatches) {
  const opponentSelect = document.getElementById('publicPlayerOpponentFilter');
  const gameSelect = document.getElementById('publicPlayerGameFilter');
  if (!opponentSelect || !gameSelect) return;

  const opponents = new Map();
  const games = new Set();
  for (const m of allMatches || []) {
    const slot = matchPlayerSlot(m, playerId);
    if (!slot) continue;
    const opponentId = slot === '1' ? m.player2Id : m.player1Id;
    const opponentName = slot === '1' ? m.player2Name : m.player1Name;
    const key = String(opponentId || opponentName || '').trim();
    if (key) opponents.set(key, String(opponentName || key).trim());
    if (m.gameType) games.add(m.gameType);
  }

  opponentSelect.innerHTML = ['<option value="">All opponents</option>'].concat(
    Array.from(opponents.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) =>
        `<option value="${escapeHtml(id)}"${id === opponentFilter ? ' selected' : ''}>${escapeHtml(name)}</option>`
      )
  ).join('');
  if (opponentFilter && !opponents.has(opponentFilter)) opponentFilter = '';

  gameSelect.innerHTML = ['<option value="">All games</option>'].concat(
    Array.from(games)
      .sort((a, b) => gameTypeLabel(a).localeCompare(gameTypeLabel(b)))
      .map((gt) =>
        `<option value="${escapeHtml(gt)}"${gt === gameFilter ? ' selected' : ''}>${escapeHtml(gameTypeLabel(gt))}</option>`
      )
  ).join('');
  if (gameFilter && !games.has(gameFilter)) gameFilter = '';
  opponentSelect.value = opponentFilter;
  gameSelect.value = gameFilter;
}

function renderSummary(player) {
  const summary = document.getElementById('publicPlayerSummary');
  if (!summary) return;
  const cards = [];
  const gamesWon = player?.gamesWon || 0;
  const gamesDrawn = player?.gamesDrawn || 0;
  const gamesLost = player?.gamesLost || 0;
  const racksWon = player?.racksWon || 0;
  const racksLost = player?.racksLost || 0;
  if (gamesWon + gamesDrawn + gamesLost > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${formatMatchRecord(gamesWon, gamesDrawn, gamesLost)}</strong><span>Matches W/D/L</span></div>`);
    cards.push(`<div class="stats-summary-card"><strong>${winPct(gamesWon, gamesLost, gamesDrawn)}%</strong><span>Win %</span></div>`);
  }
  if (racksWon + racksLost > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${racksWon}/${racksLost}</strong><span>Racks W/L</span></div>`);
  }
  if ((player?.highestBreak || 0) > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${player.highestBreak}</strong><span>Highest break</span></div>`);
  }
  if ((player?.highestRun || 0) > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${player.highestRun}</strong><span>Longest run</span></div>`);
  }
  if ((player?.breakAndRuns || 0) > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${player.breakAndRuns}</strong><span>B&amp;R</span></div>`);
  }
  if ((player?.tableRuns || 0) > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${player.tableRuns}</strong><span>Table runs</span></div>`);
  }
  if ((player?.fouls || 0) > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${player.fouls}</strong><span>Fouls</span></div>`);
  }
  if ((player?.ballsPotted || 0) > 0) {
    cards.push(`<div class="stats-summary-card"><strong>${player.ballsPotted}</strong><span>Balls potted</span></div>`);
  }
  summary.innerHTML = cards.join('');
  summary.classList.toggle('hidden', cards.length === 0);
  if (cards.length) summary.style.setProperty('--stats-summary-cols', String(balancedSummaryColumns(cards.length)));
  else summary.style.removeProperty('--stats-summary-cols');
}

function render() {
  if (!playerData) return;
  const allMatches = playerData.matches || [];
  const matches = filteredMatches();
  const filteredStats = statsFromMatches(matches);
  const player = filteredStats.players.find((p) => p.id === playerId) || playerData.player;
  const title = document.getElementById('publicPlayerTitle');
  if (title) title.textContent = playerData.player?.name || 'Player';
  document.title = `${playerData.player?.name || 'Player'} — CueSport Scoreboard Cloud`;
  populateFilters(allMatches);
  renderSummary(player);
  renderH2HChart(matches);

  const body = document.getElementById('publicPlayerMatchesBody');
  if (!body) return;
  if (!matches.length) {
    body.innerHTML = '<tr><td colspan="4" class="dash-stats-empty">No matches for this player yet.</td></tr>';
    return;
  }
  body.innerHTML = matches.map((m) => {
    const inProgress = isMatchInProgress(m);
    const info = String(m.gameInfo || '').trim();
    const gameCell = info
      ? `${escapeHtml(gameTypeLabel(m.gameType))}<div class="stats-match-event-sub">${escapeHtml(info)}</div>`
      : escapeHtml(gameTypeLabel(m.gameType));
    return `
      <tr class="${inProgress ? 'stats-match-in-progress' : ''}">
        <td class="stats-match-when">${escapeHtml(formatLocalDate(m.completedAt || m.startedAt))}${inProgress ? ' <span class="stats-live-badge">Live</span>' : ''}</td>
        <td class="stats-match-pair-cell">${matchPairHtml(m)}</td>
        <td>${gameCell}</td>
        <td class="stats-match-score">${scoreCellHtml(m)}</td>
      </tr>
    `;
  }).join('');
}

async function loadPlayer() {
  const status = document.getElementById('publicPlayerStatus');
  const panel = document.getElementById('publicPlayerPanel');
  const parts = window.location.pathname.split('/').filter(Boolean);
  playerId = parts[0] === 'player' ? decodeURIComponent(parts[1] || '') : '';
  if (!playerId) {
    if (status) status.textContent = 'Player not found.';
    return;
  }
  readQueryFilters();
  try {
    const res = await fetch(`/api/public/players/${encodeURIComponent(playerId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Player not found');
    playerData = body;
    panel?.classList.remove('hidden');
    if (status) status.textContent = '';
    render();
  } catch (err) {
    panel?.classList.add('hidden');
    if (status) status.textContent = err.message || 'Player not found.';
  }
}

document.getElementById('publicPlayerOpponentFilter')?.addEventListener('change', (event) => {
  opponentFilter = event.target.value || '';
  writeQueryFilters();
  render();
});

document.getElementById('publicPlayerGameFilter')?.addEventListener('change', (event) => {
  gameFilter = event.target.value || '';
  writeQueryFilters();
  render();
});

document.getElementById('publicH2HChartModeToggle')?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-h2h-chart-mode]');
  if (!btn) return;
  h2hChartMode = btn.getAttribute('data-h2h-chart-mode') === 'racks' ? 'racks' : 'matches';
  document.querySelectorAll('#publicH2HChartModeToggle [data-h2h-chart-mode]').forEach((el) => {
    const active = el.getAttribute('data-h2h-chart-mode') === h2hChartMode;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  render();
});

loadPlayer();
