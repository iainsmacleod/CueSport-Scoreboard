# CueSport Scoreboard — Release Notes

**8.5.0 → 8.6.0** · October 2026

Minor release for the move to **cuesportscoreboard.com**, a clearer OBS dock Cloud sign-in, and a tabbed public homepage (**Shared Streams** plus an optional promo video). Local OBS scoring still works without Cloud.

Deploy the Cloud image and hard-refresh the dock together so the new host, Manage account button, and homepage stay in sync.

---

## Headline: cuesportscoreboard.com

The hosted service now uses **https://cuesportscoreboard.com**.

- Dock, dashboard, mobile, and docs links point at the new host
- A stored managed server URL that is exactly `https://cuesport.macleod.systems` is rewritten to the new host the next time that dock loads
- Self-hosted server URLs are left as entered
- Keep the old hostname reverse-proxied to the same app. Do not 301 it: OBS dock WebSockets and Stripe webhooks do not follow redirects

---

## OBS dock Cloud

- With a hosted OBS Dock Key saved, the Cloud button says **Manage account** and opens the dashboard Account tab. With no key, it stays **Sign in with Google**
- Sign-in copy asks whether you want hosted statistics and remote management, with a footnote for self-hosting
- The OBS Dock Key field uses the width of the dialog. An **×** at the end of the field clears the key (the separate Clear key button is gone)
- Settings popups use the active OBS theme for background, text, and border
- Text links use the active theme color

---

## Undo and chosen balls

Undo now restores 8-ball and Custom **chosen ball** (solids / stripes, or the open table). Undoing back to the start of the visit clears the selection, including the open-table pot counters that decide when the choice is assigned.

---

## Public site and account

- Homepage **Live Streams** is now **Shared Streams**. The tab stays hidden until someone is promoting a live stream, then polls faster while you are looking at it and slower in the background
- Optional homepage video tab when `LANDING_PROMO_YOUTUBE_URL` is set (YouTube nocookie embed)
- Signed-in Account panel links **Privacy Policy** and **Terms of Service** under the Deployment line

---

## Fixes

- Admin last-dock activity uses the later of room-dock and API-key timestamps, so a null timestamp no longer hides a real one

---

## Security

- Docker image pins **Node.js 22.23.4** (Oct 2026 security release, including CVE-2026-111497)
- Cloud deps: **fastify 5.12.7**, **@fastify/static 10.1.7**, with `fast-uri` overrides for patched transitive versions
- `@fastify/static` 10 `setHeaders` now uses the Fastify reply API (`reply.header`) for cache-control on `/web/` assets

---

## Docs & versioning

- Product / cache-bust version **8.6.0** (`versionNum`, README, wiki, dashboard, mobile, and public-listing asset queries)
- Dock Cloud script cache-bust is **8.6.0.1** so OBS reloads the Manage account button
- 8.5.0 release notes stay as history (Cloud H2H chart and local stats Export)

---

## Upgrade notes

- Set `PUBLIC_URL=https://cuesportscoreboard.com` and recreate the Cloud container
- Hard-refresh the Cloud dashboard, mobile, and public site so `?v=8.6.0` assets load
- Hard-refresh OBS docks after updating the dock files so the wider key field, themed popups, and **Manage account** button load
- Optional: set `LANDING_PROMO_YOUTUBE_URL` to show the homepage video tab
- No database migration required
