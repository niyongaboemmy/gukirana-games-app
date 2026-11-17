import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CORR_W, type BoxerUniforms } from "./boxer-material";
import { corrSetup, driveCorrectives, type CorrData } from "./corrective";

/** a two-bone rig per limb name and a data set with two arm / leg states (rest-ish and a 1 rad turn) */
function fixture() {
  const bones = new Map<string, THREE.Bone>();
  const bone = (n: string) => {
    if (!bones.has(n)) bones.set(n, new THREE.Bone());
    return bones.get(n)!;
  };
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1);
  const turned = [q1.x, q1.y, q1.z, q1.w];
  const id = [0, 0, 0, 1];
  const f = (q: number[]) => ({ armL: q, armR: q, legL: q, legR: q });
  const delta = new Int16Array(2 * 2 * 3);
  delta.set([0, 0, 100], 0); // row 0 (vest), state 0: +1 cm z
  delta.set([0, 0, 300], 3); // row 0, state 1: +3 cm z
  const data: CorrData = {
    version: 2,
    parts: { kit_vest: 4 },
    bones: { arm: ["Bip01_{S}_UpperArm"], leg: ["Bip01_{S}_Thigh"] },
    rows: [
      ["kit_vest", 1, 255, 255],
      ["kit_vest", 2, 0, 0],
    ],
    armStates: [
      { id: "a", f: f(id) },
      { id: "b", f: f(turned) },
    ],
    legStates: [{ id: "a", f: f(id) }],
    n: 2,
    scale: 0.0001,
    delta: Buffer.from(delta.buffer).toString("base64"),
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
  const offsets = new Map<string, [number, number]>([
    ["body", [0, 2]],
    ["kit_vest", [2, 4]],
  ]);
  return { bone, bones, data, geo, offsets, q1 };
}
const uniforms = () => ({ uCorrN: { value: 0 }, uCw: { value: Array.from({ length: 128 }, () => new THREE.Vector4()) } }) as unknown as BoxerUniforms;

describe("garment pose correctives (P3-FGT-19B)", () => {
  it("maps rows onto the part's vertices and packs side, group, arm mask and deltas", () => {
    const { bone, data, geo, offsets } = fixture();
    const rig = corrSetup(geo, offsets, data, bone)!;
    expect(rig.n).toBe(2);
    const row = geo.getAttribute("_crow")!;
    expect([row.getX(0), row.getX(2), row.getX(3), row.getX(4)]).toEqual([-1, -1, 0, 1]);
    const t = rig.texture.image.data as Float32Array;
    expect(rig.texture.image.width).toBe(CORR_W);
    expect([t[0], t[1], t[2]]).toEqual([1, 0, 1]); // row 0 meta: left, singlet, unmasked
    expect(t[4 + 2]).toBeCloseTo(0.01, 6); // row 0, state 0: 1 cm
    expect(t[8 + 2]).toBeCloseTo(0.03, 6); // row 0, state 1: 3 cm
    expect(t[3 * 4 + 2]).toBe(0); // row 1 meta: arm mask 0
  });

  it("refuses data baked for other garment meshes", () => {
    const { bone, data, geo } = fixture();
    expect(corrSetup(geo, new Map([["kit_vest", [2, 5]]]), data, bone)).toBeNull();
    expect(corrSetup(geo, new Map([["kit_vest", [2, 4]]]), { ...data, version: 1 }, bone)).toBeNull();
  });

  it("an exact state takes (almost) all of its limb's weight; a far pose fades to none", () => {
    const { bone, bones, data, geo, offsets, q1 } = fixture();
    const rig = corrSetup(geo, offsets, data, bone)!;
    const u = uniforms();
    bones.get("Bip01_L_UpperArm")!.quaternion.copy(q1);
    driveCorrectives(rig, u);
    expect(u.uCorrN.value).toBe(2);
    expect(u.uCw.value[1]!.x).toBeGreaterThan(0.99);
    // far from both states (and from the rest pose): no correction
    bones.get("Bip01_L_UpperArm")!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 2.5);
    driveCorrectives(rig, u);
    expect(u.uCw.value[0]!.x + u.uCw.value[1]!.x).toBeLessThan(0.01);
    driveCorrectives(rig, u, false);
    expect(u.uCorrN.value).toBe(0);
  });
});
