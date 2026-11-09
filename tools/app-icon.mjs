// Draws the home-screen icon (`public/icons/*.png`): the bird flying upwards, dropping a poo, against the morning sky. iOS uses
// `apple-touch-icon.png` (index.html); Android uses the manifest's icons. All are cut to a squircle here.
// Run `npm run app-icon` after changing the bird's or the poo's art, or the morning sky (src/scenery/scenery.ts).
// Uses headless Chrome (puppeteer), as the Tiled icons do.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

/** the morning sky's colours (scenery.timesOfDay.morning) */
const SKY = { top: '#6aa8e0', horizon: '#fff3dc' };
/** the bird's frame: in flight, legs tucked in */
const BIRD = 'bird/flap_2.svg';
/** how far the bird is tilted upwards (beak up), in degrees */
const TILT = 15;
/** the poo's frame, and its height as a share of the bird's image's (smaller than the game's 30 / 90) */
const POO = 'poo/falling.svg';
const POO_HEIGHT = 0.15;
/** where the poo comes out, as a share of the bird's image (before the tilt), and how far below that it's fallen, in
 *  the bird's image's pixels */
const POO_FROM = { x: 0.2, y: 0.72 };
const POO_DROP = 6;
/** then moved this share of the way towards the icon's lower left corner */
const POO_SHIFT = 0.12;
/** and raised, as a share of the icon's height (clear of iOS's rounded corner) */
const POO_RAISE = 0.06;
/** and tilted clockwise, in degrees */
const POO_TILT = 30;
/** the bird's width as a share of the icon's (1: edge to edge) */
const WIDTH = 1;
/** the least gap above and below the bird, as a share of the icon's height (shrinks it if it'd reach further) */
const MARGIN = 0.03;

/** the rounded icons' outline: a superellipse |x|^n + |y|^n = 1, close to iOS's continuous-corner icon shape */
const SQUIRCLE = 5;

const SIZES = [
  { out: 'apple-touch-icon.png', size: 180, rounded: true },
  { out: 'icon-192.png', size: 192, rounded: true },
  { out: 'icon-512.png', size: 512, rounded: true },
];

const asset = (path) => readFile(new URL(`../public/assets/${path}`, import.meta.url), 'utf8');
const [bird, poo] = await Promise.all([asset(BIRD), asset(POO)]);
const outDir = new URL('../public/icons/', import.meta.url);
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({ headless: 'shell' });
try {
  const page = await browser.newPage();
  for (const { out, size, rounded } of SIZES) {
    const dataUrl = await page.evaluate(
      async (bird, poo, size, rounded, o) => {
        const load = async (svg) => {
          const img = new Image();
          img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
          await img.decode();
          return img;
        };
        const [b, p] = await Promise.all([load(bird), load(poo)]);
        const bw = b.naturalWidth, bh = b.naturalHeight;
        const angle = (-o.tilt * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        // draws the bird tilted, its image's centre at the origin
        const drawBird = (g) => {
          g.rotate(angle);
          g.drawImage(b, -bw / 2, -bh / 2);
        };

        // the tilted bird's drawn bounds (its image has empty margins), from its opaque pixels, relative to its centre
        const k = 4, half = Math.hypot(bw, bh) / 2;
        const probe = document.createElement('canvas');
        probe.width = probe.height = Math.ceil(2 * half * k);
        const pg = probe.getContext('2d');
        pg.scale(k, k);
        pg.translate(half, half);
        drawBird(pg);
        const px = pg.getImageData(0, 0, probe.width, probe.height).data;
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let y = 0; y < probe.height; y++)
          for (let x = 0; x < probe.width; x++)
            if (px[(y * probe.width + x) * 4 + 3] > 8) {
              left = Math.min(left, x);
              right = Math.max(right, x + 1);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y + 1);
            }
        [left, right, top, bottom] = [left / k - half, right / k - half, top / k - half, bottom / k - half];

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const g = canvas.getContext('2d');

        // the squircle everything's clipped to (fine enough steps for a smooth antialiased edge)
        if (rounded) {
          const r = size / 2, steps = 720;
          g.beginPath();
          for (let i = 0; i < steps; i++) {
            const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
            g.lineTo(r + r * Math.sign(c) * Math.abs(c) ** (2 / o.squircle), r + r * Math.sign(s) * Math.abs(s) ** (2 / o.squircle));
          }
          g.closePath();
          g.clip();
        }

        // the sky: the top colour at the top, the horizon at the bottom
        const sky = g.createLinearGradient(0, 0, 0, size);
        sky.addColorStop(0, o.top);
        sky.addColorStop(1, o.horizon);
        g.fillStyle = sky;
        g.fillRect(0, 0, size, size);

        // the bird spanning the icon's width, unless it'd then be too tall; centred
        const scale = Math.min((size * o.width) / (right - left), (size * (1 - 2 * o.margin)) / (bottom - top));
        const ox = size / 2 - ((left + right) / 2) * scale, oy = size / 2 - ((top + bottom) / 2) * scale;

        // the poo, behind the bird: its top a little below where it came out of the tilted bird, then moved towards
        // the lower left corner and tilted
        const fx = (o.pooFrom.x - 0.5) * bw, fy = (o.pooFrom.y - 0.5) * bh;
        const ph = bh * o.pooHeight * scale, pw = (p.naturalWidth * ph) / p.naturalHeight;
        let pcx = ox + (fx * cos - fy * sin) * scale, pcy = oy + (fx * sin + fy * cos + o.pooDrop) * scale + ph / 2;
        pcx += (0 - pcx) * o.pooShift;
        pcy += (size - pcy) * o.pooShift - size * o.pooRaise;
        g.save();
        g.translate(pcx, pcy);
        g.rotate((o.pooTilt * Math.PI) / 180);
        g.drawImage(p, -pw / 2, -ph / 2, pw, ph);
        g.restore();

        g.translate(ox, oy);
        g.scale(scale, scale);
        drawBird(g);
        return canvas.toDataURL('image/png');
      },
      bird,
      poo,
      size,
      rounded,
      { ...SKY, squircle: SQUIRCLE, tilt: TILT, pooHeight: POO_HEIGHT, pooFrom: POO_FROM, pooDrop: POO_DROP,
        pooShift: POO_SHIFT,
        pooRaise: POO_RAISE,
        pooTilt: POO_TILT,
        width: WIDTH, margin: MARGIN },
    );
    await writeFile(new URL(out, outDir), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log(out);
  }
} finally {
  await browser.close();
}
