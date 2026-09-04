import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { handleConnection, getConnectionCount } from './ws/room-hub.js';
import { registerAccountRoutes } from './api/accounts.js';
import { registerEventRoutes } from './api/events.js';
import { registerQrRoutes } from './api/qr.js';
import * as sqlite from './db/sqlite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..', 'web');

function sendWebHtml(reply, relativePath) {
  const filePath = path.join(webRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    app.log.error(
      { filePath, webRoot },
      'Web UI file missing — remove host ./web volume in production or rebuild the image'
    );
    return reply.code(503).send({
      error: 'Web UI not available',
      message: `Missing ${relativePath}. Use the Docker image web assets (no ./web volume), or mount a valid backend/web path for local dev.`,
    });
  }
  const html = fs.readFileSync(filePath, 'utf8');
  reply.type('text/html').send(html);
}

const app = Fastify({ logger: true });

// Dock control panel often loads from file:// or a different host than the API.
function applyCorsHeaders(request, reply) {
  const origin = request.headers.origin;
  if (origin) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Vary', 'Origin');
  } else {
    reply.header('Access-Control-Allow-Origin', '*');
  }
  reply.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  reply.header(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Api-Key, X-Requested-With'
  );
}

app.addHook('onRequest', async (request, reply) => {
  applyCorsHeaders(request, reply);
  if (request.method === 'OPTIONS') {
    return reply.code(204).send();
  }
});

// Ensure preflight always succeeds even when no matching route exists.
app.options('/*', async (request, reply) => {
  applyCorsHeaders(request, reply);
  return reply.code(204).send();
});

await app.register(fastifyWebsocket);

await app.register(fastifyStatic, {
  root: webRoot,
  prefix: '/web/',
  decorateReply: false,
});

function resolveBallImageRoot() {
  const candidates = [
    path.join(__dirname, '..', 'common', 'images'),
    path.join(__dirname, '..', 'web', 'images', 'balls'),
    path.join(__dirname, '..', '..', 'common', 'images'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, '8ball_small.png'))) return dir;
  }
  return candidates.find((dir) => fs.existsSync(dir)) || null;
}

const ballImageRoot = resolveBallImageRoot();
const webBallDir = path.join(webRoot, 'images', 'balls');
const webBallsInWebRoot = fs.existsSync(path.join(webBallDir, '8ball_small.png'));

if (ballImageRoot) {
  await app.register(fastifyStatic, {
    root: ballImageRoot,
    prefix: '/images/balls/',
    decorateReply: false,
  });
  if (!webBallsInWebRoot) {
    await app.register(fastifyStatic, {
      root: ballImageRoot,
      prefix: '/web/images/balls/',
      decorateReply: false,
    });
  }
  app.log.info(
    { dir: ballImageRoot, webBallsInWebRoot },
    webBallsInWebRoot
      ? 'Ball images in /web/images/balls/ (via /web/ static) and /images/balls/'
      : 'Ball images at /web/images/balls/ and /images/balls/ (from common/images)'
  );
} else {
  app.log.warn(
    'Ball image directory not found — mobile ball art will 404. ' +
      'Rebuild the Docker image (includes common/images) or mount common/images at /app/common/images.'
  );
}

app.get('/', async (_req, reply) => sendWebHtml(reply, 'public-listing/index.html'));
app.get('/streams', async (_req, reply) => sendWebHtml(reply, 'public-listing/index.html'));
app.get('/dashboard', async (_req, reply) => sendWebHtml(reply, 'dashboard/index.html'));
app.get('/m/:roomId', async (_req, reply) => sendWebHtml(reply, 'mobile/index.html'));
app.get('/g/:guestToken', async (_req, reply) => sendWebHtml(reply, 'mobile/index.html'));

app.get('/health', async () => ({
  ok: true,
  version: '1.0.0-cloud',
  connections: getConnectionCount(),
  devAuth: config.allowDevAuth,
  ballImages: webBallsInWebRoot || !!(ballImageRoot && fs.existsSync(path.join(ballImageRoot, '8ball_small.png'))),
  ballImagesPath: '/web/images/balls/8ball_small.png',
}));

app.get('/ws', { websocket: true }, (socket) => {
  handleConnection(socket);
});

await registerAccountRoutes(app);
await registerEventRoutes(app);
registerQrRoutes(app);

sqlite.getDb();

if (!fs.existsSync(path.join(webRoot, 'mobile', 'index.html'))) {
  app.log.error(
    { webRoot },
    'Web UI not found under /app/web — production stacks must not mount ./web unless that host folder exists; rebuild the image instead'
  );
}

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`CueSport Cloud listening on ${config.publicUrl}`);
  console.log(`  Dashboard: ${config.publicUrl}/dashboard`);
  console.log(`  WebSocket: ${config.publicUrl.replace(/^http/, 'ws')}/ws`);
});
