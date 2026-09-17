# Instant Replay

Instant replay uses OBS’s **Replay Buffer**. CueSport does not record video itself — it asks OBS to save the buffer and plays that file in a Media Source over **OBS WebSocket**.

## OBS prerequisites

1. **Settings → Output → Replay Buffer**
   - Enable Replay Buffer.
   - Set **Maximum Replay Time** (often 30–60 seconds). That length is what Instant Replay captures.
2. Create a **Media Source** on your program scene (or a dedicated replay scene). Leave the file empty; CueSport sets `local_file` when a clip is saved.
3. Optional: an **indicator** source (text/image) shown only while a replay is playing.

> In current OBS, Replay Buffer lives under **Output**, not Video.

## Connect OBS WebSocket

1. OBS → **Tools → WebSocket Server Settings** (OBS 28+).
2. Enable the server; note the **port** (default **4455**) and password if set.
3. In the CueSport dock → **Settings**:
   - Open **Enable Replay Function** ⚙.
   - **OBS WebSocket Address**: `ws://127.0.0.1:4455` (use a LAN IP only if the dock runs elsewhere).
   - Enter the **Password** if required → **Save**.
4. Turn the WebSocket **toggle** on. It should show connected.

The dock can auto-reconnect on load if WebSocket was left enabled.

## CueSport source settings

Still under **Settings → Enable Replay Function**:

| Field | Required | Purpose |
|--------|----------|---------|
| **Media Source Name** | Yes | Exact OBS name of the Media Source that plays clips |
| **Indicator Source Name** | No | Exact OBS name of a source shown during replay |
| **Auto-resume Monitoring** | No | After a clip finishes, briefly wait and start the replay buffer again |

Click **Update Sources** after editing. Names must match OBS **exactly** (including spaces).

## Using replay during a match

1. WebSocket connected; Replay Buffer enabled in OBS.
2. On **Controls**, click **Monitor Game** to start (or resume) the Replay Buffer.  
   Active → **Stop Monitoring**; after a stop → **Resume Monitoring**.
3. When something worth replaying happens, click **Instant Replay**:
   - OBS saves the buffer (last *Maximum Replay Time* seconds).
   - Monitoring stops.
   - The file loads into your Media Source and plays; the indicator (if set) shows.
4. Up to **five** clip paths are kept as **Clip 1–5**. Click a clip to play it again.
5. **×** / delete on a clip removes it from the list only — it does **not** delete the video file on disk. Clean up replay files manually.

**Checklist:** WebSocket connected · Replay Buffer on · Media Source name saved · Monitoring active before Instant Replay.

## Notes

- Disconnecting WebSocket also drops stream promotion until you reconnect.
- Replay clip history is shared across all `?instance=` docks on the machine (one stream buffer).

## Related

- [Stream Promotion](Stream-Promotion) — also needs WebSocket (and Cloud)
- [Control Panel](Control-Panel) — Settings tab overview
- [Troubleshooting](Troubleshooting)
