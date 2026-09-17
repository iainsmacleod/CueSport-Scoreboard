/**
 * Capture control-panel / Cloud screenshots for release notes.
 *
 * Usage (from docs/release-notes/):
 *   npm install
 *   npx playwright install chromium
 *   node capture-screenshots.mjs --version 8.2.0
 *
 * Optional live backend:
 *   node capture-screenshots.mjs --version 8.2.0 --cloud http://localhost:4003
 *
 * Older versions (7.x) still expect a repo-root static server on :8765.
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const WEB = path.join(REPO, 'backend', 'web');
const MOCK_ROOM = '00000000-0000-4000-8000-release820001';
const MOCK_TOKEN = 'dev:release-notes@example.com';

function mockAccountStats() {
  const p1 = 'player-osullivan';
  const p2 = 'player-trump';
  const p3 = 'player-smith';
  const p4 = 'player-jones';
  return {
    summary: { matches: 2, players: 4, tables: 1 },
    players: [
      {
        id: p1,
        name: "O'Sullivan",
        gamesWon: 1,
        gamesDrawn: 0,
        gamesLost: 0,
        racksWon: 6,
        racksLost: 3,
        highestBreak: 112,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 0,
        ballsPotted: 48,
        fouls: 2,
        createdAt: '2026-03-01T18:00:00.000Z',
        lastPlayedAt: '2026-09-10T21:15:00.000Z',
      },
      {
        id: p2,
        name: 'Trump',
        gamesWon: 0,
        gamesDrawn: 0,
        gamesLost: 1,
        racksWon: 3,
        racksLost: 6,
        highestBreak: 74,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 0,
        ballsPotted: 31,
        fouls: 5,
        createdAt: '2026-03-01T18:00:00.000Z',
        lastPlayedAt: '2026-09-10T21:15:00.000Z',
      },
      {
        id: p3,
        name: 'Smith',
        gamesWon: 1,
        gamesDrawn: 0,
        gamesLost: 0,
        racksWon: 5,
        racksLost: 2,
        highestBreak: 0,
        highestRun: 0,
        breakAndRuns: 1,
        tableRuns: 0,
        ballsPotted: 42,
        fouls: 1,
        createdAt: '2026-04-12T12:00:00.000Z',
        lastPlayedAt: '2026-09-12T20:00:00.000Z',
      },
      {
        id: p4,
        name: 'Jones',
        gamesWon: 0,
        gamesDrawn: 0,
        gamesLost: 1,
        racksWon: 2,
        racksLost: 5,
        highestBreak: 0,
        highestRun: 0,
        breakAndRuns: 0,
        tableRuns: 1,
        ballsPotted: 28,
        fouls: 3,
        createdAt: '2026-04-12T12:00:00.000Z',
        lastPlayedAt: '2026-09-12T20:00:00.000Z',
      },
    ],
    matches: [
      {
        id: 'snooker-match-1',
        startEventId: 'evt-snooker-1',
        endEventId: 'evt-snooker-1-end',
        player1Id: p1,
        player2Id: p2,
        player1Name: "O'Sullivan",
        player2Name: 'Trump',
        gameType: 'game8',
        gameInfo: 'Club championship',
        startedAt: '2026-09-10T19:30:00.000Z',
        completedAt: '2026-09-10T21:15:00.000Z',
        durationSeconds: 6300,
        status: 'completed',
        winnerSlot: '1',
        scores: { p1: 6, p2: 3 },
        highestBreakP1: 112,
        highestBreakP2: 74,
        foulsP1: 2,
        foulsP2: 5,
        ballsP1: 48,
        ballsP2: 31,
        racks: [
          {
            rackNumber: 1,
            winnerSlot: '1',
            breakerSlot: '1',
            frameScore: { p1: 72, p2: 14 },
            highestBreakP1: 56,
            highestBreakP2: 14,
            foulsP1: 0,
            foulsP2: 1,
            durationSeconds: 680,
          },
          {
            rackNumber: 2,
            winnerSlot: '2',
            breakerSlot: '2',
            frameScore: { p1: 8, p2: 81 },
            highestBreakP1: 8,
            highestBreakP2: 74,
            foulsP1: 1,
            foulsP2: 0,
            durationSeconds: 720,
          },
          {
            rackNumber: 3,
            winnerSlot: '1',
            breakerSlot: '1',
            frameScore: { p1: 112, p2: 0 },
            highestBreakP1: 112,
            highestBreakP2: 0,
            foulsP1: 0,
            foulsP2: 1,
            durationSeconds: 540,
          },
          {
            rackNumber: 4,
            winnerSlot: '1',
            breakerSlot: '2',
            frameScore: { p1: 67, p2: 32 },
            highestBreakP1: 43,
            highestBreakP2: 28,
            foulsP1: 0,
            foulsP2: 2,
            durationSeconds: 610,
          },
        ],
      },
      {
        id: 'pool-match-1',
        startEventId: 'evt-pool-1',
        endEventId: 'evt-pool-1-end',
        player1Id: p3,
        player2Id: p4,
        player1Name: 'Smith',
        player2Name: 'Jones',
        gameType: 'game1',
        gameInfo: 'League night',
        startedAt: '2026-09-12T19:00:00.000Z',
        completedAt: '2026-09-12T20:00:00.000Z',
        durationSeconds: 3600,
        status: 'completed',
        winnerSlot: '1',
        scores: { p1: 5, p2: 2 },
        breakAndRunsP1: 1,
        tableRunsP2: 1,
        ballsP1: 42,
        ballsP2: 28,
        foulsP1: 1,
        foulsP2: 3,
        racks: [
          { rackNumber: 1, winnerSlot: '1', breakerSlot: '1', breakAndRun: true, foulsP1: 0, foulsP2: 0, durationSeconds: 240 },
          { rackNumber: 2, winnerSlot: '2', breakerSlot: '1', tableRun: true, foulsP1: 1, foulsP2: 0, durationSeconds: 310 },
          { rackNumber: 3, winnerSlot: '1', breakerSlot: '2', foulsP1: 0, foulsP2: 1, durationSeconds: 280 },
        ],
      },
    ],
    tables: [{ id: MOCK_ROOM, label: 'Main table' }],
  };
}

function parseArg(argv, flag, fallback = null) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1].replace(/\/$/, '');
  return fallback;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  })[ext] || 'application/octet-stream';
}

function startStaticServer(root) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const port = server.address().port;
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/control_panel.html';
      const filePath = path.join(root, rel.replace(/^\//, '').replace(/\.\./g, ''));
      if (!filePath.startsWith(root) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function startMockCloudServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;
      const json = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const url = new URL(req.url || '/', base);

      if (url.pathname === '/api/auth/dev-login' && req.method === 'POST') {
        return json({
          access_token: MOCK_TOKEN,
          account: { email: 'release-notes@example.com' },
          room: { id: MOCK_ROOM, label: 'Main table' },
        });
      }
      if (url.pathname === '/api/me') {
        return json({
          account: {
            email: 'release-notes@example.com',
            subscription_status: 'active',
            subscription_tier: 'streamer',
            subscription_tier_display: 'Streamer',
          },
          rooms: [
            {
              id: MOCK_ROOM,
              label: 'Main table',
              dock_connected: true,
              instance_key: 'default',
              dock_label: 'Main table',
              live_state: {
                gameType: 'game1',
                player1Name: 'Smith',
                player2Name: 'Jones',
                p1Score: 2,
                p2Score: 1,
                raceInfo: '5',
                raceLabel: 'Race',
                gameInfo: 'League night',
              },
            },
            {
              id: '00000000-0000-4000-8000-release820002',
              label: 'Side table',
              dock_connected: false,
              instance_key: 'side',
              dock_label: 'Side table',
              live_state: {},
            },
          ],
          api_keys: [
            { id: '1', label: 'Main table', role: 'admin', created_at: '2026-01-01' },
            { id: '2', label: 'Side table', role: 'operator', created_at: '2026-02-01' },
          ],
          quota: {
            tierDisplayName: 'Streamer',
            limits: { maxApiKeys: 3 },
            usage: { apiKeys: 2 },
          },
        });
      }
      if (url.pathname === '/api/config/public') {
        return json({ allowDevAuth: true, devAuthConfigured: true, publicUrl: base });
      }
      if (url.pathname === '/api/stats') {
        return json(mockAccountStats());
      }
      if (url.pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(path.join(WEB, 'dashboard/index.html')));
      }
      if (url.pathname.startsWith('/m/') || url.pathname.startsWith('/g/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(path.join(WEB, 'mobile/index.html')));
      }
      if (url.pathname.startsWith('/web/')) {
        const filePath = path.join(WEB, url.pathname.slice('/web/'.length));
        if (existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': contentType(filePath) });
          return res.end(readFileSync(filePath));
        }
      }
      if (url.pathname.startsWith('/images/balls/') || url.pathname.startsWith('/web/images/balls/')) {
        const prefix = url.pathname.startsWith('/web/images/balls/')
          ? '/web/images/balls/'
          : '/images/balls/';
        const filePath = path.join(REPO, 'common', 'images', url.pathname.slice(prefix.length));
        if (existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': contentType(filePath) });
          return res.end(readFileSync(filePath));
        }
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function clickTab(page, tabButtonId, tabContentId) {
  await page.click(`#${tabButtonId}`);
  await page.waitForSelector(`#${tabContentId}`, { state: 'visible' });
  await page.waitForTimeout(300);
}

async function enableModernCloudTheme(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('obsTheme', 'modern');
    } catch (_) { /* ignore */ }
    const select = document.getElementById('obsTheme');
    if (select) select.value = 'modern';
    if (typeof obsThemeChange === 'function') obsThemeChange();
    else if (typeof startThemeCheck === 'function') startThemeCheck();
  });
  await page.waitForTimeout(250);
}

