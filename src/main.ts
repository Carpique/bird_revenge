import { Application } from 'pixi.js';
import { audio } from './audio/audio';
import { config, loadSavedConfig } from './config';
import { Game } from './game/Game';
import { firstLevel, levels, nextLevel, onLevelEdited, testLevelName } from './levels';
import { Calibration, type CalibrationStatus } from './gestures/Calibration';
import { FlapDetector, type FlapOutput } from './gestures/FlapDetector';
import { PostureDetector, type PostureOutput } from './gestures/PostureDetector';
import { TiltDetector, type TiltOutput } from './gestures/TiltDetector';
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
import { t, type Msg } from './ui/i18n';
import { LanguageButton } from './ui/LanguageButton';
import { Recorder } from './ui/Recorder';
import { SplashScreen } from './ui/SplashScreen';
import { Tuning } from './ui/Tuning';
import { VolumeButton } from './ui/VolumeButton';
import { wakeLock } from './ui/wakeLock';

/**
 * App states:
 *   loading → menu → calibrating → countdown → playing ⇄ outOfFrame
 *   menu is the splash screen; the pose model loads in the background meanwhile, the camera stays off
 *   the camera runs only in states that use the pose: calibrating, countdown, playing, outOfFrame
 *   and a pose game's gameOver — not in the menu or keyboard play
 *   calibrating shows a dialog over the paused game (also camera loading / camera errors)
 *   outOfFrame keeps the game running with no pose controls, so the bird drops until the player is back
 *   keyboard (Esc toggles; pose is ignored)
 *   playing / outOfFrame / keyboard → gameOver (last life lost) → new game: countdown, or keyboard again
 * Pausing (Space / P in game, or the window losing focus during a game) freezes the game and shows "Pause".
 * While paused or while the window is unfocused / hidden, everything is suspended — render loop, guide
 * overlay, pose tracker and the camera itself — so an idle game uses almost no CPU.
 */
