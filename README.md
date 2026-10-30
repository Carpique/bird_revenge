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
| Flap / fly up | flap both arms (faster, bigger = more lift); right after the last flap the bird falls gently at first | ↑ |
| Hover | spread both arms out in a T, or raised into a V (up to ~45°), held still: the bird keeps its altitude; lowering both arms evenly below horizontal lets it sink, faster the lower they go (free fall at ~60° down) | Shift |
| Fly sideways | tilt the arms (one hand lower than the other): the bird flies sideways towards the lower hand, faster the more you tilt; arms held out (a tilted T) keep its altitude, flapping tilted climbs (a little slower than flapping level) | ← → |
| Poo | shoot: raise either leg sideways (the poo drops straight down) | ↓ |

The controls above are the default (flapping mode). **Pointing control** is the alternative: untick "Flapping (off: pointing)" in the tuning panel (**G**, section *pointing*). It replaces flapping, tilt and hover (pooping stays the same), and the arms work like this:

| Arms | Bird |
|---|---|
| both hanging down | no force: rests, or falls freely with its momentum fading |
| both straight, pointing the same way | flies that way at a fixed cruising speed (almost any direction, up, sideways, diagonally, down) |
| spread out in a T (a sloppy T, slightly raised or drooping, counts) | hovers in place |
| a tilted T (one hand clearly lower) | moves slowly sideways towards the lower hand, keeping its altitude: for precise positioning |

Hotkeys: **D** debug panel · **G** tuning panel · **Esc** keyboard-only mode · **C** recalibrate ·
**Space** / **P** pause in game (also automatic when the window loses focus; camera and pose tracking are switched off while paused or unfocused) · **R** start/stop recording landmarks to a JSON file.

## Tuning

Press **G** for live sliders over everything in `src/config.ts` (flap gains, tilt and hover feel, shoot thresholds,
visibility timing, physics). "save" stores your values in this browser; "copy changes as JSON" copies only the values that differ from the defaults, to
paste into `src/config.ts` to make them the defaults.

Press **D** to see the camera skeleton, a 5-second plot of arm angles / lift / shoot hip angle, and
the raw numbers the detectors use.

## Art

Placeholder art is generated with Rough.js: `npm run art` writes SVGs into `public/assets/`.
To use real drawings, replace those files (SVG or PNG) and/or edit the paths in:

- `src/characters/bird.ts` — idle frame, flap frames (ordered wings **down → up**), squash amounts
- `src/characters/villain.ts` — walk cycle, hit frame, hitbox
- `src/characters/poo.ts` — falling and splat frames
- `src/characters/friend.ts` — the friends to save (the bunny: idle, blink and ear-twitch frames; how often they fidget)
- `src/characters/coin.ts` — the spinning coin (credits in `public/assets/coin/CREDITS.md`)
- `src/scenery/scenery.ts` — sky colour, sun, clouds, ground

## Levels

Levels are [Tiled](https://www.mapeditor.org/) maps in `src/levels/` (`*.tmj`). Open `src/levels/bird-revenge.tiled-project`
in Tiled first: it defines the object classes the game understands (Terrain, Body, Branch, Rope, Hinge, Villain, Friend, Coin, BirdStart, Button —
see `src/level/tiled.ts`). Saving all the Friends (points, standing on the ground or a shelf) completes a level; the
numbered levels (`001.tmj`, `002.tmj`, …) are played in number order, round and round; `training.tmj` is the
base of the title screen's "Training": it is played once per letter, `training-A` to `training-Z` (A to Z and round, until quit
from the Esc menu), each with its letter spelled in coins (`src/level/letters.ts`) and completed by collecting them all. Coins are extra points, counted next to the score: place them
from the `coin` tileset (`coin.tsj`, in the Project view) with the Insert Tile tool (T) on an object layer, and they show
as coins in Tiled too; a point of class Coin works as well (its centre). To test a level, open `?level=<file name>` (without `.tmj`): it
skips the start screen and plays only that level, again each time it's completed. With `npm run dev` running, saving a map swaps it into the running game. A new numbered map shows up in the level select by itself; `npm run build` draws the levels' thumbnails with headless Chrome (once after `npm install`: `npx puppeteer browsers install chrome-headless-shell`).

## Tests

```bash
npm test
```

Gesture detectors are tested on synthetic poses (`tests/synthetic.ts`), no camera needed.
