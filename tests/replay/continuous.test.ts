import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { continuousArms, type PointingIntent } from '../../src/game/pointing';
import { STEP_MS } from '../../src/game/physics';
import { type Vec } from '../../src/gestures/geometry';
import { commandLag, jumps, perFrame, velocityOf, type FrameRow } from './command';
import { fly, jolts } from './flight';
import { allRecordings, simulate, type Recording, type Tick } from './harness';
import { latency } from './latency';

/**
 * Continuous steering (`pointing.continuous`) against the pose modes on the recordings of real play (black-box
 * dumps), through the real pipeline: (i) the poses without the V (`vUp` off), (ii) the poses as they are (`vUp`
 * on, the default), (iii) continuous. Per recording: the time the arms ask for nothing and the drops for it; the
 * bird flown with Matter.js; where (ii) means something, what (iii) asks for there (on the same smoothed arms);
 * how far the asked-for velocity lags the arms; the continuous command's jumps. Prints the tables, pins the main
 * results. Open loop: the player reacted to the discrete bird, not to this one.
 */

const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');
const short = (r: Recording) => r.name.replace(/^2026-11-(09|10)-/, '');

type Cfg = 'old' | 'vUp' | 'cont';
const CFGS: Cfg[] = ['old', 'vUp', 'cont'];
const LABEL: Record<Cfg, string> = { old: '(i) poses, vUp off', vUp: '(ii) poses, vUp on', cont: '(iii) continuous' };

function withCfg<T>(c: Cfg, fn: () => T, extra: Partial<typeof config.pointing> = {}): T {
  const p = config.pointing;
  const was = { ...p };
  p.vUp = c !== 'old';
  p.continuous = c === 'cont';
  Object.assign(p, extra);
  try {
    return fn();
  } finally {
    Object.assign(p, was);
  }
}

const DEG = 180 / Math.PI;
const dir = (deg: number): Vec => ({ x: Math.cos(deg / DEG), y: Math.sin(deg / DEG) });
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : NaN);
const speedOf = (p: PointingIntent) => Math.hypot(p.vx ?? 0, p.vy ?? 0);
const inCone = (deg: number) => angDiff(deg, -90) <= config.pointing.restCone;


interface PoseStats {
  playMs: number;
  unmatchedMs: number;
  drops: number;
  dropMs: number;
  /** at rest with the arms out of the rest cone: the time and the longest stretch (ms) */
  restOutMs: number;
  restOutMax: number;
}

function poseStats(rows: FrameRow[]): PoseStats {
  const s: PoseStats = { playMs: 0, unmatchedMs: 0, drops: 0, dropMs: 0, restOutMs: 0, restOutMax: 0 };
  let dropping = false, out = 0;
  for (const { dt, out: p } of rows) {
    s.playMs += dt;
    if (!p.candidate) s.unmatchedMs += dt;
    const drop = !p.candidate && p.intent!.mode === 'rest';
    if (drop) {
      s.dropMs += dt;
      if (!dropping) s.drops++;
    }
    dropping = drop;
    const restOut = p.intent!.mode === 'rest' && !(inCone(p.left!) && inCone(p.right!));
    out = restOut ? out + dt : 0;
    if (restOut) s.restOutMs += dt;
    s.restOutMax = Math.max(s.restOutMax, out);
  }
  return s;
}

interface MotionStats {
  jolts: number;
  up: number;
  down: number;
  still: number;
  /** px fallen per minute at rest */
  fallRest: number;
}

function motionStats(ticks: Tick[]): MotionStats {
  const vs = fly(ticks);
  let fall = 0;
  ticks.forEach((k, i) => {
    if ((k.intent?.mode ?? 'rest') === 'rest' && vs[i].y > 0) fall += vs[i].y;
  });
  const n = vs.length;
  return {
    jolts: jolts(vs),
    up: pct(vs.filter((v) => v.y < -0.5).length, n),
    down: pct(vs.filter((v) => v.y > 0.5).length, n),
    still: pct(vs.filter((v) => Math.hypot(v.x, v.y) <= 0.5).length, n),
    fallRest: (fall / (n * STEP_MS)) * 60000,
  };
}


