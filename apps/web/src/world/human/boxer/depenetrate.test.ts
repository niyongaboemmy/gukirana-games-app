import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { depenetrate } from "./depenetrate";

/** a flat patch of skin (slot 0, normal +z) and a garment layer over it, partly sunk under the skin */
function patch(garmentZ: (x: number) => number) {
  const p: number[] = [],
    nrm: number[] = [],
    mat: number[] = [],
    idx: number[] = [];
  let v = 0;
  for (const layer of [0, 1]) {
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const x = i * 0.01,
          y = j * 0.01;
        p.push(x, y, layer ? garmentZ(x) : 0);
        nrm.push(0, 0, 1);
        mat.push(layer ? 14 : 0);
      }
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 10; j++) {
        const a = v + i * 11 + j;
        idx.push(a, a + 11, a + 1, a + 1, a + 11, a + 12);
      }
    v += 121;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("_mat", new THREE.Float32BufferAttribute(mat, 1));
  g.setIndex(idx);
  return g;
}

describe("depenetrate", () => {
  it("pushes garment vertices under the skin out to the gap, leaves the rest alone", () => {
    const g = patch((x) => (x < 0.05 ? -0.01 : 0.006));
    const s = depenetrate(g, 0.002);
    expect(s.moved).toBe(55);
    expect(s.worstMm).toBe(12);
    const pos = g.getAttribute("position");
    for (let i = 121; i < 242; i++) {
      const x = pos.getX(i);
      expect(pos.getZ(i)).toBeCloseTo(x < 0.05 ? 0.002 : 0.006, 5);
    }
    // skin untouched
    for (let i = 0; i < 121; i++) expect(pos.getZ(i)).toBe(0);
  });

  it("leaves deep intersections (another body part) and undrawn skin alone", () => {
    const g = patch(() => -0.05);
    expect(depenetrate(g, 0.002, 0.06, 0.035).moved).toBe(0);
    // the skin dropped from the index (under a garment): nothing to push against
    const h = patch(() => -0.01);
    h.setIndex((h.index!.array as unknown as number[]).slice(600));
    expect(depenetrate(h).moved).toBe(0);
  });
});
