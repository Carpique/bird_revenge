import { changedConfig, config } from '../config';
import type { BirdSample } from '../game/Bird';
import type { Game } from '../game/Game';
import type { Controls } from '../input/controls';
import type { PoseReading } from '../input/poseControls';
import { BlackBox } from '../pose/blackBox';
import type { PoseTiming, PoseTracker } from '../pose/PoseTracker';
import type { PoseFrame } from '../pose/types';
import { DebugPanel } from '../ui/DebugPanel';
import { downloadJson, Recorder } from '../ui/Recorder';
import { Tuning } from '../ui/Tuning';

/**
 * The development tools, on hotkeys: D the debug panel, G tuning (lil-gui), R the pose recorder, B the black box
 * (the last minute of the raw pose stream). Dev server only: `main.ts` loads this module behind
 * `import.meta.env.DEV`, so none of it (lil-gui included) is in the production build.
 */
export class DevTools {
  private readonly debug: DebugPanel;
  private readonly tuning = new Tuning();
  private readonly recorder = new Recorder();
  private readonly blackBox = new BlackBox();
  /** the bird's state per pose frame (one object, filled in place) and the long render frames counted so far */
  private readonly birdSample: BirdSample = { x: 0, y: 0, vx: 0, vy: 0, onGround: false, perched: false, dying: false };
  private longRenderSeen = 0;

  constructor(
    video: HTMLVideoElement,
    private readonly status: HTMLElement,
  ) {
    this.debug = new DebugPanel(video);
  }

  /** D, G, R, B; other keys are ignored. */
  hotkey(k: string, tracker: PoseTracker | null) {
    if (k === 'd') this.debug.toggle();
    else if (k === 'g') this.tuning.toggle();
    else if (k === 'r') this.recorder.toggle();
    else if (k === 'b') {
      const dump = this.blackBox.dump({
        model: config.pose.model,
        delegate: tracker?.stats.info?.delegate ?? config.pose.delegate,
        config: changedConfig(),
        flapping: config.pointing.flapping,
        source: tracker?.stats.source ?? null,
      });
      if (dump) downloadJson('black-box', dump);
    }
  }

  /** Per pose frame, after the session has applied it: `ctl` is what the pose gives the bird now. */
  pose(f: PoseFrame | null, timing: PoseTiming, reading: PoseReading, state: string, ctl: Controls, tracker: PoseTracker | null, game: Game) {
    const now = timing.t;
    const { vis } = reading;
    this.recorder.add(f, now);
    this.debug.record(now, reading.flap, reading.shoot);
    if (f) this.blackBox.aspect = f.aspect;
    // the long render frames since the previous pose frame (the count starts again when the stats are reset)
    const longRender = tracker ? tracker.stats.longRenderFrames : 0;
    const longSince = longRender >= this.longRenderSeen ? longRender - this.longRenderSeen : longRender;
    this.longRenderSeen = longRender;
    this.blackBox.add(now, tracker?.raw ?? null, {
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
      // the effect: what the bird is told and where it is when the frame arrives
      intent: ctl.pointing,
      bird: game.birdState(this.birdSample),
      dropped: timing.dropped,
      longRender: longSince,
    });
  }

  calibrated(...args: Parameters<BlackBox['calibrated']>) {
    this.blackBox.calibrated(...args);
  }

  /** Per render frame: the recording indicator and the debug panel. */
  draw(info: Omit<Parameters<DebugPanel['draw']>[0], 'blackBoxSeconds'>) {
    const statusText = this.recorder.recording ? `● REC ${this.recorder.seconds.toFixed(0)}s` : '';
    if (this.status.textContent !== statusText) this.status.textContent = statusText;
    this.debug.draw({ ...info, blackBoxSeconds: this.blackBox.seconds });
  }
}