async function captureLegacy(version) {
  const OUT = path.join(__dirname, version, 'images');
  await mkdir(OUT, { recursive: true });
  const BASE = 'http://127.0.0.1:8765/control_panel.html';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const shots = [
    { name: '01-setup-game-selection', button: 'gameInfoTab', content: 'GameInfo' },
    { name: '02-stats-tab', button: 'statsTab', content: 'StatsSettings' },
    { name: '03-settings-ball-scoring', button: 'generalSettingsTab', content: 'GeneralSettings' },
  ];

  for (const shot of shots) {
    await clickTab(page, shot.button, shot.content);
    await page.locator(`#${shot.content}`).screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  }

  await clickTab(page, 'controlsTab', 'Controls');
  await page.evaluate(() => {
    const cb = document.getElementById('ballTrackerCheckbox');
    if (cb && !cb.checked) {
      cb.checked = true;
      if (typeof useBallTracker === 'function') useBallTracker();
    }
  });
  await page.waitForTimeout(500);
  await page.locator('#Controls').screenshot({ path: path.join(OUT, '04-controls-breaking-player.png') });

  await page.evaluate(() => {
    const gameSel = document.getElementById('gameTypeSelect');
    if (gameSel) {
      gameSel.value = 'game1';
      if (typeof gameType === 'function') gameType('game1');
    }
  });
  await page.waitForTimeout(400);
  await clickTab(page, 'gameInfoTab', 'GameInfo');
  await page.evaluate(() => {
    const ballSel = document.getElementById('ballSelection');
    if (ballSel) {
      ballSel.value = 'ultimate';
      if (typeof toggleBallSelection === 'function') toggleBallSelection();
    }
  });
  await page.waitForTimeout(400);
  await clickTab(page, 'controlsTab', 'Controls');
  await page.evaluate(() => {
    const cb = document.getElementById('ballTrackerCheckbox');
    if (cb && !cb.checked) {
      cb.checked = true;
      if (typeof useBallTracker === 'function') useBallTracker();
    }
  });
  await page.waitForTimeout(500);
  await page.locator('#Controls').screenshot({ path: path.join(OUT, '01-controls-ultimate-balls.png') });

  await page.evaluate(() => {
    const sel = document.getElementById('gameTypeSelect');
    if (sel) {
      sel.value = 'game8';
      if (typeof gameType === 'function') gameType('game8');
    }
  });
  await page.waitForTimeout(600);
  await clickTab(page, 'gameInfoTab', 'GameInfo');
  await page.locator('#GameInfo').screenshot({ path: path.join(OUT, '05-setup-snooker.png') });

  await browser.close();
  console.log(`Screenshots saved to ${OUT}`);
}

