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
| F5 | Short calibration step at game start: stand in the outline in an X (arms raised and spread), hold still ~1 s; records the standing hip angles | [DECIDED] (v0.1) |
| F7 | Player must be **in frame**: at minimum torso (shoulders to hips) and both arms, raised included, as far as the elbows plus the first ~20% of the forearms (the hands may leave the frame); head and legs are optional. A visibility monitor runs continuously and shows a "get back in frame" overlay when a required part is lost (see §4.5) | [DECIDED] |
| F8 | The game keeps running while the out-of-frame box is shown, but pose controls are cut off (the bird drops), so the player has an incentive to get back quickly; controls return as soon as the pose is reacquired | [DECIDED] |
| F6 | Keyboard fallback controls for development/testing (↑ flap, ←/→ fly sideways, Shift hover, ↓ poo; Space/P pause; K = keyboard-only mode) | [DECIDED] (v0.1) |
| F12 | **Hover and tilt** (alongside flapping, F2; together the alternative to pointing control, F13, the default): both arms spread out (a T, or raised into a V up to ~45° above horizontal; level or tilted) and held still → hover: in the air the bird keeps its altitude. **Tilting** the arms (one hand lower than the other, as seen on screen) → the bird flies horizontally towards the lower hand, its speed proportional to the tilt; up and down are left to flapping and the hover (flapping tilted puts `sideLift`, 0.75, of its lift into the climb). Replaces the earlier side-flapping (one arm / unequal flapping), the dive along a tilted glide, both removed | [DECIDED] |
| F13 | **Pointing control** (the default; F2 + F12 are the alternative, tick "Flapping (off: pointing)" in the tuning panel): both arms hanging down → no force, the bird rests or falls freely; both arms straight and parallel → the bird flies where they point (almost 360°) at a fixed cruising speed; a T (generous leeway: slightly raised, drooping or bent) → hover in place; a tilted T → slow sideways drift towards the lower hand, a fixed low speed, for precise positioning. Pooping as in F3. Replaces the earlier posture control (arm angles setting speed and direction separately) | [PROPOSED] |
| F9 | Sound | [DEFERRED] |
| F10 | The player has 3 lives; touching a walking villain costs one: the bird hops and falls off the screen turned on its side (the lost heart blinks meanwhile), then a new bird drops in from the top, blinking and unhurtable for ~2 s. After the last life the "Game Over" sign drops from the top, then a new game starts (countdown, or straight away in keyboard mode) | [DECIDED] |
| F11 | A villain hit by a poo is knocked off the screen arcade style: a short hop, then a parabolic fall past the bottom edge, growing a little as if flying towards the camera, gone for good | [DECIDED] |
| F14 | **Bats** fly along a route set in the level and now and then poo straight down. Their poo is smaller than the bird's and hurts only the bird (a life, like touching a bat or a villain): it passes through villains, they don't avoid its splats, and it doesn't press buttons or knock apples down. The bird's poo knocks a bat off (+1): it hangs a moment in its "hit" pose, then tumbles off the screen, gone for good | [PROPOSED] |

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
  - part is declared *recovered* when it stays above ~0.7 for ≥ `visibility.recoverAfterMs` (150; it was 300: replay shows each soft pause 130-280 ms shorter, none added). Arms are declared lost only after `armLostAfterMs` (800), kept on the replay evidence (see its comment in `config.ts`): shorter would cut the wrong controls while an elbow is truly lost, but pauses for harmless dips of its visibility.
  - The overlay appears only when at least one required part is lost; it disappears only when all required parts are recovered.
  - No person detected at all is a separate state ("Step in front of the camera").
