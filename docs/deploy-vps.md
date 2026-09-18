# CueSport Scoreboard Cloud — VPS deployment

Guide for hosting the managed CueSport Scoreboard Cloud backend on a single Linux VPS with **Docker Compose**, **Caddy** (HTTPS), **SQLite** (app data), and **Supabase Auth** (Google sign-in).

This is the **managed, multi-tenant hosted-service** deployment: customers receive separate Google-authenticated accounts and service operators use `PLATFORM_ADMIN_EMAILS` for support. A normal self-hosted installation instead uses one server-owner account and delegates OBS access with named, role-scoped Dock Keys or temporary guest links; it does not need Platform Admin or Stripe.

This is the recommended soft-launch / early SaaS layout. App data stays on the VPS; Supabase is identity only (not your product database).

## Architecture

```text
Users / OBS / Mobile
        │
        ▼
   DNS (A record)
        │
        ▼
  Caddy (:80 / :443)     ← Let’s Encrypt certs
        │
        ▼
  127.0.0.1:3000         ← Docker (CueSport Scoreboard Cloud)
        │
        ├── SQLite volume (accounts, keys, rooms, events)
        └── Supabase Auth (verify Google JWTs)
```

| Piece | Choice |
|-------|--------|
| App | Docker Compose ([`backend/docker-compose.yml`](../backend/docker-compose.yml)) |
| Data | SQLite on a host volume (`backend/data/`) |
| Auth | Supabase Auth + Google provider |
| TLS | Caddy on the host (auto HTTPS) |
| Process | One node (no load balancer required) |

## Provider requirements

Any classic VPS works (Vultr, Hetzner, DigitalOcean, Linode, Lightsail, …) if it offers:

**Must-have**

- Root/SSH Linux VPS (not shared hosting)
- Public IPv4
- Inbound **22**, **80**, **443** (firewall you control)
- Persistent disk for SQLite
- Outbound HTTPS (to Supabase / Google)
- Region near your users (live scoring cares about latency)

**Sizing (starting point, not a load test)**

| Stage | Spec |
|-------|------|
| Soft launch | **2 vCPU / 4 GB RAM / 40+ GB SSD** |
| Busier single node | 4 vCPU / 8 GB RAM |

Avoid serverless/PaaS that idle-kills long-lived **WebSockets**. Prefer **Debian** (or Ubuntu) for Docker + Caddy.

**Example that matches this guide:** Vultr Cloud Compute Shared CPU, 2 vCPU / 4 GB, Debian, ~$20/mo.

## 1. Provision the VPS

1. Create the instance (Debian recommended).
2. Attach an SSH key.
3. Cloud firewall: allow **TCP 22, 80, 443** from anywhere (`0.0.0.0/0`); drop the rest.
4. Note the public IPv4.

```bash
ssh root@YOUR_VPS_IP
apt update && apt upgrade -y
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

## 3. Install Caddy

On Debian:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Replace `/etc/caddy/Caddyfile` with **only** your domain (remove the default `:80` demo site):

```caddyfile
cuesport.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy obtains and renews **Let’s Encrypt** certificates automatically once DNS points at the VPS.

## 4. DNS

At your DNS host, create an **A** record (not a CNAME) for the hostname:

| Type | Host | Value |
|------|------|--------|
| A | `cuesport` (or your subdomain) | `YOUR_VPS_IP` |

Do **not** put an IP in a CNAME. A more-specific A record beats a wildcard `*`.

Check propagation (compare resolvers; caches can disagree for a few minutes):

```bash
nslookup cuesport.example.com 1.1.1.1
nslookup cuesport.example.com 8.8.8.8
```

If you use Pi-hole, **flush the DNS cache** (not only the network table) after changing records.

## 5. Deploy CueSport Scoreboard Cloud

```bash
mkdir -p /opt/cuesport
cd /opt/cuesport
git clone https://github.com/iainsmacleod/CueSport-Scoreboard.git .
cd backend
cp .env.example .env
nano .env
```

### Production `.env` essentials

```env
PUBLIC_URL=https://cuesport.example.com
DB_DRIVER=sqlite
ALLOW_DEV_AUTH=false

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
# Leave empty unless you intentionally set Supabase JWT Secret (JWKS is used when empty)
SUPABASE_JWT_SECRET=
# Generate once with `openssl rand -hex 32`; keep stable across deployments.
ACCOUNT_FINGERPRINT_SECRET=...
ACCOUNT_IDENTITY_RETENTION_DAYS=1095

PLATFORM_ADMIN_EMAILS=you@gmail.com
```

