# Pooping Birds — Architecture & Requirements

> Living document. Status markers: **[DECIDED]**, **[PROPOSED]** (recommended, awaiting sign-off), **[OPEN]** (needs discussion).

## 1. Game concept

- **Single-player**, runs entirely **in the browser**.
- The player controls a **bird** with their body, tracked by the webcam.
- **Default state:** the bird rests on the ground.
- **Flapping arms** → the bird flaps its wings and rises a bit. **Continuous flapping** keeps pushing it upward; stopping lets it fall (gravity).
- **Sideways movement** comes from flapping the arms unequally: one arm alone, or one clearly faster than the other, pushes the bird sideways. (Instantaneous left/right asymmetry and later gliding with tilted arms were tried before and removed.)
- **"Shoot" gesture** (a leg raised sideways) → the bird **drops a poo**.
- **Targets** walk along the bottom of the screen:
  - **Pedestrians** — hitting one scores **negative** points.
  - **Villains** — hitting one scores **positive** points.

## 2. Requirements

### 2.1 Functional
| ID | Requirement | Status |
|----|-------------|--------|
| F1 | Webcam-based pose tracking controls the bird; no keyboard/mouse needed during play | [DECIDED] |
| F2 | Flap detection per arm, arms independent. Both arms flapping about equally hard → up; one arm alone, or one flapping clearly faster (e.g. twice as fast) → sideways, with reduced lift | [DECIDED] |
| F3 | Shoot detection (leg raised sideways, read from the hip angles) triggers a poo drop (discrete event) | [DECIDED] |
| F4 | Walking pedestrians and villains with distinct scoring | [DECIDED] |
| F5 | Short calibration step at game start: stand in the outline with arms lowered, hold still ~1 s; records the standing hip angles | [DECIDED] (v0.1) |
| F7 | Player must be **in frame**: at minimum torso (shoulders to hips) and both arms, raised included; head and legs are optional. A visibility monitor runs continuously and shows a "get back in frame" overlay when a required part is lost (see §4.5) | [DECIDED] |
| F8 | The game keeps running while the out-of-frame box is shown, but pose controls are cut off (the bird drops), so the player has an incentive to get back quickly; controls return as soon as the pose is reacquired | [DECIDED] |
| F6 | Keyboard fallback controls for development/testing (↑ flap, ←/→ steer, ↓ poo; Space/P pause; K = keyboard-only mode) | [DECIDED] (v0.1) |
| F12 | ~~Glide~~ (arms spread out to fall slowly, tilted to slide sideways): removed, replaced by asymmetric flapping (F2) | [REMOVED] |
| F9 | Sound | [DEFERRED] |
| F10 | The player has 3 lives; touching a walking villain costs one: the bird hops and falls off the screen turned on its side (the lost heart blinks meanwhile), then a new bird drops in from the top, blinking and unhurtable for ~2 s. After the last life the "Game Over" sign drops from the top, then a new game starts (countdown, or straight away in keyboard mode) | [DECIDED] |
| F11 | A villain hit by a poo is knocked off the screen arcade style: a short hop, then a parabolic fall past the bottom edge, growing a little as if flying towards the camera | [DECIDED] |

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
  - If one leg's angle exceeds the other's by more than `legRaiseMin` (15°), the detector reports which leg is raised and the poo gets a little sideways speed towards that side of the (mirrored) screen. Both legs out about equally (e.g. a wide squat with knees out) drops it straight down.
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

**Splash screen** [DECIDED]: title "Bird Revenge" (Abril Fatface, a Didone "fat face" in the style of 19th-century French posters), menu **Start / Instructions / Scores** (arrow keys + Enter, Esc back, or mouse), the game's sky colour and the same `Ground` as the game. Camera and pose model load in the background while it is shown. Scores is a placeholder until rounds exist.

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
- **Flap → lift and sideways push:** per arm, downstroke power = max(0, −angular velocity − 60°/s dead zone), and effort = power averaged over `effortWindowMs` (700 ms, exponential). Asymmetry = 0 while the weaker arm's effort is ≥ `symmetricRatio` (0.75) of the stronger one's, rising linearly to 1 when only one arm flaps. With P = mean of both arms' power: lift = liftGain (16.8) × P × (1 − asymmetry × (1 − `asymmetricLift` 0.65)), capped at 4800 px/s²; sideways = sideGain (12) × P × asymmetry, capped at 2500 px/s², away from the stronger arm (`sideSign` +1: stronger left arm → right, like rowing). Force comes only while arms move down, so it reacts mid-stroke; the split follows the smoothed efforts, so a 2:1 flap rate gives a steady partial sideways push and starting one arm a moment before the other only tilts the first stroke a little.
- History: the first steering (`steerGain` × instantaneous left − right power) was removed; then a glide (arms spread out in a straight line to fall slowly, tilted to slide) was tried and removed in favour of this.
- **Wing animation follows the player:** with pose control the bird's flap frame is chosen from the average arm height, so the wings mirror the arms.
- **Poo:** shoot (or ↓) → bird squashes (×1.22 wide, ×0.72 tall, ~400 ms) and drops a poo at the deepest point; poo inherits part of the bird's velocity, plus `pooSideSpeed` sideways when one leg was raised (towards that leg's side). Splat on the ground fades after 1.5 s.
- **Villain:** walks back and forth on the ground (sensor body). A hit scores +1, shows the "hit" frame, he runs off and a new one enters from a random side after 1.5 s.
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
src/gestures/               geometry.ts, FlapDetector.ts, ShootDetector.ts, VisibilityMonitor.ts, Calibration.ts  (pure TS, no DOM)
src/game/                   Game.ts (Pixi stage + Matter engine + scoring), Bird.ts, Villain.ts, Poo.ts, Background.ts (sun, clouds + Ground), Ground.ts (shared with the splash), physics.ts
src/characters/, src/scenery/   art definition files (§6)
src/render/                 assets.ts (loads everything named in the definitions), CharacterSprite.ts, fitWorld.ts (scales the 1280x720 world into the window)
src/input/                  controls.ts (Controls interface), keyboard.ts
src/ui/                     SplashScreen.ts (title + menu), FrameGuide.ts (calibration dialog, out-of-frame corner box, countdown overlay), fonts.ts, DebugPanel.ts (D), Tuning.ts (G), Recorder.ts (R)
tests/                      synthetic.ts (synthetic pose generator), gestures.test.ts
tools/generate-placeholder-art.mjs, scripts/copy-mediapipe-wasm.mjs
```
- The game knows nothing about poses: it reads a `Controls` object (`lift`, `steer`, `wingPhase`, `flapping`) and `requestPoo()`. Pose and keyboard both produce `Controls`.
- MediaPipe's WASM is copied from `node_modules` into `public/mediapipe/` on `npm install`, so JS and WASM versions always match. The model file (`pose_landmarker_lite.task`) is downloaded from Google's model storage at startup.
