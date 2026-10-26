import GUI from 'lil-gui';
import { clearSavedConfig, config, saveConfig } from '../config';

/** Slider ranges for the tuning panel; anything not listed gets a plain number box. */
const RANGES: Record<string, [number, number, number]> = {
  'flap.velocityDeadzone': [0, 300, 5],
  'flap.velocitySmoothing': [0.05, 1, 0.05],
  'flap.liftGain': [0, 40, 0.5],
  'flap.maxLiftAccel': [500, 8000, 100],
  'flap.effortWindowMs': [100, 2000, 50],
  'flap.phaseGraceMs': [0, 300, 10],
  'flap.symmetricRatio': [0.05, 1, 0.05],
  'flap.sideGain': [0, 40, 0.5],
  'flap.maxSideAccel': [0, 6000, 100],
  'flap.asymmetricLift': [0, 1, 0.05],
  'flap.strokeMinAmplitude': [5, 90, 1],
  'shoot.angleEnter': [5, 80, 1],
  'shoot.angleExit': [0, 60, 1],
  'shoot.legRaiseMin': [0, 60, 1],
  'shoot.cooldownMs': [0, 3000, 50],
  'shoot.baselineAdaptRate': [0, 0.2, 0.005],
  'glide.maxBend': [0, 0.5, 0.01],
  'glide.maxTilt': [10, 90, 1],
  'glide.maxArmSpeed': [0, 600, 10],
  'glide.enterMs': [0, 1000, 10],
  'glide.exitMs': [0, 1000, 10],
  'glide.tiltSmoothing': [0.05, 1, 0.05],
  'glide.sinkSpeed': [0, 8, 0.1],
  'glide.parachuteDrag': [0, 1, 0.01],
  'glide.horizontalDrag': [0, 0.2, 0.005],
  'glide.airFriction': [0, 0.2, 0.005],
  'glide.deadZone': [0, 30, 1],
  'glide.fullTilt': [5, 90, 1],
  'glide.diveSpeed': [0, 30, 0.5],
  'glide.diveAccel': [0, 8000, 100],
  'glide.bank': [0, 1.5, 0.05],
  'posture.smoothing': [0.05, 1, 0.05],
  'posture.deadZone': [0, 30, 1],
  'posture.fullRaise': [20, 90, 1],
  'posture.flySpeed': [0, 20, 0.5],
  'posture.diveSpeed': [0, 20, 0.5],
  'posture.accel': [100, 6000, 100],
  'posture.fallDrag': [0, 0.5, 0.01],
  'posture.airFriction': [0, 0.2, 0.005],
  'posture.leanDeg': [0, 60, 1],
  'posture.flapRateMin': [0.1, 3, 0.05],
  'posture.flapRateMax': [0.1, 3, 0.05],
  'visibility.minLandmarkVisibility': [0, 1, 0.05],
  'visibility.frameMargin': [0, 0.1, 0.005],
  'visibility.emaAlpha': [0.05, 1, 0.05],
  'visibility.forearmInFrame': [0, 1, 0.05],
  'visibility.lostAfterMs': [0, 2000, 50],
  'visibility.armLostAfterMs': [0, 3000, 50],
  'visibility.recoverAfterMs': [0, 2000, 50],
  'physics.gravity': [0, 3, 0.05],
  'physics.birdAirFriction': [0, 0.2, 0.005],
  'physics.maxSpeed': [2, 40, 1],
  'physics.pooSideSpeed': [0, 12, 0.5],
  'physics.branchFriction': [0, 1, 0.05],
  'keyboard.lift': [0, 5000, 50],
  'keyboard.steer': [0, 5000, 50],
  'keyboard.diveTilt': [0, 90, 1],
  'villain.speed': [0, 8, 0.1],
  'villain.minWalkMs': [0, 10000, 100],
  'villain.maxWalkMs': [0, 10000, 100],
  'villain.minPauseMs': [0, 5000, 50],
  'villain.maxPauseMs': [0, 5000, 50],
  'villain.fallJumpSpeed': [0, 30, 0.5],
  'villain.fallGravity': [0.05, 2, 0.05],
  'villain.fallSideSpeed': [0, 10, 0.5],
  'villain.fallGrowth': [0, 5, 0.1],
  'apple.speed': [0, 20, 0.25],
  'apple.intervalSpread': [0, 1, 0.05],
  'apple.windupMs': [0, 2000, 50],
  'apple.aimSpread': [0, 45, 1],
  'apple.radius': [2, 40, 1],
  'apple.poopedMs': [100, 3000, 50],
  'apple.poopedFallAfterMs': [0, 3000, 50],
  'player.lives': [1, 9, 1],
  'player.invulnerableMs': [0, 5000, 100],
  'player.dieJumpSpeed': [0, 30, 0.5],
  'player.dieGravity': [0.05, 2, 0.05],
  'player.dieSideSpeed': [0, 10, 0.5],
  'player.dieTurnMs': [0, 2000, 50],
  'smoothing.minCutoff': [0.1, 10, 0.1],
  'smoothing.beta': [0, 3, 0.01],
  'audio.music': [0, 1, 0.05],
  'audio.effects': [0, 1, 0.05],
  'audio.fall': [0, 0.5, 0.01],
  'audio.fallFromHz': [100, 3000, 10],
  'audio.fallToHz': [50, 2000, 10],
  'audio.fallMs': [100, 5000, 50],
};

const SECTIONS = ['posture', 'flap', 'glide', 'shoot', 'visibility', 'calibration', 'smoothing', 'physics', 'keyboard', 'villain', 'apple', 'friend', 'player', 'audio'] as const;

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
        if (section === 'flap' && key === 'invertSideFlap') {
          folder.add(obj, key).name('Invert side-flap');
        } else if (section === 'posture' && key === 'enabled') {
          folder.add(obj, key).name('Posture control (off = flapping)');
        } else if (r) {
          folder.add(obj, key, r[0], r[1], r[2]);
        } else {
          folder.add(obj, key);
        }
      }
      if (section !== 'posture' && section !== 'flap' && section !== 'glide' && section !== 'shoot') folder.close();
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
