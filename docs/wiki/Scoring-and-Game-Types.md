# Scoring & Game Types

How scoring behaves in the control panel and overlay. Enable **Ball Scoring** in Settings for the ball grid and breaker / active-player flow (on by default for fresh installs).

## Score layout by game

| Game type | Primary score | Extra ball / point scores | Balls Potted in stats |
|-----------|---------------|---------------------------|------------------------|
| 8-Ball, 9-Ball, 10-Ball | Racks | No | Yes (each Ball Scoring pot) |
| Straight | **Balls** (points) | No | No — tracks **Longest Run** |
| Bank | Racks | Yes (first to **8** wins the rack) | Yes |
| One Pocket | Racks | Yes (first to **8** wins the rack) | Yes |
| Custom | Racks | Only if **Point Based** | Only if **Point Based** |
| Snooker | **Frames** | **Points** (in-frame) | Yes |

## Ball Scoring basics (all games)

1. Turn on **Ball Scoring** in Settings.
2. Each rack/frame starts with **Breaking Player?** — pick the breaker; the grid stays locked until then.
3. The label becomes **Active Player**. Click the greyed opponent to switch visits.
4. Unclicking a scored ball undoes what that pot awarded for the player who received it.
5. **Undo** can reverse pots, fouls, and mistaken breaker picks (game-specific stacks).

**Display Balls** (Settings) mirrors the grid on the OBS overlay. It is hidden for Snooker and requires Ball Scoring.

## 8-Ball / 9-Ball / 10-Ball

- Potting the game ball (**8** / **9** / **10**) awards the Active Player **+1 rack** when legal.
- Every pot increments **Balls Potted** for the Active Player.
- Game ball briefly disables (~0.5s) then clears for the next rack (avoids double-award).
- **Win on Break** (8-Ball, Setup) — optional; when off, an 8 as the first ball of the rack is rejected.
- **Early Game Ball / Win on Break** (9-Ball / 10-Ball) — separate per-game toggles; when off, early game-ball pots do not award the rack.
- Out-of-sequence 8 with object balls still up is a **loss of rack** for the Active Player (opponent scores).
- **Break & Run (B&R)** / **Table Run (TR)** are tracked when Ball Scoring is on (Compusport-style visit rules).

## Straight Pool

- Each pot adds **1** to primary **Balls**.
- When one ball remains, pocketed balls re-enable (14.1 re-rack) with **no** score change and **no** new Breaking Player prompt — Active Player continues the run.
- Consecutive pots by the same player build a run; best is **Longest Run**.
- Match wins are race-to-point wins, not “racks.”

## Bank & One Pocket

- Dual scores: **Racks** (match) and **Balls** (current rack).
- Grid pot fades the ball and +1 to Active Player balls; unfade subtracts from the player who received it.
- First to **8** balls wins the rack, clears ball scores, resets the grid.
- Manual ball **+/-** also awards the rack at 8.
- B&R / TR follow the same visit rules as 8/9/10 when Ball Scoring is on.

## Snooker

- Control-panel grid uses snooker balls (not shown on the overlay).
- Dual scores: **Frames** and **Points**.
- **Best Of** replaces Race Info (e.g. Best Of 35 → first to 18). Overlay shows the Best Of value as entered.
- Red → color sequence; **Foul** modal awards points to the opponent and switches Active Player.
- **Free Ball** only on the incoming visit after a foul.
- Optional **Golden Ball** after a 147 clearance on the final black (20 points; 20-point foul removes it for the frame).
- **Undo** steps back through pots/fouls for the current frame (shared history, up to 40 steps).
- Frame **+** records highest breaks for that frame and clears Points.
- Overlay can show **Current Break**, **Possible Break**, **Difference**, **Points Remaining** when enabled under Stats → Overlay Stats Display.

## Match end controls

| Control | When | Effect |
|---------|------|--------|
| **Restart Match** | Mid-match | Clears scoreline; discards open in-progress stats session |
| **End Match** | Race / Best Of complete | Keeps recorded stats; clears scoreline; re-prompts breaker |
| **Call Match Early** | At least one rack/frame, race incomplete | Saves completed results; awards game to leader (ties save without W/L) |

While the race target is met, primary scoring and Ball Scoring are **locked** until End or Restart.

## Race locking

- Most games: last number in **Race Info** is the race-to target.
- Snooker: **Best Of N** → first to `floor(N/2)+1`.
- Leave Race blank for no automatic lock.
