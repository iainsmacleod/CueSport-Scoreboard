# CueSport Scoreboard — Release Notes

**8.3.0 → 8.3.5** · September 2026

Patch release focused on **local player stats parity** (draws, career fields, empty pregame handling), a clearer **Stats** modal (**Recent Matches** + **Leaderboard**), **match filters on dock and dashboard**, **complimentary access expiry**, and scoring/UI polish (illegal 8-ball foul attribution, upload tooltips, mobile shell after sign-in, Cloud connection copy).

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
- **Player / Event / date-range filters** (with autocomplete) — same idea as Cloud Match Stats; the leaderboard rebuilds from the filtered match set when a filter is active

Export / import remains **additive** on schema version 1 — older exports still load; new fields appear when present.

---

## Match stats filters (dock + dashboard)

Filter completed matches and scoped leaderboards by:

- Player search with autocomplete (pick locks to roster id; free text matches names)
- Event / game-info autocomplete
- From / To date range, plus Clear

On the Cloud dashboard this lands on **Match Stats**; on the OBS dock it sits above Recent Matches / Leaderboard in the Stats modal (local IndexedDB and cloud-backed modes).

---

## Complimentary access expiry

When complimentary Cloud access ends and there is no active subscription:

- Dock Keys for that account are **revoked** automatically
- **Ad-hoc tables are closed** (same as plan downgrade seat reset)
- In-progress cloud matches on revoked seats are **discarded**; completed history is kept
- Auth / billing sync and WebSocket room auth enforce the expiry
- Self-host and managed Cloud both use the same path

Manual Dock Key revoke / revoke-all also removes the mapped dock table and discards any open cloud match for that seat.

See the backend README for the expiry behaviour and related config.

---

## Scoring & UI polish

### Pool — lose on the 8

An illegal lose-on-8 foul attributes the foul to the **shooter**, not the winner (OBS dock and ad-hoc Cloud authority). Covered in smoke / unit tests.

### Control panel tooltips

Logo / file-upload **L2 / L3** hover tips sit outside the button surface (no more clipped scrollbars from `filter` creating a containing block).

### Cloud connection copy

The dock Cloud connection intro drops the self-hosted vs managed explainer and goes straight to sign-in / Dock Key instructions.

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
