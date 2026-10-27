import { Application, Container, Text } from 'pixi.js';
import { audio } from '../audio/audio';
import { splatHalfWidth } from '../characters/poo';
import { villainHitbox } from '../characters/villain';
import { config, WORLD } from '../config';
import { noControls, type Controls } from '../input/controls';
import { buildLevel, type BuiltLevel } from '../level/build';
import { LevelView } from '../level/LevelView';
import type { Branch, LevelDef } from '../level/types';
import { fitWorld } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';
import { HAND_FONT as FONT, titleStyle } from '../ui/fonts';
import { i18n, t } from '../ui/i18n';
import { Apple } from './Apple';
import { Background } from './Background';
import { Bird } from './Bird';
import { Friend } from './Friend';
import { landingBranch } from './branches';
import { Bodies, Composite, Engine, Events, Query, STEP_MS, type MBody, type MEngine, type MPair } from './physics';
import { Poo } from './Poo';
import { Villain, type Span } from './Villain';

/** how far (px) a surface may be from a villain's feet and still be what he walks on */
const SURFACE_TOLERANCE = 8;

interface Popup {
  text: Text;
  t: number;
}

/**
 * The game world: PixiJS for drawing, Matter.js for physics, fixed 60 Hz simulation.
 * Knows nothing about cameras or poses — it just reads `controls` and `requestPoo()`.
 */
export class Game {
  readonly root = new Container();
  paused = true;
  /** show the big "Paused" label while paused (only for a manual pause, not behind dialogs) */
  showPausedText = false;
  score = 0;
  lives = config.player.lives;
  /** lost the last life; frozen behind "Game Over" until `reset()` */
  over = false;
  /** called once when the bird has fallen off the screen for the last time */
  onGameOver: (() => void) | null = null;
  /** all friends saved; frozen behind "Hooray" until the next level loads */
  complete = false;
  /** called once, a while after the last friend is saved: time to load the next level */
  onLevelComplete: (() => void) | null = null;
  /** latest controls; set by main from pose + keyboard */
  controls: Controls = noControls();

  private engine: MEngine;
  private world = new Container();
  /** the walking villains */
  private actors = new Container();
  /** the friends to save: behind the villain */
  private friendLayer = new Container();
  /** poos and apples: in front of the villain, behind the bird */
  private fx = new Container();
  /** the bird, then score popups */
  private top = new Container();
  /** in front of everything: the knocked-off villain flying towards the camera, a saved friend growing */
  private front = new Container();
  private hud = new Container();
  private background = new Background();
  /** the level's shelves, crates, ropes: in front of the background, behind the villain */
  private levelLayer = new Container();
  private built: BuiltLevel = { bodies: [], joints: [] };
  private levelView: LevelView | null = null;
  /** the level's bodies, which the bird can stand on and apples stop at */
  private levelBodies: MBody[] = [];
  /** the level's branches the bird can sit on */
  private branches: readonly Branch[] = [];
  private bird: Bird;
  /** the level's villains; a knocked-off one stays (gone) until the level restarts */
  private villains: Villain[] = [];
  private poos: Poo[] = [];
  private apples: Apple[] = [];
  private friends: Friend[] = [];
  private popups: Popup[] = [];
  private pending: (() => void)[] = [];
  /** things to do after a while, in game time (so they wait while paused) */
  private timers: { ms: number; fn: () => void }[] = [];
  private acc = 0;
  private scoreText: Text;
  private pausedText: Text;
  private hearts = new Container();
  private gameOverText: Text;
  /** ms since game over (drives the falling sign) */
  private overT = 0;
  private completeText: Text;
  /** ms since the last friend was saved (drives the falling sign and the next level) */
  private completeT = 0;
  /** queued poo request: sideways direction (-1 left, 0 straight down, +1 right), or null */
  private pooQueued: number | null = null;
  private pooDir = 0;

