import GUI from 'lil-gui';
import { Application, Container, Graphics } from 'pixi.js';
import { dragonConfig } from '../characters/dragon';
import { ghostDef, villainDef } from '../characters/villain';
import { WORLD } from '../config';
import { Dragon } from '../game/Dragon';
import { CLASS_DEFAULTS } from '../level/tiled';
import { showBackingsFor } from '../render/backing';
import { CharacterSprite } from '../render/CharacterSprite';
import { loadAllAssets } from '../render/assets';
import { fitWorld } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';

/**
 * The dragon prototype: dragons spitting straight ahead and along a path, the villain and two ghosts beside them for scale.
 * The panel tunes `dragonConfig` live and each dragon's timing; "spit now" makes them spit.
 */
async function main() {
  const app = new Application();
  await app.init({ resizeTo: window, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), background: scenery.skyColor });
  document.body.appendChild(app.canvas);
  await loadAllAssets();

  const world = new Container();
  app.stage.addChild(world);
  const ground = new Graphics().rect(-2000, WORLD.groundY, WORLD.width + 4000, 400).fill('#a9c98a').moveTo(-2000, WORLD.groundY).lineTo(WORLD.width + 2000, WORLD.groundY).stroke({ width: 3, color: '#2b2b2b' });
  world.addChild(ground);

  const villain = new CharacterSprite(villainDef);
  villain.position.set(90, WORLD.groundY);
  villain.anim.stop();
  const ghosts = [190, 262].map((x) => {
    const g = new CharacterSprite(ghostDef);
    g.position.set(x, WORLD.groundY);
    g.alpha = 0.7;
    return g;
  });
  world.addChild(villain, ...ghosts);

  const defaults = { ...CLASS_DEFAULTS.Dragon, path: null, throwDelay: 3 };
  const dragons = [
    new Dragon({ ...defaults, x: 420, y: WORLD.groundY, facing: 'right' }),
    new Dragon({ ...defaults, x: 930, y: WORLD.groundY, facing: 'left', fireLength: 160, initialDelay: 1 }),
    // fire along a path: up and over, then down
    new Dragon({ ...defaults, x: 640, y: 380, facing: 'right', initialDelay: 2, path: [[720, 340], [800, 260], [900, 260], [980, 420]] }),
  ];
  for (const d of dragons) world.addChild(d.view);
  // a wall in the path dragon's way, to show the fire stopping at it (the game uses the level's bodies)
  const wallRect = { x: 860, y: 200, width: 24, height: 130 };
  const wall = world.addChild(new Graphics().rect(wallRect.x, wallRect.y, wallRect.width, wallRect.height).fill('#9a8f7d').stroke({ width: 3, color: '#2b2b2b' }));
  const inWall = (x: number, y: number) => wall.visible && x >= wallRect.x && x <= wallRect.x + wallRect.width && y >= wallRect.y && y <= wallRect.y + wallRect.height;
  const boxes = world.addChild(new Graphics());

  const ui = { showHitbox: false, night: false, paused: false, spit: () => dragons.forEach((d) => d.spitNow()) };
  const gui = new GUI({ title: 'Dragon' });
  gui.add(ui, 'spit').name('spit now');
  gui.add(ui, 'paused');
  gui.add(ui, 'showHitbox').name('show fire hitbox');
  gui.add(wall, 'visible').name('wall');
  gui.add(ui, 'night').onChange((v: boolean) => {
    app.renderer.background.color = v ? '#19276b' : scenery.skyColor;
    showBackingsFor(v ? 'night' : 'afternoon');
  });
  dragons.forEach((d, i) => {
    const f = gui.addFolder(`dragon ${i + 1}`);
    f.add(d.def, 'throwDelay', 0, 10, 0.1);
    f.add(d.def, 'flameDuration', 0, 5, 0.1);
  });
  const fire = gui.addFolder('fire (all)');
  fire.add(dragonConfig.fire, 'rollMs', 50, 2000, 10);
  fire.add(dragonConfig.fire, 'flowSpeed', 20, 1000, 10);
  fire.add(dragonConfig.fire, 'puffSpacing', 4, 40, 1);
  fire.add(dragonConfig.fire, 'startScale', 0, 1, 0.01);
  fire.add(dragonConfig.fire, 'endScale', 0, 1, 0.01);
  fire.add(dragonConfig.fire, 'growOver', 0, 200, 1);
  fire.add(dragonConfig.fire, 'taperOver', 0, 200, 1);
  fire.add(dragonConfig.fire, 'spread', 0, 1, 0.01);
  fire.add(dragonConfig.fire, 'wobble', 0, 10, 0.1);
  fire.add(dragonConfig.fire, 'halfThickness', 2, 30, 1);
  fire.add(dragonConfig.fire, 'hitTrim', 0, 1, 0.05);
  const shake = gui.addFolder('shake (all)');
  shake.add(dragonConfig.shake, 'px', 0, 5, 0.1);
  shake.add(dragonConfig.shake, 'ms', 10, 200, 5);

  app.ticker.add(() => {
    fitWorld(app, world);
    if (!ui.paused) for (const d of dragons) d.step(Math.min(50, app.ticker.deltaMS), inWall);
    for (const d of dragons) d.sync();
    boxes.clear();
    if (!ui.showHitbox) return;
    // the burning part of each route, as thick as it burns
    for (const d of dragons) {
      const reach = d.burnReach;
      if (!reach) continue;
      const pts = [d.route.pointAt(0)];
      for (let s = 8; s < reach; s += 8) pts.push(d.route.pointAt(s));
      pts.push(d.route.pointAt(reach));
      boxes.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) boxes.lineTo(p.x, p.y);
      boxes.stroke({ width: 2 * dragonConfig.fire.halfThickness, color: '#0050ff', alpha: 0.35, cap: 'round', join: 'round' });
    }
  });
}

main();
