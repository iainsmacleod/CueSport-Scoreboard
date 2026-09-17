## CueSport Scoreboard 8.2.0

The big news in 8.2.0 is **CueSport Scoreboard Cloud**: optional hosted or self-hosted remote scoring, multi-table management, guest controls, match history, player statistics, and live-stream discovery — alongside deeper **scoring** across cue sports, with **Snooker** as a first-class focus.

The scoreboard remains free and GPL licensed, and local operation still works without Cloud.

### CueSport Scoreboard Cloud

- **Hosted** — Google-authenticated customer accounts, managed relay and storage, Stripe plans, and customer support
- **Self-hosted** — run the included Node.js/Docker backend yourself, free and unrestricted with no Stripe requirement
- **OBS Dock Keys** — one named, revocable, role-scoped key per OBS dock/table
- **Mobile and guest scoring** — control matches from a phone or share a focused guest link/QR code (including full Snooker)
- **Cloud dashboard** — live tables, key management, onboarding, account controls, and connected-dock status
- **Match statistics** — leaderboards, expandable rack/frame detail, player history, UUID identities, match editing, and Date Added
- **Live Streams** — optionally promote streams while OBS is actively broadcasting

![Cloud dashboard — live connected table](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/05-cloud-dashboard.png)

![Mobile remote scoring](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/06-cloud-mobile-control.png)

![Mobile Snooker control](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/08-cloud-mobile-snooker.png)

![Cloud Stats — expanded Snooker match detail](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/09-cloud-stats-match-detail.png)

![OBS Remote tab — control your table from anywhere](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/04-remote-tab.png)

### Scoring & Snooker

- Shared Breaking Player / Active Player, Undo, and match-end flow across game types
- Correct Break & Run / Table Run for 8, 9, and 10-Ball
- **Snooker** — frames + points, foul modal, Free Ball, Golden Ball, frame undo, Current Break / Remaining overlay fields
- Mobile Snooker mirrors the dock colour grid, break strip, and dual frame/point controls

![OBS dock — Snooker controls](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/07-dock-snooker-controls.png)

### Also included

- Optional **Modern Cloud** OBS theme and refreshed dashboard/mobile controls
- Separate Snooker Highest Break and Straight Pool Longest Run
- Safer sessions, Dock Key permissions, account deletion, and trial handling

![Modern Cloud theme — Setup](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/01-modern-cloud-setup.png)

![Modern Cloud theme — Controls with ball scoring](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/02-modern-cloud-controls.png)

![Settings — CueSport Scoreboard Cloud and Replay](https://raw.githubusercontent.com/iainsmacleod/CueSport-Scoreboard/main/docs/release-notes/8.2.0/images/03-settings-cloud.png)

### Hosted service

Try the managed service at [cuesport.macleod.systems](https://cuesport.macleod.systems), or follow the repository documentation to run your own unrestricted self-hosted Cloud.

### Full release notes

See [`docs/release-notes/8.2.0/RELEASE_NOTES.md`](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/docs/release-notes/8.2.0/RELEASE_NOTES.md).
