export interface GlbMesh {
  P: Float32Array;
  index: Uint16Array | Uint32Array;
  J: Uint8Array | Uint16Array | null;
  W: Float32Array | null;
  attrs: Record<string, ArrayLike<number>>;
}
export interface BoxerGlb {
  meshes: Map<string, GlbMesh>;
  joints: { name: string; pos: number[] }[];
  extras: Record<string, unknown>;
  json: unknown;
}
export function parseGlb(buf: Uint8Array | ArrayBuffer): { json: unknown; bin: Uint8Array | null; accessor(i: number, o?: { float?: boolean }): ArrayLike<number> };
export function rigidInverseTranslation(m: ArrayLike<number>, o?: number): number[];
export function readBoxerGlb(path: string): BoxerGlb;
export const COVER: Record<string, number>;
export const BOXER_MESHES: string[];
export function fighterTriangles(glb: BoxerGlb, opts?: { headgear?: boolean; meshes?: string[] }): { total: number; byMesh: Record<string, number> };
