import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { shoulderShare, weightBytes } from "../../../../scripts/boxer/skin-math.mjs";
import { depth, pushOut, torsoAt, type TorsoSlices } from "../boxing/rig";
import { twistOf } from "./helpers";
import { probeBody } from "./skin-probe.dev";
import { BOXER_V8 } from "./generation";
import type { BoxingClipName } from "../boxing/clips";

/**
 * P3-FGT-14: the boxer bodies' skinning and the rig maths that keep the arms on the body (docs/FIGHT-REALISM-V4.md §1).
 */
// (P3-FGT-19B: with the v8 fighters on, the clips are the v8 ones: they are checked on the v8 bodies)
const asset = (n: string) => fileURLToPath(new URL(`../../../../public/assets/characters/${BOXER_V8 && /^boxer-[mf]$/.test(n) ? "v8/" : ""}${n}.glb`, import.meta.url));

/** a minimal reader of our own (uncompressed) GLB: joints, skin, the body mesh's skin attributes */
function readGlb(path: string) {
  const buf = readFileSync(path);
  const jlen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString("utf8"));
  const bin = 20 + jlen + 8;
  const acc = (i: number) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type]!;
    const C = a.componentType === 5126 ? Float32Array : a.componentType === 5121 ? Uint8Array : a.componentType === 5123 ? Uint16Array : Uint32Array;
    const start = buf.byteOffset + bin + (bv.byteOffset ?? 0);
    return new C(buf.buffer.slice(start, start + a.count * n * C.BYTES_PER_ELEMENT));
  };
  const joints: number[] = json.skins[0].joints;
  const names = joints.map((n) => json.nodes[n].name as string);
  const parentOf = new Map<string, string>();
  json.nodes.forEach((n: { name: string; children?: number[] }) => n.children?.forEach((c) => parentOf.set(json.nodes[c].name, n.name)));
  const ibm = acc(json.skins[0].inverseBindMatrices) as Float32Array;
  const bindPos = (name: string) => {
    const k = names.indexOf(name);
    const m = new THREE.Matrix4().fromArray(Array.from(ibm.subarray(k * 16, k * 16 + 16))).invert();
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  const meshes = (json.meshes as { name: string; primitives: { attributes: Record<string, number> }[] }[]).map((m) => ({
    name: m.name,
    pos: acc(m.primitives[0]!.attributes.POSITION!) as Float32Array,
    j: acc(m.primitives[0]!.attributes.JOINTS_0!) as Uint8Array,
    w: acc(m.primitives[0]!.attributes.WEIGHTS_0!) as Uint8Array,
  }));
  return { names, parentOf, bindPos, meshes, extras: json.scenes[0].extras };
}

describe("skin maths (build)", () => {
  const j = [0.2, 1.4, 0.02];
  it("the shoulder corrective is full on the deltoid cap, none on the collarbone / pec, fades with distance", () => {
    expect(shoulderShare([0.22, 1.45, 0.02], j, 0.7)).toBeCloseTo(1, 2);
    expect(shoulderShare([0.06, 1.42, 0.08], j, 0.1)).toBe(0);
    expect(shoulderShare([0.2, 1.2, 0.02], j, 0.7)).toBe(0);
    const near = shoulderShare([0.21, 1.33, 0.02], j, 0.6);
    const far = shoulderShare([0.21, 1.27, 0.02], j, 0.6);
    expect(near).toBeGreaterThan(far);
  });
  it("under the joint it needs the arm's pull (the torso's side keeps its chest weights)", () => {
    expect(shoulderShare([0.2, 1.33, -0.02], j, 0)).toBe(0);
    expect(shoulderShare([0.2, 1.33, -0.02], j, 0.5)).toBeGreaterThan(0.3);
    // over the joint the top of the shoulder follows regardless
    expect(shoulderShare([0.19, 1.47, 0.0], j, 0)).toBeGreaterThan(0.5);
  });
  it("weight bytes always sum to 255 (normalised), the rounding error on the largest weight", () => {
    for (const w of [
      [0.5, 0.5, 0, 0],
      [0.333, 0.333, 0.334, 0],
      [0.26, 0.25, 0.25, 0.24],
      [1, 0, 0, 0],
      [0.9971, 0.0029, 0, 0],
    ]) {
      const q = weightBytes(w);
      expect(q.reduce((a, b) => a + b, 0)).toBe(255);
      expect(q.every((x) => x >= 0 && x <= 255)).toBe(true);
    }
    expect(weightBytes([0.26, 0.25, 0.25, 0.24])[0]).toBeGreaterThanOrEqual(64);
  });
});

