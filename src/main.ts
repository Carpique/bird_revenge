import { Application } from 'pixi.js';
import { config, loadSavedConfig } from './config';
import { Game } from './game/Game';
import { Calibration, type CalibrationStatus } from './gestures/Calibration';
import { FlapDetector, type FlapOutput } from './gestures/FlapDetector';
import { ShootDetector, type ShootOutput } from './gestures/ShootDetector';
import { VisibilityMonitor, type VisibilityOutput } from './gestures/VisibilityMonitor';
import { noControls, type Controls } from './input/controls';
import { Keyboard } from './input/keyboard';
import { startCamera, stopCamera } from './pose/camera';
import { PoseTracker } from './pose/PoseTracker';
import type { PoseFrame } from './pose/types';
import { loadAllAssets } from './render/assets';
import { scenery } from './scenery/scenery';
import { DebugPanel } from './ui/DebugPanel';
import { loadFonts } from './ui/fonts';
import { FrameGuide, type GuideState } from './ui/FrameGuide';
import { FullscreenButton } from './ui/FullscreenButton';
import { Recorder } from './ui/Recorder';
import { SplashScreen } from './ui/SplashScreen';
import { Tuning } from './ui/Tuning';

/**
 * App states:
 *   loading → menu → calibrating → countdown → playing ⇄ outOfFrame
 *   menu is the splash screen; camera and pose model load in the background meanwhile
 *   calibrating shows a dialog over the paused game (also camera loading / camera errors)
 *   outOfFrame keeps the game running with no pose controls, so the bird drops until the player is back
 *   keyboard (K toggles; pose is ignored)
 * Pausing (Space / P in game, or the window losing focus during a game) freezes the game and shows "Pause".
 * While paused or while the window is unfocused / hidden, everything is suspended — render loop, guide
 * overlay, pose tracker and the camera itself — so an idle game uses almost no CPU.
 */
