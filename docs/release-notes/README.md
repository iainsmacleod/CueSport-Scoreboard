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

From the **repository root**:

```bash
python -m http.server 8765
```

In another terminal:

```bash
cd docs/release-notes
npm install
node capture-screenshots.mjs --version 8.0.0
git add 8.0.0/images/
git commit -m "Update 8.0.0 release note screenshots"
```

Output: `docs/release-notes/<version>/images/*.png`

## Publish a GitHub release (draft)

Requires [GitHub CLI](https://cli.github.com/) (`gh`) authenticated.

```powershell
.\docs\release-notes\create-release.ps1 -Version 8.0.0
```

Or manually:

```bash
gh release create v7.2.0 \
  --draft \
  --title "CueSport Scoreboard 7.2.0" \
  --notes-file docs/release-notes/7.2.0/GITHUB_RELEASE_DRAFT.md
```

Screenshots in the repo render in `RELEASE_NOTES.md` on GitHub. Optionally upload the same PNGs as release assets for the Releases page gallery.

## Adding a new version

1. Create `docs/release-notes/<version>/` with `RELEASE_NOTES.md` and `GITHUB_RELEASE_DRAFT.md`.
2. Run `capture-screenshots.mjs --version <version>` and commit the `images/` folder.
3. Extend `capture-screenshots.mjs` if new screens are needed.
4. Bump `versionNum` in `control_panel.html` and `README.md`.