async function capture820(version, cloudBaseArg) {
  const OUT = path.join(__dirname, version, 'images');
  await mkdir(OUT, { recursive: true });

  const panel = await startStaticServer(REPO);
  let cloudBase = cloudBaseArg;
  let cloudServer = null;
  if (!cloudBase) {
    const mock = await startMockCloudServer();
    cloudBase = mock.base;
    cloudServer = mock.server;
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
    await page.goto(`${panel.base}/control_panel.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    await enableModernCloudTheme(page);

    await clickTab(page, 'gameInfoTab', 'GameInfo');
    await page.locator('#GameInfo').screenshot({ path: path.join(OUT, '01-modern-cloud-setup.png') });

    await clickTab(page, 'controlsTab', 'Controls');
    await page.evaluate(() => {
      const cb = document.getElementById('ballTrackerCheckbox');
      if (cb && !cb.checked) {
        cb.checked = true;
        if (typeof useBallTracker === 'function') useBallTracker();
      }
    });
    await page.waitForTimeout(500);
    await page.locator('#Controls').screenshot({ path: path.join(OUT, '02-modern-cloud-controls.png') });

    await clickTab(page, 'generalSettingsTab', 'GeneralSettings');
    await page.locator('#cloudRelayLabel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.locator('#GeneralSettings').screenshot({ path: path.join(OUT, '03-settings-cloud.png') });

    await clickTab(page, 'remoteTab', 'RemoteSettings');
    await page.waitForTimeout(400);
    await page.locator('#RemoteSettings').screenshot({ path: path.join(OUT, '04-remote-tab.png') });

    // Snooker Controls — frames/points, foul, free ball, undo
    await page.evaluate(() => {
      const sel = document.getElementById('gameTypeSelect');
      if (sel) {
        sel.value = 'game8';
        if (typeof gameType === 'function') gameType('game8');
      }
      const cb = document.getElementById('ballTrackerCheckbox');
      if (cb && !cb.checked) {
        cb.checked = true;
        if (typeof useBallTracker === 'function') useBallTracker();
      }
      const p1 = document.getElementById('p1Name');
      const p2 = document.getElementById('p2Name');
      if (p1) {
        p1.value = "O'Sullivan";
        p1.dispatchEvent(new Event('input', { bubbles: true }));
        p1.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (p2) {
        p2.value = 'Trump';
        p2.dispatchEvent(new Event('input', { bubbles: true }));
        p2.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Advance past Breaking Player so Active Player + grid look match-ready
      const breaker = document.getElementById('rackBreakerP1Btn');
      if (breaker) breaker.click();
    });
    await page.waitForTimeout(700);
    await clickTab(page, 'controlsTab', 'Controls');
    await page.waitForTimeout(500);
    await page.locator('#Controls').screenshot({ path: path.join(OUT, '07-dock-snooker-controls.png') });
    await page.close();

    const dashPage = await browser.newPage({ viewport: { width: 980, height: 720 } });
    await dashPage.goto(`${cloudBase}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dashPage.fill('#devSecret', 'release-screenshot-secret');
    await dashPage.click('#devLoginBtn');
    await dashPage.waitForSelector('#dashboardSection:not(.hidden)', { timeout: 15000 });
    await dashPage.waitForSelector('#tableCards .table-card', { timeout: 10000 });
    await dashPage.evaluate(() => {
      const nav = document.querySelector('nav.dash-tabs');
      if (nav) nav.hidden = false;
    });
    await dashPage.waitForTimeout(500);
    // Full viewport so the Tables card + bottom nav read as the Cloud dashboard
    await dashPage.screenshot({ path: path.join(OUT, '05-cloud-dashboard.png') });

    // Stats → Matches with a Snooker match expanded (frame detail)
    await dashPage.click('.dash-tab[data-tab="stats"]');
    await dashPage.waitForSelector('#tabStats:not(.hidden), #statsOverview', { timeout: 10000 });
    await dashPage.waitForTimeout(600);
    await dashPage.click('.stats-subtab[data-stats-panel="matches"]');
    await dashPage.waitForSelector('#statsPanelMatches:not(.hidden)', { timeout: 5000 });
    await dashPage.waitForTimeout(400);
    const racksToggle = dashPage.locator('[data-toggle-racks="evt-snooker-1"]');
    await racksToggle.click();
    await dashPage.waitForSelector('.stats-match-racks-row', { timeout: 5000 });
    await dashPage.waitForTimeout(400);
    await dashPage.screenshot({ path: path.join(OUT, '09-cloud-stats-match-detail.png') });
    await dashPage.close();

    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobilePage.goto(`${cloudBase}/m/${MOCK_ROOM}`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForTimeout(600);
    await mobilePage.evaluate(() => {
      document.getElementById('loginSection')?.classList.add('hidden');
      document.getElementById('controlSection')?.classList.remove('hidden');
      document.getElementById('mobileBottomNav')?.classList.remove('hidden');
      document.body.classList.add('has-mobile-nav');
      document.body.classList.remove('controls-locked');
      const status = document.getElementById('connectionStatus');
      if (status) {
        status.className = 'conn-status connected';
        status.title = 'Connected';
      }
      const meta = document.getElementById('liveMeta');
      if (meta) meta.textContent = '8-Ball · Race 5 · League night';
      const setSlot = (btnId, name, selected) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const label = btn.querySelector('.slot-name');
        if (label) label.textContent = name;
        else btn.textContent = name;
        btn.classList.toggle('selected', !!selected);
      };
      setSlot('playerSlotP1Btn', 'Smith', true);
      setSlot('playerSlotP2Btn', 'Jones', false);
      const p1Label = document.getElementById('p1SingleLabel');
      const p2Label = document.getElementById('p2SingleLabel');
      if (p1Label) p1Label.textContent = 'Smith - Racks';
      if (p2Label) p2Label.textContent = 'Jones - Racks';
      const p1 = document.getElementById('p1SingleValue');
      const p2 = document.getElementById('p2SingleValue');
      if (p1) p1.textContent = '2';
      if (p2) p2.textContent = '1';
      document.getElementById('dualScoresPanel')?.classList.add('hidden');
      document.getElementById('singleScoresPanel')?.classList.remove('hidden');
      document.getElementById('playerSlotQuestion').textContent = 'Active Player';
    });
    await mobilePage.waitForTimeout(400);
    await mobilePage.locator('#viewControl').screenshot({ path: path.join(OUT, '06-cloud-mobile-control.png') });

    // Snooker mobile — dual frames/points, colour grid, break strip
    await mobilePage.evaluate(() => {
      const BALL_IMG = '/web/images/balls';
      const addBall = (grid, file, title, { faded = false, extraClass = '' } = {}) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ball-btn${extraClass ? ` ${extraClass}` : ''}${faded ? ' faded' : ''}`;
        btn.title = title;
        const img = document.createElement('img');
        img.src = `${BALL_IMG}/${file}`;
        img.alt = title;
        btn.appendChild(img);
        grid.appendChild(btn);
      };

      document.getElementById('liveMeta').textContent = "Snooker · Best Of 11 · Club championship";
      document.getElementById('playerSlotQuestion').textContent = 'Active Player';
      const setSlot = (btnId, name, selected) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const label = btn.querySelector('.slot-name');
        if (label) label.textContent = name;
        btn.classList.toggle('selected', !!selected);
      };
      setSlot('playerSlotP1Btn', "O'Sullivan", true);
      setSlot('playerSlotP2Btn', 'Trump', false);

      document.getElementById('singleScoresPanel')?.classList.add('hidden');
      document.getElementById('dualScoresPanel')?.classList.remove('hidden');
      document.getElementById('p1PrimaryLabel').textContent = "O'Sullivan - Frames";
      document.getElementById('p2PrimaryLabel').textContent = 'Trump - Frames';
      document.getElementById('p1PrimaryValue').textContent = '5';
      document.getElementById('p2PrimaryValue').textContent = '3';
      document.getElementById('p1SecondaryLabel').textContent = "O'Sullivan - Points";
      document.getElementById('p2SecondaryLabel').textContent = 'Trump - Points';
      document.getElementById('p1SecondaryValue').textContent = '67';
      document.getElementById('p2SecondaryValue').textContent = '12';

      const panel = document.getElementById('ballGridPanel');
      const grid = document.getElementById('ballGrid');
      panel?.classList.remove('hidden');
      if (grid) {
        grid.innerHTML = '';
        // Mid-frame: several reds down, colours available
        for (let i = 0; i < 6; i++) addBall(grid, 'snooker-red-small.png', 'Red', { faded: i < 4 });
        addBall(grid, 'snooker-yellow-small.png', 'Yellow');
        addBall(grid, 'snooker-green-small.png', 'Green');
        addBall(grid, 'snooker-brown-small.png', 'Brown');
        addBall(grid, 'snooker-blue-small.png', 'Blue');
        addBall(grid, 'snooker-pink-small.png', 'Pink');
        addBall(grid, 'snooker-black-small.png', 'Black');
        addBall(grid, 'snooker-freeball-small.png', 'Free Ball', { extraClass: 'freeball-btn' });
        addBall(grid, 'foul-small.png', 'Foul');
        addBall(grid, 'undo-small.png', 'Undo', { extraClass: 'undo-ball' });
      }

      const counter = document.getElementById('rackFoulCounter');
      counter?.classList.remove('hidden');
      document.getElementById('rackSnookerStatsRow')?.classList.remove('hidden');
      document.getElementById('rackBreakGroup')?.classList.remove('hidden');
      document.getElementById('rackSnookerStatsSep')?.classList.remove('hidden');
      const breakLabel = document.getElementById('rackCurrentBreakLabel');
      if (breakLabel) breakLabel.textContent = 'Break 32';
      const pts = document.getElementById('rackPointsRemainingValue');
      if (pts) pts.textContent = '91';
      const breakBalls = document.getElementById('rackBreakBalls');
      if (breakBalls) {
        breakBalls.innerHTML = '';
        [
          { color: '#c62828', count: 2, key: 'red' },
          { color: '#fdd835', count: 1, key: 'yellow' },
          { color: '#2e7d32', count: 1, key: 'green' },
          { color: '#6d4c41', count: 1, key: 'brown' },
        ].forEach((ball) => {
          const el = document.createElement('span');
          el.className = 'rack-break-ball';
          el.style.setProperty('--break-ball-color', ball.color);
          el.textContent = String(ball.count);
          el.title = `${ball.key} × ${ball.count}`;
          breakBalls.appendChild(el);
        });
      }
      const p1Name = document.getElementById('rackFoulP1Name');
      const p2Name = document.getElementById('rackFoulP2Name');
      if (p1Name) p1Name.textContent = "O'Sullivan";
      if (p2Name) p2Name.textContent = 'Trump';
      document.getElementById('rackFoulP1').textContent = '0';
      document.getElementById('rackFoulP2').textContent = '1';
      document.getElementById('rackFoulP1Wrap')?.classList.add('is-active');
      document.getElementById('rackFoulP2Wrap')?.classList.remove('is-active');
      if (counter) counter.title = 'Fouls this frame';
    });
    await mobilePage.waitForTimeout(500);
    await mobilePage.locator('#viewControl').screenshot({ path: path.join(OUT, '08-cloud-mobile-snooker.png') });
    await mobilePage.close();

    console.log(`Screenshots saved to ${OUT}`);
  } finally {
    await browser.close();
    panel.server.close();
    cloudServer?.close();
  }
}

async function main() {
  const version = parseArg(process.argv, '--version', '8.2.0');
  const cloudBase = parseArg(process.argv, '--cloud', null);
  const major = Number(String(version).split('.')[0]);

  if (major >= 8) {
    await capture820(version, cloudBase);
  } else {
    await captureLegacy(version);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
