declare module 'poly-decomp' {
  type Polygon = [number, number][];
  const decomp: {
    quickDecomp(polygon: Polygon): Polygon[];
    makeCCW(polygon: Polygon): boolean;
    removeCollinearPoints(polygon: Polygon, precision?: number): number;
    removeDuplicatePoints(polygon: Polygon, precision?: number): void;
  };
  export default decomp;
}
