import { describe, expect, it } from "vitest";
import { bakeDetail, bandHeight, encodePng } from "../../../../scripts/boxer/anatomy-bake.mjs";

/**
 * P3-FGT-17: the anatomy detail bake (scripts/boxer/anatomy-bake.mjs) — a flat grid with a groove across it, mapped
 * 1:1 onto the uv square: the band-pass finds the groove (negative height), the baked normal tilts on both sides of it
 * in opposite directions along u (and stays flat along v), the cavity darkens it, and a flat surface bakes flat.
 */
function grid(n: number, depth: number) {
  const P: number[] = [];
  const faces: number[][] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      // a 2 cm-wide groove down the middle (along v), `depth` deep (z), on a 0.3 m square
      const z = -depth * Math.exp(-((((u - 0.5) * 0.3) / 0.01) ** 2));
      P.push(u * 0.3, (j / n) * 0.3, z);
    }
  const id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
  const tris = faces.flatMap((f) => [
    [f[0]!, f[1]!, f[2]!],
    [f[0]!, f[2]!, f[3]!],
  ]).map((t) => t.map((v) => [v, v] as [number, number]));
  const uvOf = (k: number) => [(k % (n + 1)) / n, Math.floor(k / (n + 1)) / n];
  return { P: Float64Array.from(P), faces, tris, uvOf, nv: (n + 1) ** 2 };
}

describe("anatomy bake", () => {
  it("finds a groove as negative band-passed height and leaves a flat surface at zero", () => {
    const g = grid(40, 0.006);
    const verts = Array.from({ length: g.nv }, (_, i) => i);
    const H = bandHeight(g.P, g.faces, verts, g.nv, { fine: 0, coarse: 10 });
    const mid = 20 * 41 + 20;
    expect(H[mid]).toBeLessThan(-0.001);
    const flat = grid(40, 0);
    const H0 = bandHeight(flat.P, flat.faces, verts, flat.nv, { fine: 0, coarse: 10 });
    expect(Math.max(...Array.from(H0, Math.abs))).toBeLessThan(1e-9);
  });

  it("bakes opposite normal tilts on the two walls of the groove, a darker cavity, and flat elsewhere", () => {
    const g = grid(40, 0.006);
    const verts = Array.from({ length: g.nv }, (_, i) => i);
    const H = bandHeight(g.P, g.faces, verts, g.nv, { fine: 0, coarse: 10 });
    const { rgba, size } = bakeDetail({ tris: g.tris, uvOf: g.uvOf, P: g.P, H, size: 128, blur: 1, cavityGain: 160 });
    const px = (u: number, v: number) => {
      const x = Math.round(u * size - 0.5), y = Math.round(v * size - 0.5);
      const k = (y * size + x) * 4;
      return [rgba[k]!, rgba[k + 1]!, rgba[k + 2]!] as const;
    };
    const left = px(0.46, 0.5), right = px(0.54, 0.5), centre = px(0.5, 0.5), far = px(0.15, 0.5);
    // the wall going down (u < 0.5): the surface faces +u → detail normal x > 0; the wall coming up: x < 0
    expect(left[0]).toBeGreaterThan(140);
    expect(right[0]).toBeLessThan(116);
    // nothing along v (the groove runs along v)
    expect(Math.abs(left[1] - 128)).toBeLessThan(6);
    // cavity darker in the groove, about neutral away from it
    expect(centre[2]).toBeLessThan(far[2] - 10);
    expect(Math.abs(far[0] - 128)).toBeLessThan(6);
  });

  it("writes a valid PNG", () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
