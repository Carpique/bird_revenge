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
    /**
     * an arm counts as visible with its elbow in view plus this fraction of the forearm (elbow → wrist, using the
     * wrist position MediaPipe estimates even off-frame), so raised hands may leave the frame
     */
    forearmInFrame: 0.2,
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
    liftGain: 21,
    maxLiftAccel: 6000,
    /**
     * Each arm's recent flapping effort (its downstroke power averaged over the last this-many ms) decides how the
     * stroke force is split: equal effort lifts, lopsided effort (one arm, or one arm flapping faster) pushes sideways.
     */
    effortWindowMs: 600,
    /**
     * how far apart (ms) the two arms' strokes may start or end and still count as the same flap when comparing
     * their effort; the sideways push from one arm alone kicks in this much later
     */
    phaseGraceMs: 100,
    /** effort ratio (weaker / stronger arm) at or above which flapping counts as fully symmetric: no sideways push */
    symmetricRatio: 0.75,
    /** sideways acceleration (px/s²) per deg/s of downstroke speed, at full asymmetry (one arm alone) */
    sideGain: 22,
    maxSideAccel: 3800,
    /** fraction of the lift that remains at full asymmetry, so one-arm flapping can hold some height */
    asymmetricLift: 0.75,
    /** on: the bird moves towards the stronger (or only) flapping arm. off: away from it, like rowing */
    invertSideFlap: true,
    /** minimum peak-to-trough arm swing (deg) to count as a stroke (stats only) */
    strokeMinAmplitude: 38,
  },

  /** "shoot": a leg raised sideways, read from the hip angles */
  shoot: {
    /** hip abduction (deg above the standing baseline) of either leg that enters a shoot */
    angleEnter: 21,
    /** ...and both legs back below this to leave it */
    angleExit: 12,
    /** left-right hip angle difference (deg) above which one leg counts as the raised one */
    legRaiseMin: 13,
    cooldownMs: 700,
    /** slowly re-learn the standing hip angles while standing (stance drifts a little) */
    baselineAdaptRate: 0.02,
  },

  /**
   * "glide": both arms spread out in a T, in a roughly straight line and held still. Level arms work as a
   * parachute: the fall slows to `sinkSpeed` and the sideways speed slowly decays. Tilting the arm line
   * (one hand down, the other up) dives along it towards the lower hand, faster the more it's tilted.
   */
  glide: {
    /** how far the arm points may stray from a straight line: perpendicular RMS / along-line RMS */
    maxBend: 0.12,
    /** arm lines steeper than this (deg) aren't a glide */
    maxTilt: 45,
    /** arms moving faster than this (deg/s) are flapping, not gliding */
    maxArmSpeed: 120,
    /** the pose must hold this long to start gliding... */
    enterMs: 150,
    /** ...and be gone this long to stop */
    exitMs: 150,
    /** EMA factor for the tilt per pose frame (lower = steadier, laggier) */
    tiltSmoothing: 0.3,
    /** parachute: fall speed with the arms level (px per physics step; normal free fall tops out around 7) */
    sinkSpeed: 1.5,
    /** parachute: fraction of the fall speed above `sinkSpeed` braked away per physics step */
    parachuteDrag: 0.24,
    /** fraction of the sideways speed lost per physics step while gliding level (on top of `airFriction`) */
    horizontalDrag: 0.01,
    /** Matter.js frictionAir while gliding (normal flight: physics.birdAirFriction) */
    airFriction: 0.01,
    /** tilts within ±this (deg) count as level: parachute only, no dive */
    deadZone: 8,
    /** tilt (deg) at which the dive reaches full `diveSpeed`; steeper tilts only dive more steeply */
    fullTilt: 45,
    /** dive speed along the arm line at full tilt, px per physics step (on top of `sinkSpeed`; capped by physics.maxSpeed) */
    diveSpeed: 8,
    /** how quickly the bird picks up the dive speed, px/s² */
    diveAccel: 2400,
    /** how much the bird leans with the arm line while gliding (1 = exactly like the arms, 0 = upright) */
    bank: 0.8,
  },

  /**
   * "posture" control, an alternative to flapping + glide (`enabled` switches between them). Each arm's angle
   * above or below horizontal steers the bird directly:
   * - the higher arm, raised above horizontal, sets the speed (straight up = full speed)
   * - the other arm sets the direction: level → sideways towards it, as high as the speed arm → straight up,
   *   in between → diagonally; below horizontal → the lift is lost and the bird dives towards it, steeper the lower it is
   * - both arms level (a T) → parachute (as the glide: `glide.sinkSpeed`, `glide.parachuteDrag`)
   * - no arm above horizontal, one below → free fall, the momentum fades
   */
  posture: {
    /** on: posture control. off: flapping + glide */
    enabled: true,
    /** EMA factor for the arm angles per pose frame (lower = steadier, laggier) */
    smoothing: 0.4,
    /** arm angles within ±this (deg) of horizontal count as level */
    deadZone: 10,
    /** arm angle above horizontal (deg) for full speed; also the below-horizontal angle for a straight-down dive */
    fullRaise: 80,
    /** flying speed at full raise, px per physics step */
    flySpeed: 8,
    /** dive speed at full raise, px per physics step (gravity adds to it; capped by physics.maxSpeed) */
    diveSpeed: 10,
    /** how quickly the bird reaches the flying/dive speed, px/s² */
    accel: 1800,
    /** free fall: fraction of the sideways and upward speed lost per physics step */
    fallDrag: 0.08,
    /** Matter.js frictionAir while flying, diving or in the parachute (free fall: physics.birdAirFriction) */
    airFriction: 0.01,
    /** how far the bird leans (deg) flying flat out sideways; up to twice that in a straight-down dive */
    leanDeg: 30,
    /** wing flapping while flying (up or sideways), as a multiple of the flap animation's fps: at the slowest... */
    flapRateMin: 0.6,
    /** ...and at full speed */
    flapRateMax: 1.4,
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
    /** fraction of the bird's sideways speed lost per physics step while sitting on a branch */
    branchFriction: 0.15,
  },

  keyboard: {
    /** lift (px/s²) while flap key held */
    lift: 1600,
    /** sideways accel (px/s²) while arrow held */
    steer: 1400,
    /** arm tilt (deg) that Shift + ← / → stands for: Shift alone glides level, with an arrow it dives that way */
    diveTilt: 30,
  },

  villain: {
    /** px per physics step */
    speed: 1.6,
    /** random time he walks before stopping for a moment (only while on screen) */
    minWalkMs: 1200,
    maxWalkMs: 4000,
    /** random length of a stop; afterwards he walks on the same way */
    minPauseMs: 300,
    maxPauseMs: 1200,
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
  },

  /** the villain throws apples at the bird */
  apple: {
    /** flight speed (px per physics step); apples fly in a straight line, no gravity. Constant for now, may grow as the game goes on */
    speed: 5,
    /**
     * time between throws is random within ± this fraction of the villain's `throwDelay` (set per villain in Tiled)
     */
    intervalSpread: 0.4,
    /** before a throw he stops and turns to the bird this long: the player's warning */
    windupMs: 400,
    /** random aim error, ± degrees */
    aimSpread: 6,
    /** collision radius (px) */
    radius: 13,
    /** spin while flying, turns per second */
    spin: 1.5,
    /** an apple hit by a poo: both stop, blink and fade out over this long */
    poopedMs: 1000,
    /** ...and start falling (like a poo) this long after the hit */
    poopedFallAfterMs: 500,
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

  /** Mix levels (multiplied by the speaker button's volume) and the falling-poo sound. */
  audio: {
    music: 0.5,
    effects: 0.75,
    /** the falling-poo tone; keep it low, it's on for the whole fall */
    fall: 0.06,
    /** its pitch glides from here... */
    fallFromHz: 900,
    /** ...down to here, over `fallMs` */
    fallToHz: 220,
    fallMs: 1200,
  },

  score: { villain: 1, pedestrian: -1 },

  /** a saved friend grows to this many times its size while fading out, in this long */
  friend: { savedScale: 4, savedMs: 1000 },

  countdownMs: 2000,
  gameOver: {
    /** the "Game Over" sign drops from the top to the middle in this long */
    dropMs: 1000,
    /** ...and the screen is shown this long (from the start of the drop) before a new game starts */
    showMs: 4000,
  },
  levelComplete: {
    /** play goes on this long after the last friend is saved (the bird blinking, unhurtable); then everything stops */
    graceMs: 2000,
    /** the "Hooray" sign drops from the top to the middle in this long, with a fanfare */
    dropMs: 1000,
    /** ...and the next level starts this long after everything stopped (the fanfare's length) */
    nextMs: 3000,
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
