# CueSport Scoreboard

<div align="center">

**A professional scoreboard overlay for OBS Studio, built for cue sports**

Made for cue sport fans by a cue sport fan, based on [g4ScoreBoard](https://github.com/ngholson/g4ScoreBoard/)

Display player names, race and game info, racks (and balls where needed), logos, sponsors, a shot clock, instant replay, and optional live stream listing.

*Best viewed as a **1920×1080** browser source*

**Current version: 7.2.0**

</div>

---

## Table of Contents

- [Acknowledgement](#acknowledgement)
- [How It Works](#how-it-works)
- [Installation](#installation)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Multiple instances](#multiple-instances)
- [Control Panel Overview](#control-panel-overview)
  - [Setup](#setup)
  - [Stats](#stats)
  - [Controls](#controls)
  - [Images](#images)
  - [Replay/Share](#replayshare)
  - [Settings](#settings)
- [OBS WebSocket Setup](#obs-websocket-setup)
- [Instant Replay](#instant-replay)
- [Stream Promotion](#stream-promotion)
- [Player Statistics](#player-statistics)
- [Game Types & Scoring Modes](#game-types--scoring-modes)
- [Shot Clock](#shot-clock)
- [Hotkeys](#hotkeys)
- [Logos & Slideshow](#logos--slideshow)
- [Data, Clearing & Privacy](#data-clearing--privacy)
- [Smoke Tests](#smoke-tests)
- [Support](#support)

---

## Acknowledgement

**CueSport ScoreBoard** is a modified version of **G4ScoreBoard** by Norman Gholson IV.

**CueSport ScoreBoard addon for OBS** Copyright 2025 Iain MacLeod

**Based on G4ScoreBoard:**
- G4ScoreBoard addon for OBS Copyright 2022–2023 Norman Gholson IV
- https://g4billiards.com | http://www.g4creations.com

This fork focuses on a clearer control panel, stronger OBS integration (WebSocket replay and stream listing), and local player statistics. The original Salotto logo is not bundled; you can upload any logo you like. CueSport uses five custom logo slots: two for players and three for a sponsor slideshow.

---

## How It Works

CueSport Scoreboard is two HTML pages that talk to each other (and optionally to OBS):

| Piece | File | Role |
|--------|------|------|
| **Control panel** | `control_panel.html` | Custom Browser Dock — scores, names, clock, replay, settings, stats |
| **Overlay** | `browser_source.html` | Browser Source on your scene — what viewers see (1920×1080) |

**Flow in short:**

1. You change something in the dock (name, score, clock, etc.).
2. The dock saves state in the browser’s **localStorage** and sends a message over a **BroadcastChannel**.
3. The overlay reads those messages (and localStorage on load) and updates the on-stream graphics.
4. For **instant replay** and **stream promotion**, the dock also connects to **OBS WebSocket**.
5. **Player statistics** are stored separately in **IndexedDB** (`cuesport_stats`) so match history survives clearing scoreboard settings.

You do not need a public server for the scoreboard itself. Local files or a tiny local HTTP server are enough. Stream promotion is optional and only sends match metadata (not video or audio) when you enable it.

---

## Installation

Extract the release ZIP somewhere permanent, then add both pages to OBS.

### Windows

1. **Custom Browser Dock** (control panel): **Docks → Custom Browser Docks**
   - Dock name: e.g. `CueSport-Scoreboard`
   - URL (OBS 27.2+ file URI):
     `file:///C:/Users/YourName/Desktop/CueSport-Scoreboard/control_panel.html`
   - Older OBS may accept a plain Windows path to `control_panel.html`

2. **Browser Source** (overlay) on your stream scene:
   - URL: `file:///C:/Users/YourName/Desktop/CueSport-Scoreboard/browser_source.html`
   - **Width 1920**, **Height 1080**
   - Leave **Control audio via OBS** unchecked unless you want overlay sounds in the mix

### macOS

OBS often rewrites local paths. Prefer a local server:

```bash
cd /path/to/CueSport-Scoreboard
python3 -m http.server 8000
```

- Dock: `http://localhost:8000/control_panel.html`
- Browser Source: `http://localhost:8000/browser_source.html` (1920×1080)

Keep the Terminal window open while streaming.

### Linux

Same as Windows with a `file:///` URI, or use `python3 -m http.server 8000` like macOS if `file://` is awkward.

### Multiple instances

If you run more than one scoreboard (e.g. two tables), append the same query string to **both** the dock and the overlay:

```text
control_panel.html?instance=table2
browser_source.html?instance=table2
```

Both pages must share the same `instance` value so they share the correct BroadcastChannel and localStorage prefix.

Per `instance`: live scores, settings, overlay stats mode/payload, stats visibility toggles, and in-progress match sessions. **Shared across all instances:** the player roster and match history in IndexedDB (`cuesport_stats`), and OBS replay clip history (one stream buffer).

---

## Control Panel Overview

Header: version (links to the wiki), dock zoom (− / RESET / +, **saved per `instance`** on refresh), and a support link.

Tabs: **Setup**, **Controls**, **Images**, **Replay/Share**, **Stats**, **Settings**. The dock remembers your **last selected tab** across refresh (including **Stats**).

### Setup

- **Game Selection** — **Game Variant** (8-Ball through Snooker and Custom) and **Ball Variant** (World / International / Unity / Snooker). Changing variant automatically finalizes the open match under the previous type (**End Match** if the race/Best Of is complete, **Call Match Early** if racks/frames exist mid-race, otherwise **Reset Score**), then applies the new variant with a cleared scoreline. **Golden Ball** (Snooker only) and **Point Based** (Custom only) appear on that row when applicable. Snooker game variant forces Snooker balls.
- **Game Information** — **Race Info** (short numeric race-to; the last number in the field is used as the race target; leave blank for no race lock) or **Best Of** for Snooker, plus **Game/Other Info** free text (max 60 characters). **Update Info** pushes race/game text to the overlay.
- **Player/Team 1 Details** / **Player/Team 2 Details** — each section has **Name** (max 20 characters; autocomplete from your stats roster, or **double-click** to open the full scrollable player list) and **Color** for the scoreboard bar.
- **Swap Colors** / **Clear Game** — **Clear Game** wipes player names, race/game info, and the on-screen scoreline, abandons any in-progress stats match (undoing recorded racks/frames/balls for that session), and resets the stats session. It does **not** delete players or completed match history from the database.

### Stats

- **Edit Player Stats** — opens the Player Statistics modal (leaderboard, player detail, H2H, import/export). See [Player Statistics](#player-statistics).
- **Overlay Stats Display** — pick a **game type**, then toggle which stats appear on the **P1 / P2 / H2H** overlay panels for that type (Matches Won, Racks/Frames W/L, Win Streak, Break & Run, etc.). Defaults to the current game in play; changing this selector does **not** change the active game type. Settings persist across refresh.

### Controls

- **Player Tracking and Ball Scoring** — shown only when **Ball Scoring** is enabled in Settings. Includes **Breaking Player?** / **Active Player** buttons and the ball grid (centered in one row).
  - **Breaking Player?** / **Active Player** — one row of two equal-width player buttons (names from Setup). On **8 / 9 / 10** and **Snooker**, each rack or frame starts with **Breaking Player?**; pick the breaker. The label then becomes **Active Player**: the current player’s button stays full strength; the other is greyed out but **click to switch**. The ball grid stays disabled until a breaker is chosen. After **End Match**, **Call Match Early**, or **Reset Score**, the breaker prompt returns. When the race target is met, clicking a breaking-player button opens **End Match** to clear the scoreline.
  - **Display Balls** mirrors the grid on the OBS overlay (not available for Snooker; requires Ball Scoring).
- **Manual Controls** — optional **Player 1 Chosen Ball** (when **Ball Set Toggle** is on and **Ball Scoring** is off), then rack/frame (and dual-score ball/point) increment/decrement fields, plus **Push Entered Scores** after typing in a score field. Primary score is labeled **Racks** for most games, or **Balls** in Straight Pool.
- **Balls** (Bank, One Pocket, or Custom with Point Based) — secondary ball counters (−999 to 999). Fouls can go below zero; that display foul does not undo recorded ball stats.
- **Reset Score** — danger control that clears primary (and dual-score ball) scores after confirmation. When the race / Best Of target is met, the button becomes **End Match** (still danger, still confirmed) and ends the match without undoing recorded stats. While the race / Best Of target is met, primary scoring and **Ball Scoring** are **locked** until **End Match** or **Reset Score** clears the scoreline.
- **Call Match Early** — danger control (confirm) that appears after at least one rack/frame is recorded while the race is still incomplete. The confirmation explains that this ends the **entire match** (not just the current frame/rack) and that scores clear after saving. Ends the match early, waits for pending rack writes, reconciles rack history to the live scoreboard, saves completed racks/frames to match history, awards the game to the player ahead (tied scores save without a game W/L), then clears the scoreline.
- **Stats Overlay** — **P1 Stats**, **P2 Stats**, **H2H Stats**. Toggle the same button again to hide. Off by default.
- **Replay Controls** — appear for use once OBS WebSocket is connected (see [Instant Replay](#instant-replay)).
- **Shot Clock** and **Extensions** — see [Shot Clock](#shot-clock).

### Images

- **Custom/Sponsor Slideshow** — enable cycling of L1 / L2 / L3 (about every 20 seconds).
- **Player 1 / Player 2 logos** — upload, toggle visibility, click the label to rename.
- Max practical size ~2.4 MB (browser storage limits). Prefer square player logos. PNG, JPEG, SVG, BMP.

### Replay/Share

- OBS WebSocket toggle + **⚙** settings.
- Stream Promotion toggle + **⚙** (stream URL).
- Replay source names and **Auto-resume Monitoring**.

Details: [OBS WebSocket Setup](#obs-websocket-setup), [Instant Replay](#instant-replay), [Stream Promotion](#stream-promotion).

### Settings

- **OBS Theme** for the dock: Default, Classic (default), Acri, Grey, Light, Rachni.
- **Overlay Scaling** (40–100%), **Overlay Opacity**.
- Feature toggles: Player 1 / Player 2, **Show Scores** (when off, rack/frame and ball counters are hidden on the overlay and **Manual Controls** and **Ball Scoring** are disabled in the dock), Shot Clock, **Active Player Indicator** (may be turned on automatically when switching to scoring-oriented game types — see below), Win Animation.
- **Ball Scoring** (opt-in; **persists** across refresh and game-type changes — not auto-enabled), **Display Balls** (overlay; hidden for Snooker; requires Ball Scoring), Vertical/Horizontal orientation, **Ball Set Toggle**. While Ball Scoring is on, Active Player Indicator is forced on and locked.
- **Check for Update** (compares to the latest GitHub release).
- **Clear Instance Data** / **Clear All Data** — clears scoreboard settings only; does not affect player statistics (use Stats → Clear All Stats for that). See [Data, Clearing & Privacy](#data-clearing--privacy).

---

## OBS WebSocket Setup

WebSocket is required for **instant replay** and for **stream promotion** (so the dock can tell whether OBS is streaming).

### Enable the server in OBS

1. Open **Tools → WebSocket Server Settings** (OBS 28+; older builds may say Websocket).
2. Enable the WebSocket server.
3. Note the **port** (default **4455**) and set a **password** if you want one.
4. Apply / OK.

### Connect from CueSport

1. Open the **Replay/Share** tab.
2. Click the WebSocket **⚙** button.
3. **OBS WebSocket Address** (required), default: `ws://127.0.0.1:4455`  
   Use your machine’s LAN IP instead of `127.0.0.1` only if the dock runs somewhere else.
4. Enter the **Password** if OBS requires one.
5. Save, then turn the WebSocket **toggle** on.

The toggle should show connected. If it fails, confirm OBS is running, the server is enabled, and the address/password match. The dock can auto-reconnect on load if WebSocket was left enabled previously.

Disconnecting WebSocket also drops stream promotion until you reconnect.

---

## Instant Replay

Instant replay uses OBS’s **Replay Buffer**, driven over WebSocket. CueSport does not record video itself; it asks OBS to save the buffer and plays that file in a Media Source.

### OBS prerequisites

1. **Settings → Output → Replay Buffer**
   - Enable Replay Buffer.
   - Set **Maximum Replay Time** (often 30–60 seconds). That length is what Instant Replay captures.
2. Create a **Media Source** on your program scene (or a scene you switch to for replays). Leave the file empty; CueSport sets `local_file` when a clip is saved.
3. Optional: an **indicator** source (text/image/overlay) that should appear only while a replay is playing.

> Note: Some older docs referred to Replay Buffer under Video settings. In current OBS it lives under **Output → Replay Buffer**.

### CueSport source settings

In **Replay/Share**:

| Field | Required | Purpose |
|--------|----------|---------|
| **Media Source Name** | Yes | Exact OBS name of the Media Source that plays clips |
| **Indicator Source Name** | No | Exact OBS name of a source shown during replay |
| **Auto-resume Monitoring** | No (default off) | After a clip finishes, wait briefly and start the replay buffer again |

Click **Update Sources** after editing names. Names must match OBS **exactly** (including spaces).

### Using replay during a match

1. Connect WebSocket (above).
2. Click **Monitor Game** to start (or resume) the OBS Replay Buffer.  
   While active the button becomes **Stop Monitoring**; after a stop it may show **Resume Monitoring**.
3. When something worth replaying happens, click **Instant Replay**:
   - OBS saves the buffer (last *Maximum Replay Time* seconds).
   - Monitoring stops.
   - The saved file is loaded into your Media Source and played; the indicator (if set) is shown.
4. Up to **five** clip paths are kept as **Clip 1–5**. Click a clip button to play it again.
5. **×** on a clip removes it from the list only — it does **not** delete the video file on disk (**Delete clip** clears the saved path/reference only; manual cleanup of replay files is required).

**Requirements checklist:** WebSocket connected · Replay Buffer enabled in OBS · Media Source name saved · Monitoring active before Instant Replay.

---

## Stream Promotion

Optional listing on **[https://cuesports.macleod.systems](https://cuesports.macleod.systems)** so others can find streams that are currently on air with live match info.

### Setup

1. Connect **OBS WebSocket** (promotion uses it to detect streaming).
2. In **Replay/Share**, open Stream Promotion **⚙** and set your **Stream URL** (must be `http://` or `https://`, e.g. `https://www.twitch.tv/yourchannel`). You can also let OBS-related auto-detection fill a URL when possible.
3. Enable the **Stream Promotion** toggle.
4. **Start streaming in OBS.** Promotion only stays connected while OBS reports an active stream.

### What is shared

Match metadata only, for example: player names, scores, ball scores (when used), game type, race/game info, whether players/scores/Ball Scoring/clock are enabled, ball style, and your stream URL. **No video or audio** is uploaded.

Each install gets a local API key. You can turn promotion off anytime. If a key is blocked server-side, the dock disables sharing and alerts you.

---

## Player Statistics

Local history for a shared roster of players (not tied to a single OBS `instance`).

### Where it lives

- Browser **IndexedDB** database: `cuesport_stats`
- Survives **Clear Instance Data** and **Clear All Data**
- Cleared only via Stats → **Data** → **Clear All Stats** (or by clearing site data for that origin)

### Choosing players (name fields)

- Start typing in **Player/Team 1** or **Player/Team 2** to filter the roster and pick a match (or create a new player).
- **Double-click** either name field to browse the full saved roster in a scrollable list, then click a name to select it.
- Selecting a name (or tabbing out of the field after typing) updates the overlay and stats session automatically.

### Recording during play

1. Enter distinct player names on both sides (same name on both sides disables recording for that pairing).
2. Score **+** records a rack (or Straight Pool primary point) and checks race completion.
3. In dual-score games, ball **+** records balls potted; ball **−** from a positive value undoes the last pot. Going from `0` to `-1` is a foul display and does not change stats.
4. Completing a race marks the match completed and updates games won/lost.
5. Use **Reset Score** (danger) to clear the on-screen scoreline mid-match — an in-page confirmation modal appears (native browser `confirm()` is unreliable in OBS docks). When the race / Best Of target is met, the button becomes **End Match** and the same modal confirms closing the match while keeping recorded stats. **Call Match Early** (danger, confirms) appears once racks/frames exist and the race is not finished — use it to end early and keep those results in **match history**.
6. **In-progress matches** are kept in a per-instance pending session (IndexedDB meta). Finished racks/frames update **H2H** and overlay totals **as they happen** (match wins still wait until the match is completed). Refreshing the control panel restores the pending session for that `instance` so **Balls Potted** and match-scoped **Highest Break** / **Longest Run** do not reset.
7. In the Stats window **H2H** / **Player** match history, the live match appears as **In progress** and can be **edited** (racks/frames/balls/breaks) or **discarded** (undoes that match’s rack/ball career deltas and recomputes both players from completed matches only).

### Stats modal (Stats tab → Edit Player Stats)

| Tab | Use |
|-----|-----|
| **Board** | Leaderboard: Name, Matches Won, Win%, Racks/Frames W/L (with win %), Last played. Click a row for detail. |
| **Player** | Per-player breakdown (Matches Won with win %, Racks/Frames W/L with win %, Balls Potted when dual-score games apply), win streak, opponent H2H, match history (includes the **in-progress** match when these players are live; completed matches list every rack/frame; Snooker frames include frame points and highest breaks), rename/delete, add match. |
| **H2H** | Pick two players for head-to-head summary and history (live racks/frames from the current match are included before the match is completed). |
| **Data** | **Export JSON** backup; **Import JSON** replaces all current statistics (warning + confirmation); **Clear All Stats** permanently deletes the roster (double confirmation). |

### Overlay stats (Controls tab + Stats tab)

- **P1 Stats** / **P2 Stats** / **H2H Stats** (Controls tab) — one mode at a time; click again to hide. Off by default. Overlay figures are **scoped to the current game type** (e.g. Snooker H2H ignores 8-Ball history).
- **Overlay Stats Display** (Stats tab) — pick a **game type**, then choose which rows appear on those overlay panels. Available toggles include **Matches Won**, **Racks / Frames W/L**, **Win Streak**, **Current Break / Run**, **Possible Break**, **Difference**, **Points Remaining**, **Highest Break / Longest Run**, **Balls Potted**, **Break & Run**, and **Table Run** (only options that apply to the selected game type are shown). Defaults to the game type in play; changing this selector does not change scoring. Unchecked stats are **hidden on the overlay** but still recorded in match history. Toggles persist across refresh.
- Individual panels: **Matches Won** (with win %), **Rack W/L** / **Frame W/L** (with win %), optional **Highest Break** (Snooker) or **Longest Run** (Straight Pool), optional **Balls Potted** (Bank, One Pocket, Custom point-based, Snooker), **Break & Run** / **Table Run** (8 / 9 / 10), **Win Streak**, and live Snooker fields (**Current Break**, **Possible Break**, **Difference**, **Points Remaining**) when enabled.
- **Highest Break** / **Longest Run** and **Balls Potted** on P1/P2 overlays are **match-scoped** for the current pending match (not career totals). They survive a control-panel refresh via the pending session.
- H2H: comparison table with player names in the header, stat labels centered in the middle (**Matches Won**, **Racks/Frames Won**, etc.), and each player's value centered under their name. Optional **Highest Break** / **Longest Run** and **Balls Potted** rows when relevant for the active game type. Live unfinished racks/frames count toward H2H rack/frame totals; **Matches Won** still requires a completed match.
- **Balls Potted** appears only in dual-score game types (see below). It is a **count**, not a win/loss record.

### Manual matches

From Player or H2H you can **Add Match** (date, game type, and per-rack/frame results). Match score and Matches Won are **calculated from those frames/racks** — they are not edited directly. Snooker frames can include points and highest breaks. Optional balls-potted fields appear for Bank, One Pocket, Custom, and Snooker. The same editor opens for the **in-progress** live match (**Edit In-Progress Match** / **Discard Match**).

---

## Game Types & Scoring Modes

| Game type | Primary score | Extra ball scores | Balls Potted in stats/overlay |
|-----------|---------------|-------------------|-------------------------------|
| 8-Ball, 9-Ball, 10-Ball | Racks (Ball Scoring: pot game ball) | No | No |
| Straight | Labeled **Balls** (Ball Scoring pots +1 each) | No | No (tracks **Longest Run** instead) |
| Bank | Racks | Yes (first to **8** wins the rack) | Yes |
| One Pocket | Racks | Yes (first to **8** wins the rack) | Yes |
| Custom | Racks | Only if **Point Based** is checked | Only if **Point Based** is checked |
| Snooker | Labeled **Frames** | **Points** (in-frame; via ball scoring and +/-) | Yes (each pot) |

Consecutive Straight Pool score **+** by the same player builds a run; the best run is stored as **Longest Run** (shown on the overlay when Straight is selected). Each scored ball also stores that player’s current run on the rack entry (and **0** for the opponent) so match history can show and edit **Run** per player. Scoring for the other player or a decrement rebuilds the current run from the trailing streak.

### Ball Scoring (Player Tracking and Ball Scoring)

Enable **Ball Scoring** in Settings when you want the control-panel ball grid and breaking/active-player controls. The setting is **not** turned on automatically when you pick a game type; it is saved per `instance` and survives refresh. Switching to **8-Ball**, **9-Ball**, **10-Ball**, **Straight**, **Bank**, **One Pocket**, or **Snooker** may still turn on **Active Player Indicator** when both players are enabled (Ball Scoring stays as you left it). Unclicking a scored ball (unfade) **deducts** what that pot awarded from the player who received it (mistake correction).

- **8-Ball / 9-Ball / 10-Ball** — Potting the **8**, **9**, or **10** (respectively) awards the Active Player **+1 rack**. Other balls are visual only. The game ball is briefly disabled (~0.5s), then clears so it can be potted again for the next rack (prevents a double-click from awarding twice). Undo a mistaken rack with Racks **−**.
- **8 / 9 / 10 — Breaking player** — Each rack starts with **Breaking Player?** when Ball Scoring is on. The grid is disabled until you pick the breaker. The label then becomes **Active Player** (breaker selected); click the greyed opponent button to switch visits (**Table Run** stats count a switch as an opponent visit). The breaker prompt returns after **End Match**, **Call Match Early**, or **Reset Score**. When the race target is met, clicking a breaking-player button opens **End Match**. Career stats track **Break & Run (B&R)** when the breaker runs out without the opponent visiting, and **Table Run (TR)** when the opponent has visited and the winner clears the rack.
- **Snooker — Breaking player** — Each frame starts with **Breaking Player?** the same way when Ball Scoring is on. After you pick the breaker, the label becomes **Active Player** for visit switching. The prompt returns after each frame is awarded, **End Match**, **Call Match Early**, or **Reset Score**. When the Best Of target is met, clicking a breaking-player button opens **End Match**.
- **Straight** — Each pot adds **1** to primary **Balls** for the Active Player (balls are not reset between pots). Unclick subtracts **1**. When only **one** ball remains unfaded, the pocketed balls are re-enabled (14.1 re-rack) with **no** score change. Continue until the race target locks scoring.
- **Bank / One Pocket** — See below.

### Bank & One Pocket

- Dual scores: **Racks** (match) and **Balls** (current rack).
- Switching to Bank or One Pocket may turn on **Active Player Indicator** when both players are enabled; enable **Ball Scoring** yourself for the ball grid.
- Clicking a ball on the grid fades it (overlay) and adds **1** to the **Active Player** ball score. Clicking again unfades and subtracts **1** from the player who originally received that ball (even if Active Player has changed).
- First player to **8** balls automatically wins the rack (Racks **+1**), clears both ball scores, and resets the balls for the next rack.
- Manual ball **+/-** also awards the rack when a player reaches 8.

### Snooker

- Selecting **Snooker** forces snooker ball imagery on the **control panel** Ball Scoring grid (not shown on the OBS overlay). Ball Scoring assets include shared icons such as `foul-small.png` and `undo-small.png` (usable by other game types later).
- **Custom** is the only other game type that can choose **Snooker** as Ball Type.
- Dual scores: **Frames** (match score) and **Points** (current frame). Ball Scoring pots/fouls change **Points**.
- **Best Of** (replaces Race Info for Snooker): enter the maximum frames in the match (e.g. **35**). Locking / match win is first to **floor(N/2)+1** (so best of 35 → first to **18**). The overlay shows the entered value as-is (not rewritten as “Best of N”).
- Click color balls / Free Ball to add points to the **Active Player** (player buttons under **Active Player**). **Golden Ball** is an optional rule (checkbox off by default). When enabled, the Golden Ball only becomes pottable after the **final black** of a clearance when the Active Player has **147** points (worth 20). If the Golden Ball is **fouled**, it is a **20-point** foul to the opponent and the ball is **removed from the frame** (hidden on the grid and unavailable as a foul target) until the next frame.
- Scoring follows red → color → red → color: after a red (or Free Ball), red is disabled until a color is potted or the visit ends. After a color, colors briefly show feedback, then red is available again (until 15 reds are potted).
- Once **15 reds** are scored, red stays disabled and remaining colors are cleared one by one (each potted color stays disabled for the frame).
- Click **Foul** to open a modal, then choose the fouled ball (White–Black; Golden while the Golden Ball is still in play; Free Ball is not a foul target). Hover shows **X-point foul**. Foul points go to the **opponent**. A foul **ends the break** and **automatically switches Active Player** to the incoming player.
- **Free Ball** is offered only on that incoming visit after a foul (not during a normal reds/clearance turn). It is worth **1** and plays like a red; while reds remain, a color is then required. Potting a normal red instead clears the Free Ball offer.
- Continuous points in a visit are tracked as a **break**. **Highest break** per player is stored for each frame and as a career/Snooker high. Manual Active Player switches (clicking the inactive player button) also end the break (without awarding foul points).
- **Undo** (grid icon beside Free Ball / Foul, `undo-small.png`) steps back through pots and fouls for the current frame:
  - Restores points, sequence phase, Free Ball / foul-offer flags, reds & clearance state, break / frame highs, Active Player, and balls-potted stats.
  - Shared history across both players (up to **40** steps).
  - Survives control-panel **refresh** and **Active Player** changes; clears on a new frame / leaving Snooker / End Match–style sequence reset.
- Each successful **pot** (red, color, Free Ball, golden) increments **Balls Potted** for the Active Player. Fouls do not count as pots.
- Award a **Frame** with the Frames **+** control (records highest breaks for that frame, then clears **Points** for the next frame). Race / **Best Of** locking uses frame wins.
- Use **Reset Score** mid-match (danger, confirms) to clear **Frames** and **Points**. When the Best Of frame target is met, the button becomes **End Match** and keeps already-recorded frame stats. **Call Match Early** ends early while frames are unfinished and still saves completed frames. While the frame target is met, all Ball Scoring selections and point scoring are locked until the scoreline is cleared.
- Snooker UI uses **Frame** instead of **Rack** in stats/overlay labels.
- Foul values: White/Yellow/Green/Brown = 4; Blue = 5; Pink = 6; Black = 7; **Golden = 20**. Pot values: Red 1 … Black 7, Golden 20, Free Ball 1.
- Manual **+/-** and **Push Entered Scores** still work for Frames and Points.

Dual-score UI also requires **both** Player 1 and Player 2 enabled in General settings.

Ball Scoring is the control-panel scoring grid. **Display Balls** is a separate option that mirrors that grid on the browser source. Display Balls is hidden for Snooker (overlay never shows the snooker grid) and is disabled unless Ball Scoring is on. **Active Player Indicator** is required whenever Ball Scoring is on (locked on; scoring credits the Active Player). Which balls appear follows the game type (e.g. fewer for 9-Ball / 10-Ball; snooker uses balls 1–11 with a spacer on the control panel only). Ball Set Toggle applies mainly to 8-Ball and Custom (not Snooker).

---

## Shot Clock

Enable **Shot Clock** under General, then use Controls:

- **30s** / **60s** — start countdown on the overlay (and a local countdown in the dock).
- **Stop Clock** — stop after the stroke (typical use: stop when the tip hits the cue ball).
- **Show Clock** / **Hide Clock** — force visibility; the overlay also tends to show automatically near the last ~10 seconds.
- **Extensions** — one +30 s extension per player until reset. After use, a per-player reset appears; **Reset Extensions** clears both (with confirm).

Local beep alerts play in the dock in the final seconds (not on stream unless a mic picks them up). Scoring or ball changes stop the clock and reset extensions.

**Typical tournament pattern:** 60 s after the break (or after a push return, per your event rules); 30 s for other shots; start when the cue ball stops; stop on contact; one extension per player per rack.

---

## Hotkeys

1. OBS → **Tools → Scripts** → **+** → select `g4ScoreBoard_hotkeys.lua` from this folder.
2. OBS → **Settings → Hotkeys** and bind keys. Names are prefixed with **`CueSport -`**, for example:
   - Player 1/2 Score +1 / −1  
   - Score Reset  
   - Player 1/2 Extension  
   - 30 / 60 Second Shot Clock Start  
   - Stop Clock  
   - Swap Player Colors  
   - Player Toggle  

The script writes a small `hotkeys.js` helper next to the HTML files; keep the script path pointing at this project folder.

---

## Logos & Slideshow

1. Open **Images**.
2. Upload **Player 1 Logo** / **Player 2 Logo** and toggle them on.
3. Upload **L1 / L2 / L3** and enable **Custom/Sponsor Slideshow** to cycle sponsors.

Player logos look best square. Clear a logo with the clear control after upload if you need to replace it.

---

## Data, Clearing & Privacy

| Action | Effect |
|--------|--------|
| **Clear Game** | Clears player names, race/game info, and the on-screen scoreline; abandons the in-progress stats session (undoes racks/frames/balls recorded this match). Does **not** delete players or completed match history. |
| **Clear Instance Data** | Clears scoreboard settings for this `instance` only (includes dock zoom and last tab). Does **not** affect player statistics. |
| **Clear All Data** | Clears scoreboard settings/layout localStorage (all instances). Keeps per-instance overlay stats mode/payload keys and stats visibility settings. Does **not** clear IndexedDB statistics. |
| **Stats → Import JSON** | **Replaces** all current players and matches with the file. Requires warning + confirmation. Export a backup first if you need to keep existing data. |
| **Stats → Clear All Stats** | Permanently deletes all players and matches in `cuesport_stats` (double confirmation). Does not change live scoreboard settings. |

Stream promotion sends only the match metadata described above, and only while you enable it and OBS is streaming.

---

## Smoke Tests

From the project root:

```bash
python -m http.server 8765
```

Open `http://localhost:8765/tests/smoke_test.html` and click **Run all tests**. Coverage includes core wiring and version; Setup (**Game Selection** / **Game Information**, player details, game-variant option integrity); dock **zoom** and **tab** persistence; Stats tab restore; **Manual Controls** layout (chosen ball placement, player-tracking block visibility); Show Scores / Ball Scoring preference handling; Stats tab (Edit Player Stats, per-game overlay visibility toggles); **OverlayVisibility** (stats toggles through initial build, broadcast rebuild, and Snooker live publish); overlay mode toggles and payload sync; stats APIs and match history; live H2H / in-progress match editing; **Breaking Player?** / **Active Player** (8/9/10/Snooker with Ball Scoring on, section hidden when off, race-complete lock, player switching, International Red/Yellow auto-assign); Snooker (frames/points, Golden Ball, fouls, Free Ball, undo stack, scoring lock, overlay Display Balls rules); Ball Scoring rack wins (8/9/10-ball, Straight 14.1 re-rack, Bank/One Pocket); **Call Match Early** modal copy; replay clip delete note; and related UI labels.

---

## Support

- **Wiki:** [GitHub Wiki](https://github.com/iainsmacleod/CueSport-Scoreboard/wiki)
- **Releases:** [Releases](https://github.com/iainsmacleod/CueSport-Scoreboard/releases)
- **Support the developer:** [Ko-fi](https://ko-fi.com/iainsmacleod)

---

<div align="center">

*Mosconi Cup and European Open are trademarks of Matchroom Pool and are not affiliated with CueSport Scoreboard.*

</div>
