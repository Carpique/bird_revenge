import type { Game } from '../game/Game';
import { STEP_MS } from '../game/physics';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { noControls, type Controls } from '../input/controls';
import { controlsFrom, POSE_STALE_MS, PoseDetectors } from '../input/poseControls';
import type { LevelDef } from '../level/types';
import type { PoseFrame } from '../pose/types';
import { toPoseFrame, type PoseRecording } from './recording';

/** ms the last moment of a loop stays on screen before the next one starts */
export const LOOP_PAUSE_MS = 1000;

/**
 * Plays a recorded pose stream in `game`, round and round: its frames go through the same gesture detectors as the
 * live camera's, and the controls they give fly the bird. Each loop starts the level afresh, with fresh detectors
 * warmed up on the frames before the clip, and frames are handed over by game time, physics step by physics step,
 * so every loop flies exactly the same way. While it plays it owns the game's `controls`, `onStep` and `paused`.
 */
export class PoseReplay {
  /** the pose frame played last (null: nobody in view), and what the visibility monitor made of it, for the panel */
  frame: PoseFrame | null = null;
  vis: VisibilityOutput | null = null;
  /** where the replay is, ms in the recording's time */
  time = 0;

  private rec: PoseRecording | null = null;
  private frames: (PoseFrame | null)[] = [];
  private next = 0;
  private detectors = new PoseDetectors();
  private controls: Controls = noControls();
  private lastPoseT = -Infinity;
  /** ms left of the pause after a loop; 0 while playing */
  private holdMs = 0;
  /** held at the clip's start until `resume()`: no controls, the game paused unless `runWorld()` */
  private held = false;

  /** `level`: the level to play in, asked for on every loop (it may be edited meanwhile) */
  constructor(
    private game: Game,
    private level: () => LevelDef,
  ) {}

  get recording(): PoseRecording | null {
    return this.rec;
  }

  /** Play `rec`'s clip, from its start; `held`: frozen on its first moment until `resume()`. */
  play(rec: PoseRecording, held = false) {
    this.rec = rec;
    this.frames = rec.frames.map((f) => toPoseFrame(f, rec.aspect));
    this.game.onStep = () => this.step();
    this.restart();
    this.held = held;
    if (held) this.game.paused = true;
  }

  /** A clip held by `play(rec, true)`: the game runs on, the bird left uncontrolled, the clip still at its start. */
  runWorld() {
    if (this.rec && this.held) this.game.paused = false;
  }

  /** Start playing a clip held by `play(rec, true)`. */
  resume() {
    if (!this.rec || !this.held) return;
    this.held = false;
    this.game.paused = false;
  }

  /** Stop playing; the game is left paused. */
  stop() {
    this.rec = null;
    this.held = false;
    this.game.onStep = null;
    this.game.controls = noControls();
    this.game.paused = true;
  }

  /** Per render frame: the pause between loops. */
  update(dtMs: number) {
    if (!this.rec || this.held || this.holdMs <= 0) return;
    this.holdMs -= dtMs;
    if (this.holdMs <= 0) this.restart();
  }

  private restart() {
    const rec = this.rec!;
    this.game.loadLevel(this.level());
    this.detectors = new PoseDetectors();
    if (rec.baseline) this.detectors.shoot.calibrate(rec.baseline);
    this.controls = noControls();
    this.lastPoseT = -Infinity;
    this.next = 0;
    this.time = rec.startMs;
    this.feed(this.time);
    this.game.controls = noControls();
    this.holdMs = 0;
    this.game.paused = false;
  }

  /** Before each physics step: the frames up to the step's time go through the detectors, and their controls apply. */
  private step() {
    const rec = this.rec;
    if (!rec || this.held || this.holdMs > 0) return;
    this.time += STEP_MS;
    if (this.time > rec.endMs) {
      this.holdMs = LOOP_PAUSE_MS;
      this.game.controls = noControls();
      this.game.paused = true;
      return;
    }
    const poo = this.feed(this.time);
    this.game.controls = this.time - this.lastPoseT < POSE_STALE_MS ? this.controls : noControls();
    if (poo) this.game.requestPoo();
  }

  /** Runs the frames up to `until` (ms) through the detectors; whether one of them dropped a poo. */
  private feed(until: number): boolean {
    const rec = this.rec!;
    let poo = false;
    while (this.next < this.frames.length && rec.frames[this.next].t <= until) {
      const t = rec.frames[this.next].t;
      const f = this.frames[this.next++];
      const r = this.detectors.update(f, t);
      this.frame = f;
      this.vis = r.vis;
      // as in the game: out of frame, the pose controls nothing; a frame without a person leaves the last controls to go stale
      if (!r.vis.inFrame) this.lastPoseT = -Infinity;
      const c = r.vis.inFrame ? controlsFrom(r, !rec.flapping) : null;
      if (!c) continue;
      this.controls = c;
      this.lastPoseT = t;
      if (r.shoot?.triggered) poo = true;
    }
    return poo;
  }
}
