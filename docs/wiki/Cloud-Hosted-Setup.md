# Cloud Hosted Setup

Use the managed service at **[cuesport.macleod.systems](https://cuesport.macleod.systems)** so you do not run a backend yourself.

## Before you start

1. Install the OBS control panel and browser source — [Getting Started with OBS](Getting-Started-OBS).
2. Have a Google account ready for sign-in.
3. Know which plan you need (Dock Keys for OBS tables; ad-hoc for dockless scoring seats):

| Plan | Dock keys | Ad-hoc tables | Notes |
|------|-----------|---------------|-------|
| **Streamer** | 2 | 2 | Card-required free trial, then monthly |
| **Tournament Organizer** | 5 | 5 | Bills immediately |
| **League Director** | 10 | 10 | Bills immediately |
| **Network Organization** | 25 | 25 | Contact only |

Caps also include mobile + guest connections per table (see the dashboard billing UI for current limits).

## 1. Create your account

1. Open [cuesport.macleod.systems/dashboard](https://cuesport.macleod.systems/dashboard).
2. Sign in with **Google**.
3. New accounts start inactive until you choose a plan (or receive complimentary access from support).
4. Complete Stripe Checkout for your plan and accept the Terms / Privacy when prompted.
5. Manage payment and cancellation later via **Account** → Stripe Customer Portal.

## 2. Create an OBS Dock Key

1. In the dashboard, open **Settings** (or the first-table onboarding guide).
2. Create a named **OBS Dock Key** for this table (e.g. `Main table`).
3. Pick a role:
   - **Administrator** — full match/player edit; guest link create
   - **Trusted Operator** — edit/delete only matches this key recorded; guest link create
   - **Operator** — write matches; cannot edit/delete history; cannot create extra guest links
4. Copy the key once — treat it like a password.

Create one key per table or operator seat. Each key may connect only one dock at a time.

## 3. Connect the OBS dock

1. Open the CueSport dock → **Settings**.
2. Find **CueSport Scoreboard Cloud** → click ⚙ **Connection settings**.
3. Stay on the managed / hosted pane (not Self-hosting).
4. Paste the **OBS Dock Key** → **Save & Connect** (or Save, then enable the Cloud toggle).
5. Status should move from Off → connecting → connected.

The dashboard **Tables** tab shows a live card when the dock is online.

## 4. Score from a phone

1. From the dashboard table card, open mobile control (`/m/{room_id}`), or use the link from onboarding.
2. Sign in with the same Google account if prompted.
3. Score as you would on the dock — commands relay to OBS.

Optional: create **guest links** for helpers — see [Cloud Dashboard, Mobile & Guests](Cloud-Dashboard-Mobile-Guests).

## 5. Optional extras

- [Stream Promotion](Stream-Promotion) — appear on the public Live Streams page
- [Instant Replay](Instant-Replay) — still local OBS WebSocket; Cloud is separate
- Cloud **Stats** tab — leaderboard, recent matches, Kill unfinished matches

## Account controls

Under dashboard **Account**:

- Subscription / billing portal
- Manage sessions (sign out other devices)
- Sign out
- Account deletion (warns if an active Stripe subscription will be cancelled)

## Related

- [Cloud Overview](Cloud-Overview)
- [Cloud Self-Hosted Setup](Cloud-Self-Hosted-Setup) — run your own server instead
- [Troubleshooting](Troubleshooting)