- **Centred** [DECIDED]: the torso's centre (shoulders + hips) must lie within `visibility.maxOffCentre` (30% of the width) of the frame's middle; off centre for ≥ `offCentreAfterMs` pauses the game softly ("Move to the middle of the picture"; recalibration only after `personGoneAfterMs`, below). With several people in view MediaPipe (`numPoses: 1`) keeps following whoever it found first, so someone at the edge is likely the wrong person: while off centre the tracker is reset (`PoseTracker.redetect`, the graph rebuilt, like covering the camera for a moment) at most every `redetectEveryMs`, so it looks again for whoever stands in front.
- **Gaps in the pose** [DECIDED]: one notion of pose freshness, the age of the latest *good* pose (a frame with the player in it: a person, centred), read through `poseGap` (`src/pose/freshness.ts`), for null frames and for frames that do not come at all (a hitch; the render ticker calls `PoseSession.tick`):
  - younger than `pose.holdLastMs`: the last controls keep applying, nothing is reset (the One-Euro filters and the arm stand-in carry on, `PoseSmoother`; they only start afresh after `pose.resetFiltersAfterMs`);
  - older, up to `visibility.personGoneAfterMs`: soft pause (the `outOfFrame` state: game paused, no fall, no penalty, calibration kept), with "Tracking lost — stay in the frame" when no frames come, or the hint of the visibility monitor; the gesture detectors drop their transient state (the shoot calibration stays), and the game resumes once the parts count as visible again (about 0.3-0.6 s);
  - from `personGoneAfterMs`: the big calibration dialog (and calibration), as at the start. The small box is for the soft pause only.
- Also estimated: **distance / position hints** from the upper-body bounding box (nose→hips height as a fraction of frame height, horizontal centre) and the hip position → "step back — your hips are out of view", "come closer", "move left/right".
- While a part is lost, the gesture detectors ignore it (e.g. no flap signal from an arm out of frame).

**"Get back in frame" box** [DECIDED]:
- Deliberately unobtrusive: a small box in the **lower right corner** (portrait 3:4, 30% of the screen height; shows the middle strip of the camera view, the hint wraps) with a **blinking frame**, shown automatically when a part is lost and hidden as soon as the pose is reacquired.
- No camera image: the box uses the game's sky colour as background and shows only the **target outline** and the player's live **skeleton**, plus the short text hint.

**Splash screen** [DECIDED]: title "Bird Revenge" (Luckiest Guy, bouncy cartoon capitals, used for all big text; other text is Peralta: black, the selected menu item red with a yellow outline and a black shadow), menu **Start / Training / Instructions** (Instructions: see below) (Training plays `training.tmj` once per letter, A to Z and round, its coins spelling the letter in a fat 7×7 bitmap font, between the HUD and the ground, a coin apart; collecting them all completes it; left through the Esc menu; arrow keys + Enter, Esc back, or mouse), the game's sky colour and the same `Ground` as the game, the game's characters crossing it one at a time (`Passersby`: villain, ghost, bat in a shuffled order without repeats, from a random side, moving as in the game with the villain's random stops, bats no higher than the villain's head; half the time a second one, of any kind, comes from the other side 1–4 s later, and when they meet a coin decides whether they pass or both turn back; the next walk-out 5 s after all have left). Camera and pose model load in the background while it is shown.

**Instructions page** [PROPOSED]: no text, a demonstration. The title screen makes way for the level `control-tutorial.tmj` (its HUD hidden), where a recorded pose stream flies the bird, sounds and all; the pose panel (`FrameGuide`'s `demo` mode: the calibration dialog's `PANEL`, no text, `PANEL.demo` sets its height) plays the recording in the left half of the screen, the calibration's target figure moving with the pose; no language flag, only "Return" ("Powrót") stays, in the middle at the bottom, without the menu's flying birds. The recording (`src/tutorial/<level>.json`, loaded when the page opens) goes through the game's own detectors (`PoseDetectors` + `controlsFrom`, `src/input/poseControls.ts`, shared with the live game), frame by frame by game time, physics step by physics step (`Game.onStep`), so it flies as it did when recorded and the same way every loop: each loop restarts the level with fresh detectors, warmed up on the second before the clip, and holds its last moment for `LOOP_PAUSE_MS` (`PoseReplay`). The recording keeps the control mode it was made with (flapping or pointing) and its calibration.

