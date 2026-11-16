// P3-FGT-19B: GPU texture memory of the fighters' maps (docs/FIGHT-REALISM-V8.md §Textures) — what a texture costs
// once uploaded, by format, with its mip chain. Used by ktx2.mjs (the before / after table it prints) and by the
// fighter-v8 harness (qa/e2e/fighter-v8: texture MB per fighter). Pure: tested in world/human/boxer/v8/texture.test.ts.

/** bytes per texel on the GPU */
export const BYTES_PER_TEXEL = {
  rgba8: 4,
  rgb8: 4, // (drivers pad RGB to RGBA)
  // Basis UASTC transcodes to BC7 / ASTC 4×4 / ETC2 RGBA: 16 bytes per 4×4 block
  bc7: 1,
  astc4x4: 1,
  etc2rgba: 1,
  // Basis ETC1S (opaque) transcodes to BC1 / ETC1 / ETC2 RGB: 8 bytes per 4×4 block
  bc1: 0.5,
  etc1: 0.5,
  etc2rgb: 0.5,
};

/** total texels of a full mip chain down to 1×1 (block formats round each level up to whole 4×4 blocks) */
export function mipTexels(w, h, { mips = true, block = 1 } = {}) {
  let n = 0;
  let a = w,
    b = h;
  for (;;) {
    const bw = Math.ceil(a / block) * block,
      bh = Math.ceil(b / block) * block;
    n += bw * bh;
    if (!mips || (a === 1 && b === 1)) break;
    a = Math.max(1, a >> 1);
    b = Math.max(1, b >> 1);
  }
  return n;
}

/** GPU bytes of one texture */
export function gpuBytes(w, h, format = "rgba8", mips = true) {
  const bpt = BYTES_PER_TEXEL[format];
  if (bpt === undefined) throw new Error(`texture-budget: unknown format ${format}`);
  return Math.round(mipTexels(w, h, { mips, block: format.startsWith("rgb") ? 1 : 4 }) * bpt);
}

/** the block format a Basis file transcodes to on a desktop (BC) or phone (ASTC / ETC) GPU */
export function transcodeTarget(codec, gpu) {
  if (codec === "uastc") return gpu === "desktop" ? "bc7" : "astc4x4";
  if (codec === "etc1s") return gpu === "desktop" ? "bc1" : "etc2rgb";
  throw new Error(`texture-budget: unknown codec ${codec}`);
}

/**
 * Sum a texture list ({ w, h, format | codec, mips? }) for a GPU class → { bytes, mb, items }.
 * A `codec` entry (a KTX2 file) is costed as its transcode target on that GPU.
 */
export function budget(list, gpu = "desktop") {
  const items = list.map((t) => {
    const format = t.codec ? transcodeTarget(t.codec, gpu) : (t.format ?? "rgba8");
    const bytes = gpuBytes(t.w, t.h, format, t.mips !== false);
    return { ...t, format, bytes };
  });
  const bytes = items.reduce((n, t) => n + t.bytes, 0);
  return { bytes, mb: +(bytes / 1048576).toFixed(2), items };
}
