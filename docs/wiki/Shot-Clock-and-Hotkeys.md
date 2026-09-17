# Shot Clock & Hotkeys

## Shot clock

1. Enable **Shot Clock** under **Settings → Feature Settings**.
2. Use **Controls → Clock Controls**:

| Control | Effect |
|---------|--------|
| **30s Shot Clock** / **60s Shot Clock** | Start countdown on the overlay (and a local countdown in the dock) |
| **Stop Clock** | Stop after the stroke (typical: tip hits the cue ball) |
| **Show Clock** / **Hide Clock** | Force visibility; overlay also tends to show near the last ~10 seconds |
| **P1's Extension** / **P2's Extension** | One +30 s extension per player until reset |
| **Reset Extensions** | Clears both (with confirm) |

Local beep alerts play in the **dock** in the final seconds (not on stream unless a mic picks them up). Scoring or ball changes stop the clock and reset extensions.

### Typical tournament pattern

- **60 s** after the break (or after a push return, per your event rules)
- **30 s** for other shots
- Start when the cue ball stops; stop on contact
- One extension per player per rack

### Optional 2nd-monitor display

Open `shot_clock_display.html` in a browser (or OBS browser source) with the **same** `?instance=` as the control panel and overlay:

```text
shot_clock_display.html?instance=table2
```

It listens on the same BroadcastChannels for countdown ticks and stop.

## OBS hotkeys

1. OBS → **Tools → Scripts** → **+** → select `g4ScoreBoard_hotkeys.lua` from the CueSport Scoreboard folder.
2. OBS → **Settings → Hotkeys** and bind keys. Names are prefixed with **`CueSport -`**, for example:
   - Player 1/2 Score +1 / −1
   - Score Reset
   - Player 1/2 Extension
   - 30 / 60 Second Shot Clock Start
   - Stop Clock
   - Swap Player Colors
   - Player Toggle

The script writes a small `hotkeys.js` helper next to the HTML files. Keep the script path pointing at this project folder.

## Related

- [Getting Started with OBS](Getting-Started-OBS)
- [Multiple Tables](Multiple-Tables) — match `instance` on the shot-clock page
- [Troubleshooting](Troubleshooting)
