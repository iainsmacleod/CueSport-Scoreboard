# Player Statistics

Local match history and player roster stored in the browser. Completely separate from CueSport Scoreboard Cloud history (when Cloud is connected, manage cloud stats on the dashboard instead).

## Where it lives

| Item | Detail |
|------|--------|
| Storage | Browser **IndexedDB** database `cuesport_stats` |
| Scope | Shared across all `?instance=` docks on the same origin |
| Survives | **Clear Instance Settings**, **Clear All Instance Settings**, **Clear Game** |
| Cleared by | Stats tab → **Clear**, or clearing site data for that origin |

## Choosing players

1. On **Setup**, type in **Player/Team 1** or **Player/Team 2**.
2. Autocomplete filters your roster; pick a match or keep typing to create a new player.
3. **Double-click** a name field to browse the full roster in a scrollable list.
4. Selecting a name (or tabbing out after typing) updates the overlay and starts/updates the stats session.

Use **distinct** names on both sides. The same name on both sides disables recording for that pairing.

## Recording during play

1. Enter both player names.
2. Score with Manual Adjustments and/or **Ball Scoring**. Rack/frame **+** records results and checks race completion.
3. Completing a race (or using **End Match** / **Call Match Early**) marks the match completed and updates games won/lost.
4. **Restart Match** mid-match discards the open in-progress stats session.
5. Refreshing the dock restores the pending session for that `instance` (Balls Potted, Highest Break, Longest Run stay intact).

In-progress matches appear as **In progress** in Player / H2H history and can be **edited** or **discarded**.

## Stats modal (Stats → Player Stats)

| Tab | Use |
|-----|-----|
| **Board** | Leaderboard: Matches Won, Win%, Racks/Frames W/L, Last played. Click a row for detail. |
| **Player** | Per-player breakdown, win streak, opponent H2H, match history, rename/delete, add match. |
| **H2H** | Pick two players for head-to-head summary and history. |

**Import / Export / Clear** sit on the Stats tab next to **Player Stats** (not inside the modal).

- **Export** — download JSON backup.
- **Import** — **replaces** all current players and matches (confirm; export first if you care about existing data).
- **Clear** — permanently deletes all local stats (double confirmation) and resets the current game.

When CueSport Scoreboard Cloud is connected, dock Import / Export / Clear are disabled — use the Cloud dashboard **Stats** tab.

## Overlay stats

On **Controls**:

- **P1 Stats** / **P2 Stats** / **H2H Stats** — one mode at a time; click again to hide.
- Requires **Ball Scoring** (and Show Scores / both players on).

On **Stats → Overlay Stats Display**:

1. Pick a **game type** (defaults to the game in play; changing it does not change scoring).
2. Toggle which rows appear on the overlay panels for that type (Matches Won, Racks/Frames W/L, Win Streak, Break & Run, Table Run, Highest Break, Longest Run, Balls Potted, Snooker live fields, etc.).
3. Unchecked stats are hidden on overlay but still recorded in history.

Highest Break / Longest Run and Balls Potted on P1/P2 overlays are **match-scoped** for the current pending match.

## Manual matches

From Player or H2H → **Add Match**:

- Enter date, game type, and per-rack/frame results.
- Match score and Matches Won are calculated from those frames/racks.
- Snooker frames can include points and highest breaks.
- The same editor works for the live **In progress** match (**Edit** / **Discard**).

## Related

- [Scoring & Game Types](Scoring-and-Game-Types) — what each game records
- [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests) — cloud match history
- [Troubleshooting](Troubleshooting) — stats not recording