interface Agreement {
  parAng: number[];
  parSpeed: number[];
  vAng: number[];
  vSpeed: number[];
  hover: number[];
  driftSame: number;
  driftN: number;
  driftSpeed: number[];
  /** where (ii) descends: its sink, the continuous one, and whether the sideways direction agrees */
  descSinkD: number[];
  descSinkC: number[];
  descSame: number;
  descN: number;
  /** of those, where the arms are still in the T (its candidate a drift), not lowered past it and held for `ambiguousMs` */
  descInT: number;
  descInTSame: number;
  descInTSinkC: number[];
  descInTSinkD: number[];
  none: { up: number; down: number; side: number; still: number; n: number; speed: number[] };
  oneArm: { up: number; down: number; side: number; still: number; n: number; speed: number[] };
}

const kind = (v: Vec) => {
  const s = Math.hypot(v.x, v.y);
  if (s < 0.5) return 'still';
  if (-v.y >= Math.abs(v.x)) return 'up';
  if (v.y >= Math.abs(v.x)) return 'down';
  return 'side';
};

/** what continuous steering asks for on (ii)'s smoothed arms, where (ii) reads something */
function agreement(rows: FrameRow[], extra: Partial<typeof config.pointing> = {}): Agreement {
  const a: Agreement = {
    parAng: [], parSpeed: [], vAng: [], vSpeed: [], hover: [], driftSame: 0, driftN: 0, driftSpeed: [],
    descSinkD: [], descSinkC: [], descSame: 0, descN: 0, descInT: 0, descInTSame: 0, descInTSinkC: [], descInTSinkD: [],
    none: { up: 0, down: 0, side: 0, still: 0, n: 0, speed: [] },
    oneArm: { up: 0, down: 0, side: 0, still: 0, n: 0, speed: [] },
  };
  withCfg('cont', () => {
    for (const { out } of rows) {
      const cand = out.candidate, intent = out.intent!;
      const c = continuousArms(dir(out.left!), dir(out.right!));
      if (c.mode === 'rest') continue;
      const v = velocityOf(c), sp = speedOf(c);
      if (cand?.mode === 'fly') {
        const d = angDiff(Math.atan2(cand.dy, cand.dx) * DEG, Math.atan2(-v.y, v.x) * DEG);
        const parallel = angDiff(out.left!, out.right!) <= config.pointing.parallelMax;
        (parallel ? a.parAng : a.vAng).push(d);
        (parallel ? a.parSpeed : a.vSpeed).push(sp / config.pointing.cruiseSpeed);
      } else if (cand?.mode === 'hover') a.hover.push(sp);
      else if (cand?.mode === 'drift') {
        a.driftN++;
        if (Math.sign(v.x) === Math.sign(cand.dx)) a.driftSame++;
        a.driftSpeed.push(sp);
      } else if (!cand) {
        const b = a.none;
        b[kind(v)]++;
        b.n++;
        b.speed.push(sp);
      }
      if (intent.mode === 'drift' && (intent.sink ?? 0) > 0) {
        a.descN++;
        a.descSinkD.push(intent.sink!);
        a.descSinkC.push(Math.max(0, v.y));
        if (Math.sign(v.x) === Math.sign(intent.dx)) a.descSame++;
        if (cand?.mode === 'drift') {
          a.descInT++;
          a.descInTSinkC.push(Math.max(0, v.y));
          a.descInTSinkD.push(intent.sink!);
          if (Math.sign(v.x) === Math.sign(intent.dx)) a.descInTSame++;
        }
      }
      // one arm hanging, the other not: left to the vector sum
      if (inCone(out.left!) !== inCone(out.right!)) {
        const b = a.oneArm;
        b[kind(v)]++;
        b.n++;
        b.speed.push(sp);
      }
    }
  }, extra);
  return a;
}


