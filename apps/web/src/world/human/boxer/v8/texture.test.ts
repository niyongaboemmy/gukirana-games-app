import { describe, expect, it } from "vitest";
import { budget, gpuBytes, mipTexels, transcodeTarget } from "../../../../../scripts/boxer/texture-budget.mjs";
import { basisArgs } from "../../../../../scripts/boxer/ktx2.mjs";
import { isKtx2 } from "./ktx2";

/** P3-FGT-19B: texture memory accounting and the KTX2 encode arguments */
describe("texture budget", () => {
  it("counts a full mip chain (4/3 of the base level)", () => {
    expect(mipTexels(2048, 2048) / (2048 * 2048)).toBeCloseTo(4 / 3, 3);
    expect(mipTexels(4, 2)).toBe(4 * 2 + 2 * 1 + 1);
    expect(mipTexels(256, 256, { mips: false })).toBe(65536);
  });
  it("rounds block formats up to whole 4x4 blocks", () => {
    // 2×2 and 1×1 mips each still take a whole block
    expect(gpuBytes(4, 4, "bc7")).toBe(16 * 3);
  });
  it("prices a 2K skin: RGBA8 21.3 MB, ETC1S 2.7 MB, UASTC 5.3 MB", () => {
    expect(gpuBytes(2048, 2048, "rgba8") / 1048576).toBeCloseTo(21.33, 1);
    expect(budget([{ w: 2048, h: 2048, codec: "etc1s" }], "desktop").mb).toBeCloseTo(2.67, 1);
    expect(budget([{ w: 2048, h: 2048, codec: "uastc" }], "phone").mb).toBeCloseTo(5.33, 1);
  });
  it("picks the GPU block format per platform", () => {
    expect(transcodeTarget("uastc", "desktop")).toBe("bc7");
    expect(transcodeTarget("uastc", "phone")).toBe("astc4x4");
    expect(transcodeTarget("etc1s", "phone")).toBe("etc2rgb");
  });
});

describe("ktx2 encode arguments", () => {
  it("encodes colour as ETC1S and normals as linear, renormalised UASTC", () => {
    const c = basisArgs({ input: "a.png", output: "a.ktx2" });
    expect(c).toEqual(expect.arrayContaining(["-ktx2", "-mipmap", "-etc1s"]));
    expect(c).not.toContain("-linear");
    const n = basisArgs({ input: "n.png", output: "n.ktx2", codec: "uastc", normal: true });
    expect(n).toEqual(expect.arrayContaining(["-uastc", "-linear", "-normal_map", "-mip_renorm"]));
  });
  it("recognises KTX2 URLs", () => {
    expect(isKtx2("/assets/characters/v8/skin-m.ktx2")).toBe(true);
    expect(isKtx2("/a.ktx2?v=2")).toBe(true);
    expect(isKtx2("/assets/characters/skin-m.webp")).toBe(false);
  });
});
