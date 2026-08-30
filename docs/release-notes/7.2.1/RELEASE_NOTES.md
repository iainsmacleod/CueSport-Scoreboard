# CueSport Scoreboard — Release Notes

**7.2.0 → 7.2.1** · August 2026

Patch release: Snooker scoring fixes, stats/match-history improvements, and overlay polish.

---

## Bug fixes

### Snooker

- **Color phase** — After potting a color following the 15th red, the correct ball (yellow for clearance) is re-enabled once the brief click feedback finishes; balls no longer stay stuck disabled.
- **Free Ball points** — Free ball now scores the value of the **lowest ball still on the table** (1 during reds; yellow/green/etc. in clearance). Tooltip updates to match.
- **Stats edit / frame count** — Adding completed frames via **Stats → in-progress match edit** now resets the live snooker tracker (reds, colors, frame points), same as awarding a frame on the scoreboard. Fixes corrupted state where reds could carry over between frames.

### Player statistics & match history

- **Game Information** — Setup **Game / other info** text is saved on each match, shown in Stats match history (under game type), and editable in the match edit modal. Syncs when you change the Setup field during a match.

### Browser overlay stats

- **P1 / P2 overlays** — Removed **Matches Won** and **Racks / Frames W/L** from single-player overlay panels; these remain on the **H2H** overlay only (visibility toggles labeled “H2H”).

### Other (7.2.0 follow-ups)

- Refresh restores ball grid and breaker state without spurious **Breaking Player?** prompt.
- Game-type switch clears scoring undo history.
- Breaking Player enabled for all game types when Ball Scoring is on.

---

## Upgrade notes

- No database migration required. Reload the control panel and browser source after updating (cache-busting query strings bumped).
- Existing matches without `gameInfo` show game type only; new matches capture Setup text automatically.

---

See [`docs/release-notes/7.2.0/RELEASE_NOTES.md`](../7.2.0/RELEASE_NOTES.md) for the full 7.2.0 feature overview and screenshots.
