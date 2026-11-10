import GUI from 'lil-gui';
import { changedConfig, clearSavedConfig, config, saveConfig } from '../config';
import configSource from '../config.ts?raw';
import { parseConfigDocs } from './configDocs';

/** Tooltips for sections and options: the doc comments in config.ts. */
const DOCS = parseConfigDocs(configSource);

/** Slider ranges for the tuning panel; anything not listed gets a plain number box. */
const RANGES: Record<string, [number, number, number]> = {
  'flap.velocityDeadzone': [0, 300, 5],
  'flap.primeRise': [0, 90, 1],
  'flap.primeVelocity': [0, 300, 5],
  'flap.primeHoldMs': [0, 2000, 25],
  'flap.velocitySmoothing': [0.05, 1, 0.05],
  'flap.liftGain': [0, 40, 0.5],
  'flap.maxLiftAccel': [500, 8000, 100],
  'flap.liftSmoothMs': [0, 1500, 10],
  'flap.flappingGravity': [0, 1, 0.05],
  'flap.strokeMinAmplitude': [5, 90, 1],
  'friend.savedScale': [1, 8, 0.1],
  'friend.savedMs': [100, 4000, 50],
  'coin.collectedRise': [0, 200, 5],
  'coin.collectedMs': [50, 2000, 50],
  'coin.glowSize': [0, 200, 5],
  'coin.glowAlpha': [0, 1, 0.05],
  'coin.glowHue': [0, 360, 1],
  'coin.glowPulse': [0, 1, 0.05],
  'coin.glowPulseMs': [200, 5000, 100],
  'shoot.angleEnter': [5, 80, 1],
  'shoot.angleExit': [0, 60, 1],
  'shoot.cooldownMs': [0, 3000, 50],
  'shoot.baselineAdaptRate': [0, 0.2, 0.005],
  'tilt.smoothing': [0.05, 1, 0.05],
  'tilt.deadZone': [0, 30, 1],
  'tilt.fullTilt': [5, 90, 1],
  'tilt.sideSpeed': [0, 14, 0.5],
  'tilt.sideAccel': [100, 6000, 100],
  'tilt.fineSpeed': [0, 8, 0.25],
  'tilt.fineAccel': [0, 3000, 50],
  'tilt.fineMs': [0, 5000, 100],
  'tilt.fineTilt': [0, 60, 1],
  'tilt.boostTilt': [0, 90, 1],
  'tilt.leanDeg': [0, 60, 1],
  'tilt.sideLift': [0, 1, 0.05],
  'tilt.climbPitchDeg': [0, 90, 1],
  'tilt.holdDrag': [0, 1, 0.01],
  'tilt.holdFlapRate': [0.25, 4, 0.05],
  'hover.maxBend': [0, 0.5, 0.01],
  'hover.maxDroopDiff': [0, 60, 1],
  'hover.holdDroop': [0, 80, 1],
  'hover.fallDroop': [5, 90, 1],
  'hover.maxTilt': [10, 90, 1],
  'hover.maxRaise': [0, 90, 1],
  'hover.minElbowAngle': [90, 180, 1],
  'hover.maxArmSpeed': [0, 600, 10],
  'hover.enterMs': [0, 1000, 10],
  'hover.exitMs': [0, 1000, 10],
  'pointing.smoothingMs': [0, 300, 5],
  'pointing.restCone': [5, 80, 1],
  'pointing.tMaxArm': [10, 90, 1],
  'pointing.tMaxRaise': [0, 80, 1],
  'pointing.tiltDeadZone': [0, 60, 1],
  'pointing.tiltHysteresis': [0, 20, 1],
  'pointing.parallelMax': [5, 90, 1],
  'pointing.vMinArm': [0, 90, 1],
  'pointing.vHysteresis': [0, 20, 1],
  'pointing.enterMs': [0, 1000, 10],
  'pointing.ambiguousMs': [0, 2000, 50],
  'pointing.cruiseSpeed': [0, 20, 0.5],
  'pointing.driftSpeed': [0, 10, 0.1],
  'pointing.descendEnter': [0, 60, 1],
  'pointing.descendExit': [0, 60, 1],
  'pointing.descendZero': [0, 60, 1],
  'pointing.descendFull': [1, 90, 1],
  'pointing.descendSpeed': [0, 10, 0.1],
  'pointing.descendSmoothMs': [0, 500, 10],
  'pointing.togetherZero': [0, 1, 0.01],
  'pointing.togetherFull': [0, 1, 0.01],
  'pointing.tiltFull': [0, 90, 1],
  'pointing.accel': [100, 6000, 100],
  'pointing.restDrag': [0, 0.5, 0.01],
  'pointing.airFriction': [0, 0.2, 0.005],
  'pointing.leanDeg': [0, 60, 1],
  'pointing.flapRate': [0.1, 3, 0.05],
  'visibility.minLandmarkVisibility': [0, 1, 0.05],
  'visibility.frameMargin': [0, 0.1, 0.005],
  'visibility.emaAlpha': [0.05, 1, 0.05],
  'visibility.forearmInFrame': [0, 1, 0.05],
  'visibility.lostAfterMs': [0, 2000, 50],
  'visibility.armLostAfterMs': [0, 3000, 50],
  'visibility.recoverAfterMs': [0, 2000, 50],
  'visibility.maxOffCentre': [0.05, 0.5, 0.01],
  'visibility.offCentreAfterMs': [0, 3000, 50],
  'visibility.redetectEveryMs': [500, 10000, 100],
  'visibility.personGoneAfterMs': [500, 10000, 100],
  'pose.holdLastMs': [0, 1000, 10],
  'pose.minWristVisibility': [0, 1, 0.05],
  'pose.wristVisibilityMargin': [0, 0.5, 0.05],
  'pose.watchdogMs': [300, 5000, 100],
  'pose.resetFiltersAfterMs': [0, 2000, 50],
  'physics.gravity': [0, 3, 0.05],
  'physics.birdAirFriction': [0, 0.2, 0.005],
  'physics.maxSpeed': [2, 40, 1],
  'physics.branchFriction': [0, 1, 0.05],
  'keyboard.lift': [0, 5000, 50],
  'keyboard.tilt': [0, 90, 1],
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
  'apple.warnMs': [0, 3000, 50],
  'apple.warnFadeMs': [0, 2000, 50],
  'apple.warnBlinkHz': [0, 10, 0.5],
  'apple.aimSpread': [0, 45, 1],
  'apple.radius': [2, 40, 1],
  'apple.poopedMs': [100, 3000, 50],
  'apple.poopedFallAfterMs': [0, 3000, 50],
  'bat.intervalSpread': [0, 1, 0.05],
  'bat.pooRadius': [2, 20, 1],
  'bat.pooSpeed': [0, 10, 0.25],
  'bat.hitShowMs': [0, 2000, 50],
  'bat.fallGravity': [0.05, 2, 0.05],
  'bat.fallSpin': [0, 5, 0.1],
  'bat.homingClearance': [0, 100, 2],
  'bat.homingReplanMs': [50, 2000, 50],
  'bat.homingSeparation': [0, 300, 5],
  'bat.homingSeparationWeight': [0, 10, 0.25],
  'bat.homingTurn': [0.01, 1, 0.01],
  'bat.homingWander': [0, 1.5, 0.05],
  'bat.homingWanderHz': [0, 3, 0.05],
  'bat.homingIdleRadius': [0, 200, 5],
  'player.lives': [1, 9, 1],
  'player.invulnerableMs': [0, 5000, 100],
  'player.dieJumpSpeed': [0, 30, 0.5],
  'player.dieGravity': [0.05, 2, 0.05],
  'player.dieSideSpeed': [0, 10, 0.5],
  'player.dieTurnMs': [0, 2000, 50],
  'smoothing.minCutoff': [0.1, 10, 0.1],
  'smoothing.beta': [0, 3, 0.01],
  'smoothing.armBeta': [0, 30, 0.1],
  'audio.music': [0, 1, 0.05],
  'audio.musicDucked': [0, 1, 0.05],
  'audio.musicRestoreMs': [0, 5000, 100],
  'audio.musicHushMs': [0, 3000, 50],
  'audio.effects': [0, 1, 0.05],
  'audio.fall': [0, 0.5, 0.01],
  'audio.fallFromHz': [100, 3000, 10],
  'audio.fallToHz': [50, 2000, 10],
  'audio.fallMs': [100, 5000, 50],
  'telemetry.hitchMs': [40, 1000, 10],
  'telemetry.longRenderMs': [10, 200, 1],
  'telemetry.blackBoxSeconds': [10, 300, 10],
};

