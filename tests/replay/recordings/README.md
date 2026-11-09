# Replay recordings

Pose recordings (`*.json`) put here are picked up by `tests/replay/*.test.ts`: every one is replayed through the
real pose pipeline and has to pass the "clean recording" checks (no false out-of-frame, no recalibration, no stale
controls after the warm-up). The reference recording is `src/tutorial/control-tutorial.json`, which needs no copy.

Format: `PoseRecording` in `src/tutorial/recording.ts` (`version`, `aspect`, `baseline`, `startMs`, `endMs`, `frames`).
Make one with the dev-only recorder (`src/dev/tutorial-recorder.html` on the dev server; it saves to
`src/tutorial/<level>.json`) and copy the file here. The clip (`startMs`..`endMs`) should be someone standing
in front of the camera and playing normally, with nothing going wrong in it: the perturbations (null gaps, hitches,
low visibility, ...) are added by the tests.

A recording with a name other than the tutorial's gets no pinned shoot-trigger count; add one in
`tests/replay/behaviour.test.ts` (`EXPECTED_TRIGGERS`) if it should have one.

Metrics for before / after comparisons: `npx vitest run tests/replay/metrics.test.ts` prints the table;
with `VITE_REPLAY_JSON=1` in the environment it also prints the numbers as one JSON line (`REPLAY_METRICS_JSON ...`).
