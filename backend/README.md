# CueSport Cloud Backend

Self-hostable cloud relay for [CueSport Scoreboard](../README.md): room-based WebSocket hub, Google OAuth (via Supabase), mobile remote control, match event logging, and public stream listing.

## Quick start (local / self-host)

```bash
cd backend
cp .env.example .env
npm install
npm start
```

Open:

- **Dashboard:** http://localhost:3000/dashboard
- **Stream listing:** http://localhost:3000/
- **WebSocket:** ws://localhost:3000/ws

Default database is **SQLite** at `backend/data/cuesport.db` — no external services required for development.

### Docker (self-host)

```bash
cd backend
cp .env.example .env
# Edit .env: set PUBLIC_URL=http://localhost:4003 for Docker port mapping
docker compose up -d --build
```

- **Dashboard:** http://localhost:4003/dashboard
- **WebSocket:** ws://localhost:4003/ws
- **Data:** persisted in `backend/data/` (SQLite)

In the OBS dock **Self-host settings**, use server URL `http://localhost:4003` (or your public hostname).

To publish an image: `docker build -t cuesport-cloud:latest .`

## OBS dock connection

### Hosted (Google sign-in)

1. Enable **CueSport Cloud** in the control panel Replay/Share tab.
2. Click **Sign in with Google** (or use dev login on local backend).
3. Toggle cloud relay on.

### Self-host (API key)

1. Open **Self-host settings** in the dock.
2. Set **Server URL** (e.g. `http://localhost:3000`).
3. Create an account on the dashboard (dev login) and copy **Room ID** + **API key**.
4. Paste into the dock and enable cloud relay.

## Environment variables

See [`.env.example`](.env.example).

| Variable | Purpose |
|----------|---------|
| `PUBLIC_URL` | Public base URL for OAuth redirects and client config |
| `DB_DRIVER` | `sqlite` (default) or `supabase` |
| `SUPABASE_URL` | Supabase project URL (production auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key |
| `SUPABASE_JWT_SECRET` | JWT verification (or use JWKS) |
| `SUPABASE_ANON_KEY` | Exposed to web clients for OAuth |
| `ALLOW_DEV_AUTH` | Enable email dev-login when Supabase not configured |

## Supabase setup (production)

1. Create a Supabase project.
2. Run [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) in the SQL editor.
3. Enable **Google** provider under Authentication → Providers.
4. Add redirect URLs: `{PUBLIC_URL}/web/dashboard/`, `{PUBLIC_URL}/auth/callback`.
5. Set env vars in `.env` and deploy.

On first Google sign-in, the server links `auth.users.id` to an `accounts` row and creates a default room.

## WebSocket protocol

Clients send `join` then `event`, `command`, `state`, or `session` messages. See the [CueSport Cloud plan](../docs/) or root README for full schema.

Legacy stream promotion clients (`auth` + `update`) are supported for backward compatibility.

## GPL + hosted service

This backend is GPL-licensed alongside the scoreboard. You may run your own instance for free. The author's hosted service at `cuesports.macleod.systems` is an optional managed deployment (uptime, auth, storage).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config/public` | Client-facing config |
| POST | `/api/auth/dev-login` | Dev auth (email → token) |
| GET | `/api/me` | Account, rooms, keys (Bearer token) |
| POST | `/api/api-keys` | Create API key |
| GET | `/api/rooms/:roomId/events` | Match event log |
| GET | `/api/streams` | Active public streams |
