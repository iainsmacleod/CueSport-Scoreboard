# Release notes

This folder holds **versioned release notes** and tooling to **capture control-panel screenshots** for GitHub releases.

Screenshots in `<version>/images/` are **committed** — they are referenced by `RELEASE_NOTES.md` on GitHub. Regenerate and commit them when the UI changes.

## Layout

```
docs/release-notes/
  README.md                 ← this file
  capture-screenshots.mjs   ← Playwright screenshot script
  package.json              ← playwright for capture script
  create-release.ps1        ← draft GitHub release helper
  <version>/
    RELEASE_NOTES.md        ← full notes (markdown; images relative to this folder)
    GITHUB_RELEASE_DRAFT.md ← shorter body for GitHub Releases UI / `gh release create`
    images/                 ← PNG screenshots (committed)
```

## Capture screenshots

From `docs/release-notes/` (self-contained for **8.2.0+**; no separate static server required):

```bash
cd docs/release-notes
npm install
npx playwright install chromium
node capture-screenshots.mjs --version 8.3.5
git add 8.3.5/images/
git commit -m "Update 8.3.5 release note screenshots"
```

For **7.x** captures, also serve the repo root on port 8765:

```bash
# repo root
python -m http.server 8765
```

Optional live Cloud backend for 8.2.0+:

```bash
node capture-screenshots.mjs --version 8.3.5 --cloud http://localhost:4003
```

Output: `docs/release-notes/<version>/images/*.png`

## Publish a GitHub release (draft)

Requires [GitHub CLI](https://cli.github.com/) (`gh`) authenticated.

```powershell
.\docs\release-notes\create-release.ps1 -Version 8.3.5
```

Or manually:

```bash
gh release create v8.3.5 \
  --draft \
  --title "CueSport Scoreboard 8.3.5" \
  --notes-file docs/release-notes/8.3.5/GITHUB_RELEASE_DRAFT.md
```

Screenshots in the repo render in `RELEASE_NOTES.md` on GitHub. Optionally upload the same PNGs as release assets for the Releases page gallery.

## Adding a new version

1. Create `docs/release-notes/<version>/` with `RELEASE_NOTES.md` and `GITHUB_RELEASE_DRAFT.md`.
2. Run `capture-screenshots.mjs --version <version>` and commit the `images/` folder.
3. Extend `capture-screenshots.mjs` if new screens are needed.
4. Bump `versionNum` in `control_panel.html` and `README.md`.
