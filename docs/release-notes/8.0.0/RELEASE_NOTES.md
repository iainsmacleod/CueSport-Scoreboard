# CueSport Scoreboard — Release Notes

**7.2.2 → 8.0.0** · September 2026

Major release: **CueSport Cloud match stats** on the web dashboard, clearer break vs run tracking, and a fix so **Break & Run** / **Table Run** are recorded correctly for 8 / 9 / 10-Ball.

---

## What's new

### Cloud dashboard Stats

- Account-level **Match Stats** on the dashboard (leaderboard + recent matches as sub-tabs).
- Player drill-down: rename across all history, filter by opponent / game, edit or delete matches.
- Match **Game Info** (from the dock Game Information field) shown instead of room/table labels.
- Summary cards: completed matches, players, racks/frames played.
- Winner is derived from the higher score (not manually editable).
- Edit-match labels use player names; roster autocomplete when changing names.
- Save is enabled only when the form has changes.
- When cloud is connected, dock stats import/export/clear are disabled — manage history on the dashboard.
- Local dock stats keep a rolling **30-day** window; cloud history is unbounded.

### Highest Break vs Longest Run

- **Highest Break** (Snooker) and **Longest Run** (Straight Pool) are separate values in local stats, cloud payloads, and the dashboard.
- Overlay and Stats toggles treat them as distinct options.

### Break & Run / Table Run (8 / 9 / 10-Ball)

- Fixed a bug where Ball Scoring rack wins cleared breaker/visit state **before** stats recorded the rack, so B&R and TR were often lost.
- Classification is captured at rack win and passed into `recordRackWin`.
- Smoke tests cover B&R and TR for **8-Ball**, **9-Ball**, and **10-Ball**, including rack-entry flags.

### Undo — Active Player changes

- Mobile Undo uses the **same** dock undo stack (`undo` → `undoLastScoringAction`).
- Manual **Active Player** switches now push their own undo entry (Snooker + 8/9/10 Active Player mode), so Undo restores the previous player **without** reversing pots/points.
- Fouls still undo as one step (foul points + auto player switch). Breaker picks remain separate from Active Player switches.

### Other

- Cache-busting query strings and `versionNum` bumped to **8.0.0**.

---

## Upgrade notes

- Reload the control panel and browser source after updating.
- New dock completions send split break/run and B&R/TR extras to cloud; older cloud matches can be edited on the dashboard.
- Straight Pool runs previously stored under `highestBreak` are mapped to `highestRun` when read.

---

## Prior releases

See [`docs/release-notes/7.2.2/RELEASE_NOTES.md`](../7.2.2/RELEASE_NOTES.md) and earlier folders for previous changelogs.
