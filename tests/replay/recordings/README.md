# Replay recordings

Pose recordings (`*.json`) put here are picked up by `tests/replay/*.test.ts`: every one is replayed through the
real pose pipeline and has to pass the "clean recording" checks (no false out-of-frame, no recalibration, no stale
controls after the warm-up). The reference recording is `src/tutorial/control-tutorial.json`, which needs no copy.

Format: `PoseRecording` in `src/tutorial/recording.ts` (`version`, `aspect`, `baseline`, `startMs`, `endMs`, `frames`).
Make one with the dev-only recorder (`src/dev/tutorial-recorder.html` on the dev server; it saves to
`src/tutorial/<level>.json`) and copy the file here. The clip (`startMs`..`endMs`) should be someone standing
in front of the camera and playing normally, with nothing going wrong in it: the perturbations (null gaps, hitches,
low visibility, ...) are added by the tests.

Recordings of real play: press **B** in the game (the black box, `src/pose/blackBox.ts`) and copy the
`black-box-<time>.json` here under a telling name (`<date>-<what>.json`). They hold MediaPipe's raw landmarks (no
images), the calibration and the game state per frame. Besides the clean-recording checks they are measured by
`latency.test.ts`: how quickly the bird follows a new pose of the arms, without flicker. The studies of the V, of
continuous steering's agreement and of the arms' smoothing (`poses.test.ts`, `continuous.test.ts`, `armSmoothing.test.ts`)
keep the limits measured on the first player's three recordings; the second player's have their own where they differ.
Present:

- `2026-11-09-gra.json`: a level played (calibration, countdown, play), 60 s, ~23 fps
- `2026-11-09-trening.json`: practice, 60 s of play, ~23 fps
- `2026-11-09-gra-po-strojeniu.json`: a level, 60 s of play, ~25 fps, after the latency tuning ("better, but sometimes too abrupt"; tilted, lowered T held for seconds at 24.5-26.9, 28.7-32.7, 45.3-48.2 s)
- `2026-11-10-drugi-gracz-1.json`: a second player, a child (narrower shoulders: 0.55 of the torso against 0.62-0.64), 60 s of
  play, ~28 fps, format 2 (with the effect, below). Nearly all pointing (77% of play flying, a T next to never); the bird
  on the ground 23% of the time, 5.8 s of it with the arms pointing down and to a side. Arms 80-90° apart (one up, one
  level) match nothing twice, ~0.9 s each (30.3 s, 41.3 s): the bird falls 70 px
- `2026-11-10-drugi-gracz-2.json`: the same player further from the camera (the ankles in view), 60 s of play, ~28 fps,
  format 2. Half of it a T; one arm straight up with the other hanging, which matched nothing before `pointing.oneArm`
  (22.2 s, 24.3-25.3 s, 58.7-60.0 s: 4.5% of play, the bird left on the ground), and a T tilted so steeply that it
  matches nothing either (15.5 s, 20.4-22.2 s: 5.4%). Flying sideways she turns side on to the camera and points down
  and ahead (the far arm hidden: `ArmOcclusion` stands in for it), so the bird skims the ground (12.1 s)

What a black-box dump holds per frame (`BlackBoxFrame`): `t` (ms from the first frame), `lm` (33 raw landmarks
`[x, y, visibility, z]`, or null: nobody), `st` (app state), `pd` / `ce` / `pp` / `in` (person detected, centred,
player present, in frame), `ctl` (the flapping-mode controls; all 0 under pointing control), `ms` (inference ms).
Dumps with `blackBox.format: 2` (made after 2026-11-10) also record the effect, each key absent when not known:

- `pi`: the pointing intent the bird was given at the frame (`{ m, dx, dy, s? }`: mode, direction with y up, sink in
  px per physics step); `null`: none (not playing, a stale pose, flapping mode)
- `bd`: the bird when the frame arrived (`{ x, y, vx, vy, gr?, pe?, die? }`: world px, px per physics step with y
  down; on the ground or something, perched on a branch, dying)
- `dr`: camera frames dropped just before this one (absent: unknown, no frame metadata)
- `lr`: long render frames (> `telemetry.longRenderMs`) since the previous pose frame

and in the `blackBox` header: `format`, `source` (where the frames' time came from: `capture`, `media`, `callback`),
`dropped` and `longRender` (totals over the dump) and `world` (width, height, groundY, the physics step in ms).
`blackBoxEffect(json)` (`src/pose/blackBox.ts`) reads the effect back per frame (null for an older dump);
`parseBlackBox` ignores it, so the replay is the same for both. The three recordings of 2026-11-09 are of the older
kind; the second player's carry it (56 and 47 camera frames dropped, 3%, never two in a row; 468 and 384 long render
frames), and the replay tells the bird what the game told it on 99% of their frames (`blackBox.test.ts`). `pi.sp`
(dumps made after 2026-11-10): a flight's speed as a fraction of the cruising speed, absent at 1; below it the bird
flies by one arm (`pointing.oneArm`).

A recording with a name other than the tutorial's gets no pinned shoot-trigger count; add one in
`tests/replay/behaviour.test.ts` (`EXPECTED_TRIGGERS`) if it should have one.

Metrics for before / after comparisons: `npx vitest run tests/replay/metrics.test.ts` prints the table;
with `VITE_REPLAY_JSON=1` in the environment it also prints the numbers as one JSON line (`REPLAY_METRICS_JSON ...`).
