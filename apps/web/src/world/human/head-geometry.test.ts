import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { smoothHeadNormals, tessellateHead, weldGroups } from "./head-geometry";

/** A closed octahedron with flat (faceted) normals and every corner split per face, like a hard-edged export. */
function facetedOctahedron(g: THREE.BufferGeometry = new THREE.OctahedronGeometry(1, 0)): THREE.BufferGeometry {
  // (polyhedron geometries are non-indexed with flat normals per face)
  const n = g.attributes.position!.count;
  const idx = Array.from({ length: n }, (_, i) => i);
  g.setIndex(idx);
  const si: number[] = [];
  const sw: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = g.attributes.position!.getY(i);
    // two bones: 0 below, 1 above
    si.push(0, 1, 0, 0);
    sw.push(1 - (y + 1) / 2, (y + 1) / 2, 0, 0);
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

describe("head geometry (P2-AVA-08)", () => {
  it("welds split vertices that share a position", () => {
    const g = facetedOctahedron();
    const w = weldGroups(g.attributes.position as THREE.BufferAttribute);
    expect(new Set(w).size).toBe(6); // 24 corners, 6 positions
  });

  it("smooths faceted normals across split vertices (closed surface)", () => {
    const g = facetedOctahedron();
    const changed = smoothHeadNormals(g, THREE.MathUtils.degToRad(120));
    expect(changed).toBeGreaterThan(0);
    const p = g.attributes.position!;
    const n = g.attributes.normal!;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      const nv = new THREE.Vector3().fromBufferAttribute(n, i);
      // on an octahedron the smooth normal at a corner points straight out of the corner
      expect(nv.dot(v)).toBeGreaterThan(0.999);
      expect(nv.length()).toBeCloseTo(1, 5);
    }
  });

  it("keeps creases sharper than the threshold and border normals as authored", () => {
    const g = facetedOctahedron();
    const before = Float32Array.from(g.attributes.normal!.array as Float32Array);
    // octahedron faces meet at ~109°: a 40° crease keeps every corner faceted
    expect(smoothHeadNormals(g, THREE.MathUtils.degToRad(40))).toBe(0);
    expect(Array.from(g.attributes.normal!.array as Float32Array)).toEqual(Array.from(before));
    // an open strip (one quad): every vertex is on the border → unchanged
    const q = new THREE.PlaneGeometry(1, 1, 1, 1);
    const n0 = Array.from(q.attributes.normal!.array as Float32Array);
    smoothHeadNormals(q);
    expect(Array.from(q.attributes.normal!.array as Float32Array)).toEqual(n0);
  });

  it("tessellates 1 → 4 triangles, keeps the original vertices, rounds the surface, no cracks", () => {
    const g = facetedOctahedron(new THREE.IcosahedronGeometry(1, 1));
    smoothHeadNormals(g, THREE.MathUtils.degToRad(60));
    const t = tessellateHead(g, 0.6);
    expect(t.index!.count / 3).toBe((g.index!.count / 3) * 4);
    const p0 = g.attributes.position!;
    const p1 = t.attributes.position!;
    for (let i = 0; i < p0.count; i++) expect(new THREE.Vector3().fromBufferAttribute(p1, i).distanceTo(new THREE.Vector3().fromBufferAttribute(p0, i))).toBe(0);
    // edge midpoints bulge outwards towards the sphere the normals describe (flat midpoints are at ≈ 0.95)
    let minR = Infinity;
    for (let i = p0.count; i < p1.count; i++) minR = Math.min(minR, new THREE.Vector3().fromBufferAttribute(p1, i).length());
    expect(minR).toBeGreaterThan(0.975);
    expect(minR).toBeLessThan(1.01);
    // split corners on either side of an edge get identical midpoints (welded positions + group normals)
    const w = weldGroups(p1 as THREE.BufferAttribute);
    let groups = 0;
    for (const x of w) groups = Math.max(groups, x + 1);
    expect(groups).toBe(42 + 120); // 42 corners + one per edge
  });

  it("interpolates skin weights (normalised, from both edge ends)", () => {
    const g = facetedOctahedron();
    const t = tessellateHead(g);
    const sw = t.attributes.skinWeight!;
    const si = t.attributes.skinIndex!;
    for (let i = 0; i < sw.count; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += sw.getComponent(i, k);
      expect(s).toBeCloseTo(1, 5);
    }
    // a midpoint between the top corner (all bone 1) and an equator corner (half / half) is 3/4 bone 1
    const p = t.attributes.position!;
    for (let i = g.attributes.position!.count; i < p.count; i++) {
      const y = p.getY(i);
      if (y > 0.4) {
        let w1 = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === 1) w1 += sw.getComponent(i, k);
        expect(w1).toBeCloseTo(0.75, 5);
      }
    }
  });
});