**Tutorial recorder** (dev only, not built: `npm run dev`, then `/src/dev/tutorial-recorder.html`, `?level=<name>` for another level): looks like the instructions page, with the live pose flying the bird; it calibrates on its own at the start (stand still, arms down; "Recalibrate" again). **Record** counts down 5 s, restarts the level and records until the player has stood still for 2 s (or Esc). Then a strip shows the take — how much the player moves over time, the clip's in and out handles (drag; ← → nudge by a frame), a playhead (click to scrub, the panel shows that moment) — and **Play clip** loops it as the instructions page will. **Save** writes the clip plus a second before it to `src/tutorial/<level>.json` through the dev server (`tools/tutorial-recordings.ts`); **Record** again replaces the take. A saved recording opens straight away for re-trimming.

**Hidden arm** (`ArmOcclusion`, in `PoseTracker` before the smoothing; `config.armOcclusion`): pointing both arms to one side turns the body sideways and the far arm disappears behind the near one; MediaPipe's confidence in it sinks (elbow ≈ 0.2–0.45) and it guesses the arm hanging, so the out-of-frame panel opened and the bird stopped (`traces/arms-together.json`: twice, 7 s and 4 s). When an arm's confidence (its less visible joint: elbow or wrist) falls below `confident` (0.7) while the other is above `otherMin` (0.8), the two were parallel (≤ `parallelMax` 35°) when last both seen, and the fading arm is the far one (larger z), the near arm stands in for it: its elbow and wrist moved onto the hidden arm's shoulder, with its visibility, blended in fully at `hidden` (0.5). It ends when the arm is seen again or the near arm fades too (then the player really is out of view). [PROPOSED]

**Frame loop** (`FrameLoop`, used by `PoseTracker`): one step per video frame (`requestVideoFrameCallback`, else `requestAnimationFrame`). An exception in the model's detect call or after it (smoothing, `onFrame`) is counted (`TrackingStats.errors`, the debug panel's `loop` line; logged for the first 5, then the 10th, 100th, ...) and the next frame is armed all the same (try/finally), where one throw used to end the loop for good. A watchdog (`pose.watchdogMs`, 1000): the video playing (not paused, ended, hidden or unready) and no frame handled for that long: the callback chain is taken to be dead and armed afresh (`rearm` in the panel). Nobody is told with a `null` frame; the game's gap handling (`PoseSession.tick`) already pauses softly for a stalled stream. [PROPOSED]

**Unseen wrist** (`WristGate`, in `PoseSmoother` after `ArmOcclusion`; `pose.minWristVisibility` 0.5, `pose.wristVisibilityMargin` 0.1): an arm's direction is shoulder → wrist, but the monitor only checks the elbow, and MediaPipe guesses a wrist it cannot see hanging down with a low visibility (synthetic: 729 ms of 1 s of wrong controls, no pause, no hint). With the wrist below the threshold and the elbow confident (`visibility.minLandmarkVisibility`) the wrist is moved onto the shoulder → elbow line (forearm assumed straight, 0.9 of the upper arm), so pointing, tilt and flap all read the upper arm's direction; the wrist is trusted again above threshold plus margin. With the elbow unreliable too nothing changes and the arm is out of view as before. The hands may still leave the frame. [PROPOSED]

