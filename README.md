# Bird Revenge

A browser game controlled by your body: point your arms to fly (or flap them, in flapping mode), raise a leg sideways (the "shoot" pose) to drop a poo on the villain.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Run

```bash
npm install      # also copies MediaPipe's WASM runtime into public/mediapipe/
npm run dev      # opens http://localhost:5173
```

The camera needs `localhost` or `https`. Stand back so at least your torso down to the hips and
your arms are visible, raised ones included, down to the elbows plus a bit of the forearms; the hands and legs may be cut off.

## Controls

By default the arms steer the bird by **pointing** (directions as seen on screen, shoulder → wrist):

| Arms | Bird |
|---|---|
| both hanging down | no force: rests, or falls freely with its momentum fading |
| both straight, pointing the same way | flies that way at a fixed cruising speed (almost any direction, up, sideways, diagonally, down) |
| both raised in a V (each at least ~15° above level, too high for a T) | flies up at the cruising speed; a lopsided V flies up and towards the lower arm (switch off: tuning panel **G**, *pointing* → vUp) |
| spread out in a T (a sloppy T, slightly raised or drooping, counts) | hovers in place |
| a tilted T (one hand clearly lower) | moves slowly sideways towards the lower hand, keeping its altitude: for precise positioning |
| a tilted T with both arms lowered (on average ~20° or more below level) | descends diagonally towards the lower hand, steeper the lower the arms (switch off: tuning panel **G**, *pointing* → descend) |
| a leg raised sideways (the shoot pose) | poos (the poo drops straight down) |

**Continuous steering** is an alternative way of pointing, off by default, for trying out in play: tuning panel **G**, *pointing* → continuous. There are no poses to match: the arms always ask for a velocity, and only both hanging down lets the bird fall. The more the two arms point the same way, the more the bird flies where they point together (parallel arms at the cruising speed, as above); a T hovers, a tilted T drifts towards the lower hand and descends when lowered, as above. With the arms spread out to their sides the bird always moves sideways towards the lower hand: a lopsided V climbs that way, a lowered tilted T descends diagonally that way, however low. In between the speed follows the arms: a V climbs, faster the higher the arms; arms low and apart descend; one arm hanging and the other held level flies diagonally down, and the other raised hovers.

**Flapping mode** is the alternative: tick "Flapping (off: pointing)" in the tuning panel (**G**, section *pointing*). It replaces pointing with flapping, tilt and hover (pooping stays the same). The keyboard works the same in both modes:

| Action | Body (flapping mode) | Keyboard |
|---|---|---|
| Flap / fly up | flap both arms (faster, bigger = more lift); right after the last flap the bird falls gently at first | ↑ |
| Hover | spread both arms out in a T, or raised into a V (up to ~45°), held still: the bird keeps its altitude; lowering both arms evenly below horizontal lets it sink, faster the lower they go (free fall at ~60° down) | Shift |
| Fly sideways | tilt the arms (one hand lower than the other): the bird flies sideways towards the lower hand, faster the more you tilt; arms held out (a tilted T) keep its altitude, flapping tilted climbs (a little slower than flapping level) | ← → |
| Poo | shoot: raise either leg sideways (the poo drops straight down) | ↓ |

