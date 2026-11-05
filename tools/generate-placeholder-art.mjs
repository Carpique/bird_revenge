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

