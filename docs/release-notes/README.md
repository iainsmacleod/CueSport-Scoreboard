# Release notes

This folder holds **versioned release notes** and tooling to **capture control-panel screenshots** for GitHub releases.

Generated screenshots are **not** committed (see `.gitignore`). Regenerate them before publishing a release.

## Layout

```
docs/release-notes/
  README.md                 ← this file
  capture-screenshots.mjs   ← Playwright screenshot script
  package.json              ← optional: playwright for capture script
  <version>/
    RELEASE_NOTES.md        ← full notes (markdown, images relative to this folder)
    GITHUB_RELEASE_DRAFT.md ← shorter body for GitHub Releases UI / `gh release create`
    images/                 ← generated PNGs (gitignored)
      .gitkeep
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
node capture-screenshots.mjs --version 7.2.0
```

Output: `docs/release-notes/<version>/images/*.png`

## Publish a GitHub release (draft)

Requires [GitHub CLI](https://cli.github.com/) (`gh`) authenticated.

```bash
cd docs/release-notes
node capture-screenshots.mjs --version 7.2.0

gh release create v7.2.0 \
  --draft \
  --title "CueSport Scoreboard 7.2.0" \
  --notes-file 7.2.0/GITHUB_RELEASE_DRAFT.md

# Optional: attach screenshots to the release
gh release upload v7.2.0 7.2.0/images/*.png
```

Edit `7.2.0/GITHUB_RELEASE_DRAFT.md` before publishing. Copy `RELEASE_NOTES.md` for the wiki or full changelog link.

## Adding a new version

1. Create `docs/release-notes/<version>/` with `RELEASE_NOTES.md`, `GITHUB_RELEASE_DRAFT.md`, and `images/.gitkeep`.
2. Extend `capture-screenshots.mjs` if new screens are needed.
3. Bump `versionNum` in `control_panel.html` and `README.md`.
