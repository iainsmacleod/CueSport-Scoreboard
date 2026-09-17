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
| **OBS Dock Key** | One seat = one cloud table |
| Room identity | Keyed by Dock Key (`api_key_id`) |
| Local `?instance=` | Still isolates localStorage / BroadcastChannel on that machine |

Practical rules:

1. Create a **separate named Dock Key** for each table/operator in the dashboard.
2. Paste each key into that table’s dock (**Settings → CueSport Scoreboard Cloud → ⚙**).
3. Each key may only be connected on **one dock at a time**.
4. Two docks with different keys are two cloud tables — even if they use the same local `instance` string.
5. One key with two docks fighting for it will not work reliably (one-live-dock-per-key).

## Recommended multi-table layout

| Table | Dock URL | Overlay URL | Dock Key label |
|-------|----------|-------------|----------------|
| Main | `control_panel.html` (or `?instance=main`) | matching overlay | `Main table` |
| Side | `control_panel.html?instance=side` | `browser_source.html?instance=side` | `Side table` |

## Related

- [Cloud Overview](Cloud-Overview)
- [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests)
- [Getting Started with OBS](Getting-Started-OBS)
