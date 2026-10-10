import { Application, Container, Text } from 'pixi.js';
import { config, WORLD } from '../config';
import { noControls, type Controls } from '../input/controls';
import { fitWorld } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';
import { HAND_FONT as FONT, TITLE_FONT } from '../ui/fonts';
import { Background } from './Background';
import { Bird } from './Bird';
import { Bodies, Composite, Engine, Events, STEP_MS, type MBody, type MEngine } from './physics';
import { Poo } from './Poo';
import { Villain } from './Villain';

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
  /** latest controls; set by main from pose + keyboard */
  controls: Controls = noControls();

  private engine: MEngine;
  private world = new Container();
  private actors = new Container();
  private fx = new Container();
  private hud = new Container();
  private background = new Background();
  private bird: Bird;
  private villain: Villain;
  private poos: Poo[] = [];
  private popups: Popup[] = [];
  private pending: (() => void)[] = [];
  private acc = 0;
  private scoreText: Text;
  private pausedText: Text;
  /** queued poo request: sideways direction (-1 left, 0 straight down, +1 right), or null */
  private pooQueued: number | null = null;
  private pooDir = 0;

  constructor(private app: Application) {
    app.renderer.background.color = scenery.skyColor;
    this.engine = Engine.create({ gravity: { x: 0, y: config.physics.gravity } });

    // static world bounds: ground, walls, ceiling
    const opts = { isStatic: true, restitution: 0 };
    Composite.add(this.engine.world, [
      Bodies.rectangle(WORLD.width / 2, WORLD.groundY + 100, WORLD.width * 3, 200, { ...opts, label: 'ground' }),
      Bodies.rectangle(-50, WORLD.height / 2, 100, WORLD.height * 3, { ...opts, label: 'wall' }),
      Bodies.rectangle(WORLD.width + 50, WORLD.height / 2, 100, WORLD.height * 3, { ...opts, label: 'wall' }),
      Bodies.rectangle(WORLD.width / 2, -60, WORLD.width * 3, 100, { ...opts, label: 'ceiling' }),
    ]);

    this.bird = new Bird(WORLD.width / 2);
    this.villain = new Villain(200);
    Composite.add(this.engine.world, [this.bird.body, this.villain.body]);

    Events.on(this.engine, 'collisionStart', (e) => {
      for (const pair of e.pairs) this.onCollision(pair.bodyA, pair.bodyB);
    });

    // layers
    this.actors.addChild(this.villain.view, this.bird.view);
    this.world.addChild(this.background, this.actors, this.fx);
    this.root.addChild(this.world, this.hud);

    this.scoreText = new Text({ text: 'Score: 0', style: { fontFamily: FONT, fontSize: 40, fill: '#2b2b2b' } });
    this.scoreText.position.set(24, 14);
    this.pausedText = new Text({
      text: 'Pause',
      style: {
        fontFamily: TITLE_FONT,
        fontSize: 180,
        fill: '#2b2b2b',
        stroke: { color: '#ffffff', width: 12, join: 'round' },
        dropShadow: { color: '#c0392b', alpha: 1, angle: Math.PI / 4, distance: 9, blur: 0 },
        padding: 20,
      },
    });
    this.pausedText.anchor.set(0.5);
    this.pausedText.position.set(WORLD.width / 2, WORLD.height / 2);
    this.hud.addChild(this.scoreText, this.pausedText);

    app.stage.addChild(this.root);
    app.ticker.add((ticker) => this.update(ticker.deltaMS));
    this.sync();
  }

  /**
   * Ask the bird to squat and drop a poo (ignored while already squatting).
   * `dir` gives the poo a little sideways speed on screen: -1 left, 0 straight down, +1 right.
   */
  requestPoo(dir = 0) {
    if (!this.paused) this.pooQueued = dir;
  }

  private update(dtMs: number) {
    fitWorld(this.app, this.root);
    this.pausedText.visible = this.paused && this.showPausedText;
    if (!this.paused) {
      this.acc += Math.min(dtMs, 100);
      while (this.acc >= STEP_MS) {
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
    if (this.pooQueued !== null) {
      if (this.bird.squat()) this.pooDir = this.pooQueued;
      this.pooQueued = null;
    }
    this.bird.step(this.controls, STEP_MS, () => this.dropPoo());
    this.villain.step(STEP_MS);
    for (const p of this.poos) p.step(STEP_MS);
    Engine.update(this.engine, STEP_MS);
    for (const fn of this.pending.splice(0)) fn();
    // remove finished poos
    this.poos = this.poos.filter((p) => {
      if (p.state !== 'done') return true;
      p.view.destroy();
      return false;
    });
  }

  private dropPoo() {
    const b = this.bird.body;
    const r = config.physics.birdRadius;
    const poo = new Poo(b.position.x, b.position.y + r * 0.6, b.velocity.x * 0.6 + this.pooDir * config.physics.pooSideSpeed, Math.max(1, b.velocity.y));
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
        if (this.villain.hit()) this.addScore(config.score.villain, pooBody.position.x, pooBody.position.y);
        Composite.remove(this.engine.world, pooBody);
        poo.state = 'done';
      });
    } else if (other.label === 'ground') {
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        Composite.remove(this.engine.world, pooBody);
        poo.splat();
      });
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
    this.fx.addChild(text);
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
    this.bird.sync(this.controls);
    this.villain.sync();
    for (const p of this.poos) p.sync();
  }
}
