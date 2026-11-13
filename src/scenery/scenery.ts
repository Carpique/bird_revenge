/**
 * Background layout. Positions are in world pixels (1280 x 720).
 * Swap the images for real art any time; set `driftSpeed` to 0 for static clouds.
 * What's in the way of the bird (shelves, branches, crates) comes from the level (`src/levels/`).
 */
export const scenery = {
  skyColor: '#eaf3f6',
  sun: { image: 'assets/scenery/sun.svg', x: 960, y: 110, height: 150 },
  clouds: [
    { image: 'assets/scenery/cloud_0.svg', x: 220, y: 120, height: 100, driftSpeed: 6 },
    { image: 'assets/scenery/cloud_1.svg', x: 720, y: 70, height: 80, driftSpeed: 4 },
    { image: 'assets/scenery/cloud_0.svg', x: 1000, y: 260, height: 70, driftSpeed: 8 },
  ],
  /**
   * A distant, hazy layer of clouds at the world's top edge, where the bird can't fly higher, and thinner wisps in
   * the sky above it; seen when the screen is taller than 16:9. Each band scatters `count` soft clouds across the
   * screen: `y` from..to (most near the first), `width` and `height` from..to, `alpha` from..to. The first band
   * marks the limit: nearly closed, with a small gap here and there.
   */
  haze: [
    { count: 11, y: [-45, -80], width: [240, 460], height: [50, 90], alpha: [0.45, 0.75], driftSpeed: 5 },
    { count: 12, y: [-120, -700], width: [160, 380], height: [28, 60], alpha: [0.2, 0.45], driftSpeed: 2.5 },
  ] as { count: number; y: [number, number]; width: [number, number]; height: [number, number]; alpha: [number, number]; driftSpeed: number }[],
  /**
   * Each level's time of day (`timeOfDay` in Tiled) colours the background. The sky: a gradient from `horizon` (at the
   * ground) up to `top` (at the world's top edge). `tint` darkens the clouds and the ground; `clouds` is the clouds' opacity.
   * `between`: more colours on the way, at 0 (top) .. 1 (horizon); `behindGround`: the colour behind the ground (which
   * lets it show through), `horizon` if not given. The sun shows in the afternoon; the moon and the stars at night, the moon where the sun would be.
   */
  timesOfDay: {
    morning: { horizon: '#fff3dc', top: '#6aa8e0', tint: '#ffffff', clouds: 1, sun: false, moon: false, stars: 0 },
    afternoon: {
      horizon: '#acd4ec', top: '#d8edf8', tint: '#ffffff', clouds: 1, sun: true, moon: false, stars: 0,
      // light blue at the very top, the main blue from a fifth of the way down, darkening towards the ground
      between: [[0.19, '#badcef'], [0.65, '#badcef']] as [number, string][],
      behindGround: '#edf2ea',
    },
    evening: { horizon: '#8877b4', top: '#2a3a9a', tint: '#b1aac8', clouds: 0.8, sun: false, moon: false, stars: 0 },
    night: { horizon: '#2e418d', top: '#19276b', tint: '#6876a3', clouds: 0.45, sun: false, moon: true, stars: 140 },
  },
  moon: { height: 110, color: '#f4f1de', glow: '#c9d6ff' },
  ground: {
    image: 'assets/scenery/ground.svg',
    /** distance from the top of the ground image to the drawn ground line */
    surfaceOffset: 16,
  },
};

export function sceneryImages(): string[] {
  return [scenery.sun.image, scenery.ground.image, ...scenery.clouds.map((c) => c.image)];
}
