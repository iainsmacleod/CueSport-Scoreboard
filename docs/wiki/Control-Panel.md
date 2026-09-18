# Control Panel

The control panel (`control_panel.html`) is the OBS Custom Browser Dock. Header shows the version (links to this wiki), dock zoom (− / RESET / +, saved per `instance`), and a support link.

## Tabs (as of 8.2.3)

| Tab | Use it for |
|-----|------------|
| **Setup** | Game variant, race/event text, player names and colors |
| **Controls** | Breaker / active player, ball grid, scores, stats overlay, replay, shot clock |
| **Images** | Player logos and sponsor slideshow |
| **Stats** | Local player statistics modal, import/export/clear, overlay stats visibility |
| **Remote** | CueSport Scoreboard Cloud remote pitch + guest control when Cloud is connected |
| **Settings** | Theme, overlay scale/opacity, feature toggles, Cloud relay, replay, stream promotion |

The dock remembers the **last selected tab** across refresh.

## Setup tab

### Game Selection

- **Game Variant** — 8-Ball, 9-Ball, 10-Ball, Straight, Bank, One Pocket, Custom, Snooker.
- **Ball Variant** — World / International / Unity / Ultimate / Snooker (Snooker game forces Snooker balls).
- Context options appear when relevant:
  - **Win on Break** (8-Ball)
  - **Early Game Ball / Win on Break** (9-Ball / 10-Ball, separate settings)
  - **Golden Ball** (Snooker)
  - **Point Based** (Custom)

Changing game variant finalizes any open match under the previous type, clears the scoreline, and clears scoring Undo history.

### Event Information

- **Race Info** — short race-to value (last number in the field is the target). Leave blank for no race lock.
- Snooker uses **Best Of** instead (e.g. 35 → first to 18).
- **Event Info** — free text (max 60 characters).
- **Update Info** pushes race/event text to the overlay.

### Players

- **Name** (max 20 characters) with autocomplete from your stats roster; **double-click** for the full list.
- **Color** for each scoreboard bar.
- **Swap Colors** / **Clear Game** — Clear Game wipes names, race/event, and the scoreline, abandons the in-progress stats session, and returns to Setup. It does **not** delete completed history.

## Controls tab

### Player Tracking and Ball Scoring

Shown when **Ball Scoring** is enabled in Settings:

1. **Breaking Player?** — pick who breaks; the ball grid stays locked until then.
2. Label becomes **Active Player** — current player is full strength; click the greyed button to switch visits.
3. Use the ball grid, **Foul**, and **Undo** as your game type allows.
4. After rack/frame win, End/Call/Restart Match, the breaker prompt returns (Straight Pool keeps the active player after a 14.1 re-rack).

### Manual Adjustments

- Rack/frame (and dual-score ball/point) **+ / −**.
- Type a value and **Push Entered Scores** when needed.
- **Restart Match** / **End Match** / **Call Match Early** — all confirm. Race complete locks primary scoring until End or Restart.

### Stats Overlay

**P1 Stats** / **P2 Stats** / **H2H Stats** — one mode at a time; click again to hide. Requires **Ball Scoring** (and Show Scores / both players on).

### Replay & clock

See [Instant Replay](Instant-Replay) and [Shot Clock & Hotkeys](Shot-Clock-and-Hotkeys).

## Images tab

- Upload **Player 1 / Player 2** logos; toggle visibility; click the label to rename.
- Upload **L1 / L2 / L3** and enable **Custom/Sponsor Slideshow** (~20s cycle).
- Prefer square player logos; keep files practical (~2.4 MB max due to browser storage). PNG, JPEG, SVG, BMP.

## Stats tab

- **Player Stats** — local leaderboard / player / H2H modal. See [Player Statistics](Player-Statistics).
- **Import / Export / Clear** — JSON backup or wipe of `cuesport_stats`.
- **Overlay Stats Display** — choose which rows appear on P1/P2/H2H overlay panels per game type.

When CueSport Scoreboard Cloud is connected, dock import/export/clear for stats are disabled — manage cloud history on the dashboard.

## Remote tab

- Disconnected: explains hosted vs self-hosted Cloud and opens connection settings.
- Connected: **Guest control** — default OBS Dock Owner link plus named guest links (QR/URL hidden until **Show**).

Details: [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests).

## Settings tab

### UI

- **OBS Theme** — Modern Cloud (default), Default, Classic, Acri, Grey, Light, Rachni.
- **Overlay Scaling** (40–100%) and **Overlay Opacity**.

### Feature Settings

Player 1 / Player 2, Show Scores, Active Player Indicator, Shot Clock, Win Animation, Ball Scoring, Display Balls, Ball Set Toggle, Vertical/Horizontal ball display.

Notes:

- **Show Scores** off hides counters on the overlay and disables Manual Adjustments + Ball Scoring in the dock.
- **Ball Scoring** persists per `instance`; it is not auto-enabled when switching game types.
- With Ball Scoring on, Active Player Indicator is forced on and locked.
- **Display Balls** mirrors the grid on the overlay (not for Snooker).

### CueSport Scoreboard Cloud

Toggle + ⚙ connection settings (hosted Google or self-host URL + Dock Key). Status line shows Off / connecting / connected.

### Enable Replay Function & Promote Live Stream

WebSocket toggle + source names; Promote Live Stream toggle. See [Instant Replay](Instant-Replay) and [Stream Promotion](Stream-Promotion).

### Maintenance

- **Check for Update** — compares to the latest GitHub release.
- **Clear Instance Settings** / **Clear All Instance Settings** — scoreboard settings only; does not wipe player statistics.
