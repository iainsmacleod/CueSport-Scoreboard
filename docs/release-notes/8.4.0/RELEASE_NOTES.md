# CueSport Scoreboard — Release Notes

**8.3.6 → 8.4.0** · September 2026

Minor release focused on **match lifecycle reliability** under dual control (dock + Cloud): Call Early no longer invents empty history, finished matches return to **Live** when you undo or edit them back open, and match edit picks up per-rack pool extras. Also includes **snooker respotted black**, richer **admin / billing** surfaces, and dock **client version** tracking.

Local OBS scoring continues to work without Cloud. Deploy Cloud web assets (and hard-refresh) together with the dock package so reopen and edit stay in sync.

---

## Headline: Match lifecycle under dual control

Ending, reopening, and editing the same match from dock and dashboard could race — empty Call Early rows, “Finished” stuck after undo, or Live lost after a web date edit.

### Call Early / end race

- Cloud commands run **FIFO** so Call Early finishes before follow-on writes
- Snooker frame recording queues behind Call Early instead of inventing bare racks
- Redundant `end_match` after a real completion is skipped
- Post-completion local writes are guarded so empty 0-stat history rows are not created

### Finished → Live again

- Undoing match completion (or editing a finished session back open) emits **`session:reopen`**: Cloud deletes only the session end and restores the room session
- Keyed discard no longer wipes a completed pair that should stay history
- After a dashboard date/edit PATCH, session pairing keeps the match **Live** when there is no valid end (end times that would precede start are clamped; pairing is two-pass)

### Match edit extras

- **Pool:** per-rack balls pot, Break & Run, and Table Run on dock and dashboard edit; dashboard preserves them on serialize; match ball totals are **derived from racks** (not separately editable)
- **Straight pool:** match-level longest run (and optional fouls) as before
- Dock **Recent Matches** no longer shows Delete — delete remains in the edit modal only

---

## Snooker: respotted black

When a black pot ties the frame, the black is **respotted** until pot or foul decides it (WPBSA-style), with a short re-spot cooldown before the black is clickable again. Dock and ad-hoc Cloud share the same rules.

---

## Admin, billing & docks

- Platform Admin account detail shows **active OBS / ad-hoc** counts and connected dock **client versions**
- Docks report product version on connect for upgrade tracking
- Subscription / billing UI: clearer terms summary, cancellation support, complimentary **access end** management, and simulated-plan admin polish

---

## Docs & versioning

- Product / cache-bust version **8.4.0** (`versionNum`, README, wiki, dashboard & mobile asset queries)
- Release tooling examples point at 8.4.0

---

## Upgrade notes

- Hard-refresh the Cloud dashboard (and mobile if open) so `?v=8.4.0` assets load.
- OBS dock / browser source cache-bust strings are bumped with this release; hard-refresh docks after pull.
- No database migration required for scoring; dock `client_version` is additive on Cloud.
- Ship dock + Cloud together if you rely on reopen / dual-control edit.
