# Cloud Self-Hosted Setup

Run the included Node.js / Docker backend yourself. Self-hosting is **free and unrestricted** (no Stripe). There is **one server-owner account**; you delegate tables with named OBS Dock Keys and guest links.

For production VPS + HTTPS + Google auth details, see [docs/deploy-vps.md](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/docs/deploy-vps.md) and [backend/README](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/backend/README.md).

## Quick start (Node)

```bash
cd backend
cp .env.example .env
# Set at least:
#   DEV_AUTH_SECRET=...
#   DEV_AUTH_ACCOUNT_EMAIL=you@example.com
#   PUBLIC_URL=http://localhost:3000
#   ALLOW_DEV_AUTH=true
npm install
npm start
```

Open:

- Dashboard: http://localhost:3000/dashboard
- Live Streams: http://localhost:3000/
- WebSocket: ws://localhost:3000/ws

Default database: SQLite at `backend/data/cuesport.db`.

## Quick start (Docker)

```bash
cd backend
cp .env.example .env
# Set PUBLIC_URL=http://localhost:4003 (and DEV_AUTH_* as above)
docker compose up -d --build
```

- Dashboard: http://localhost:4003/dashboard
- WebSocket: ws://localhost:4003/ws
- Data: persisted in `backend/data/`

In the OBS dock Connection settings → **Self-hosting**, use server URL `http://localhost:4003` (or your public hostname).

## Access model

| Piece | Purpose |
|-------|---------|
| **Owner login** | `DEV_AUTH_SECRET` + `DEV_AUTH_ACCOUNT_EMAIL` on `/dashboard` |
| **OBS Dock Keys** | One named key per table/operator; roles Administrator / Trusted Operator / Operator |
| **Guest links** | Temporary mobile scorers; players do not need accounts |

Do **not** share the owner secret with every scorer — create Dock Keys and guest links instead.

Platform Admin and Stripe billing are **disabled** in self-host / dev-auth mode. Use **Account → Simulated plan** to temporarily apply catalog dock-key / ad-hoc limits for local testing (default: Unrestricted).

## Connect the OBS dock

1. Sign in to the dashboard with the owner secret.
2. Create a named **OBS Dock Key** (pick the least-privileged suitable role).
3. In OBS dock → **Settings → CueSport Scoreboard Cloud → ⚙**:
   - Open **Self-hosting**.
   - **Server URL**: e.g. `http://localhost:3000` or `http://localhost:4003`.
   - Paste the Dock Key.
   - **Save & Connect**, then enable the Cloud toggle if needed.
4. Dashboard **Tables** should show the dock online.
5. Open `/m/{room_id}` on your phone — enter the owner secret once if that browser is not already signed in.

**One Dock Key = one cloud table.** Local `?instance=` does not create extra cloud rooms — see [Multiple Tables](Multiple-Tables).

## Production notes (summary)

- Set a stable `PUBLIC_URL` (HTTPS in production).
- Prefer Docker or a process manager; back up `backend/data/` before upgrades.
- For Google sign-in instead of (or in addition to) dev auth, configure Supabase + Google OAuth per `backend/README`.
- SQLite schema upgrades run on backend startup.
- Web UI assets are baked into the Docker image; only `./data` is mounted by default.

## Related

- [Cloud Overview](Cloud-Overview)
- [Cloud Hosted Setup](Cloud-Hosted-Setup)
- [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests)
- [Troubleshooting](Troubleshooting)
