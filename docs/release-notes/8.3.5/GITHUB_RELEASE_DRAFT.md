## CueSport Scoreboard 8.3.5

**8.3.0 → 8.3.5** — Local **stats parity** (draws, career B&R/TR), a clearer dock **Stats** modal (**Recent Matches** + **Leaderboard**), **match filters on dock and dashboard**, **complimentary access expiry**, and scoring/UI polish (illegal 8-ball foul attribution, upload tooltips, mobile post-sign-in shell, Cloud connection copy).

### Highlights

- **Draws & career fields** — local `gamesDrawn`, win % / streaks that respect draws, H2H Matches Drawn; Break & Run / Table Run kept with Cloud
- **Empty pregame** — ending a never-played 0–0 session no longer records a draw
- **Stats modal** — Recent Matches + Leaderboard; player click → detail (H2H via player); green winners; Back navigation
- **Match filters** — player/event autocomplete and date range on dock Stats and Cloud Match Stats; leaderboard rebuilds from the filtered set
- **Complimentary expiry** — Dock Keys revoked and **ad-hoc tables closed** when complimentary access ends without an active subscription; in-progress cloud matches on those seats are discarded (history kept)
- **Lose-on-8 foul** — foul credited to the shooter (dock + ad-hoc Cloud)
- **UI polish** — L2/L3 upload tips no longer clip; shorter Cloud connection intro; non-tiled modern backgrounds; mobile bottom nav settles after sign-in

Local OBS docks continue to work as before. See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full detail.
