# CueSport Scoreboard — Release Notes

**8.2.4 → 8.3.0** · September 2026

Minor release focused on **ad-hoc (dockless) Cloud tables**: score league, tournament, and side games from phone or dashboard without an OBS dock or stream — with the same Cloud command vocabulary, guest scorers, and seat quotas as dock tables.

Local OBS scoring is unchanged. Ad-hoc tables are an optional Cloud feature on hosted and self-hosted deployments.

---

## Headline: Ad-hoc tables

Create a dockless scoring seat from the Dashboard **Tables** tab. The signed-in owner phone (or dashboard control session) is the **scoring authority** — guests relay commands over Cloud WebSocket; there is no OBS BroadcastChannel / browser source path.

- **Create Ad-hoc Table** beside the first-time OBS onboarding carousel (and as a + card when tables already exist).
- Tier-limited seats separate from OBS Dock Key seats (`maxImpromptuTables`).
- Land on mobile **Setup**, then score from **Control**. **Share** for guest links. No Stream tab.
- **Destroy Table** (next to Restart Match) discards an unwanted seat without writing match history.
- **End Match** / **Call Match** save history and free the impromptu seat. **Restart Match** keeps the seat.

### Guests

- A scoring-only **Guest scorer** link is created with the table.
- No **OBS Dock Owner** elevated guest link — the signed-in owner is already the authority.
- Standard guest permissions apply (score, breaker, setup, Restart/End/Call; no names, Stream, Share, or Destroy).

### Dashboard status

Ad-hoc table cards show presence clearly:

- **Ready** — nobody connected  
- **Admin** — owner controlling as authority  
- **Guest** — a guest link is open (scoring still needs Admin)

**Table Connections** in Settings lists docks and ad-hoc seats with kind-aware details (no dock instance / last-seen fields on impromptu rows).

---

## Related Cloud polish in this line

- Breaker prompt parity with the dock (“Breaking Player?” until selected; re-prompts after a rack).
- Free-ball image fix for impromptu Snooker (`snooker-freeball-small.png`).
- Smoke and unit coverage for create, authority join, session end, and destroy/discard seat free.

---

## Docs

- [Multiple Tables](../../wiki/Multiple-Tables.md) — ad-hoc create / score / destroy / seat rules  
- [Cloud Dashboard, Mobile & Guests](../../wiki/Cloud-Dashboard-Mobile-Guests.md)  
- [Cloud Overview](../../wiki/Cloud-Overview.md)

---

## Upgrade notes

- Restart the Cloud backend after deploy so room-hub presence and discard teardown are live.
- Hard-refresh dashboard and mobile so `?v=8.3.0` assets load.
- Existing dock tables and Dock Keys are unaffected.
