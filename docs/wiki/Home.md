# CueSport Scoreboard Wiki

Practical setup and usage guides for **CueSport Scoreboard** (OBS control panel + browser source) and optional **CueSport Scoreboard Cloud**.

**Current product version:** 8.2.0

## Start here

| Goal | Guide |
|------|--------|
| Install the OBS dock and on-stream overlay | [Getting Started with OBS](Getting-Started-OBS) |
| Run a match from the control panel | [Control Panel](Control-Panel) |
| Understand scoring per game type | [Scoring & Game Types](Scoring-and-Game-Types) |
| Track players and match history locally | [Player Statistics](Player-Statistics) |
| Instant replay from OBS | [Instant Replay](Instant-Replay) |
| Shot clock and OBS hotkeys | [Shot Clock & Hotkeys](Shot-Clock-and-Hotkeys) |
| Remote scoring / dashboard / guests | [Cloud Overview](Cloud-Overview) |
| Use the managed Cloud service | [Cloud Hosted Setup](Cloud-Hosted-Setup) |
| Run your own Cloud backend | [Cloud Self-Hosted Setup](Cloud-Self-Hosted-Setup) |
| Dashboard, mobile, Dock Keys, guests | [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests) |
| List your stream publicly | [Stream Promotion](Stream-Promotion) |
| Multiple tables on one PC | [Multiple Tables](Multiple-Tables) |
| Common problems | [Troubleshooting](Troubleshooting) |

## What is CueSport Scoreboard?

Two HTML pages that talk to each other (and optionally to OBS and Cloud):

| Piece | File | Role |
|--------|------|------|
| **Control panel** | `control_panel.html` | OBS Custom Browser Dock — scores, names, clock, replay, Cloud, stats |
| **Overlay** | `browser_source.html` | OBS Browser Source — what viewers see (best at **1920×1080**) |

Local play does **not** require CueSport Scoreboard Cloud. Cloud is optional for remote phones, a web dashboard, guest scorers, cloud match history, and live-stream discovery.

## How local scoring works

1. You change something in the dock (name, score, clock, etc.).
2. The dock saves state in **localStorage** and sends a **BroadcastChannel** message.
3. The overlay updates from that message (and from localStorage on load).
4. **Instant replay** and **stream promotion** also use **OBS WebSocket**.
5. **Player statistics** live separately in **IndexedDB** (`cuesport_stats`).

## How Cloud fits in

```text
Phone / guest / dashboard     Cloud relay          OBS dock (authority)
        |                          |                        |
        |----- command ----------->|----- relay ----------->|
        |                          |<---- state publish ----|
        |<---- live state ---------|                        |
```

The **OBS dock remains the scoring authority**. Mobile and guest clients send commands; the dock runs the same logic as clicking the control panel, then publishes updated state back out.

## Related docs in the repo

- Root [README](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/README.md) — full reference
- [backend/README](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/backend/README.md) — Cloud server, env vars, Docker
- [Release notes](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/docs/release-notes/8.2.0/RELEASE_NOTES.md) — what changed in 8.2.0

## Publishing this wiki

Source files live in `docs/wiki/` in the main repository. See [Publishing](Publishing) to push them to the GitHub Wiki.
