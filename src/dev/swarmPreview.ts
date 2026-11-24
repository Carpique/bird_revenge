import GUI from 'lil-gui';
import { Application, Container, Graphics } from 'pixi.js';
import { audio, type BuzzSound } from '../audio/audio';
import { splatHalfWidth, splatLifetimeMs } from '../characters/poo';
import { config, WORLD } from '../config';
import { inSight } from '../game/homing';
import { Bodies, Query, STEP_MS, type MBody } from '../game/physics';
import { Swarm, type SwarmPoo } from '../game/Swarm';
import { fitWorld } from '../render/fitWorld';

/**
 * The fly swarm prototype: a swarm or two among walls with gaps (one it squeezes through, one too narrow for it), the
 * mouse as the bird. Click to drop a poo where the mouse is; it falls and lies a while, and the swarm feeds on it.
 * The panel tunes `config.swarm` live; "restart" applies the fly count. `?night` starts at night.
 */
async function main() {
  const app = new Application();
  await app.init({ resizeTo: window, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  document.body.appendChild(app.canvas);
  const world = new Container();
  app.stage.addChild(world);

  const R = () => config.swarm.diameter / 2;
  // a wall with a gap 0.75 of the swarm (it squeezes through), a shelf, and a wall with a gap 0.4 of it (too narrow)
  const rects = [
    { x: 560, y: 0, w: 32, h: 300 - R() * 0.75 },
    { x: 560, y: 300 + R() * 0.75, w: 32, h: WORLD.groundY - 300 - R() * 0.75 },
    { x: 180, y: 470, w: 220, h: 16 },
    { x: 960, y: 0, w: 32, h: 380 - R() * 0.4 },
    { x: 960, y: 380 + R() * 0.4, w: 32, h: WORLD.groundY - 380 - R() * 0.4 },
  ];
  const bodies: MBody[] = rects.map((r) => Bodies.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, { isStatic: true }));
  const sky = new Graphics();
  const scene = new Graphics();
  for (const r of rects) scene.rect(r.x, r.y, r.w, r.h).fill('#9a8f7d').stroke({ width: 3, color: '#2b2b2b' });
  scene.rect(-2000, WORLD.groundY, WORLD.width + 4000, 400).fill('#a9c98a').moveTo(-2000, WORLD.groundY).lineTo(WORLD.width + 2000, WORLD.groundY).stroke({ width: 3, color: '#2b2b2b' });
  const swarmLayer = new Container();
  const pooLayer = new Graphics();
  const birdView = new Graphics().circle(0, 0, config.physics.birdRadius).fill({ color: '#e0b030', alpha: 0.85 }).stroke({ width: 3, color: '#2b2b2b' });
  const outlines = new Graphics();
  world.addChild(sky, scene, pooLayer, swarmLayer, birdView, outlines);

  const ui = {
    night: new URLSearchParams(location.search).has('night'),
    showOutline: false,
    sound: true,
    paused: false,
    restart: () => restart(),
  };
  const drawSky = () => sky.clear().rect(-2000, -2000, WORLD.width + 4000, WORLD.groundY + 2000).fill(ui.night ? '#1f2c70' : '#d8edf8');

  let swarms: Swarm[] = [];
  const buzz = new Map<Swarm, BuzzSound>();
  const restart = () => {
    for (const s of swarms) s.destroy();
    for (const b of buzz.values()) b.stop();
    buzz.clear();
    swarms = [new Swarm({ x: 300, y: 250 }, WORLD.width), new Swarm({ x: 1150, y: 250 }, WORLD.width)];
    for (const s of swarms) {
      s.setNight(ui.night);
      swarmLayer.addChild(s.view);
    }
    poos.length = 0;
  };

  /** poos: falling straight down, then lying `splatLifetimeMs` */
  const poos: { id: object; x: number; y: number; vy: number; lying: boolean; ms: number }[] = [];
  const bird = { x: WORLD.width / 2, y: 120 };
  const toWorld = (e: PointerEvent) => world.toLocal({ x: e.offsetX, y: e.offsetY });
  app.canvas.addEventListener('pointermove', (e) => Object.assign(bird, toWorld(e)));
  app.canvas.addEventListener('pointerdown', (e) => {
    const p = toWorld(e);
    poos.push({ id: {}, x: p.x, y: p.y, vy: 1, lying: false, ms: 0 });
  });

  const solid = (x: number, y: number) => y >= WORLD.groundY || y < 0 || x < 0 || x > WORLD.width || Query.point(bodies, { x, y }).length > 0;

  const gui = new GUI({ title: 'Fly swarm' });
  gui.add(ui, 'night').onChange(() => {
    drawSky();
    for (const s of swarms) s.setNight(ui.night);
  });
  gui.add(ui, 'showOutline');
  gui.add(ui, 'sound');
  gui.add(ui, 'paused');
  gui.add(ui, 'restart').name('restart (applies fly count)');
  const s = config.swarm;
  const f = gui.addFolder('config.swarm');
  f.add(s, 'flyCount', 1, 300, 1);
  f.add(s, 'diameter', 40, 300, 1);
  f.add(s, 'minScale', 0.2, 1, 0.05);
  f.add(s, 'flySize', 1, 8, 0.5);
  f.add(s, 'glowSize', 1, 8, 0.25);
  f.add(s, 'glowAlpha', 0, 1, 0.02);
  f.addColor(s, 'dayColor');
  f.addColor(s, 'nightColor');
  f.add(s, 'chaseSpeed', 0, 6, 0.1);
  f.add(s, 'pooSpeed', 0, 6, 0.1);
  f.add(s, 'turn', 0.01, 0.5, 0.01);
  f.add(s, 'wander', 0, 3, 0.05);
  f.add(s, 'wanderHz', 0, 2, 0.05);
  f.add(s, 'jitter', 0, 2, 0.05);
  f.add(s, 'flySpring', 0.0005, 0.05, 0.0005);
  f.add(s, 'flyDamping', 0, 0.5, 0.01);
  f.add(s, 'flyNoise', 0, 4, 0.05);
  f.add(s, 'flyMaxSpeed', 0.5, 15, 0.5);
  f.add(s, 'feedNoise', 0, 5, 0.05);
  f.add(s, 'feedDart', 0, 3, 0.05);
  f.add(s, 'feedRise', 0, 1, 0.05);
  f.add(s, 'feedSpread', 0.2, 5, 0.1);
  gui.add(config.audio, 'buzz', 0, 0.5, 0.01).name('audio.buzz');

  drawSky();
  restart();
  let acc = 0;
  app.ticker.add((ticker) => {
    fitWorld(app, world);
    audio.update();
    if (!ui.paused) {
      acc += Math.min(ticker.deltaMS, 100);
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        for (const p of poos) {
          if (p.lying) p.ms += STEP_MS;
          else if (solid(p.x, p.y + p.vy)) p.lying = true;
          else (p.vy = Math.min(p.vy + config.physics.gravity, 14)), (p.y += p.vy);
        }
        for (let i = poos.length - 1; i >= 0; i--) if (poos[i].ms >= splatLifetimeMs) poos.splice(i, 1);
        const seen: SwarmPoo[] = poos.map((p) => ({ id: p.id, x: p.x, y: p.y, lying: p.lying }));
        for (const sw of swarms) {
          sw.step(STEP_MS, { bodies, bird, seesBird: !sw.chasing && inSight(bodies, sw.position, bird), poos: seen, solid });
          const b = buzz.get(sw);
          if (ui.sound) {
            const playing = b && !b.ended ? b : audio.startBuzz();
            buzz.set(sw, playing);
            playing.set(1, sw.isFeeding ? 1 : sw.afterPoo ? 0.8 : sw.chasing ? 0.5 : 0.15);
          } else b?.stop();
        }
      }
    }
    birdView.position.set(bird.x, bird.y);
    birdView.tint = swarms.some((sw) => sw.touches(bird.x, bird.y, config.physics.birdRadius)) ? 0xff4040 : 0xffffff;
    pooLayer.clear();
    for (const p of poos) {
      if (p.lying) pooLayer.ellipse(p.x, p.y - 3, splatHalfWidth * 0.6, 5).fill({ color: '#7a5a2a', alpha: Math.min(1, 3 * (1 - p.ms / splatLifetimeMs)) });
      else pooLayer.circle(p.x, p.y, config.physics.pooRadius).fill('#7a5a2a');
    }
    outlines.clear();
    for (const sw of swarms) {
      sw.sync();
      if (!ui.showOutline) continue;
      const o = sw.outline;
      outlines.ellipse(o.x, o.y, o.rx, o.ry).stroke({ width: 1.5, color: ui.night ? '#ffffff' : '#c0392b', alpha: 0.6 });
    }
  });
}

void main();
