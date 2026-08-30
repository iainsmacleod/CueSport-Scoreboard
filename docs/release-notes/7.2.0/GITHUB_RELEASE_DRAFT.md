## CueSport Scoreboard 7.2.0

Major update from **5.0.2** — player statistics, Snooker scoring, Breaking Player for all game types, Ball Scoring **Undo**, and a redesigned control panel.

### Highlights

- **Player statistics** — IndexedDB roster, live H2H, overlay stats panels, import/export, in-progress match editing
- **Snooker** — frames + points, fouls, Free Ball, Golden Ball, snooker undo stack
- **Breaking Player** — all game types with Ball Scoring; persists across refresh; undo mistaken breaker picks
- **Ball Scoring undo** — pots, rack wins, pocket games, straight pool, breaker selection
- **Setup redesign** — Game Selection / Game Information; Win on Break (8-Ball); Early Game Ball (9/10)
- **Quality** — smoke test suite, refresh fixes for ball grid & breaker state, game-type switch clears undo

### Upgrade notes

- **Ball Scoring** is opt-in in Settings (persists per `instance`).
- **Stats** use IndexedDB (`cuesport_stats`); export before upgrading.
- Match `?instance=` on control panel and browser source for multi-table setups.

### Full release notes

See [`docs/release-notes/7.2.0/RELEASE_NOTES.md`](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/docs/release-notes/7.2.0/RELEASE_NOTES.md) (screenshots in repo release assets or regenerate locally).

### Screenshots

See [`docs/release-notes/7.2.0/RELEASE_NOTES.md`](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/docs/release-notes/7.2.0/RELEASE_NOTES.md) for inline images. Optionally attach the same PNGs as release assets when publishing.
