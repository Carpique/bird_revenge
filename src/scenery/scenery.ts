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
   * Each level's time of day (`timeOfDay` in Tiled) colours the background. The sky: a gradient from `horizon` (at the
   * ground) up to `top` (at the world's top edge). `tint` darkens the clouds and the ground; `clouds` is their opacity.
   * `between`: more colours on the way, at 0 (top) .. 1 (horizon); `behindGround`: the colour behind the ground (which
   * lets it show through), `horizon` if not given. The sun shows in the afternoon; the moon and the stars at night, the moon where the sun would be.
   */
  timesOfDay: {
    morning: { horizon: '#fff3dc', top: '#6aa8e0', tint: '#ffffff', clouds: 1, sun: false, moon: false, stars: 0 },
    afternoon: {
      horizon: '#cde6f1', top: '#fffae6', tint: '#ffffff', clouds: 1, sun: true, moon: false, stars: 0,
      // warm and bright down to a bit below the sun, then evenly into blue
      between: [[0.37, '#fffae6']] as [number, string][],
      behindGround: '#eaf3f6',
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
