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
  const html = fs.readFileSync(filePath, 'utf8');
  reply.type('text/html').send(html);
}

const app = Fastify({ logger: true });

await app.register(fastifyWebsocket);

await app.register(fastifyStatic, {
  root: webRoot,
  prefix: '/web/',
  decorateReply: false,
});

const ballImageDirs = [
  path.join(__dirname, '..', '..', 'common', 'images'),
  path.join(__dirname, '..', 'common', 'images'),
  path.join(__dirname, '..', 'web', 'images', 'balls'),
].filter((dir) => fs.existsSync(dir));
if (ballImageDirs.length) {
  await app.register(fastifyStatic, {
    root: ballImageDirs[0],
    prefix: '/images/balls/',
    decorateReply: false,
  });
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
}));

app.get('/ws', { websocket: true }, (socket) => {
  handleConnection(socket);
});

await registerAccountRoutes(app);
await registerEventRoutes(app);
registerQrRoutes(app);

sqlite.getDb();

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`CueSport Cloud listening on ${config.publicUrl}`);
  console.log(`  Dashboard: ${config.publicUrl}/dashboard`);
  console.log(`  WebSocket: ${config.publicUrl.replace(/^http/, 'ws')}/ws`);
});
