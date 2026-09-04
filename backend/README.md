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

Default database is **SQLite** at `backend/data/cuesport.db` — no external services required for development. Path is controlled by **`SQLITE_PATH`** (`src/config.js` → `src/db/sqlite.js`).

> **Note:** Root-level `server.js` / `db.js` are a leftover legacy stream-promotion stack. They use `DB_PATH` → `streams.db` and are **not** used by `npm start` or Docker (`CMD node src/index.js`).

Set `DEV_AUTH_SECRET` in `.env` (see `.env.example`) before using dev sign-in on the dashboard or mobile.

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

Web UI and ball images are **baked into the Docker image** at build time. Only `./data` is mounted by default.

**Local live reload** (optional): copy `docker-compose.override.example.yml` to `docker-compose.override.yml` to mount `backend/web` and `common/images` from your repo. Do **not** use those mounts on a production server unless the full repo paths exist on the host — an empty mount hides the image files and causes `ENOENT` on `/m/...`.

In the OBS dock **Connection settings** (⚙) → **Self-hosting**, use server URL `http://localhost:4003` (or your public hostname).

To publish an image (from repo root — includes `common/images` ball assets):

```bash
docker build -f backend/Dockerfile -t cuesport-cloud:latest .
```

## OBS dock connection

### Hosted (Google sign-in)

1. Enable **CueSport Cloud** in the control panel Replay/Share tab.
2. Click **Sign in with Google** (or use dev login on local backend).
3. Toggle cloud relay on.

### Self-host (API key)

1. Open **Connection settings** (⚙) → **Self-hosting** in the dock.
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
| `ALLOW_DEV_AUTH` | Enable secret dev-login when Supabase not configured |
| `DEV_AUTH_SECRET` | Shared secret for dev login (required when dev auth is on) |
| `DEV_AUTH_ACCOUNT_EMAIL` | Email label for the single self-host account (default `dev@local`) |
| `TIER_DEFAULT` | Default subscription tier name (`starter`, `pro`, `enterprise`, `selfhost`) |
| `TIER_LIMITS_JSON` | Optional JSON override of the full tier catalog |
| `TIER_{TIER}_MAX_API_KEYS` | Per-tier OBS Dock Key cap (e.g. `TIER_STARTER_MAX_API_KEYS`) |
| `TIER_{TIER}_MAX_ROOMS` | Per-tier table (dock instance) cap |
| `TIER_{TIER}_MAX_CONTROL_CONNECTIONS` | Per-tier mobile+guest connections per table |

Built-in defaults (all overridable via the env vars above):

| Tier | OBS Dock Keys | Tables | Mobile + guest / table |
|------|---------------|--------|------------------------|
| `starter` | 1 | 2 | 5 |
| `pro` | 3 | 2 | 5 |
| `enterprise` | 10 | 2 | 5 |
| `selfhost` | 1 | 2 | 5 |

## Supabase setup (production)

1. Create a Supabase project.
2. Run [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) then [`002_session_epoch_quotas.sql`](supabase/migrations/002_session_epoch_quotas.sql) in the SQL editor.
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
| POST | `/api/auth/dev-login` | Dev auth (secret → signed token) |
| GET | `/api/me` | Account, rooms, keys, quota (Bearer token) |
| POST | `/api/api-keys` | Create API key (tier-limited) |
| GET | `/api/api-keys/:keyId` | View API key plaintext (account owner) |
| DELETE | `/api/api-keys/:keyId` | Revoke API key |
| GET | `/api/guest-links` | List guest scorer links |
| DELETE | `/api/guest-links/:token` | Revoke guest link |
| POST | `/api/guest-links/revoke-all` | Revoke all guest links and disconnect guests |
| POST | `/api/sessions/invalidate-all` | Sign out everywhere (invalidate + disconnect admin dashboard and mobile) |
| GET | `/api/rooms/:roomId/events` | Match event log |
| GET | `/api/stats` | Account match stats (players, matches, summary) |
| PATCH | `/api/stats/matches/:startEventId` | Edit a completed match (scores, names, extras; winner derived from scores) |
| DELETE | `/api/stats/matches/:startEventId` | Delete a completed match |
| PATCH | `/api/stats/players` | Rename a player across all match history + roster |
| GET | `/api/players` | Account player roster (autocomplete) |
| GET | `/api/streams` | Active public streams |
