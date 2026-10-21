import { Application, Container, Text } from 'pixi.js';
import { audio } from '../audio/audio';
import { config, WORLD } from '../config';
import { noControls, type Controls } from '../input/controls';
import { fitWorld } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';
import { HAND_FONT as FONT, titleStyle } from '../ui/fonts';
import { Apple } from './Apple';
import { Background } from './Background';
import { Bird } from './Bird';
import { landingBranch } from './branches';
import { coversUnder, type Cover } from './cover';
import { Bodies, Composite, Engine, Events, STEP_MS, type MBody, type MEngine } from './physics';
import { Poo } from './Poo';
import { Villain } from './Villain';

/** every branch the bird can sit on */
const BRANCHES = scenery.trees.flatMap((t) => t.branches);
/** where the villain can hide from the bird: under the branches */
const COVERS = coversUnder(BRANCHES);

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
  /** latest controls; set by main from pose + keyboard */
  controls: Controls = noControls();

  private engine: MEngine;
  private world = new Container();
  /** the walking villain */
  private actors = new Container();
  /** poos and apples: in front of the villain, behind the bird */
  private fx = new Container();
  /** the bird, then score popups */
  private top = new Container();
  /** in front of everything: the knocked-off villain flying towards the camera */
  private front = new Container();
  private hud = new Container();
  private background = new Background();
  private bird: Bird;
  private villain: Villain;
  private poos: Poo[] = [];
  private apples: Apple[] = [];
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
  /** queued poo request: sideways direction (-1 left, 0 straight down, +1 right), or null */
  private pooQueued: number | null = null;
  private pooDir = 0;

  constructor(private app: Application) {
    app.renderer.background.color = scenery.skyColor;
    this.engine = Engine.create({ gravity: { x: 0, y: config.physics.gravity } });

    // static world bounds: ground, walls, ceiling. Only the ground has friction (the bird has none of its own),
    // so the bird doesn't stick to the walls or ceiling when pushed against them
    const opts = { isStatic: true, restitution: 0, friction: 0, frictionStatic: 0 };
    Composite.add(this.engine.world, [
      Bodies.rectangle(WORLD.width / 2, WORLD.groundY + 100, WORLD.width * 3, 200, { ...opts, friction: 0.2, frictionStatic: 0.5, label: 'ground' }),
      Bodies.rectangle(-50, WORLD.height / 2, 100, WORLD.height * 3, { ...opts, label: 'wall' }),
      Bodies.rectangle(WORLD.width + 50, WORLD.height / 2, 100, WORLD.height * 3, { ...opts, label: 'wall' }),
      Bodies.rectangle(WORLD.width / 2, -60, WORLD.width * 3, 100, { ...opts, label: 'ceiling' }),
    ]);

    this.bird = new Bird(WORLD.width / 2);
    this.villain = new Villain(200);
    this.villain.onThrow = (x, y) => this.throwApple(x, y);
    Composite.add(this.engine.world, [this.bird.body, this.villain.body]);

    Events.on(this.engine, 'collisionStart', (e) => {
      for (const pair of e.pairs) this.onCollision(pair.bodyA, pair.bodyB);
    });

    // layers
    this.actors.addChild(this.villain.view);
    this.top.addChild(this.bird.view);
    this.world.addChild(this.background, this.actors, this.fx, this.top, this.front);
    this.root.addChild(this.world, this.hud);

    this.scoreText = new Text({ text: 'Score: 0', style: { fontFamily: FONT, fontSize: 40, fill: '#2b2b2b' } });
    this.scoreText.position.set(24, 14);
    this.hearts.position.set(WORLD.width - 24, 14);
    this.buildHearts();
    this.pausedText = bigText('Pause');
    this.gameOverText = bigText('Game Over');
    this.gameOverText.visible = false;
    this.hud.addChild(this.scoreText, this.hearts, this.pausedText, this.gameOverText);

    app.stage.addChild(this.root);
    app.ticker.add((ticker) => this.update(ticker.deltaMS));
    this.sync();
  }

  /**
   * Ask the bird to squat and drop a poo (ignored while already squatting).
   * `dir` gives the poo a little sideways speed on screen: -1 left, 0 straight down, +1 right.
   */
  requestPoo(dir = 0) {
    if (!this.paused && !this.over) this.pooQueued = dir;
  }

  /** Start a new game: score, lives, bird, villain and poos back to the start. */
  reset() {
    this.score = 0;
    this.scoreText.text = 'Score: 0';
    this.lives = config.player.lives;
    this.buildHearts();
    this.over = false;
    this.overT = 0;
    this.pooQueued = null;
    this.bird.respawn(WORLD.width / 2, WORLD.groundY - config.physics.birdRadius, false);
    Composite.remove(this.engine.world, this.bird.body); // no-op unless it was left in
    Composite.add(this.engine.world, this.bird.body);
    this.villain.reset(200);
    for (const p of this.poos) {
      p.stopSound();
      Composite.remove(this.engine.world, p.body);
      p.view.destroy();
    }
    this.poos = [];
    for (const a of this.apples) a.view.destroy();
    this.apples = [];
    for (const p of this.popups) p.text.destroy();
    this.popups = [];
    this.pending = [];
    this.timers = [];
    this.acc = 0;
    this.sync();
  }

  private update(dtMs: number) {
    fitWorld(this.app, this.root);
    this.pausedText.visible = this.paused && this.showPausedText && !this.over;
    this.gameOverText.visible = this.over;
    if (!this.paused && this.over) {
      this.overT += dtMs;
      this.background.update(dtMs);
    } else if (!this.paused) {
      this.acc += Math.min(dtMs, 100);
      while (this.acc >= STEP_MS && !this.over) {
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
    const splatXs = this.poos.filter((p) => p.state === 'splat' && p.onGround).map((p) => p.view.x);
    const bp = this.bird.body.position;
    const bird = this.bird.dying ? null : { x: bp.x, y: bp.y, r: config.physics.birdRadius };
    this.villain.step(STEP_MS, { bird, splatXs, covers: this.covers() });
    for (const p of this.poos) p.step(STEP_MS);
    for (const a of this.apples) a.step(STEP_MS);
    const birdY = this.bird.body.position.y;
    const pooYs = new Map(this.poos.map((p) => [p, p.body.position.y]));
    Engine.update(this.engine, STEP_MS);
    this.bird.perchOn(BRANCHES, birdY);
    this.landPoosOnBranches(pooYs);
    for (const fn of this.pending.splice(0)) fn();
    for (const t of this.timers) t.ms -= STEP_MS;
    const due = this.timers.filter((t) => t.ms <= 0);
    this.timers = this.timers.filter((t) => t.ms > 0);
    for (const t of due) t.fn();
    // bird touching a walking villain costs a life
    const b = this.bird.body;
    if (!this.bird.dying && !this.bird.invulnerable && this.villain.touches(b.position.x, b.position.y, config.physics.birdRadius)) {
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

  /** A falling poo that crossed a branch's top edge this step splats on the branch. `prevYs`: poo centres before the step. */
  private landPoosOnBranches(prevYs: Map<Poo, number>) {
    for (const p of this.poos) {
      const prevY = prevYs.get(p);
      if (p.state !== 'falling' || prevY === undefined || p.body.velocity.y < 0) continue;
      const pos = p.body.position;
      const landing = landingBranch(BRANCHES, pos.x, prevY, pos.y, config.physics.pooRadius);
      if (!landing) continue;
      const [x0, y0] = landing.branch.from, [x1, y1] = landing.branch.to;
      Composite.remove(this.engine.world, p.body);
      p.splat(landing.top, Math.atan((y1 - y0) / (x1 - x0)));
      audio.play('splat');
    }
  }

  /** Stretches of ground sheltered from above right now. Static for now; moving obstacles would recompute them here each step. */
  private covers(): readonly Cover[] {
    return COVERS;
  }

  /** How fast the villain's apples fly (px per physics step). Constant for now; could grow as the game goes on. */
  private appleSpeed(): number {
    return config.apple.speed;
  }

  /**
   * Throw an apple from (x, y) in a straight line at where the bird is now (no leading, so moving dodges it).
   * It keeps going until it leaves the screen.
   */
  private throwApple(x: number, y: number) {
    const target = this.bird.body.position;
    const v = this.appleSpeed();
    let angle = Math.atan2(target.y - y, target.x - x);
    angle += ((Math.random() * 2 - 1) * config.apple.aimSpread * Math.PI) / 180;
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

  private onCollision(a: MBody, b: MBody) {
    const labels = [a.label, b.label];
    if (!labels.includes('poo')) return;
    const pooBody = a.label === 'poo' ? a : b;
    const other = pooBody === a ? b : a;
    const poo = this.poos.find((p) => p.body === pooBody);
    if (!poo || poo.state !== 'falling') return;

    if (other.label === 'villain' && this.villain.hittable) {
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        poo.stopSound();
        audio.play('splat');
        if (this.villain.hit()) {
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

  /** The dead bird has left the screen: drop in a new one from the top, or it's game over. */
  private afterDeath() {
    if (this.lives > 0) {
      this.bird.respawn(WORLD.width / 2, 120, true);
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

  private addScore(points: number, x: number, y: number) {
    this.score += points;
    this.scoreText.text = `Score: ${this.score}`;
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
    // "Game Over" drops in from the top and bounces to a stop in the middle
    const k = Math.min(1, this.overT / Math.max(1, config.gameOver.dropMs));
    const top = -this.gameOverText.height / 2;
    this.gameOverText.y = top + (WORLD.height / 2 - top) * easeOutBounce(k);
    this.bird.sync(this.controls);
    this.villain.sync();
    // the knocked-off villain flies towards the camera, in front of everything; walking, he's behind the bird
    const v = this.villain.view;
    if (this.villain.falling && v.parent !== this.front) this.front.addChild(v);
    else if (!this.villain.falling && v.parent !== this.actors) this.actors.addChildAt(v, 0);
    for (const p of this.poos) p.sync();
    for (const a of this.apples) a.sync();
  }
}

/** Big sign in the middle of the screen ("Pause", "Game Over"), styled like the title. */
function bigText(text: string) {
  const t = new Text({ text, style: titleStyle(180) });
  t.anchor.set(0.5);
  t.position.set(WORLD.width / 2, WORLD.height / 2);
  return t;
}

const easeOutBounce = (x: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
