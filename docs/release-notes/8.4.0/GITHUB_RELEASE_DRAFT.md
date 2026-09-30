## CueSport Scoreboard 8.4.0

**8.3.6 → 8.4.0** — **Match lifecycle** under dual control (Call Early races, reopen Finished→Live, per-rack edit extras), **snooker respotted black**, and **admin / billing** polish (dock client versions, cancellation & access end).

### Highlights

- **Call Early race** — FIFO cloud commands; no empty invented racks; skip redundant end after a real completion
- **`session:reopen`** — undo / edit-back-open restores Live on Cloud; safer discard for completed pairs
- **Match edit** — per-rack pool balls / B&R / TR; match totals derived from racks; dock Delete only in the edit modal
- **Web date edit** — end times clamped vs start; two-pass pairing keeps Live when unfinished
- **Snooker** — respotted black after a tying black pot (dock + ad-hoc)
- **Admin** — active OBS / ad-hoc counts, dock client versions; billing terms, cancel, complimentary access end

Local OBS docks continue to work as before. See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full detail.
