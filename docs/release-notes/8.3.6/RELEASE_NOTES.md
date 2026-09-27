# CueSport Scoreboard — Release Notes

**8.3.5 → 8.3.6** · September 2026

Patch release focused on **Cloud dashboard session boot**: signed-in reloads no longer flash the Sign In page (and Google button) between the loading spinner and the Account shell.

Local OBS scoring is unchanged. Deploy the Cloud web assets (and hard-refresh) to pick up the boot fix.

---

## Headline: No more Sign In flash on reload

When you already have a valid Google / Supabase session, a dashboard refresh could briefly show **Sign In** (with the Google button) after the spinner, then jump to Account.

**8.3.6** keeps the boot spinner until the session is settled, then reveals the app shell — never the login page — when a token is present.

### What changed

- Boot waits for Supabase’s first auth event (`INITIAL_SESSION`) before choosing Sign In vs app
- If a token exists, the **app shell shows immediately** while `/api/me` and billing still load
- OAuth hash / `auth=callback` adopt runs in the **same** boot path (no parallel render that flashed Sign In first)
- Official Google button mounts **only** when the login shell is actually shown
- Overlapping `renderDashboard()` calls are generation-guarded so a stale boot cannot overwrite a newer signed-in render
- Network blips on `/api/me` no longer drop a valid session onto Sign In

Related session work from 8.3.5 (await Sign Out clear, ignore stale `SIGNED_OUT`, hydrate before first shell) remains in place; this patch closes the remaining spinner → login → Account flash.

---

## Docs & versioning

- Product / cache-bust version **8.3.6** (`versionNum`, README, wiki, dashboard & mobile asset queries)
- Release tooling examples point at 8.3.6

---

## Upgrade notes

- Hard-refresh the Cloud dashboard (and mobile if open) so `?v=8.3.6` assets load.
- OBS dock / browser source cache-bust strings are bumped with this release; hard-refresh docks after pull if you ship the full package together.
- No database or local stats migration.
