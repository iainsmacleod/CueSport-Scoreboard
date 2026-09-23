# CueSport Scoreboard — Release Notes

**8.2.3 → 8.3.0** · September 2026

Minor release focused on **ad-hoc (dockless) Cloud tables**, clearer **plan / seat quotas** (including ad-hoc limits on billing cards and docs), **self-host simulated plans** for local quota testing, and **plan-downgrade seat reset**. Also includes Snooker and pool scoring polish, session/guest invalidation improvements, and match-stats reconciliation fixes from the 8.2.4 line.

Local OBS scoring continues to work without Cloud. Ad-hoc tables are an optional Cloud feature on hosted and self-hosted deployments.

---

## Headline: Ad-hoc tables

Create a dockless scoring seat from the Dashboard **Tables** tab. The signed-in owner phone (or dashboard control session) is the **scoring authority** — guests relay commands over Cloud WebSocket; there is no OBS BroadcastChannel / browser source path.

- **Create Ad-hoc Table** beside the first-time OBS onboarding carousel (and as a + card when tables already exist).
- Tier-limited seats **separate from OBS Dock Key seats** (`maxImpromptuTables`, same counts as dock keys: 2 / 5 / 10 / 25).
- Land on mobile **Setup**, then score from **Control**. **Share** for guest links. No Stream tab.
- **Destroy Table** (next to Restart Match) discards an unwanted seat without writing match history.
- **End Match** / **Call Match** save history and free the ad-hoc seat. **Restart Match** keeps the seat.

### Guests

- A scoring-only **Guest scorer** link is created with the table.
- No **OBS Dock Owner** elevated guest link — the signed-in owner is already the authority.
- Standard guest permissions apply (score, breaker, setup, Restart/End/Call; no names, Stream, Share, or Destroy).

### Dashboard status

Ad-hoc table cards show presence clearly:

- **Ready** — nobody connected  
- **Admin** — owner controlling as authority  
- **Guest** — a guest link is open (scoring still needs Admin)

**Table Connections** in Settings lists docks and ad-hoc seats with kind-aware details.

### At-limit upgrade prompt

When ad-hoc seats are full (or the account still needs a plan), the create card becomes an unlock / upgrade prompt:

- **Ad-hoc seats full** — shows usage on the current plan; copy explains ending/destroying a match to free a seat, or upgrading for more.
- **Choose a plan** — for inactive accounts that need a subscription first.
- Click opens **Account → Subscription** (billing or simulated plan, depending on deployment).

---

## Plans, quotas & billing UI

- Hosted plan tables and billing cards now list **ad-hoc tables** alongside dock keys and mobile/guest caps.
- Wiki hosted setup, README, backend README, `.env.example`, and Docker Compose document / wire `TIER_*_MAX_IMPROMPTU_TABLES`.
- Self-host remains **unrestricted** by default (`ALLOW_DEV_AUTH`); the old capped `selfhost` catalog numbers were retired (label only).

### Simulated plan (self-host + Platform Admin)

- **Account → Simulated plan** applies catalog dock-key / ad-hoc limits for testing without Google/Supabase/Stripe (self-host) or as Platform Admin on managed cloud.
- Default remains **Unrestricted**.

### Plan downgrade seat reset

Moving to a **lower-capacity** tier clears seats so the account must rebuild within the new limits:

- **Stripe downgrade** (Customer Portal / webhook) — revokes all OBS Dock Keys (kicks docks) and deletes all ad-hoc tables.
- **Simulated plan downgrade** (including Unrestricted → Streamer) — same reset for local testing.
- **Upgrades** leave existing keys and ad-hoc tables alone.
- Match history is kept.

No Stripe Dashboard / Product / Checkout configuration changes were required for this behavior — it is handled in the Cloud backend when the subscription (or simulated plan) capacity decreases.

---

## Platform Admin

- Account list columns split **Keys · OBS · Ad-hoc** (instead of a single Tables count).
- Account detail quota shows keys / OBS / ad-hoc usage; each table row is labeled **OBS** or **Ad-hoc**.

---

## Scoring & control panel (dock + Cloud)

### Snooker

- Free-ball, foul, and clearance polish (including free-ball art on ad-hoc / mobile).
- Golden Ball mechanics and related frame/break handling.
- Breaker prompt parity with the dock (“Breaking Player?” until selected; re-prompts after a rack).

### Pool games

- Dry-break / early-game and 8-Ball ball-set / Chosen Ball flow improvements.
- Mobile Chosen Ball setup UI simplified (badges / scoring path; heavy setup chrome removed where appropriate).
- Broader unit and smoke coverage for game scenarios.

### Stats / history (8.2.4 line)

- Match rack reconciliation improvements (scoreline trim, stale winner remap, fewer duplicate rack rows).
- Clearer empty-stats messaging (“No stats recorded for this game”).

---

## Sessions & guests (8.2.4 line)

- **Sign out everywhere** / admin **Invalidate sessions** also revokes guest links and disconnects guest devices (OBS Dock Keys are retained).
- Shared Supabase session helper for dashboard / mobile sign-in continuity.

---

## Docs

- [Multiple Tables](../../wiki/Multiple-Tables.md) — ad-hoc create / score / destroy / seat rules  
- [Cloud Dashboard, Mobile & Guests](../../wiki/Cloud-Dashboard-Mobile-Guests.md)  
- [Cloud Hosted Setup](../../wiki/Cloud-Hosted-Setup.md) — plan seats including ad-hoc  
- [Cloud Self-Hosted Setup](../../wiki/Cloud-Self-Hosted-Setup.md) — simulated plan note  
- [Cloud Overview](../../wiki/Cloud-Overview.md)  
- Backend README — plan changes / downgrade behavior  

---

## Upgrade notes

- Restart the Cloud backend after deploy so room-hub presence, ad-hoc authority, and downgrade seat reset are live.
- Hard-refresh dashboard, mobile, and OBS dock so `?v=8.3.0` assets load.
- Existing dock tables and Dock Keys are unaffected by the upgrade itself.
- After a **plan downgrade**, expect Dock Keys and ad-hoc tables to be cleared; recreate seats under the new tier.
- Docker Compose now passes `TIER_*_MAX_IMPROMPTU_TABLES` (defaults match built-in catalog caps).
