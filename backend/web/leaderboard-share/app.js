function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function winPct(won, lost, drawn = 0) {
  const total = (Number(won) || 0) + (Number(lost) || 0) + (Number(drawn) || 0);
  if (!total) return 0;
  return Math.round(((Number(won) || 0) / total) * 1000) / 10;
}

function formatMatchRecord(won, drawn, lost) {
  return `${Number(won) || 0}/${Number(drawn) || 0}/${Number(lost) || 0}`;
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

function formatScopeLine(data) {
  const parts = [];
  const event = String(data.eventQuery || '').trim();
  if (event) parts.push(`Event: ${event}`);
  const from = String(data.dateFrom || '').trim();
  const to = String(data.dateTo || '').trim();
  if (from && to) parts.push(`Dates: ${from} → ${to}`);
  else if (from) parts.push(`From: ${from}`);
  else if (to) parts.push(`Through: ${to}`);
  return parts.join(' · ') || 'Scoped leaderboard';
}

function playerHasRecord(player) {
  return (Number(player?.gamesWon) || 0)
    + (Number(player?.gamesDrawn) || 0)
    + (Number(player?.gamesLost) || 0) > 0;
}

async function loadBoard() {
  const status = document.getElementById('publicBoardStatus');
  const panel = document.getElementById('publicBoardPanel');
  const parts = window.location.pathname.split('/').filter(Boolean);
  const token = parts[0] === 'l' ? decodeURIComponent(parts[1] || '') : '';
  if (!token) {
    if (status) status.textContent = 'Leaderboard not found.';
    return;
  }
  try {
    const res = await fetch(`/api/public/leaderboards/${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Leaderboard not found');

    const title = document.getElementById('publicBoardTitle');
    const scope = document.getElementById('publicBoardScope');
    const event = String(body.eventQuery || '').trim();
    if (title) title.textContent = event || 'Event Leaderboard';
    document.title = `${event || 'Event Leaderboard'} — CueSport Scoreboard Cloud`;
    if (scope) scope.textContent = formatScopeLine(body);

    const bodyEl = document.getElementById('publicBoardBody');
    const players = Array.isArray(body.players) ? body.players : [];
    if (!bodyEl) return;
    if (!players.length) {
      bodyEl.innerHTML = '<tr><td colspan="6" class="dash-stats-empty">No completed matches in this scope yet.</td></tr>';
    } else {
      let rank = 0;
      bodyEl.innerHTML = players.map((p) => {
        const played = playerHasRecord(p);
        if (played) rank += 1;
        const name = escapeHtml(p.name || p.id || '—');
        const nameCell = p.id
          ? `<a class="public-player-link" href="/player/${encodeURIComponent(p.id)}">${name}</a>`
          : name;
        return `
          <tr>
            <td>${played ? rank : '—'}</td>
            <td>${nameCell}</td>
            <td>${formatMatchRecord(p.gamesWon, p.gamesDrawn, p.gamesLost)}</td>
            <td>${played ? `${winPct(p.gamesWon, p.gamesLost, p.gamesDrawn)}%` : '—'}</td>
            <td>${(Number(p.racksWon) || 0) + (Number(p.racksLost) || 0) > 0 ? `${Number(p.racksWon) || 0}/${Number(p.racksLost) || 0}` : '—'}</td>
            <td>${escapeHtml(formatLocalDate(p.lastPlayedAt))}</td>
          </tr>
        `;
      }).join('');
    }

    panel?.classList.remove('hidden');
    if (status) status.textContent = '';
  } catch (err) {
    panel?.classList.add('hidden');
    if (status) status.textContent = err.message || 'Leaderboard not found.';
  }
}

loadBoard();
