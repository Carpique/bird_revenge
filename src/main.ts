import { Application } from 'pixi.js';
import { config, loadSavedConfig } from './config';
import { Game } from './game/Game';
import { Calibration, type CalibrationStatus } from './gestures/Calibration';
import { FlapDetector, type FlapOutput } from './gestures/FlapDetector';
import { SquatDetector, type SquatOutput } from './gestures/SquatDetector';
import { VisibilityMonitor, type VisibilityOutput } from './gestures/VisibilityMonitor';
import { noControls, type Controls } from './input/controls';
import { Keyboard } from './input/keyboard';
import { startCamera } from './pose/camera';
import { PoseTracker } from './pose/PoseTracker';
import type { PoseFrame } from './pose/types';
import { loadAllAssets } from './render/assets';
import { scenery } from './scenery/scenery';
import { DebugPanel } from './ui/DebugPanel';
import { FrameGuide, type GuideState } from './ui/FrameGuide';
import { Recorder } from './ui/Recorder';
import { Tuning } from './ui/Tuning';

/**
 * App states:
 *   loading → calibrating → countdown → playing ⇄ outOfFrame
 *   outOfFrame keeps the game running with no pose controls, so the bird drops until the player is back
 *   error (no camera) / keyboard (K toggles; pose is ignored)
 */
type AppState = 'loading' | 'error' | 'calibrating' | 'countdown' | 'playing' | 'outOfFrame' | 'keyboard';

async function main() {
  loadSavedConfig();

  const app = new Application();
  await app.init({
    resizeTo: window,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    background: scenery.skyColor,
  });
  document.getElementById('game')!.appendChild(app.canvas);

  const video = document.getElementById('camera') as HTMLVideoElement;
  const guide = new FrameGuide(document.getElementById('guide') as HTMLCanvasElement, video);

  let state: AppState = 'loading';
  let errorMessage = '';
  let loadingMessage = 'Loading…';
  let manualPause = false;
  let countdownEnd = 0;
  let resumeState: AppState = 'calibrating';

  // latest pose results
  let frame: PoseFrame | null = null;
  let vis: VisibilityOutput | null = null;
  let flapOut: FlapOutput | null = null;
  let squatOut: SquatOutput | null = null;
  let calibStatus: CalibrationStatus | null = null;
  let poseControls: Controls = noControls();
  let lastPoseT = 0;
  let tracker: PoseTracker | null = null;

  // the guide is drawn every animation frame, also while loading
  const drawGuide = () => {
    const now = performance.now();
    const gs: GuideState = { mode: 'hidden', frame, vis };
    if (state === 'loading') Object.assign(gs, { mode: 'loading', message: loadingMessage });
    else if (state === 'error') Object.assign(gs, { mode: 'error', message: errorMessage });
    else if (state === 'calibrating')
      Object.assign(gs, { mode: 'calibrate', message: calibStatus?.message ?? 'Get fully into view', progress: calibStatus?.progress });
    else if (state === 'outOfFrame') Object.assign(gs, { mode: 'outOfFrame', message: vis?.hint ?? 'Get fully into view' });
    else if (state === 'countdown') Object.assign(gs, { mode: 'countdown', countdown: (countdownEnd - now) / 1000 });
    guide.draw(gs, now);
    requestAnimationFrame(drawGuide);
  };
  requestAnimationFrame(drawGuide);

  try {
    await document.fonts.load('40px "Patrick Hand"');
  } catch {
    /* fallback font */
  }
  await loadAllAssets();

  const game = new Game(app);
  const debug = new DebugPanel(video);
  const tuning = new Tuning();
  const recorder = new Recorder();
  const keyboard = new Keyboard();
  const visibility = new VisibilityMonitor();
  const flap = new FlapDetector();
  const squat = new SquatDetector();
  const calibration = new Calibration();

  const startCountdown = () => {
    state = 'countdown';
    countdownEnd = performance.now() + config.countdownMs;
  };
  const recalibrate = () => {
    calibration.reset();
    calibStatus = null;
    state = 'calibrating';
  };

  keyboard.onPoo = () => game.requestPoo();
  keyboard.onHotkey = (k) => {
    if (k === 'd') debug.toggle();
    else if (k === 'g') tuning.toggle();
    else if (k === 'r') recorder.toggle();
    else if (k === 'p') manualPause = !manualPause;
    else if (k === 'c' && tracker) recalibrate();
    else if (k === 'k') {
      if (state === 'keyboard') {
        state = resumeState === 'error' ? 'error' : squat.baseline ? 'outOfFrame' : 'calibrating';
      } else if (state !== 'loading') {
        resumeState = state;
        state = 'keyboard';
      }
    }
  };

  const onPose = (f: PoseFrame | null) => {
    const now = performance.now();
    frame = f;
    vis = visibility.update(f, now);
    recorder.add(f, now);
    // always run the detectors so their state stays continuous; only *apply* them while playing
    if (f) {
      flapOut = flap.update(f, vis.parts.leftArm.visible, vis.parts.rightArm.visible);
      squatOut = squat.update(f, vis.parts.leftLeg.visible && vis.parts.rightLeg.visible);
      debug.record(now, flapOut, squatOut);
    }

    switch (state) {
      case 'calibrating':
        calibStatus = calibration.update(f, vis);
        if (calibStatus.done) {
          squat.calibrate(calibStatus.done);
          startCountdown();
        }
        break;
      case 'countdown':
        if (!vis.allVisible) state = 'outOfFrame';
        break;
      case 'outOfFrame':
        if (vis.allVisible) state = 'playing';
        break;
      case 'playing':
        if (!vis.allVisible) {
          state = 'outOfFrame';
          break;
        }
        if (f && flapOut && squatOut) {
          poseControls = { lift: flapOut.lift, steer: flapOut.steer, wingPhase: flapOut.wingPhase, flapping: false };
          lastPoseT = now;
          // mirrored view: the player's left is on the screen's left, so the poo flies towards the raised leg
          if (squatOut.triggered) game.requestPoo(squatOut.raisedLeg === 'left' ? -1 : squatOut.raisedLeg === 'right' ? 1 : 0);
        }
        break;
    }
  };

  // per render frame: state timers, controls, HUD, debug
  app.ticker.add(() => {
    const now = performance.now();
    if (state === 'countdown' && now >= countdownEnd) state = 'playing';

    const poseFresh = state === 'playing' && now - lastPoseT < 300;
    game.controls = keyboard.apply(poseFresh ? poseControls : noControls());
    game.paused = manualPause || !(state === 'playing' || state === 'outOfFrame' || state === 'keyboard');

    const mode = state === 'keyboard' || state === 'error' ? 'keyboard' : 'pose';
    const rec = recorder.recording ? `  ● REC ${recorder.seconds.toFixed(0)}s` : '';
    const fps = tracker ? `  ${tracker.fps.toFixed(0)} fps` : '';
    game.setStatus(`${mode}${fps}${rec}`);

    debug.draw({
      state,
      frame,
      vis,
      flap: flapOut,
      squat: squatOut,
      fps: tracker?.fps ?? 0,
      inferenceMs: tracker?.inferenceMs ?? 0,
      now,
    });
  });

  // camera + pose model
  try {
    loadingMessage = 'Starting camera…';
    await startCamera(video);
    loadingMessage = 'Loading pose model…';
    tracker = await PoseTracker.create(video);
    tracker.onFrame = onPose;
    tracker.start();
    recalibrate();
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    errorMessage = /Permission|NotAllowed/i.test(msg) ? 'Camera access was blocked' : `Could not start pose tracking: ${msg}`;
    state = 'error';
    game.paused = true;
  }
}

main();
