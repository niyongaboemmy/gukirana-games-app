import type { BoxerGlb } from "./glb-read.mjs";
export function measureGlb(glb: BoxerGlb): {
  stature: number;
  headsTall: number;
  neckLengthPerH: number;
  neckGirth: number;
  waistGirth: number;
  hipGirth: number;
  waistToHip: number;
  [k: string]: number | number[];
};
