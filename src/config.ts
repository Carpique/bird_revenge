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
    velocityDeadzone: 40,
    /**
     * a downstroke only lifts after the arm was raised (primed): by at least this much (deg) from its lowest point,
     * so lowering the arms from a held pose (to sink) doesn't flap
     */
    primeRise: 25,
    /** ...rising faster than this (deg/s) */
    primeVelocity: 40,
    /** ...and a primed arm held still (neither rising nor flapping down) this long (ms) disarms */
    primeHoldMs: 350,
    /** EMA factor for angular velocity per pose frame (higher = more responsive, noisier) */
    velocitySmoothing: 0.5,
    /** upward acceleration (px/s²) per deg/s of downstroke speed, averaged over both arms */
    liftGain: 30,
    maxLiftAccel: 3000,
    /**
     * Right after the last flap the bird falls gently: only this fraction of gravity acts, rising smoothly (ease-in)
     * back to full gravity over `afterFlapMs`, so a few flaps keep the altitude. Only while falling, in flapping mode.
     */
    afterFlapGravity: 0.4,
    afterFlapMs: 300,
    /** minimum peak-to-trough arm swing (deg) to count as a stroke (stats only) */
    strokeMinAmplitude: 38,
  },

  /** "shoot": a leg raised sideways, read from the hip angles */
  shoot: {
    /** legs' spread (deg above the standing baseline: both legs' hip abduction added up) that enters a shoot */
    angleEnter: 21,
    /** ...and back below this to leave it */
    angleExit: 12,
    cooldownMs: 700,
    /** slowly re-learn the standing hip angles while standing (stance drifts a little) */
    baselineAdaptRate: 0.02,
  },

  /**
   * Tilting the arms (one hand lower than the other: a tilted T, flapping tilted, or leaning the whole body) flies
   * the bird sideways towards the lower hand, faster the more they're tilted, keeping its altitude: it doesn't fall,
   * and flapping tilted climbs in a straight line, beak up (`climbSmoothMs`).
   */
  tilt: {
    /** EMA factor for the tilt per pose frame (lower = steadier through out-of-step flaps, laggier) */
    smoothing: 0.2,
    /** tilts within ±this (deg) count as level: no sideways flight */
    deadZone: 10,
    /** tilt (deg) at which the bird flies sideways at full `sideSpeed` */
    fullTilt: 11,
    /** sideways speed at full tilt, px per physics step */
    sideSpeed: 8,
    /** how quickly the bird picks up (or reverses) its sideways speed, px/s²; braking always uses this */
    sideAccel: 1800,
    /**
     * a gentle start for precise positioning: for its first `fineMs` a fresh tilt flies at most `fineSpeed` (px per
     * step), picked up at `fineAccel` (px/s²); then `sideSpeed` and `sideAccel` take over. A bigger tilt skips it:
     * from `fineTilt` (deg), all fine, to `boostTilt`, full speed and acceleration straight away
     */
    fineSpeed: 2,
    fineAccel: 300,
    fineMs: 1000,
    fineTilt: 25,
    boostTilt: 35,
    /** how far the bird leans (deg) flying sideways at full speed */
    leanDeg: 20,
    /**
     * flapping tilted climbs in a straight line, not in steps: the wingbeats' lift is smoothed over this many ms
     * (higher = straighter, laggier) and gravity is cancelled
     */
    climbSmoothMs: 350,
    /** ...but this fraction of gravity is taken off the smoothed lift, so weak flaps don't climb (1 = as when level) */
    climbGravity: 0.6,
    /**
     * climbing tilted, the bird pitches its beak up along its flight path, at most this far (deg), scaled by its
     * sideways speed: none when slow, all of it at `sideSpeed`
     */
    climbPitchDeg: 50,
    /**
     * tilted or hovering (a T), a fall is braked by this fraction per physics step (gravity cancelled), so the bird
     * keeps its altitude
     */
    holdDrag: 0,
    /** tilted or hovering in the air, the wings beat this many times faster than the flap animation's normal fps */
    holdFlapRate: 2,
    /**
     * tilted while standing (ground, branch, shelf), the bird doesn't slide: it rises this many px and holds there,
     * flying sideways just above the floor
     */
    liftOffHeight: 12,
  },

  /**
   * "hover": both arms spread out and held still: at or above horizontal, a T or raised up to `maxRaise` (a V), each
   * arm straight; below horizontal, a roughly straight line through both arms, or both lowered by about the same
   * angle. Level or tilted. In flapping mode, in a T or higher the bird keeps its altitude (`tilt.holdDrag`); lowered,
   * it holds back less and less of gravity, so it sinks faster the lower the arms (`holdDroop` → `fallDroop`).
   * Tilted, it also flies sideways (and keeps its altitude). Posture control's T parachute sinks slowly instead,
   * using `sinkSpeed` and `parachuteDrag`.
   */
  hover: {
    /** arms below horizontal: how far the arm points may stray from a straight line (perpendicular RMS / along-line RMS) */
    maxBend: 0.2,
    /** arms below horizontal, not in a straight line: how much the two arms' angles may differ (deg) to count as lowered evenly */
    maxDroopDiff: 25,
    /** arms lowered on average up to this (deg below horizontal): still the full hold, the altitude kept */
    holdDroop: 10,
    /** ...lower, the hold fades (less of gravity cancelled), gone at this (deg below horizontal): a free fall */
    fallDroop: 60,
    /** arms tilted more than this (deg) aren't a spread */
    maxTilt: 40,
    /** arms above horizontal: the highest average raise (deg above horizontal) that still counts, a V */
    maxRaise: 50,
    /** arms above horizontal: each elbow at least this straight (deg, 180 = straight) */
    minElbowAngle: 120,
    /** arms moving faster than this (deg/s) are flapping, not spread */
    maxArmSpeed: 120,
    /** the pose must hold this long to start hovering... */
    enterMs: 150,
    /** ...and be gone this long to stop */
    exitMs: 150,
    /** posture control's T parachute: fall speed (px per physics step; normal free fall tops out around 7) */
    sinkSpeed: 1.5,
    /** posture control's T parachute: fraction of the fall speed above `sinkSpeed` braked away per physics step */
    parachuteDrag: 0.24,
  },

  /**
   * "posture" control, the alternative to the default flapping + tilt + hover (`flapping` off). Each arm's angle
   * above or below horizontal steers the bird directly:
   * - the higher arm, raised above horizontal, sets the speed (straight up = full speed)
   * - the other arm sets the direction: level → sideways towards it, as high as the speed arm → straight up,
   *   in between → diagonally; below horizontal → the lift is lost and the bird dives towards it, steeper the lower it is
   * - both arms level (a T) → parachute (as the hover: `hover.sinkSpeed`, `hover.parachuteDrag`)
   * - no arm above horizontal, one below → free fall, the momentum fades
   */
  posture: {
    /** on (default): flapping + tilt + hover. off: posture control */
    flapping: true,
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
    /** parachute: fraction of the sideways speed lost per physics step (on top of `airFriction`) */
    parachuteSideDrag: 0.01,
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
    /** fraction of the bird's sideways speed lost per physics step while sitting on a branch */
    branchFriction: 0.15,
  },

  keyboard: {
    /** lift (px/s²) while flap key held */
    lift: 1600,
    /** arm tilt (deg) that ← / → stand for: flying sideways that way */
    tilt: 35,
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
    /** the title screen's theme fades out over this when the game starts */
    themeFadeMs: 1500,
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

  /** a collected coin floats up this far (px) while fading out, in this long; a coin glows: a soft halo this wide (px), this strong (0–1) and of this hue (0–360°, 45 = gold), pulsing by this much (0–1) of its size and strength, once every `glowPulseMs` */
  coin: { 
    collectedRise: 50, 
    collectedMs: 400, 
    glowSize: 100, 
    glowAlpha: 0.2, 
    glowHue: 46, 
    glowPulse: 0.25, 
    glowPulseMs: 2900 
  },

  countdownMs: 2000,
  /** how much the game darkens (0–1) behind the "Pause", "Game Over" and "Hooray" signs, the calibration dialog and the countdown */
  signDim: 0.4,
  /** the darkening behind the calibration dialog fades in and out in this long (and behind "Pause" out on resume) */
  dimFadeMs: 300,
  gameOver: {
    /** the "Game Over" sign slides in from the left to the middle in this long (and out to the right at the end) */
    slideMs: 700,
    /** ...and the screen is shown this long (from the start of the drop) before a new game starts */
    showMs: 4000,
  },
  levelComplete: {
    /** play goes on this long after the last friend is saved (the bird blinking, unhurtable); then everything stops */
    graceMs: 2000,
    /** the "Hooray" sign slides in from the left to the middle in this long, with a fanfare (and out to the right at the end) */
    slideMs: 700,
    /** ...and the next level starts this long after everything stopped (the fanfare's length) */
    nextMs: 3000,
  },
};

export type Config = typeof config;

/** The built-in values, before any saved tuning is applied. */
const defaults: Config = structuredClone(config);

/** Only the values in `current` that differ from `base`, keeping the nesting; undefined if none do. */
function diffDeep(current: unknown, base: unknown): unknown {
  if (current && typeof current === 'object' && base && typeof base === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(current)) {
      const d = diffDeep(v, (base as Record<string, unknown>)[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return current === base ? undefined : current;
}

/** The tuned values that differ from the defaults. */
export function changedConfig(): Record<string, unknown> {
  return (diffDeep(config, defaults) as Record<string, unknown>) ?? {};
}

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
