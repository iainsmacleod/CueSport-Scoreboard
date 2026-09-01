/**
 * Capture README screenshots (control panel + CueSport Cloud web UI).
 *
 * Usage (from docs/readme/):
 *   npm install
 *   npx playwright install chromium
 *   node capture-screenshots.mjs
 *
 * Optional: pass a live backend for real cloud API/WS
 *   node capture-screenshots.mjs --cloud http://localhost:4003
 *
 * By default starts local mock servers so captures work offline.
 */
import { chromium } from 'playwright';
import { mkdir, copyFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const WEB = path.join(REPO, 'backend', 'web');
const OUT = path.join(__dirname, 'images');
const RELEASE_IMAGES = path.join(__dirname, '..', 'release-notes', '7.2.0', 'images');
const MOCK_ROOM = '00000000-0000-4000-8000-readme000001';
const MOCK_TOKEN = 'dev:readme-screenshots@example.com';

function parseCloudBase(argv) {
  const idx = argv.indexOf('--cloud');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1].replace(/\/$/, '');
  return null;
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
          account: { email: 'readme-screenshots@example.com' },
          room: { id: MOCK_ROOM, label: 'Main table' },
        });
      }
      if (url.pathname === '/api/me') {
        return json({
          account: { email: 'readme-screenshots@example.com', subscription_status: 'active' },
          rooms: [{
            id: MOCK_ROOM,
            label: 'Main table',
            dock_connected: false,
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
          }],
          api_keys: [{ id: '1', label: 'README key', created_at: '2026-01-01' }],
        });
      }
      if (url.pathname === '/api/config/public') {
        return json({ allowDevAuth: true, devAuthConfigured: true, publicUrl: base });
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

async function captureControlPanel(browser, panelBase) {
  const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
  await page.goto(`${panelBase}/control_panel.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);

  await clickTab(page, 'gameInfoTab', 'GameInfo');
  await page.locator('#GameInfo').screenshot({ path: path.join(OUT, '01-control-panel-setup.png') });

  await clickTab(page, 'controlsTab', 'Controls');
  await page.evaluate(() => {
    const cb = document.getElementById('ballTrackerCheckbox');
    if (cb && !cb.checked) {
      cb.checked = true;
      if (typeof useBallTracker === 'function') useBallTracker();
    }
  });
  await page.waitForTimeout(500);
  await page.locator('#Controls').screenshot({ path: path.join(OUT, '02-control-panel-controls.png') });

  await clickTab(page, 'replaySettingsTab', 'ReplaySettings');
  await page.waitForTimeout(400);
  await page.locator('#ReplaySettings').screenshot({ path: path.join(OUT, '03-control-panel-cloud.png') });
  await page.close();
}

async function captureCloudDashboard(browser, cloudBase) {
  const dashPage = await browser.newPage({ viewport: { width: 900, height: 820 } });
  await dashPage.goto(`${cloudBase}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dashPage.fill('#devSecret', 'readme-screenshot-secret');
  await dashPage.click('#devLoginBtn');
  await dashPage.waitForSelector('#dashboardSection:not(.hidden)', { timeout: 15000 });
  await dashPage.waitForTimeout(600);
  await dashPage.locator('#tabTables').screenshot({ path: path.join(OUT, '04-cloud-dashboard.png') });
  await dashPage.close();
}

async function captureCloudMobile(browser, cloudBase, roomId) {
  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobilePage.goto(`${cloudBase}/m/${roomId}`, { waitUntil: 'domcontentloaded' });
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
    const p1l = document.getElementById('p1PrimaryLabel');
    const p2l = document.getElementById('p2PrimaryLabel');
    if (p1l) p1l.textContent = 'Smith - Racks';
    if (p2l) p2l.textContent = 'Jones - Racks';
    document.getElementById('p1PrimaryValue').textContent = '2';
    document.getElementById('p2PrimaryValue').textContent = '1';
    document.getElementById('playerSlotQuestion').textContent = 'Active Player';
    const p1b = document.getElementById('playerSlotP1Btn');
    const p2b = document.getElementById('playerSlotP2Btn');
    if (p1b) { p1b.textContent = 'Smith'; p1b.classList.add('selected'); }
    if (p2b) p2b.textContent = 'Jones';
  });
  await mobilePage.waitForTimeout(400);
  await mobilePage.locator('#viewControl').screenshot({ path: path.join(OUT, '05-cloud-mobile-control.png') });
  await mobilePage.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const panel = await startStaticServer(REPO);
  let cloudBase = parseCloudBase(process.argv);
  let cloudServer = null;
  if (!cloudBase) {
    const mock = await startMockCloudServer();
    cloudBase = mock.base;
    cloudServer = mock.server;
  }

  const browser = await chromium.launch();
  try {
    await captureControlPanel(browser, panel.base);
    console.log('Control panel screenshots captured.');
    await captureCloudDashboard(browser, cloudBase);
    await captureCloudMobile(browser, cloudBase, MOCK_ROOM);
    console.log('Cloud screenshots captured.');
  } catch (err) {
    console.warn('Capture error, falling back to release-note copies where possible:', err.message);
    await copyFile(
      path.join(RELEASE_IMAGES, '01-setup-game-selection.png'),
      path.join(OUT, '01-control-panel-setup.png'),
    );
    await copyFile(
      path.join(RELEASE_IMAGES, '04-controls-breaking-player.png'),
      path.join(OUT, '02-control-panel-controls.png'),
    );
    throw err;
  } finally {
    await browser.close();
    panel.server.close();
    cloudServer?.close();
  }

  console.log(`Screenshots saved to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