  constructor(
    private app: Application,
    /** the level being played; change it with `loadLevel` */
    public level: LevelDef,
  ) {
    app.renderer.background.color = scenery.skyColor;
    // resting bodies sleep until something touches them (the bird never does)
    this.engine = Engine.create({ gravity: { x: 0, y: config.physics.gravity }, enableSleeping: true });

    // static world bounds: ground, walls, ceiling. Only the ground has friction (the bird has none of its own),
    // so the bird doesn't stick to the walls or ceiling when pushed against them
    const opts = { isStatic: true, restitution: 0, friction: 0, frictionStatic: 0 };
    Composite.add(this.engine.world, [
      Bodies.rectangle(WORLD.width / 2, WORLD.groundY + 100, WORLD.width * 3, 200, { ...opts, friction: 0.2, frictionStatic: 0.5, label: 'ground' }),
      Bodies.rectangle(-50, WORLD.height / 2, 100, WORLD.height * 3, { ...opts, label: 'wall' }),
      Bodies.rectangle(WORLD.width + 50, WORLD.height / 2, 100, WORLD.height * 3, { ...opts, label: 'wall' }),
      Bodies.rectangle(WORLD.width / 2, -60, WORLD.width * 3, 100, { ...opts, label: 'ceiling' }),
    ]);

    this.bird = new Bird(this.birdStart().x);
    Composite.add(this.engine.world, this.bird.body);

    Events.on(this.engine, 'collisionStart', (e) => {
      for (const pair of e.pairs) this.onCollision(pair);
    });

    // layers
    this.top.addChild(this.bird.view);
    this.world.addChild(this.background, this.levelLayer, this.friendLayer, this.actors, this.fx, this.top, this.front);
    this.root.addChild(this.world, this.hud);

    this.scoreText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 40, fill: '#2b2b2b' } });
    this.scoreText.position.set(24, 14);
    this.hearts.position.set(WORLD.width - 24, 14);
    this.buildHearts();
    this.pausedText = bigText('');
    this.gameOverText = bigText('');
    this.completeText = bigText('');
    const relabel = () => {
      this.updateScoreText();
      this.pausedText.text = t('Pause');
      this.gameOverText.text = t('Game Over');
      this.completeText.text = t('Hooray!');
    };
    i18n.onChange(relabel);
    relabel();
    this.gameOverText.visible = false;
    this.completeText.visible = false;
    this.hud.addChild(this.scoreText, this.hearts, this.pausedText, this.gameOverText, this.completeText);

    app.stage.addChild(this.root);
    app.ticker.add((ticker) => this.update(ticker.deltaMS));
    this.restartLevel();
  }

  /**
   * Ask the bird to squat and drop a poo (ignored while already squatting).
   * `dir` gives the poo a little sideways speed on screen: -1 left, 0 straight down, +1 right.
   */
  requestPoo(dir = 0) {
    if (!this.paused && !this.over && !this.complete) this.pooQueued = dir;
  }

  /** Start a new game: score, lives, the level, bird, villain and poos back to the start. */
  reset() {
    this.score = 0;
    this.updateScoreText();
    this.lives = config.player.lives;
    this.buildHearts();
    this.over = false;
    this.overT = 0;
    this.restartLevel();
  }

  /** Play another level, or a new version of this one (saved in the editor): from its start, keeping score and lives. */
  loadLevel(level: LevelDef) {
    this.level = level;
    this.restartLevel();
  }

  /** The level, bird, villain, friends and poos back to the start. */
  private restartLevel() {
    this.pooQueued = null;
    this.complete = false;
    this.completeT = 0;
    this.buildLevel();
    const start = this.birdStart();
    this.bird.respawn(start.x, start.y, false);
    Composite.remove(this.engine.world, this.bird.body); // no-op unless it was left in
    Composite.add(this.engine.world, this.bird.body);
    for (const v of this.villains) {
      Composite.remove(this.engine.world, v.body);
      v.view.destroy();
    }
    this.villains = this.level.villains.map((def) => {
      const v = new Villain(def);
      v.onThrow = (x, y, dir) => this.throwApple(x, y, dir);
      Composite.add(this.engine.world, v.body);
      this.actors.addChildAt(v.view, 0);
      return v;
    });
    for (const p of this.poos) {
      p.stopSound();
      Composite.remove(this.engine.world, p.body);
      p.view.destroy();
    }
    this.poos = [];
    for (const a of this.apples) a.view.destroy();
    this.apples = [];
    for (const f of this.friends) f.view.destroy();
    this.friends = this.level.friends.map((def) => new Friend(def));
    for (const f of this.friends) this.friendLayer.addChild(f.view);
    for (const p of this.popups) p.text.destroy();
    this.popups = [];
    this.pending = [];
    this.timers = [];
    this.acc = 0;
    this.sync();
  }

  /** (Re)creates the level's bodies, joints and their drawing from `this.level`. */
  private buildLevel() {
    const world = this.engine.world;
    Composite.remove(world, [...this.built.bodies.map((b) => b.body), ...this.built.joints.map((j) => j.constraint)]);
    this.levelView?.destroy();
    this.built = buildLevel(this.level);
    Composite.add(world, [...this.built.bodies.map((b) => b.body), ...this.built.joints.map((j) => j.constraint)]);
    this.levelView = new LevelView(this.level, this.built);
    this.levelLayer.addChild(this.levelView);
    this.levelBodies = this.built.bodies.map((b) => b.body);
    this.branches = this.level.branches;
  }

  private birdStart() {
    return this.level.birdStart ?? { x: WORLD.width / 2, y: WORLD.groundY - config.physics.birdRadius };
  }

  private update(dtMs: number) {
    fitWorld(this.app, this.root);
    this.pausedText.visible = this.paused && this.showPausedText && !this.over;
    this.gameOverText.visible = this.over;
    this.completeText.visible = this.complete;
    if (!this.paused && this.over) {
      this.overT += dtMs;
      this.background.update(dtMs);
    } else if (!this.paused && this.complete) {
      // the world stands still; the last friend fades out meanwhile
      this.completeT += dtMs;
      for (const f of this.friends) f.step(dtMs);
      this.background.update(dtMs);
      this.updatePopups(dtMs);
      if (this.completeT >= config.levelComplete.nextMs) this.onLevelComplete?.();
    } else if (!this.paused) {
      this.acc += Math.min(dtMs, 100);
      while (this.acc >= STEP_MS && !this.over && !this.complete) {
        this.step();
        this.acc -= STEP_MS;
      }
      this.background.update(dtMs);
      this.updatePopups(dtMs);
    }
    this.sync();
  }

  private step() {
    this.engine.gravity.y = config.physics.gravity;
    if (this.pooQueued !== null && !this.bird.dying) {
      if (this.bird.squat()) this.pooDir = this.pooQueued;
      this.pooQueued = null;
    }
    this.bird.step(this.controls, STEP_MS, () => this.dropPoo());
    const bp = this.bird.body.position;
    const bird = this.bird.dying ? null : { x: bp.x, y: bp.y };
    for (const v of this.villains) v.step(STEP_MS, { bird, obstacles: this.villainObstacles(v.feet) });
    for (const p of this.poos) p.step(STEP_MS);
    for (const a of this.apples) a.step(STEP_MS);
    for (const f of this.friends) f.step(STEP_MS);
    const birdY = this.bird.body.position.y;
    const pooYs = new Map(this.poos.map((p) => [p, p.body.position.y]));
    Engine.update(this.engine, STEP_MS);
    this.bird.perchOn(this.branches, birdY);
    this.bird.standOn(this.levelBodies);
    this.landPoosOnBranches(pooYs);
    for (const fn of this.pending.splice(0)) fn();
    for (const t of this.timers) t.ms -= STEP_MS;
    const due = this.timers.filter((t) => t.ms <= 0);
    this.timers = this.timers.filter((t) => t.ms > 0);
    for (const t of due) t.fn();
    this.saveFriends();
    // bird touching a walking villain costs a life
    const b = this.bird.body;
    if (!this.bird.dying && !this.bird.invulnerable && this.villains.some((v) => v.touches(b.position.x, b.position.y, config.physics.birdRadius))) {
      this.loseLife();
    }
    // ...and so does an apple
    for (const a of this.apples) {
      if (a.state !== 'flying' || this.bird.dying || this.bird.invulnerable) continue;
      const hitR = config.physics.birdRadius + config.apple.radius;
      if ((a.x - b.position.x) ** 2 + (a.y - b.position.y) ** 2 < hitR * hitR) {
        a.state = 'done';
        this.loseLife();
      }
    }
    // an apple stops at whatever of the level is in its way
    for (const a of this.apples) if (a.state === 'flying' && Query.point(this.levelBodies, { x: a.x, y: a.y }).length) a.hit();
    // a falling poo knocks an apple out of the air: both blink out
    const hitR = config.physics.pooRadius + config.apple.radius;
    for (const p of this.poos) {
      if (p.state !== 'falling') continue;
      const pp = p.body.position;
      const a = this.apples.find((a) => a.state === 'flying' && (a.x - pp.x) ** 2 + (a.y - pp.y) ** 2 < hitR * hitR);
      if (!a) continue;
      Composite.remove(this.engine.world, p.body);
      p.hit();
      a.hit();
      audio.play('splat');
    }
    if (this.bird.fallen) this.afterDeath();
    // remove finished poos
    this.poos = this.poos.filter((p) => {
      if (p.state !== 'done') return true;
      p.view.destroy();
      return false;
    });
    this.apples = this.apples.filter((a) => {
      if (a.state !== 'done') return true;
      a.view.destroy();
      return false;
    });
  }

  /** The bird flying into a friend saves it; saving the last one completes the level. */
  private saveFriends() {
    if (this.bird.dying) return;
    const b = this.bird.body.position;
    for (const f of this.friends) {
      if (f.state !== 'waiting' || !f.touches(b.x, b.y, config.physics.birdRadius)) continue;
      f.save();
      this.front.addChild(f.view);
      audio.play('friend');
    }
    if (this.friends.length && this.friends.every((f) => f.state !== 'waiting')) this.completeLevel();
  }

  /** All friends saved: everything stops, "Hooray" drops in, and a while later the next level starts (`onLevelComplete`). */
  private completeLevel() {
    this.complete = true;
    this.completeT = 0;
    this.pooQueued = null;
    for (const p of this.poos) p.stopSound();
  }

  /** A falling poo that crossed a branch's top edge this step splats on the branch. `prevYs`: poo centres before the step. */
  private landPoosOnBranches(prevYs: Map<Poo, number>) {
    for (const p of this.poos) {
      const prevY = prevYs.get(p);
      if (p.state !== 'falling' || prevY === undefined || p.body.velocity.y < 0) continue;
      const pos = p.body.position;
      const landing = landingBranch(this.branches, pos.x, prevY, pos.y, config.physics.pooRadius);
      if (!landing) continue;
      const [x0, y0] = landing.branch.from, [x1, y1] = landing.branch.to;
      Composite.remove(this.engine.world, p.body);
      p.splat(landing.top, Math.atan((y1 - y0) / (x1 - x0)));
      audio.play('splat');
    }
  }

  /** Stretches of ground sheltered from above right now. Static for now; moving obstacles would recompute them here each step. */
  /**
   * What a villain with his feet at `feetY` won't walk into (crates move, so every step): the poo splats he'd step in,
   * the level's bodies reaching into his height, and wherever there's nothing to stand on at his feet
   * (all but the ground's or his shelf's top).
   */
  private villainObstacles(feetY: number): Span[] {
    const near = (y: number) => Math.abs(y - feetY) <= SURFACE_TOLERANCE;
    const head = feetY - villainHitbox.height;
    const splats = this.poos
      .filter((p) => p.state === 'splat' && near(p.view.y))
      .map((p) => ({ x0: p.view.x - splatHalfWidth, x1: p.view.x + splatHalfWidth }));
    const bodies = this.levelBodies
      .filter((b) => b.bounds.max.y > head && b.bounds.min.y < feetY - SURFACE_TOLERANCE)
      .map((b) => ({ x0: b.bounds.min.x, x1: b.bounds.max.x }));
    if (near(WORLD.groundY)) return [...splats, ...bodies];
    // off the ground: he stands only on the tops of bodies at his feet
    const tops = this.levelBodies
      .filter((b) => near(b.bounds.min.y))
      .map((b) => ({ x0: b.bounds.min.x, x1: b.bounds.max.x }))
      .sort((a, b) => a.x0 - b.x0);
    const gaps: Span[] = [];
    let from = -WORLD.width;
    for (const t of tops) {
      if (t.x0 > from) gaps.push({ x0: from, x1: t.x0 });
      from = Math.max(from, t.x1);
    }
    gaps.push({ x0: from, x1: 2 * WORLD.width });
    return [...splats, ...bodies, ...gaps];
  }

  /** How fast the villain's apples fly (px per physics step). Constant for now; could grow as the game goes on. */
  private appleSpeed(): number {
    return config.apple.speed;
  }

  /**
   * Throw an apple from (x, y) in a straight line at where the bird is now (no leading, so moving dodges it).
   * It flies only the way the villain faces (`dir`): aimed behind him (the aim error, or the bird crossing over him
   * during the windup), it goes straight up or down instead. It keeps going until it leaves the screen.
   */
  private throwApple(x: number, y: number, dir: 1 | -1) {
    const target = this.bird.body.position;
    const v = this.appleSpeed();
    let angle = Math.atan2(target.y - y, target.x - x);
    angle += ((Math.random() * 2 - 1) * config.apple.aimSpread * Math.PI) / 180;
    if (Math.cos(angle) * dir < 0) angle = Math.sin(angle) < 0 ? -Math.PI / 2 : Math.PI / 2;
    const apple = new Apple(x, y, v * Math.cos(angle), v * Math.sin(angle));
    this.apples.push(apple);
    this.fx.addChild(apple.view);
  }

  private dropPoo() {
    const b = this.bird.body;
    const r = config.physics.birdRadius;
    const poo = new Poo(b.position.x, b.position.y + r * 0.6, b.velocity.x * 0.6 + this.pooDir * config.physics.pooSideSpeed, Math.max(1, b.velocity.y));
    audio.play('shot');
    poo.stopSound = audio.startFall();
    this.poos.push(poo);
    Composite.add(this.engine.world, poo.body);
    this.fx.addChild(poo.view);
  }

  private onCollision(pair: MPair) {
    const { bodyA: a, bodyB: b } = pair;
    const labels = [a.label, b.label];
    if (!labels.includes('poo')) return;
    const pooBody = a.label === 'poo' ? a : b;
    const other = pooBody === a ? b : a;
    const poo = this.poos.find((p) => p.body === pooBody);
    if (!poo || poo.state !== 'falling') return;

    const villain = this.villains.find((v) => v.body === other);
    if (villain?.hittable) {
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        poo.stopSound();
        audio.play('splat');
        if (villain.hit()) {
          this.addScore(config.score.villain, pooBody.position.x, pooBody.position.y);
          audio.play('bad-guy-dies');
          this.after(1000, () => audio.play('score'));
        }
        Composite.remove(this.engine.world, pooBody);
        poo.state = 'done';
      });
    } else if (other.label === 'ground') {
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        Composite.remove(this.engine.world, pooBody);
        poo.splat();
        audio.play('splat');
      });
    } else if (other.label === 'terrain') {
      // lies along the surface it hit, where it touched (read now: Matter reuses the collision object)
      const y = surfaceY(other, pooBody, pair.collision.supports[0], pair.collision.normal);
      const angle = surfaceAngle(pair.collision.normal);
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        Composite.remove(this.engine.world, pooBody);
        poo.splat(y, angle);
        audio.play('splat');
      });
    } else if (other.label === 'body') {
      // a splat wouldn't stay on a moving thing: the poo just goes
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        poo.stopSound();
        audio.play('splat');
        Composite.remove(this.engine.world, pooBody);
        poo.state = 'done';
      });
    }
  }

  /** The bird dies and falls off the screen; the lost heart blinks meanwhile. */
  private loseLife() {
    this.lives = Math.max(0, this.lives - 1);
    this.bird.die();
    audio.play('player-hit');
    audio.play('boing');
    this.after(1000, () => audio.play('sad-audience'));
    Composite.remove(this.engine.world, this.bird.body);
  }

  private after(ms: number, fn: () => void) {
    this.timers.push({ ms, fn });
  }

  /** The dead bird has left the screen: a new one appears at the level's start, or it's game over. */
  private afterDeath() {
    if (this.lives > 0) {
      const start = this.birdStart();
      this.bird.respawn(start.x, start.y, true);
      Composite.add(this.engine.world, this.bird.body);
      return;
    }
    this.over = true;
    this.overT = 0;
    this.onGameOver?.();
  }

  /** One heart per life, right-aligned in the corner. */
  private buildHearts() {
    for (const c of this.hearts.removeChildren()) c.destroy();
    const n = config.player.lives;
    for (let i = 0; i < n; i++) {
      const heart = new Text({ text: '♥', style: { fontFamily: FONT, fontSize: 40, fill: '#c0392b', stroke: { color: '#fff', width: 5 } } });
      heart.anchor.set(1, 0);
      heart.x = -(n - 1 - i) * 40;
      this.hearts.addChild(heart);
    }
  }

  private updateScoreText() {
    this.scoreText.text = t('Score: {score}', { score: this.score });
  }

  private addScore(points: number, x: number, y: number) {
    this.score += points;
    this.updateScoreText();
    const text = new Text({
      text: points > 0 ? `+${points}` : `${points}`,
      style: { fontFamily: FONT, fontSize: 44, fill: points > 0 ? '#2f8a3c' : '#c0392b', stroke: { color: '#fff', width: 5 } },
    });
    text.anchor.set(0.5);
    text.position.set(x, y - 40);
    this.top.addChild(text);
    this.popups.push({ text, t: 0 });
  }

  private updatePopups(dtMs: number) {
    this.popups = this.popups.filter((p) => {
      p.t += dtMs;
      p.text.y -= dtMs * 0.06;
      p.text.alpha = 1 - p.t / 1000;
      if (p.t < 1000) return true;
      p.text.destroy();
      return false;
    });
  }

  private sync() {
    // hearts: the one being lost blinks while the bird falls
    const deathMs = this.bird.deathMs;
    this.hearts.children.forEach((h, i) => {
      h.visible = i < this.lives || (i === this.lives && deathMs !== null && Math.floor(deathMs / 120) % 2 === 0);
    });
    dropIn(this.gameOverText, this.overT, config.gameOver.dropMs);
    dropIn(this.completeText, this.completeT, config.levelComplete.dropMs);
    this.levelView?.sync();
    this.bird.sync(this.controls);
    for (const villain of this.villains) {
      villain.sync();
      // the knocked-off villain flies towards the camera, in front of everything; walking, he's behind the bird
      const v = villain.view;
      if (villain.falling && v.parent !== this.front) this.front.addChild(v);
      else if (!villain.falling && v.parent !== this.actors) this.actors.addChildAt(v, 0);
    }
    for (const p of this.poos) p.sync();
    for (const a of this.apples) a.sync();
    for (const f of this.friends) f.sync();
  }
}

