import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fighterTriangles, readBoxerGlb, rigidInverseTranslation } from "../../../../../scripts/boxer/glb-read.mjs";
import { measureGlb } from "../../../../../scripts/boxer/measure-glb.mjs";

/**
 * P3-FGT-19B: the shipped-GLB audit (scripts/boxer/glb-read.mjs + measure-glb.mjs) the fighter-v8 harness scores
 * every build with. On the shipped v7 bodies it must reproduce the build-time audit of docs/FIGHT-REALISM-V7.md §2
 * and the 28.3k / 28.1k triangles of §9.
 */
const glbPath = (g: "m" | "f") => fileURLToPath(new URL(`../../../../../public/assets/characters/boxer-${g}.glb`, import.meta.url));

describe("shipped GLB audit", () => {
  it("inverts a rigid bind matrix", () => {
    // a rotation of 90° about y with world translation (1, 2, 3): its inverse bind matrix gives back (1, 2, 3)
    const R = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0];
    const t = [1, 2, 3];
    // inverse: Rᵀ, −Rᵀ t
    const Rt = [R[0]!, R[4]!, R[8]!, 0, R[1]!, R[5]!, R[9]!, 0, R[2]!, R[6]!, R[10]!, 0];
    const it = [-(Rt[0]! * t[0]! + Rt[4]! * t[1]! + Rt[8]! * t[2]!), -(Rt[1]! * t[0]! + Rt[5]! * t[1]! + Rt[9]! * t[2]!), -(Rt[2]! * t[0]! + Rt[6]! * t[1]! + Rt[10]! * t[2]!)];
    const p = rigidInverseTranslation([...Rt, ...it, 1]);
    expect(p[0]).toBeCloseTo(1);
    expect(p[1]).toBeCloseTo(2);
    expect(p[2]).toBeCloseTo(3);
  });

  it("measures the v7 bodies as the build did", () => {
    const m = measureGlb(readBoxerGlb(glbPath("m")));
    const f = measureGlb(readBoxerGlb(glbPath("f")));
    expect(m.stature).toBeCloseTo(1.757, 2);
    expect(m.waistToHip).toBeCloseTo(0.84, 2);
    expect(f.stature).toBeCloseTo(1.666, 2);
    expect(f.waistToHip).toBeCloseTo(0.7, 2);
    expect(f.neckLengthPerH).toBeCloseTo(0.053, 2);
  });

  it("counts one fighter's drawn triangles (the kit's body cull applied)", () => {
    const glb = readBoxerGlb(glbPath("m"));
    const t = fighterTriangles(glb);
    expect(t.total).toBeGreaterThan(27000);
    expect(t.total).toBeLessThan(29500);
    expect(t.byMesh.body).toBeLessThan(glb.meshes.get("body")!.index.length / 3);
    expect(fighterTriangles(glb, { headgear: false }).byMesh.kit_headgear).toBeUndefined();
  });
});
