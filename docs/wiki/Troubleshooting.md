# Troubleshooting

## Overlay does not update

1. Confirm the browser source URL points at `browser_source.html` (same folder / server as the dock).
2. Width × height should be **1920×1080**.
3. Dock and overlay must share the **same** `?instance=` value (or both omit it).
4. Refresh the browser source (OBS → right-click source → Refresh) after moving files or changing `instance`.
5. Avoid opening a second copy of the overlay in a normal browser that fights the OBS source for the same instance.

## Dock looks empty / wrong theme

1. Open **Settings → OBS Theme** (Modern Cloud is the default for new installs).
2. Try **Clear Instance Settings** if localStorage is corrupted (does not wipe player statistics).
3. Confirm you are on the expected release folder (version in the dock header).

## Ball Scoring / breaker not available

1. **Settings → Ball Scoring** must be on.
2. **Show Scores** and both players must be enabled.
3. Each rack starts with **Breaking Player?** — pick a breaker before the grid unlocks.
4. When the race target is met, scoring locks until **End Match** or **Restart Match**.

## Stats not recording

1. Use **different** names on Player 1 and Player 2.
2. Complete racks/frames (or End / Call Match Early) — naming alone does not finish a match.
3. Check Stats → Player Stats for an **In progress** row you can edit/discard.
4. With Cloud connected, local Import/Export/Clear are disabled — cloud history is on the dashboard.

## Instant Replay fails

Checklist:

- OBS WebSocket connected (address/password match **Tools → WebSocket Server Settings**)
- Replay Buffer enabled under **Settings → Output → Replay Buffer**
- **Media Source Name** matches OBS exactly → **Update Sources**
- **Monitor Game** was active before **Instant Replay**

Clip **×** only clears the path in CueSport — delete video files on disk yourself.

## Cloud will not connect

1. Status line under **Settings → CueSport Scoreboard Cloud** — Off / connecting / error text.
2. **Hosted:** valid Dock Key from your Google account; active plan or complimentary access.
3. **Self-host:** Server URL reachable from the OBS machine; `PUBLIC_URL` correct; Dock Key from that server’s owner dashboard.
4. Only **one dock** may use a given Dock Key at a time — revoke or disconnect the other.
5. Refresh the dock after changing Connection settings.

## Mobile / guest controls locked

- Dock must be online (dashboard table card shows connected).
- Cloud socket must be up on the phone.
- Guest link: only one device at a time; revoke and recreate if stuck “in use”.
- Standard guests cannot use Stream/Share — use an OBS Dock Owner guest link or sign in on `/m/...`.

## Promote Live Stream not listing

1. WebSocket connected and OBS **actually streaming**.
2. Cloud connected with a Dock Key.
3. Promote toggle on; manual Stream URL set if OBS did not supply one.
4. Check the public `/streams` page for your self-host or the hosted Live Streams page.

## macOS dock URL keeps breaking

Prefer `python3 -m http.server 8000` and `http://localhost:8000/...` instead of `file://` — see [Getting Started with OBS](Getting-Started-OBS).

## Still stuck?

- Full reference: [README](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/README.md)
- Backend: [backend/README](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/backend/README.md)
- Releases: [Releases](https://github.com/iainsmacleod/CueSport-Scoreboard/releases)
- Support: [Ko-fi](https://ko-fi.com/iainsmacleod)