/** Big sign in the middle of the screen ("Pause", "Game Over", "Hooray"), styled like the title. */
function bigText(text: string) {
  const t = new Text({ text, style: titleStyle(180) });
  t.anchor.set(0.5);
  t.position.set(WORLD.width / 2, WORLD.height / 2);
  return t;
}

/** A big sign drops in from the top and bounces to a stop in the middle, `ms` into a drop lasting `dropMs`. */
function dropIn(sign: Text, ms: number, dropMs: number) {
  const k = Math.min(1, ms / Math.max(1, dropMs));
  const top = -sign.height / 2;
  sign.y = top + (WORLD.height / 2 - top) * easeOutBounce(k);
}

/**
 * y of the surface of `terrain` where the poo hit it. The contact point Matter reports is the deepest point of the overlap,
 * so a fast poo's can lie well inside the terrain: walk it back out along the normal (towards the poo) to the surface.
 */
function surfaceY(terrain: MBody, poo: MBody, support: { x: number; y: number } | undefined, n: { x: number; y: number }): number {
  if (!support) return poo.position.y + config.physics.pooRadius;
  const dir = n.x * (poo.position.x - support.x) + n.y * (poo.position.y - support.y) < 0 ? -1 : 1;
  const p = { x: support.x, y: support.y };
  for (let i = 0; i < 4 * config.physics.pooRadius && Query.point([terrain], p).length; i++) {
    p.x += dir * n.x;
    p.y += dir * n.y;
  }
  return p.y;
}

/** The angle of the surface with contact normal `n`, as a splat lying on it (between -90° and 90°). */
function surfaceAngle(n: { x: number; y: number }): number {
  let a = Math.atan2(n.x, -n.y);
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  return a;
}

const easeOutBounce = (x: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
