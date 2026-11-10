import { describe, expect, it, vi } from 'vitest';
import { config, WORLD } from '../src/config';
import { Bird } from '../src/game/Bird';
import type { PointingIntent } from '../src/game/pointing';
import { Bodies, Composite, Engine, STEP_MS } from '../src/game/physics';
import { noControls } from '../src/input/controls';

// no textures in tests: a sprite that draws nothing, in a container that takes it as it is
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {},
}));
vi.mock('pixi.js', () => ({ Container: class { addChild() {} } }));

/** a continuous command (px per step, y down), labelled as `continuousArms` labels it (below 0.25 px/step a hover) */
const cmd = (vx: number, vy: number): PointingIntent => {
  const s = Math.hypot(vx, vy);
  const mode = s < 0.25 ? 'hover' : 'drift';
  return { mode, dx: s ? vx / s : 0, dy: s ? -vy / s : 0, vx, vy, ...(mode === 'drift' && vy > 0 ? { sink: vy } : {}) };
};
/** the camera frame (~30 fps) a physics step falls in: the intent changes once per frame */
const frame = (i: number) => Math.floor((i * STEP_MS) / 33);

/** a bird standing on the game's floor, steered by `intent` for `steps` physics steps (10 s by default) */
function onFloor(intent: (i: number) => PointingIntent | null, steps = 600) {
  const engine = Engine.create({ gravity: { x: 0, y: config.physics.gravity } });
  const opts = { isStatic: true, restitution: 0, friction: 0.2, frictionStatic: 0.5 };
  Composite.add(engine.world, Bodies.rectangle(WORLD.width / 2, WORLD.groundY + 100, WORLD.width * 3, 200, opts));
  const bird = new Bird(400);
  Composite.add(engine.world, bird.body);
  const c = noControls();
  const tick = () => {
    bird.step(c, STEP_MS, () => {});
    Engine.update(engine, STEP_MS);
  };
  for (let i = 0; i < 30; i++) tick();
  const floor = bird.body.position.y;
  let liftOffs = 0, onGround = true, groundSteps = 0, maxUp = 0;
  for (let i = 0; i < steps; i++) {
    c.pointing = intent(i);
    tick();
    if (onGround && !bird.onGround) liftOffs++;
    onGround = bird.onGround;
    if (onGround) groundSteps++;
    maxUp = Math.max(maxUp, floor - bird.body.position.y);
  }
  Engine.clear(engine);
  return { liftOffs, groundShare: groundSteps / steps, maxUp, x: bird.body.position.x - 400, up: floor - bird.body.position.y };
}

describe('Bird on the ground under continuous steering', () => {
  it('a command around the hover threshold: the bird stands, it neither hops nor shuffles', () => {
    // 0.2 / 0.3 px/step sideways, hover / drift from frame to frame. Before, the first drift frame kicked it off
    const r = onFloor((i) => cmd(frame(i) % 2 ? 0.3 : 0.2, 0));
    expect(r.liftOffs).toBe(0);
    expect(r.groundShare).toBe(1);
    expect(Math.abs(r.x)).toBeLessThan(1);
  });

  it('a drift held past enterMs lifts off once, to liftOffHeight, and drifts above the floor', () => {
    const r = onFloor((i) => (frame(i) < 3 ? cmd(0.1, 0) : cmd(0.5, 0)));
    expect(r.liftOffs).toBe(1);
    expect(r.up).toBeGreaterThan(config.tilt.liftOffHeight * 0.7);
    expect(r.up).toBeLessThan(config.tilt.liftOffHeight * 1.1);
    expect(r.x).toBeGreaterThan(250);
  });

  it('one drift frame between hovers: still standing', () => {
    const r = onFloor((i) => cmd(frame(i) === 10 ? 0.6 : 0.1, 0));
    expect(r.liftOffs).toBe(0);
    expect(Math.abs(r.x)).toBeLessThan(1);
  });

  it('a slow descent whose sink comes and goes from frame to frame: skims along the floor, no hops', () => {
    // vy 0.1 / 0: before, every frame without a sink on the floor kicked it up again (4 hops in 10 s)
    const r = onFloor((i) => cmd(0.5, frame(i) % 2 ? 0 : 0.1));
    expect(r.liftOffs).toBe(0);
    expect(r.groundShare).toBeGreaterThan(0.95);
    expect(r.x).toBeGreaterThan(250);
    // a faster sideways move, with the sink in one frame of three (gaps of 66 ms)
    const s = onFloor((i) => cmd(1.5, frame(i) % 3 ? 0 : 0.05));
    expect(s.liftOffs).toBe(0);
    expect(s.groundShare).toBeGreaterThan(0.95);
  });

  it('a level drift after a descent lifts off once the descent has stopped for a while', () => {
    // descending for 1 s (on the floor already), then level
    const r = onFloor((i) => cmd(0.5, i < 60 ? 0.2 : 0));
    expect(r.liftOffs).toBe(1);
    expect(r.up).toBeGreaterThan(config.tilt.liftOffHeight * 0.7);
  });

  it('a climb faster than the kick takes off as asked, with no kick', () => {
    const r = onFloor(() => ({ mode: 'fly', dx: 0, dy: 1, vx: 0, vy: -config.pointing.cruiseSpeed }), 20);
    expect(r.liftOffs).toBe(1);
    expect(r.up).toBeGreaterThan(50);
  });

  it('the poses (no velocity in the intent): a drift on the floor lifts off at once, as before', () => {
    const r = onFloor(() => ({ mode: 'drift', dx: 1, dy: 0 }), 120);
    expect(r.liftOffs).toBe(1);
    expect(r.up).toBeGreaterThan(config.tilt.liftOffHeight * 0.7);
    // and a hover stands
    expect(onFloor(() => ({ mode: 'hover', dx: 0, dy: 0 }), 120).liftOffs).toBe(0);
  });
});
