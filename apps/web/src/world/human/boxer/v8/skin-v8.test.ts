import { describe, expect, it } from "vitest";
import { dualLobe, GK_SKIN_V8_GLSL, shadowScatter, skinDiffuse, wrapDiffuse } from "./skin-v8";

/** ∫_{-1}^{1} g(x) dx (midpoint rule) */
const integ = (g: (x: number) => number, n = 20000) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += g(-1 + ((i + 0.5) / n) * 2);
  return (s * 2) / n;
};

describe("skin v8 shading maths", () => {
  it("is Lambert on a flat surface", () => {
    for (const x of [-0.5, 0, 0.3, 0.8, 1]) expect(skinDiffuse(x, 0)).toEqual([Math.max(0, x), Math.max(0, x), Math.max(0, x)].map((v) => expect.closeTo(v, 6)));
  });
  it("conserves Lambert's energy at any wrap", () => {
    const lambert = integ((x) => Math.max(0, x));
    for (const w of [0.1, 0.25, 0.5, 1]) expect(integ((x) => wrapDiffuse(x, w))).toBeCloseTo(lambert, 3);
  });
  it("wraps red furthest past the terminator where the surface curves", () => {
    const [r, g, b] = skinDiffuse(-0.05, 1);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(skinDiffuse(-0.05, 0)[0]).toBe(0);
    // and never brighter than Lambert facing the light
    expect(skinDiffuse(1, 1)[0]).toBeLessThanOrEqual(1);
  });
  it("tints the shadow edge red and leaves full light and full shadow alone", () => {
    expect(shadowScatter(0)).toEqual([0, 0, 0]);
    expect(shadowScatter(1)).toEqual([1, 1, 1]);
    const [r, g, b] = shadowScatter(0.4);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(shadowScatter(0.4, 0)).toEqual([0.4, 0.4, 0.4].map((v) => expect.closeTo(v, 9)));
  });
  it("splits roughness into a sharp and a broad lobe", () => {
    const l = dualLobe(0.5);
    expect(l.sharp).toBeLessThan(0.5);
    expect(l.broad).toBeGreaterThan(0.5);
    expect(l.mix).toBeGreaterThan(0);
    expect(dualLobe(0).sharp).toBeGreaterThan(0);
  });
  it("puts the same constants in the GLSL", () => {
    expect(GK_SKIN_V8_GLSL).toContain("gkSkinDiffuse");
    expect(GK_SKIN_V8_GLSL).toContain("0.5000, 0.2000, 0.1200");
  });
});
