/** The part of PixiJS's `Ticker` the cap wraps. */
export interface UpdatableTicker {
  update(currentTime?: number): void;
}

/**
 * Caps how often `ticker` runs (and with it the render) to `fps`, by wrapping its `update`, which its animation frame
 * loop calls; returns the original `update`, to run a frame regardless of the cap.
 *
 * Not PixiJS's own `maxFPS`: it rounds the time since the last frame down to whole ms, so on a 120 Hz screen two
 * refreshes (16.66 ms) count as less than 1/60 s and it renders only every third one (40 fps, juddering).
 * Here a frame is due once a frame's worth of time (less 1 ms of leeway, for the refreshes' jitter) has built up
 * since the last one: 120 Hz gives exactly every other refresh, 144 Hz alternately every second and third (60 on
 * average), 60 Hz and below every one. A skipped call leaves the ticker as it was, so `deltaMS` spans the time
 * since the frame it last ran.
 */
export function capFrameRate(ticker: UpdatableTicker, fps: number): (currentTime?: number) => void {
  const update = ticker.update.bind(ticker);
  const frameMs = 1000 / fps;
  let budget = 0;
  let prev = NaN;
  ticker.update = (now = performance.now()) => {
    // the first call (or one after a pause, which builds up plenty) runs at once
    budget = Number.isNaN(prev) ? frameMs : budget + now - prev;
    prev = now;
    if (budget < frameMs - 1) return;
    budget -= frameMs;
    // after a hitch: no catching up with frames in quick succession
    if (budget > frameMs) budget = 0;
    update(now);
  };
  return update;
}
