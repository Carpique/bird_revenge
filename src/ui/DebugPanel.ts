import type { FlapOutput } from '../gestures/FlapDetector';
import type { SquatOutput } from '../gestures/SquatDetector';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { config } from '../config';
import { PART_NAMES, SKELETON } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';

interface Sample {
  t: number;
  aL: number;
  aR: number;
  lift: number;
  depth: number;
  squat: boolean;
}

const HISTORY_MS = 5000;

/** Small panel (toggle with D): camera + skeleton, live signal plot, numbers. */
export class DebugPanel {
  private root = document.getElementById('debug')!;
  private canvas = document.getElementById('debug-canvas') as HTMLCanvasElement;
  private textEl = document.getElementById('debug-text')!;
  private ctx = this.canvas.getContext('2d')!;
  private history: Sample[] = [];

  constructor(private video: HTMLVideoElement) {}

  get visible() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
  }

  record(t: number, flap: FlapOutput | null, squat: SquatOutput | null) {
    if (!flap || !squat) return;
    this.history.push({ t, aL: flap.left.angle, aR: flap.right.angle, lift: flap.lift, depth: squat.depth, squat: squat.squatting });
    while (this.history.length && t - this.history[0].t > HISTORY_MS) this.history.shift();
  }

  draw(info: {
    state: string;
    frame: PoseFrame | null;
    vis: VisibilityOutput | null;
    flap: FlapOutput | null;
    squat: SquatOutput | null;
    fps: number;
    inferenceMs: number;
    now: number;
  }) {
    if (!this.visible) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const camH = 180;
    ctx.clearRect(0, 0, W, this.canvas.height);

    // camera + skeleton (mirrored)
    if (this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, W, camH);
      ctx.restore();
    } else {
      ctx.fillStyle = '#ddd';
      ctx.fillRect(0, 0, W, camH);
    }
    const f = info.frame;
    if (f) {
      const X = (x: number) => (1 - x) * W, Y = (y: number) => y * camH;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of SKELETON) {
        ctx.moveTo(X(f.lm[a].x), Y(f.lm[a].y));
        ctx.lineTo(X(f.lm[b].x), Y(f.lm[b].y));
      }
      ctx.stroke();
      const minV = config.visibility.minLandmarkVisibility;
      for (const p of f.lm) {
        ctx.fillStyle = p.v >= minV ? '#2f9e44' : '#e03131';
        ctx.fillRect(X(p.x) - 2, Y(p.y) - 2, 4, 4);
      }
    }

    // plot: arm angles (0..180), lift (0..max), squat depth (0..1)
    const py = camH + 8, ph = this.canvas.height - py - 4;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, py, W, ph);
    ctx.strokeStyle = '#ccc';
    ctx.strokeRect(0.5, py + 0.5, W - 1, ph - 1);
    const h = this.history;
    if (h.length > 1) {
      const t0 = info.now - HISTORY_MS;
      const X = (t: number) => ((t - t0) / HISTORY_MS) * W;
      for (const s of h) {
        if (s.squat) {
          ctx.fillStyle = 'rgba(132, 94, 247, 0.15)';
          ctx.fillRect(X(s.t), py, 3, ph);
        }
      }
      const line = (get: (s: Sample) => number, max: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        h.forEach((s, i) => {
          const y = py + ph - Math.max(0, Math.min(1, get(s) / max)) * ph;
          if (i === 0) ctx.moveTo(X(s.t), y);
          else ctx.lineTo(X(s.t), y);
        });
        ctx.stroke();
      };
      line((s) => s.aL, 180, '#1c7ed6');
      line((s) => s.aR, 180, '#f08c00');
      line((s) => s.lift, config.flap.maxLiftAccel, '#2f9e44');
      line((s) => s.depth, 1, '#845ef7');
      // squat enter threshold
      const ty = py + ph - config.squat.depthEnter * ph;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#845ef7';
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(W, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = '11px ui-monospace, monospace';
    [['L arm', '#1c7ed6'], ['R arm', '#f08c00'], ['lift', '#2f9e44'], ['squat depth', '#845ef7']].forEach(([n, c], i) => {
      ctx.fillStyle = c;
      ctx.fillText(n, 6 + i * 60, py + 13);
    });

    // numbers
    const fl = info.flap, sq = info.squat, vis = info.vis;
    const n = (x: number, d = 0) => x.toFixed(d).padStart(5);
    const lines = [
      `state     ${info.state}`,
      `pose      ${n(info.fps)} fps  ${n(info.inferenceMs, 1)} ms`,
      '',
      fl ? `arm  angle   vel  power strk  Hz` : '',
      fl ? `L   ${n(fl.left.angle)} ${n(fl.left.velocity)} ${n(fl.left.power)} ${String(fl.left.strokes).padStart(4)} ${fl.left.frequency.toFixed(1).padStart(4)}` : '',
      fl ? `R   ${n(fl.right.angle)} ${n(fl.right.velocity)} ${n(fl.right.power)} ${String(fl.right.strokes).padStart(4)} ${fl.right.frequency.toFixed(1).padStart(4)}` : '',
      fl ? `lift ${n(fl.lift)} px/s²  steer ${n(fl.steer)}` : '',
      '',
      sq ? `squat depth ${sq.depth.toFixed(2)}  knees ${n(sq.kneeLeft)} ${n(sq.kneeRight)}` : '',
      sq ? `squatting ${sq.squatting ? 'YES' : 'no'}` : '',
      '',
      vis ? 'parts ' + PART_NAMES.map((p) => `${p}:${vis.parts[p].visible ? '✓' : '✗'}`).join(' ') : '',
      vis?.hint ? `hint  ${vis.hint}` : '',
    ];
    this.textEl.textContent = lines.join('\n');
  }
}