describe("rig maths: torso keep-out, forearm twist", () => {
  const T: TorsoSlices = [
    [-0.2, 0.15, 0.18, -0.02],
    [0, 0.17, 0.19, -0.04],
    [0.2, 0.09, 0.1, 0.02],
  ];
  it("interpolates the slices and is empty above / below", () => {
    expect(torsoAt(T, -0.1)!.hw).toBeCloseTo(0.16, 5);
    expect(torsoAt(T, 0.3)).toBeNull();
    expect(torsoAt(T, -0.3)).toBeNull();
  });
  it("a point in the chest is inside, pushOut puts it on the inflated surface in front", () => {
    const p = new THREE.Vector3(0.02, 0, 0.12);
    expect(depth(T, p, 0.05)).toBeGreaterThan(0);
    expect(pushOut(T, p, 0.05)).toBe(true);
    expect(Math.abs(depth(T, p, 0.05))).toBeLessThan(1e-6);
    expect(p.z).toBeGreaterThan(0.19);
    const out = new THREE.Vector3(0, 0, 0.4);
    expect(pushOut(T, out, 0.05)).toBe(false);
    expect(out.z).toBe(0.4);
  });
  it("twistOf keeps only the roll about the axis", () => {
    const axis = new THREE.Vector3(1, 0, 0);
    const roll = new THREE.Quaternion().setFromAxisAngle(axis, 0.8);
    const swing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6);
    const q = swing.clone().multiply(roll);
    const t = twistOf(q, axis, new THREE.Quaternion());
    expect(2 * Math.acos(Math.min(1, Math.abs(t.w)))).toBeCloseTo(0.8, 3);
    expect(Math.hypot(t.y, t.z)).toBeLessThan(1e-6);
    expect(twistOf(swing, axis, new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });
});

describe.each(["m", "f"] as const)("boxer-%s.glb skinning", (g) => {
  const glb = readGlb(asset(`boxer-${g}`));
  it("every vertex of every part is fully weighted to valid bones (no zero / partial weights)", () => {
    for (const m of glb.meshes) {
      for (let v = 0; v < m.w.length / 4; v++) {
        const s = m.w[v * 4]! + m.w[v * 4 + 1]! + m.w[v * 4 + 2]! + m.w[v * 4 + 3]!;
        expect(s, `${m.name} vertex ${v}`).toBe(255);
        for (let k = 0; k < 4; k++) if (m.w[v * 4 + k]) expect(m.j[v * 4 + k]!).toBeLessThan(glb.names.length);
      }
    }
  });
  it("the rig hierarchy matches the reference body: clavicles under the neck, the chest pivot ≈ 11 cm under the shoulders", () => {
    for (const S of ["L", "R"]) {
      expect(glb.parentOf.get(`Bip01_${S}_Clavicle`)).toBe("Bip01_Neck");
      expect(glb.parentOf.get(`Bip01_${S}_ShoulderHelper`)).toBe(`Bip01_${S}_Clavicle`);
      expect(glb.parentOf.get(`Bip01_${S}_ForearmTwist`)).toBe(`Bip01_${S}_Forearm`);
      // the helper turns about the shoulder joint itself
      expect(glb.bindPos(`Bip01_${S}_ShoulderHelper`).distanceTo(glb.bindPos(`Bip01_${S}_UpperArm`))).toBeLessThan(1e-4);
    }
    const drop = glb.bindPos("Bip01_L_UpperArm").y - glb.bindPos("Bip01_Spine2").y;
    // Rocketbox reference: 1.428 − 1.321 = 0.107 m
    expect(drop).toBeGreaterThan(0.05);
    expect(drop).toBeLessThan(0.15);
  });
  it("the shoulder blends across clavicle / helper / upper arm (no rigid seam at the joint)", () => {
    const body = glb.meshes.find((m) => m.name === "body")!;
    const sh = glb.bindPos("Bip01_L_UpperArm");
    const ua = glb.names.indexOf("Bip01_L_UpperArm");
    const hp = glb.names.indexOf("Bip01_L_ShoulderHelper");
    let n = 0,
      blended = 0,
      helper = 0;
    for (let v = 0; v < body.pos.length / 3; v++) {
      const d = Math.hypot(body.pos[v * 3]! - sh.x, body.pos[v * 3 + 1]! - sh.y, body.pos[v * 3 + 2]! - sh.z);
      if (d > 0.1) continue;
      n++;
      let wu = 0,
        wh = 0;
      for (let k = 0; k < 4; k++) {
        if (body.j[v * 4 + k] === ua) wu += body.w[v * 4 + k]! / 255;
        if (body.j[v * 4 + k] === hp) wh += body.w[v * 4 + k]! / 255;
      }
      if (wu > 0.05 && wu < 0.95) blended++;
      helper += wh;
    }
    expect(n).toBeGreaterThan(50);
    expect(blended / n).toBeGreaterThan(0.6);
    expect(helper / n).toBeGreaterThan(0.12);
  });
  it("carries the torso slices for the keep-out (13 rows, a plausible trunk)", () => {
    const t = glb.extras.landmarks.torso as number[][];
    expect(t).toHaveLength(13);
    for (const r of t) {
      expect(r[1]).toBeGreaterThan(0.03);
      expect(r[1]).toBeLessThan(0.25);
      expect(r[2]! - r[3]!).toBeGreaterThan(0.05);
    }
  });
});

// BOXER_REPORT=1: the before / after table for docs/FIGHT-REALISM-V4.md (the P3-FGT-13 GLB kept at
// public/assets/characters/_before/, measured against this body's torso shifted to the old chest pivot)
describe.runIf(process.env.BOXER_REPORT === "1")("report", () => {
  it("prints the metrics", async () => {
    const CL: BoxingClipName[] = ["guard", "jab", "cross", "leadHook", "rearHook", "leadUppercut", "rearUppercut", "leadBody", "rearBody", "blockHigh", "blockLow", "parry", "slipLeft", "duck", "clinch", "hitHeadHeavy", "knockdown", "getUp", "cornerSit"];
    for (const g of ["m", "f"]) {
      const now = await probeBody(asset(`boxer-${g}`));
      const old = readGlb(asset(`_before/boxer-${g}`));
      const cur = readGlb(asset(`boxer-${g}`));
      const dy = cur.bindPos("Bip01_Spine2").y - old.bindPos("Bip01_Spine2").y;
      const dz = cur.bindPos("Bip01_Spine2").z - old.bindPos("Bip01_Spine2").z;
      const shifted = now.torso!.map((r) => [r[0] + dy, r[1], r[2] + dz, r[3] + dz] as [number, number, number, number]);
      const before = await probeBody(asset(`_before/boxer-${g}`), { measure: shifted });
      for (const c of CL) {
        const a = before.pose(c),
          b = now.pose(c);
        const f = (p: typeof a) => `fore-in ${(p.foreIn * 100).toFixed(0).padStart(3)} % (L ${(p.foreInSide.L * 100).toFixed(0)} R ${(p.foreInSide.R * 100).toFixed(0)}) · stretch ${p.stretchMin.toFixed(2)}–${p.stretchMax.toFixed(2)} p95 ${p.stretchP95.toFixed(2)} p99 ${p.stretchP99.toFixed(2)} @${p.stretchAt.toArray().map((v) => v.toFixed(2)).join(",")} · L elbow−shoulder ${(p.elbow.L.y - p.shoulder.L.y).toFixed(2)} R ${(p.elbow.R.y - p.shoulder.R.y).toFixed(2)}`;
        console.log(`${g} ${c.padEnd(13)} BEFORE ${f(a)}   AFTER ${f(b)}`);
      }
    }
  });
});

describe.each(["m", "f"] as const)("boxer-%s: the player's face shape on the boxer head", (g) => {
  it("every face choice that is not the base has a target; it moves the head only, by millimetres", async () => {
    const { loadBodyNode } = await import("../boxing/load-glb.dev");
    const { makeBoxer, facePickOf } = await import("./boxer-body");
    const scene = await loadBodyNode(asset(`boxer-${g}`));
    const mk = (pick: string[]) =>
      makeBoxer(scene, scene.userData as never, { outfit: "boxer", colors: { skin: "#7a4a2a", hair: "#111111", iris: "#333333", kit: "#c0262d" }, build: { heavy: 0, slim: 0, mature: 0 }, face: { beard: 0, brow: 0.8 }, facePick: pick, bare: true });
    const base = mk([]).mesh.geometry.getAttribute("position");
    const names = (scene.userData as { faceMorphs: string[] }).faceMorphs;
    expect(names).toHaveLength(16);
    expect(facePickOf({ shape: "round", eyes: "almond", nose: "broad", lips: "medium" })).toEqual(["shape:round", "eyes:almond", "nose:broad", "lips:medium"]);
    const headY = (scene.userData as { landmarks: { eyeL: number[] } }).landmarks.eyeL[1]! - 0.2;
    for (const n of names) {
      const p = mk([n]).mesh.geometry.getAttribute("position");
      let moved = 0,
        max = 0,
        low = 0;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - base.getX(i), p.getY(i) - base.getY(i), p.getZ(i) - base.getZ(i));
        if (d < 1e-5) continue;
        moved++;
        max = Math.max(max, d);
        if (base.getY(i) < headY && d > 5e-4) low++;
      }
      expect(moved, n).toBeGreaterThan(10);
      expect(max, n).toBeLessThan(0.025);
      expect(low, `${n}: moves the body below the head`).toBe(0);
    }
  });
});

