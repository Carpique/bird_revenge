import { Application } from 'pixi.js';
import { audio } from '../audio/audio';
import { config, loadSavedConfig } from '../config';
import { Game } from '../game/Game';
import { Calibration } from '../gestures/Calibration';
import type { ShootBaseline } from '../gestures/ShootDetector';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { noControls, type Controls } from '../input/controls';
import { controlsFrom, PoseDetectors } from '../input/poseControls';
import { poseGap } from '../pose/freshness';
import { levels, onLevelEdited } from '../levels';
import { startCamera } from '../pose/camera';
import { PoseTracker, type PoseTiming } from '../pose/PoseTracker';
import type { PoseFrame } from '../pose/types';
import { loadAllAssets } from '../render/assets';
import { scenery } from '../scenery/scenery';
import { PoseReplay } from '../tutorial/PoseReplay';
import { toPoseFrame, toRecordedFrame, TUTORIAL_LEVEL, type PoseRecording, type RecordedFrame } from '../tutorial/recording';
import { BIG_FILL, BIG_FONT, BIG_OUTLINE, loadFonts } from '../ui/fonts';
import { FrameGuide, type GuideState } from '../ui/FrameGuide';
import { ClipTimeline, MOTION_POINTS } from './ClipTimeline';
import { serializeTrace, TraceLog, type DebugTrace } from './debugTrace';

/**
 * Dev-only tool (`npm run dev`, then /src/dev/tutorial-recorder.html; `?level=<name>` for another level than
 * the tutorial's): records the pose stream the instructions page plays. It looks like the instructions page — the
 * level, the bird flown by the live pose, the pose panel on the left. Record counts down, records until the player
 * stands still, then the clip can be trimmed, played back as the instructions page will play it, and saved to
 * `src/tutorial/<level>.json`, or recorded anew.
 * With "Debug trace" on (`?trace=<file>` turns it on with that file name), a take is a debug trace instead
 * (`debugTrace.ts`): it doesn't stop on standing still (Esc ends it), and is saved whole, as soon as it ends, to
 * `traces/<file>.json` — not to the tutorial.
 */

/** s of countdown before recording starts */
const COUNTDOWN_S = 5;
/** recording stops once the player has stood still this long (ms)... */
const STILL_MS = 3000;
/** ...with none of `MOTION_POINTS` moving further than this (image heights) */
const STILL_RANGE = 0.035;
/** frames kept before the clip's start, to warm the detectors up when it plays */
const PREROLL_MS = 1000;

type Mode = 'live' | 'countdown' | 'recording' | 'review';