type AppState = 'loading' | 'menu' | 'calibrating' | 'countdown' | 'playing' | 'outOfFrame' | 'keyboard' | 'gameOver';

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
  /** camera / pose model status, shown in the calibration dialog (already translated) */
  let poseError: string | null = null;
  /** the camera stopped working after it had started; it's being retried */
  let cameraError: Msg | null = null;
  let manualPause = false;
  let countdownEnd = 0;
  let gameOverEnd = 0;
  /** whether the game after "Game Over" is played with the keyboard */
  let keyboardAfterGameOver = false;

  // latest pose results
  let frame: PoseFrame | null = null;
  let vis: VisibilityOutput | null = null;
  let flapOut: FlapOutput | null = null;
  let shootOut: ShootOutput | null = null;
  let tiltOut: TiltOutput | null = null;
  let postureOut: PostureOutput | null = null;
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
    if (state === 'loading') Object.assign(gs, { mode: 'loading', message: t('Loading…') });
    else if (state === 'calibrating' && poseError)
      Object.assign(gs, { mode: 'calibrate', title: t('No camera'), message: poseError, error: true, hint: t('Press Esc to play with the keyboard') });
    else if (state === 'calibrating' && cameraError)
      Object.assign(gs, { mode: 'calibrate', title: t(cameraError), message: t('Reconnecting…'), hint: t('Press Esc to play with the keyboard') });
    else if (state === 'calibrating' && (!cameraOn || !tracker))
      Object.assign(gs, { mode: 'calibrate', title: t('Getting ready'), message: t(cameraOn ? 'Loading pose model…' : 'Starting camera…') });
    else if (state === 'calibrating')
      Object.assign(gs, { mode: 'calibrate', message: calibStatus?.message ?? t('Get into view'), progress: calibStatus?.progress });
    else if (state === 'outOfFrame')
      Object.assign(gs, {
        mode: 'outOfFrame',
        message: cameraError ? t('{error} – reconnecting…', { error: t(cameraError) }) : (vis?.hint ?? t('Get into view')),
      });
    else if (state === 'countdown') Object.assign(gs, { mode: 'countdown', countdown: (countdownEnd - now) / 1000 });
    guide.draw(gs, now);
    requestAnimationFrame(drawGuide);
  };
  requestAnimationFrame(drawGuide);

  await loadFonts();
  await loadAllAssets();

  const game = new Game(app, firstLevel());
  let allLevels = levels;
  // all friends saved: on to the next level, keeping score and lives (testing a level from the URL: that level again)
  game.onLevelComplete = () => game.loadLevel(testLevelName ? game.level : nextLevel(allLevels, game.level.name));
  // saving the level being played in Tiled while the dev server runs swaps it in, without reloading the page
  onLevelEdited((next) => {
    allLevels = next;
    const level = next.get(game.level.name);
    // a map saved broken is left out: the game keeps the version it has
    if (level && JSON.stringify(level) !== JSON.stringify(game.level)) game.loadLevel(level);
  });
  const splash = new SplashScreen(app);
  app.stage.addChild(splash);
  const status = document.getElementById('status')!;
  const debug = new DebugPanel(video);
  const tuning = new Tuning();
  const recorder = new Recorder();
  const corner = document.getElementById('corner')!;
  new FullscreenButton(corner);
  const volume = new VolumeButton(corner);
  const language = new LanguageButton();
  const keyboard = new Keyboard();
  const visibility = new VisibilityMonitor();
  const flap = new FlapDetector();
  const shoot = new ShootDetector();
  const tilt = new TiltDetector();
  const posture = new PostureDetector();
  const calibration = new Calibration();

  const startCountdown = () => {
    audio.startMusic();
    state = 'countdown';
    countdownEnd = performance.now() + config.countdownMs;
  };
  const recalibrate = () => {
    if (game.over) game.reset();
    calibration.reset();
    calibStatus = null;
    state = 'calibrating';
  };

  splash.onStart = recalibrate;
  game.onGameOver = () => {
    keyboardAfterGameOver = state === 'keyboard';
    state = 'gameOver';
    gameOverEnd = performance.now() + config.gameOver.showMs;
  };

  /** states where the game is on screen and can be paused */
  let menuShown = false;
  const inGame = () => state === 'countdown' || state === 'playing' || state === 'outOfFrame' || state === 'keyboard' || state === 'gameOver';
  let focused = document.hasFocus();
  const windowActive = () => focused && !document.hidden;

  /** states that use the pose, so the camera has to run */
  const needsCamera = () =>
    state === 'calibrating' || state === 'countdown' || state === 'playing' || state === 'outOfFrame' || (state === 'gameOver' && !keyboardAfterGameOver);
  const wantCamera = () => !suspended && needsCamera();

  // camera + pose tracker follow `wantCamera()`; switching is async, so changes are applied one at a time.
  // A camera that fails to start (e.g. not ready yet after the laptop wakes — the Vite dev server also
  // reloads the page then) or dies while running is retried with backoff; meanwhile the dialogs say
  // it's reconnecting. Only a blocked permission or a missing camera API is final.
  let cameraOn = false;
  let poseSync = Promise.resolve();
  let retryTimer = 0;
  let retryDelay = 500;
  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = window.setTimeout(syncPose, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5000);
  };
  const cameraOff = () => {
    tracker?.stop();
    stopCamera(video);
    cameraOn = false;
    frame = null;
    lastPoseT = 0; // stale pose controls must not apply until a fresh frame arrives
  };
  const onCameraLost = () => {
    console.warn('camera stream ended');
    cameraOff();
    cameraError = 'Camera disconnected';
    if (state === 'countdown' || state === 'playing') state = 'outOfFrame';
    syncPose();
  };
  const syncPose = () => {
    poseSync = poseSync.then(async () => {
      if (poseError) return;
      const want = wantCamera();
      if (want === cameraOn) return;
      if (want) {
        try {
          await startCamera(video, onCameraLost);
        } catch (e) {
          console.error(e);
          if (isPermissionError(e)) poseError = t('Camera access was blocked');
          else if (!navigator.mediaDevices?.getUserMedia) poseError = t('Camera API not available (the page must be served from localhost or https).');
          else {
            cameraError ??= 'Camera unavailable';
            scheduleRetry();
          }
          return;
        }
        cameraOn = true;
        cameraError = null;
        retryDelay = 500;
        if (!wantCamera()) return syncPose(); // no longer wanted while the camera was starting
        tracker?.start(); // if the model is still loading, it starts the tracker once it's ready
      } else {
        cameraOff();
      }
    });
  };

  let suspendedAt = 0;
  const updateSuspended = () => {
    const next = manualPause || !windowActive();
    if (next === suspended) return;
    suspended = next;
    audio.setSuspended(suspended);
    wakeLock.set(!suspended);
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
      gameOverEnd += now - suspendedAt;
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
  wakeLock.set(!suspended);

  keyboard.onPoo = () => game.requestPoo();
  keyboard.onPause = () => {
    if (manualPause || inGame()) setPaused(!manualPause);
  };
  keyboard.onHotkey = (k) => {
    if (k === 'd') debug.toggle();
    else if (k === 'g') tuning.toggle();
    else if (k === 'r') recorder.toggle();
    else if (k === 'm') volume.toggleMute();
    if (state === 'loading' || state === 'menu') return;
    if (k === 'p') keyboard.onPause();
    else if (state === 'gameOver') return;
    else if (k === 'c' && tracker) recalibrate();
    else if (k === 'escape') {
      if (state !== 'keyboard') {
        state = 'keyboard';
        audio.startMusic(); // keyboard play skips calibration and the countdown
      }
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
      tiltOut = tilt.update(f, vis.parts.leftArm.visible, vis.parts.rightArm.visible, flapOut);
      postureOut = posture.update(f, vis.parts.leftArm.visible, vis.parts.rightArm.visible);
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
        if (f && flapOut && shootOut && tiltOut && postureOut) {
          // posture control replaces flapping, tilt and hover; the wings still follow the arms
          const byPosture = !config.posture.flapping;
          poseControls = {
            lift: byPosture ? 0 : flapOut.lift,
            tilt: byPosture ? 0 : tiltOut.tilt,
            hover: !byPosture && tiltOut.spread,
            wingPhase: flapOut.wingPhase,
            flapping: false,
            posture: byPosture ? postureOut.intent : null,
          };
          lastPoseT = now;
          if (shootOut.triggered) game.requestPoo();
        }
        break;
    }
  };

  // the camera follows the state; while suspended `updateSuspended` takes care of it
  let cameraWanted = false;
  const updateCamera = () => {
    const want = wantCamera();
    if (want === cameraWanted) return;
    cameraWanted = want;
    syncPose();
  };

  // per render frame: state timers, controls, HUD, debug
  app.ticker.add(() => {
    const now = performance.now();
    audio.update();
    if (state === 'countdown' && now >= countdownEnd) state = 'playing';
    if (state === 'gameOver' && now >= gameOverEnd) {
      game.reset();
      if (keyboardAfterGameOver) state = 'keyboard';
      else startCountdown();
    }
    updateCamera();

    const poseFresh = state === 'playing' && now - lastPoseT < 300;
    game.controls = keyboard.apply(poseFresh ? poseControls : noControls());
    // during gameOver the game runs only to slide the "Game Over" sign through
    game.paused = manualPause || !(state === 'playing' || state === 'outOfFrame' || state === 'keyboard' || state === 'gameOver');
    game.showPausedText = manualPause;
    game.dimmed = state === 'calibrating';
    splash.visible = state === 'menu';
    // the title screen showing up plays its theme from the start; leaving it fades the theme out
    if (splash.visible && !menuShown) audio.playTheme();
    if (!splash.visible && menuShown) audio.stopTheme(config.audio.themeFadeMs);
    menuShown = splash.visible;
    language.visible = splash.visible;
    game.root.visible = !splash.visible;

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
      tilt: tiltOut,
      posture: postureOut,
      fps: tracker?.fps ?? 0,
      inferenceMs: tracker?.inferenceMs ?? 0,
      now,
    });
  });

  // splash screen first (testing a level from the URL: straight to calibration); the pose model loads in the background,
  // the camera starts with the game
  if (testLevelName) recalibrate();
  else state = 'menu';
  try {
    const t = await PoseTracker.create(video);
    t.onFrame = onPose;
    tracker = t;
    if (cameraOn && !suspended) t.start();
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    poseError = t('Could not start pose tracking: {error}', { error: msg });
    clearTimeout(retryTimer);
    cameraOff();
  }
}

function isPermissionError(e: unknown) {
  const s = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Permission|NotAllowed/i.test(s);
}

main();
