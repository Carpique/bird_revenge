import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { postureIntent, postureStep, type PostureIntent } from '../src/game/posture';
import { STEP_MS } from '../src/game/physics';
import { PostureDetector } from '../src/gestures/PostureDetector';
import { frames } from './synthetic';

describe('posture intent', () => {
  it('both arms down: free fall', () => {
    expect(postureIntent(-80, -80).mode).toBe('fall');
    expect(postureIntent(0, -60).mode).toBe('fall'); // one level, the other down: no speed arm
  });

  it('T: parachute', () => {
    expect(postureIntent(0, 0).mode).toBe('parachute');
    expect(postureIntent(5, -5).mode).toBe('parachute');
  });

  it('both arms raised equally: straight up, faster the higher', () => {
    const half = postureIntent(45, 45);
    const full = postureIntent(90, 90);
    expect(half).toMatchObject({ mode: 'fly', dir: 0, angle: 90 });
    expect(full).toMatchObject({ mode: 'fly', dir: 0, angle: 90, speed: 1 });
    expect(half.speed).toBeGreaterThan(0.3);
    expect(half.speed).toBeLessThan(full.speed);
  });

  it('one arm up, the other level: sideways towards the level arm at full speed', () => {
    expect(postureIntent(90, 0)).toMatchObject({ mode: 'fly', dir: 1, angle: 0, speed: 1 }); // right arm level
    expect(postureIntent(0, 90)).toMatchObject({ mode: 'fly', dir: -1, angle: 0, speed: 1 });
  });

  it('other arm in between: diagonal', () => {
    const p = postureIntent(90, 40);
    expect(p.mode).toBe('fly');
    expect(p.dir).toBe(1);
    expect(p.angle).toBeGreaterThan(20);
    expect(p.angle).toBeLessThan(70);
  });

  it('other arm below horizontal: dive towards it, steeper the lower it is, speed from the raised arm', () => {
    const shallow = postureIntent(90, -30);
    const steep = postureIntent(90, -80);
    expect(shallow).toMatchObject({ mode: 'dive', dir: 1, speed: 1 });
    expect(shallow.angle).toBeLessThan(0);
    expect(steep.angle).toBeLessThan(shallow.angle);
    expect(steep.angle).toBe(-90);
    expect(postureIntent(-30, 40).dir).toBe(-1);
    expect(postureIntent(40, -30).speed).toBeLessThan(shallow.speed);
  });
});

describe('posture physics', () => {
  /** 2 s airborne under one posture with Matter's gravity and air friction, from velocity v0 (px/step) */
  const fly = (p: PostureIntent, v0 = { x: 0, y: 0 }) => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    let v = { ...v0 };
    for (let i = 0; i < 120; i++) {
      const s = postureStep(v, p, STEP_MS);
      const k = 1 - (p.mode === 'fall' ? config.physics.birdAirFriction : config.posture.airFriction);
      v = { x: s.x * k, y: (s.y + (s.holdUp ? 0 : g)) * k };
    }
    return v;
  };

  it('arms up: climbs at a speed set by how high they are', () => {
    const full = fly(postureIntent(90, 90), { x: 0, y: 6 });
    const half = fly(postureIntent(45, 45));
    expect(full.y).toBeLessThan(-config.posture.flySpeed * 0.9);
    expect(half.y).toBeLessThan(-1);
    expect(half.y).toBeGreaterThan(full.y);
    expect(Math.abs(full.x)).toBeLessThan(0.1);
  });

  it('one up, one level: flies sideways holding height', () => {
    const v = fly(postureIntent(90, 0));
    expect(v.x).toBeGreaterThan(config.posture.flySpeed * 0.9);
    expect(Math.abs(v.y)).toBeLessThan(0.5);
  });

  it('one up, one down: dives towards the lower arm', () => {
    const v = fly(postureIntent(-45, 90));
    expect(v.x).toBeLessThan(-2);
    expect(v.y).toBeGreaterThan(2);
  });

  it('arms down: momentum fades, falls', () => {
    const v = fly(postureIntent(-80, -80), { x: 8, y: -6 });
    expect(Math.abs(v.x)).toBeLessThan(0.5);
    expect(v.y).toBeGreaterThan(3);
  });

  it('T: slow parachute sink', () => {
    const v = fly(postureIntent(0, 0), { x: 0, y: 7 });
    expect(v.y).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(config.glide.sinkSpeed + 0.5);
  });
});

describe('PostureDetector', () => {
  const last = (fs: ReturnType<typeof frames>) => {
    const d = new PostureDetector();
    return fs.map((f) => d.update(f, true, true)).at(-1)!;
  };

  it('reads arm angles relative to horizontal', () => {
    const o = last(frames(500, () => ({ armLeft: 170, armRight: 90 })));
    expect(o.left!).toBeGreaterThan(75);
    expect(Math.abs(o.right!)).toBeLessThan(5);
  });

  it("player's right arm level, left arm up: flies to the screen's right", () => {
    // the player's right hand appears on the screen's right in the mirrored view
    const o = last(frames(500, () => ({ armLeft: 180, armRight: 90 })));
    expect(o.intent).toMatchObject({ mode: 'fly', dir: 1 });
  });

  it('no intent while an arm is out of view', () => {
    const d = new PostureDetector();
    const o = frames(200, () => ({ armLeft: 90, armRight: 90 })).map((f) => d.update(f, true, false)).at(-1)!;
    expect(o.intent).toBeNull();
  });
});
