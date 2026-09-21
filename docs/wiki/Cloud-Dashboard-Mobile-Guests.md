# Cloud Dashboard, Mobile & Guests

Day-to-day use after Cloud is connected ([Hosted](Cloud-Hosted-Setup) or [Self-hosted](Cloud-Self-Hosted-Setup)).

## Dashboard tabs

| Tab | Purpose |
|-----|---------|
| **Tables** | Live cards for connected docks **and** open impromptu tables. First-time onboarding carousel when no dock is online. **Create Impromptu Table** for dockless scoring. |
| **Stats** | Account leaderboard, recent matches (including Live / in progress), player detail, rename, edit/delete matches, **Kill** unfinished matches. |
| **Settings** | OBS Dock Keys — create, rename, change role, copy, revoke one, **Revoke All**. |
| **Account** | Plan / billing (hosted), manage sessions (**Clear All Logins** also revokes guest links), sign out, account deletion. |

Hosted Platform Admins also get an **Admin** tab for customer support (not shown on self-host).

### Live table cards

- **Dock tables** appear when `dock_connected` is true for that Dock Key’s room.
- **Impromptu tables** appear while the room exists. Status shows **Ready** / **Admin** / **Guest**. Open the card for Control (or Setup if names are still placeholders).
- Updates push over WebSocket (no polling).

### Impromptu tables

Use for **league nights, friendly games, and multi-table events** where you are not streaming every table (or any table).

- Create from **Tables → Create Impromptu Table** (quota separate from OBS Dock Keys).
- Mobile shows Dashboard / Setup / Control / Share — no Stream.
- Default **Guest scorer** link only (no OBS Dock Owner elevated link).
- **Destroy Table** frees the seat without history; End or Call Match saves history and closes the table.
- See [Multiple Tables](Multiple-Tables).

### OBS Dock Keys

- Unique active names; revoked names can be reused later.
- Roles:

| Role | Can |
|------|-----|
| **Administrator** | Write matches; edit/delete **any** match; rename/delete players; share default guest QR; create extra guest links |
| **Trusted Operator** | Write matches; edit/delete only matches **this key** recorded; share default guest QR; create extra guest links |
| **Operator** | Write matches; view history; share/copy default guest QR; **cannot** edit/delete matches or create extra guest links |

Each key may only connect **one** live dock at a time.

### Cloud Stats highlights

- Players use UUID identities — duplicate display names are allowed and disambiguated in the UI.
- **Date Added** on the leaderboard.
- Match history survives temporary room cleanup and OBS reconnect.
- **Kill** on an unfinished match removes it from cloud history and, if a dock is connected, tells the dock to Clear Game and return to **Setup** (in-page notice).
- Highest Break (Snooker) and Longest Run (Straight) are tracked independently.
- When Cloud is connected, dock Stats Import / Export / Clear are disabled — manage history here.

## Mobile control (`/m/{room_id}`)

Full remote for the signed-in account / authorized operator:

- Players, breaker / active player, scores, balls, fouls, undo
- Race, event info, game type options
- Restart / End / Call Match Early (with confirmation)
- **Stream** — start/stop OBS streaming and overlay P1/P2/H2H stats when Ball Scoring is on (permissions permitting)
- **Share** — guest links

The first mobile/guest client can auto-enable both players, Show Scores, and Ball Scoring on the dock when those were off (needed for remote scoring).

Controls lock when the dock is offline or the cloud socket drops.

## Guest control (`/g/{token}`)

| | Standard guest | OBS Dock Owner guest |
|--|----------------|----------------------|
| Score (balls, foul, undo, game-type actions) | Yes | Yes |
| Breaker, game setup, race, event info | Yes | Yes |
| Restart / End / Call Match | Yes | Yes |
| Edit player names | No | No |
| Stream / Share | No | Yes |

Rules:

- **One active device per guest link** at a time (second device gets “in use”).
- Link stays valid until you revoke it.
- QR and URL stay hidden until **Show** (dock Remote tab and mobile Share).
- Create/revoke from dashboard Settings, dock **Remote** tab (when connected), or mobile **Share** (role permitting).

### Dock Remote tab

- **Disconnected:** hosted vs self-hosted pitch + button to open Connection settings.
- **Connected:** default OBS Dock Owner guest link + named guest links.

## Related

- [Cloud Overview](Cloud-Overview)
- [Stream Promotion](Stream-Promotion)
- [Multiple Tables](Multiple-Tables)
- [Player Statistics](Player-Statistics) — local IndexedDB stats (separate from cloud)
