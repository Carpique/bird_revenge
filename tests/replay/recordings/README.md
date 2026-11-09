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

A recording with a name other than the tutorial's gets no pinned shoot-trigger count; add one in
`tests/replay/behaviour.test.ts` (`EXPECTED_TRIGGERS`) if it should have one.

Metrics for before / after comparisons: `npx vitest run tests/replay/metrics.test.ts` prints the table;
with `VITE_REPLAY_JSON=1` in the environment it also prints the numbers as one JSON line (`REPLAY_METRICS_JSON ...`).
