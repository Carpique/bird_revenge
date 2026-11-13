// Generates the hand-drawn-looking PLACEHOLDER art into public/assets/ using Rough.js.
// Run with `npm run art`. Replace the generated files with real drawings any time —
// the game only knows the file paths listed in src/characters/*.ts and src/scenery/scenery.ts.
// (Level obstacles aren't images: the game draws them from the level's shapes, see src/level/LevelView.ts.)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import rough from 'roughjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => join(root, 'public', 'assets', p);
const gen = rough.generator();

const INK = '#2b2b2b';

function svg(w, h, drawables, offsetY = 0) {
  const parts = [];
  for (const d of drawables) {
    for (const p of gen.toPaths(d)) {
      parts.push(
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<g transform="translate(0 ${offsetY})">\n${parts.join('\n')}\n</g>\n</svg>\n`;
}

function write(path, content) {
  mkdirSync(dirname(out(path)), { recursive: true });
  writeFileSync(out(path), content);
  console.log('wrote', path);
}

const o = (seed, extra = {}) => ({ seed, stroke: INK, strokeWidth: 2.2, roughness: 1.4, bowing: 1.2, ...extra });
const ink = o;

const rot = (pts, deg, [cx, cy]) => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [cx + x * c + y * s, cy - x * s + y * c]);
};

// ---------------------------------------------------------------- bird (faces right)
// frame 120x110; circle hitbox centre sits at anchor (0.5, 0.55)
const BIRD_W = 120, BIRD_H = 110;
const birdBody = '#8cc0e0', birdBelly = '#d8ecf7', beak = '#f2a03d';

function bird({ wing, legs, seed }) {
  const d = [];
  // tail
  d.push(gen.polygon([[30, 60], [6, 46], [4, 58], [10, 72]], o(seed + 1, { fill: birdBody, fillStyle: 'hachure', hachureGap: 5 })));
  // body + belly
  d.push(gen.ellipse(58, 64, 74, 54, o(seed + 2, { fill: birdBody, fillStyle: 'hachure', hachureGap: 4.5, fillWeight: 1.4 })));
  d.push(gen.ellipse(66, 74, 40, 24, o(seed + 3, { fill: birdBelly, fillStyle: 'solid', strokeWidth: 1.4 })));
  // head
  d.push(gen.circle(88, 42, 36, o(seed + 4, { fill: birdBody, fillStyle: 'hachure', hachureGap: 4.5, fillWeight: 1.4 })));
  // beak
  d.push(gen.polygon([[103, 37], [118, 45], [103, 51]], o(seed + 5, { fill: beak, fillStyle: 'solid' })));
  // eye
  d.push(gen.circle(94, 38, 7, o(seed + 6, { fill: INK, fillStyle: 'solid', strokeWidth: 1 })));
  // legs
  if (legs === 'standing') {
    d.push(gen.linearPath([[50, 88], [48, 100], [40, 102]], o(seed + 7, { stroke: beak, strokeWidth: 3 })));
    d.push(gen.linearPath([[48, 100], [54, 102]], o(seed + 8, { stroke: beak, strokeWidth: 3 })));
    d.push(gen.linearPath([[68, 89], [70, 100], [62, 102]], o(seed + 9, { stroke: beak, strokeWidth: 3 })));
    d.push(gen.linearPath([[70, 100], [77, 102]], o(seed + 10, { stroke: beak, strokeWidth: 3 })));
  } else {
    d.push(gen.linearPath([[50, 88], [40, 96]], o(seed + 7, { stroke: beak, strokeWidth: 3 })));
    d.push(gen.linearPath([[64, 90], [54, 98]], o(seed + 8, { stroke: beak, strokeWidth: 3 })));
  }
  // wing: leaf shape pointing backwards from the shoulder, rotated by `wing` degrees (+ = down, - = up)
  const wingShape = [[4, -6], [-18, -15], [-44, -11], [-58, -1], [-42, 7], [-18, 9], [4, 6]];
  const pts = rot(wingShape, wing, [60, 56]);
  d.push(gen.polygon(pts, o(seed + 11, { fill: '#5d97bf', fillStyle: 'cross-hatch', hachureGap: 6, fillWeight: 1.1 })));
  return svg(BIRD_W, BIRD_H, d);
}

write('bird/idle.svg', bird({ wing: 4, legs: 'standing', seed: 10 }));
// flap frames ordered wings DOWN -> wings UP (pose mode picks a frame from your arm angle)
[45, 12, -24, -60].forEach((wing, i) => write(`bird/flap_${i}.svg`, bird({ wing, legs: 'tucked', seed: 20 + i * 13 })));

// ---------------------------------------------------------------- villain (faces right, feet at bottom)
const V_W = 96, V_H = 156;
const coat = '#6a5a7d', skin = '#f1c9a5';

function villain({ legA, legB, armA, armB, seed, splat = false }) {
  const d = [];
  const hip = [48, 104];
  const leg = (ang, s) => {
    const a = (ang * Math.PI) / 180;
    const knee = [hip[0] + Math.sin(a) * 22, hip[1] + Math.cos(a) * 22];
    const foot = [knee[0] + Math.sin(a * 0.6) * 24, knee[1] + Math.cos(a * 0.6) * 24];
    d.push(gen.linearPath([hip, knee, foot], o(s, { strokeWidth: 4 })));
    d.push(gen.line(foot[0] - 3, foot[1], foot[0] + 9, foot[1], o(s + 1, { strokeWidth: 5 })));
  };
  leg(legA, seed + 1);
  leg(legB, seed + 3);
  // trench coat
  d.push(gen.polygon([[36, 52], [60, 52], [68, 108], [28, 108]], o(seed + 5, { fill: coat, fillStyle: 'hachure', hachureGap: 4, fillWeight: 1.5 })));
  // belt
  d.push(gen.line(31, 84, 65, 84, o(seed + 6, { strokeWidth: 3 })));
  // arms
  const arm = (ang, s) => {
    const a = (ang * Math.PI) / 180;
    const sh = [48, 58];
    const hand = [sh[0] + Math.sin(a) * 38, sh[1] + Math.cos(a) * 38];
    d.push(gen.line(sh[0], sh[1], hand[0], hand[1], o(s, { strokeWidth: 5, stroke: '#3f3350' })));
    d.push(gen.circle(hand[0], hand[1], 8, o(s + 1, { fill: skin, fillStyle: 'solid', strokeWidth: 1.5 })));
  };
  arm(armA, seed + 7);
  // head
  d.push(gen.circle(50, 38, 30, o(seed + 9, { fill: skin, fillStyle: 'solid' })));
  // eye mask + eyes
  d.push(gen.rectangle(35, 30, 31, 8, o(seed + 10, { fill: INK, fillStyle: 'solid', strokeWidth: 1 })));
  d.push(gen.circle(46, 34, 4, o(seed + 11, { fill: '#fff', fillStyle: 'solid', strokeWidth: 0.5 })));
  d.push(gen.circle(58, 34, 4, o(seed + 12, { fill: '#fff', fillStyle: 'solid', strokeWidth: 0.5 })));
  // villain moustache
  d.push(gen.curve([[40, 46], [46, 43], [51, 46], [56, 43], [64, 47]], o(seed + 13, { strokeWidth: 3 })));
  // hat
  d.push(gen.rectangle(34, 6, 32, 18, o(seed + 14, { fill: INK, fillStyle: 'hachure', hachureGap: 2.5 })));
  d.push(gen.line(26, 24, 74, 24, o(seed + 15, { strokeWidth: 4 })));
  arm(armB, seed + 16);
  if (splat) {
    const poo = '#7a5230';
    d.push(gen.ellipse(52, 10, 40, 16, o(seed + 20, { fill: poo, fillStyle: 'solid' })));
    d.push(gen.polygon([[36, 12], [34, 30], [40, 14]], o(seed + 21, { fill: poo, fillStyle: 'solid' })));
    d.push(gen.polygon([[62, 14], [66, 34], [68, 14]], o(seed + 22, { fill: poo, fillStyle: 'solid' })));
    // shocked mouth
    d.push(gen.circle(52, 50, 6, o(seed + 23, { fill: INK, fillStyle: 'solid' })));
  }
  return svg(V_W, V_H, d);
}

const walk = [
  { legA: 32, legB: -28, armA: -30, armB: 26 },
  { legA: 8, legB: -6, armA: -8, armB: 8 },
  { legA: -28, legB: 32, armA: 26, armB: -30 },
  { legA: -6, legB: 8, armA: 8, armB: -8 },
];
walk.forEach((p, i) => write(`villain/walk_${i}.svg`, villain({ ...p, seed: 100 + i * 31 })));
write('villain/hit.svg', villain({ legA: 10, legB: -10, armA: 150, armB: -150, seed: 300, splat: true }));

// ---------------------------------------------------------------- ghost (the villain's other look: same frame, faces right)
// a ball under a bed sheet, floating a little above its feet (the bottom of the frame); the hem waves as it goes
const sheet = '#f6f8fc', sheetFold = '#aab6cc', GHOST_INK = '#3a4256';

/** `phase` 0..1: where the hem's wave (and the bob up and down) is; `hit`: a poo on its head, mouth open in shock */
function ghost({ phase, seed, hit = false }) {
  const d = [];
  const go = (s, extra = {}) => o(s, { stroke: GHOST_INK, roughness: 0.9, bowing: 0.8, ...extra });
  const t = phase * Math.PI * 2;
  const bob = Math.sin(t) * 3;
  const cx = 48, R = 30, headY = 46 + bob;
  const hemY = 126 + bob;
  // the sheet's sides flare out and sway a little, trailing behind (it moves to the right)
  const sway = Math.sin(t + 0.6) * 2.5;
  const left = cx - R - 8 + sway, right = cx + R + 8 + sway * 0.6;
  // the hem: scallops whose dips travel along it
  const n = 4, w = (right - left) / n;
  let hem = '';
  for (let i = n - 1; i >= 0; i--) {
    const x0 = left + (i + 1) * w, x1 = left + i * w;
    const dip = 8 + Math.sin(t * 1 + i * 1.7) * 4;
    hem += ` Q ${x0 - w / 2} ${hemY + dip + Math.cos(t + i) * 2} ${x1} ${hemY - 2 + Math.sin(t + i * 1.3) * 2}`;
  }
  const body =
    `M ${cx - R} ${headY} A ${R} ${R} 0 0 1 ${cx + R} ${headY}` +
    ` C ${cx + R + 2} ${headY + 34} ${right - 2} ${hemY - 26} ${right} ${hemY - 2}` +
    hem +
    ` C ${left - 2} ${hemY - 26} ${cx - R - 2} ${headY + 34} ${cx - R} ${headY} Z`;
  d.push(gen.path(body, go(seed + 1, { fill: sheet, fillStyle: 'solid' })));
  // folds: from under the head down into the hem, swinging with it
  for (const [i, fx] of [[0, -14], [1, 6], [2, 22]]) {
    const top = [cx + fx * 0.6, headY + 30];
    const mid = [cx + fx + Math.sin(t + i * 1.7) * 3, hemY - 24];
    const end = [cx + fx * 1.15 + Math.sin(t + i * 1.7 + 0.8) * 4, hemY + 2];
    d.push(gen.curve([top, mid, end], go(seed + 2 + i, { stroke: sheetFold, strokeWidth: 1.6 })));
  }
  // eyes: two black holes, looking the way it goes
  d.push(gen.ellipse(cx + 2, headY - 2, 11, 17, go(seed + 6, { fill: '#111', fillStyle: 'solid', strokeWidth: 1 })));
  d.push(gen.ellipse(cx + 18, headY - 2, 11, 17, go(seed + 7, { fill: '#111', fillStyle: 'solid', strokeWidth: 1 })));
  if (hit) {
    const poo = '#7a5230';
    d.push(gen.ellipse(cx + 2, headY - R + 2, 40, 16, o(seed + 20, { fill: poo, fillStyle: 'solid' })));
    d.push(gen.polygon([[cx - 14, headY - R + 4], [cx - 16, headY - R + 22], [cx - 10, headY - R + 6]], o(seed + 21, { fill: poo, fillStyle: 'solid' })));
    d.push(gen.polygon([[cx + 12, headY - R + 6], [cx + 16, headY - R + 26], [cx + 18, headY - R + 6]], o(seed + 22, { fill: poo, fillStyle: 'solid' })));
    d.push(gen.ellipse(cx + 10, headY + 18, 10, 13, go(seed + 23, { fill: '#111', fillStyle: 'solid', strokeWidth: 1 })));
  }
  return svg(V_W, V_H, d);
}

// float frames: one full wave of the hem (the animation loops). All drawn with the same seed, so the sketchy lines
// wobble the same way in each and only the sheet moves; different seeds make the outlines flicker from frame to frame.
const GHOST_FRAMES = 6;
for (let i = 0; i < GHOST_FRAMES; i++) write(`ghost/float_${i}.svg`, ghost({ phase: i / GHOST_FRAMES, seed: 1200 }));
write('ghost/hit.svg', ghost({ phase: 0.25, seed: 1300, hit: true }));

// ---------------------------------------------------------------- glue (what the ghost throws: a glowing green blob)
{
  const glue = '#9dff4f', glueInk = '#2f7d16';
  const d = [
    gen.path('M 9 20 C 6 11 15 5 21 8 C 27 4 34 12 30 19 C 33 26 26 31 20 29 C 14 33 6 28 9 20 Z', o(1400, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.8, roughness: 0.8 })),
    // drips trailing off it
    gen.path('M 12 27 Q 10 33 13 34 Q 16 33 15 28', o(1401, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.4, roughness: 0.6 })),
    gen.circle(25, 33, 3.5, o(1402, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.2, roughness: 0.5 })),
    // a shine
    gen.curve([[14, 14], [17, 11], [21, 11]], o(1403, { stroke: '#eaffd6', strokeWidth: 2.2, roughness: 0.5 })),
  ];
  // the fluorescent glow: a soft green halo behind the blob
  const glow =
    '<defs><radialGradient id="glow"><stop offset="0.45" stop-color="#9dff4f" stop-opacity="0.75"/><stop offset="1" stop-color="#9dff4f" stop-opacity="0"/></radialGradient></defs>\n' +
    '<circle cx="20" cy="20" r="20" fill="url(#glow)"/>\n';
  write('glue/glue.svg', svg(40, 40, d).replace('<g ', `${glow}<g `));

  // ...splatted on a surface (the image's bottom edge): a puddle with drops flung off it
  const puddle = [
    gen.path('M 6 31 C 8 24 16 25 22 20 C 27 13 35 12 41 17 C 47 13 55 17 58 23 C 65 24 72 26 74 31 Z', o(1410, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.8, roughness: 0.8 })),
    gen.circle(10, 15, 6, o(1411, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.2, roughness: 0.5 })),
    gen.circle(66, 12, 5, o(1412, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.2, roughness: 0.5 })),
    gen.circle(50, 6, 3.5, o(1413, { fill: glue, fillStyle: 'solid', stroke: glueInk, strokeWidth: 1.2, roughness: 0.5 })),
    gen.curve([[26, 22], [31, 18], [37, 19]], o(1414, { stroke: '#eaffd6', strokeWidth: 2.2, roughness: 0.5 })),
  ];
  const puddleGlow =
    '<defs><radialGradient id="glow"><stop offset="0.45" stop-color="#9dff4f" stop-opacity="0.6"/><stop offset="1" stop-color="#9dff4f" stop-opacity="0"/></radialGradient></defs>\n' +
    '<ellipse cx="40" cy="26" rx="40" ry="20" fill="url(#glow)"/>\n';
  write('glue/splat.svg', svg(80, 32, puddle).replace('<g ', `${puddleGlow}<g `));
}

// ---------------------------------------------------------------- apple splat (apple.svg itself is drawn by hand)
// lies on a surface (the image's bottom edge): red mush with pale flesh showing, bits flung off it, and the leaf
{
  const skin = '#d23a2c', flesh = '#f6e3b0', leaf = '#5c9c3a';
  const thin = { strokeWidth: 1.6, roughness: 0.8 };
  write('apple/splat.svg', svg(80, 32, [
    gen.polygon([[5, 30], [12, 23], [22, 24], [29, 15], [39, 20], [48, 12], [56, 21], [66, 21], [75, 30]], o(1420, { fill: skin, fillStyle: 'solid', strokeWidth: 1.8, roughness: 1 })),
    gen.polygon([[24, 29], [31, 23], [40, 26], [48, 21], [56, 29]], o(1421, { fill: flesh, fillStyle: 'solid', ...thin })),
    gen.circle(9, 13, 6, o(1422, { fill: skin, fillStyle: 'solid', ...thin })),
    gen.circle(69, 11, 5, o(1423, { fill: skin, fillStyle: 'solid', ...thin })),
    gen.circle(22, 8, 4, o(1424, { fill: flesh, fillStyle: 'solid', ...thin })),
    gen.path('M 54 9 C 56 4 61 2 65 3 C 63 8 59 10 54 9 Z', o(1425, { fill: leaf, fillStyle: 'solid', ...thin })),
  ]));
}

// ---------------------------------------------------------------- bat (seen from the front, centre at the middle)
const BAT_W = 140, BAT_H = 90;
/** a bat flying its route: dusky grey-purple, inked black */
const BAT_PLAIN = { fur: '#4a3a5c', wing: '#6b5a80', ink: INK };
/** a homing bat (no route), told apart by its colour: dark purple all over, outline too */
const BAT_HOMING = { fur: '#4b1d73', wing: '#7a3fb0', ink: '#2a0f45' };

/** `wing`: how far the wings are raised (deg, + = up); `hit`: wings folded, dazed, a poo on its head; `colours`: BAT_PLAIN or BAT_HOMING */
function bat({ wing, seed, hit = false, colours = BAT_PLAIN }) {
  const d = [];
  const { fur: batFur, wing: batWing } = colours;
  const o = (seed, extra = {}) => ink(seed, { stroke: colours.ink, ...extra });
  const cx = BAT_W / 2, cy = 50;
  // one wing, drawn for the right side and mirrored: from the shoulder out to the tip, scalloped along the bottom
  const wingShape = [[0, -8], [22, -16], [46, -14], [60, -4], [50, 2], [44, 12], [34, 6], [26, 16], [16, 8], [6, 12], [0, 8]];
  for (const side of [1, -1]) {
    const pts = rot(wingShape.map(([x, y]) => [x * (hit ? 0.45 : 1), y]), wing, [0, 0]).map(([x, y]) => [cx + side * (12 + x), cy - 6 + y]);
    d.push(gen.polygon(pts, o(seed + (side > 0 ? 1 : 2), { fill: batWing, fillStyle: 'cross-hatch', hachureGap: 5, fillWeight: 1.1 })));
  }
  // body, head, ears
  d.push(gen.ellipse(cx, cy + 4, 28, 36, o(seed + 3, { fill: batFur, fillStyle: 'hachure', hachureGap: 3.5, fillWeight: 1.5 })));
  d.push(gen.polygon([[cx - 12, cy - 22], [cx - 14, cy - 38], [cx - 3, cy - 26]], o(seed + 4, { fill: batFur, fillStyle: 'solid' })));
  d.push(gen.polygon([[cx + 12, cy - 22], [cx + 14, cy - 38], [cx + 3, cy - 26]], o(seed + 5, { fill: batFur, fillStyle: 'solid' })));
  d.push(gen.circle(cx, cy - 18, 26, o(seed + 6, { fill: batFur, fillStyle: 'hachure', hachureGap: 3.5, fillWeight: 1.5 })));
  if (hit) {
    // dazed: x eyes, an open mouth, and the bird's poo on top
    for (const ex of [cx - 6, cx + 6]) {
      d.push(gen.line(ex - 3, cy - 23, ex + 3, cy - 17, o(seed + 7, { stroke: '#fff', strokeWidth: 2 })));
      d.push(gen.line(ex + 3, cy - 23, ex - 3, cy - 17, o(seed + 8, { stroke: '#fff', strokeWidth: 2 })));
    }
    d.push(gen.circle(cx, cy - 9, 5, o(seed + 9, { fill: '#c0392b', fillStyle: 'solid', strokeWidth: 1 })));
    const poo = '#7a5230';
    d.push(gen.ellipse(cx, cy - 32, 30, 12, o(seed + 10, { fill: poo, fillStyle: 'solid' })));
    d.push(gen.polygon([[cx - 12, cy - 30], [cx - 14, cy - 18], [cx - 9, cy - 29]], o(seed + 11, { fill: poo, fillStyle: 'solid' })));
  } else {
    // glowing eyes, little fangs
    d.push(gen.circle(cx - 6, cy - 20, 6, o(seed + 7, { fill: '#f7d35a', fillStyle: 'solid', strokeWidth: 1 })));
    d.push(gen.circle(cx + 6, cy - 20, 6, o(seed + 8, { fill: '#f7d35a', fillStyle: 'solid', strokeWidth: 1 })));
    d.push(gen.polygon([[cx - 5, cy - 10], [cx - 3, cy - 5], [cx - 1, cy - 10]], o(seed + 9, { fill: '#fff', fillStyle: 'solid', strokeWidth: 1 })));
    d.push(gen.polygon([[cx + 1, cy - 10], [cx + 3, cy - 5], [cx + 5, cy - 10]], o(seed + 10, { fill: '#fff', fillStyle: 'solid', strokeWidth: 1 })));
  }
  return svg(BAT_W, BAT_H, d);
}

// fly frames: a full wingbeat, wings up -> down -> back up (the animation loops)
[30, 5, -25, 5].forEach((wing, i) => write(`bat/fly_${i}.svg`, bat({ wing, seed: 900 + i * 17 })));
write('bat/hit.svg', bat({ wing: 60, seed: 980, hit: true }));
// the homing bat: the same drawings, in its own colours
[30, 5, -25, 5].forEach((wing, i) => write(`bat/homing/fly_${i}.svg`, bat({ wing, seed: 900 + i * 17, colours: BAT_HOMING })));
write('bat/homing/hit.svg', bat({ wing: 60, seed: 980, hit: true, colours: BAT_HOMING }));

// ---------------------------------------------------------------- dragon (side on, faces right, feet at the bottom)
// Sits still and spits fire from its jaw (the fire is drawn by the game, from the puffs below).
// Frame 170x110, the ground at y 106. The head never moves, only the jaws do, so the fire's start stays put:
// `DRAGON_MOUTH` (printed below) goes into src/characters/dragon.ts.
const DRAGON_W = 170, DRAGON_H = 110;
const dragonScales = '#5f9e4f', dragonDark = '#3f7340', dragonWing = '#8cc084', dragonBelly = '#efd98c';
const dragonSpikes = '#e8743b', dragonHorn = '#f3e6c0', dragonMouth = '#7a1f1f';
/** the jaw's hinge; the head's points below are relative to it */
const DRAGON_HINGE = [116, 45];
/** how far the jaws turn when wide open (deg): the lower one down, the upper one up a little */
const JAW_DOWN = 36, JAW_UP = 7;

const fmt = (v) => +v.toFixed(1);
/** a smooth closed path through `pts` (Catmull-Rom) */
function smooth(pts) {
  const n = pts.length;
  let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${fmt(c1[0])} ${fmt(c1[1])}, ${fmt(c2[0])} ${fmt(c2[1])}, ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d + ' Z';
}
/** the outline of a band along the centreline `pts`, `w[i]` wide at each point (tails, necks, legs) */
function ribbon(pts, w) {
  const a = [], b = [];
  pts.forEach(([x, y], i) => {
    const [px, py] = pts[Math.max(0, i - 1)], [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(nx - px, ny - py) || 1;
    const ox = (-(ny - py) / len) * (w[i] / 2), oy = ((nx - px) / len) * (w[i] / 2);
    a.push([x + ox, y + oy]);
    b.push([x - ox, y - oy]);
  });
  return [...a, ...b.reverse()];
}
const add = ([x, y], [dx, dy]) => [x + dx, y + dy];

/**
 * `open` 0..1: how far the jaws are open; `blink`: eye shut; `squint`: eye narrowed (spitting); `tail` 0..1: the tail's
 * tip lifted; `wing`: the folded wing raised (deg); `heave`: the body pushed down (px), the head staying put;
 * `smoke` 0..1: a puff of smoke rising from the nostril (none if not given).
 */
function dragon({ open = 0, blink = false, squint = false, tail = 0, wing = 0, heave = 0, smoke, seed }) {
  const d = [];
  const fill = (s, colour, extra = {}) => o(s, { fill: colour, fillStyle: 'solid', ...extra });
  const solid = (s, colour, extra = {}) => o(s, { fill: colour, fillStyle: 'solid', ...extra });
  const H = DRAGON_HINGE;
  const body = [64, 74 + heave];

  // tail: lying on the ground behind, its spade tip curling up
  const tailLine = [[36, 82 + heave], [22, 96], [10, 101], [4 - 2 * tail, 94 - 8 * tail], [7 + 3 * tail, 84 - 14 * tail]];
  d.push(gen.path(smooth(ribbon(tailLine, [20, 14, 10, 7, 3])), fill(seed + 1, dragonScales)));
  {
    const tip = tailLine[4], prev = tailLine[3];
    const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]);
    const u = [(tip[0] - prev[0]) / len, (tip[1] - prev[1]) / len], n = [-u[1], u[0]];
    const at = (a, b) => [tip[0] + u[0] * a + n[0] * b, tip[1] + u[1] * a + n[1] * b];
    d.push(gen.polygon([at(9, 0), at(1, 5), at(-1, 0), at(1, -5)], solid(seed + 2, dragonSpikes, { strokeWidth: 1.8 })));
  }
  // the far front leg, in shadow
  d.push(gen.path(smooth(ribbon([[82, 84], [84, 96], [86, 102]], [13, 11, 10])), solid(seed + 3, dragonDark)));
  d.push(gen.ellipse(90, 103, 15, 6, solid(seed + 4, dragonDark)));
  // the folded wing, behind the body: bones fanning from the shoulder, the skin scalloped between them
  {
    const sh = [74, 56 + heave];
    const wingPts = rot([[0, 0], [-8, -30], [-16, -42], [-22, -30], [-34, -32], [-38, -20], [-50, -16], [-44, -4]], wing, [0, 0]).map((p) => add(sh, p));
    d.push(gen.polygon(wingPts, o(seed + 5, { fill: dragonWing, fillStyle: 'solid' })));
    for (const i of [2, 4, 6]) d.push(gen.line(sh[0], sh[1], wingPts[i][0], wingPts[i][1], o(seed + 6 + i, { strokeWidth: 1.6 })));
  }
  // body and belly
  d.push(gen.ellipse(body[0], body[1], 78, 46, fill(seed + 13, dragonScales)));
  d.push(gen.ellipse(body[0] + 6, body[1] + 12, 50, 18, solid(seed + 14, dragonBelly, { strokeWidth: 1.4 })));
  for (const x of [-8, 2, 12, 22]) d.push(gen.line(body[0] + x, body[1] + 5, body[0] + x - 1, body[1] + 19, o(seed + 15 + x, { strokeWidth: 1, stroke: '#b89a4a' })));
  // spikes along the back
  for (const [i, x] of [36, 47, 58, 69, 80].entries()) {
    const y = body[1] - 23 * Math.sqrt(Math.max(0, 1 - ((x - body[0]) / 39) ** 2));
    d.push(gen.polygon([[x - 5, y + 3], [x - 3, y - 8], [x + 5, y + 2]], solid(seed + 40 + i, dragonSpikes, { strokeWidth: 1.6 })));
  }
  // neck, curving up to the head, its belly side light; spikes down its back
  const neckLine = [[84, 74 + heave], [98, 61 + heave * 0.5], [107, 51], [114, 43]];
  const neckW = [26, 22, 19, 17];
  d.push(gen.path(smooth(ribbon(neckLine, neckW)), fill(seed + 50, dragonScales)));
  {
    const edge = ribbon(neckLine, neckW).slice(0, neckLine.length);
    const front = edge.map((p, i) => add(p, [(neckLine[i][0] - p[0]) * 0.35, (neckLine[i][1] - p[1]) * 0.35]));
    d.push(gen.path(smooth(ribbon(front, [9, 8, 7, 6])), solid(seed + 51, dragonBelly, { strokeWidth: 1.2 })));
    const back = ribbon(neckLine, neckW).slice(neckLine.length).reverse();
    for (const i of [1, 2]) {
      const [x, y] = back[i];
      d.push(gen.polygon([[x - 1, y + 4], [x - 7, y - 4], [x + 4, y - 1]], solid(seed + 52 + i, dragonSpikes, { strokeWidth: 1.6 })));
    }
  }
  // near legs: a big haunch at the back, a short front leg; pale claws
  d.push(gen.ellipse(48, 84 + heave * 0.6, 32, 30, fill(seed + 60, dragonScales)));
  d.push(gen.ellipse(55, 102, 26, 9, solid(seed + 61, dragonScales)));
  d.push(gen.path(smooth(ribbon([[92, 80 + heave * 0.6], [95, 92], [96, 101]], [15, 12, 11])), fill(seed + 62, dragonScales)));
  d.push(gen.ellipse(101, 103, 18, 7, solid(seed + 63, dragonScales)));
  for (const [i, x] of [65, 69, 108, 112].entries()) {
    d.push(gen.polygon([[x - 2, 103], [x + 3, 105.5], [x - 2, 106]], solid(seed + 64 + i, dragonHorn, { strokeWidth: 1.2 })));
  }

  // ---- the head: relative to the hinge; the lower jaw turns down, the rest of the head up a little
  const down = -JAW_DOWN * open, up = JAW_UP * open;
  const lower = (pts) => rot(pts, down, [0, 0]).map((p) => add(H, p));
  const upper = (pts) => rot(pts, up, [0, 0]).map((p) => add(H, p));
  // the far horn and the frill behind the jaw
  d.push(gen.path(smooth(upper([[-6, -18], [-2, -21], [-16, -31], [-26, -36], [-18, -27]])), solid(seed + 70, '#d6c79c')));
  d.push(gen.polygon(upper([[-8, -10], [-22, -14], [-15, -6], [-24, -1], [-11, 3]]), solid(seed + 71, dragonSpikes, { strokeWidth: 1.6 })));
  // inside of the mouth, then the lower jaw and its teeth
  if (open > 0) {
    d.push(gen.polygon([...upper([[34, 0], [0, 2]]), ...lower([[32, 1]])], solid(seed + 72, dragonMouth, { strokeWidth: 1.4 })));
    for (const x of [14, 22]) d.push(gen.polygon(lower([[x - 2.5, 0], [x, -4], [x + 2.5, 0]]), solid(seed + 73 + x, '#ffffff', { strokeWidth: 1 })));
  }
  d.push(gen.path(smooth(lower([[-6, -1], [16, 1], [33, 0], [37, 2], [33, 6], [14, 8], [-2, 6]])), fill(seed + 80, dragonScales)));
  // skull and snout
  d.push(gen.path(smooth(upper([[-14, -2], [-12, -16], [-2, -22], [12, -20], [26, -15], [36, -12], [41, -7], [40, -2], [30, 1], [10, 2], [-6, 5]])), fill(seed + 81, dragonScales)));
  // upper teeth: little fangs over the lower jaw, longer when the mouth is open
  for (const x of [18, 28]) d.push(gen.polygon(upper([[x - 2.5, 0.5], [x, 5 + 2 * open], [x + 2.5, 0.5]]), solid(seed + 82 + x, '#ffffff', { strokeWidth: 1 })));
  // the near horn, nostril, eye and brow
  d.push(gen.path(smooth(upper([[-8, -17], [-1, -20], [-14, -32], [-28, -38], [-20, -26]])), solid(seed + 90, dragonHorn)));
  {
    const [nx, ny] = upper([[34, -10]])[0];
    d.push(gen.ellipse(nx, ny, 4, 2.5, solid(seed + 91, INK, { strokeWidth: 1 })));
  }
  const [ex, ey] = upper([[7, -12]])[0];
  if (blink) {
    d.push(gen.curve([[ex - 5, ey], [ex, ey + 2], [ex + 5, ey]], o(seed + 92, { strokeWidth: 1.8 })));
  } else {
    const h = squint ? 4.5 : 7.5;
    d.push(gen.ellipse(ex, ey, 10, h, solid(seed + 92, '#fff8d6', { strokeWidth: 1.4 })));
    d.push(gen.ellipse(ex + 1.5, ey, 2.4, h - 1.5, solid(seed + 93, INK, { strokeWidth: 0.6 })));
  }
  {
    const [b0, b1] = upper([[0, squint ? -16 : -19], [15, squint ? -14.5 : -16]]);
    d.push(gen.line(b0[0], b0[1], b1[0], b1[1], o(seed + 94, { strokeWidth: 2.6 })));
  }
  // smoke from the nostril: two puffs rising and growing
  if (smoke !== undefined) {
    const [nx, ny] = upper([[34, -10]])[0];
    for (const [i, k] of [smoke, smoke * 0.5].entries()) {
      d.push(gen.circle(nx + 3 + k * 10, ny - 5 - k * 16, 4 + k * 7, solid(seed + 95 + i, '#d9dde0', { stroke: '#8a9aa5', strokeWidth: 1.4 })));
    }
  }
  return svg(DRAGON_W, DRAGON_H, d);
}

{
  // where the fire starts, wide open: just inside the jaws, halfway between them
  const H = DRAGON_HINGE;
  const top = add(H, rot([[30, 0]], JAW_UP, [0, 0])[0]), bottom = add(H, rot([[30, 1]], -JAW_DOWN, [0, 0])[0]);
  console.log('DRAGON_MOUTH', { x: fmt((top[0] + bottom[0]) / 2), y: fmt((top[1] + bottom[1]) / 2) });
}

// All drawn with the same seed, so the sketchy lines stay put and only the moving parts move.
const DRAGON_SEED = 1500;
write('dragon/idle.svg', dragon({ seed: DRAGON_SEED }));
write('dragon/blink.svg', dragon({ blink: true, seed: DRAGON_SEED }));
// a flick of the tail: up and back down
[0.5, 1, 0.6, 0.2].forEach((tail, i) => write(`dragon/tail_${i}.svg`, dragon({ tail, seed: DRAGON_SEED })));
[0.15, 0.55, 1].forEach((smoke, i) => write(`dragon/smoke_${i}.svg`, dragon({ smoke, seed: DRAGON_SEED })));
// the jaw opening (played backwards to close it)
[0.35, 0.7, 1].forEach((open, i) => write(`dragon/open_${i}.svg`, dragon({ open, squint: true, seed: DRAGON_SEED })));
// spitting: mouth wide, the body heaving and the wing and tail quivering (the game shakes it a little too)
[
  { open: 1, heave: 0, wing: 0, tail: 0.1 },
  { open: 0.93, heave: 1.5, wing: 4, tail: 0.25 },
  { open: 1, heave: 0.5, wing: -2, tail: 0 },
].forEach((p, i) => write(`dragon/spit_${i}.svg`, dragon({ ...p, squint: true, seed: DRAGON_SEED })));

// ---------------------------------------------------------------- fire (the dragon's stream, made of puffs)
// One puff, 64x48, pointing right, its centre in the middle. Each frame comes in four layers drawn on top of each other
// in this order by the game, so the overlapping puffs make one stream with a single dark outline around it:
// outline (the outer shape, a little bigger, dark red), outer (red-orange), mid (orange), core (yellow).
{
  const FW = 64, FH = 48;
  /** the puff's outline: a horizontal blob with flame tongues licking up from its top and back; `k` scales it */
  const puff = (phase, k, [dx, dy]) => {
    const pts = [];
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const upward = Math.max(0, -Math.sin(a)) ** 2;
      const behind = Math.max(0, -Math.cos(a));
      let r = 1 + 0.12 * Math.sin(3 * a + phase) + 0.08 * Math.sin(5 * a - 2 * phase);
      // tongues: every other point on the top pushed out
      if (i % 2 === 1) r += (0.35 + 0.25 * Math.sin(phase + i)) * upward + 0.3 * behind * upward;
      pts.push([FW / 2 + dx + Math.cos(a) * 24 * k * r, FH / 2 + dy + Math.sin(a) * 13 * k * r]);
    }
    return smooth(pts);
  };
  const layers = [
    ['outline', 1, [0, 0], { fill: '#a8240c', stroke: '#a8240c', strokeWidth: 4 }],
    ['outer', 1, [0, 0], { fill: '#f0531c', stroke: 'none' }],
    ['mid', 0.74, [3, 2], { fill: '#ff9d1e', stroke: 'none' }],
    ['core', 0.5, [5, 3], { fill: '#ffe46b', stroke: 'none' }],
  ];
  const FIRE_FRAMES = 4;
  for (let i = 0; i < FIRE_FRAMES; i++) {
    const phase = (i / FIRE_FRAMES) * Math.PI * 2;
    for (const [name, k, shift, style] of layers) {
      write(`fire/${name}_${i}.svg`, svg(FW, FH, [gen.path(puff(phase, k, shift), o(1600 + i, { fillStyle: 'solid', roughness: 0.8, ...style }))]));
    }
  }
}

// ---------------------------------------------------------------- poo
const pooC = '#7a5230';
write('poo/falling.svg', svg(34, 36, [
  gen.ellipse(17, 29, 28, 11, o(400, { fill: pooC, fillStyle: 'solid', strokeWidth: 1.8 })),
  gen.ellipse(17, 21, 20, 9, o(401, { fill: pooC, fillStyle: 'solid', strokeWidth: 1.8 })),
  gen.ellipse(17, 14, 12, 7, o(402, { fill: pooC, fillStyle: 'solid', strokeWidth: 1.8 })),
  gen.curve([[17, 10], [20, 5], [16, 3]], o(403, { strokeWidth: 1.8 })),
]));
write('poo/splat.svg', svg(70, 26, [
  gen.polygon([[6, 20], [14, 12], [24, 14], [32, 6], [42, 13], [55, 10], [64, 19], [52, 23], [20, 24]], o(410, { fill: pooC, fillStyle: 'solid' })),
  gen.circle(8, 8, 5, o(411, { fill: pooC, fillStyle: 'solid' })),
  gen.circle(62, 6, 4, o(412, { fill: pooC, fillStyle: 'solid' })),
]));

// ---------------------------------------------------------------- scenery
{
  const d = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    d.push(gen.line(80 + Math.cos(a) * 52, 80 + Math.sin(a) * 52, 80 + Math.cos(a) * 74, 80 + Math.sin(a) * 74, o(500 + i, { stroke: '#e3a21a', strokeWidth: 3 })));
  }
  d.push(gen.circle(80, 80, 84, o(520, { fill: '#f7d35a', fillStyle: 'hachure', hachureGap: 4, fillWeight: 2, stroke: '#e3a21a', strokeWidth: 3 })));
  write('scenery/sun.svg', svg(160, 160, d));
}

function cloud(seed, puffs) {
  const d = puffs.map(([x, y, r], i) => gen.circle(x, y, r, o(seed + i, { fill: '#ffffff', fillStyle: 'solid', stroke: '#8a9aa5', strokeWidth: 2 })));
  return svg(240, 120, d);
}
write('scenery/cloud_0.svg', cloud(600, [[60, 66, 64], [108, 48, 84], [160, 58, 70], [196, 74, 46], [116, 80, 60]]));
write('scenery/cloud_1.svg', cloud(620, [[52, 70, 52], [94, 52, 70], [142, 46, 78], [188, 66, 58], [120, 80, 50]]));

{
  const W = 1280, H = 100;
  const d = [];
  d.push(gen.rectangle(-10, 4, W + 20, H, o(700, { fill: '#a9c98a', fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.3, hachureAngle: -50, stroke: 'none' })));
  d.push(gen.line(0, 4, W, 4, o(701, { strokeWidth: 3, roughness: 2 })));
  for (let i = 0; i < 40; i++) {
    const x = 16 + i * 32 + ((i * 37) % 13);
    d.push(gen.linearPath([[x - 6, 6], [x - 3, -6], [x, 6], [x + 4, -8], [x + 7, 6]], o(710 + i, { stroke: '#5e8a45', strokeWidth: 1.6 })));
  }
  for (let i = 0; i < 14; i++) {
    const x = 40 + i * 90 + ((i * 53) % 40);
    d.push(gen.ellipse(x, 40 + ((i * 29) % 45), 10, 6, o(800 + i, { stroke: '#7d8f6d', strokeWidth: 1.4 })));
  }
  // ground surface line is 16px below the top of the image (room for grass)
  write('scenery/ground.svg', svg(W, H + 20, d, 12));
}

