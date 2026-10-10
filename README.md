# Bird Revenge

A browser game controlled by your body: flap your arms to fly, raise a leg sideways (the "shoot" pose) to drop a poo on the villain.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Run

```bash
npm install      # also copies MediaPipe's WASM runtime into public/mediapipe/
npm run dev      # opens http://localhost:5173
```

The camera needs `localhost` or `https`. Stand back so at least your torso down to the hips and
your arms (hands raised included) are visible; the legs may be cut off.

## Controls

| Action | Body | Keyboard |
|---|---|---|
| Flap / fly up | flap both arms (faster, bigger = more lift) | ↑ |
| Steer | flap one arm harder than the other | ← → |
| Poo | shoot: raise a leg sideways (the poo flies towards that side) | ↓ |

Hotkeys: **D** debug panel · **G** tuning panel · **K** keyboard-only mode · **C** recalibrate ·
**Space** / **P** pause in game (also automatic when the window loses focus; camera and pose tracking are switched off while paused or unfocused) · **R** start/stop recording landmarks to a JSON file.

## Tuning

Press **G** for live sliders over everything in `src/config.ts` (flap gains, shoot thresholds,
visibility timing, physics). "save" stores your values in this browser; "copy as JSON" lets you
paste them into `src/config.ts` to make them the defaults.

Press **D** to see the camera skeleton, a 5-second plot of arm angles / lift / shoot hip angle, and
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
