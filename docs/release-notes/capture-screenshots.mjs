/**
 * Capture control-panel screenshots for release notes.
 *
 * Usage (from docs/release-notes/):
 *   python -m http.server 8765   # repo root, other terminal
 *   npm install
 *   node capture-screenshots.mjs --version 7.2.0
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:8765/control_panel.html';

function parseVersion(argv) {
  const idx = argv.indexOf('--version');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return '7.2.2';
}

async function clickTab(page, tabButtonId, tabContentId) {
  await page.click(`#${tabButtonId}`);
  await page.waitForSelector(`#${tabContentId}`, { state: 'visible' });
  await page.waitForTimeout(300);
}

async function main() {
  const version = parseVersion(process.argv);
  const OUT = path.join(__dirname, version, 'images');
  await mkdir(OUT, { recursive: true });

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

  // Ultimate Pool Balls on Controls (8-Ball + ball scoring + ultimate variant)
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
