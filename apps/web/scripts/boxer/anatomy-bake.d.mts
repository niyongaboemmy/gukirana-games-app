export function neighbours(n: number, faces: readonly (readonly number[])[]): Set<number>[];
export function laplace(P: ArrayLike<number>, nb: readonly Set<number>[], verts: Iterable<number>, iters: number, lam?: number): Float64Array;
export function vertexNormals(P: ArrayLike<number>, faces: readonly (readonly number[])[], n: number): Float64Array;
export function bandHeight(P: ArrayLike<number>, faces: readonly (readonly number[])[], verts: Iterable<number>, n: number, opts?: { fine?: number; coarse?: number }): Float64Array;
export function bakeDetail(opts: {
  tris: readonly (readonly [number, number])[][];
  uvOf: (k: number) => readonly number[];
  P: ArrayLike<number>;
  H: ArrayLike<number>;
  mask?: (v: number) => number;
  size?: number;
  blur?: number;
  gain?: number;
  cavityGain?: number;
}): { rgba: Uint8Array; size: number; coverage: Uint8Array };
export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array;
