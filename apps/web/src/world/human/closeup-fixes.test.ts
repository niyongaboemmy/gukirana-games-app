import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HAT_CLEARANCE, HAT_MIN_CLEARANCE, hatClearance, KUFI_SNUG, strandRadius, swayWeight } from "./head-fit";
import { relaxNormals, smoothHeadNormals } from "./head-geometry";
import { HAIR_STYLES } from "../outfits";

/** P2-AVA-15 close-up defect pass: fitted kufi, real locs, smooth cheeks. */
describe("kufi fit (P2-AVA-15)", () => {
  it("sits snug on pressed strands: never more room than KUFI_SNUG, the other hats unchanged", () => {
    for (const h of HAIR_STYLES) {
      expect(hatClearance("kufi", h.id)).toBeLessThanOrEqual(KUFI_SNUG + 1e-9);
      expect(hatClearance("kufi", h.id)).toBeLessThanOrEqual(Math.max(HAT_CLEARANCE[h.id], HAT_MIN_CLEARANCE));
      expect(hatClearance("cap", h.id)).toBe(Math.max(HAT_CLEARANCE[h.id], HAT_MIN_CLEARANCE));
      expect(hatClearance("none", h.id)).toBe(HAT_CLEARANCE[h.id]);
    }
    expect(hatClearance("kufi", "locs")).toBeLessThan(HAT_CLEARANCE.locs);
  });

  it("never sinks a hat into a bald scalp", () => {
    for (const k of ["cap", "beanie", "bucket", "kufi", "wrap"] as const)
      expect(hatClearance(k, "bald")).toBeGreaterThanOrEqual(HAT_MIN_CLEARANCE);
  });
});

describe("loc / braid strand profile (P2-AVA-15)", () => {
  it("is narrower at the root, full in the length, tapered to a rounded tip", () => {
    for (const h of [0, 0.3, 0.77]) {
      const root = strandRadius(0, h, "loc");
      const mid = strandRadius(0.5, h, "loc");
      const tip = strandRadius(1, h, "loc");
      expect(root).toBeLessThan(mid);
      expect(tip).toBeLessThan(mid * 0.7);
      expect(tip).toBeGreaterThan(0.3);
    }
  });

  it("is irregular along a loc (never a constant-width plank) and smooth along a braid", () => {
    const loc = Array.from({ length: 20 }, (_, i) => strandRadius(0.2 + i * 0.03, 0.4, "loc"));
    const braid = Array.from({ length: 20 }, (_, i) => strandRadius(0.2 + i * 0.03, 0.4, "braid"));
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(loc)).toBeGreaterThan(0.08);
    expect(spread(braid)).toBeLessThan(spread(loc));
    // and two locs differ from each other
    expect(strandRadius(0.5, 0.1, "loc")).not.toBeCloseTo(strandRadius(0.5, 0.6, "loc"), 3);
  });

  it("sways only the free length: nothing at the root, most at the tip", () => {
    expect(swayWeight(0)).toBe(0);
    expect(swayWeight(0.1)).toBe(0);
    expect(swayWeight(0.5)).toBeGreaterThan(0);
    expect(swayWeight(1)).toBeCloseTo(1, 6);
    expect(swayWeight(0.9)).toBeGreaterThan(swayWeight(0.6));
  });
});

describe("head normals across soft splits (P2-AVA-15)", () => {
  const nrm = (g: THREE.BufferGeometry, i: number) =>
    new THREE.Vector3().fromBufferAttribute(g.attributes.normal as THREE.BufferAttribute, i);
  /** max angle between the normals of vertices sharing one position */
  function maxSplit(g: THREE.BufferGeometry): number {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const by = new Map<string, number[]>();
    for (let i = 0; i < pos.count; i++) {
      const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1e4)).join(",");
      by.set(k, [...(by.get(k) ?? []), i]);
    }
    let worst = 0;
    for (const ids of by.values())
      for (const i of ids) for (const j of ids) worst = Math.max(worst, nrm(g, i).angleTo(nrm(g, j)));
    return worst;
  }

  it("gives every duplicate of a soft split the same normal (no hard-edged light patch)", () => {
    // a closed, faceted surface: every position split per face, authored normals = face normals (~20° apart)
    const g = new THREE.IcosahedronGeometry(0.1, 1);
    g.computeVertexNormals();
    const old = g.clone();
    smoothHeadNormals(old, THREE.MathUtils.degToRad(30));
    expect(maxSplit(old)).toBeGreaterThan(0.05);
    smoothHeadNormals(g, THREE.MathUtils.degToRad(30), THREE.MathUtils.degToRad(40));
    expect(maxSplit(g)).toBeLessThan(1e-3);
  });

  it("keeps real creases (authored normals far apart: a cube's edges)", () => {
    const g = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    smoothHeadNormals(g, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(40));
    expect(maxSplit(g)).toBeGreaterThan(1.4);
  });

  it("relaxes a faceted normal field towards its neighbours, keeping real creases", () => {
    // a faceted closed surface (flat per-face normals, welded through relaxNormals' weld groups)
    const g = new THREE.IcosahedronGeometry(0.1, 2);
    g.computeVertexNormals();
    const before = maxSplit(g);
    const change = relaxNormals(g, 3, THREE.MathUtils.degToRad(40));
    expect(change).toBeGreaterThan(0);
    expect(maxSplit(g)).toBeLessThan(before);
    // every normal still points outwards
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++)
      expect(nrm(g, i).dot(new THREE.Vector3().fromBufferAttribute(pos, i).normalize())).toBeGreaterThan(0.9);
    const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    relaxNormals(box, 3, THREE.MathUtils.degToRad(40));
    expect(maxSplit(box)).toBeGreaterThan(1.4);
  });
});
