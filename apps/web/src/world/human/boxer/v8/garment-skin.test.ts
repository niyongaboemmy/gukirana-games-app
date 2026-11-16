import { describe, expect, it } from "vitest";
import { closestOnTri, insideShare, signedDistances, transferWeights } from "../../../../../scripts/boxer/garment-skin.mjs";

/**
 * P3-FGT-19B: the separate-garment skinning stage (scripts/boxer/garment-skin.mjs). The "body" is a closed cylinder
 * (a limb) skinned to two bones with a linear blend along its height; a sleeve over it must inherit that blend, a
 * sleeve inside it must be reported as inside.
 */
function cylinder(r: number, h: number, rings = 12, seg = 24, caps = true) {
  const P: number[] = [];
  const tris: number[][] = [];
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      P.push(Math.cos(a) * r, (j / rings) * h, Math.sin(a) * r);
    }
  const id = (i: number, j: number) => j * seg + (i % seg);
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      tris.push([id(i, j), id(i, j + 1), id(i + 1, j)]);
      tris.push([id(i + 1, j), id(i, j + 1), id(i + 1, j + 1)]);
    }
  if (caps) {
    const b = P.length / 3;
    P.push(0, 0, 0, 0, h, 0);
    for (let i = 0; i < seg; i++) {
      tris.push([b, id(i, 0), id(i + 1, 0)]);
      tris.push([b + 1, id(i + 1, rings), id(i, rings)]);
    }
  }
  return { P, tris };
}

function skinnedLimb() {
  const { P, tris } = cylinder(0.05, 0.4);
  const n = P.length / 3;
  const J = new Uint16Array(n * 4),
    W = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, P[i * 3 + 1]! / 0.4));
    J[i * 4] = 3;
    W[i * 4] = 1 - t;
    J[i * 4 + 1] = 7;
    W[i * 4 + 1] = t;
  }
  return { P, tris, J, W };
}

describe("garment skinning", () => {
  it("finds the closest point on a triangle in every region", () => {
    const a = [0, 0, 0],
      b = [1, 0, 0],
      c = [0, 1, 0];
    const f = closestOnTri([0.2, 0.2, 1], a, b, c).q;
    expect(f[0]).toBeCloseTo(0.2);
    expect(f[1]).toBeCloseTo(0.2);
    expect(f[2]).toBeCloseTo(0);
    expect(closestOnTri([-1, -1, 0], a, b, c)).toMatchObject({ u: 1, v: 0, w: 0 });
    const e = closestOnTri([0.5, -2, 0], a, b, c);
    expect(e.w).toBe(0);
    expect(e.q[0]).toBeCloseTo(0.5);
    const h = closestOnTri([1, 1, 0], a, b, c);
    expect(h.q[0]).toBeCloseTo(0.5);
    expect(h.q[1]).toBeCloseTo(0.5);
  });

  it("transfers the body's blend to a sleeve worn over it", () => {
    const body = skinnedLimb();
    const sleeve = cylinder(0.058, 0.4, 8, 16, false);
    const r = transferWeights(body, sleeve.P, { faces: sleeve.tris, smoothIters: 1 });
    expect(r.unmatched).toBe(0);
    for (let i = 0; i < sleeve.P.length / 3; i++) {
      const t = sleeve.P[i * 3 + 1]! / 0.4;
      const w3 = r.J[i * 4] === 3 ? r.W[i * 4]! : r.J[i * 4 + 1] === 3 ? r.W[i * 4 + 1]! : 0;
      // the sleeve sits 8 mm off the skin; the blend follows the height (the caps pull the ends by a little)
      expect(Math.abs(w3 - (1 - t))).toBeLessThan(0.12);
      const sum = r.W[i * 4]! + r.W[i * 4 + 1]! + r.W[i * 4 + 2]! + r.W[i * 4 + 3]!;
      expect(sum).toBeCloseTo(1, 5);
      expect(r.dist[i]!).toBeLessThan(0.012);
    }
  });

  it("gives unmatched vertices their neighbours' weights", () => {
    const body = skinnedLimb();
    const sleeve = cylinder(0.058, 0.4, 8, 16, false);
    // push one ring of the sleeve far out (beyond maxDist): it must still end up skinned
    for (let i = 0; i < 16; i++) {
      sleeve.P[(4 * 16 + i) * 3]! *= 20;
      sleeve.P[(4 * 16 + i) * 3 + 2]! *= 20;
    }
    const r = transferWeights(body, sleeve.P, { faces: sleeve.tris, maxDist: 0.05 });
    expect(r.unmatched).toBe(16);
    for (let i = 4 * 16; i < 5 * 16; i++) expect(r.W[i * 4]! + r.W[i * 4 + 1]!).toBeCloseTo(1, 4);
  });

  it("reports a garment inside the skin and one outside it", () => {
    const body = skinnedLimb();
    const over = cylinder(0.056, 0.36, 6, 16, false);
    const under = cylinder(0.044, 0.36, 6, 16, false);
    for (const g of [over, under]) for (let i = 1; i < g.P.length; i += 3) g.P[i]! += 0.02;
    const so = insideShare(signedDistances(body, over.P));
    const su = insideShare(signedDistances(body, under.P));
    expect(so.share).toBe(0);
    expect(su.share).toBe(1);
    expect(su.worst).toBeGreaterThan(0.004);
  });
});
