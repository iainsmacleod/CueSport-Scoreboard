# CueSport Scoreboard — Release Notes

**8.3.0 → 8.3.5** · September 2026

Patch release focused on **local player stats parity** (draws, career fields, empty pregame handling), a clearer **Stats** modal (**Recent Matches** + **Leaderboard**), **dashboard match filters**, **complimentary access expiry**, and scoring/UI polish (illegal 8-ball foul attribution, upload tooltips, mobile shell after sign-in).

Local OBS scoring continues to work without Cloud. Cloud dashboard / mobile / self-host deployments pick up the same stats and shell fixes.

---

## Headline: Stats that match how you play

### Draws & career fields

Local IndexedDB player stats now track **games drawn** alongside wins/losses (including Call Early draws), and keep **Break & Run / Table Run** career totals in step with Cloud.

- Leaderboard **W / D / L**, win % that accounts for draws, and win streaks that break on a draw
- Head-to-head **Matches Drawn** for local and Cloud comparisons
- Shared parity helpers + dual-cycle scenarios so local and Cloud deltas stay aligned in tests

### Empty pregame is not a draw

Ending a match that never left the empty pregame / 0–0 state no longer writes a completed draw into history (local or ad-hoc Cloud). Only sessions with recorded play count.

### Stats modal (OBS dock)

The dock **Stats** modal is streamlined around what you use mid-session:

- Tabs: **Recent Matches** and **Leaderboard** (standalone H2H tab removed — open a player for head-to-head)
- Click a player on the leaderboard (or from a match) for the detail view, with **Back** to return
- Match winners render in green for quicker scanning

Export / import remains **additive** on schema version 1 — older exports still load; new fields appear when present.

---

## Dashboard match stats filters

Cloud dashboard match statistics gain practical filters:

- Player and event search with autocomplete
- Date range constraints
- Clearer leaderboard headers / sorting

---

## Complimentary access expiry

When complimentary Cloud access ends and there is no active subscription:

- Dock Keys for that account are **revoked** automatically
- Auth / billing sync and WebSocket room auth enforce the expiry
- Self-host and managed Cloud both use the same path

See the backend README for the expiry behaviour and related config.

---

## Scoring & UI polish

### Pool — lose on the 8

An illegal lose-on-8 foul attributes the foul to the **shooter**, not the winner (OBS dock and ad-hoc Cloud authority). Covered in smoke / unit tests.

### Control panel tooltips

Logo / file-upload **L2 / L3** hover tips sit outside the button surface (no more clipped scrollbars from `filter` creating a containing block).

### Visual shell

- Modern Cloud / mobile backgrounds use **non-repeating** radial gradients so the panel no longer looks tiled
- After mobile sign-in, the bottom nav docks to the real visual viewport (`--app-vh` + settle) instead of floating above a keyboard/URL-bar gap until you change tabs

---

## Docs & versioning

- Product / cache-bust version **8.3.5** (`versionNum`, README, wiki, dashboard & mobile asset queries)
- Release tooling examples point at 8.3.5

---

## Upgrade notes

- Hard-refresh the OBS dock, browser source, dashboard, and mobile so `?v=8.3.5` assets load.
- Restart the Cloud backend after deploy so complimentary expiry, room auth, and ad-hoc foul attribution are live.
- Existing local stats DBs upgrade in place (new draw / B&R fields populate as matches complete or recompute).
- Older stats exports remain importable; re-export after upgrade if you want the new fields in the file.
- Accounts whose complimentary access has already expired may lose Dock Keys on first post-upgrade sync — reconnect under an active plan or renewed access.
