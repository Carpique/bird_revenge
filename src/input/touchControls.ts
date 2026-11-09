import type { PointingIntent } from '../game/pointing';
import type { Controls } from './controls';

/** the knob pushed less than this (fraction of the stick's radius) from the centre: hover in place */
const DEAD_ZONE = 0.25;

/**
 * On-screen controls for playing without the camera on a touch screen: a stick in the lower right corner and a
 * "poo" button in the lower left, at the same height. They steer like pointing control (`game/pointing.ts`): the stick
 * let go is arms down (rest), held near the centre a T (hover), pushed out both arms pointing that way (fly).
 * While the stick is held, both controls fade out so they don't hide the game; they keep working.
 */
export class TouchControls {
  /** a touch screen is the main pointer (a phone or a tablet) */
  static readonly available = matchMedia('(pointer: coarse)').matches;

  onPoo: () => void = () => {};

  private root = document.createElement('div');
  private stick = document.createElement('div');
  private knob = document.createElement('div');
  private fire = document.createElement('div');
  private stickId: number | null = null;
  private intent: PointingIntent | null = null;
  private shown = false;

  constructor(parent: HTMLElement) {
    this.root.id = 'touch';
    this.root.hidden = true;
    this.stick.className = 'touch-pad touch-stick';
    this.knob.className = 'touch-knob';
    this.fire.className = 'touch-pad touch-fire';
    this.fire.innerHTML = '<div class="touch-knob"></div>';
    this.stick.appendChild(this.knob);
    this.root.append(this.fire, this.stick);
    parent.appendChild(this.root);

    this.stick.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      this.root.classList.add('steering');
      this.move(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.move(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) this.release();
    };
    this.stick.addEventListener('pointerup', release);
    this.stick.addEventListener('pointercancel', release);
    this.stick.addEventListener('lostpointercapture', release);

    this.fire.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.fire.classList.add('pressed');
      this.onPoo();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
      this.fire.addEventListener(type, () => this.fire.classList.remove('pressed'));
    // no long-press menu or text selection under a thumb
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Shows or hides the controls; hidden, the stick is let go. */
  set visible(on: boolean) {
    on &&= TouchControls.available;
    if (on === this.shown) return;
    this.shown = on;
    this.root.hidden = !on;
    if (!on) this.release();
  }

  /** The stick's direction in place of `base`'s steering (the stick takes over, like the keys do). */
  apply(base: Controls): Controls {
    if (!this.shown) return base;
    return { ...base, lift: 0, tilt: 0, hover: 0, flapping: false, pointing: this.intent ?? { mode: 'rest', dx: 0, dy: 0 } };
  }

  private move(e: PointerEvent) {
    const r = this.stick.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius, y = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) (x /= len), (y /= len);
    // the knob stays inside the ring
    const reach = radius * (1 - KNOB_SIZE / 2);
    this.knob.style.transform = `translate(-50%, -50%) translate(${x * reach}px, ${y * reach}px)`;
    // fly at the cruising speed whichever way the knob points; screen y is down, the intent's y up
    const n = Math.hypot(x, y);
    this.intent = n < DEAD_ZONE ? { mode: 'hover', dx: 0, dy: 0 } : { mode: 'fly', dx: x / n, dy: -y / n };
  }

  private release() {
    if (this.stickId !== null && this.stick.hasPointerCapture(this.stickId)) this.stick.releasePointerCapture(this.stickId);
    this.stickId = null;
    this.intent = null;
    this.knob.style.transform = '';
    this.root.classList.remove('steering');
  }
}

/** the knob's size, as a fraction of the stick's (keep in step with `.touch-knob` in style.css) */
const KNOB_SIZE = 0.44;
