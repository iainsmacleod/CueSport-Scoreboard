# Getting Started with OBS

Install CueSport Scoreboard as an OBS dock (control panel) and a browser source (on-stream overlay). No Cloud account is required for local use.

## 1. Download

1. Get the latest release ZIP from [Releases](https://github.com/iainsmacleod/CueSport-Scoreboard/releases).
2. Extract it somewhere **permanent** (not a temp download folder). OBS will keep pointing at these files.

## 2. Add the control panel dock

### Windows

1. In OBS: **Docks → Custom Browser Docks**.
2. Dock name: e.g. `CueSport-Scoreboard`.
3. URL (OBS 27.2+ file URI), adjusting the path:

```text
file:///C:/Users/YourName/Desktop/CueSport-Scoreboard/control_panel.html
```

4. Apply / close. Undock or pin the panel where you like.

### macOS

OBS often rewrites local `file://` paths. Prefer a local HTTP server:

```bash
cd /path/to/CueSport-Scoreboard
python3 -m http.server 8000
```

- Dock URL: `http://localhost:8000/control_panel.html`
- Keep that Terminal window open while streaming.

### Linux

Use a `file:///` URI like Windows, or the same `python3 -m http.server 8000` approach as macOS.

## 3. Add the browser source (overlay)

On your program (or preview) scene:

1. **Add → Browser**.
2. URL:
   - Windows example: `file:///C:/Users/YourName/Desktop/CueSport-Scoreboard/browser_source.html`
   - Local server: `http://localhost:8000/browser_source.html`
3. Set **Width 1920**, **Height 1080**.
4. Leave **Control audio via OBS** unchecked unless you want overlay sounds in the mix.
5. Place and crop the source as needed.

> Best viewed as a **1920×1080** browser source.

## 4. First match checklist

1. Open the dock **Setup** tab.
2. Choose **Game Variant** (e.g. 8-Ball) and optional **Ball Variant**.
3. Enter **Race Info** (or **Best Of** for Snooker) and **Event Info** if you want them on stream, then **Update Info**.
4. Enter **Player/Team** names and colors.
5. Open **Controls** and score with Manual Adjustments and/or **Ball Scoring** (on by default for fresh installs).
6. Confirm the overlay updates on your scene.

## 5. Recommended Settings

On the **Settings** tab:

| Setting | Typical start |
|---------|----------------|
| **OBS Theme** | Modern Cloud (default for new users) |
| **Overlay Scaling / Opacity** | 100% unless you need a smaller/fainter board |
| **Show Scores** | On |
| **Ball Scoring** | On if you want the ball grid + breaker flow |
| **Shot Clock** | On only if your event uses one |
| **Win Animation** | On (hidden/skipped for Snooker until a dedicated clip exists) |

## Next steps

- [Control Panel](Control-Panel) — tab-by-tab usage
- [Scoring & Game Types](Scoring-and-Game-Types) — 8/9/10, Straight, Bank, One Pocket, Snooker
- [Instant Replay](Instant-Replay) — OBS WebSocket + Replay Buffer
- [Cloud Overview](Cloud-Overview) — optional remote scoring
