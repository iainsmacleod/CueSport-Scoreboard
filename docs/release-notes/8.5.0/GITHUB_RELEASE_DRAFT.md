## CueSport Scoreboard 8.5.0

**8.4.0 → 8.5.0** — **Cloud H2H progress chart** on player detail, reliable **local stats Export** (browser download + OBS copy panel), and Stats **Clear** when picking a player.

### Highlights

- **H2H chart** — matches won vs matches played; **Matches / Racks·Frames** toggle with per-rack stepping; legend + tooltips
- **Export fix** — download link attached + deferred blob revoke (no more silent no-op in browsers)
- **OBS Export** — copy-JSON modal when CEF blocks file downloads
- **Stats Clear** — enables after autocomplete / leaderboard / match-link player pick
- **Smoke** — export → clear → import → re-export; OBS modal path stubbed

Local OBS docks continue to work as before. See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full detail.