Google Client ID/Secret live in the **Supabase** dashboard, not in this file.

### Bind the app to localhost only

The VPS update script applies `deploy/docker-compose.prod.yml`, which publishes:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

That matches host Caddy (`reverse_proxy 127.0.0.1:3000`). The base `docker-compose.yml` still uses `4003:3000` for local/dev — do not rely on that alone on the VPS or you will get **HTTP 502**.

Keep inside the container:

```env
PORT=3000
HOST=0.0.0.0
```

Do **not** deploy `docker-compose.override.example.yml` mounts on the VPS.

```bash
cd /opt/cuesport/backend
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml ps
curl -sS http://127.0.0.1:3000/health
```

If you see **502** after an update: the app is probably only on `:4003` while Caddy still targets `:3000`. Re-run with the prod overlay (or `update-vps.sh`), then confirm `ss -tlnp | grep 3000`.

## 6. Supabase Auth (Google)

1. Enable **Google** under Authentication → Providers.
2. Site URL: `https://cuesport.example.com`
3. Redirect allowlist:
   - `https://cuesport.example.com/dashboard`
   - `https://cuesport.example.com/web/dashboard/`
   - `https://cuesport.example.com/auth/callback`
4. Confirm public config:

```bash
curl -sS https://cuesport.example.com/api/config/public
```

Expect non-null `supabaseUrl` and `supabasePublishableKey`.

### Sign-in troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Dashboard `Unauthorized` after Google | Clear/wrong `SUPABASE_JWT_SECRET` — leave empty and recreate container |
| Dock “Dev login — enter secret” instead of Google | Dock can’t see publishable config (wrong server URL or stale dock JS) — refresh dock; check `/api/config/public` |
| Redirect errors from Supabase | Redirect URL allowlist / `PUBLIC_URL` mismatch |

New Google accounts on managed cloud (`ALLOW_DEV_AUTH=false`) are created in **SQLite** with `subscription_status=inactive` until Stripe Checkout or admin **Complimentary access**. Streamer Checkout uses a card-required free trial when the Streamer Product has metadata `trial_period_days` (e.g. `14`) → `trialing`, then auto `active` on Streamer. Tournament Organizer / League Director charge immediately. Existing `active` accounts are grandfathered. Product defaults are **not** configured in Supabase.

### Stripe billing (production)

**Legal vs brand:** activate Stripe as your LLC (tax ID, bank). Set public/Checkout branding to **CueSport Scoreboard Cloud** and your CueSport URL. Put the LLC name in `LEGAL_ENTITY_NAME`.

1. Create Stripe Products/Prices (names must match exactly):
   - **Streamer** — monthly USD Price; Product metadata `trial_period_days=14`
   - **Tournament Organizer** — monthly USD Price; **no** trial metadata
   - **League Director** — monthly USD Price; **no** trial metadata  
   Launch amounts are entered only in Stripe (e.g. $12 / $20 / $30) — never hardcoded in the app.
2. Add to `.env` (then recreate the container):

```env
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STREAMER=price_...
STRIPE_PRICE_TOURNAMENT_ORGANIZER=price_...
STRIPE_PRICE_LEAGUE_DIRECTOR=price_...
BILLING_CONTACT_URL=mailto:you@example.com
LEGAL_CONTACT_EMAIL=you@example.com
LEGAL_ENTITY_NAME=MacLeod Systems Consulting, LLC
LEGAL_GOVERNING_LAW=Commonwealth of Pennsylvania, USA
```

3. Stripe Dashboard → Webhooks → `https://cuesport.example.com/api/stripe/webhook`  
   Events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
4. Enable **Stripe Tax** in the Dashboard (registrations / origin as advised by your accountant). Checkout already sends `automatic_tax`, required billing address, and **tax ID collection** so business customers can enter a VAT/GST/business tax ID. Also enable **Customer Portal** (cancel at period end; allow switching among the three prices; CueSport branding).
5. Review `/terms` and `/privacy` placeholders with counsel before relying on them commercially.
6. Smoke test (Test mode): Streamer Checkout with `4242…` → `trialing` → Portal; TO Checkout → `active` immediately.

Tier ids: `streamer`, `tournament_organizer`, `league_director` (plus contact-only `network_organization`). Self-host uses `selfhost`. Platform admins grant **Complimentary access** (no card) from the Admin tab.

### Account deletion and signup blocking

