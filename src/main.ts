import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { countLevelView } from './analytics';
import { audio } from './audio/audio';
import { changedConfig, config, loadSavedConfig } from './config';
import { Game } from './game/Game';
import { firstLevel, gameLevels, levels, nextLevel, onLevelEdited, testLevelName, TRAINING } from './levels';
import { markCompleted, unlockedLevels } from './levels/progress';
import { Thumbnails } from './level/thumbnails';
import { Calibration, type CalibrationStatus } from './gestures/Calibration';
import type { FlapOutput } from './gestures/FlapDetector';
import type { PointingOutput } from './gestures/PointingDetector';
import type { TiltOutput } from './gestures/TiltDetector';
import type { ShootOutput } from './gestures/ShootDetector';
import type { VisibilityOutput } from './gestures/VisibilityMonitor';
import { Keyboard } from './input/keyboard';
import { TouchControls } from './input/touchControls';
import { PoseDetectors } from './input/poseControls';
import { PoseSession, type PoseStep } from './input/poseSession';
import { BlackBox } from './pose/blackBox';
import { startCamera, stopCamera } from './pose/camera';
import { REQUIRED_PARTS } from './pose/landmarks';
import { PoseTracker } from './pose/PoseTracker';
import { outOfFrameCause, recalCause } from './pose/trackingStats';
import type { PoseFrame } from './pose/types';
import { loadAllAssets } from './render/assets';
import { isPortrait } from './render/fitWorld';
import { scenery } from './scenery/scenery';
import { DebugPanel } from './ui/DebugPanel';
import { loadFonts } from './ui/fonts';
import { FrameGuide, type GuideState } from './ui/FrameGuide';
import { FullscreenButton } from './ui/FullscreenButton';
import { MenuButton } from './ui/MenuButton';
import { t, type Msg } from './ui/i18n';
import { LanguageButton } from './ui/LanguageButton';
import { PauseMenu } from './ui/PauseMenu';
import { downloadJson, Recorder } from './ui/Recorder';
import { RotateHint } from './ui/RotateHint';
import { loadRecording } from './tutorial';
import { PoseReplay } from './tutorial/PoseReplay';
import { TUTORIAL_LEVEL, type PoseRecording } from './tutorial/recording';
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
 *   outOfFrame pauses the game (no "Pause" sign, just the small pose box) until the player is back
 *   nobody in front of the camera (no person, or one off to the side) in countdown / playing / outOfFrame:
 *   calibrating again, with the big dialog
 *   calibrating → keyboard (Esc or "No camera"; pose is ignored): on a touch screen with on-screen controls. No camera
 *   to be had (blocked, none, no camera API, the pose model failed): straight on to keyboard instead of calibrating
 *   Esc in a game (countdown, playing, outOfFrame, keyboard) opens the pause menu over the frozen game:
 *   keep playing, start over from the level select, or quit to the menu
 *   playing / outOfFrame / keyboard → gameOver (last life lost) → new game: countdown, or keyboard again
 * Pausing (Space / P in game, or the window losing focus during a game) freezes the game and shows "Pause";
 * not while "Game Over" or "Hooray" is on screen (losing focus then just suspends, without the sign).
 * While paused or while the window is unfocused / hidden, everything is suspended — render loop, guide
 * overlay, pose tracker and the camera itself — so an idle game uses almost no CPU.
 */
type AppState = 'loading' | 'menu' | 'calibrating' | 'countdown' | 'playing' | 'outOfFrame' | 'keyboard' | 'gameOver';

