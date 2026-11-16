export function basisArgs(o: { input: string; output: string; codec?: "etc1s" | "uastc"; linear?: boolean; normal?: boolean; q?: number }): string[];
export function encode(job: { in: string; out: string; codec?: "etc1s" | "uastc"; linear?: boolean; normal?: boolean; size?: number; q?: number }): {
  in: string;
  out: string;
  w: number;
  h: number;
  codec: string;
  srcKB: number;
  ktx2KB: number;
  gpuMB: { rgba8: number; desktop: number; phone: number };
};
