/** One landmark in normalised image coordinates (0..1, NOT mirrored) plus MediaPipe visibility. */
export interface Landmark {
  x: number;
  y: number;
  v: number;
  /** MediaPipe's depth (smaller: nearer the camera), where a recording of the raw stream has it (`BlackBox`); unused by the detectors */
  z?: number;
}

export interface PoseFrame {
  /**
   * ms, `performance.now()` timebase: the frame's own time (`FrameClock`: the camera's clock mapped onto the page's,
   * the earliest the frame could have arrived), not when the callback or the model happened to run. The one time the
   * model, the smoothing, the detectors, the session and the recordings all use for this frame.
   */
  t: number;
  /** 33 smoothed landmarks */
  lm: Landmark[];
  /** video width / height, so angles can be computed in an undistorted space */
  aspect: number;
}