**Debug trace** (the recorder's switch, with a file name next to it; `?trace=<file>` turns it on with that name, **T** toggles it): for looking into the pose tracker's failures (e.g. MediaPipe losing one of two arms held straight and close together). A take is then a debug trace (`src/dev/debugTrace.ts`): a pose recording — it plays back and trims like one — whose every frame also has MediaPipe's landmarks before smoothing (x, y, z, visibility), the inference time, how much of each arm is a stand-in (`ArmOcclusion`), the visibility monitor's per-part state (raw / score / debounced, `PartStatus.problem` says why a part isn't visible, e.g. `rightElbow v=0.41`), `inFrame` and the pointing detector's reading; plus an event log of what opens and closes the game's out-of-frame panel (a required part's raw visibility flipping, its debounced loss and return, `outOfFrame` / `inFrame`, the hint changing, the person lost / found). It doesn't stop on standing still (Esc ends it), and is saved whole as soon as it ends to `traces/<file>.json` (git-ignored; `/__trace` in `tools/tutorial-recordings.ts`), never to the tutorial.

**Level select** [DECIDED]: "Start" opens "Select level" ("Wybierz Poziom", big-text style): the numbered levels in play order as thumbnails of their first frame, three to a row, rounded borders (the selected one in red and yellow), in a panel that scrolls when they don't fit (wheel, drag, following the keys; a bar on the right). The finished levels and the first one not finished can be picked, that one selected; the rest are grey with a padlock and shake when chosen. Finished levels are remembered by name in `localStorage` (`src/levels/progress.ts`), so a level added between finished ones opens without locking those after it; testing a level from the URL doesn't count. The game goes on from the level picked as before: the next one after each, round robin. Arrow keys / W A S D + Enter, down past the last row to "Back", Esc back, or mouse. The list is whatever `src/levels/` holds. Thumbnails are the game's own drawing of the level (an off-screen `Game`, `Game.snapshot`): `vite build` draws them in headless Chrome (puppeteer, `tools/level-thumbnails.ts` + `tools/thumbnails.html`) and ships them as WebP images, so the built game doesn't draw every level for the list; the dev server draws them in the game itself, again when a map is saved (also the build's fallback if Chrome can't start).

**Languages** [DECIDED]: English and Polish ("Zemsta Ptaka"). Only user-facing text is translated: the code passes the English text to `t()` (`src/ui/i18n.ts`), which looks up the Polish in one typed table, so a missing translation is a type error. A flag in the top-left corner of the splash screen (hidden during the game) switches language; the choice is saved in `localStorage`, defaulting to Polish. Debug panel, tuning GUI and the status line stay English.

**Calibration dialog** [DECIDED, replaces the v0.1 full-screen camera view]:
- After **Start**, a portrait dialog (80% of the screen height, 3:4, centred; the schematic shows the middle strip of the camera view) over the paused game shows the same schematic as the out-of-frame box: game-sky background, **target outline** and the player's live skeleton, no camera image. It also shows camera/model loading and camera errors ("Press Esc to play with the keyboard", only where a keyboard is likely). A **Back** under the panel (tappable; the only way out on a phone) returns to the level select (from training: the title screen). A camera that fails to start — at page load or after a pause / focus loss (e.g. not ready yet after the laptop wakes; the Vite dev server also reloads the page then) — or whose stream ends on its own is **retried with backoff** (0.5 s doubling to 5 s) and shown as "Reconnecting…" (in the out-of-frame box during a game) instead of a permanent error; only a blocked camera permission is final. When calibration succeeds it closes, the countdown runs and the game starts. The outline is an **X: arms raised and spread, legs apart** [DECIDED] (so the raised hands, which flapping lifts, are known to be in view before the game starts; earlier it had the arms lowered).
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
- **Pointing control** (F13, `game/pointing.ts`, `PointingDetector`): the default mode (`pointing.flapping` off). Each arm's direction (shoulder → wrist, so a bent elbow matters little) is classified per frame: rest (both within `restCone` of down), T (each arm within `tMaxArm` of level out to its own side, on average within `tMaxRaise`; tilted past `tiltDeadZone`, with hysteresis, → drift), or fly (arms within `parallelMax` of each other). A new mode must hold `enterMs`; arms matching nothing keep the current mode for `ambiguousMs`, then rest.
- **Wing animation follows the player:** with pose control the bird's flap frame is chosen from the average arm height, so the wings mirror the arms.
- **Poo:** shoot (or ↓) → bird squashes (×1.22 wide, ×0.72 tall, ~400 ms) and drops a poo at the deepest point; poo inherits part of the bird's velocity (no extra sideways push, whichever leg was raised). Splat on the ground fades after 1.5 s.
- **Villain:** placed in the level as a tile from `icons.tsj` (his first frame, cut at his feet) whose `path` property is a polyline without a class — or, the older way, as a polyline of class Villain; the polyline's x range is his **path**, and he stands on whatever is at his feet (the tile's bottom; the polyline's first point) — the ground or the top of a shelf (sensor body). He walks it back and forth, starting off a random way and stopping now and then at random (so villains never move in step), walking on the same way, turning only at its ends or at an **obstacle** — a poo splat at his feet, a level body or terrain reaching into his height, or (off the ground) the stretches with nothing to stand on beyond his shelf's edges; the game computes them per villain every step, since crates move. About to walk into one he stops, then turns back. Every `throwDelay` seconds (± `apple.intervalSpread`, a per-villain Tiled property, 0 = never) he stops, turns to the bird and throws an apple, then walks on the way he was going. A hit scores +1, shows the "hit" frame and knocks him off for good; he's back only when the level restarts. A level can have any number of villains, or none. A villain's `kind` (Tiled property; the `icons.tsj` ghost tile sets it) is only his look: `villain`, the man in the trench coat throwing apples, or `ghost`, a ball under a bed sheet floating a little above his feet, its hem waving even while it stands still (`ghostDef`, `villainLooks`), throwing glowing green glue (`glueDef`, `missiles`: it wobbles instead of spinning). Everything else — size, hitbox, walking, throwing, scoring — is the same `Villain` and `Apple` code.
- **Bat:** placed in the level as a tile from `icons.tsj` whose `path` is a polyline (flown there and back) or polygon (flown round and round), from the route's point nearest the tile's centre — or, the older way, as such a polyline or polygon of class Bat, from its first point — at its `speed` (px per step). A Bat tile (or point) without a `path` is a homing bat (`route` empty): until it first sees the bird — the line between their centres clear of static bodies (terrain, a closed door; `inSight`, a Matter ray), movable bodies, actors and coins not counting — it loops about its start (`bat.homingIdleRadius`); from then on it flies at its `speed` towards the bird, in or out of sight, along a `HomingField` (`src/game/homing.ts`) — a 16 px grid over the world marking the level's current bodies, the ground and a `bat.homingClearance` margin round them, with Dijkstra distances to the bird, redone every `bat.homingReplanMs` — straight at the bird when nothing solid is between them, else to the furthest cell along its way it can see; it is pushed apart from other flying bats closer than `bat.homingSeparation`, turns smoothly (`bat.homingTurn`) and never moves into a solid cell. It is drawn in dark purple (`homingBatDef`, `assets/bat/homing/`, made by `npm run art` with the bat's shapes and seeds) so players can tell it from a route-flying bat. A bat has a sensor pill (`batHitbox`, 80% of its wingspan, leaning with it) that the bird's poo hits, and a smaller circle (`batRadius`) the bird bumps into. Every `pooDelay` seconds (± `bat.intervalSpread`, 0 = never) it poos straight down: a `Poo` with owner `bat`, smaller (`batPooDef`, `bat.pooRadius`) and silent. A bat's poo splats like the bird's but hits only the bird (by distance, as apples do); the bird's poo is the one that hits villains, bats, apples and buttons. A hit bat scores +1 and tumbles off the screen; touching a flying bat costs a life.
- **Levels:** Tiled maps (`src/levels/*.tmj`, object layers only) loaded by `src/level/tiled.ts` into a `LevelDef` (`src/level/types.ts`); an object's class decides what it is — Terrain (static body), Body (movable, by material), Branch (one-way polyline platform), Rope / Hinge (Matter constraints referring to bodies by object id), Villain (his path a polyline), Bat (its route a polyline or polygon), Friend, Coin, BirdStart, Button. Coins and actors can be tile objects (`icons.tsj`: the sprites' first frames at their size in the game, drawn by `tools/tiled-icons.mjs`), so they show in Tiled as in the game; a tile object takes its tile's class and properties, and the loader puts the thing at the point of the image its sprite is anchored at (`TILE_POSITIONS`); a villain's or bat's tile refers to its path by an object property (`path`). Class defaults live in code (`CLASS_DEFAULTS`) because Tiled omits default values; a test keeps them in line with `bird-revenge.tiled-project`. `src/level/build.ts` makes the Matter bodies and constraints, `src/level/LevelView.ts` draws them with Rough.js at load time. The bird stands on level bodies (`Bird.standOn`), poos splat on terrain, apples stop at level bodies. Ground, walls and ceiling are still built in. In dev, saving a map hot-swaps the level (`src/levels/index.ts`). [DECIDED]
- **Friends (collectibles):** little animals placed in a level (Tiled class `Friend`, an `icons.tsj` tile or a point at its feet, `kind`: bunny). They stand still outside the physics world; the bird's body touching one saves it: a random `friend-N` sound, and it grows to 3× in front of everything while fading out over 2 s (`config.friend`); waiting, each one blinks or twitches an ear on its own random clock (`friendFidget`). Saving the last one completes the level: the world freezes, "Hooray!" ("Hurra!") drops in like "Game Over", and 3 s later (`config.levelComplete.nextMs`) the next level loads — the numbered levels in number order, round robin; training: the next letter — keeping score and lives. A level without friends never ends. [DECIDED]
- **Coins:** extra points, counted apart from the score: a coin icon and the count right of the score, kept across levels, reset with the score on a new game. Tiled class `Coin`, a point (its centre) or a tile object from `src/levels/icons.tsj` (its tile of class Coin: `spin_0` at 40 px, `src/levels/tiles/coin.png`, so coins show in Tiled at their size in the game; the loader looks a tile object's class up in the map's tilesets — `.tsj` files next to the maps — and centres it on the image by the tileset's object alignment). They spin (8 frames, 12 fps, each from a random frame) outside the physics world; the bird's body touching one collects it: a random `coin-N` sound, and it floats up and fades (`config.coin`). Logic in `game/Coin.ts`. Art and sounds CC0 from OpenGameArt (`public/assets/coin/CREDITS.md`). [PROPOSED]
- **Buttons:** Tiled class `Button`, an unrotated rectangle whose bottom edge sits on a surface (bird-sized, e.g. 80×24); `target` is a Terrain (a door, a trapdoor). It's pressed while the bird's feet are on it, a poo falls into it or a splat lies on it (the button isn't a physics body: the bird stands on the surface through it, and it's drawn squashed flat). `action: open` — the target is taken out of the physics world (and `levelBodies`) while the button is pressed and for `duration` s after (0 = for good), drawn faint meanwhile; `action: close` — the reverse, the target is only there then. Opening wakes sleeping bodies and drops the splats lying on it. Logic in `game/Button.ts`, switching in `Game.switchDoors`, drawing in `LevelView`; sound group `button`. Several buttons may share a target (any one in effect switches it), but not with opposite actions. [PROPOSED]
- _Still to design:_ pedestrians (−1), rounds/timer, difficulty curve, game-over screen.

## 6. Assets
- Bird, poo, pedestrians, villains: **hand drawn** [DECIDED].
- Background: hand drawn vs. other (generated/photographic/parallax) — [OPEN].
- **Format [DECIDED for now]:** one image file per frame (SVG or PNG) under `public/assets/`, referenced from **character definition files**:
  - `src/characters/bird.ts` — `idle`, `flap` (frames ordered wings **down → up**), squash amounts, anchor (where the physics circle sits on the image)
  - `src/characters/villain.ts` — `walk` cycle, `hit`, hitbox; the ghost's look (`ghostDef`)
  - `src/characters/bat.ts` — `fly` (a wingbeat), `hit`, poo hitbox and body radius
  - `src/characters/poo.ts` — `falling`, `splat`; `batPooDef`, the same frames smaller
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
src/pose/                   camera.ts, PoseTracker.ts (MediaPipe), FrameLoop.ts (the per-frame loop: survives exceptions, watchdog), PoseSmoother.ts (arm stand-in + One-Euro smoothing, kept across short gaps), freshness.ts (`poseGap`: how old the latest good pose may be), trackingStats.ts (local telemetry for the debug panel: null runs, hitches, inference p50/p95, recalibrations by cause), blackBox.ts (ring buffer of the last 60 s of raw landmarks + game state, saved with **B** as a replayable pose recording), ArmOcclusion.ts (an arm hidden behind the other), WristGate.ts (an unseen wrist taken from the upper arm), landmarks.ts, types.ts
src/gestures/               geometry.ts, FlapDetector.ts, TiltDetector.ts, PointingDetector.ts, ShootDetector.ts, VisibilityMonitor.ts, Calibration.ts  (pure TS, no DOM)
src/game/                   Game.ts (Pixi stage + Matter engine + scoring), Bird.ts, flight.ts (tilt + hover physics), pointing.ts (pointing control), Villain.ts, Bat.ts, Poo.ts, Background.ts (sun, clouds + Ground), Ground.ts (shared with the splash), physics.ts
src/level/                  types.ts (LevelDef), tiled.ts (Tiled map → LevelDef), build.ts (→ Matter bodies/constraints), LevelView.ts (Rough.js drawing), thumbnails.ts (level select pictures)
src/levels/                 *.tmj Tiled maps, bird-revenge.tiled-project (object classes), index.ts (level choice, hot swap), progress.ts (finished levels)
src/characters/, src/scenery/   art definition files (§6)
src/render/                 assets.ts (loads everything named in the definitions), CharacterSprite.ts, fitWorld.ts (scales the 1280x720 world onto the screen, standing on its bottom: a taller screen shows more sky; a phone held upright shows the game in a 16:9 box as wide as the screen, `body.boxed`, while the title screen fills it with its own layout)
src/input/                  controls.ts (Controls interface), keyboard.ts
src/input/poseControls.ts   the gesture detectors fed one pose frame at a time, and the controls they give (live game and tutorial replay)
src/input/poseSession.ts    the game's rules on the pose stream (calibrating / countdown / playing / outOfFrame changes, recalibration, controls and gaps in the pose: hold, soft pause, recalibration; redetect), pure, used by main.ts and the replay tests
src/tutorial/               recording.ts (recorded pose stream format), PoseReplay.ts (plays one in a Game, deterministic loops), index.ts (loads the saved recordings, *.json)
src/dev/                    dev-only pages, not in the build: tutorial-recorder.html (+ tutorialRecorder.ts, ClipTimeline.ts, debugTrace.ts)
src/ui/                     SplashScreen.ts (title + menu), Passersby.ts (characters crossing the title screen), LevelSelect.ts, i18n.ts (English → Polish texts), LanguageButton.ts (flag), FrameGuide.ts (calibration dialog, out-of-frame corner box, countdown overlay), fonts.ts, DebugPanel.ts (D), Tuning.ts (G), Recorder.ts (R)
tests/                      synthetic.ts (synthetic pose generator), gestures.test.ts
tests/replay/               replay harness (harness.ts, scenarios.ts; recordings/ for more recordings): recorded pose sessions through the real filters, detectors and PoseSession, with perturbations; behaviour.test.ts pins the behaviour, metrics.test.ts prints the metrics table
tools/generate-placeholder-art.mjs, tools/tutorial-recordings.ts (dev server: saves the recorder's recordings and debug traces), scripts/copy-mediapipe-wasm.mjs
```
- The game knows nothing about poses: it reads a `Controls` object (`lift`, `tilt`, `hover`, `wingPhase`, `flapping`, `pointing`) and `requestPoo()`. Pose and keyboard both produce `Controls`.
- MediaPipe's WASM is copied from `node_modules` into `public/mediapipe/` on `npm install`, so JS and WASM versions always match. The model file (`pose_landmarker_lite.task`) is downloaded from Google's model storage at startup.