interface Result {
  pose: Record<Cfg, PoseStats>;
  motion: Record<Cfg, MotionStats>;
  lag: Record<'vUp' | 'cont', number>;
  lat: Record<'vUp' | 'cont', ReturnType<typeof latency>>;
  agree: Agreement;
  jumps: number[];
  sweep: { m0: number; hover: number[]; vSpeed: number[]; none: number[] }[];
  tiltSweep: { full: number; drift: number[] }[];
}

const results = new Map<string, Result>();
const table = (head: string[], rows: (string | number)[][]) =>
  [head, ...rows].map((r) => r.map((x, i) => String(x).padStart(i === 0 ? 18 : Math.max(8, head[i].length))).join(' ')).join('\n');

beforeAll(() => {
  for (const r of dumps) {
    const rows = {} as Record<Cfg, FrameRow[]>;
    const ticks = {} as Record<Cfg, Tick[]>;
    for (const c of CFGS)
      withCfg(c, () => {
        rows[c] = perFrame(r);
        ticks[c] = simulate(r, r.frames, { startState: 'playing' }).ticks.filter((k) => k.state === 'playing');
      });
    const res: Result = {
      pose: Object.fromEntries(CFGS.map((c) => [c, poseStats(rows[c])])) as Record<Cfg, PoseStats>,
      motion: Object.fromEntries(CFGS.map((c) => withCfg(c, () => [c, motionStats(ticks[c])]))) as Record<Cfg, MotionStats>,
      lag: { vUp: withCfg('vUp', () => commandLag(r, ticks.vUp, false)), cont: withCfg('cont', () => commandLag(r, ticks.cont, true)) },
      lat: { vUp: withCfg('vUp', () => latency(r)), cont: withCfg('cont', () => latency(r)) },
      agree: agreement(rows.vUp),
      jumps: jumps(rows.cont),
      sweep: [0.35, 0.45, 0.5, 0.55].map((m0) => {
        const a = agreement(rows.vUp, { togetherZero: m0 });
        return { m0, hover: a.hover, vSpeed: a.vSpeed, none: a.none.speed };
      }),
      tiltSweep: [20, 25, 30].map((full) => ({ full, drift: agreement(rows.vUp, { tiltFull: full }).driftSpeed })),
    };
    results.set(r.name, res);
  }

  const R = [...results.entries()].map(([name, res]) => ({ name: name.replace('2026-11-09-', ''), res }));
  const lines: string[] = [];
  lines.push('== poses: no command, drops for it (per-frame, frames in play)');
  lines.push(table(['recording', ...CFGS.flatMap((c) => [`${c} none%`, `${c} drops/min`])], R.map(({ name, res }) => [name, ...CFGS.flatMap((c) => [f1(pct(res.pose[c].unmatchedMs, res.pose[c].playMs)), f1((res.pose[c].drops / res.pose[c].playMs) * 60000)])])));
  lines.push(table(['recording', 'cont rest out of cone ms', 'longest ms'], R.map(({ name, res }) => [name, Math.round(res.pose.cont.restOutMs), Math.round(res.pose.cont.restOutMax)])));
  lines.push('== flown with Matter.js (ticks in play): jolts, up / down / still % of ticks, px fallen per minute at rest');
  lines.push(table(['recording', ...CFGS.flatMap((c) => [`${c} jolts`, `${c} up`, `${c} down`, `${c} still`, `${c} fall/min`])], R.map(({ name, res }) => [name, ...CFGS.flatMap((c) => { const m = res.motion[c]; return [m.jolts, f1(m.up), f1(m.down), f1(m.still), Math.round(m.fallRest)]; })])));
  lines.push('== (iii) where (ii) reads something (same smoothed arms): fly direction diff deg p50 / p90, speed / cruise p10 / p50');
  lines.push(table(['recording', 'par n', 'ang p50', 'ang p90', 'spd p10', 'spd p50', 'V n', 'ang p50', 'ang p90', 'spd p10', 'spd p50'], R.map(({ name, res: { agree: a } }) => [name, a.parAng.length, f1(q(a.parAng, 0.5)), f1(q(a.parAng, 0.9)), f2(q(a.parSpeed, 0.1)), f2(q(a.parSpeed, 0.5)), a.vAng.length, f1(q(a.vAng, 0.5)), f1(q(a.vAng, 0.9)), f2(q(a.vSpeed, 0.1)), f2(q(a.vSpeed, 0.5))])));
  lines.push('   hover: speed px/step p50 / p90; drift: same side %, speed p50 / p90 (drift is ' + config.pointing.driftSpeed + ')');
  lines.push(table(['recording', 'hover n', 'p50', 'p90', 'drift n', 'same %', 'p50', 'p90'], R.map(({ name, res: { agree: a } }) => [name, a.hover.length, f2(q(a.hover, 0.5)), f2(q(a.hover, 0.9)), a.driftN, f1(pct(a.driftSame, a.driftN)), f2(q(a.driftSpeed, 0.5)), f2(q(a.driftSpeed, 0.9))])));
  lines.push('   where (ii) descends (sink > 0): its sink p50 / p90, the continuous downward speed p50 / p90, sideways the same way %');
  lines.push('   (in T: of those, the frames where the arms are still in the T; the rest are lowered past it, the descent held for ambiguousMs)');
  lines.push(table(['recording', 'n', 'ii p50', 'ii p90', 'iii p50', 'iii p90', 'same %', 'in T n', 'ii p50', 'iii p50', 'iii p90', 'same %'], R.map(({ name, res: { agree: a } }) => [name, a.descN, f2(q(a.descSinkD, 0.5)), f2(q(a.descSinkD, 0.9)), f2(q(a.descSinkC, 0.5)), f2(q(a.descSinkC, 0.9)), f1(pct(a.descSame, a.descN)), a.descInT, f2(q(a.descInTSinkD, 0.5)), f2(q(a.descInTSinkC, 0.5)), f2(q(a.descInTSinkC, 0.9)), f1(pct(a.descInTSame, a.descInT))])));
  lines.push('   where (ii) matches nothing, and where one arm hangs (in the rest cone) and the other does not: up / down / sideways / still %, speed p50');
  lines.push(table(['recording', 'none n', 'up', 'down', 'side', 'still', 'spd p50', '1arm n', 'up', 'down', 'side', 'still', 'spd p50'], R.map(({ name, res: { agree: a } }) => [name, ...[a.none, a.oneArm].flatMap((b) => [b.n, f1(pct(b.up, b.n)), f1(pct(b.down, b.n)), f1(pct(b.side, b.n)), f1(pct(b.still, b.n)), f2(q(b.speed, 0.5))])])));
  lines.push('== responsiveness: lag of the asked-for velocity behind the map on raw frames (ms); latency.ts p50 / p90 / mean (labels)');
  lines.push(table(['recording', 'lag ii', 'lag iii', 'lat ii p50', 'p90', 'mean', 'lat iii p50', 'p90', 'mean'], R.map(({ name, res }) => [name, Math.round(res.lag.vUp), Math.round(res.lag.cont), res.lat.vUp.p50, res.lat.vUp.p90, res.lat.vUp.mean, res.lat.cont.p50, res.lat.cont.p90, res.lat.cont.mean])));
  lines.push('== (iii) command frame-to-frame jump, px/step: p50 / p95 / p99 / max');
  lines.push(table(['recording', 'p50', 'p95', 'p99', 'max'], R.map(({ name, res }) => [name, f2(q(res.jumps, 0.5)), f2(q(res.jumps, 0.95)), f2(q(res.jumps, 0.99)), f2(Math.max(...res.jumps))])));
  lines.push('== togetherZero: where (ii) reads a level T, continuous speed p50 / p90; V speed / cruise p50; where (ii) matches nothing, speed p50');
  lines.push(table(['recording', ...R[0].res.sweep.flatMap((s) => [`${s.m0} hov50`, 'hov90', 'V50', 'none50'])], R.map(({ name, res }) => [name, ...res.sweep.flatMap((s) => [f2(q(s.hover, 0.5)), f2(q(s.hover, 0.9)), f2(q(s.vSpeed, 0.5)), f2(q(s.none, 0.5))])])));
  lines.push('== tiltFull: where (ii) drifts, continuous speed p10 / p50');
  lines.push(table(['recording', ...R[0].res.tiltSweep.flatMap((s) => [`${s.full} p10`, 'p50'])], R.map(({ name, res }) => [name, ...res.tiltSweep.flatMap((s) => [f2(q(s.drift, 0.1)), f2(q(s.drift, 0.5))])])));
  console.log(`\ncontinuous steering vs the poses (${CFGS.map((c) => `${c} = ${LABEL[c]}`).join(', ')})\n${lines.join('\n')}\n`);
}, 120_000);

