## CueSport Scoreboard 8.3.6

**8.3.5 → 8.3.6** — Cloud dashboard **session boot** polish: signed-in reloads no longer flash Sign In (Google button) between the loading spinner and the Account shell.

### Highlights

- **Boot spinner stays up** until Supabase session hydrate finishes
- **App shell first** when a token exists — Sign In / Google button only when actually logged out
- **OAuth return** adopted in the same boot path (no parallel flash)
- Stale overlapping dashboard renders and network blips no longer bounce a valid session onto Sign In

Local OBS docks are unchanged. See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full detail.
