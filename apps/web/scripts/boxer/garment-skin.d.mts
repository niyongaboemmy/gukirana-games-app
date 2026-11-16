type V3 = readonly [number, number, number] | number[];
type Flat = ArrayLike<number>;
export interface TriHit {
  q: number[];
  u: number;
  v: number;
  w: number;
}
export interface TriGrid {
  cell: number;
  cells: Map<string, number[]>;
  P: Flat;
  tris: readonly (readonly number[])[];
}
export interface Body {
  P: Flat;
  tris: readonly (readonly number[])[];
  J: Flat;
  W: Flat;
}
export function closestOnTri(p: V3, a: V3, b: V3, c: V3): TriHit;
export function triGrid(P: Flat, tris: readonly (readonly number[])[], cell?: number): TriGrid;
export function closestSurface(grid: TriGrid, p: V3, maxR?: number): (TriHit & { t: number; d: number }) | null;
export function topN(m: Map<number, number>, n?: number): [number, number][];
export function transferWeights(
  body: Body,
  P: Flat,
  opts?: { maxDist?: number; smoothIters?: number; lambda?: number; faces?: readonly (readonly number[])[] | null; grid?: TriGrid; pin?: Map<number, Map<number, number>> },
): { J: Uint16Array; W: Float32Array; dist: Float32Array; unmatched: number };
export function vertexNormals(P: Flat, tris: readonly (readonly number[])[]): Float64Array;
export function signedDistances(body: Pick<Body, "P" | "tris">, P: Flat, opts?: { maxDist?: number; grid?: TriGrid | null; normals?: Float64Array | null }): Float32Array;
export function insideShare(sd: ArrayLike<number>, tol?: number): { share: number; inside: number; tested: number; worst: number };
