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
    /**
     * no good pose for less than this (ms; nobody found, or the frames did not come): the last controls keep
     * applying and nothing resets, so a dropped frame or a hitch of the camera goes unnoticed. Longer: the game
     * pauses softly (`visibility.personGoneAfterMs`) and the gesture detectors forget what they were doing.
     */
    holdLastMs: 400,
    /**
     * a wrist less visible than this is not trusted (MediaPipe guesses it hanging): with the elbow confident, the arm
     * points the way the shoulder → elbow line does instead (`WristGate`); with the elbow not confident either, the arm is out of view
     */
    minWristVisibility: 0.5,
    /** a wrist taken as a stand-in is trusted again at `minWristVisibility` plus this, so one hovering around the threshold does not flip */
    wristVisibilityMargin: 0.1,
    /**
     * the video is playing but no frame has been handled for this long (ms): the frame callbacks are taken to be dead
     * (the browser dropped them) and the loop is armed again (`FrameLoop`; counted in the debug panel as "rearm")
     */
    watchdogMs: 1000,
    /** a gap this long (ms) without a good pose resets the smoothing filters: the person may have moved a lot meanwhile */
    resetFiltersAfterMs: 500,
  },

  /** Local tracking telemetry (debug panel) and the black box (B): nothing of it leaves the device. */
  telemetry: {
    /** two pose frames with a person in both, further apart than this (ms), count as a hitch of the camera or the model */
    hitchMs: 100,
    /** a render frame (the interval between two ticks of the game's render loop) longer than this (ms) counts as a long one in the debug panel: 25 is one and a half 60 Hz frames; time paused, suspended or hidden does not count */
    longRenderMs: 25,
    /** the black box keeps this many seconds of the raw pose stream, to save with B (about 34 KB of memory per second). Change requires reload. */
    blackBoxSeconds: 60,
  },

  /**
   * One-Euro filter applied to landmark coordinates (lower minCutoff = smoother but laggier). `beta` opens the filter
   * up for fast movements (cutoff = minCutoff + beta * speed, speed in image heights per second). `armBeta` is the
   * one for the elbows, wrists and hands, which steer the bird: at 0.3 it barely opened (a wrist at 0.6 /s: 2.2 Hz
   * instead of 2), so a quick turn of the arms lagged like a slow one; 10 takes ~45 ms off every change of
   * direction on the recordings of play (tests/replay/recordings), mode flicker unchanged. The rest (hips, knees:
   * the shoot gesture) keeps `beta` 0.3: opened up too, their noise fires spurious poos.
   */
  smoothing: { minCutoff: 2.0, beta: 0.3, armBeta: 10, dCutoff: 1.0 },

  /**
   * One arm hidden behind the other (both pointing to one side turn the body sideways): MediaPipe loses the far
   * arm and guesses it hanging. The near arm then stands in for it (`ArmOcclusion`).
   */
  armOcclusion: {
    /** an arm (its less visible joint: elbow or wrist) at least this visible is seen; below, a stand-in may take over */
    confident: 0.7,
    /** ...and at or below this, the stand-in replaces it fully (blended in between) */
    hidden: 0.5,
    /** the near arm must be at least this visible to stand in */
    otherMin: 0.8,
    /** the arms must have been parallel within this (deg) when last both seen */
    parallelMax: 35,
  },

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
    /**
     * arms get longer, since hands briefly leave the frame at the top of a big flap. Kept at 800 on the replay evidence: with
     * the elbow really lost, 600 would cut the wrong controls before the pause from about 380 to 230 ms and 400 to about 60,
     * but a dip of the elbow's visibility with the position still right (v 0.5 for 600 ms) then costs a pause of 550 ms for
     * nothing, and there is no recording of flapping to say how far the elbow's visibility dips in a big flap. To revisit with field data.
     */
    armLostAfterMs: 800,
    /**
     * a lost part (or the torso's centre) must be back this long (ms) before it counts as visible again; the score's
     * smoothing (`emaAlpha`, `recoverAbove`) adds about 5 frames to it. 300 -> 150 shortens each soft pause by 130-280 ms
     * (replay: elbow v 0.5 for 1 s 542 -> 404 ms, recovery 537 -> 391 ms) and adds none.
     */
    recoverAfterMs: 150,
    noPersonAfterMs: 500,
    /**
     * nobody in view (nobody found, or the frames missing) for this long (ms): nobody counts as in front of the
     * camera and the calibration dialog comes up. Shorter gaps only pause the game softly ("Tracking lost", or the
     * out-of-frame box), with the calibration kept. Someone in view but off centre only pauses softly, however long.
     */
    personGoneAfterMs: 3000,
    /**
     * the torso's centre (between shoulders and hips) further than this (fraction of frame width) from the middle is
     * off centre: the player has wandered off, or the tracker has picked someone else in the room. 0.3: a player
     * leaning into a big sideways flight or stepping aside has the torso centre swing out; 0.25 made that count
     * as off centre too often, and it only pauses the game softly now.
     */
    maxOffCentre: 0.3,
    /** off centre this long: the game pauses softly (the "move to the middle" hint), for as long as it lasts */
    offCentreAfterMs: 600,
    /** while off centre, the pose tracker forgets who it follows and looks again, at most this often */
    redetectEveryMs: 1500,
    /** nose→hips height as fraction of frame height, below which we hint "come closer" */
    minUpperBodyHeight: 0.22,
  },

  calibration: {
    /** hold still in the outline this long */
    holdMs: 1200,
    /** max hip movement (fraction of torso length) during the hold */
    maxMovement: 0.08,
    /** require both hands raised above the shoulders and spread wider than them (an X), like the outline */
    requireArmsUp: true,
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
     * the wingbeats' lift is smoothed over this many ms (higher = straighter climbs, laggier), so the bird climbs in a
     * straight line, not in steps, and after the last flap the lift fades out, so the fall starts gently
     */
    liftSmoothMs: 350,
    /**
     * flapping bears the bird's weight: flapping hard enough (smoothed lift at least gravity), only this fraction of
     * gravity acts, more of it as the flapping fades out, so even weak flaps slow a fall
     */
    flappingGravity: 0.5,
    /** minimum peak-to-trough arm swing (deg) to count as a stroke (stats only) */
    strokeMinAmplitude: 25,
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
   * the bird sideways towards the lower hand, faster the more they're tilted. Up and down work as when level: the
   * arms held out keep the altitude (`hover`), flapping climbs (a little less of its lift going up: `sideLift`).
   */
  tilt: {
    /** EMA factor for the tilt per pose frame (lower = steadier through out-of-step flaps, laggier) */
    smoothing: 0.2,
    /** tilts within ±this (deg) count as level: no sideways flight */
    deadZone: 15,
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
    /** flapping at full tilt, this share of the lift goes up (1 = climbs as fast as flapping level) */
    sideLift: 0.75,
    /**
     * climbing tilted, the bird pitches its beak up along its flight path, at most this far (deg), scaled by its
     * sideways speed: none when slow, all of it at `sideSpeed`
     */
    climbPitchDeg: 50,
    /**
     * hovering (arms held out, a T, tilted or not), a fall is braked by this fraction per physics step (gravity
     * cancelled), so the bird keeps its altitude
     */
    holdDrag: 0,
    /**
     * hovering in the air (a T, tilted or not) or flapping, the wings beat this many times faster than the flap
     * animation's normal fps
     */
    holdFlapRate: 2,
    /**
     * tilted while standing (ground, branch, shelf; also a tilted T under pointing control), the bird doesn't slide: it
     * rises this many px and holds there, flying sideways just above the floor
     */
    liftOffHeight: 12,
    /**
     * flying just above the floor, a flap's lift (px/s²) must reach this to climb out of it; weaker lift (the flap
     * detector's noise while the arms are held tilted) is ignored, so it doesn't drop the bird back to the floor
     */
    liftOffFlap: 200,
  },

  /**
   * "hover": both arms spread out and held still: at or above horizontal, a T or raised up to `maxRaise` (a V), each
   * arm straight; below horizontal, a roughly straight line through both arms, or both lowered by about the same
   * angle. Level or tilted. In flapping mode, in a T or higher the bird keeps its altitude (`tilt.holdDrag`); lowered,
   * it holds back less and less of gravity, so it sinks faster the lower the arms (`holdDroop` → `fallDroop`).
   * Tilted, it also flies sideways.
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
    maxTilt: 60,
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
  },

  /**
   * "pointing" control, the default (`flapping` off); the alternative is flapping + tilt + hover. Arm directions are
   * shoulder → wrist, as seen on the screen:
   * - both arms hanging down → no force: the bird rests, or falls freely with its momentum fading
   * - both arms pointing the same way → the bird flies that way at `cruiseSpeed` (almost any direction)
   * - a T (arms spread out, roughly level) → hover: the bird keeps its place in the air
   * - a tilted T → the bird moves slowly (`driftSpeed`) sideways towards the lower hand, keeping its altitude
   * Pooping is the same as in flapping mode (`shoot`).
   */
  pointing: {
    /** off (default): pointing control. on: flapping + tilt + hover */
    flapping: false,
    /**
     * time constant (ms) of the smoothing of the arm directions, on top of the One-Euro filter (higher = steadier,
     * laggier). In ms, not per frame, so a slower camera doesn't make it laggier. 35: like an EMA factor of 0.7 at
     * 23 fps; the old 0.4 per frame (~95 ms at 23 fps) added ~60 ms of delay to every change of direction.
     */
    smoothingMs: 35,
    /** arms within this (deg) of straight down are hanging: rest */
    restCone: 35,
    /** T: each arm may be raised or lowered this much (deg) from level */
    tMaxArm: 65,
    /** T: the two arms' average may be raised or lowered this much (deg) from level (a shallow V or a droop) */
    tMaxRaise: 40,
    /** T: tilted less than this (deg, half the difference of the arms' angles) is a level T: hover; more: drift */
    tiltDeadZone: 15,
    /** once drifting, keeps drifting down to `tiltDeadZone` minus this (deg), so it doesn't flicker at the edge */
    tiltHysteresis: 5,
    /**
     * pointing: the two arms may differ in direction by up to this (deg) and still count as pointing together.
     * 40 -> 50: on the recordings of play 7-10% of the time the arms were 40-60 deg apart, matching no pose, and the
     * bird dropped to rest after `ambiguousMs`; at 50 it rests ~11-15% less and flies ~22-30% more, with no more
     * flicker, the flying direction a little less steady (the average of two arms further apart)
     */
    parallelMax: 50,
    /** a new pose must hold this long (ms) before the bird follows it (100 -> 60: ~20 ms faster, no more flicker on the recordings) */
    enterMs: 60,
    /** arms matching no pose keep the current one for this long (ms), then the bird rests */
    ambiguousMs: 400,
    /** flying speed while pointing, px per physics step */
    cruiseSpeed: 7,
    /** tilted T: sideways speed, px per physics step */
    driftSpeed: 1.8,
    /**
     * a tilted T with the arms lowered descends diagonally, towards the lower hand: the lower the arms (their
     * average below level), the faster it sinks; level ones keep the altitude as before, and a lowered T that is
     * not tilted still hovers. Off: a tilted T always keeps its altitude. On the recordings of play a lowered
     * tilted T was held for seconds (2026-11-09-gra-po-strojeniu) and next to never elsewhere
     */
    descend: true,
    /** the arms' average this far below level (deg) starts the descent, held `enterMs`... */
    descendEnter: 20,
    /** ...and it goes on until they are back above this (deg), so it doesn't flicker at the edge */
    descendExit: 15,
    /** sinking speed: none at `descendZero` deg below level, rising to `descendSpeed` (px per physics step) at `descendFull` */
    descendZero: 15,
    descendFull: 35,
    descendSpeed: 1.8,
    /** time constant (ms) of the sinking speed's changes, so starting or stopping the descent doesn't jolt */
    descendSmoothMs: 80,
    /**
     * how quickly the bird reaches its speed (or stops, in the hover), px/s². 2400: half the cruising speed in a new
     * direction after ~90 ms, a turn round in ~350 ms. 3600 felt abrupt in play: with Matter.js, 8-13 jolts per
     * minute (the speed changing more than 5 px per step within 100 ms) on the recordings of play, none at 2400;
     * 1800 lagged (a turn round ~470 ms)
     */
    accel: 2400,
    /** rest: fraction of the sideways and upward speed lost per physics step */
    restDrag: 0.08,
    /** Matter.js frictionAir while flying, hovering or drifting (rest: physics.birdAirFriction) */
    airFriction: 0.01,
    /** how far the bird leans (deg) flying sideways; a drift leans less */
    leanDeg: 25,
    /** wing flapping while flying, as a multiple of the flap animation's fps */
    flapRate: 1.4,
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
    /** he holds up what he'll throw this long before it leaves his hand (windup included): the player's warning */
    warnMs: 2000,
    /** ...fading in over this long */
    warnFadeMs: 300,
    /** ...and blinking this many times per second */
    warnBlinkHz: 3,
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

  /** bats fly along their routes and poo straight down; their poo hurts only the bird */
  bat: {
    /** time between poos is random within ± this fraction of the bat's `pooDelay` (set per bat in Tiled) */
    intervalSpread: 0.4,
    /** the bat's poo: collision radius (px), smaller than the bird's (physics.pooRadius) */
    pooRadius: 5,
    /** the bat's poo leaves it falling this fast (px per physics step), then gravity takes over */
    pooSpeed: 1,
    /** hit by the bird's poo: it hangs in the air in its "hit" pose this long... */
    hitShowMs: 300,
    /** ...then drops off the screen with this gravity (px per physics step²)... */
    fallGravity: 0.45,
    /** ...tumbling this many turns per second */
    fallSpin: 1.2,
    // a bat without a route homes in on the bird, round the level's bodies and keeping apart from the other bats:
    /** homing bat: size (px) of the grid cells it finds its way on (takes a reload) */
    homingCell: 16,
    /** homing bat: how far (px) beyond its wings it keeps from the level's bodies, the ground and the world's edges where it can */
    homingClearance: 16,
    /** homing bat: how often (ms) the way to the bird is worked out again */
    homingReplanMs: 250,
    /** homing bat: it keeps this far (px, centre to centre) from the other bats... */
    homingSeparation: 110,
    /** ...this keenly, against going for the bird (1) */
    homingSeparationWeight: 4,
    /** homing bat: how quickly it turns: the share of the way from its velocity to the one it wants, each physics step */
    homingTurn: 0.06,
    /** homing bat: its heading swings this far (radians) either way of the way to the bird, so it flies curvy, bat-like... */
    homingWander: 1.2,
    /** ...about this many times a second (each bat a little differently) */
    homingWanderHz: 0.2,
    /** homing bat: until it first sees the bird (nothing static in between, centre to centre) it flutters about where it started, this far (px) */
    homingIdleRadius: 40,
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
    /** between levels the music plays on at this fraction of its volume... */
    musicDucked: 1 / 3,
    /** ...and comes back up over this when the next level starts (it goes down over levelComplete.graceMs) */
    musicRestoreMs: 1500,
    /** the music fades out over this under the level-end fanfare, and back in over this after it */
    musicHushMs: 400,
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

  score: { villain: 1, bat: 1, pedestrian: -1 },

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

  /** a door blinks this long (ms) before its button wears off and it switches back, this many times a second; a button lasting less than `blinkMs` blinks for half its time, as many blinks, faster */
  button: { blinkMs: 2000, blinkHz: 4 },

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

const STORAGE_KEY = 'bird-revenge-config';

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
