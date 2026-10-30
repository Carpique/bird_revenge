# Bird Revenge — Architecture & Requirements

> Living document. Status markers: **[DECIDED]**, **[PROPOSED]** (recommended, awaiting sign-off), **[OPEN]** (needs discussion).

## 1. Game concept

- **Single-player**, runs entirely **in the browser**.
- The player controls a **bird** with their body, tracked by the webcam.
- **Default state:** the bird rests on the ground.
- **Flapping arms** → the bird flaps its wings and rises a bit. **Continuous flapping** keeps pushing it upward; stopping lets it fall (gravity).
- **Hovering:** arms spread out in a T and held still → the bird keeps its altitude; both arms lowered evenly → it sinks, faster the lower they are.
- **Sideways movement** comes from **tilting the arms** (one hand lower than the other): the bird flies horizontally towards the lower hand, faster the more they're tilted — in the hover (a tilted T, keeping its altitude) and while flapping, which then climbs a little slower than flapping level. The tilt only steers: up and down come from flapping and the arms' height, the same rules level or tilted. No diving.
- **"Shoot" gesture** (a leg raised sideways) → the bird **drops a poo**.
- **Targets** walk along the bottom of the screen:
  - **Pedestrians** — hitting one scores **negative** points.
  - **Villains** — hitting one scores **positive** points.

## 2. Requirements

### 2.1 Functional
| ID | Requirement | Status |
|----|-------------|--------|
| F1 | Webcam-based pose tracking controls the bird; no keyboard/mouse needed during play | [DECIDED] |
| F2 | Flap detection: the downstroke speed of both arms (averaged) lifts the bird; flapping only lifts, it never pushes sideways | [DECIDED] |
| F3 | Shoot detection (leg raised sideways, read from the hip angles) triggers a poo drop (discrete event) | [DECIDED] |
| F4 | Walking pedestrians and villains with distinct scoring | [DECIDED] |
| F5 | Short calibration step at game start: stand in the outline with arms lowered, hold still ~1 s; records the standing hip angles | [DECIDED] (v0.1) |
| F7 | Player must be **in frame**: at minimum torso (shoulders to hips) and both arms, raised included, as far as the elbows plus the first ~20% of the forearms (the hands may leave the frame); head and legs are optional. A visibility monitor runs continuously and shows a "get back in frame" overlay when a required part is lost (see §4.5) | [DECIDED] |
| F8 | The game keeps running while the out-of-frame box is shown, but pose controls are cut off (the bird drops), so the player has an incentive to get back quickly; controls return as soon as the pose is reacquired | [DECIDED] |
| F6 | Keyboard fallback controls for development/testing (↑ flap, ←/→ fly sideways, Shift hover, ↓ poo; Space/P pause; K = keyboard-only mode) | [DECIDED] (v0.1) |
| F12 | **Hover and tilt** (alongside flapping, F2; together the default, the alternative being pointing control, F13): both arms spread out (a T, or raised into a V up to ~45° above horizontal; level or tilted) and held still → hover: in the air the bird keeps its altitude. **Tilting** the arms (one hand lower than the other, as seen on screen) → the bird flies horizontally towards the lower hand, its speed proportional to the tilt; up and down are left to flapping and the hover (flapping tilted puts `sideLift`, 0.75, of its lift into the climb). Replaces the earlier side-flapping (one arm / unequal flapping), the dive along a tilted glide, both removed | [DECIDED] |
| F13 | **Pointing control** (the alternative to F2 + F12, which are the default; untick "Flapping (off: pointing)" in the tuning panel): both arms hanging down → no force, the bird rests or falls freely; both arms straight and parallel → the bird flies where they point (almost 360°) at a fixed cruising speed; a T (generous leeway: slightly raised, drooping or bent) → hover in place; a tilted T → slow sideways drift towards the lower hand, a fixed low speed, for precise positioning. Pooping as in F3. Replaces the earlier posture control (arm angles setting speed and direction separately) | [PROPOSED] |
| F9 | Sound | [DEFERRED] |
| F10 | The player has 3 lives; touching a walking villain costs one: the bird hops and falls off the screen turned on its side (the lost heart blinks meanwhile), then a new bird drops in from the top, blinking and unhurtable for ~2 s. After the last life the "Game Over" sign drops from the top, then a new game starts (countdown, or straight away in keyboard mode) | [DECIDED] |
| F11 | A villain hit by a poo is knocked off the screen arcade style: a short hop, then a parabolic fall past the bottom edge, growing a little as if flying towards the camera, gone for good | [DECIDED] |

