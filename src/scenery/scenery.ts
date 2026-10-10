/**
 * Background layout. Positions are in world pixels (1280 x 720).
 * Swap the images for real art any time; set `driftSpeed` to 0 for static clouds.
 */
export const scenery = {
  skyColor: '#eaf3f6',
  sun: { image: 'assets/scenery/sun.svg', x: 1110, y: 110, height: 150 },
  clouds: [
    { image: 'assets/scenery/cloud_0.svg', x: 220, y: 120, height: 100, driftSpeed: 6 },
    { image: 'assets/scenery/cloud_1.svg', x: 720, y: 70, height: 80, driftSpeed: 4 },
    { image: 'assets/scenery/cloud_0.svg', x: 1000, y: 260, height: 70, driftSpeed: 8 },
  ],
  ground: {
    image: 'assets/scenery/ground.svg',
    /** distance from the top of the ground image to the drawn ground line */
    surfaceOffset: 16,
  },
};

export function sceneryImages(): string[] {
  return [scenery.sun.image, scenery.ground.image, ...scenery.clouds.map((c) => c.image)];
}
