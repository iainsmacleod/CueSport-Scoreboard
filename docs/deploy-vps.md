# CueSport Cloud — VPS deployment

Guide for hosting the managed CueSport Cloud backend on a single Linux VPS with **Docker Compose**, **Caddy** (HTTPS), **SQLite** (app data), and **Supabase Auth** (Google sign-in).

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
  127.0.0.1:3000         ← Docker (CueSport Cloud)
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
cuesports.example.com {
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
| A | `cuesports` (or your subdomain) | `YOUR_VPS_IP` |

Do **not** put an IP in a CNAME. A more-specific A record beats a wildcard `*`.

Check propagation (compare resolvers; caches can disagree for a few minutes):

```bash
nslookup cuesports.example.com 1.1.1.1
nslookup cuesports.example.com 8.8.8.8
```

If you use Pi-hole, **flush the DNS cache** (not only the network table) after changing records.

## 5. Deploy CueSport Cloud

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
PUBLIC_URL=https://cuesports.example.com
DB_DRIVER=sqlite
ALLOW_DEV_AUTH=false

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
# Leave empty unless you intentionally set Supabase JWT Secret (JWKS is used when empty)
SUPABASE_JWT_SECRET=

PLATFORM_ADMIN_EMAILS=you@gmail.com
```

Google Client ID/Secret live in the **Supabase** dashboard, not in this file.

### Bind the app to localhost only

In `docker-compose.yml`, publish the app only on the host loopback so Caddy is the public entry:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

Keep inside the container:

```env
PORT=3000
HOST=0.0.0.0
```

Do **not** deploy `docker-compose.override.yml` (dev mounts) on the VPS.

```bash
docker compose up -d --build
docker compose ps
curl -sS http://127.0.0.1:3000/health
```

## 6. Supabase Auth (Google)

1. Enable **Google** under Authentication → Providers.
2. Site URL: `https://cuesports.example.com`
3. Redirect allowlist:
   - `https://cuesports.example.com/dashboard`
   - `https://cuesports.example.com/web/dashboard/`
   - `https://cuesports.example.com/auth/callback`
4. Confirm public config:

```bash
curl -sS https://cuesports.example.com/api/config/public
```

Expect non-null `supabaseUrl` and `supabasePublishableKey`.

### Sign-in troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Dashboard `Unauthorized` after Google | Clear/wrong `SUPABASE_JWT_SECRET` — leave empty and recreate container |
| Dock “Dev login — enter secret” instead of Google | Dock can’t see publishable config (wrong server URL or stale dock JS) — refresh dock; check `/api/config/public` |
| Redirect errors from Supabase | Redirect URL allowlist / `PUBLIC_URL` mismatch |

New Google accounts are created in **SQLite** with `subscription_status=active` by default (no automatic timed trial until Stripe or admin support trials). Product defaults are **not** configured in Supabase.

## 7. Verify HTTPS

From your PC:

```powershell
Test-NetConnection YOUR_VPS_IP -Port 80
Test-NetConnection YOUR_VPS_IP -Port 443
curl.exe -sS https://cuesports.example.com/health
```

Expect JSON with `"ok":true`. Open `https://cuesports.example.com/dashboard`.

On the VPS, useful checks:

```bash
systemctl status caddy
ss -tlnp | grep -E ':80|:443|:3000'
journalctl -u caddy -n 40 --no-pager
ufw status verbose   # allow 80/443 if ufw is active
```

## 8. OBS dock (managed)

1. Sign in at `https://cuesports.example.com/dashboard` (or Settings after login).
2. Create an **OBS Dock Key**.
3. In the OBS CueSport dock → CueSport Cloud → paste the key → Enable.
4. Dock “Sign in with Google” opens the hosted dashboard; **Cloud scoring uses the Dock Key**.

Refresh the dock after updating local scoreboard files so it picks up script/config changes.

## 9. Updates

```bash
cd /opt/cuesport
git pull
cd backend
docker compose up -d --build
```

## 10. Backups and ops

- Persist `backend/data/` (SQLite). Prefer provider snapshots weekly.
- Nightly: checkpoint then copy `cuesport.db` off-box:

```bash
sqlite3 /opt/cuesport/backend/data/cuesport.db 'PRAGMA wal_checkpoint(TRUNCATE);'
# then copy cuesport.db to object storage / another host
```

- Uptime monitor: `https://cuesports.example.com/health`
- Logs: `docker compose logs -f` and `journalctl -u caddy -f`

## What this setup is not

- **Not** `DB_DRIVER=supabase` / remote Postgres (optional later for multi-node)
- **Not** Stripe billing yet (accounts default to active for soft launch)
- **Not** multi-region Kubernetes

When one VPS is no longer enough: resize vertically first, then shared Postgres + more app nodes (with sticky WebSockets or shared live state).

## Related

- Env reference: [`backend/.env.example`](../backend/.env.example)
- Example Caddyfile: [`backend/deploy/Caddyfile.example`](../backend/deploy/Caddyfile.example)
- Backend overview: [`backend/README.md`](../backend/README.md)
- Local Docker: same Compose file with `PUBLIC_URL=http://localhost:4003` and published port `4003:3000`