### 2.2 Non-functional
| ID | Requirement | Status |
|----|-------------|--------|
| N1 | Runs in a modern desktop browser (Chrome first; Firefox/Safari best-effort) | [PROPOSED] |
| N2 | All processing on-device; no video leaves the browser | [PROPOSED] |
| N3 | Motion-to-action latency low enough to feel responsive (target < ~150 ms for flap response) | [PROPOSED] |
| N4 | Pose tracking ≥ 25–30 fps on a typical laptop | [PROPOSED] |
| N5 | Hand-drawn art assets | [DECIDED] |

## 3. Technology stack

| Area | Choice | Status |
|------|--------|--------|
| Pose tracking | Google **MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision`), 33 body landmarks incl. 3D "world" landmarks, VIDEO/LIVE_STREAM mode, `numPoses: 1` | [DECIDED] (model variant lite/full/heavy: [OPEN]) |
| Language / build | TypeScript + Vite | [DECIDED] |
| Rendering / game loop | **PixiJS** (v8). The prototype uses a plain Vite setup with a small state machine instead of the `create pixi.js` Creation Template; adopt the template's pieces (PixiJS Sound, AssetPack, screen manager) when sound and more screens arrive | [DECIDED] |
| Physics | **Matter.js** — gravity, flap forces, air drag, collision events (poo ↔ walkers, bird ↔ ground). Fixed 60 Hz simulation decoupled from rendering | [DECIDED] |
| Overlays & tooling | Camera/outline guide and debug panel on separate HTML 2D canvases (Rough.js for the sketchy outline), tuning panel with **lil-gui** — kept outside PixiJS so pose tooling is independent of the game renderer | [DECIDED] (v0.1) |
| Tests | Vitest, gesture detectors tested on synthetic poses | [DECIDED] |
| Gesture recognition | **Heuristics first** (flap and shoot); ML classifier only if the shoot heuristic proves unreliable (see §4) | [DECIDED] |
| ML runtime (if needed) | TensorFlow.js or ONNX Runtime Web | [OPEN] |
| Pose inference thread | Main thread first; move to a Web Worker if it hurts frame rate | [OPEN] |

### 3.1 Rationale: PixiJS + Matter.js
- Phaser was the alternative (full game framework with built-in scenes and arcade physics). PixiJS chosen because:
  - smaller, native TypeScript, and we keep **control of the game loop** — pose results arrive asynchronously from MediaPipe, independent of render frames;
  - the debug overlay (skeleton, live feature plots) is just more PixiJS drawing;
  - the official Creation Template covers the plumbing Phaser would give us (screens, sound, asset loading, UI);
  - widely used for games.
- Physics via a library rather than hand-rolled, so we don't reimplement integration and collision detection:
  - **Matter.js** [DECIDED]: the most common 2D physics library in JS, simple API, frequently paired with PixiJS. Bodies sync to sprites in a few lines each frame.
  - Alternatives considered: **Rapier 2D** (modern, Rust/WASM, fast, maintained; heavier than we need), **Planck.js** (Box2D port; more verbose), **detect-collisions** (collision only, no dynamics).
- Game-feel settings for Matter.js: bird body with `inertia: Infinity` (doesn't tumble), `restitution: 0` (no bouncing), `frictionAir` for drag; poo as a small dynamic body; walkers as **sensor** bodies (detect hits without physical pushing); scoring from `collisionStart` events.
- Flap control maps onto physics as **forces/impulses**: each detected downstroke applies a force (scaled by stroke strength), split into lift and a sideways push by how equally the two arms flap. Tuning of these constants is ours — that's the "feel" of the game.

## 4. Gesture recognition (key risk — tackle first)

### 4.1 Pipeline
```
webcam → MediaPipe Pose (≈30 fps) → landmark smoothing → feature extraction
       → gesture detectors (flap L/R, shoot) → game control signals
