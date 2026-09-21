# Cloud Overview

**CueSport Scoreboard Cloud** is optional. Local OBS scoring works without it. Cloud adds remote phones, a web dashboard, guest scorers, cloud match history, and public live-stream discovery.

Managed service: [cuesport.macleod.systems](https://cuesport.macleod.systems)  
Self-host: free (GPL) via the included [`backend/`](https://github.com/iainsmacleod/CueSport-Scoreboard/tree/main/backend)

## Architecture

The **OBS dock remains the scoring authority**.

```text
Phone / guest / dashboard     Cloud relay          OBS dock (authority)
        |                          |                        |
        |----- command ----------->|----- relay ----------->|
        |                          |<---- state publish ----|
        |<---- live state ---------|                        |
```

Mobile and guest clients send commands; the dock runs the same logic as clicking the control panel, then publishes updated state back out. Controls pause when the dock or relay is offline so the UI does not drift.

## What you get

| Surface | URL | Purpose |
|---------|-----|---------|
| **Dashboard** | `/dashboard` | Live tables, Dock Keys, account, cloud Stats |
| **Mobile control** | `/m/{room_id}` | Full remote for signed-in operators |
| **Guest control** | `/g/{token}` | Focused scoring link / QR (limited permissions) |
| **Live Streams** | `/` or `/streams` | Public list of promoted streams |

Also: cloud match history and player statistics, guest link create/revoke, and connection gating.

## Hosted vs self-hosted

| | Hosted | Self-hosted |
|---|--------|-------------|
| Auth | Google for the account + OBS Dock Key per dock | Dev secret on the dashboard; Dock Key + server URL in the dock |
| Accounts | Separate customer accounts (multi-tenant) | One server-owner account; share Dock Keys instead of user accounts |
| Cost | Stripe plans (Streamer / Tournament Organizer / League Director) | Free and unrestricted — you run the server |
| Platform Admin | Service-operator support tools | Disabled |

## Core concepts

- **One OBS Dock Key = one dock cloud table.** Rooms for streaming are created when the dock connects.
- **Ad-hoc tables** are dockless seats created from the Dashboard for scoring without OBS — league nights, side tables, and multi-table events you are not streaming (see [Multiple Tables](Multiple-Tables)).
- Local `?instance=` still isolates the dock/overlay on that PC; it does **not** create separate cloud tables. See [Multiple Tables](Multiple-Tables).
- **Dock Key roles** (Administrator / Trusted Operator / Operator) control how much dashboard/history power that seat has — not who owns the Cloud account.
- **Guest links** are for temporary scorers. Standard guests cannot edit names or use Stream/Share. An **OBS Dock Owner** guest link is elevated (Stream + Share). One active device per guest link.

## Choose a path

| Goal | Guide |
|------|--------|
| Use the managed service | [Cloud Hosted Setup](Cloud-Hosted-Setup) |
| Run your own backend | [Cloud Self-Hosted Setup](Cloud-Self-Hosted-Setup) |
| Day-to-day dashboard / phone / guests | [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests) |
| List your stream publicly | [Stream Promotion](Stream-Promotion) |

## Related

- [Getting Started with OBS](Getting-Started-OBS) — install the dock first
- [Control Panel](Control-Panel) — Settings → CueSport Scoreboard Cloud
- Backend reference: [backend/README](https://github.com/iainsmacleod/CueSport-Scoreboard/blob/main/backend/README.md)