Hotkeys: **D** debug panel · **G** tuning panel · **Esc** keyboard-only mode · **C** recalibrate ·
**Space** / **P** pause in game (also automatic when the window loses focus; camera and pose tracking are switched off while paused or unfocused) · **R** start/stop recording landmarks to a JSON file.
**B** save the black box: the last 60 s (by time, whatever the frame rate) of MediaPipe's raw landmarks (before smoothing, with visibility, depth z and empty frames) plus the game state per frame, what the pose made of it (the pointing intent the bird was given, the bird's position and velocity, camera frames dropped and long render frames before the frame) and the calibrations (the shoot baseline), so a replay smooths, stands in for hidden arms and shoots as the game did, as `black-box-<time>.json` in the downloads. It stays on the device and is a pose recording the replay tests load directly (`parseBlackBox` in `src/pose/blackBox.ts`, `tests/replay/`; `blackBoxEffect` reads the intent and the bird back, see `tests/replay/recordings/README.md`). The debug panel (**D**) also shows local tracking telemetry: the processed frame rate next to the camera's own (they differ: frames arriving while the main thread runs inference are never seen), camera frames dropped (share over the last 10 s and over the session; without frame metadata the panel says drops cannot be seen), where the frame time comes from (`capture` / `media` / `callback`) and the median capture latency, render frames longer than `telemetry.longRenderMs` (25 ms), inference time (p50 / p95), runs of frames without a person, hitches, recalibrations and out-of-frame episodes by cause, the model and delegate (and whether the GPU one fell back to CPU).

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
- `src/characters/villain.ts` — walk cycle, hit frame, hitbox; the ghost (the villain's other look)
- `src/characters/bat.ts` — wingbeat, hit frame, hitbox
- `src/characters/poo.ts` — falling and splat frames (the bat's poo uses them too, smaller)
- `src/characters/friend.ts` — the friends to save (the bunny: idle, blink and ear-twitch frames; how often they fidget)
- `src/characters/coin.ts` — the spinning coin (credits in `public/assets/coin/CREDITS.md`)
- `src/scenery/scenery.ts` — sky colour, sun, clouds, ground

## Levels

Levels are [Tiled](https://www.mapeditor.org/) maps in `src/levels/` (`*.tmj`). Open `src/levels/bird-revenge.tiled-project`
in Tiled first: it defines the object classes the game understands (Terrain, Body, Branch, Rope, Hinge, Villain, Bat, Friend, Coin, BirdStart, Button —
see `src/level/tiled.ts`). Saving all the Friends (standing on the ground or a shelf) completes a level; the
numbered levels (`001.tmj`, `002.tmj`, …) are played in number order, round and round; `training.tmj` is the
base of the title screen's "Training": it is played once per letter, `training-A` to `training-Z` (A to Z and round, until quit
from the Esc menu), each with its letter spelled in coins (`src/level/letters.ts`) and completed by collecting them all. Coins are extra points, counted next to the score: place them
from the `icons` tileset (`icons.tsj`, in the Project view) with the Insert Tile tool (T) on an object layer, and they show
as coins in Tiled too; a point of class Coin works as well (its centre). The actors — Villain, Bat, Friend (bunny) and the
bird's start — come from the same tileset and show as their sprites, placed by their feet (villain, bunny)
or where they are drawn (bat, bird). A villain or bat also needs its `path` property set to a polyline without a class (a bat's can be a
polygon, flown round and round): the villain walks its x range, the bat flies it from the point nearest the icon. A villain's `kind` is his look: `villain`, or `ghost` (the ghost tile), which throws glue instead of apples. A bat without a `path` is a homing bat:
once it sees the bird (no terrain in between) it goes for it at its `speed`, round the level's bodies and keeping apart
from the other bats; till then it flutters about where it was placed. Its icons are drawn from the
sprites by `npm run tiled-icons` (redo it after changing an actor's art or size). To test a level, open `?level=<file name>` (without `.tmj`): it
skips the start screen and plays only that level, again each time it's completed. With `npm run dev` running, saving a map swaps it into the running game. A new numbered map shows up in the level select by itself; `npm run build` draws the levels' thumbnails with headless Chrome (once after `npm install`: `npx puppeteer browsers install chrome-headless-shell`).

## Tests

```bash
npm test
```

Gesture detectors are tested on synthetic poses (`tests/synthetic.ts`), no camera needed. `tests/replay/` replays recorded pose
sessions (the tutorial's, and any put in `tests/replay/recordings/`) through the real tracking pipeline and the game's rules on the
pose stream (`src/input/poseSession.ts`), with perturbations (lost frames, hitches, low visibility, jitter, ...), and pins what the
game does: `npx vitest run tests/replay/metrics.test.ts` prints the numbers for comparing before / after a change in tracking.
Deploys run the tests and the type check first (`.github/workflows/deploy.yml`).