async function main() {
  loadSavedConfig();
  const levelName = new URLSearchParams(location.search).get('level') ?? TUTORIAL_LEVEL;
  let level = levels.get(levelName);
  if (!level) throw new Error(`No level "${levelName}"; there are: ${[...levels.keys()].join(', ')}`);

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
  const guide = new FrameGuide(document.getElementById('guide') as HTMLCanvasElement, video, app.stage);
  guide.draw({ mode: 'loading', frame: null, vis: null }, performance.now());
  await loadFonts();
  await loadAllAssets();

  const game = new Game(app, level);
  game.hud.visible = false;
  const replay = new PoseReplay(game, () => level!);

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const bar = $('recorder'), statusEl = $('rec-status'), countdownEl = $('countdown'), badge = $('rec-badge');
  Object.assign(countdownEl.style, { fontFamily: BIG_FONT, color: BIG_FILL, webkitTextStroke: `8px ${BIG_OUTLINE}` });
  const buttons = {
    record: $<HTMLButtonElement>('btn-record'),
    play: $<HTMLButtonElement>('btn-play'),
    save: $<HTMLButtonElement>('btn-save'),
    live: $<HTMLButtonElement>('btn-live'),
    calibrate: $<HTMLButtonElement>('btn-calibrate'),
  };
  const timeline = new ClipTimeline($<HTMLCanvasElement>('timeline'));
  const traceOn = $<HTMLInputElement>('trace-on'), traceName = $<HTMLInputElement>('trace-name');
  const traceParam = new URLSearchParams(location.search).get('trace');
  if (traceParam !== null) {
    traceOn.checked = true;
    traceName.value = traceParam;
  }
  traceName.disabled = !traceOn.checked;
  traceOn.onchange = () => {
    traceName.disabled = !traceOn.checked;
    traceOn.blur();
  };
  // Enter / Esc in the file name: back to the shortcuts
  traceName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') traceName.blur();
  });

  let mode: Mode = 'live';
  let message = '';
  let barHidden = false;

  // the live pose: the game's own pipeline, calibrated once (again with "Recalibrate")
  const detectors = new PoseDetectors();
  const calibration = new Calibration();
  let baseline: ShootBaseline | null = null;
  let calibMessage = '';
  let liveFrame: PoseFrame | null = null;
  let liveVis: VisibilityOutput | null = null;
  let liveControls: Controls = noControls();
  let lastPoseT = -Infinity;
  let aspect = 16 / 9;
  let cameraError: string | null = null;
  let tracker: PoseTracker | null = null;

  // the take: frames from the countdown's start (the countdown's are the clip's warm-up), the recording from `recStartMs`
  let take: RecordedFrame[] = [];
  let takeStart = 0;
  let recStartMs = 0;
  let countdownEnd = 0;
  let lastBeep = 0;
  /** the player has moved since recording started, so standing still now ends it */
  let moved = false;
  /** when the player last moved, and where to: standing still is measured from here */
  let anchor: { t: number; pts: [number, number][] } | null = null;
  /** the take is a debug trace (the switch as it was when it started): its frames are `TraceFrame`s */
  let tracing = false;
  const traceLog = new TraceLog();

  // reviewing: the recording being trimmed, whether it's saved as it is, and the frame shown while scrubbing
  let current: PoseRecording | null = null;
  let saved = false;
  /** the take reviewed is a debug trace, saved to `traces/<file>.json` */
  let currentTrace: { file: string; trace: DebugTrace } | null = null;
  let scrubFrame: PoseFrame | null = null;

  const setLevel = (next: typeof level) => {
    if (!next) return;
    level = next;
    if (mode === 'live') game.loadLevel(next);
  };
  onLevelEdited((next) => setLevel(next.get(levelName)));

  const goLive = () => {
    replay.stop();
    mode = 'live';
    game.loadLevel(level!);
    game.paused = false;
    message = '';
  };

  const startCountdown = () => {
    if (!cameraOk()) return;
    tracing = traceOn.checked;
    if (tracing && !traceFile()) {
      message = 'Debug trace: the file name may only have letters, digits, - _ and .';
      return;
    }
    traceLog.reset();
    replay.stop();
    mode = 'countdown';
    game.loadLevel(level!);
    game.paused = true;
    take = [];
    takeStart = performance.now();
    countdownEnd = takeStart + COUNTDOWN_S * 1000;
    lastBeep = COUNTDOWN_S + 1;
    message = '';
  };

  const startRecording = () => {
    mode = 'recording';
    recStartMs = performance.now() - takeStart;
    game.loadLevel(level!);
    game.paused = false;
    moved = false;
    anchor = null;
    audio.play('coin');
  };

  /** Recording ends (standing still, or Esc): on to trimming it, the whole take as the clip to begin with. */
  const stopRecording = () => {
    if (mode === 'countdown') return goLive();
    audio.play('button');
    const last = take.at(-1)?.t ?? recStartMs;
    if (last - recStartMs < 500) {
      message = 'Too short — nothing recorded';
      return goLive();
    }
    const rec: PoseRecording = {
      version: 1,
      level: levelName,
      aspect,
      flapping: config.pointing.flapping,
      oneArm: config.pointing.oneArm,
      baseline,
      startMs: recStartMs,
      endMs: last,
      frames: take,
    };
    const file = tracing && traceFile();
    review(rec, false, file ? { file, trace: { ...rec, kind: 'debug-trace', recordedAt: new Date().toISOString(), config, frames: take as DebugTrace['frames'], events: traceLog.events } } : null);
    if (currentTrace) save();
  };

  const review = (rec: PoseRecording, isSaved: boolean, trace: typeof currentTrace = null) => {
    current = rec;
    currentTrace = trace;
    saved = isSaved;
    mode = 'review';
    timeline.set(rec.frames, rec.aspect, rec.startMs, rec.endMs);
    play();
  };

  const play = () => {
    if (!current) return;
    scrubFrame = null;
    replay.play({ ...current, startMs: timeline.startMs, endMs: timeline.endMs });
  };
  const togglePlay = () => {
    if (mode !== 'review') return;
    if (replay.recording) {
      replay.stop();
      timeline.playhead = replay.time;
      scrubFrame = replay.frame;
    } else play();
  };

  timeline.onTrim = (startMs, endMs) => {
    if (!current) return;
    current = { ...current, startMs, endMs };
    saved = false;
  };
  timeline.onScrub = (t) => {
    if (!current) return;
    replay.stop();
    const f = [...current.frames].reverse().find((f) => f.t <= t) ?? current.frames[0];
    scrubFrame = toPoseFrame(f, current.aspect);
  };

  /** the debug trace's file name as typed (".json" optional), null if it isn't one the dev server takes */
  const traceFile = () => {
    const name = traceName.value.trim().replace(/\.json$/i, '') || `trace-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    return /^[\w-][\w.-]*$/.test(name) ? name : null;
  };

  const save = async () => {
    if (mode !== 'review' || !current) return;
    // a debug trace: the whole take, the clip as trimmed only marked by its start and end
    const [route, name, body, where] = currentTrace
      ? ['__trace', currentTrace.file, serializeTrace({ ...currentTrace.trace, startMs: timeline.startMs, endMs: timeline.endMs }), `traces/${currentTrace.file}.json`]
      : ['__tutorial', levelName, serialize(crop(current)), `src/tutorial/${levelName}.json`];
    try {
      const res = await fetch(`/${route}?name=${encodeURIComponent(name)}`, { method: 'POST', body });
      if (!res.ok) throw new Error(await res.text());
      saved = true;
      message = `Saved to ${where}`;
      audio.play('friend');
    } catch (e) {
      message = `Save failed: ${e instanceof Error ? e.message : e}`;
    }
  };

  const recalibrate = () => {
    baseline = null;
    calibration.reset();
  };

  const cameraOk = () => {
    if (cameraError) message = `No camera: ${cameraError}`;
    return !cameraError;
  };

  buttons.record.onclick = startCountdown;
  buttons.play.onclick = togglePlay;
  buttons.save.onclick = save;
  buttons.live.onclick = goLive;
  buttons.calibrate.onclick = recalibrate;
  // buttons keep no focus, so Space and the arrows reach the shortcuts
  for (const b of Object.values(buttons)) b.addEventListener('mouseup', () => b.blur());

  window.addEventListener('keydown', (e) => {
    // typing the trace's file name
    if (e.target === traceName) return;
    if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape' && (mode === 'countdown' || mode === 'recording')) stopRecording();
    else if (k === 'r' && (mode === 'live' || mode === 'review')) startCountdown();
    else if (k === ' ') togglePlay();
    else if (k === 's') save();
    else if (k === 'l' && mode === 'review') goLive();
    else if (k === 'c') recalibrate();
    else if (k === 't' && mode !== 'countdown' && mode !== 'recording') {
      traceOn.checked = !traceOn.checked;
      traceOn.onchange?.(e);
    }
    else if (k === 'h') barHidden = !barHidden;
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && mode === 'review') timeline.nudge((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
    else return;
    e.preventDefault();
  });

  /** Whether the player has stood still for `STILL_MS` (since moving at all after recording started). */
  const standingStill = (f: PoseFrame | null, t: number): boolean => {
    if (!f) {
      anchor = null;
      return false;
    }
    const pts = MOTION_POINTS.map((i): [number, number] => [f.lm[i].x * f.aspect, f.lm[i].y]);
    const a = anchor;
    if (!a || pts.some(([x, y], i) => Math.hypot(x - a.pts[i][0], y - a.pts[i][1]) > STILL_RANGE)) {
      if (a) moved = true;
      anchor = { t, pts };
      return false;
    }
    return moved && t - a.t >= STILL_MS;
  };

  // the frame's own time (`PoseTiming.t`), as in the game; the ticker's `performance.now()` is the same timebase
  const onPose = (f: PoseFrame | null, timing: PoseTiming) => {
    const now = timing.t;
    const r = detectors.update(f, now);
    liveFrame = f;
    liveVis = r.vis;
    if (f) aspect = f.aspect;
    if (!baseline) {
      const c = calibration.update(f, r.vis);
      calibMessage = c.message;
      if (c.done) {
        baseline = c.done;
        detectors.shoot.calibrate(baseline);
        audio.play('button');
      }
    }
    // a frame from before the take started (its time is the camera's, earlier than the callback) is not in it
    if ((mode === 'countdown' || mode === 'recording') && now >= takeStart)
      take.push(tracing ? traceLog.add(f, now - takeStart, r, tracker?.raw ?? null, tracker?.inferenceMs ?? 0, tracker?.smoother.occlusion.standIn) : toRecordedFrame(f, now - takeStart));
    // a debug trace runs until Esc: holding a pose still is what it's for
    if (mode === 'recording' && !tracing && standingStill(f, now)) stopRecording();
    if (mode === 'live' || mode === 'recording') {
      // as in the game: out of frame, the pose controls nothing
      if (!r.vis.inFrame) lastPoseT = -Infinity;
      const c = r.vis.inFrame ? controlsFrom(r) : null;
      if (c) {
        liveControls = c;
        lastPoseT = now;
        if (r.shoot?.triggered) game.requestPoo();
      }
    }
  };

  app.ticker.add((ticker) => {
    const now = performance.now();
    if (mode === 'countdown') {
      const left = Math.ceil((countdownEnd - now) / 1000);
      if (left < lastBeep && left > 0) {
        lastBeep = left;
        audio.play('button');
      }
      if (now >= countdownEnd) startRecording();
    }
    if (mode === 'live' || mode === 'recording') game.controls = poseGap(now - lastPoseT) === 'fresh' ? liveControls : noControls();
    replay.update(ticker.deltaMS);
    if (mode === 'review' && replay.recording) timeline.playhead = replay.time;

    const away = mode === 'countdown' || mode === 'recording';
    bar.hidden = barHidden || away;
    traceOn.disabled = away;
    traceName.disabled = away || !traceOn.checked;
    countdownEl.hidden = mode !== 'countdown';
    if (mode === 'countdown') countdownEl.textContent = String(Math.max(1, Math.ceil((countdownEnd - now) / 1000)));
    badge.hidden = mode !== 'recording';
    if (mode === 'recording') {
      const stillFor = moved && anchor ? (now - anchor.t) / 1000 : 0;
      badge.textContent = `● ${tracing ? 'TRACE' : 'REC'} ${((now - takeStart - recStartMs) / 1000).toFixed(1)}s` + (stillFor > 0.5 ? `  ■ ${(STILL_MS / 1000 - stillFor).toFixed(1)}` : '');
    }
    buttons.play.disabled = buttons.save.disabled = buttons.live.disabled = mode !== 'review';
    buttons.play.textContent = replay.recording ? '❚❚ Stop' : '▶ Play clip';
    buttons.save.textContent = (currentTrace ? 'Save trace' : 'Save') + (saved ? ' ✓' : '');
    statusEl.textContent = statusText();
    timeline.draw();

    const gs: GuideState = { mode: 'demo', frame: liveFrame, vis: liveVis };
    if (mode === 'review' && current) Object.assign(gs, replay.recording ? { frame: replay.frame, vis: replay.vis } : { frame: scrubFrame, vis: null }, { aspect: current.aspect });
    guide.draw(gs, now);
  });

  const statusText = () => {
    const calib = baseline ? 'calibrated' : `calibrating: ${calibMessage || 'stand in view, arms down, hold still'} (poo needs it)`;
    const ctrl = config.pointing.flapping ? 'flapping' : 'pointing';
    const trace = currentTrace && mode === 'review'
      ? ` · debug trace: ${currentTrace.trace.frames.length} frames, ${currentTrace.trace.events.filter((e) => e.type === 'outOfFrame').length}× out of frame`
      : '';
    const head = `${levelName} · ${ctrl} · ${cameraError ? `camera: ${cameraError}` : calib}${trace}`;
    const clip = mode === 'review' && current
      ? `\nclip ${(timeline.startMs / 1000).toFixed(2)}–${(timeline.endMs / 1000).toFixed(2)} s (${((timeline.endMs - timeline.startMs) / 1000).toFixed(2)} s of ${(timeline.duration / 1000).toFixed(2)} s)` +
        (current.flapping !== config.pointing.flapping ? ` · recorded with ${current.flapping ? 'flapping' : 'pointing'}` : '')
      : '';
    return head + clip + (message ? `\n${message}` : '');
  };

  // a recording saved before: straight to trimming it again (Live / Record to make a new one)
  try {
    const res = await fetch(`/__tutorial?name=${encodeURIComponent(levelName)}`);
    if (res.ok) review((await res.json()) as PoseRecording, true);
    else goLive();
  } catch {
    goLive();
  }

  try {
    await startCamera(video, () => (cameraError = 'disconnected — reload the page'));
    tracker = await PoseTracker.create(video);
    tracker.onFrame = onPose;
    tracker.start();
  } catch (e) {
    console.error(e);
    cameraError = e instanceof Error ? e.message : String(e);
  }
}

/** The clip and `PREROLL_MS` before it (the detectors' warm-up), its times from the first frame kept. */
function crop(rec: PoseRecording): PoseRecording {
  const from = Math.max(0, rec.startMs - PREROLL_MS);
  const frames = rec.frames.filter((f) => f.t >= from && f.t <= rec.endMs);
  const base = frames[0]?.t ?? 0;
  return {
    ...rec,
    startMs: rec.startMs - base,
    endMs: rec.endMs - base,
    frames: frames.map((f) => ({ ...f, t: f.t - base })),
  };
}

/** JSON with one frame per line, so the file diffs line by line. */
function serialize(rec: PoseRecording): string {
  const { frames, ...head } = rec;
  const body = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  return `${body},\n  "frames": [\n${frames.map((f) => `    ${JSON.stringify(f)}`).join(',\n')}\n  ]\n}\n`;
}

// a failed start says why on the page, not just in the console
main().catch((e) => {
  console.error(e);
  document.getElementById('rec-status')!.textContent = `Recorder failed to start: ${e instanceof Error ? e.message : e}`;
});
