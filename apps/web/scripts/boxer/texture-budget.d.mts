export type GpuFormat = "rgba8" | "rgb8" | "bc7" | "astc4x4" | "etc2rgba" | "bc1" | "etc1" | "etc2rgb";
export type BasisCodec = "uastc" | "etc1s";
export const BYTES_PER_TEXEL: Record<GpuFormat, number>;
export function mipTexels(w: number, h: number, opts?: { mips?: boolean; block?: number }): number;
export function gpuBytes(w: number, h: number, format?: GpuFormat, mips?: boolean): number;
export function transcodeTarget(codec: BasisCodec, gpu: "desktop" | "phone"): GpuFormat;
export interface TexEntry {
  w: number;
  h: number;
  format?: GpuFormat;
  codec?: BasisCodec;
  mips?: boolean;
  name?: string;
}
export function budget(list: readonly TexEntry[], gpu?: "desktop" | "phone"): { bytes: number; mb: number; items: (TexEntry & { format: GpuFormat; bytes: number })[] };
