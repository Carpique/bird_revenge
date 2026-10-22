# Bird Revenge

A browser game controlled by your body: flap your arms to fly, raise a leg sideways (the "shoot" pose) to drop a poo on the villain.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Run

```bash
npm install      # also copies MediaPipe's WASM runtime into public/mediapipe/
npm run dev      # opens http://localhost:5173
```

The camera needs `localhost` or `https`. Stand back so at least your torso down to the hips and
your arms are visible, raised ones included, down to the elbows plus a bit of the forearms; the hands and legs may be cut off.

## Controls

| Action | Body | Keyboard |
|---|---|---|
| Flap / fly up | flap both arms (faster, bigger = more lift) | ↑ |
| Fly sideways | flap one arm, or one faster than the other | ← → |
| Glide (parachute) | spread both arms out in a T, held still: the bird sinks slowly, sideways speed fades | Shift |
| Dive | tilt the spread arms (one hand down, the other up): the bird dives towards the lower hand, faster the more you tilt | Shift + ← → |
| Poo | shoot: raise a leg sideways (the poo flies towards that side) | ↓ |

**Posture control** is the default and replaces flapping and the glide; turn it off with "Posture control" in the tuning panel (**G**) to get the flapping controls in the table above. The arms work like this:

| Arms | Bird |
|---|---|
| both up | flies straight up, faster the higher they are |
| one up, the other level | flies sideways towards the level arm; the raised arm sets the speed |
| one up, the other in between | flies diagonally, more upwards as the arms get closer in height |
| one up, the other below level | loses lift and dives towards the lower arm, steeper the lower it is; the raised arm still sets the speed |
| both level (a T) | parachute: slow sink |
| both down | free fall; sideways and upward speed fade |

Hotkeys: **D** debug panel · **G** tuning panel · **Esc** keyboard-only mode · **C** recalibrate ·
**Space** / **P** pause in game (also automatic when the window loses focus; camera and pose tracking are switched off while paused or unfocused) · **R** start/stop recording landmarks to a JSON file.

## Tuning

Press **G** for live sliders over everything in `src/config.ts` (flap gains, glide/dive feel, shoot thresholds,
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
