# CueSport Scoreboard

<div align="center">

**A professional scoreboard overlay for OBS Studio, built for cue sports**

Made for cue sport fans by a cue sport fan, based on [g4ScoreBoard](https://github.com/ngholson/g4ScoreBoard/)

Display player names, race and game info, racks (and balls where needed), logos, sponsors, a shot clock, instant replay, and optional live stream listing.

*Best viewed as a **1920×1080** browser source*

**Current version: 6.1.0**

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
  - [Game Setup](#game-setup)
  - [Controls](#controls)
  - [Image](#image)
  - [Replay/Share](#replayshare)
  - [General](#general)
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

---

## Control Panel Overview

Header: version (links to the wiki), dock zoom (− / RESET / +), and a support link.

Tabs: **Game Setup**, **Controls**, **Image ⚙**, **Replay/Share ⚙**, **General ⚙**.

### Game Setup

- **Race Info** — short numeric race-to (the last number in the field is used as the race target). Leave blank for no race lock.
- **Game/Other Info** — free text (max 60 characters).
- **Update Info** — push race/game text to the overlay.
- **Player/Team names** — max 20 characters each; autocomplete from your stats roster when names match known players.
- **Colors** — per-player color for the scoreboard bars.
- **Update Names** / **Swap Colors** / **Clear Game**.
- **Stats** — opens the Player Statistics modal (see [Player Statistics](#player-statistics)).

### Controls

- **Score** — increment, decrement, or type a value then **Push Entered Scores**. Primary score is labeled **Racks** for most games, or **Balls** in Straight Pool.
- **Balls** (Bank, One Pocket, or Custom with Point Based) — secondary ball counters (−999 to 999). Fouls can go below zero; that display foul does not undo recorded ball stats.
- **Reset Scores** — clears primary (and dual-score ball) scores for a new game.
- **Stats Overlay** — **P1 Stats**, **P2 Stats**, **H2H Stats**. Toggle the same button again to hide. Off by default.
- **Breaking Player**, **Chosen Ball** (when Ball Set Toggle is on), and the **Ball Tracker** grid (when enabled).
- **Replay Controls** — appear for use once OBS WebSocket is connected (see [Instant Replay](#instant-replay)).
- **Shot Clock** and **Extensions** — see [Shot Clock](#shot-clock).

### Image

- **Custom/Sponsor Slideshow** — enable cycling of L1 / L2 / L3 (about every 20 seconds).
- **Player 1 / Player 2 logos** — upload, toggle visibility, click the label to rename.
- Max practical size ~2.4 MB (browser storage limits). Prefer square player logos. PNG, JPEG, SVG, BMP.

### Replay/Share

- OBS WebSocket toggle + **⚙** settings.
- Stream Promotion toggle + **⚙** (stream URL).
- Replay source names and **Auto-resume Monitoring**.

Details: [OBS WebSocket Setup](#obs-websocket-setup), [Instant Replay](#instant-replay), [Stream Promotion](#stream-promotion).

### General

- **OBS Theme** for the dock: Default, Classic (default), Acri, Grey, Light, Rachni.
- **Overlay Scaling** (40–100%), **Overlay Opacity**, **Game Type**, and for Custom only **Point Based**.
- Feature toggles: Player 1 / Player 2, Show Scores, Shot Clock, Breaker Indicator, Win Animation.
- Ball Tracker, Vertical Ball Tracker, Ball Set Toggle, Ball Type (World / International / Unity).
- **Check for Update** (compares to the latest GitHub release).
- **Clear Instance Data** / **Clear All Data** — scoreboard settings only; player stats are kept (see [Data, Clearing & Privacy](#data-clearing--privacy)).

---

## OBS WebSocket Setup

WebSocket is required for **instant replay** and for **stream promotion** (so the dock can tell whether OBS is streaming).

### Enable the server in OBS

1. Open **Tools → WebSocket Server Settings** (OBS 28+; older builds may say Websocket).
2. Enable the WebSocket server.
3. Note the **port** (default **4455**) and set a **password** if you want one.
4. Apply / OK.

### Connect from CueSport

1. Open the **Replay/Share ⚙** tab.
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

In **Replay/Share ⚙**:

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
5. **×** on a clip removes it from the list only — it does **not** delete the video file on disk. Clean up files in your OBS replay buffer folder periodically.

**Requirements checklist:** WebSocket connected · Replay Buffer enabled in OBS · Media Source name saved · Monitoring active before Instant Replay.

---

## Stream Promotion

Optional listing on **[https://cuesports.macleod.systems](https://cuesports.macleod.systems)** so others can find streams that are currently on air with live match info.

### Setup

1. Connect **OBS WebSocket** (promotion uses it to detect streaming).
2. In **Replay/Share ⚙**, open Stream Promotion **⚙** and set your **Stream URL** (must be `http://` or `https://`, e.g. `https://www.twitch.tv/yourchannel`). You can also let OBS-related auto-detection fill a URL when possible.
3. Enable the **Stream Promotion** toggle.
4. **Start streaming in OBS.** Promotion only stays connected while OBS reports an active stream.

### What is shared

Match metadata only, for example: player names, scores, ball scores (when used), game type, race/game info, whether players/scores/tracker/clock are enabled, ball style, and your stream URL. **No video or audio** is uploaded.

Each install gets a local API key. You can turn promotion off anytime. If a key is blocked server-side, the dock disables sharing and alerts you.

---

## Player Statistics

Local history for a shared roster of players (not tied to a single OBS `instance`).

### Where it lives

- Browser **IndexedDB** database: `cuesport_stats`
- Survives **Clear Instance Data** and **Clear All Data**
- Cleared only via Stats → **Data** → **Clear All Stats** (or by clearing site data for that origin)

### Recording during play

1. Enter distinct player names and click **Update Names** (same name on both sides disables recording for that pairing).
2. Score **+** records a rack (or Straight Pool primary point) and checks race completion.
3. In dual-score games, ball **+** records balls potted; ball **−** from a positive value undoes the last pot. Going from `0` to `-1` is a foul display and does not change stats.
4. Completing a race marks the match completed and updates games won/lost.

### Stats modal (Game Setup → Stats)

| Tab | Use |
|-----|-----|
| **Board** | Leaderboard: Name, Games W/L, Win%, Racks W/L, Last played. Click a row for detail. |
| **Player** | Per-player breakdown, win streak, opponent H2H, match history, rename/delete, add match. |
| **H2H** | Pick two players for head-to-head summary and history. |
| **Data** | Export JSON backup; Import JSON **replaces** all current stats (warning + confirmation); Clear All Stats (double confirmation). |

### Overlay stats (Controls tab)

- **P1 Stats** / **P2 Stats** / **H2H Stats** — one mode at a time; click again to hide.
- Individual panels: **Games W/L** (with win %), **Rack W/L**, optional **Balls Potted** (total), Win Streak.
- H2H: games, **Rack W/L**, and optional balls potted totals for both players.
- **Balls Potted** appears only in dual-score game types (see below). It is a **total**, not a win/loss record.

### Manual matches

From Player or H2H you can **Add Match** (date, game type, scores, completed/partial). Balls potted fields appear for Bank, One Pocket, and Custom.

---

## Game Types & Scoring Modes

| Game type | Primary score | Extra ball scores | Balls Potted in stats/overlay |
|-----------|---------------|-------------------|-------------------------------|
| 8-Ball, 9-Ball, 10-Ball | Racks | No | No |
| Straight | Labeled **Balls** (still the primary counter) | No | No |
| Bank | Racks | Yes | Yes |
| One Pocket | Racks | Yes | Yes |
| Custom | Racks | Only if **Point Based** is checked | Only if **Point Based** is checked |

Dual-score UI also requires **both** Player 1 and Player 2 enabled in General settings.

Ball Tracker visibility and which balls are shown follow the game type (e.g. fewer balls for 9-Ball / 10-Ball). Ball Set Toggle applies mainly to 8-Ball and Custom.

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

1. Open **Image ⚙**.
2. Upload **Player 1 Logo** / **Player 2 Logo** and toggle them on.
3. Upload **L1 / L2 / L3** and enable **Custom/Sponsor Slideshow** to cycle sponsors.

Player logos look best square. Clear a logo with the clear control after upload if you need to replace it.

---

## Data, Clearing & Privacy

| Action | Clears |
|--------|--------|
| **Clear Game** | Current match names/info (and ends the active stats session appropriately) |
| **Clear Instance Data** | localStorage for this `instance` (scores, toggles, etc.) |
| **Clear All Data** | Almost all scoreboard localStorage (all instances). Keeps overlay stats mode/payload keys. **Does not** clear IndexedDB stats. |
| **Stats → Clear All Stats** | All players and matches in `cuesport_stats` |

Stream promotion sends only the match metadata described above, and only while you enable it and OBS is streaming.

---

## Smoke Tests

From the project root:

```bash
python -m http.server 8765
```

Open `http://localhost:8765/tests/smoke_test.html` and click **Run all tests**. This checks core wiring, overlay toggles, stats APIs, scoring edge cases, and Balls Potted visibility/labels.

---

## Support

- **Wiki:** [GitHub Wiki](https://github.com/iainsmacleod/CueSport-Scoreboard/wiki)
- **Releases:** [Releases](https://github.com/iainsmacleod/CueSport-Scoreboard/releases)
- **Support the developer:** [Ko-fi](https://ko-fi.com/iainsmacleod)

---

<div align="center">

*Mosconi Cup and European Open are trademarks of Matchroom Pool and are not affiliated with CueSport Scoreboard.*

</div>
