# Pooping Birds — Architecture & Requirements

> Living document. Status markers: **[DECIDED]**, **[PROPOSED]** (recommended, awaiting sign-off), **[OPEN]** (needs discussion).

## 1. Game concept

- **Single-player**, runs entirely **in the browser**.
- The player controls a **bird** with their body, tracked by the webcam.
- **Default state:** the bird rests on the ground.
- **Flapping arms** → the bird flaps its wings and rises a bit. **Continuous flapping** keeps pushing it upward; stopping lets it fall (gravity).
- **Left/right asymmetry** in flapping (frequency and/or strength per arm) → **sideways movement**.
- **Squat-like gesture** → the bird **drops a poo**.
- **Targets** walk along the bottom of the screen:
  - **Pedestrians** — hitting one scores **negative** points.
  - **Villains** — hitting one scores **positive** points.

## 2. Requirements

### 2.1 Functional
| ID | Requirement | Status |
|----|-------------|--------|
| F1 | Webcam-based pose tracking controls the bird; no keyboard/mouse needed during play | [DECIDED] |
| F2 | Flap detection per arm, producing both lift (up) and steering (left/right) | [DECIDED] |
| F3 | Squat detection triggers a poo drop (discrete event) | [DECIDED] |
| F4 | Walking pedestrians and villains with distinct scoring | [DECIDED] |
| F5 | Short calibration step at game start: stand in the outline with arms lowered, hold still ~1 s; records standing torso length, hip→knee and hip→ankle height | [DECIDED] (v0.1) |
| F7 | Player must be **fully visible** (head to feet, arms raised included); a visibility monitor runs continuously and shows a "get back in frame" overlay when the body is not fully visible (see §4.5) | [DECIDED] |
| F8 | The game keeps running while the out-of-frame box is shown, but pose controls are cut off (the bird drops), so the player has an incentive to get back quickly; controls return as soon as the pose is reacquired | [DECIDED] |
| F6 | Keyboard fallback controls for development/testing (Space/↑ flap, ←/→ steer, ↓ poo; K = keyboard-only mode) | [DECIDED] (v0.1) |
| F9 | Sound | [DEFERRED] |

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
| Gesture recognition | **Heuristics first** (flap and squat); ML classifier only if the squat heuristic proves unreliable (see §4) | [DECIDED] |
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
- Flap control maps onto physics as **forces/impulses**: each detected downstroke applies an upward force (scaled by stroke strength); left/right imbalance applies a horizontal force. Tuning of these constants is ours — that's the "feel" of the game.

## 4. Gesture recognition (key risk — tackle first)

### 4.1 Pipeline
```
webcam → MediaPipe Pose (≈30 fps) → landmark smoothing → feature extraction
       → gesture detectors (flap L/R, squat) → game control signals
```

### 4.2 The two gestures are different kinds of problems
- **Flapping is continuous control, not classification.** The game needs a per-arm signal every frame (how hard / how fast is each arm flapping right now), not a label after the fact.
  - Proposed approach: per arm, compute the **arm elevation angle** (shoulder→wrist vector relative to the torso axis). Track it as a time series; detect **downstrokes** (peak → trough with amplitude above a threshold). Each downstroke delivers an impulse of lift proportional to its amplitude/speed.
  - Lift = sum of both arms' impulses; steering = difference between left and right (frequency × amplitude).
  - This is cheap, low-latency (reacts mid-stroke), explainable and tunable — an ML classifier on fixed windows would add latency (must wait for the window) and is not needed for a periodic signal like this.
