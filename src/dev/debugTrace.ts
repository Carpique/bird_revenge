import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Config } from '../config';
import type { PointingMode } from '../game/pointing';
import type { PoseReading } from '../input/poseControls';
import { PART_NAMES, REQUIRED_PARTS, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { toRecordedFrame, type PoseRecording, type RecordedFrame } from '../tutorial/recording';

/** One frame of a debug trace: the recorded frame (smoothed landmarks, as the detectors get them) plus what the tracker and the detectors made of it. */
export interface TraceFrame extends RecordedFrame {
  /** MediaPipe's landmarks before smoothing: [x, y, z, visibility] per landmark; null: nobody in view */
  raw: [number, number, number, number][] | null;
  /** ms the pose model took on the frame */
  ms: number;
  /** per body part (`VisibilityMonitor`): [visible in this frame 0/1, smoothed score, debounced visible 0/1] */
  parts: Record<PartName, [number, number, number]>;
  /** all required parts visible: false opens the game's "get back in frame" panel */
  inFrame: boolean;
  /** the pointing detector: arm angles on screen (deg, null: arm not visible), this frame's pose and the one the bird follows */
  pointing: { left: number | null; right: number | null; candidate: PointingMode | null; intent: PointingMode | null } | null;
}

/**
 * What the visibility monitor decided, when it changed. `outOfFrame` / `inFrame` open and close the game's panel;
 * `lost` / `back` are a required part's debounced visibility (what makes `inFrame`); `raw` a required part's
 * visibility in single frames flipping (`problem`: why it isn't visible, null when it is again).
 */
export type TraceEvent =
  | { t: number; type: 'start'; inFrame: boolean; hint: string | null }
  | { t: number; type: 'outOfFrame' | 'inFrame'; hint: string | null }
  | { t: number; type: 'lost' | 'back'; part: PartName; problem: string | null; score: number }
  | { t: number; type: 'raw'; part: PartName; problem: string | null }
  | { t: number; type: 'personLost' | 'personFound' }
  | { t: number; type: 'hint'; hint: string | null };

/**
 * A take recorded with "Debug trace" on (`traces/<name>.json`, through the dev server): a pose recording, so it
 * plays back like one, with every frame's raw estimates and confidences and the visibility monitor's events.
 */
export interface DebugTrace extends PoseRecording {
  kind: 'debug-trace';
  recordedAt: string;
  config: Config;
  frames: TraceFrame[];
  events: TraceEvent[];
}

/** Builds a take's trace frames and events, frame by frame. */
export class TraceLog {
  events: TraceEvent[] = [];
  private prev: PoseReading['vis'] | null = null;

  reset() {
    this.events = [];
    this.prev = null;
  }

  /** The trace frame for `f` (`t`: ms into the take), logging the visibility changes since the last one. */
  add(f: PoseFrame | null, t: number, r: PoseReading, raw: NormalizedLandmark[] | null, ms: number): TraceFrame {
    t = Math.round(t);
    const { vis, pointing } = r;
    const prev = this.prev;
    const log = (e: TraceEvent) => this.events.push(e);
    if (!prev) log({ t, type: 'start', inFrame: vis.inFrame, hint: vis.hint });
    else {
      if (prev.personDetected !== vis.personDetected) log({ t, type: vis.personDetected ? 'personFound' : 'personLost' });
      for (const part of REQUIRED_PARTS) {
        const a = prev.parts[part], b = vis.parts[part];
        if (a.raw !== b.raw) log({ t, type: 'raw', part, problem: b.problem });
        if (a.visible !== b.visible) log({ t, type: b.visible ? 'back' : 'lost', part, problem: b.problem, score: round(b.score, 3) });
      }
      if (prev.inFrame !== vis.inFrame) log({ t, type: vis.inFrame ? 'inFrame' : 'outOfFrame', hint: vis.hint });
      else if (prev.hint !== vis.hint) log({ t, type: 'hint', hint: vis.hint });
    }
    this.prev = vis;

    const parts = Object.fromEntries(PART_NAMES.map((n) => {
      const p = vis.parts[n];
      return [n, [+p.raw, round(p.score, 3), +p.visible]];
    })) as TraceFrame['parts'];
    return {
      ...toRecordedFrame(f, t),
      raw: raw && raw.map((p) => [round(p.x, 4), round(p.y, 4), round(p.z, 4), round(p.visibility, 3)]),
      ms: round(ms, 1),
      parts,
      inFrame: vis.inFrame,
      pointing: pointing && {
        left: pointing.left === null ? null : round(pointing.left, 1),
        right: pointing.right === null ? null : round(pointing.right, 1),
        candidate: pointing.candidate?.mode ?? null,
        intent: pointing.intent?.mode ?? null,
      },
    };
  }
}

/** JSON with one frame and one event per line. */
export function serializeTrace(trace: DebugTrace): string {
  const { frames, events, config, ...head } = trace;
  const lines = (a: unknown[]) => `[\n${a.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
  const body = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  return `${body},\n  "config": ${JSON.stringify(config)},\n  "events": ${lines(events)},\n  "frames": ${lines(frames)}\n}\n`;
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