The Admin tab can permanently delete customer accounts. Deletion revokes credentials, disconnects live clients, immediately cancels active Stripe subscriptions, removes the Supabase Auth user, and deletes account-owned SQLite data. Active billing requires a second explicit confirmation. Stripe invoice/payment/tax history remains in Stripe for accounting.

Administrators may optionally block future Cloud access from the same email or reset that email’s Streamer trial eligibility during deletion. These are independent choices and both default off. The application stores keyed HMAC fingerprints rather than the deleted email or Supabase identity; resetting trial eligibility clears only the trial-used marker, while the identity fingerprint still rejects an already-issued JWT for the deleted user. A genuinely new Supabase signup remains possible unless the email was explicitly blocked. **Allow Future Signup** requires entering the exact email again. Set a stable `ACCOUNT_FINGERPRINT_SECRET` before enabling managed sign-in. Changing this key makes existing deleted-identity, trial-history, and email-block lookups unavailable.

Unblocked deletion/trial fingerprints are retained for 1095 days by default and pruned at startup. Change `ACCOUNT_IDENTITY_RETENTION_DAYS` if your reviewed retention policy requires a different period. Signup-block fingerprints remain until a platform administrator explicitly unblocks the email.

## 7. Verify HTTPS

From your PC:

```powershell
Test-NetConnection YOUR_VPS_IP -Port 80
Test-NetConnection YOUR_VPS_IP -Port 443
curl.exe -sS https://cuesport.example.com/health
```

Expect JSON with `"ok":true`. Open `https://cuesport.example.com/dashboard`.

On the VPS, useful checks:

```bash
systemctl status caddy
ss -tlnp | grep -E ':80|:443|:3000'
journalctl -u caddy -n 40 --no-pager
ufw status verbose   # allow 80/443 if ufw is active
```

## 8. OBS dock (managed)

1. Sign in at `https://cuesport.example.com/dashboard` (or Settings after login).
2. Create an **OBS Dock Key**.
3. In the OBS CueSport dock → CueSport Scoreboard Cloud → paste the key → Enable.
4. Dock “Sign in with Google” opens the hosted dashboard; **Cloud scoring uses the Dock Key**.

Refresh the dock after updating local scoreboard files so it picks up script/config changes.

## 9. Updates / branch switches

**Do not** wipe `/opt/cuesport` on every deploy — that deletes `backend/data/` (accounts, Dock Keys, stats).

Use the helper script (preserves SQLite + `.env`, then rebuilds Compose):

```bash
# Interactive branch prompt (default: main)
sudo bash /opt/cuesport/backend/deploy/update-vps.sh

# Or pass a branch
sudo bash /opt/cuesport/backend/deploy/update-vps.sh main
```

Equivalent manual steps:

```bash
cd /opt/cuesport
git fetch origin
git checkout -B main origin/main
git reset --hard origin/main
cd /opt/cuesport/backend
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build --force-recreate
```

Optional: keep a copy of production env at `~/cuesport.env`. The script refreshes that backup from `backend/.env` when present, and restores it if `.env` is missing after a clone.

**First install only** (empty `/opt/cuesport`): clone once, create `.env`, then `docker compose up -d --build`. For disaster recovery, back up `backend/data/` and `.env` before wiping the tree, then restore both after clone.

## 10. Backups and ops

- Persist `backend/data/` (SQLite). Prefer provider snapshots weekly.
- Nightly: checkpoint then copy `cuesport.db` off-box:

```bash
sqlite3 /opt/cuesport/backend/data/cuesport.db 'PRAGMA wal_checkpoint(TRUNCATE);'
# then copy cuesport.db to object storage / another host
```

- Uptime monitor: `https://cuesport.example.com/health`
- Logs: `docker compose logs -f` and `journalctl -u caddy -f`

## What this setup is not

- **Not** `DB_DRIVER=supabase` / remote Postgres (optional later for multi-node)
- **Not** multi-region Kubernetes
- Legal pages are templates — counsel review required before commercial reliance

When one VPS is no longer enough: resize vertically first, then shared Postgres + more app nodes (with sticky WebSockets or shared live state).

## Related

- Env reference: [`backend/.env.example`](../backend/.env.example)
- Example Caddyfile: [`backend/deploy/Caddyfile.example`](../backend/deploy/Caddyfile.example)
- Backend overview: [`backend/README.md`](../backend/README.md)
- Local Docker: same Compose file with `PUBLIC_URL=http://localhost:4003` and published port `4003:3000`