const SECTIONS = ['pointing', 'flap', 'tilt', 'hover', 'shoot', 'visibility', 'calibration', 'smoothing', 'physics', 'keyboard', 'villain', 'apple', 'bat', 'friend', 'coin', 'player', 'audio', 'telemetry'] as const;

/** lil-gui panel (toggle with G) editing `config` live. */
export class Tuning {
  private gui = new GUI({ title: 'Tuning (G to hide)' });
  private shown = false;

  constructor() {
    for (const section of SECTIONS) {
      const obj = config[section] as Record<string, unknown>;
      const folder = this.gui.addFolder(section);
      if (DOCS[section]) folder.$title.title = DOCS[section];
      for (const key of Object.keys(obj)) {
        const r = RANGES[`${section}.${key}`];
        const controller =
          section === 'pointing' && key === 'flapping'
            ? folder.add(obj, key).name('Flapping (off: pointing)')
            : r
              ? folder.add(obj, key, r[0], r[1], r[2])
              : folder.add(obj, key);
        const doc = DOCS[`${section}.${key}`];
        if (doc) controller.domElement.title = doc;
      }
      folder.close();
    }
    this.gui.add({ save: () => saveConfig() }, 'save').name('💾 save to this browser');
    this.gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(changedConfig(), null, 2)) }, 'copy').name('📋 copy changes as JSON');
    this.gui.add({ reset: () => (clearSavedConfig(), location.reload()) }, 'reset').name('↺ reset to defaults');
    this.gui.hide();
  }

  toggle() {
    this.shown = !this.shown;
    if (this.shown) this.gui.show();
    else this.gui.hide();
  }
}