type AppState = 'loading' | 'menu' | 'calibrating' | 'countdown' | 'playing' | 'outOfFrame' | 'keyboard';

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
  /** camera / pose model status, shown in the calibration dialog */
  let poseError: string | null = null;
  let loadingMessage = 'Loading…';
  let manualPause = false;
  let countdownEnd = 0;

  // latest pose results
  let frame: PoseFrame | null = null;
  let vis: VisibilityOutput | null = null;
  let flapOut: FlapOutput | null = null;
  let shootOut: ShootOutput | null = null;
  let calibStatus: CalibrationStatus | null = null;
  let poseControls: Controls = noControls();
  let lastPoseT = 0;
  let tracker: PoseTracker | null = null;

  /** the window is unfocused / hidden, or the game is paused: nothing runs */
  let suspended = false;

  // the guide is drawn every animation frame, also while loading (not while suspended)
  let guideRunning = true;
  const drawGuide = () => {
    const now = performance.now();
    if (suspended) {
      // a manual pause hides the dialogs behind the "Pause" sign; otherwise the last frame stays as is
      if (manualPause) guide.draw({ mode: 'hidden', frame, vis }, now);
      guideRunning = false;
      return;
    }
    const gs: GuideState = { mode: 'hidden', frame, vis };
    if (state === 'loading') Object.assign(gs, { mode: 'loading', message: loadingMessage });
    else if (state === 'calibrating' && poseError)
      Object.assign(gs, { mode: 'calibrate', title: 'No camera', message: poseError, error: true, hint: 'Press K to play with the keyboard' });
    else if (state === 'calibrating' && !tracker) Object.assign(gs, { mode: 'calibrate', title: 'Getting ready', message: loadingMessage });
    else if (state === 'calibrating')
      Object.assign(gs, { mode: 'calibrate', message: calibStatus?.message ?? 'Get into view', progress: calibStatus?.progress });
    else if (state === 'outOfFrame') Object.assign(gs, { mode: 'outOfFrame', message: vis?.hint ?? 'Get into view' });
    else if (state === 'countdown') Object.assign(gs, { mode: 'countdown', countdown: (countdownEnd - now) / 1000 });
    guide.draw(gs, now);
    requestAnimationFrame(drawGuide);
  };
  requestAnimationFrame(drawGuide);

  await loadFonts();
  await loadAllAssets();

  const game = new Game(app);
  const splash = new SplashScreen(app);
  app.stage.addChild(splash);
  const help = document.getElementById('help')!;
  const status = document.getElementById('status')!;
  const debug = new DebugPanel(video);
  const tuning = new Tuning();
  const recorder = new Recorder();
  new FullscreenButton();
  const keyboard = new Keyboard();
  const visibility = new VisibilityMonitor();
  const flap = new FlapDetector();
  const shoot = new ShootDetector();
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

  splash.onStart = recalibrate;

  /** states where the game is on screen and can be paused */
  const inGame = () => state === 'countdown' || state === 'playing' || state === 'outOfFrame' || state === 'keyboard';
  let focused = document.hasFocus();
  const windowActive = () => focused && !document.hidden;

  // camera + pose tracker follow `suspended`; switching is async, so changes are applied one at a time
  let cameraOn = false;
  let poseSync = Promise.resolve();
  const syncPose = () => {
    poseSync = poseSync.then(async () => {
      if (!tracker || poseError) return;
      const want = !suspended;
      if (want === cameraOn) return;
      if (want) {
        try {
          await startCamera(video);
        } catch (e) {
          console.error(e);
          poseError = 'Could not restart the camera';
          return;
        }
        cameraOn = true;
        if (suspended) return syncPose(); // suspended again while the camera was starting
        tracker.start();
      } else {
        tracker.stop();
        stopCamera(video);
        cameraOn = false;
        frame = null;
        lastPoseT = 0; // stale pose controls must not apply until a fresh frame arrives
      }
    });
  };

  let suspendedAt = 0;
  const updateSuspended = () => {
    const next = manualPause || !windowActive();
    if (next === suspended) return;
    suspended = next;
    const now = performance.now();
    if (suspended) {
      suspendedAt = now;
      // render one last frame (with the "Pause" sign if paused), then stop the render loop
      game.paused = true;
      game.showPausedText = manualPause;
      app.ticker.update(now);
      app.ticker.stop();
    } else {
      countdownEnd += now - suspendedAt;
      app.ticker.start();
      if (!guideRunning) {
        guideRunning = true;
        requestAnimationFrame(drawGuide);
      }
    }
    syncPose();
  };
  const setPaused = (paused: boolean) => {
    manualPause = paused;
    updateSuspended();
  };

  // losing focus pauses a game; elsewhere (menu, calibration) it just suspends silently
  const onWindowChange = (e: Event) => {
    if (e.type === 'blur' || e.type === 'focus') focused = e.type === 'focus';
    if (!windowActive() && inGame()) manualPause = true;
    updateSuspended();
  };
  window.addEventListener('blur', onWindowChange);
  window.addEventListener('focus', onWindowChange);
  document.addEventListener('visibilitychange', onWindowChange);
  updateSuspended(); // the page may have loaded in the background

  keyboard.onPoo = () => game.requestPoo();
  keyboard.onPause = () => {
    if (manualPause || inGame()) setPaused(!manualPause);
  };
  keyboard.onHotkey = (k) => {
    if (k === 'd') debug.toggle();
    else if (k === 'g') tuning.toggle();
    else if (k === 'r') recorder.toggle();
    if (state === 'loading' || state === 'menu') return;
    if (k === 'p') keyboard.onPause();
    else if (k === 'c' && tracker) recalibrate();
    else if (k === 'k') {
      if (state !== 'keyboard') state = 'keyboard';
      else state = shoot.baseline && !poseError ? 'outOfFrame' : 'calibrating';
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
      shootOut = shoot.update(f, vis.parts.torso.visible);
      debug.record(now, flapOut, shootOut);
    }

    switch (state) {
      case 'calibrating':
        calibStatus = calibration.update(f, vis);
        if (calibStatus.done) {
          shoot.calibrate(calibStatus.done);
          startCountdown();
        }
        break;
      case 'countdown':
        if (!vis.inFrame) state = 'outOfFrame';
        break;
      case 'outOfFrame':
        if (vis.inFrame) state = 'playing';
        break;
      case 'playing':
        if (!vis.inFrame) {
          state = 'outOfFrame';
          break;
        }
        if (f && flapOut && shootOut) {
          poseControls = { lift: flapOut.lift, steer: flapOut.steer, wingPhase: flapOut.wingPhase, flapping: false };
          lastPoseT = now;
          // mirrored view: the player's left is on the screen's left, so the poo flies towards the raised leg
          if (shootOut.triggered) game.requestPoo(shootOut.raisedLeg === 'left' ? -1 : shootOut.raisedLeg === 'right' ? 1 : 0);
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
    game.showPausedText = manualPause;
    splash.visible = state === 'menu';
    game.root.visible = !splash.visible;
    help.hidden = state === 'menu' || state === 'loading';

    const mode = state === 'keyboard' || poseError ? 'keyboard' : 'pose';
    const rec = recorder.recording ? `  ● REC ${recorder.seconds.toFixed(0)}s` : '';
    const fps = tracker ? `  ${tracker.fps.toFixed(0)} fps` : '';
    const statusText = `${mode}${fps}${rec}`;
    if (status.textContent !== statusText) status.textContent = statusText;

    debug.draw({
      state,
      frame,
      vis,
      flap: flapOut,
      shoot: shootOut,
      fps: tracker?.fps ?? 0,
      inferenceMs: tracker?.inferenceMs ?? 0,
      now,
    });
  });

  // splash screen first; camera + pose model load in the background
  state = 'menu';
  try {
    loadingMessage = 'Starting camera…';
    await startCamera(video);
    cameraOn = true;
    loadingMessage = 'Loading pose model…';
    tracker = await PoseTracker.create(video);
    tracker.onFrame = onPose;
    if (!suspended) tracker.start();
    syncPose(); // turns the camera off if the window was left while loading
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    poseError = /Permission|NotAllowed/i.test(msg) ? 'Camera access was blocked' : `Could not start pose tracking: ${msg}`;
  }
}

main();
