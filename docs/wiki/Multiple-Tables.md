# Multiple Tables

Run more than one CueSport Scoreboard on the same PC (or separate docks) without them fighting over state.

## Local `?instance=` (required for isolation)

Append the **same** query string to every page that belongs to one table:

```text
control_panel.html?instance=table2
browser_source.html?instance=table2
shot_clock_display.html?instance=table2
```

All pages for that table must share the same `instance` value so they share the correct BroadcastChannel and localStorage prefix.

| Per `instance` | Shared across all instances on this origin |
|----------------|--------------------------------------------|
| Live scores, settings, dock zoom, last tab | Player roster + match history in IndexedDB (`cuesport_stats`) |
| Overlay stats mode / visibility | OBS replay clip history (one stream buffer) |
| In-progress local stats session | |

## CueSport Scoreboard Cloud tables

Cloud tables are **not** created by `?instance=`.

| Concept | Meaning |
|---------|---------|
| **OBS Dock Key** | One seat = one **dock** cloud table (streaming) |
| **Impromptu table** | Dockless scoring seat from the Dashboard — no OBS dock or overlay |
| Room identity (dock) | Keyed by Dock Key (`api_key_id`) |
| Local `?instance=` | Still isolates localStorage / BroadcastChannel on that machine |

### Dock (streaming) tables

1. Create a **separate named Dock Key** for each table/operator in the dashboard.
2. Paste each key into that table’s dock (**Settings → CueSport Scoreboard Cloud → ⚙**).
3. Each key may only be connected on **one dock at a time**.
4. Two docks with different keys are two cloud tables — even if they use the same local `instance` string.
5. One key with two docks fighting for it will not work reliably (one-live-dock-per-key).

### Impromptu (dockless) tables

Use these to track league / tournament / side games when you are **not** streaming.

1. On the Dashboard **Tables** tab, choose **Create Impromptu Table** (tier-limited; separate from Dock Key seats).
2. You are taken to mobile **Setup** for that table.
3. Score from **Control**; share **scoring-only guest links** from **Share** (a default **Guest scorer** link is created with the table). There is no Stream tab and no OBS Dock Owner guest link — the signed-in owner is already the authority. Table cards show **Ready** (nobody connected), **Admin** (owner controlling), or **Guest** (guest link open; scoring still needs Admin authority).
4. The signed-in owner phone is the scoring authority (same command vocabulary as the dock). Guests relay commands to that authority over Cloud WebSocket — not OBS BroadcastChannel / `browser_source.html`.
5. **End Match** or **Call Match** logs history and **deletes the table**, freeing an impromptu seat. Restart Match keeps the seat.

## Recommended multi-table layout

| Table | Dock URL | Overlay URL | Dock Key label |
|-------|----------|-------------|----------------|
| Main | `control_panel.html` (or `?instance=main`) | matching overlay | `Main table` |
| Side | `control_panel.html?instance=side` | `browser_source.html?instance=side` | `Side table` |

## Related

- [Cloud Overview](Cloud-Overview)
- [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests)
- [Getting Started with OBS](Getting-Started-OBS)
