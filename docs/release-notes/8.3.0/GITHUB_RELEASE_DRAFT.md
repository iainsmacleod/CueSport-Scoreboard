## CueSport Scoreboard 8.3.0

**8.2.3 → 8.3.0** — **Ad-hoc tables**, clearer plan quotas, self-host **simulated plans**, and **downgrade seat reset**, plus Snooker/pool scoring polish and session/guest fixes from the 8.2.4 line.

### Highlights

- **Ad-hoc tables** — create dockless Cloud seats from Tables; owner phone/dashboard is scoring authority; guest scorer links; End/Call or Destroy frees the seat
- **At-limit create card** — unlock / upgrade prompt when ad-hoc seats are full (or no plan yet)
- **Plan docs & billing cards** list ad-hoc seats (2 / 5 / 10 / 25 with dock keys)
- **Simulated plan** on self-host (and Platform Admin) for local quota testing without Stripe
- **Downgrade reset** — lower-capacity Stripe or simulated plan clears Dock Keys + ad-hoc tables (upgrades keep seats; history kept)
- **Admin** account list/detail split **OBS** vs **Ad-hoc**
- Snooker free-ball / golden-ball / foul polish; pool dry-break & 8-Ball ball-set improvements
- Session invalidation also revokes guests; match rack reconciliation fixes

Local OBS docks continue to work as before. See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full detail.
