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
`latency.test.ts`: how quickly the bird follows a new pose of the arms, without flicker. Present:

- `2026-11-09-gra.json`: a level played (calibration, countdown, play), 60 s, ~23 fps
- `2026-11-09-trening.json`: practice, 60 s of play, ~23 fps
- `2026-11-09-gra-po-strojeniu.json`: a level, 60 s of play, ~25 fps, after the latency tuning ("better, but sometimes too abrupt"; tilted, lowered T held for seconds at 24.5-26.9, 28.7-32.7, 45.3-48.2 s)

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
`parseBlackBox` ignores it, so the replay is the same for both. The three recordings above are of the older kind.

A recording with a name other than the tutorial's gets no pinned shoot-trigger count; add one in
`tests/replay/behaviour.test.ts` (`EXPECTED_TRIGGERS`) if it should have one.

Metrics for before / after comparisons: `npx vitest run tests/replay/metrics.test.ts` prints the table;
with `VITE_REPLAY_JSON=1` in the environment it also prints the numbers as one JSON line (`REPLAY_METRICS_JSON ...`).
