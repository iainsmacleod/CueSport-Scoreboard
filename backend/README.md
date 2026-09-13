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

Default database is **SQLite** at `backend/data/cuesport.db` — no external services required for development. Path is controlled by **`SQLITE_PATH`** (`src/config.js` → `src/db/sqlite.js`). On startup, a legacy `match_events` table without `account_id` is dropped and recreated (match history cleared; accounts/rooms kept). To fully reset local data, delete `cuesport.db` (and `-wal` / `-shm`) and restart.

Set `DEV_AUTH_SECRET` and `DEV_AUTH_ACCOUNT_EMAIL` in `.env` (see `.env.example`) before using dev sign-in on the dashboard or mobile.

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

**Production VPS** (Caddy + HTTPS + Supabase Google Auth + SQLite): see **[VPS deployment](../docs/deploy-vps.md)**.

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
2. Set **Server URL** (e.g. `http://localhost:3000` or `http://localhost:4003` with Docker).
3. Create an account on the dashboard (dev login) and create an **OBS Dock Key**.
4. Paste the Dock Key into the dock and enable cloud relay. **One Dock Key = one cloud table** (room identity is the key, not the dock `?instance=` query). Rooms are created when the dock connects.

## Environment variables

See [`.env.example`](.env.example).

| Variable | Purpose |
|----------|---------|
| `PUBLIC_URL` | Public base URL for OAuth redirects and client config |
| `DB_DRIVER` | `sqlite` (default) or `supabase` |
| `SUPABASE_URL` | Supabase project URL (production auth) |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` — browser OAuth + server `createClient` (not legacy `anon`) |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` — server-only (not legacy `service_role`; never send to browsers) |
| `SUPABASE_JWT_SECRET` | JWT verification (or use JWKS) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Web Client ID for the [official GIS Sign in with Google button](https://developers.google.com/identity/gsi/web/guides/display-button). Same client as Supabase → Auth → Google. Add `PUBLIC_URL` (and `http://localhost:3000` for local) as Authorized JavaScript origins. If unset, dashboard falls back to Supabase OAuth redirect. |
| `ALLOW_DEV_AUTH` | Enable secret dev-login when Supabase not configured |
| `DEV_AUTH_SECRET` | Shared secret for dev login (required when dev auth is on) |
| `DEV_AUTH_ACCOUNT_EMAIL` | Email for the single self-host account (required when dev auth is on; use your Google address to ease later managed migration) |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated Google emails allowed to use `/api/admin/*` and the dashboard **Admin** tab (hosted multi-tenant support) |
| `TIER_DEFAULT` | Default subscription tier (`streamer`, `tournament_organizer`, `league_director`, `network_organization`, `selfhost`) |
| `TIER_LIMITS_JSON` | Optional JSON override of the full tier catalog |
| `TIER_{TIER}_MAX_API_KEYS` | Per-tier OBS Dock Key (seat) cap |
| `TIER_{TIER}_MAX_ROOMS` | Safety ceiling on room rows (instance churn); not shown as “tables used” |
| `TIER_{TIER}_MAX_CONTROL_CONNECTIONS` | Per-tier mobile+guest connections per table |
| `STRIPE_SECRET_KEY` | Stripe secret key (managed billing; leave empty on self-host) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_STREAMER` / `STRIPE_PRICE_TOURNAMENT_ORGANIZER` / `STRIPE_PRICE_LEAGUE_DIRECTOR` | Stripe Price IDs for self-serve tiers |
| `STRIPE_TRIAL_DAYS` | Checkout trial length (default `30`) |
| `BILLING_CONTACT_URL` | Contact CTA for Network Organization (e.g. `mailto:…`) |
| `SUPPORT_ISSUES_URL` / `LEGAL_CONTACT_EMAIL` / `LEGAL_ENTITY_NAME` / `LEGAL_GOVERNING_LAW` | Legal page placeholders (`/terms`, `/privacy`) |
| `ROOM_CLEANUP_GRACE_MS` | After last dock leaves, wait before deleting the room (default 45m) |
| `ROOM_IDLE_TTL_MS` | Delete mapped rooms older than this `last_seen_at` (default 14d) |
| `ROOM_CLEANUP_SWEEPER_MS` | How often the sweeper runs (default 10m) |

Built-in defaults (all overridable via the env vars above).
**One OBS Dock Key = one live dock connection and one cloud table** (create a separate key per table and paste into each dock). Rooms are keyed by Dock Key (`api_key_id`); the dock’s local `?instance=` only isolates localStorage / BroadcastChannel. Rooms are created when a dock connects and pruned after idle — match history is never deleted with the room.

| Tier | Dock keys (seats) | Room safety cap | Mobile + guest / table |
|------|-------------------|-----------------|------------------------|
| `streamer` | 2 | 2 | 5 |
| `tournament_organizer` | 3 | 3 | 5 |
| `league_director` | 10 | 10 | 5 |
| `network_organization` | 25 | 25 | 10 |
| `selfhost` | 2 | 2 | 5 |

## Supabase setup (production)

1. Create a Supabase project.
2. Run [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql), [`002_session_epoch_quotas.sql`](supabase/migrations/002_session_epoch_quotas.sql), [`003_account_players_uuid.sql`](supabase/migrations/003_account_players_uuid.sql), [`004_dock_key_roles.sql`](supabase/migrations/004_dock_key_roles.sql), then [`005_admin_support_trial.sql`](supabase/migrations/005_admin_support_trial.sql) in the SQL editor.
3. Enable **Google** provider under Authentication → Providers.
4. Add redirect URLs: `{PUBLIC_URL}/web/dashboard/`, `{PUBLIC_URL}/auth/callback`.
5. Set env vars in `.env` (including `PLATFORM_ADMIN_EMAILS` for your ops Google accounts) and deploy.

On first Google sign-in, the server links `auth.users.id` to an `accounts` row. On managed cloud (`ALLOW_DEV_AUTH=false`), new accounts start **`inactive`** until Stripe Checkout. Existing `active` rows are grandfathered. Rooms are created later when an OBS dock connects with a Dock Key.

### Stripe billing (managed)

1. Create three Stripe Products/Prices (Streamer, Tournament Organizer, League Director).
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_*` in `.env`.
3. Add webhook endpoint `{PUBLIC_URL}/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
4. Enable Customer Portal (cancel / payment method / switch among the three prices).
5. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Checkout uses a **30-day card-required trial** (`STRIPE_TRIAL_DAYS`). Status becomes `trialing`, then `active`. Cancel/manage via Customer Portal. Network Organization is contact-only (`BILLING_CONTACT_URL`).

Legal templates: `/terms` and `/privacy` (replace placeholders; obtain counsel review before commercial reliance).

### Platform admin + trials

Hosted multi-tenant support is gated by **`PLATFORM_ADMIN_EMAILS`** (not Dock Key roles or subscription tiers). Allowlisted users get `is_platform_admin` on `GET /api/me`, an **Admin** tab, a **View account** filter on Tables/Stats (**My account**, **All accounts**, or one tenant), and `/api/admin/*` routes (list tenants, read tables/stats/players, revoke keys, invalidate sessions, grant/end **support trials**). Platform admins bypass subscription/trial gates on their own account and can pick a **Simulated plan** (default **Unrestricted**, or simulate any catalog tier’s dock-key/table limits via `PATCH /api/me/simulated-plan`).

Access for dock/mobile join allows when **any** of:
- `subscription_status` is `active` or `trialing` (Stripe Checkout + webhooks), **or**
- `accounts.trial_ends_at` is set and still in the future (**admin support trial** for demos / grace / pre-card).

Paid tiers are **not** edited by the admin UI; product free trials belong on Stripe (`trial_period_days` / `trialing`). Admin only sets `trial_ends_at`.

## WebSocket protocol

Clients send `join` then `event`, `command`, `state`, or `session` messages. See the [CueSport Cloud plan](../docs/) or root README for full schema.

**Guest links** (`join` with `guest_token`): reusable until revoked, but only **one live WebSocket per token**. A second concurrent join receives `guest_link_in_use`. Guests may score with the same action balls as the dock for that game (`pool_foul` / `snooker_foul` / `undo`; free ball via `snooker_ball` on Snooker; `respot_ball` on Bank / One Pocket), change game setup (`set_game_type`, ball variant / early-game / golden ball / point-based, race, event info), and match controls (`reset_scores` / `end_match` / `call_match_early`); names and replay stay forbidden.

**Promote Live Stream** uses Cloud `state` only (`streamPromotionListed` + OBS live + stream URL). Legacy WebSocket `auth` / `update` messages are no longer accepted.

## GPL + hosted service

This backend is GPL-licensed alongside the scoreboard. You may run your own instance for free. The author's hosted service at `cuesport.macleod.systems` is an optional managed deployment (uptime, auth, storage). The subscription fee covers that managed hosting — not ownership of the GPL software.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config/public` | Client-facing config |
| POST | `/api/auth/dev-login` | Dev auth (secret → signed token) |
| GET | `/api/me` | Account, rooms, keys, quota, billing flags, `is_platform_admin`, simulated plan (Bearer token) |
| PATCH | `/api/me/simulated-plan` | Platform admin: `{ tier: "unrestricted" \| "<catalog_tier>" }` for plan-limit simulation |
| GET | `/api/billing/plans` | Plan catalog (limits + contact tier) |
| POST | `/api/billing/checkout` | Stripe Checkout session `{ tier, acceptedTerms }` |
| POST | `/api/billing/portal` | Stripe Customer Portal session |
| POST | `/api/stripe/webhook` | Stripe webhooks (raw body + signature) |
| GET | `/terms` / `/privacy` | Hosted Terms + Privacy templates |
| GET | `/api/admin/accounts` | Platform admin: list tenants (optional `?q=` email filter) |
| GET | `/api/admin/accounts/:id` | Platform admin: tenant detail + quota |
| GET | `/api/admin/tables` | Platform admin: live tables across tenants (`account_email` on each room) |
| GET | `/api/admin/stats` | Platform admin: merged match stats across tenants (namespaced player ids) |
| GET | `/api/admin/players` | Platform admin: player search across tenants |
| GET | `/api/admin/accounts/:id/stats` | Platform admin: account match stats |
| GET | `/api/admin/accounts/:id/tables` | Platform admin: live tables for a tenant |
| GET | `/api/admin/accounts/:id/players` | Platform admin: player search for a tenant |
| POST | `/api/admin/accounts/:id/trial` | Platform admin: grant/extend support trial `{ days: 1–90 }` |
| DELETE | `/api/admin/accounts/:id/trial` | Platform admin: end support trial |
| POST | `/api/admin/accounts/:id/invalidate-sessions` | Platform admin: sign out everywhere for tenant |
| POST | `/api/admin/accounts/:id/api-keys/:keyId/revoke` | Platform admin: revoke dock key |
| POST | `/api/api-keys` | Create API key (tier-limited; requires active/trialing access on managed) |
| GET | `/api/api-keys/:keyId` | View API key plaintext (account owner) |
| DELETE | `/api/api-keys/:keyId` | Revoke API key (kicks connected dock) |
| DELETE | `/api/rooms/:roomId` | Delete room/table mapping (keeps match history) |
| POST | `/api/rooms/:roomId/guest-link` | Create guest scorer link (token for `/g/{token}`) |
| GET | `/api/rooms/:roomId/guest-links` | List guest links for a room |
| GET | `/api/guest-links` | List guest scorer links for the account |
| DELETE | `/api/guest-links/:token` | Revoke guest link |
| POST | `/api/guest-links/revoke-all` | Revoke all guest links and disconnect guests |
| POST | `/api/sessions/invalidate-all` | Sign out everywhere (invalidate + disconnect admin dashboard and mobile) |
| GET | `/api/rooms/:roomId/events` | Match event log |
| GET | `/api/stats` | Account match stats (players, matches, summary) |
| PATCH | `/api/stats/matches/:startEventId` | Edit a completed match (scores, names, extras; winner derived from scores) |
| DELETE | `/api/stats/matches/:startEventId` | Delete a completed match, or abandon an in-progress (unended) match. Abandon clears the room session pointer and, when a dock is connected to that room, relays `abandon_match` (`dockNotified` in the response). |
| PATCH | `/api/stats/players` | Rename a player across all match history + roster |
| GET | `/api/players` | Account player roster (autocomplete) |
| GET | `/api/streams` | Active public streams |
