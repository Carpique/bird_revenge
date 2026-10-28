import { config } from '../config';
import type { Controls } from './controls';

/**
 * Keyboard fallback: ↑ flap, ← → fly sideways, ↓ poo, Shift hover. Space toggles pause (`onPause`).
 * Single-letter hotkeys (and Esc, as 'escape') are dispatched to `onHotkey`.
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
      if (k === 'Escape' && !e.repeat) this.onHotkey('escape');
      this.held.add(k);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Adds keyboard input on top of `base` (pose) controls. */
  apply(base: Controls): Controls {
    const flap = this.held.has('ArrowUp');
    const side = (this.held.has('ArrowRight') ? 1 : 0) - (this.held.has('ArrowLeft') ? 1 : 0);
    const hover = this.held.has('Shift');
    if (!flap && !side && !hover) return base;
    return {
      lift: base.lift + (flap ? config.keyboard.lift : 0),
      // flying right = the right hand lower = negative tilt
      tilt: side ? -side * config.keyboard.tilt : base.tilt,
      // ← → hold the arms out tilted (a tilted T): the bird keeps its altitude, as with Shift
      hover: hover || side ? 1 : base.hover,
      wingPhase: flap ? null : base.wingPhase,
      flapping: flap || base.flapping,
      // ← → and Shift are the keyboard's own sideways flight and hover, so they take over from the posture
      posture: side || hover ? null : base.posture,
    };
  }
}
