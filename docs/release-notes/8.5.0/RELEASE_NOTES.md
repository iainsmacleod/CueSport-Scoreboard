# CueSport Scoreboard — Release Notes

**8.4.0 → 8.5.0** · October 2026

Minor release focused on **Cloud Dashboard head-to-head visualization** and more reliable **local stats Export** (especially in OBS docks). Also tightens Stats filter Clear when picking a player, and extends smoke coverage for export round-trips.

Local OBS scoring continues to work without Cloud. Deploy Cloud web assets (and hard-refresh) together with the dock package so dashboard charts and dock export UX stay in sync.

---

## Headline: Cloud H2H progress chart

Player detail on the Cloud Dashboard can plot **head-to-head progress** when you select a specific opponent (not “All opponents”).

- Dual line chart: cumulative **matches won** vs **matches played**
- Toggle **Matches** / **Racks / Frames** — rack mode steps **one point per rack/frame winner** (not a jump by final match score)
- Legend uses player names; hover shows played, wins, and optional date / match score / rack number
- Dense series stay readable (no filled point circles; hover target retained)
- Respects player-detail game filter and Stats overview date / event scope
- Straight Pool is excluded from rack/frame mode (scores are points, not racks)

---

## Local stats Export (dock)

Export was easy to miss in practice: the download link was detached and the blob URL was revoked immediately, so many browsers (and OBS) did nothing.

- Browser / non-OBS docks: download attaches to the document and revokes the blob URL after a delay
- **OBS docks:** CEF cannot save files via download — Export opens an in-page panel with the JSON and **Copy JSON** (paste into an editor and save as `.json`)
- Failures surface in-UI (OBS) or via alert (browser); Import / Clear unchanged

---

## Stats UI polish

- Stats toolbar **Clear** enables when a player is chosen from autocomplete, leaderboard, or a match name link (name in the field alone was not enough before)
- Smoke tests cover export → clear → import → re-export parity, download-anchor behavior, and the OBS modal path (stubbed `obsstudio`)

---

## Docs & versioning

- Product / cache-bust version **8.5.0** (`versionNum`, README, wiki, dashboard & mobile asset queries)
- Release tooling examples point at 8.5.0

---

## Upgrade notes

- Hard-refresh the Cloud dashboard (and mobile if open) so `?v=8.5.0` assets load.
- OBS dock / browser source cache-bust strings are bumped with this release; hard-refresh docks after pull.
- No database migration required.
- After upgrade in OBS: use Export → **Copy JSON** if you need a local backup from a dock (file download still works when the same page is opened in a normal browser).