async function main() {
  loadSavedConfig();

  const app = new Application();
  const gameBox = document.getElementById('game')!;
  await app.init({
    // the box, not the window: a phone held upright shows the game in a 16:9 box (see `boxed` below)
    resizeTo: gameBox,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    background: scenery.skyColor,
  });
  gameBox.appendChild(app.canvas);
  // the canvas as big as its box, checked every frame before anything is laid out: the resize event alone isn't enough,
  // iOS Safari may still report the old size while turning, and then the game stays drawn too big
  app.ticker.add(() => {
    if (gameBox.clientWidth !== app.screen.width || gameBox.clientHeight !== app.screen.height) app.resize();
  }, undefined, UPDATE_PRIORITY.HIGH);

  const video = document.getElementById('camera') as HTMLVideoElement;
  const guide = new FrameGuide(document.getElementById('guide') as HTMLCanvasElement, video, app.stage);

  let state: AppState = 'loading';
  /** a keyboard to press Esc on is likely (not a phone or a tablet) */
  const escHint = matchMedia('(hover: hover) and (pointer: fine)').matches ? t('Press Esc to play with the keyboard') : undefined;
  /** camera / pose model status, shown in the calibration dialog (already translated) */
  let poseError: string | null = null;
  /** the camera stopped working after it had started; it's being retried */
  let cameraError: Msg | null = null;
  /** the camera has started at least once (so a missing camera may just be waking up) */
  let cameraStarted = false;
  let manualPause = false;
  /** the pause menu (Esc in a game) is open */
  let menuOpen = false;
  let menuOpenedAt = 0;
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
  let pointingOut: PointingOutput | null = null;
  let calibStatus: CalibrationStatus | null = null;
  let tracker: PoseTracker | null = null;

  /** the window is unfocused / hidden, or the game is paused: nothing runs */
  let suspended = false;
  /** the instructions page is open: its demonstration plays (set up below) */
  let demoOn = false;
  let replay: PoseReplay | null = null;

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
    // the pause menu hides the countdown and the out-of-frame box
    if (menuOpen) gs.mode = 'hidden';
    else if (state === 'loading') Object.assign(gs, { mode: 'loading', message: t('Loading…') });
    else if (state === 'calibrating' && cameraError)
      Object.assign(gs, { mode: 'calibrate', title: t(cameraError), message: t('Reconnecting…'), hint: escHint });
    else if (state === 'calibrating' && (!cameraOn || !tracker))
      Object.assign(gs, { mode: 'calibrate', message: t(cameraOn ? 'Loading pose model…' : 'Starting camera…') });
    else if (state === 'calibrating')
      Object.assign(gs, { mode: 'calibrate', message: calibStatus?.message ?? t('Get into view'), progress: calibStatus?.progress });
    else if (state === 'outOfFrame')
      Object.assign(gs, {
        mode: 'outOfFrame',
        message: cameraError
          ? t('{error} – reconnecting…', { error: t(cameraError) })
          : session.framesLost(now)
            ? t('Tracking lost — stay in the frame')
            : (vis?.hint ?? t('Get into view')),
      });
    else if (state === 'countdown') Object.assign(gs, { mode: 'countdown', countdown: (countdownEnd - now) / 1000 });
    else if (state === 'menu' && demoOn && replay?.recording)
      Object.assign(gs, { mode: 'demo', frame: replay.frame, vis: replay.vis, aspect: replay.recording.aspect });
    guide.draw(gs, now);
    requestAnimationFrame(drawGuide);
  };
  requestAnimationFrame(drawGuide);

  await loadFonts();
  await loadAllAssets();

  const game = new Game(app, firstLevel());
  let allLevels = levels;
  // the instructions' demonstration: the tutorial level, its bird flown by a recorded pose stream (`src/tutorial/`),
  // drawn over the game and under the title screen, which makes way for it
  const tutorialLevel = () => allLevels.get(TUTORIAL_LEVEL) ?? firstLevel();
  const demo = new Game(app, tutorialLevel());
  demo.hud.visible = false;
  replay = new PoseReplay(demo, tutorialLevel);
  const demoReplay = replay;
  // all friends saved: remembered (it opens the next one in the level select), and on to the next level, keeping score,
  // lives back to full (training, or testing a level from the URL: that level again, not remembered)
  game.onLevelComplete = () => {
    if (!testLevelName) markCompleted(game.level.name);
    game.startNextLevel(testLevelName ? game.level : nextLevel(allLevels, game.level.name));
    if (!testLevelName) countLevelView(game.level.name);
  };
  // saving the level being played in Tiled while the dev server runs swaps it in, without reloading the page
  onLevelEdited((next) => {
    allLevels = next;
    const level = next.get(game.level.name);
    // a map saved broken is left out: the game keeps the version it has
    if (level && JSON.stringify(level) !== JSON.stringify(game.level)) game.loadLevel(level);
  });
  // the level select: the latest version of the levels, the finished ones and the first one not finished pickable,
  // that one selected (the last level once all are finished)
  const levelChoice = () => {
    const list = gameLevels(allLevels);
    const unlocked = unlockedLevels(list.map((l) => l.name));
    return { levels: list, unlocked, current: list.filter((l) => unlocked.has(l.name)).at(-1)?.name };
  };
  const splash = new SplashScreen(app, new Thumbnails(app), levelChoice, document.getElementById('guide') as HTMLCanvasElement, levels.has(TRAINING));
  app.stage.addChild(splash);
  // under "Watch", the clip's first moment, frozen; then the world runs on, the bird uncontrolled, while the panel
  // fades in; then the clip plays
  let demoStage: 'frozen' | 'world' | 'playing' = 'frozen';
  // the recording loaded: as far on as the page is
  const playDemo = (rec: PoseRecording) => {
    demoReplay.play(rec, demoStage !== 'playing');
    if (demoStage === 'world') demoReplay.runWorld();
  };
  splash.onInstructions = async (open) => {
    demoOn = open;
    if (!open) return demoReplay.stop();
    demoStage = 'frozen';
    // the level as it is, the bird standing, until the recording loads (none recorded: just that)
    demo.loadLevel(tutorialLevel());
    const rec = await loadRecording(TUTORIAL_LEVEL);
    if (rec && demoOn && !demoReplay.recording) playDemo(rec);
  };
  splash.onWorldStart = () => {
    demoStage = 'world';
    demoReplay.runWorld();
  };
  splash.onDemoStart = () => {
    demoStage = 'playing';
    demoReplay.resume();
  };
  const pauseMenu = new PauseMenu(app);
  app.stage.addChild(pauseMenu);
  const status = document.getElementById('status')!;
  const debug = new DebugPanel(video);
  const tuning = new Tuning();
  const recorder = new Recorder();
  // the last minute of the raw pose stream, saved with B (see `BlackBox`)
  const blackBox = new BlackBox();
  const corner = document.getElementById('corner')!;
  const fullscreen = new FullscreenButton(corner);
  const menuButton = new MenuButton(corner);
  const volume = new VolumeButton(corner);
  const language = new LanguageButton();
  new RotateHint(document.getElementById('rotate')!);
  const keyboard = new Keyboard();
  const touch = new TouchControls(gameBox);
  const detectors = new PoseDetectors();
  const calibration = new Calibration();
  const session = new PoseSession();

  // the calibration dialog's "Back" (the only way out on a phone): to the level select, the level selected, or from
  // training (or a level tested from the URL) to the title screen
  guide.onBack = () => {
    if (state !== 'calibrating') return;
    if (game.level.name === TRAINING || testLevelName) pauseMenu.onQuit();
    else pauseMenu.onRestart();
  };

  // without the camera: the keyboard, or on a touch screen the on-screen controls; no calibration or countdown
  const playWithoutCamera = () => {
    state = 'keyboard';
    audio.startMusic();
  };
  guide.showNoCamera = TouchControls.available;
  guide.onNoCamera = () => {
    if (state === 'calibrating') playWithoutCamera();
  };

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

  // a game from the level select starts on the level picked (none to pick: the first level)
  splash.onStart = (level) => {
    if (level) game.reset(level);
    if (!testLevelName) countLevelView(game.level.name);
    recalibrate();
  };
  // the training letters, A to Z and round, until quit from the pause menu (which goes back to the first level)
  splash.onTraining = () => {
    game.reset(allLevels.get(TRAINING) ?? levels.get(TRAINING));
    countLevelView(game.level.name);
    recalibrate();
  };
  game.onGameOver = () => {
    keyboardAfterGameOver = state === 'keyboard';
    state = 'gameOver';
    gameOverEnd = performance.now() + config.gameOver.showMs;
  };

  /** states where the game is on screen and can be paused */
  let menuShown = false;
  const inGame = () => state === 'countdown' || state === 'playing' || state === 'outOfFrame' || state === 'keyboard' || state === 'gameOver';
  // assumed focused at first: iOS Safari's `document.hasFocus()` is false until the first tap, which would leave the
  // game suspended on the loading screen; a page loaded in the background is caught by `document.hidden` instead
  let focused = true;
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
    session.clear(); // stale pose controls must not apply until a fresh frame arrives
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
          else if (!cameraStarted && isNoCameraError(e)) poseError = t('Camera unavailable');
          else if (!navigator.mediaDevices?.getUserMedia) poseError = t('Camera API not available (the page must be served from localhost or https).');
          else {
            cameraError ??= 'Camera unavailable';
            scheduleRetry();
          }
          return;
        }
        cameraOn = true;
        cameraStarted = true;
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

  const openPauseMenu = () => {
    setPaused(false);
    pauseMenu.open();
    menuOpen = true;
    menuOpenedAt = performance.now();
  };
  pauseMenu.onResume = () => {
    menuOpen = false;
    countdownEnd += performance.now() - menuOpenedAt; // the countdown carries on where it was
  };
  // "Start over": back to the level select, the level being played selected (and calibrating again from there)
  pauseMenu.onRestart = () => {
    const current = game.level.name;
    pauseMenu.onQuit();
    splash.showLevels(current);
  };
  pauseMenu.onQuit = () => {
    menuOpen = false;
    // a new game from the menu starts from the first level (the latest version of it, if edited meanwhile)
    const first = firstLevel();
    game.reset(allLevels.get(first.name) ?? first);
    audio.stopMusic(config.audio.themeFadeMs);
    state = 'menu';
  };

  /** a game on screen that can be paused now: not behind the pause menu, "Game Over" or "Hooray" */
  const canPause = () => inGame() && !menuOpen && !game.showingSign;

  // losing focus pauses a game; elsewhere (menu, calibration, the pause menu, a sign) it just suspends silently
  const onWindowChange = (e: Event) => {
    if (e.type === 'blur' || e.type === 'focus') focused = e.type === 'focus';
    if (!windowActive() && canPause()) manualPause = true;
    updateSuspended();
  };
  window.addEventListener('blur', onWindowChange);
  window.addEventListener('focus', onWindowChange);
  document.addEventListener('visibilitychange', onWindowChange);
  updateSuspended(); // the page may have loaded in the background
  wakeLock.set(!suspended);

  keyboard.onPoo = () => game.requestPoo();
  touch.onPoo = () => game.requestPoo();
  keyboard.onPause = () => {
    if (manualPause) setPaused(false);
    else if (canPause()) setPaused(true);
  };
  keyboard.onHotkey = (k) => {
    if (k === 'd') debug.toggle();
    else if (k === 'g') tuning.toggle();
    else if (k === 'r') recorder.toggle();
    else if (k === 'b') {
      const dump = blackBox.dump({
        model: config.pose.model,
        delegate: tracker?.stats.info?.delegate ?? config.pose.delegate,
        config: changedConfig(),
        flapping: config.pointing.flapping,
      });
      if (dump) downloadJson('black-box', dump);
    }
    else if (k === 'm') volume.toggleMute();
    if (state === 'loading' || state === 'menu' || menuOpen) return;
    if (k === 'p') keyboard.onPause();
    else if (state === 'gameOver') return;
    else if (k === 'c' && tracker) {
      tracker.stats.recalibration('manual');
      recalibrate();
    }
    else if (k === 'escape' && !game.showingSign) {
      if (state === 'calibrating') playWithoutCamera();
      else openPauseMenu();
    }
  };
  // on a touch screen, with no Esc: the menu icon in the corner
  menuButton.onClick = () => {
    if (inGame() && state !== 'gameOver' && !menuOpen && !game.showingSign) openPauseMenu();
  };

  // a step of the session (from a pose frame or a render tick) into the app state, with the telemetry on why
  const applyStep = (step: PoseStep<AppState>, now: number) => {
    if (!vis) return; // no frame yet: the session has nothing to decide
    if (step.recalibrate) tracker?.stats.recalibration(session.framesLost(now) ? 'noPerson' : recalCause(vis));
    else if (step.state === 'outOfFrame' && state !== 'outOfFrame')
      tracker?.stats.outOfFrameEpisode(session.framesLost(now) ? 'noFrames' : outOfFrameCause(vis, REQUIRED_PARTS));
    state = step.state;
    if (step.recalibrate) recalibrate();
  };

  const onPose = (f: PoseFrame | null) => {
    const now = performance.now();
    frame = f;
    // always run the detectors so their state stays continuous; only *apply* them while playing
    const reading = detectors.update(f, now);
    vis = reading.vis;
    recorder.add(f, now);
    if (reading.flap && reading.shoot && reading.tilt && reading.pointing) {
      ({ flap: flapOut, shoot: shootOut, tilt: tiltOut, pointing: pointingOut } = reading);
      debug.record(now, reading.flap, reading.shoot);
    }
    // what the frame means for the game (the rules are in `PoseSession`)
    const step = session.update(state, reading, now);
    if (step.redetect) tracker?.redetect();
    applyStep(step, now);
    if (step.shoot) game.requestPoo();
    if (f) blackBox.aspect = f.aspect;
    const ctl = session.controls(state, now);
    blackBox.add(now, tracker?.raw ?? null, {
      state,
      personDetected: vis.personDetected,
      centred: vis.centred,
      playerPresent: vis.playerPresent,
      inFrame: vis.inFrame,
      lift: ctl.lift,
      tilt: ctl.tilt,
      hover: ctl.hover,
      flapping: ctl.flapping,
      inferenceMs: tracker?.inferenceMs ?? 0,
    });
    // the calibration dialog, also on the frame that brought it up
    if (state === 'calibrating') {
      calibStatus = calibration.update(f, vis);
      if (calibStatus.done) {
        detectors.shoot.calibrate(calibStatus.done);
        blackBox.calibrated(now, calibStatus.done);
        startCountdown();
      }
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
    // no camera to be had: the game goes on without it
    if (state === 'calibrating' && poseError) playWithoutCamera();
    if (state === 'gameOver' && now >= gameOverEnd) {
      game.reset();
      if (keyboardAfterGameOver) state = 'keyboard';
      else startCountdown();
    }
    updateCamera();
    // a gap in the pose goes on without frames too (a hitch): soft pause, then the calibration dialog
    applyStep(session.tick(state, now), now);

    touch.visible = state === 'keyboard' && !menuOpen && !manualPause && !game.showingSign;
    game.controls = keyboard.apply(touch.apply(session.controls(state, now)));
    // during gameOver the game runs only to slide the "Game Over" sign through
    game.paused = manualPause || menuOpen || !(state === 'playing' || state === 'keyboard' || state === 'gameOver');
    game.showPausedText = manualPause;
    // the countdown keeps the calibration dialog's dimming, so it doesn't flicker in between
    game.dimmed = menuOpen || state === 'calibrating' || state === 'countdown';
    splash.visible = state === 'menu';
    // the title screen showing up plays its theme from the start; leaving it fades the theme out
    if (splash.visible && !menuShown) audio.playTheme();
    if (!splash.visible && menuShown) audio.stopTheme(config.audio.themeFadeMs);
    menuShown = splash.visible;
    // not over the instructions' demonstration
    language.visible = splash.visible && !demoOn;
    // only the title screen lets Esc leave full screen; in the game it opens the pause menu
    fullscreen.lockEscape = !splash.visible;
    game.root.visible = !splash.visible;
    // the corner buttons: the volume one only on the title screen; in the game the fullscreen one at the end of the
    // hearts' row, and on a touch screen the menu one after it, or in its place once in full screen
    if (document.body.classList.contains('in-game') === splash.visible) document.body.classList.toggle('in-game', !splash.visible);
    const touchMenu = TouchControls.available && !splash.visible;
    fullscreen.hiddenWhenFull = touchMenu;
    menuButton.visible = touchMenu;
    if (!splash.visible) {
      // over the game's slot for them, at the end of the hearts' row, scaled with the world
      game.cornerIcons = +fullscreen.visible + +menuButton.visible;
      const box = app.canvas.getBoundingClientRect();
      const s = game.root.scale.x;
      const slot = game.cornerSlot;
      corner.style.setProperty('--fs-x', `${box.left + game.root.x + slot.x * s}px`);
      corner.style.setProperty('--fs-y', `${box.top + game.root.y + slot.y * s}px`);
      corner.style.setProperty('--fs-size', `${slot.size * s}px`);
      corner.style.setProperty('--fs-gap', `${slot.gap * s}px`);
    }
    // a phone held upright: the game (and the instructions' demonstration) in a 16:9 box as wide as the screen,
    // with a hint to turn it; the title screen fills it, laid out for it
    const boxed = isPortrait(window.innerWidth, window.innerHeight) && (!splash.visible || demoOn);
    if (document.body.classList.contains('boxed') !== boxed) {
      document.body.classList.toggle('boxed', boxed);
      app.resize();
    }
    demo.root.visible = splash.visible && demoOn;
    demoReplay.update(app.ticker.deltaMS);

    const statusText = recorder.recording ? `● REC ${recorder.seconds.toFixed(0)}s` : '';
    if (status.textContent !== statusText) status.textContent = statusText;

    debug.draw({
      state,
      frame,
      vis,
      flap: flapOut,
      shoot: shootOut,
      tilt: tiltOut,
      pointing: pointingOut,
      fps: tracker?.fps ?? 0,
      inferenceMs: tracker?.inferenceMs ?? 0,
      stats: tracker?.stats ?? null,
      blackBoxSeconds: blackBox.seconds,
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

/** no camera on the device (or none that fits) */
function isNoCameraError(e: unknown) {
  const name = e instanceof Error ? e.name : '';
  return /NotFound|DevicesNotFound|Overconstrained/i.test(name);
}

function isPermissionError(e: unknown) {
  const s = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Permission|NotAllowed/i.test(s);
}

main();