- **Squat is a discrete event.** Heuristic first [DECIDED]; full-body framing means legs are always visible, so both cues are available:
  - **Depth** = how far the hips have dropped towards the ankles (feet stay put), in units of the calibrated standing hip→knee height; all vertical distances divided by torso length. 0 standing, ~1 hips level with the knees. Fires on a **light squat** (default depth 0.3), leaves below 0.15.
  - **Raising one leg** also lifts the ankle centre and fires, which is kept on purpose [DECIDED]: if one ankle is clearly higher than the other (> `legRaiseMin` torso lengths), the detector reports which leg is raised and the poo gets a little sideways speed towards that side of the (mirrored) screen. A two-footed squat drops the poo straight down.
  - Measured against the ankles, not the knees: the knees move towards the camera during a squat and, with the camera above knee height, appear lower, hiding part of the hip drop.
  - Dividing by torso length makes it independent of distance from the camera (stepping closer/back doesn't fire).
  - Knee angle is *not* used: facing the camera the knees point at the lens, so the 2D hip–knee–ankle angle barely changes until the squat is very deep (this made v0.1 demand a deep squat).
  - Fires once on entering the squat; must return to standing (hysteresis) before it can fire again.
  - Fallback: ML classifier on a sliding window of normalised landmarks, only if the heuristic gives too many false positives (e.g. leaning forward, walking towards the camera, vigorous flapping).
- **Interference:** flapping vigorously moves the torso; squatting while flapping should probably still work. Detectors must be tested against each other's motions.

### 4.3 Normalisation (needed whichever approach wins)
- Express landmarks relative to the body (hip-centre origin, scaled by shoulder width or torso length) so detection is independent of distance from camera and player size.
- Mirror the camera view so the player's left arm controls the bird's left wing on screen.
- Light temporal smoothing (e.g. One-Euro filter) to remove jitter without adding much lag.
- Use landmark `visibility` to ignore low-confidence points.

### 4.4 Data collection & tooling
Even with heuristics we need recorded data: to tune thresholds, to test detectors offline, and as training data if ML is required.

- Existing tools considered:
  - **Teachable Machine (Pose)** — classifies static poses, not motion over time; not a fit for flapping, weak for squat.
  - **MediaPipe Model Maker gesture recognizer** — hand gestures only; not applicable.
  - **Generic time-series labelling tools** (e.g. Label Studio, Edge Impulse data acquisition) — could label exported keypoint CSVs, but they add a round-trip outside our own pipeline.
- **Decision:** heuristics first, so a full Pose Lab is **deferred** — built only if the squat heuristic is unreliable. [DECIDED]
  - Meanwhile a lightweight debug overlay (skeleton + live feature values + detector events) in the dev build is enough to tune thresholds.
  - Cheap to add early anyway: a "record landmarks to JSON" button in the debug overlay, so that if Pose Lab is needed we already have recordings.
- **Pose Lab (if needed)** — a small in-repo page which:
  1. Shows live camera + skeleton overlay + live plots of the derived features (arm angles, hip height, detector outputs).
  2. **Records sessions** as JSON: raw landmarks + timestamps (optionally the video for review).
  3. **Prompted recording** removes the segmentation problem: the page cues "flap now" / "squat now" / "stand still" on a timer and stores each take already labelled and cut to a **fixed window length** (e.g. 1.5 s). Background "nothing happening" and "other movement" windows are recorded as negatives.
  4. **Free recording + replay** with keyboard labelling (press/hold a key while performing the gesture) for longer, natural sessions; windows are then sliced around the label marks.
  5. **Replays recordings through the detectors** so tuning and regression tests run without standing in front of the camera.
- Sample format (draft): `{ fps, landmarks: [frame][33][x,y,z,visibility], worldLandmarks: …, t: [ms], label, subject, notes }`.

### 4.5 Framing & visibility monitor
**Framing [DECIDED]:** the player is **fully visible** — head to feet, including hands raised above the head during flapping. In practice the player stands roughly 2–3 m from the camera.

**Visibility estimation** runs in parallel with gesture detection, every frame:
- MediaPipe gives each landmark a `visibility` (and `presence`) score. These are not reliable alone: for a limb outside the frame the model often still *guesses* its position with moderate confidence. So a landmark counts as visible only if **both**:
  - `visibility` ≥ threshold, **and**
  - its image coordinates are inside the frame with a small margin (e.g. 3% of width/height).
- Landmarks are grouped into **body parts**: head, torso, left arm, right arm, left leg, right leg. A part is visible if its key landmarks (e.g. wrist + elbow for an arm, knee + ankle for a leg) are visible.
- **Anti-flicker smoothing:** per body part, an exponential moving average of the visible/not-visible signal, plus **hysteresis with timing**:
  - part is declared *lost* when the smoothed value stays below ~0.4 for ≥ ~400 ms;
  - part is declared *recovered* when it stays above ~0.7 for ≥ ~300 ms.
  - The overlay appears only when at least one part is lost; it disappears only when all parts are recovered.
  - No person detected at all is a separate state ("Step in front of the camera").
- Also estimated: **distance / position hints** from the body's bounding box (body height as a fraction of frame height, horizontal centre) → "step back", "come closer", "move left/right".
- While a part is lost, the gesture detectors ignore it (e.g. no flap signal from an arm out of frame).

**"Get back in frame" box** [DECIDED]:
- Deliberately unobtrusive: a small box in the **lower right corner** (1/6 of the screen's width and height, same proportions as the screen) with a **blinking frame**, shown automatically when a part is lost and hidden as soon as the pose is reacquired.
- No camera image: the box uses the game's sky colour as background and shows only the **target outline** and the player's live **skeleton**, plus the short text hint.

**Calibration screen** [DECIDED, implemented in v0.1]:
- Show the **mirrored camera feed** with a **target outline** of the ideal pose drawn over it. The outline has **arms lowered, slightly away from the body** [DECIDED] (a natural rest pose; headroom for flapping is covered by the longer arm "lost" delay below).
- The outline is split into the same body parts; each part is **green** when that part is visible and **blinks red** when lost. This puts the schematic feedback onto the outline itself, so one picture shows both *where to stand* and *what is missing*.
- A short text hint from the distance/position estimate ("Step back — your feet are out of view").
- Used at game start: the player is fully visible, keeps both hands below the shoulders, legs straight and holds still ~1.2 s; we record standing torso length, hip→knee and hip→ankle height. Calibration happens once; later out-of-frame events only need the player back in view.
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
- **Flap → lift:** per arm, downstroke power = max(0, −angular velocity − 60°/s dead zone). Lift = liftGain (14) × mean of both arms' power, capped at 4000 px/s². Lift happens only while arms move down, so it reacts mid-stroke.
- **Steering:** steerGain (6) × (left power − right power). Default: a stronger **left** arm pushes the bird **right** (like rowing); flip with `steerSign`.
- **Wing animation follows the player:** with pose control the bird's flap frame is chosen from the average arm height, so the wings mirror the arms.
- **Poo:** squat (or ↓) → bird squashes (×1.22 wide, ×0.72 tall, ~400 ms) and drops a poo at the deepest point; poo inherits part of the bird's velocity, plus `pooSideSpeed` sideways when one leg was raised (towards that leg's side). Splat on the ground fades after 1.5 s.
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
4. ✅ **Squat detector** (heuristic) with hysteresis (v0.1).
5. ✅ Game prototype with placeholder art and keyboard fallback, wired to gesture controls (v0.1).
6. ⏭ **Live tuning in front of the camera**: flap gains, squat thresholds, visibility timing; save good defaults into `config.ts`.
7. Only if squat is unreliable: build Pose Lab and an ML classifier (recordings via **R** already possible).
8. Pedestrians, rounds, scoring screens.
9. Hand-drawn assets, sound, polish.

## 8. Code structure (v0.1)
```
index.html, src/style.css
src/main.ts                 app state machine: loading → calibrating → countdown → playing ⇄ outOfFrame (game keeps running, no pose controls); keyboard / error modes
src/config.ts               every tunable number (+ save/load to localStorage)
src/pose/                   camera.ts, PoseTracker.ts (MediaPipe, One-Euro smoothing), landmarks.ts, types.ts
src/gestures/               geometry.ts, FlapDetector.ts, SquatDetector.ts, VisibilityMonitor.ts, Calibration.ts  (pure TS, no DOM)
src/game/                   Game.ts (Pixi stage + Matter engine + scoring), Bird.ts, Villain.ts, Poo.ts, Background.ts, physics.ts
src/characters/, src/scenery/   art definition files (§6)
src/render/                 assets.ts (loads everything named in the definitions), CharacterSprite.ts
src/input/                  controls.ts (Controls interface), keyboard.ts
src/ui/                     FrameGuide.ts (calibration screen, out-of-frame corner box, countdown overlay), DebugPanel.ts (D), Tuning.ts (G), Recorder.ts (R)
tests/                      synthetic.ts (synthetic pose generator), gestures.test.ts
tools/generate-placeholder-art.mjs, scripts/copy-mediapipe-wasm.mjs
```
- The game knows nothing about poses: it reads a `Controls` object (`lift`, `steer`, `wingPhase`, `flapping`) and `requestPoo()`. Pose and keyboard both produce `Controls`.
- MediaPipe's WASM is copied from `node_modules` into `public/mediapipe/` on `npm install`, so JS and WASM versions always match. The model file (`pose_landmarker_lite.task`) is downloaded from Google's model storage at startup.