```

### 4.2 The two gestures are different kinds of problems
- **Flapping is continuous control, not classification.** The game needs a per-arm signal every frame (how hard / how fast is each arm flapping right now), not a label after the fact.
  - Proposed approach: per arm, compute the **arm elevation angle** (shoulder→wrist vector relative to the torso axis). Track it as a time series; detect **downstrokes** (peak → trough with amplitude above a threshold). Each downstroke delivers an impulse of lift proportional to its amplitude/speed.
  - Each arm's downstroke power adds to the stroke force; each arm's recent effort (power averaged over ~0.7 s) decides how much of it goes up vs. sideways (§5).
  - This is cheap, low-latency (reacts mid-stroke), explainable and tunable — an ML classifier on fixed windows would add latency (must wait for the window) and is not needed for a periodic signal like this.
- **Shoot is a discrete event** (renamed from "squat" [DECIDED]: the gesture is now a leg raised sideways). Heuristic first [DECIDED]. Since the legs no longer have to be in frame (§4.5), it relies on the **hip angles** only:
  - **Hip abduction** per leg = angle of the thigh (hip → knee) away from the torso axis (shoulder centre → hip centre), signed so a leg swung out to its own side is positive. Measured against the torso, not the image vertical, so camera tilt and body sway during flapping cancel out.
  - Off-frame legs are still placed by MediaPipe (as straight legs), and a leg swung out already shows in the hips/upper thighs, so having the top of the hips in frame is enough.
  - Angles are taken relative to the standing baseline recorded at calibration (slowly re-learned while standing). Either leg past `angleEnter` (25°) fires; both back below `angleExit` (12°) leaves.
  - Which leg is raised doesn't matter [DECIDED]: the poo always drops straight down (an earlier version gave it sideways speed towards the raised leg; removed to keep the controls simple).
  - Fires once on entering the shoot; must return to standing (hysteresis) before it can fire again.
  - History: earlier versions used a squat depth (hips dropping towards the ankles), which needed the feet in view.
  - Fallback: ML classifier on a sliding window of normalised landmarks, only if the heuristic gives too many false positives (e.g. leaning sideways, walking, vigorous flapping).
- **Interference:** flapping vigorously moves the torso; shooting while flapping should probably still work. Detectors must be tested against each other's motions.

### 4.3 Normalisation (needed whichever approach wins)
- Express landmarks relative to the body (hip-centre origin, scaled by shoulder width or torso length) so detection is independent of distance from camera and player size.
- Mirror the camera view so the player's left arm controls the bird's left wing on screen.
- Light temporal smoothing (e.g. One-Euro filter) to remove jitter without adding much lag.
- Use landmark `visibility` to ignore low-confidence points.

### 4.4 Data collection & tooling
Even with heuristics we need recorded data: to tune thresholds, to test detectors offline, and as training data if ML is required.

- Existing tools considered:
  - **Teachable Machine (Pose)** — classifies static poses, not motion over time; not a fit for flapping, weak for shoot.
  - **MediaPipe Model Maker gesture recognizer** — hand gestures only; not applicable.
  - **Generic time-series labelling tools** (e.g. Label Studio, Edge Impulse data acquisition) — could label exported keypoint CSVs, but they add a round-trip outside our own pipeline.
- **Decision:** heuristics first for gestures [DECIDED]. **Pose Lab will be built anyway**, as a separate reusable project, because it is also needed for **pose capture for character animation** — see §9.
  - Meanwhile a lightweight debug overlay (skeleton + live feature values + detector events) in the dev build is enough to tune thresholds.
  - Cheap to add early anyway: a "record landmarks to JSON" button in the debug overlay, so that if Pose Lab is needed we already have recordings.
- **Pose Lab** (separate repo, §9) — an app which:
  1. Shows live camera + skeleton overlay + live plots of the derived features (arm angles, hip height, detector outputs).
  2. **Records sessions** as JSON: raw landmarks + timestamps (optionally the video for review).
  3. **Prompted recording** removes the segmentation problem: the page cues "flap now" / "shoot now" / "stand still" on a timer and stores each take already labelled and cut to a **fixed window length** (e.g. 1.5 s). Background "nothing happening" and "other movement" windows are recorded as negatives.
  4. **Free recording + replay** with keyboard labelling (press/hold a key while performing the gesture) for longer, natural sessions; windows are then sliced around the label marks.
  5. **Replays recordings through the detectors** so tuning and regression tests run without standing in front of the camera.
- Sample format (draft): `{ fps, landmarks: [frame][33][x,y,z,visibility], worldLandmarks: …, t: [ms], label, subject, notes }`.

### 4.5 Framing & visibility monitor
**Framing [DECIDED]:** at minimum the **torso (shoulders to hips) and both arms** are visible, including hands raised above the head during flapping. Head and legs are optional (relaxed from "head to feet": MediaPipe assumes straight legs when they are off-frame, and the shoot detector only needs the hip angles).

**Visibility estimation** runs in parallel with gesture detection, every frame:
- MediaPipe gives each landmark a `visibility` (and `presence`) score. These are not reliable alone: for a limb outside the frame the model often still *guesses* its position with moderate confidence. So a landmark counts as visible only if **both**:
  - `visibility` ≥ threshold, **and**
  - its image coordinates are inside the frame with a small margin (e.g. 3% of width/height).
- Landmarks are grouped into **body parts**: head, torso, left arm, right arm, left leg, right leg. A part is visible if its key landmarks (e.g. wrist + elbow for an arm, knee + ankle for a leg) are visible. Only the **required parts** (`REQUIRED_PARTS`: torso, left arm, right arm) decide whether the player is in frame; the others are tracked for display.
- **Anti-flicker smoothing:** per body part, an exponential moving average of the visible/not-visible signal, plus **hysteresis with timing**:
  - part is declared *lost* when the smoothed value stays below ~0.4 for ≥ ~400 ms;
  - part is declared *recovered* when it stays above ~0.7 for ≥ ~300 ms.
  - The overlay appears only when at least one required part is lost; it disappears only when all required parts are recovered.
  - No person detected at all is a separate state ("Step in front of the camera").
- Also estimated: **distance / position hints** from the upper-body bounding box (nose→hips height as a fraction of frame height, horizontal centre) and the hip position → "step back — your hips are out of view", "come closer", "move left/right".
- While a part is lost, the gesture detectors ignore it (e.g. no flap signal from an arm out of frame).

**"Get back in frame" box** [DECIDED]:
- Deliberately unobtrusive: a small box in the **lower right corner** (portrait 3:4, 30% of the screen height; shows the middle strip of the camera view, the hint wraps) with a **blinking frame**, shown automatically when a part is lost and hidden as soon as the pose is reacquired.
- No camera image: the box uses the game's sky colour as background and shows only the **target outline** and the player's live **skeleton**, plus the short text hint.

**Splash screen** [DECIDED]: title "Bird Revenge" (Luckiest Guy, bouncy cartoon capitals, used for all big text; other text is Peralta: black, the selected menu item red with a yellow outline and a black shadow), menu **Start / Instructions / Training** (Training plays `training.tmj` once per letter, A to Z and round, its coins spelling the letter in a fat 7×7 bitmap font, between the HUD and the ground, a coin apart; collecting them all completes it; left through the Esc menu; arrow keys + Enter, Esc back, or mouse), the game's sky colour and the same `Ground` as the game. Camera and pose model load in the background while it is shown.

**Level select** [DECIDED]: "Start" opens "Select level" ("Wybierz Poziom", big-text style): the numbered levels in play order as thumbnails of their first frame, three to a row, rounded borders (the selected one in red and yellow), in a panel that scrolls when they don't fit (wheel, drag, following the keys; a bar on the right). The finished levels and the first one not finished can be picked, that one selected; the rest are grey with a padlock and shake when chosen. Finished levels are remembered by name in `localStorage` (`src/levels/progress.ts`), so a level added between finished ones opens without locking those after it; testing a level from the URL doesn't count. The game goes on from the level picked as before: the next one after each, round robin. Arrow keys / W A S D + Enter, down past the last row to "Back", Esc back, or mouse. The list is whatever `src/levels/` holds. Thumbnails are the game's own drawing of the level (an off-screen `Game`, `Game.snapshot`): `vite build` draws them in headless Chrome (puppeteer, `tools/level-thumbnails.ts` + `tools/thumbnails.html`) and ships them as WebP images, so the built game doesn't draw every level for the list; the dev server draws them in the game itself, again when a map is saved (also the build's fallback if Chrome can't start).

**Languages** [DECIDED]: English and Polish ("Zemsta Ptaka"). Only user-facing text is translated: the code passes the English text to `t()` (`src/ui/i18n.ts`), which looks up the Polish in one typed table, so a missing translation is a type error. A flag in the top-left corner of the splash screen (hidden during the game) switches language; the choice is saved in `localStorage`, defaulting to Polish. Debug panel, tuning GUI and the status line stay English.

**Calibration dialog** [DECIDED, replaces the v0.1 full-screen camera view]:
- After **Start**, a portrait dialog (80% of the screen height, 3:4, centred; the schematic shows the middle strip of the camera view) over the paused game shows the same schematic as the out-of-frame box: game-sky background, **target outline** and the player's live skeleton, no camera image. It also shows camera/model loading and camera errors ("Press K to play with the keyboard"). A camera that fails to start — at page load or after a pause / focus loss (e.g. not ready yet after the laptop wakes; the Vite dev server also reloads the page then) — or whose stream ends on its own is **retried with backoff** (0.5 s doubling to 5 s) and shown as "Reconnecting…" (in the out-of-frame box during a game) instead of a permanent error; only a blocked camera permission is final. When calibration succeeds it closes, the countdown runs and the game starts. The outline has **arms lowered, slightly away from the body** [DECIDED] (a natural rest pose; headroom for flapping is covered by the longer arm "lost" delay below).
- The outline is split into the same body parts; each part is **green** when that part is visible; a lost required part **blinks red**, a lost optional part (head, legs) is grey. This puts the schematic feedback onto the outline itself, so one picture shows both *where to stand* and *what is missing*.
- A short text hint from the distance/position estimate ("Step back — your hips are out of view").
- Used at game start: the player is in frame, keeps both hands below the shoulders, legs straight and down, and holds still ~1.2 s; we record the standing hip angles. Calibration happens once; later out-of-frame events only need the player back in view.
- Arms get a longer "lost" delay (800 ms) than other parts (400 ms), because hands briefly leave the frame at the top of a big flap.
- [OPEN] Is the outline a fixed silhouette or scaled to the player after first calibration? Fixed first; scale later if needed.
- Outline drawn with Rough.js in a sketchy style matching the placeholder art [DECIDED].

### 4.6 Open questions
- [OPEN] Does flap *strength* mean amplitude, speed, or both?
- [OPEN] Window length and sample rate for any ML gesture.
- [OPEN] Number of different people to record to generalise (body sizes, clothing, lighting).

## 5. Game design & mechanics
Implemented in v0.1 (all numbers live in `src/config.ts`, tunable at runtime):
- **World:** fixed 1280×720 logical world scaled to fit the window; ground at y = 640; invisible walls and ceiling keep the bird on screen.
- **Bird:** Matter.js circle (r = 34), no rotation, no bounce, air friction 0.03, max speed clamp. Gravity 800 px/s².
- **Flap → lift:** per arm, downstroke power = max(0, −angular velocity − 60°/s dead zone); lift = liftGain (21) × mean of both arms' power, capped at 6000 px/s². Force comes only while arms move down, so it reacts mid-stroke. The lift is smoothed over `flap.liftSmoothMs` (350 ms) for all flight, level or tilted, so climbs are straight lines, not steps, and after the last flap it fades out, so the fall starts gently. Flapping also bears the weight: as the smoothed lift reaches gravity, only `flappingGravity` (0.5) of gravity acts.
- **Tilt → sideways flight** (`TiltDetector`, `game/flight.ts`): tilt = half the difference of the two arms' angles in the image (shoulder → wrist against the image vertical, so leaning the whole body counts too), EMA-smoothed (`tilt.smoothing` 0.2 per pose frame). Flapping moves both arms by about the same angle, so the difference holds steady through the strokes and tilted flapping keeps its direction; the smoothing and the ±10° dead zone absorb arms flapping slightly out of step. Beyond the dead zone the bird eases (≤ `sideAccel` 1800 px/s²) towards a sideways speed of k × `sideSpeed` (7 px/step), k ramping to 1 at 35°; inside it, the sideways speed is left to air friction. The tilt doesn't hold the bird up by itself: a tilted T does, as the hover. Holding the altitude (a T, tilted or not), the wings beat at `holdFlapRate` (2×) the flap animation's speed instead of following the arms. The bird leans into the flight (`leanDeg` 20°). Keyboard: ← → stand for a 35° tilt.
- **Hover:** spread when the arms move ≤ 120°/s, are tilted ≤ 60° and, asymmetrically: on average at or above horizontal, up to `maxRaise` (50°, a T or a V), each elbow straight (≥ `minElbowAngle` 150°); below horizontal, either `TiltDetector`'s total-least-squares line through both wrists, elbows and shoulders fits closely (`maxBend`), or both arms are lowered by about the same angle (within `maxDroopDiff` 25°), each elbow straight; on after 150 ms, off after it's gone 150 ms (so a flap sweeping through horizontal doesn't count). The hover has a **hold** (0–1, `Controls.hover`): 1 at or above horizontal and down to `holdDroop` (10°) below it, fading linearly to 0 at `fallDroop` (60°), by the arms' average angle. In the air a full hold keeps the altitude (a fall braked by `holdDrag`, gravity cancelled; rising is left to gravity, so a climb levels off); a partial one cancels that fraction of gravity, so with air friction the fall settles at a sink speed that grows the lower the arms are. It never lifts. Keyboard: Shift.
- History: sideways flight was first an instantaneous left − right flap power, then a slide on spread arms, then unequal flapping (one arm, or one faster), alongside a parachute glide whose tilt dived towards the lower hand. All of it was replaced by the tilt + hover above.
- **Pointing control** (F13, `game/pointing.ts`, `PointingDetector`): the alternative mode (`pointing.flapping` off). Each arm's direction (shoulder → wrist, so a bent elbow matters little) is classified per frame: rest (both within `restCone` of down), T (each arm within `tMaxArm` of level out to its own side, on average within `tMaxRaise`; tilted past `tiltDeadZone`, with hysteresis, → drift), or fly (arms within `parallelMax` of each other). A new mode must hold `enterMs`; arms matching nothing keep the current mode for `ambiguousMs`, then rest.
- **Wing animation follows the player:** with pose control the bird's flap frame is chosen from the average arm height, so the wings mirror the arms.
- **Poo:** shoot (or ↓) → bird squashes (×1.22 wide, ×0.72 tall, ~400 ms) and drops a poo at the deepest point; poo inherits part of the bird's velocity (no extra sideways push, whichever leg was raised). Splat on the ground fades after 1.5 s.
- **Villain:** placed in the level as a Tiled polyline; its x range is his **path**, and he stands on whatever is at its first point's y — the ground or the top of a shelf (sensor body). He walks it back and forth, starting off a random way and stopping now and then at random (so villains never move in step), walking on the same way, turning only at its ends or at an **obstacle** — a poo splat at his feet, a level body or terrain reaching into his height, or (off the ground) the stretches with nothing to stand on beyond his shelf's edges; the game computes them per villain every step, since crates move. About to walk into one he stops, then turns back. Every `throwDelay` seconds (± `apple.intervalSpread`, a per-villain Tiled property, 0 = never) he stops, turns to the bird and throws an apple, then walks on the way he was going. A hit scores +1, shows the "hit" frame and knocks him off for good; he's back only when the level restarts. A level can have any number of villains, or none.
- **Levels:** Tiled maps (`src/levels/*.tmj`, object layers only) loaded by `src/level/tiled.ts` into a `LevelDef` (`src/level/types.ts`); an object's class decides what it is — Terrain (static body), Body (movable, by material), Branch (one-way polyline platform), Rope / Hinge (Matter constraints referring to bodies by object id), Villain (polyline: his path), Friend, Coin, BirdStart, Button. Class defaults live in code (`CLASS_DEFAULTS`) because Tiled omits default values; a test keeps them in line with `bird-revenge.tiled-project`. `src/level/build.ts` makes the Matter bodies and constraints, `src/level/LevelView.ts` draws them with Rough.js at load time. The bird stands on level bodies (`Bird.standOn`), poos splat on terrain, apples stop at level bodies. Ground, walls and ceiling are still built in. In dev, saving a map hot-swaps the level (`src/levels/index.ts`). [DECIDED]
- **Friends (collectibles):** little animals placed in a level (Tiled class `Friend`, a point at its feet, `kind`: bunny). They stand still outside the physics world; the bird's body touching one saves it: a random `friend-N` sound, and it grows to 3× in front of everything while fading out over 2 s (`config.friend`); waiting, each one blinks or twitches an ear on its own random clock (`friendFidget`). Saving the last one completes the level: the world freezes, "Hooray!" ("Hurra!") drops in like "Game Over", and 3 s later (`config.levelComplete.nextMs`) the next level loads — the numbered levels in number order, round robin; training: the next letter — keeping score and lives. A level without friends never ends. [DECIDED]
- **Coins:** extra points, counted apart from the score: a coin icon and the count right of the score, kept across levels, reset with the score on a new game. Tiled class `Coin`, a point (its centre) or a tile object from `src/levels/coin.tsj` (one tile of class Coin: `spin_0` at 40 px, `src/levels/tiles/coin.png`, so coins show in Tiled at their size in the game; the loader looks a tile object's class up in the map's tilesets — `.tsj` files next to the maps — and centres it on the image by the tileset's object alignment). They spin (8 frames, 12 fps, each from a random frame) outside the physics world; the bird's body touching one collects it: a random `coin-N` sound, and it floats up and fades (`config.coin`). Logic in `game/Coin.ts`. Art and sounds CC0 from OpenGameArt (`public/assets/coin/CREDITS.md`). [PROPOSED]
- **Buttons:** Tiled class `Button`, an unrotated rectangle whose bottom edge sits on a surface (bird-sized, e.g. 80×24); `target` is a Terrain (a door, a trapdoor). It's pressed while the bird's feet are on it, a poo falls into it or a splat lies on it (the button isn't a physics body: the bird stands on the surface through it, and it's drawn squashed flat). `action: open` — the target is taken out of the physics world (and `levelBodies`) while the button is pressed and for `duration` s after (0 = for good), drawn faint meanwhile; `action: close` — the reverse, the target is only there then. Opening wakes sleeping bodies and drops the splats lying on it. Logic in `game/Button.ts`, switching in `Game.switchDoors`, drawing in `LevelView`; sound group `button`. Several buttons may share a target (any one in effect switches it), but not with opposite actions. [PROPOSED]
- _Still to design:_ pedestrians (−1), rounds/timer, difficulty curve, game-over screen.

## 6. Assets
- Bird, poo, pedestrians, villains: **hand drawn** [DECIDED].
- Background: hand drawn vs. other (generated/photographic/parallax) — [OPEN].
- **Format [DECIDED for now]:** one image file per frame (SVG or PNG) under `public/assets/`, referenced from **character definition files**:
  - `src/characters/bird.ts` — `idle`, `flap` (frames ordered wings **down → up**), squash amounts, anchor (where the physics circle sits on the image)
  - `src/characters/villain.ts` — `walk` cycle, `hit`, hitbox
  - `src/characters/poo.ts` — `falling`, `splat`
  - `src/scenery/scenery.ts` — sky colour, sun, clouds (with drift speed), ground
  - Each definition sets `displayHeight` (world px), `anchor`, the art's `facing` direction and per-animation `fps`.
- Placeholder art: generated by `tools/generate-placeholder-art.mjs` (Rough.js, `npm run art`). Replace the files or the paths to use real drawings.
- Sprite sheets / texture atlases (e.g. via AssetPack) — [OPEN], worth it once real art arrives.

## 7. Implementation plan
1. ✅ **Pose foundation**: camera + MediaPipe Pose + mirrored feed + skeleton debug overlay + landmark recorder (v0.1).
2. ✅ **Visibility monitor** + "get back in frame" / calibration overlay (§4.5) (v0.1).
3. ✅ **Flap detector** (heuristic) (v0.1).
4. ✅ **Shoot detector** (heuristic, hip angles) with hysteresis (v0.1 as a squat detector; reworked to hip angles later).
5. ✅ Game prototype with placeholder art and keyboard fallback, wired to gesture controls (v0.1).
6. ⏭ **Live tuning in front of the camera**: flap gains, shoot thresholds, visibility timing; save good defaults into `config.ts`.
7. **Pose Lab** as a separate project (§9): capture, cut and label recordings; animation playback library. An ML shoot classifier only if the heuristic is unreliable (recordings via **R** already possible).
8. Pedestrians, rounds, scoring screens.
9. Hand-drawn assets, sound, polish.

## 8. Code structure (v0.1)
```
index.html, src/style.css
src/main.ts                 app state machine: loading → menu → calibrating → countdown → playing ⇄ outOfFrame (game keeps running, no pose controls); keyboard mode
src/config.ts               every tunable number (+ save/load to localStorage)
src/pose/                   camera.ts, PoseTracker.ts (MediaPipe, One-Euro smoothing), landmarks.ts, types.ts
src/gestures/               geometry.ts, FlapDetector.ts, TiltDetector.ts, PointingDetector.ts, ShootDetector.ts, VisibilityMonitor.ts, Calibration.ts  (pure TS, no DOM)
src/game/                   Game.ts (Pixi stage + Matter engine + scoring), Bird.ts, flight.ts (tilt + hover physics), pointing.ts (pointing control), Villain.ts, Poo.ts, Background.ts (sun, clouds + Ground), Ground.ts (shared with the splash), physics.ts
src/level/                  types.ts (LevelDef), tiled.ts (Tiled map → LevelDef), build.ts (→ Matter bodies/constraints), LevelView.ts (Rough.js drawing), thumbnails.ts (level select pictures)
src/levels/                 *.tmj Tiled maps, bird-revenge.tiled-project (object classes), index.ts (level choice, hot swap), progress.ts (finished levels)
src/characters/, src/scenery/   art definition files (§6)
src/render/                 assets.ts (loads everything named in the definitions), CharacterSprite.ts, fitWorld.ts (scales the 1280x720 world into the window)
src/input/                  controls.ts (Controls interface), keyboard.ts
src/ui/                     SplashScreen.ts (title + menu), LevelSelect.ts, i18n.ts (English → Polish texts), LanguageButton.ts (flag), FrameGuide.ts (calibration dialog, out-of-frame corner box, countdown overlay), fonts.ts, DebugPanel.ts (D), Tuning.ts (G), Recorder.ts (R)
tests/                      synthetic.ts (synthetic pose generator), gestures.test.ts
tools/generate-placeholder-art.mjs, scripts/copy-mediapipe-wasm.mjs
```
- The game knows nothing about poses: it reads a `Controls` object (`lift`, `tilt`, `hover`, `wingPhase`, `flapping`, `pointing`) and `requestPoo()`. Pose and keyboard both produce `Controls`.
- MediaPipe's WASM is copied from `node_modules` into `public/mediapipe/` on `npm install`, so JS and WASM versions always match. The model file (`pose_landmarker_lite.task`) is downloaded from Google's model storage at startup.