describe.each(["m", "f"] as const)("boxer-%s posed with the boxing rig (CPU skinning)", (g) => {
  const ACTIONS: BoxingClipName[] = ["guard", "jab", "cross", "leadHook", "rearHook", "leadUppercut", "rearUppercut", "leadBody", "rearBody", "blockHigh", "blockLow", "parry", "slipLeft", "duck", "clinch", "hitHeadHeavy", "hitBodyHeavy", "knockdown", "getUp", "cornerSit"];
  it("guard: both elbows down under the shoulders, gloves in front of the face (no flared elbow, no arm in the chest)", async () => {
    const b = await probeBody(asset(`boxer-${g}`));
    const p = b.pose("guard");
    // P3-FGT-13: the lead elbow sat 3–5 cm under the shoulder, out to the side (the arm folded shut); the rear forearm
    // ran through the chest (23–25 % of its vertices inside the trunk)
    expect(p.elbow.L.y, "lead elbow under the shoulder").toBeLessThan(p.shoulder.L.y - 0.07);
    expect(p.elbow.R.y, "rear elbow under the shoulder").toBeLessThan(p.shoulder.R.y - 0.03);
    expect(p.foreIn).toBeLessThan(0.03);
  });
  it("no forearm through the trunk, no torn or collapsed shoulder in any action", async () => {
    const b = await probeBody(asset(`boxer-${g}`));
    for (const c of ACTIONS) {
      const p = b.pose(c);
      expect(p.foreIn, `${c}: forearm inside the torso`).toBeLessThan(0.08);
      // (regression bounds: the armpit skin stretches as the arm comes away from the A-pose bind, as real skin does)
      expect(p.stretchP99, `${c}: shoulder edge stretch`).toBeLessThan(4.8);
      expect(p.stretchP95, `${c}: shoulder edge stretch`).toBeLessThan(3.0);
      expect(p.stretchMin, `${c}: shoulder edge squash`).toBeGreaterThan(0.05);
    }
  });
});
