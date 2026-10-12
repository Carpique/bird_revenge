import { config } from '../config';
import type { Controls } from './controls';

/**
 * Keyboard fallback: ↑ flap, ← → steer, ↓ poo, Shift glide. Space toggles pause (`onPause`).
 * Single-letter hotkeys are dispatched to `onHotkey`.
 */
export class Keyboard {
  private held = new Set<string>();
  onPoo: () => void = () => {};
  onHotkey: (key: string) => void = () => {};
  onPause: () => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing in the tuning panel
      const k = e.key;
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (k === ' ' && !e.repeat) this.onPause();
      if ((k === 'ArrowDown' || k === 's') && !e.repeat) this.onPoo();
      if (k.length === 1 && k !== ' ' && !e.repeat) this.onHotkey(k.toLowerCase());
      this.held.add(k);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Adds keyboard input on top of `base` (pose) controls. */
  apply(base: Controls): Controls {
    const flap = this.held.has('ArrowUp');
    const left = this.held.has('ArrowLeft');
    const right = this.held.has('ArrowRight');
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const glide = this.held.has('Shift');
    if (!flap && !steer && !glide) return base;
    return {
      lift: base.lift + (flap ? config.keyboard.lift : 0),
      steer: base.steer + steer * config.keyboard.steer,
      wingPhase: flap ? null : base.wingPhase,
      flapping: flap || base.flapping,
      gliding: glide || base.gliding,
      glideSlide: base.glideSlide,
    };
  }
}
