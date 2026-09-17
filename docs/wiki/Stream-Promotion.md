# Stream Promotion

Optionally list your stream on the public **Live Streams** page (hosted: [cuesport.macleod.systems](https://cuesport.macleod.systems/streams), or your self-hosted `/streams`) with live match metadata so others can find games that are on air.

## Requirements

1. **OBS WebSocket** connected (CueSport uses it to detect that OBS is streaming) — see [Instant Replay](Instant-Replay).
2. **CueSport Scoreboard Cloud** connected with an OBS Dock Key.
3. OBS actually **streaming**.
4. A public watch URL (from OBS when possible, or a manual failover).

## Setup

1. Connect WebSocket under **Settings → Enable Replay Function**.
2. Connect Cloud under **Settings → CueSport Scoreboard Cloud**.
3. Open **Promote Live Stream** ⚙ and optionally set a manual **Stream URL** (`https://…`) as failover if OBS cannot provide a Twitch/YouTube (etc.) link.
4. Start streaming in OBS.
5. Turn **Promote Live Stream** **on**.

Promotion only stays listed while OBS reports an active stream. Stopping the stream or disconnecting WebSocket/Cloud drops the listing.

## What is shared

**Match metadata only**, for example:

- Player names, scores, ball scores (when used)
- Game type, race / event info
- Feature flags (players/scores/Ball Scoring/clock)
- Ball style
- Your stream URL

**No video or audio** is uploaded through CueSport.

## Tips

- Keep Cloud Status **connected** while promoting.
- If a listing key is blocked server-side, the dock disables sharing and alerts you.
- Mobile **Stream** controls (start/stop OBS, overlay stats) are separate from public listing, but also need appropriate Dock Key / guest permissions.

## Related

- [Cloud Overview](Cloud-Overview)
- [Instant Replay](Instant-Replay)
- [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests)
