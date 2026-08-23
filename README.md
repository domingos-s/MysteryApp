# HEIST//SHIFT

A fast, mobile-first memory and reflex game packaged as an installable Progressive Web App.

## The game

You are cracking a nine-node vault while a trace closes in. Watch the cyan sequence, then reproduce it before time expires. Every few rounds the protocol mutates:

- **STANDARD** — repeat the sequence normally.
- **REVERSE** — enter the sequence backwards.
- **MIRROR** — tap the horizontally mirrored positions.
- **DECOYS** — ignore pink noise flashes and remember cyan only.

Faster clears earn larger bonuses. Consecutive clears raise the combo multiplier. A wrong node or expired trace ends the run.

## PWA features

- Works offline after the first successful load.
- Installable on supported browsers/devices.
- Mobile-first, one-thumb layout with safe-area support.
- Synthesized WebAudio sound effects; no external media dependencies.
- Haptic feedback where supported.
- Local high score and best round via `localStorage`.
- Native share sheet with clipboard fallback.
- Reduced-motion accessibility support.

## Run locally

Serve the repository over HTTP (service workers do not work from `file://`). For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy

The included GitHub Actions workflow deploys the static app to GitHub Pages whenever changes land on `main`. If GitHub Pages has never been enabled for the repository, set **Settings → Pages → Source** to **GitHub Actions** once.
