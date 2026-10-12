import GUI from 'lil-gui';
import { clearSavedConfig, config, saveConfig } from '../config';

/** Slider ranges for the tuning panel; anything not listed gets a plain number box. */
const RANGES: Record<string, [number, number, number]> = {
  'flap.velocityDeadzone': [0, 300, 5],
  'flap.velocitySmoothing': [0.05, 1, 0.05],
  'flap.liftGain': [0, 40, 0.5],
  'flap.steerGain': [0, 30, 0.5],
  'flap.maxLiftAccel': [500, 8000, 100],
  'flap.maxSteerAccel': [0, 6000, 100],
  'flap.strokeMinAmplitude': [5, 90, 1],
  'shoot.angleEnter': [5, 80, 1],
  'shoot.angleExit': [0, 60, 1],
  'shoot.legRaiseMin': [0, 60, 1],
  'shoot.cooldownMs': [0, 3000, 50],
  'shoot.baselineAdaptRate': [0, 0.2, 0.005],
  'visibility.minLandmarkVisibility': [0, 1, 0.05],
  'visibility.frameMargin': [0, 0.1, 0.005],
  'visibility.emaAlpha': [0.05, 1, 0.05],
  'visibility.lostAfterMs': [0, 2000, 50],
  'visibility.armLostAfterMs': [0, 3000, 50],
  'visibility.recoverAfterMs': [0, 2000, 50],
  'physics.gravity': [0, 3, 0.05],
  'physics.birdAirFriction': [0, 0.2, 0.005],
  'physics.maxSpeed': [2, 40, 1],
  'physics.pooSideSpeed': [0, 12, 0.5],
  'keyboard.lift': [0, 5000, 50],
  'keyboard.steer': [0, 5000, 50],
  'villain.speed': [0, 8, 0.1],
  'villain.fallJumpSpeed': [0, 30, 0.5],
  'villain.fallGravity': [0.05, 2, 0.05],
  'villain.fallSideSpeed': [0, 10, 0.5],
  'villain.fallGrowth': [0, 5, 0.1],
  'player.lives': [1, 9, 1],
  'player.invulnerableMs': [0, 5000, 100],
  'player.dieJumpSpeed': [0, 30, 0.5],
  'player.dieGravity': [0.05, 2, 0.05],
  'player.dieSideSpeed': [0, 10, 0.5],
  'player.dieTurnMs': [0, 2000, 50],
  'smoothing.minCutoff': [0.1, 10, 0.1],
  'smoothing.beta': [0, 3, 0.01],
};

const SECTIONS = ['flap', 'shoot', 'visibility', 'calibration', 'smoothing', 'physics', 'keyboard', 'villain', 'player'] as const;

/** lil-gui panel (toggle with G) editing `config` live. */
export class Tuning {
  private gui = new GUI({ title: 'Tuning (G to hide)' });
  private shown = false;

  constructor() {
    for (const section of SECTIONS) {
      const obj = config[section] as Record<string, unknown>;
      const folder = this.gui.addFolder(section);
      for (const key of Object.keys(obj)) {
        const r = RANGES[`${section}.${key}`];
        if (section === 'flap' && key === 'steerSign') {
          folder.add(obj, key, { 'left arm → right': 1, 'left arm → left': -1 }).name('steering');
        } else if (r) {
          folder.add(obj, key, r[0], r[1], r[2]);
        } else {
          folder.add(obj, key);
        }
      }
      if (section !== 'flap' && section !== 'shoot') folder.close();
    }
    this.gui.add({ save: () => saveConfig() }, 'save').name('💾 save to this browser');
    this.gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(config, null, 2)) }, 'copy').name('📋 copy as JSON');
    this.gui.add({ reset: () => (clearSavedConfig(), location.reload()) }, 'reset').name('↺ reset to defaults');
    this.gui.hide();
  }

  toggle() {
    this.shown = !this.shown;
    if (this.shown) this.gui.show();
    else this.gui.hide();
  }
}
