import { Application, Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { audio, type FlameSound } from '../audio/audio';
import { coinDef } from '../characters/coin';
import { splatHalfWidth } from '../characters/poo';
import { villainDef } from '../characters/villain';
import { config, WORLD } from '../config';
import { noControls, type Controls } from '../input/controls';
import { buildLevel, type BuiltLevel } from '../level/build';
import { LevelView } from '../level/LevelView';
import type { Branch, LevelDef, VillainKind } from '../level/types';
import { tex } from '../render/assets';
import { BACKING, showBackingsFor, spriteBacking, textBacking } from '../render/backing';
import { fitWorld, view } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';
import { BIG_FILL, bigTextStyle, TEXT_FONT as FONT } from '../ui/fonts';
import { GlowText } from '../ui/GlowText';
import { i18n, t } from '../ui/i18n';
import { Apple } from './Apple';
import { Background } from './Background';
import { Bat } from './Bat';
import { HomingField, inSight } from './homing';
import { Bird, type BirdSample } from './Bird';
import { Button } from './Button';
import { Coin } from './Coin';
import { Dragon } from './Dragon';
import { Friend } from './Friend';
import { landingBranch } from './branches';
import { Bodies, Composite, Engine, Events, Query, Sleeping, STEP_MS, type MBody, type MEngine, type MPair } from './physics';
import { Poo } from './Poo';
import { spanInBand, Villain, type Span } from './Villain';

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
/** the corner icons' size (fullscreen, menu) and the gap after the hearts and between them, in world px */
const CORNER_ICON = 48;
const CORNER_GAP = 14;

export class Game {
  readonly root = new Container();
  paused = true;
  /** darken the game (behind a dialog, like the calibration's) */
  dimmed = false;
  /** show the big "Paused" label while paused (only for a manual pause, not behind dialogs) */
  showPausedText = false;
  score = 0;
  /** coins collected this game: extra points, counted apart from the score */
  coinCount = 0;
  lives = config.player.lives;
  /** lost the last life; frozen behind "Game Over" until `reset()` */
  over = false;
  /** called once when the bird has fallen off the screen for the last time */
  onGameOver: (() => void) | null = null;
  /** all friends saved and the grace time over; frozen behind "Hooray" until the next level loads */
  complete = false;
  /** called once, a while after the last friend is saved: time to load the next level */
  onLevelComplete: (() => void) | null = null;
  /** "Game Over" or "Hooray" is on screen; the game can't be paused meanwhile */
  get showingSign() {
    return this.over || this.complete;
  }
  /** The bird's state now (world px, px per physics step), written into `out`: read-only, allocates nothing. */
  birdState(out: BirdSample): BirdSample {
    return this.bird.sample(out);
  }
  /** latest controls; set by main from pose + keyboard */
  controls: Controls = noControls();
  /**
   * called before every physics step, so `controls` can be set step by step (a recorded pose stream played back
   * the same way every time, whatever the frame rate)
   */
  onStep: (() => void) | null = null;

  private engine: MEngine;
  private world = new Container();
  /** the walking villains, and the bats in front of them */
  private actors = new Container();
  /** the friends to save: behind the villain */
  private friendLayer = new Container();
  /** the coins: in front of the friends, behind the villain */
  private coinLayer = new Container();
  /** the dragons and their fire: in front of the coins, behind the villain */
  private dragonLayer = new Container();
  /** poos and apples: in front of the villain, behind the bird */
  private fx = new Container();
  /** the bird, then score popups */
  private top = new Container();
  /** in front of everything: the knocked-off villain flying towards the camera, a saved friend growing */
  private front = new Container();
  /** score, coins, lives and the big signs; the instructions' demonstration hides it */
  readonly hud = new Container();
  private background = new Background();
  /** the level's shelves, crates, ropes: in front of the background, behind the villain */
  private levelLayer = new Container();
  private built: BuiltLevel = { bodies: [], joints: [] };
  private levelView: LevelView | null = null;
  /** the level's bodies, which the bird can stand on and apples stop at (an open door isn't one) */
  private levelBodies: MBody[] = [];
  private buttons: Button[] = [];
  /** each door (terrain a button switches) is there (true) or open (false), by terrain id */
  private doors = new Map<number, boolean>();
  /** the level's branches the bird can sit on */
  private branches: readonly Branch[] = [];
  private bird: Bird;
  /** the level's villains; a knocked-off one stays (gone) until the level restarts */
  private villains: Villain[] = [];
  /** the level's bats; a knocked-off one stays (gone) until the level restarts */
  private bats: Bat[] = [];
  /** the way to the bird for the homing bats (those without a route) */
  private homingField = new HomingField();
  /** ms until the homing field is worked out again */
  private replanIn = 0;
  private poos: Poo[] = [];
  private apples: Apple[] = [];
  private friends: Friend[] = [];
  private dragons: Dragon[] = [];
  /** the sound of each dragon's fire while it's out */
  private flameSounds = new Map<Dragon, FlameSound>();
  private coins: Coin[] = [];
  private popups: Popup[] = [];
  private pending: (() => void)[] = [];
  /** things to do after a while, in game time (so they wait while paused) */
  private timers: { ms: number; fn: () => void }[] = [];
  private acc = 0;
  /** the score: a little villain, then the count */
  private scoreBox = new Container();
  private scoreText: Text;
  /** the coins collected: a coin, then the count; right of the score */
  private coinBox = new Container();
  private coinText: Text;
  private pausedText: GlowText;
  private hearts = new Container();
  private cornerCount = 1;
  /** darkens the game behind the "Pause", "Game Over" and "Hooray" signs */
  private dim = new Graphics();
  /** how far the dimming behind "Pause" or a dialog (`dimmed`) has faded in (0–1) */
  private overlayShade = 0;
  private gameOverText: GlowText;
  /** ms since game over (drives the sliding sign) */
  private overT = 0;
  private completeText: GlowText;
  /** ms since the level completed (drives the sliding sign and the next level) */
  private completeT = 0;
  /** ms since the last friend was saved, while play goes on for `config.levelComplete.graceMs`; null before */
  private allSavedT: number | null = null;
  /** a poo was requested and the bird hasn't squatted for it yet */
  private pooQueued = false;
  /** score, coins and lives as the level started, for `retryLevel` */
  private levelStart = { score: 0, coins: 0, lives: config.player.lives };

  constructor(
    private app: Application,
    /** the level being played; change it with `loadLevel` */
    public level: LevelDef,
    /** false: an off-screen game, not on the stage and not running, only for `snapshot` */
    private live = true,
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
    this.world.addChild(this.background, this.levelLayer, this.friendLayer, this.coinLayer, this.dragonLayer, this.actors, this.fx, this.top, this.front);
    this.root.addChild(this.world, this.hud);

    // the icon is as tall as the digits' font size
    const small = BACKING.smallWidth;
    const scoreIcon = new Sprite(tex(villainDef.animations.walk.frames[0]));
    scoreIcon.scale.set(40 / scoreIcon.texture.height);
    this.scoreText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 40, fill: '#2b2b2b' } });
    this.scoreText.x = scoreIcon.width + 8;
    this.scoreBox.addChild(spriteBacking(scoreIcon, small), scoreIcon, textBacking(this.scoreText, small), this.scoreText);
    this.scoreBox.position.set(24, 14);
    const coinIcon = new Sprite(tex(coinDef.animations.spin.frames[0]));
    coinIcon.scale.set(40 / coinIcon.texture.height);
    this.coinText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 40, fill: '#2b2b2b' } });
    this.coinText.x = coinIcon.width + 8;
    this.coinBox.addChild(spriteBacking(coinIcon, small), coinIcon, textBacking(this.coinText, small), this.coinText);
    this.coinBox.y = 14;
    // the corner icons (DOM buttons, placed over `cornerSlot`) end the row, after a gap
    this.hearts.y = 14;
    this.cornerIcons = 1;
    this.buildHearts();
    this.pausedText = bigText('');
    this.gameOverText = bigText('');
    this.completeText = bigText('');
    this.updateScoreText();
    const relabel = () => {
      this.pausedText.text = t('Pause');
      this.gameOverText.text = t('Game Over');
      this.completeText.text = t('Hooray!');
    };
    i18n.onChange(relabel);
    relabel();
    this.gameOverText.visible = false;
    this.completeText.visible = false;
    // far bigger than the world, so it covers the letterbox bands too
    this.dim.rect(-WORLD.width * 5, -WORLD.height * 5, WORLD.width * 11, WORLD.height * 11).fill('#000');
    this.dim.alpha = 0;
    this.hud.addChild(this.scoreBox, this.coinBox, this.hearts, this.dim, this.pausedText, this.gameOverText, this.completeText);

    if (live) {
      app.stage.addChild(this.root);
      app.ticker.add((ticker) => this.update(ticker.deltaMS));
    }
    this.restartLevel();
  }

  /** A picture of `level` as it starts, `width` px wide, without the score and lives (the level select's thumbnails). */
  snapshot(level: LevelDef, width: number): Texture {
    this.loadLevel(level);
    return this.app.renderer.generateTexture({
      target: this.world,
      frame: new Rectangle(0, 0, WORLD.width, WORLD.height),
      resolution: width / WORLD.width,
      clearColor: scenery.skyColor,
      antialias: true,
    });
  }

  /** Ask the bird to squat and drop a poo (ignored while already squatting). */
  requestPoo() {
    if (!this.paused && !this.over && !this.complete) this.pooQueued = true;
  }

  /** Start a new game: score, lives, the level, bird, villain and poos back to the start; on `level` if given. */
  reset(level = this.level) {
    this.level = level;
    this.score = 0;
    this.coinCount = 0;
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

  /** This level again from its start, with the score, coins and lives it started with. */
  retryLevel() {
    this.score = this.levelStart.score;
    this.coinCount = this.levelStart.coins;
    this.updateScoreText();
    this.lives = this.levelStart.lives;
    this.buildHearts();
    this.restartLevel();
  }

  /** Move on to the next level: from its start, keeping score but with lives back to full. */
  startNextLevel(level: LevelDef) {
    this.lives = config.player.lives;
    this.buildHearts();
    this.loadLevel(level);
  }

  /** The level, bird, villain, friends and poos back to the start. */
  private restartLevel() {
    this.levelStart = { score: this.score, coins: this.coinCount, lives: this.lives };
    this.pooQueued = false;
    this.complete = false;
    this.completeT = 0;
    this.allSavedT = null;
    if (this.live) audio.restoreMusic(config.audio.musicRestoreMs);
    this.buildLevel();
    const start = this.birdStart();
    this.bird.respawn(start.x, start.y, false);
    Composite.remove(this.engine.world, this.bird.body); // no-op unless it was left in
    Composite.add(this.engine.world, this.bird.body);
    for (const v of this.villains) {
      Composite.remove(this.engine.world, v.body);
      v.view.destroy();
      v.held.destroy();
    }
    this.villains = this.level.villains.map((def) => {
      const v = new Villain(def);
      v.onThrow = (x, y, dir) => this.throwApple(x, y, dir, v.kind);
      Composite.add(this.engine.world, v.body);
      this.actors.addChildAt(v.view, 0);
      this.fx.addChild(v.held);
      return v;
    });
    for (const b of this.bats) {
      Composite.remove(this.engine.world, b.body);
      b.view.destroy();
    }
    this.bats = this.level.bats.map((def) => {
      const b = new Bat(def);
      b.onPoo = (x, y) => this.dropBatPoo(x, y);
      Composite.add(this.engine.world, b.body);
      this.actors.addChild(b.view);
      return b;
    });
    this.replanIn = 0;
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
    for (const d of this.dragons) d.view.destroy({ children: true });
    for (const f of this.flameSounds.values()) f.stop();
    this.flameSounds.clear();
    this.dragons = this.level.dragons.map((def) => new Dragon(def));
    for (const d of this.dragons) {
      d.onSpit = () => audio.play('dragon-roar');
      this.dragonLayer.addChild(d.view);
    }
    for (const c of this.coins) c.view.destroy();
    this.coins = this.level.coins.map((def) => new Coin(def));
    for (const c of this.coins) this.coinLayer.addChild(c.view);
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
    const timeOfDay = this.level.timeOfDay ?? 'afternoon';
    this.background.timeOfDay = timeOfDay;
    showBackingsFor(timeOfDay);
    Composite.add(world, [...this.built.bodies.map((b) => b.body), ...this.built.joints.map((j) => j.constraint)]);
    this.levelView = new LevelView(this.level, this.built);
    this.levelLayer.addChild(this.levelView);
    this.branches = this.level.branches;
    this.buttons = this.level.buttons.map((def) => new Button(def));
    // every door starts there (as built); the "close" ones open straight away
    this.doors = new Map(this.buttons.map((b) => [b.def.target, true]));
    this.switchDoors();
  }

  private birdStart() {
    return this.level.birdStart ?? { x: WORLD.width / 2, y: WORLD.groundY - config.physics.birdRadius };
  }

  private update(dtMs: number) {
    fitWorld(this.app, this.root);
    this.background.fit();
    // the score and lives at the top of the screen, which may be above the world's (`view`)
    this.scoreBox.y = this.coinBox.y = this.hearts.y = view.top + 14;
    this.pausedText.visible = this.paused && this.showPausedText && !this.showingSign;
    // pausing stops the render loop right after this frame, so "Pause" darkens at once; a dialog fades it in
    const fade = dtMs / Math.max(1, config.dimFadeMs);
    if (this.pausedText.visible) this.overlayShade = 1;
    else this.overlayShade = Math.min(1, Math.max(0, this.overlayShade + (this.dimmed ? fade : -fade)));
    this.gameOverText.visible = this.over;
    this.completeText.visible = this.complete;
    if (!this.paused && this.over) {
      this.overT += dtMs;
      this.background.update(dtMs);
    } else if (!this.paused && this.complete) {
      // the world stands still; the last friend fades out meanwhile
      this.completeT += dtMs;
      for (const f of this.friends) f.step(dtMs);
      for (const c of this.coins) c.step(dtMs);
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
    this.onStep?.();
    this.engine.gravity.y = config.physics.gravity;
    if (this.pooQueued && !this.bird.dying) {
      this.bird.squat();
      this.pooQueued = false;
    }
    this.bird.step(this.controls, STEP_MS, () => this.dropPoo());
    const bp = this.bird.body.position;
    const bird = this.bird.dying ? null : { x: bp.x, y: bp.y };
    for (const v of this.villains) v.step(STEP_MS, { bird, obstacles: this.villainObstacles(v.feet, v.top) });
    this.stepBats(bird);
    for (const p of this.poos) p.step(STEP_MS);
    for (const a of this.apples) a.step(STEP_MS);
    for (const f of this.friends) f.step(STEP_MS);
    // a dragon's fire stops at the level's walls, terrain and crates (as apples do), not at characters
    const blocksFire = (x: number, y: number) => Query.point(this.levelBodies, { x, y }).length > 0;
    for (const d of this.dragons) d.step(STEP_MS, blocksFire);
    this.stepFlameSounds();
    for (const c of this.coins) c.step(STEP_MS);
    const birdY = this.bird.body.position.y;
    const pooYs = new Map(this.poos.map((p) => [p, p.body.position.y]));
    Engine.update(this.engine, STEP_MS);
    this.bird.perchOn(this.branches, birdY);
    this.bird.standOn(this.levelBodies);
    this.landPoosOnBranches(pooYs);
    for (const fn of this.pending.splice(0)) fn();
    this.pressButtons();
    for (const t of this.timers) t.ms -= STEP_MS;
    const due = this.timers.filter((t) => t.ms <= 0);
    this.timers = this.timers.filter((t) => t.ms > 0);
    for (const t of due) t.fn();
    this.saveFriends();
    this.collectCoins();
    if (this.allSavedT !== null && (this.allSavedT += STEP_MS) >= config.levelComplete.graceMs) this.completeLevel();
    // bird touching a walking villain, a flying bat or a dragon's fire costs a life
    const b = this.bird.body;
    const birdR = config.physics.birdRadius;
    const touches = (a: Villain | Bat | Dragon) => a.touches(b.position.x, b.position.y, birdR);
    if (!this.bird.dying && !this.bird.invulnerable && (this.villains.some(touches) || this.bats.some(touches) || this.dragons.some(touches))) {
      this.loseLife();
    }
    // ...and so does a bat's poo falling on it
    for (const p of this.poos) {
      if (p.owner !== 'bat' || p.state !== 'falling' || this.bird.dying || this.bird.invulnerable) continue;
      const pp = p.body.position, hitR = birdR + p.radius;
      if ((pp.x - b.position.x) ** 2 + (pp.y - b.position.y) ** 2 >= hitR * hitR) continue;
      Composite.remove(this.engine.world, p.body);
      p.state = 'done';
      audio.play('splat');
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
    // a falling poo of the bird's knocks an apple out of the air: both blink out
    const hitR = config.physics.pooRadius + config.apple.radius;
    for (const p of this.poos) {
      if (p.state !== 'falling' || p.owner !== 'bird') continue;
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

  /** The bird flying into a friend saves it; saving the last one completes the level after a grace time. */
  private saveFriends() {
    if (this.bird.dying) return;
    const b = this.bird.body.position;
    for (const f of this.friends) {
      if (f.state !== 'waiting' || !f.touches(b.x, b.y, config.physics.birdRadius)) continue;
      f.save();
      this.front.addChild(f.view);
      audio.play('friend');
    }
    if (this.level.goal !== 'coins' && this.friends.length && this.friends.every((f) => f.state !== 'waiting')) this.goalReached();
  }

  /** The level's goal is done (all friends saved, or all coins collected): it completes after a grace time. */
  private goalReached() {
    if (this.allSavedT !== null) return;
    // play goes on a little longer, the music turned down; villains stand still and the bird blinks, so nothing can spoil it
    this.allSavedT = 0;
    this.bird.makeInvulnerable(config.levelComplete.graceMs);
    for (const v of this.villains) v.frozen = true;
    for (const b of this.bats) b.frozen = true;
    audio.duckMusic(config.levelComplete.graceMs);
  }

  /** The bird flying into a coin collects it; collecting the last one completes a level whose goal is coins. */
  private collectCoins() {
    if (this.bird.dying) return;
    const b = this.bird.body.position;
    for (const c of this.coins) {
      if (c.state !== 'waiting' || !c.touches(b.x, b.y, config.physics.birdRadius)) continue;
      c.collect();
      this.coinCount++;
      this.updateScoreText();
      audio.play('coin');
    }
    if (this.level.goal === 'coins' && this.coins.length && this.coins.every((c) => c.state !== 'waiting')) this.goalReached();
  }

  /** A button is pressed by the bird's feet on it, a poo of the bird's falling into it or its splat lying on it; the doors follow. */
  private pressButtons() {
    const b = this.bird.body.position;
    const r = config.physics.birdRadius;
    for (const button of this.buttons) {
      const pressed =
        (!this.bird.dying && button.under(b.x, b.y + r)) ||
        this.poos.some(
          (p) =>
            p.owner === 'bird' &&
            ((p.state === 'falling' && button.touches(p.body.position.x, p.body.position.y, p.radius)) ||
              (p.state === 'splat' && button.under(p.view.x, p.view.y))),
        );
      if (button.step(pressed, STEP_MS)) audio.play('button');
      this.levelView?.setPressed(button.def.id, button.pressed);
    }
    this.switchDoors();
  }

  /**
   * Each door there or open as its buttons say: an "open" door is open while one of its buttons is in effect,
   * a "close" door there only then. An open door is out of the physics world, and out of `levelBodies`.
   */
  private switchDoors() {
    const active = new Set(this.buttons.filter((b) => b.active).map((b) => b.def.target));
    const actions = new Map(this.buttons.map((b) => [b.def.target, b.def.action]));
    for (const { def, body } of this.built.bodies) {
      const action = actions.get(def.id);
      if (!action) continue;
      const solid = active.has(def.id) === (action === 'close');
      if (this.doors.get(def.id) === solid) continue;
      this.doors.set(def.id, solid);
      if (solid) Composite.add(this.engine.world, body);
      else {
        Composite.remove(this.engine.world, body);
        this.openUnder(body);
      }
      this.levelView?.setSolid(def.id, solid);
    }
    // a door about to switch back blinks, as the button of it that lasts longest says
    const longest = new Map<number, Button>();
    for (const b of this.buttons) {
      const l = longest.get(b.def.target);
      if (!l || b.remaining > l.remaining) longest.set(b.def.target, b);
    }
    for (const [id, b] of longest) this.levelView?.setBlink(id, b.blinkBack);
    this.levelBodies = this.built.bodies.filter((b) => this.doors.get(b.def.id) !== false).map((b) => b.body);
  }

  /** A door just opened: what rested on it falls (sleeping crates wake), the splats on it go. */
  private openUnder(door: MBody) {
    for (const b of this.built.bodies) if (b.def.kind === 'body') Sleeping.set(b.body, false);
    const { min, max } = door.bounds;
    for (const p of this.poos) {
      if (p.state === 'splat' && p.view.x >= min.x && p.view.x <= max.x && Math.abs(p.view.y - min.y) <= SURFACE_TOLERANCE) {
        p.state = 'done';
      }
    }
  }

  /** Each dragon's fire roars, as loud as it's far out, from rolling out until it's back in. */
  private stepFlameSounds() {
    if (!this.live) return;
    for (const d of this.dragons) {
      const out = d.out;
      let f = this.flameSounds.get(d);
      if (out > 0) {
        if (!f || f.ended) this.flameSounds.set(d, (f = audio.startFlame()));
        f.set(out);
      } else if (f) {
        f.stop();
        this.flameSounds.delete(d);
      }
    }
  }

  /** The grace time after saving all friends is over: everything stops, "Hooray" slides in with a fanfare, and a while later the next level starts (`onLevelComplete`). */
  private completeLevel() {
    this.complete = true;
    this.completeT = 0;
    this.pooQueued = false;
    for (const p of this.poos) p.stopSound();
    for (const f of this.flameSounds.values()) f.stop();
    audio.playOverMusic('fanfare');
  }

  /** A falling poo that crossed a branch's top edge this step splats on the branch. `prevYs`: poo centres before the step. */
  private landPoosOnBranches(prevYs: Map<Poo, number>) {
    for (const p of this.poos) {
      const prevY = prevYs.get(p);
      if (p.state !== 'falling' || prevY === undefined || p.body.velocity.y < 0) continue;
      const pos = p.body.position;
      const landing = landingBranch(this.branches, pos.x, prevY, pos.y, p.radius);
      if (!landing) continue;
      const [x0, y0] = landing.branch.from, [x1, y1] = landing.branch.to;
      Composite.remove(this.engine.world, p.body);
      p.splat(landing.top, Math.atan((y1 - y0) / (x1 - x0)));
      if (p.owner === 'bird') audio.play('splat');
    }
  }

  /** Stretches of ground sheltered from above right now. Static for now; moving obstacles would recompute them here each step. */
  /**
   * What a villain with his feet at `feetY` (and the top of his hitbox at `head`) won't walk into (crates move, so every step): the bird's poo splats he'd step in,
   * the level's bodies reaching into his height, and wherever there's nothing to stand on at his feet
   * (all but the ground's or his shelf's top).
   */
  private villainObstacles(feetY: number, head: number): Span[] {
    const near = (y: number) => Math.abs(y - feetY) <= SURFACE_TOLERANCE;
    const splats = this.poos
      .filter((p) => p.owner === 'bird' && p.state === 'splat' && near(p.view.y))
      .map((p) => ({ x0: p.view.x - splatHalfWidth, x1: p.view.x + splatHalfWidth }));
    // the part of each body between his head and feet, not its bounding box: a sloping roof only blocks where it comes down
    const bodies = this.levelBodies.flatMap((b) => spanInBand(b, head, feetY - SURFACE_TOLERANCE) ?? []);
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

  /** Steps the bats; the homing ones go for `bird` (null: none to go for), by a field worked out again every `replanMs`. */
  private stepBats(bird: { x: number; y: number } | null) {
    const homers = this.bats.filter((b) => b.homing && b.hittable);
    if (homers.length && (this.replanIn -= STEP_MS) <= 0) {
      this.replanIn = config.bat.homingReplanMs;
      this.homingField.update(this.levelBodies, bird);
    }
    const flying = this.bats.filter((b) => b.hittable);
    for (const b of this.bats) {
      if (!b.homing) {
        b.step(STEP_MS);
        continue;
      }
      // one already after the bird needn't look again
      const seesBird = !b.chasing && b.hittable && bird !== null && inSight(this.levelBodies, b.position, bird);
      b.step(STEP_MS, { field: this.homingField, others: flying.filter((o) => o !== b).map((o) => o.position), seesBird });
    }
  }

  /** How fast the villain's apples fly (px per physics step). Constant for now; could grow as the game goes on. */
  private appleSpeed(): number {
    return config.apple.speed;
  }

  /**
   * Throw an apple from (x, y) in a straight line at where the bird is now (no leading, so moving dodges it).
   * It flies only the way the villain faces (`dir`): aimed behind him (the aim error, or the bird crossing over him
   * during the windup), it goes straight up or down instead. It keeps going until it leaves the screen.
   * A ghost (`kind`) throws glue instead, which does just what an apple does.
   */
  private throwApple(x: number, y: number, dir: 1 | -1, kind: VillainKind) {
    const target = this.bird.body.position;
    const v = this.appleSpeed();
    let angle = Math.atan2(target.y - y, target.x - x);
    angle += ((Math.random() * 2 - 1) * config.apple.aimSpread * Math.PI) / 180;
    if (Math.cos(angle) * dir < 0) angle = Math.sin(angle) < 0 ? -Math.PI / 2 : Math.PI / 2;
    const apple = new Apple(x, y, v * Math.cos(angle), v * Math.sin(angle), kind);
    this.apples.push(apple);
    this.fx.addChild(apple.view);
  }

  private dropPoo() {
    const b = this.bird.body;
    const r = config.physics.birdRadius;
    const poo = new Poo(b.position.x, b.position.y + r * 0.6, b.velocity.x * 0.6, Math.max(1, b.velocity.y));
    audio.play('shot');
    poo.stopSound = audio.startFall();
    this.poos.push(poo);
    Composite.add(this.engine.world, poo.body);
    this.fx.addChild(poo.view);
  }

  /** A bat poos at (x, y): a small poo dropping straight down. Quiet, unlike the bird's: there may be a lot of them. */
  private dropBatPoo(x: number, y: number) {
    const poo = new Poo(x, y, 0, config.bat.pooSpeed, 'bat');
    this.poos.push(poo);
    Composite.add(this.engine.world, poo.body);
    this.fx.addChild(poo.view);
  }

  /** What a falling poo hit: the bird's knocks villains and bats off, a bat's goes through them; either splats on the ground and terrain. */
  private onCollision(pair: MPair) {
    const { bodyA: a, bodyB: b } = pair;
    const labels = [a.label, b.label];
    if (!labels.includes('poo')) return;
    const pooBody = a.label === 'poo' ? a : b;
    const other = pooBody === a ? b : a;
    const poo = this.poos.find((p) => p.body === pooBody);
    if (!poo || poo.state !== 'falling') return;

    const bird = poo.owner === 'bird';
    const villain = bird ? this.villains.find((v) => v.body === other) : undefined;
    const bat = bird ? this.bats.find((b) => b.body === other) : undefined;
    if (bat?.hittable) {
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        poo.stopSound();
        audio.play('splat');
        if (bat.hit()) {
          this.addScore(config.score.bat, pooBody.position.x, pooBody.position.y);
          audio.play('bat-dies');
          this.after(1000, () => audio.play('score'));
        }
        Composite.remove(this.engine.world, pooBody);
        poo.state = 'done';
      });
    } else if (villain?.hittable) {
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        poo.stopSound();
        audio.play('splat');
        if (villain.hit()) {
          this.addScore(config.score.villain, pooBody.position.x, pooBody.position.y);
          audio.play(villain.kind === 'ghost' ? 'ghost-dies' : 'bad-guy-dies');
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
        if (bird) audio.play('splat');
      });
    } else if (other.label === 'terrain') {
      // lies along the surface it hit, where it touched (read now: Matter reuses the collision object)
      const y = surfaceY(other, pooBody, poo.radius, pair.collision.supports[0], pair.collision.normal);
      const angle = surfaceAngle(pair.collision.normal);
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        Composite.remove(this.engine.world, pooBody);
        poo.splat(y, angle);
        if (bird) audio.play('splat');
      });
    } else if (other.label === 'body') {
      // a splat wouldn't stay on a moving thing: the poo just goes
      this.pending.push(() => {
        if (poo.state !== 'falling') return;
        poo.stopSound();
        if (bird) audio.play('splat');
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

  /** How many corner icons end the hearts' row (fullscreen, menu): the hearts make room for them, at least one. */
  set cornerIcons(n: number) {
    this.cornerCount = Math.max(1, n);
    this.hearts.x = this.cornerSlot.x - CORNER_GAP;
  }

  /** Where the corner icons go, in world px: in a row at the end of the hearts' row, in the top-right corner. */
  get cornerSlot() {
    const n = this.cornerCount;
    return { x: WORLD.width - 24 - n * CORNER_ICON - (n - 1) * CORNER_GAP, y: this.hearts.y + 2, size: CORNER_ICON, gap: CORNER_GAP };
  }

  /** One heart per life, right-aligned in the corner, left of the corner icons; each with a backing, like the score. */
  private buildHearts() {
    for (const c of this.hearts.removeChildren()) c.destroy({ children: true });
    const n = config.player.lives;
    const stroke = 5;
    for (let i = 0; i < n; i++) {
      const heart = new Text({ text: '♥', style: { fontFamily: FONT, fontSize: 40, fill: '#c0392b', stroke: { color: BIG_FILL, width: stroke } } });
      heart.anchor.set(1, 0);
      const slot = new Container();
      slot.x = -(n - 1 - i) * 40;
      // the backing reaches past the yellow outline, not just past the glyph
      slot.addChild(textBacking(heart, BACKING.smallWidth + stroke / 2), heart);
      this.hearts.addChild(slot);
    }
  }

  /** The score and coin counts, each number shown only when non-zero; the coins follow the score, however wide it is. */
  private updateScoreText() {
    this.scoreText.text = this.score ? String(this.score) : '';
    this.coinText.text = this.coinCount ? String(this.coinCount) : '';
    this.coinBox.x = this.scoreBox.x + this.scoreBox.width + 32;
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
    // the screen's left and right edges in world coordinates (wider than the world when letterboxed)
    const { left, right } = view;
    const { slideMs, showMs } = config.gameOver;
    const { slideMs: completeSlideMs, nextMs } = config.levelComplete;
    let shade = 0;
    if (this.over) shade = slideThrough(this.gameOverText, this.overT, slideMs, showMs, left, right);
    if (this.complete) shade = slideThrough(this.completeText, this.completeT, completeSlideMs, nextMs, left, right);
    this.dim.alpha = config.signDim * Math.max(shade, this.overlayShade);
    this.levelView?.sync();
    this.bird.sync(this.controls);
    for (const villain of this.villains) {
      villain.sync();
      // the knocked-off villain flies towards the camera, in front of everything; walking, he's behind the bird
      const v = villain.view;
      if (villain.falling && v.parent !== this.front) this.front.addChild(v);
      else if (!villain.falling && v.parent !== this.actors) this.actors.addChildAt(v, 0);
    }
    for (const bat of this.bats) {
      bat.sync();
      // a knocked-off bat tumbles down in front of everything
      if (!bat.hittable && bat.view.parent !== this.front) this.front.addChild(bat.view);
    }
    for (const p of this.poos) p.sync();
    for (const a of this.apples) a.sync();
    for (const f of this.friends) f.sync();
    for (const d of this.dragons) d.sync();
    for (const c of this.coins) c.sync();
  }
}

/** Big glowing sign in the middle of the screen ("Pause", "Game Over", "Hooray"), styled like the title. */
function bigText(text: string) {
  const t = new GlowText(text, bigTextStyle(180));
  t.position.set(WORLD.width / 2, WORLD.height / 2);
  return t;
}

/**
 * A big sign slides in from the left to the middle, stays, and slides on out to the right, ending `totalMs` in;
 * `ms` into that. `left`/`right`: the screen's edges. Returns how far in the sign is (0 off screen, 1 in the middle),
 * for dimming the game behind it.
 */
function slideThrough(sign: GlowText, ms: number, slideMs: number, totalMs: number, left: number, right: number): number {
  const slide = Math.max(1, slideMs);
  const kIn = Math.min(1, ms / slide);
  const kOut = Math.min(1, Math.max(0, (ms - (totalMs - slide)) / slide));
  const mid = WORLD.width / 2;
  const from = left - sign.width / 2, to = right + sign.width / 2;
  sign.y = WORLD.height / 2;
  sign.x = kOut > 0 ? mid + (to - mid) * easeInBack(kOut) : from + (mid - from) * easeOutBack(kIn);
  return kOut > 0 ? 1 - Math.min(1, kOut * 2) : Math.min(1, kIn * 2);
}

/**
 * y of the surface of `terrain` where the poo (of radius `r`) hit it. The contact point Matter reports is the deepest point of the overlap,
 * so a fast poo's can lie well inside the terrain: walk it back out along the normal (towards the poo) to the surface.
 */
function surfaceY(terrain: MBody, poo: MBody, r: number, support: { x: number; y: number } | undefined, n: { x: number; y: number }): number {
  if (!support) return poo.position.y + r;
  const dir = n.x * (poo.position.x - support.x) + n.y * (poo.position.y - support.y) < 0 ? -1 : 1;
  const p = { x: support.x, y: support.y };
  for (let i = 0; i < 4 * r && Query.point([terrain], p).length; i++) {
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

const BACK = 1.4;
/** overshoots the end a little, then settles */
const easeOutBack = (x: number) => 1 + (BACK + 1) * (x - 1) ** 3 + BACK * (x - 1) ** 2;
/** pulls back a little, then speeds away */
const easeInBack = (x: number) => (BACK + 1) * x ** 3 - BACK * x ** 2;
