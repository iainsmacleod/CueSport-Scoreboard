# Cloud Public Stats Sharing

Cloud-only. Visitors do not need a CueSport account. Local OBS / IndexedDB stats are not shared this way.

## Public player pages

Every Cloud roster player has a UUID. Anyone with the link can open a **read-only** career view:

- URL: `/player/<player-uuid>`
- Shows summary cards, match list, game/opponent filters, and head-to-head chart
- Optional deep links: `?opponent=<id-or-name>&game=<gameTypeId>`
- No rename, edit, delete, or abandon actions

From the Cloud dashboard **Stats → player detail**, use **Copy public player link** (link icon). The copied URL includes the current opponent/game filters when set.

API: `GET /api/public/players/:playerId` (no auth).

## Shared event leaderboards

Owners can share **live** standings for an event/date scope without exposing their full account board.

1. On **Stats**, set **Event** and/or **From** / **To** (player-name filter is not included).
2. Click **Share board**.
3. Cloud creates or reuses an opaque token and copies `/l/<token>`.

Visitors see:

- Locked event title and date range (not editable)
- Read-only leaderboard (live — refresh the page for updates)
- Player names link to `/player/<uuid>` when available

API:

- Owner: `POST /api/stats/leaderboard-shares` with `{ eventQuery, dateFrom, dateTo }` (at least one required)
- Public: `GET /api/public/leaderboards/:token`

Tokens store only the filter definition (not a frozen snapshot). The same account + filters reuses the same token.

## Future account toggle

A whole-account “public stats enabled” switch may be added later. Server handlers already call a shared gate (`accountAllowsPublicStats`) so both player pages and leaderboard tokens can honor it without new URLs.
