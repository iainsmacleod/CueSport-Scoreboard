# README screenshots

Images for the root [`README.md`](../../README.md) live in [`images/`](images/).

## Regenerate

```bash
cd docs/readme
npm install
npx playwright install chromium
npm run capture
```

The capture script starts its own temporary static servers (control panel + mock cloud API), so you do not need Docker or `python -m http.server` for a basic refresh.

For **live** cloud UI against a running backend:

```bash
node capture-screenshots.mjs --cloud http://localhost:4003
```

Output files:

| File | Content |
|------|---------|
| `01-control-panel-setup.png` | Setup tab |
| `02-control-panel-controls.png` | Controls tab (ball scoring) |
| `03-control-panel-cloud.png` | Replay/Share + CueSport Cloud |
| `04-cloud-dashboard.png` | Cloud dashboard (Tables) |
| `05-cloud-mobile-control.png` | Mobile remote control |
