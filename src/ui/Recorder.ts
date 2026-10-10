import { config } from '../config';
import type { PoseFrame } from '../pose/types';

/**
 * Records raw landmark streams to a JSON download (press R to start/stop).
 * Cheap insurance: if the squat heuristic needs ML later, we already have data.
 */
export class Recorder {
  recording = false;
  private frames: { t: number; lm: number[][] }[] = [];
  private aspect = 16 / 9;

  toggle() {
    if (this.recording) this.stop();
    else {
      this.frames = [];
      this.recording = true;
    }
  }

  add(f: PoseFrame | null, now: number) {
    if (!this.recording) return;
    if (f) this.aspect = f.aspect;
    this.frames.push({ t: Math.round(now), lm: f ? f.lm.map((p) => [round(p.x), round(p.y), round(p.v)]) : [] });
  }

  get seconds() {
    const f = this.frames;
    return f.length > 1 ? (f[f.length - 1].t - f[0].t) / 1000 : 0;
  }

  private stop() {
    this.recording = false;
    const data = { version: 1, recordedAt: new Date().toISOString(), aspect: this.aspect, config, frames: this.frames };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pose-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

const round = (x: number) => Math.round(x * 10000) / 10000;
