import { AnimatedSprite, Container, type Texture } from 'pixi.js';
import type { CharacterDef } from '../characters/types';
import { tex } from './assets';

/** A sprite built from a CharacterDef: named animations, auto-scaled to displayHeight, mirrorable. */
export class CharacterSprite<A extends string = string> extends Container {
  readonly anim: AnimatedSprite;
  private textures = {} as Record<A, Texture[]>;
  private baseScale: number;
  private current: A;

  constructor(private def: CharacterDef<A>) {
    super();
    for (const name of Object.keys(def.animations) as A[]) {
      this.textures[name] = def.animations[name].frames.map(tex);
    }
    const first = this.textures[def.defaultAnimation];
    this.anim = new AnimatedSprite(first);
    this.anim.anchor.set(def.anchor.x, def.anchor.y);
    this.baseScale = def.displayHeight / first[0].height;
    this.anim.scale.set(this.baseScale);
    this.addChild(this.anim);
    this.current = def.defaultAnimation;
    this.play(def.defaultAnimation);
  }

  /** Play an animation at its own fps (no-op if already playing it). */
  play(name: A) {
    const a = this.def.animations[name];
    const frames = this.textures[name];
    if (this.current === name && (this.anim.playing || frames.length === 1)) return;
    this.setTextures(name);
    this.anim.animationSpeed = a.fps / 60;
    this.anim.loop = a.loop ?? true;
    if (frames.length > 1) this.anim.play();
    else this.anim.gotoAndStop(0);
  }

  /** Show one frame of an animation picked by phase 0..1 (first..last frame). */
  showPhase(name: A, phase: number) {
    this.setTextures(name);
    const n = this.textures[name].length;
    this.anim.gotoAndStop(Math.round(Math.max(0, Math.min(1, phase)) * (n - 1)));
  }

  setFacing(dir: 'left' | 'right') {
    this.anim.scale.x = this.baseScale * (dir === this.def.facing ? 1 : -1);
  }

  private setTextures(name: A) {
    if (this.current === name && this.anim.textures === this.textures[name]) return;
    this.current = name;
    this.anim.textures = this.textures[name];
  }
}
