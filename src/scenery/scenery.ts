/** A branch the bird can sit on: its top edge, from where it leaves the trunk to its tip (world px). */
export interface Branch {
  from: [number, number];
  to: [number, number];
}

export interface Tree {
  image: string;
  /** top-left corner of the image in the world; the image is drawn 1:1 */
  left: number;
  top: number;
  width: number;
  height: number;
  /** trunk centre line and width at the ground; it tapers up to `trunkTop` */
  trunkX: number;
  trunkWidth: number;
  trunkTop: number;
  /** leafy crown around the top of the trunk, as circles [x, y, diameter] */
  crown: [number, number, number][];
  branches: Branch[];
}

/**
 * Background layout. Positions are in world pixels (1280 x 720).
 * Swap the images for real art any time; set `driftSpeed` to 0 for static clouds.
 * Keep this file free of imports: the art generator (`npm run art`) loads it directly with Node.
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
   * A tree on each side, almost up to the clouds. The bird can perch on the branches (landing from above);
   * the lowest ones are well above the villain's head (ground 640, villain 130 tall).
   * The tree images are generated from this data by `npm run art`, so rerun it after changing the trees.
   */
  trees: [
    {
      image: 'assets/scenery/tree_left.svg',
      left: 0, top: 10, width: 300, height: 650,
      trunkX: 46, trunkWidth: 56, trunkTop: 170,
      crown: [[10, 200, 130], [70, 225, 90], [140, 205, 100], [190, 175, 80], [120, 150, 120], [40, 130, 130], [90, 95, 100], [20, 75, 80]],
      branches: [
        { from: [66, 450], to: [250, 436] },
        { from: [62, 362], to: [220, 346] },
        { from: [60, 280], to: [190, 266] },
      ],
    },
    {
      image: 'assets/scenery/tree_right.svg',
      left: 980, top: 10, width: 300, height: 650,
      trunkX: 1234, trunkWidth: 56, trunkTop: 170,
      crown: [[1270, 210, 130], [1205, 240, 90], [1140, 220, 100], [1090, 190, 80], [1160, 160, 120], [1240, 140, 130], [1190, 105, 100], [1260, 80, 80]],
      branches: [
        { from: [1214, 468], to: [1040, 454] },
        { from: [1218, 384], to: [1070, 368] },
        { from: [1220, 300], to: [1095, 286] },
      ],
    },
  ] as Tree[],
  ground: {
    image: 'assets/scenery/ground.svg',
    /** distance from the top of the ground image to the drawn ground line */
    surfaceOffset: 16,
  },
};

export function sceneryImages(): string[] {
  return [scenery.sun.image, scenery.ground.image, ...scenery.clouds.map((c) => c.image), ...scenery.trees.map((t) => t.image)];
}
