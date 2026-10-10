# Pooping Birds

A browser game controlled by your body: flap your arms to fly, squat to drop a poo on the villain.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Run

```bash
npm install      # also copies MediaPipe's WASM runtime into public/mediapipe/
npm run dev      # opens http://localhost:5173
```

The camera needs `localhost` or `https`. Stand back so your whole body (hands raised included)
is visible, about 2–3 m from the camera.

## Controls

| Action | Body | Keyboard |
|---|---|---|
| Flap / fly up | flap both arms (faster, bigger = more lift) | Space or ↑ |
| Steer | flap one arm harder than the other | ← → |
| Poo | squat | ↓ |

Hotkeys: **D** debug panel · **G** tuning panel · **K** keyboard-only mode · **C** recalibrate ·
**P** pause · **R** start/stop recording landmarks to a JSON file.

## Tuning

Press **G** for live sliders over everything in `src/config.ts` (flap gains, squat thresholds,
visibility timing, physics). "save" stores your values in this browser; "copy as JSON" lets you
paste them into `src/config.ts` to make them the defaults.

Press **D** to see the camera skeleton, a 5-second plot of arm angles / lift / squat depth, and
the raw numbers the detectors use.

## Art

Placeholder art is generated with Rough.js: `npm run art` writes SVGs into `public/assets/`.
To use real drawings, replace those files (SVG or PNG) and/or edit the paths in:

- `src/characters/bird.ts` — idle frame, flap frames (ordered wings **down → up**), squash amounts
- `src/characters/villain.ts` — walk cycle, hit frame, hitbox
- `src/characters/poo.ts` — falling and splat frames
- `src/scenery/scenery.ts` — sky colour, sun, clouds, ground

## Tests

```bash
npm test
```

Gesture detectors are tested on synthetic poses (`tests/synthetic.ts`), no camera needed.
