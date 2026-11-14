import { describe, expect, it } from "vitest";
import { buildHandMesh, makeSdf } from "./geometry";
import { BONE_COUNT, FINGER_DIMS, THUMB_DIMS } from "./rig";

describe("procedural hand mesh", () => {
  const t0 = performance.now();
  const m = buildHandMesh({ cell: 0.0024 });
  const ms = performance.now() - t0;

  it("is inside the hand at the palm and outside between the fingers", () => {
    const sdf = makeSdf();
    expect(sdf.d(0, 0.05, 0)).toBeLessThan(-0.005); // middle of the palm
    expect(sdf.d(FINGER_DIMS[1]!.knuckle[0], 0.16, 0)).toBeLessThan(0); // middle finger
    expect(sdf.d(0, 0.2, 0.05)).toBeGreaterThan(0); // above the hand
    expect(sdf.d(THUMB_DIMS.cmc[0] - 0.03, 0.06, -0.019)).toBeLessThan(0); // the thumb
    expect(sdf.d(0.002, 0.17, 0)).toBeGreaterThan(0); // gap between middle and ring tips
  });

  it("builds a dense, closed-looking skinned mesh quickly", () => {
    expect(m.vertexCount).toBeGreaterThan(5000);
    expect(m.index.length % 3).toBe(0);
    expect(ms).toBeLessThan(4000);
    for (let i = 0; i < m.index.length; i++) expect(m.index[i]!).toBeLessThan(m.vertexCount);
  });

  it("has normalised weights on valid bones", () => {
    for (let v = 0; v < m.vertexCount; v++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += m.skinWeight[v * 4 + k]!;
        expect(m.skinIndex[v * 4 + k]!).toBeLessThan(BONE_COUNT);
      }
      expect(Math.abs(s - 1)).toBeLessThan(1e-4);
    }
  });

  it("winds triangles outwards (face normals agree with the field gradient)", () => {
    const P = m.position, N = m.normal;
    let agree = 0;
    const tris = m.index.length / 3;
    for (let t = 0; t < tris; t++) {
      const a = m.index[t * 3]!, b = m.index[t * 3 + 1]!, c = m.index[t * 3 + 2]!;
      const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
      const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (fx * N[a * 3]! + fy * N[a * 3 + 1]! + fz * N[a * 3 + 2]! > 0) agree++;
    }
    expect(agree / tris).toBeGreaterThan(0.97);
  });

  it("marks nails on the back of the fingertips and the palm underneath", () => {
    let nails = 0, palms = 0, up = 0;
    for (let v = 0; v < m.vertexCount; v++) {
      if (m.region[v * 4 + 1]! > 128) {
        nails++;
        if (m.normal[v * 3 + 2]! > 0) up++; // nails face the back of the hand (the thumb's partly sideways)
      }
      if (m.region[v * 4]! > 200 && m.position[v * 3 + 1]! > 0.02 && m.position[v * 3 + 1]! < 0.08) palms++;
    }
    expect(nails).toBeGreaterThan(20);
    expect(up / nails).toBeGreaterThan(0.85);
    expect(palms).toBeGreaterThan(100);
  });
});
