import { friendDefs, friendFidget, friendRadius, type FriendAnim } from '../characters/friend';
import { config } from '../config';
import type { FriendDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';

/**
 * A little animal to save. It sits still (outside the physics world), blinking now and then, until the bird
 * flies into it; saved, it grows upwards from its feet and fades away, then it's gone.
 */
export class Friend {
  readonly view: CharacterSprite<FriendAnim>;
  state: 'waiting' | 'saved' | 'done' = 'waiting';
  /** its centre */
  readonly x: number;
  readonly y: number;
  private readonly radius: number;
  /** half its display height: from its centre down to its feet */
  private readonly halfHeight: number;
  private savedT = 0;
  private fidget: FriendAnim = 'idle';
  /** ms until the current fidget (or the wait for the next one) ends */
  private fidgetMs = randomWait();

  constructor(def: FriendDef) {
    const character = friendDefs[def.kind];
    this.view = new CharacterSprite<FriendAnim>(character);
    this.x = def.x;
    this.halfHeight = character.displayHeight / 2;
    this.y = def.y - this.halfHeight;
    this.radius = friendRadius[def.kind];
  }

  /** Whether a circle at (x, y) with radius `r` reaches it. */
  touches(x: number, y: number, r: number): boolean {
    const d = r + this.radius;
    return (x - this.x) ** 2 + (y - this.y) ** 2 < d * d;
  }

  save() {
    this.state = 'saved';
  }

  step(stepMs: number) {
    this.stepFidget(stepMs);
    if (this.state !== 'saved') return;
    this.savedT += stepMs;
    if (this.savedT >= config.friend.savedMs) this.state = 'done';
  }

  private stepFidget(stepMs: number) {
    this.fidgetMs -= stepMs;
    if (this.fidgetMs > 0) return;
    const f = friendFidget;
    if (this.fidget !== 'idle') {
      this.fidget = 'idle';
      this.fidgetMs = randomWait();
    } else {
      this.fidget = Math.random() < f.twitchChance ? 'twitch' : 'blink';
      this.fidgetMs = this.fidget === 'twitch' ? f.twitchMs : f.blinkMs;
    }
  }

  sync() {
    this.view.play(this.fidget);
    const k = this.state === 'waiting' ? 0 : Math.min(1, this.savedT / Math.max(1, config.friend.savedMs));
    const scale = 1 + (config.friend.savedScale - 1) * k;
    // the sprite scales about its centre, so lift it as it grows to keep its feet where they were
    this.view.position.set(this.x, this.y - this.halfHeight * (scale - 1));
    this.view.scale.set(scale);
    this.view.alpha = 1 - k;
    this.view.visible = this.state !== 'done';
  }
}

const randomWait = () => friendFidget.minWaitMs + Math.random() * (friendFidget.maxWaitMs - friendFidget.minWaitMs);
