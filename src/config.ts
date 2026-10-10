/**
 * All tunable numbers in one place. The tuning panel (press G) edits this object live
 * and can save it to localStorage, so you can tune while standing in front of the camera.
 */

/** Logical game world size; the stage is scaled to fit the window. */
export const WORLD = {
  width: 1280,
  height: 720,
  /** y of the ground surface */
  groundY: 640,
};

export const config = {
  pose: {
    /** MediaPipe model size: lite is fastest, heavy most accurate. Change requires reload. */
    model: 'lite' as 'lite' | 'full' | 'heavy',
    delegate: 'GPU' as 'GPU' | 'CPU',
  },

  /** One-Euro filter applied to landmark coordinates (lower minCutoff = smoother but laggier). */
  smoothing: { minCutoff: 2.0, beta: 0.3, dCutoff: 1.0 },

  visibility: {
    /** a landmark counts as visible if its MediaPipe visibility is at least this... */
    minLandmarkVisibility: 0.6,
    /** ...and it lies inside the frame by at least this margin (fraction of width/height) */
    frameMargin: 0.02,
    /** EMA factor for per-part visibility score (per pose frame) */
    emaAlpha: 0.25,
    lostBelow: 0.4,
    recoverAbove: 0.7,
    /** how long a part must stay below `lostBelow` before it is declared lost */
    lostAfterMs: 400,
    /** arms get longer, since hands briefly leave the frame at the top of a big flap */
    armLostAfterMs: 800,
    recoverAfterMs: 300,
    noPersonAfterMs: 500,
    /** nose→hips height as fraction of frame height, below which we hint "come closer" */
    minUpperBodyHeight: 0.22,
  },

  calibration: {
    /** hold still in the outline this long */
    holdMs: 1200,
    /** max hip movement (fraction of torso length) during the hold */
    maxMovement: 0.08,
    /** require both hands below the shoulders, like the outline */
    requireArmsDown: true,
  },

  flap: {
    /** downward arm angular speed (deg/s) below which nothing happens */
    velocityDeadzone: 60,
    /** EMA factor for angular velocity per pose frame (higher = more responsive, noisier) */
    velocitySmoothing: 0.5,
    /** upward acceleration (px/s²) per deg/s of downstroke speed, averaged over both arms */
    liftGain: 14,
    /** sideways acceleration (px/s²) per deg/s of left-right downstroke difference */
    steerGain: 6,
    /**
     * +1: stronger LEFT arm pushes the bird RIGHT (like rowing / a real bird turning).
     * -1: stronger left arm moves the bird left.
     */
    steerSign: 1,
    maxLiftAccel: 4000,
    maxSteerAccel: 2500,
    /** minimum peak-to-trough arm swing (deg) to count as a stroke (stats only) */
    strokeMinAmplitude: 25,
  },

  /** "shoot": a leg raised sideways, read from the hip angles */
  shoot: {
    /** hip abduction (deg above the standing baseline) of either leg that enters a shoot */
    angleEnter: 25,
    /** ...and both legs back below this to leave it */
    angleExit: 12,
    /** left-right hip angle difference (deg) above which one leg counts as the raised one */
    legRaiseMin: 15,
    cooldownMs: 700,
    /** slowly re-learn the standing hip angles while standing (stance drifts a little) */
    baselineAdaptRate: 0.02,
  },

  physics: {
    /** 1.0 = 1000 px/s² */
    gravity: 0.8,
    birdRadius: 34,
    /** Matter.js frictionAir: velocity damping per step */
    birdAirFriction: 0.03,
    /** px per physics step (60 Hz) */
    maxSpeed: 14,
    pooRadius: 9,
    /** sideways poo speed (px per physics step) when dropped with one leg raised, towards that leg's side */
    pooSideSpeed: 3,
  },

  keyboard: {
    /** lift (px/s²) while flap key held */
    lift: 1600,
    /** sideways accel (px/s²) while arrow held */
    steer: 1400,
  },

  villain: {
    /** px per physics step */
    speed: 1.6,
    hitShowMs: 900,
    respawnDelayMs: 1500,
  },

  score: { villain: 1, pedestrian: -1 },

  countdownMs: 2000,
};

export type Config = typeof config;

const STORAGE_KEY = 'pooping-birds-config';

/** Deep-assign saved values onto config (ignores unknown keys). */
function assignDeep(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k of Object.keys(src)) {
    if (!(k in target)) continue;
    const tv = target[k];
    const sv = src[k];
    if (tv && typeof tv === 'object' && sv && typeof sv === 'object') {
      assignDeep(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (typeof tv === typeof sv) {
      target[k] = sv;
    }
  }
}

export function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) assignDeep(config as unknown as Record<string, unknown>, JSON.parse(raw));
  } catch {
    /* storage unavailable: use defaults */
  }
}

export function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

export function clearSavedConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