/**
 * Limits measured per recording where the second player's differ from the first's (2026-11-10-drugi-gracz-2): the V
 * she raised was wide and low (the arms ~100° apart, 28° and 52° above level for seconds), which continuous
 * steering climbs slowly (median 0.29 of the cruising speed where the poses fly up at all of it, 0.89-0.91 for the
 * first player); and her tilted T drifts the same way 82% of the time (92-98%).
 */
const V_SPEED_P50: Record<string, number> = { 'drugi-gracz-2': 0.2 };
const DRIFT_SAME_PCT: Record<string, number> = { 'drugi-gracz-2': 80 };

describe('continuous steering compared with the poses on recordings of play', () => {
  it('there are recordings of play', () => {
    expect(dumps.length).toBeGreaterThan(0);
  });

  for (const r of dumps) {
    describe(short(r), () => {
      const res = () => results.get(r.name)!;

      it('the arms always ask for something: no time without a command, no drops for want of one', () => {
        const p = res().pose.cont;
        expect(p.unmatchedMs).toBe(0);
        expect(p.drops).toBe(0);
        // at rest with the arms out of the cone only while leaving it is debounced (enterMs, plus a frame)
        expect(p.restOutMax).toBeLessThanOrEqual(config.pointing.enterMs + 70);
      });

      it('no jolts, in any of the three', () => {
        for (const c of CFGS) expect(res().motion[c].jolts, c).toBe(0);
      });

      it('a level T hovers', () => {
        const h = res().agree.hover;
        expect(q(h, 0.5)).toBeLessThan(0.3);
        expect(q(h, 0.9)).toBeLessThan(0.5);
      });

      it('parallel arms fly as the poses do', () => {
        const a = res().agree;
        expect(q(a.parAng, 0.5)).toBeLessThan(2);
        expect(q(a.parAng, 0.9)).toBeLessThan(6);
        expect(q(a.parSpeed, 0.5)).toBeGreaterThan(0.95);
      });

      it('a V climbs, the same way as the poses', () => {
        const a = res().agree;
        expect(q(a.vAng, 0.5)).toBeLessThan(3);
        expect(q(a.vSpeed, 0.5)).toBeGreaterThan(V_SPEED_P50[short(r)] ?? 0.5);
      });

      it('a tilted T drifts the same way', () => {
        const a = res().agree;
        expect(pct(a.driftSame, a.driftN)).toBeGreaterThan(DRIFT_SAME_PCT[short(r)] ?? 90);
      });

      it('the command changes smoothly from frame to frame', () => {
        expect(q(res().jumps, 0.99)).toBeLessThan(4);
      });
    });
  }

  it('where the poses descend, continuous steering descends too (the recording with the lowered tilted T)', () => {
    const a = results.get('2026-11-09-gra-po-strojeniu')?.agree;
    if (!a) return;
    expect(a.descN).toBeGreaterThan(50);
    expect(q(a.descSinkC, 0.5)).toBeGreaterThan(0.5);
    // and towards the same side, the lower hand, also with the arms lowered past the T (97 % of the 164 frames; 74 %
    // before spread arms banked towards the lower hand)
    expect(pct(a.descSame, a.descN)).toBeGreaterThan(90);
    expect(pct(a.descInTSame, a.descInT)).toBeGreaterThan(90);
  });
});
