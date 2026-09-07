#!/usr/bin/env node
/**
 * Run all CueSport test suites:
 *   1) backend API/WS (headless) — cd backend && npm test
 *   2) smoke_test.html (Playwright)
 *   3) cloud_relay_test.html (Playwright)
 *
 * Usage (from repo root or tests/):
 *   cd tests && npm install
 *   node run-all.mjs
 *   node run-all.mjs --cloud http://localhost:4003
 *   node run-all.mjs --skip-smoke
 *   node run-all.mjs --headed
 *
 * Requires CueSport Cloud listening (npm start or Docker). Reads DEV_AUTH_SECRET
 * from backend/.env unless --dev-secret=… is passed.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BACKEND = path.join(REPO, 'backend');
const STATIC_PORT = 8765;

function parseArgs(argv) {
  const out = {
    cloud: process.env.CLOUD_TEST_URL || 'http://localhost:3000',
    devSecret: process.env.DEV_AUTH_SECRET || '',
    skipApi: false,
    skipSmoke: false,
    skipRelay: false,
    headed: false,
    staticPort: STATIC_PORT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cloud' && argv[i + 1]) out.cloud = argv[++i];
    else if (a.startsWith('--cloud=')) out.cloud = a.slice('--cloud='.length);
    else if (a === '--dev-secret' && argv[i + 1]) out.devSecret = argv[++i];
    else if (a.startsWith('--dev-secret=')) out.devSecret = a.slice('--dev-secret='.length);
    else if (a === '--skip-api') out.skipApi = true;
    else if (a === '--skip-smoke') out.skipSmoke = true;
    else if (a === '--skip-relay') out.skipRelay = true;
    else if (a === '--headed') out.headed = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  out.cloud = String(out.cloud).replace(/\/$/, '');
  return out;
}

function readEnvFile(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  })[ext] || 'application/octet-stream';
}

function startStaticServer(rootDir, port) {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = urlPath === '/' ? '/tests/smoke_test.html' : urlPath;
      const filePath = path.normalize(path.join(rootDir, rel.replace(/^\//, '')));
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err && err.message ? err.message : err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function portOpen(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { method: 'GET', signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

async function cloudHealthy(base) {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json().catch(() => ({}));
    return !!(res.ok && body && body.ok);
  } catch {
    return false;
  }
}

function runNpmTest(cloudUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['tests/cloud-api.mjs', cloudUrl], {
      cwd: BACKEND,
      stdio: 'inherit',
      env: { ...process.env, CLOUD_TEST_URL: cloudUrl },
    });
    child.on('error', (err) => {
      console.error('Failed to spawn cloud-api tests:', err.message);
      resolve({ ok: false, code: 1 });
    });
    child.on('exit', (code) => resolve({ ok: code === 0, code: code ?? 1 }));
  });
}

async function runBrowserSuite(browser, {
  name,
  url,
  timeoutMs,
}) {
  const page = await browser.newPage();
  console.log(`\n==> ${name}`);
  console.log(`    ${url.replace(/dev_secret=[^&]+/i, 'dev_secret=***')}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__CUESPORT_TEST_RESULT__ && typeof window.__CUESPORT_TEST_RESULT__.ok === 'boolean',
      null,
      { timeout: timeoutMs }
    );
    const result = await page.evaluate(() => window.__CUESPORT_TEST_RESULT__);
    const label = result.ok ? 'PASS' : 'FAIL';
    console.log(
      `    ${label}  ${result.passed}/${result.total} passed` +
        (result.failed ? `, ${result.failed} failed` : '') +
        (result.skipped ? `, ${result.skipped} skipped` : '') +
        (result.error ? ` — ${result.error}` : '')
    );
    return { ok: !!result.ok, result };
  } catch (err) {
    console.error(`    FAIL  ${name}: ${err.message}`);
    return { ok: false, result: { error: err.message } };
  } finally {
    await page.close().catch(() => {});
  }
}

function printHelp() {
  console.log(`Usage: node tests/run-all.mjs [options]

Options:
  --cloud URL          Cloud backend (default http://localhost:3000)
  --dev-secret SECRET  DEV_AUTH_SECRET (default: backend/.env)
  --skip-api           Skip backend npm test
  --skip-smoke         Skip smoke_test.html
  --skip-relay         Skip cloud_relay_test.html
  --headed             Show the browser window
  -h, --help           Show this help

First-time setup:
  cd tests && npm install
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const envFile = readEnvFile(path.join(BACKEND, '.env'));
  if (!args.devSecret) args.devSecret = envFile.DEV_AUTH_SECRET || '';

  console.log('CueSport — run all tests');
  console.log(`  Cloud:  ${args.cloud}`);
  console.log(`  Static: http://127.0.0.1:${args.staticPort}`);

  if (!(await cloudHealthy(args.cloud))) {
    console.error(`\nCloud backend not healthy at ${args.cloud}/health`);
    console.error('Start it first:  cd backend && npm start');
    console.error('Or Docker:       cd backend && docker compose up -d   (then --cloud http://localhost:4003)');
    process.exit(1);
  }

  if (!args.skipSmoke && !args.skipRelay && !args.devSecret) {
    console.error('\nDEV_AUTH_SECRET missing. Set it in backend/.env or pass --dev-secret=…');
    process.exit(1);
  }

  let staticServer = null;
  let ownStatic = false;
  if (!args.skipSmoke || !args.skipRelay) {
    if (await portOpen(args.staticPort)) {
      console.log(`\nUsing existing static server on :${args.staticPort}`);
    } else {
      staticServer = await startStaticServer(REPO, args.staticPort);
      ownStatic = true;
      console.log(`\nStarted static server on :${args.staticPort}`);
    }
  }

  const results = [];
  try {
    if (!args.skipApi) {
      console.log('\n==> Backend API / WebSocket (npm test)');
      const api = await runNpmTest(args.cloud);
      results.push({ name: 'backend npm test', ok: api.ok });
      if (!api.ok) console.error('    FAIL  backend npm test');
      else console.log('    PASS  backend npm test');
    }

    if (!args.skipSmoke || !args.skipRelay) {
      const browser = await chromium.launch({ headless: !args.headed });
      try {
        const secretQ = encodeURIComponent(args.devSecret);
        const cloudQ = encodeURIComponent(args.cloud);
        if (!args.skipSmoke) {
          const smoke = await runBrowserSuite(browser, {
            name: 'smoke_test.html',
            url:
              `http://127.0.0.1:${args.staticPort}/tests/smoke_test.html` +
              `?autorun=1&cloud=${cloudQ}&dev_secret=${secretQ}`,
            timeoutMs: 15 * 60 * 1000,
          });
          results.push({ name: 'smoke', ok: smoke.ok });
        }
        if (!args.skipRelay) {
          const relay = await runBrowserSuite(browser, {
            name: 'cloud_relay_test.html',
            url:
              `http://127.0.0.1:${args.staticPort}/tests/cloud_relay_test.html` +
              `?autorun=1&server=${cloudQ}&dev_secret=${secretQ}`,
            timeoutMs: 3 * 60 * 1000,
          });
          results.push({ name: 'cloud_relay', ok: relay.ok });
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    if (ownStatic && staticServer) {
      await new Promise((resolve) => staticServer.close(resolve));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n========');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} suite(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll suites passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
