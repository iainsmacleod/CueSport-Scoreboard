# Publishing

Wiki source files live in the main repository under [`docs/wiki/`](https://github.com/iainsmacleod/CueSport-Scoreboard/tree/main/docs/wiki). The live GitHub Wiki is a **separate git repo** attached to the project.

## Page map

| File | Wiki page title |
|------|-----------------|
| `Home.md` | Home |
| `_Sidebar.md` | _Sidebar (auto nav) |
| `Getting-Started-OBS.md` | Getting-Started-OBS |
| `Control-Panel.md` | Control-Panel |
| `Scoring-and-Game-Types.md` | Scoring-and-Game-Types |
| `Player-Statistics.md` | Player-Statistics |
| `Instant-Replay.md` | Instant-Replay |
| `Shot-Clock-and-Hotkeys.md` | Shot-Clock-and-Hotkeys |
| `Multiple-Tables.md` | Multiple-Tables |
| `Cloud-Overview.md` | Cloud-Overview |
| `Cloud-Hosted-Setup.md` | Cloud-Hosted-Setup |
| `Cloud-Self-Hosted-Setup.md` | Cloud-Self-Hosted-Setup |
| `Cloud-Dashboard-Mobile-Guests.md` | Cloud-Dashboard-Mobile-Guests |
| `Stream-Promotion.md` | Stream-Promotion |
| `Troubleshooting.md` | Troubleshooting |
| `Publishing.md` | Publishing |

GitHub Wiki links omit the `.md` extension (e.g. `[Control Panel](Control-Panel)`).

## Push to the GitHub Wiki

1. Enable the Wiki on the GitHub repo settings if it is not already on.
2. Clone the wiki repo (sibling of the main clone is fine):

```bash
git clone https://github.com/iainsmacleod/CueSport-Scoreboard.wiki.git
```

3. Copy (or sync) files from `docs/wiki/` into the wiki clone. Keep names identical so links resolve.
4. Commit and push:

```bash
cd CueSport-Scoreboard.wiki
git add .
git commit -m "Update wiki from docs/wiki"
git push origin master
```

(Some wiki remotes use `main` — check `git branch -a`.)

## Editing workflow

Prefer editing **`docs/wiki/` in the main repo** so docs stay versioned with the product, then sync to the wiki when you publish a release. Avoid long-lived divergence between the two.

Optional: a small script or CI job can rsync `docs/wiki/*.md` into the wiki repository on release tags.

## Images

This draft set is text-first. To add screenshots later, commit PNGs under the wiki repo (or link to images already in the main repo via raw.githubusercontent.com URLs), and reference them with standard Markdown image syntax.
