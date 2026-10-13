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
    /** upward acceleration (px/s²) per deg/s of downstroke speed, averaged over both arms (only while both move down) */
    liftGain: 16.8,
    maxLiftAccel: 4800,
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

  /**
   * "glide": both arms spread out in a roughly straight line → the bird falls slowly. Tilting the line
   * slides it sideways; about horizontal it keeps its momentum.
   */
  glide: {
    /** how far the arm points may stray from a straight line: perpendicular RMS / along-line RMS */
    maxBend: 0.12,
    /** arm lines steeper than this (deg) aren't a glide */
    maxTilt: 50,
    /** arms moving faster than this (deg/s) are flapping, not gliding */
    maxArmSpeed: 120,
    /** the pose must hold this long to start gliding... */
    enterMs: 150,
    /** ...and be gone this long to stop */
    exitMs: 150,
    /** tilts within ±this (deg) count as horizontal: no sideways slide, the bird keeps its momentum */
    deadZone: 10,
    /** ...and once sliding, the tilt must drop this much further below the dead zone to stop */
    deadZoneHysteresis: 4,
    /** tilt (deg) at which the slide reaches full `slideSpeed` */
    fullTilt: 35,
    /** EMA factor for the tilt per pose frame (lower = steadier, laggier) */
    tiltSmoothing: 0.3,
    /** -1: arm line rising to the right (as seen on screen) slides left, like a ball rolling downhill. +1: slides right */
    tiltSign: -1,
    /** fraction of gravity still acting while gliding and falling */
    gravityScale: 0.25,
    /** max fall speed while gliding (px per physics step) */
    maxFallSpeed: 2.5,
    /** Matter.js frictionAir while gliding: lower keeps the sideways speed longer */
    airFriction: 0.01,
    /** sideways speed (px per physics step) at full tilt */
    slideSpeed: 4,
    /** how quickly the bird reaches the slide speed: sideways acceleration, px/s² */
    sideAccel: 900,
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
    /** how long the "hit" pose is held before he's knocked off the screen */
    hitShowMs: 300,
    /** knock-off: upward speed of the little hop (px per physics step) */
    fallJumpSpeed: 9,
    /** knock-off: gravity of the fall (px per physics step²) */
    fallGravity: 0.45,
    /** knock-off: sideways drift (px per physics step), away from where he was walking */
    fallSideSpeed: 1.5,
    /** knock-off: scale gained per second, as if flying towards the camera */
    fallGrowth: 0.6,
    respawnDelayMs: 1500,
  },

  /** the villain throws apples at the bird */
  apple: {
    /** launch speed (px per physics step); sets how high he can reach. Constant for now, may grow as the game goes on */
    strength: 9.6,
    /** gravity on a flying apple (px per physics step²) */
    gravity: 0.092,
    /** random time between throws, while he walks on screen */
    minIntervalMs: 2500,
    maxIntervalMs: 6000,
    /** before a throw he stops and turns to the bird this long: the player's warning */
    windupMs: 400,
    /** random aim error, ± degrees */
    aimSpread: 6,
    /** launch angle (deg above horizontal) when the bird is out of reach: the apple falls short */
    outOfReachAngle: 55,
    /** collision radius (px) */
    radius: 13,
    /** spin while flying, turns per second */
    spin: 1.5,
    /** a landed apple lies on the ground this long, fading out */
    groundMs: 1200,
  },

  player: {
    lives: 3,
    /** after coming back from losing a life the bird blinks and can't be hurt for this long */
    invulnerableMs: 2000,
    /** death fall: upward speed of the little hop (px per physics step) */
    dieJumpSpeed: 8,
    /** death fall: gravity (px per physics step²) */
    dieGravity: 0.45,
    /** death fall: sideways drift (px per physics step), backwards */
    dieSideSpeed: 1.5,
    /** death fall: how long the bird takes to turn on its side */
    dieTurnMs: 250,
  },

  score: { villain: 1, pedestrian: -1 },

  countdownMs: 2000,
  gameOver: {
    /** the "Game Over" sign drops from the top to the middle in this long */
    dropMs: 1000,
    /** ...and the screen is shown this long (from the start of the drop) before a new game starts */
    showMs: 4000,
  },
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
