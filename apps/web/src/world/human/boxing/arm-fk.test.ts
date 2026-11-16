import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { aimArm, ArmFk, armPoints, clampArm, DEG, keepOut, LIMITS, newPoints, penetration, type ArmDims, type Obstacle } from "./arm-fk";
import { BOXING_CLIPS, BOXING_CLIP_NAMES, sampleClip } from "./clips";
import { BoxingMotion } from "./motion";
import { ARM, ARM_SIZE, GUARD, P } from "./pose";

/** the masculine boxer body's left arm in its chest (Spine2) frame (boxer-m.glb bind pose) */
const dims = (s: number): ArmDims => ({ s, clav: new THREE.Vector3(0.023 * s, 0.138, 0.074), shoulder: new THREE.Vector3(0.207 * s, 0.109, 0.068), upper: 0.257, fore: 0.268, glove: 0.085 });
const elbowAngle = (p: ReturnType<typeof newPoints>) => {
  const u = p.sh.clone().sub(p.el).normalize();
  const f = p.wr.clone().sub(p.el).normalize();
  return 180 - (Math.acos(THREE.MathUtils.clamp(u.dot(f), -1, 1)) * 180) / Math.PI;
};

describe("keyed arms: joint limits", () => {
  it("clamps every angle into its range, the elbow a 0–150° hinge", () => {
    const a = new Float32Array(8).fill(10);
    a[ARM.elbow] = -1;
    clampArm(a);
    expect(a[ARM.elbow]).toBe(0);
    a[ARM.elbow] = 4;
    clampArm(a);
    expect(a[ARM.elbow]).toBeCloseTo(150 * DEG, 6);
    for (const k of Object.keys(ARM) as (keyof typeof ARM)[]) {
      expect(a[ARM[k]]!).toBeGreaterThanOrEqual(LIMITS[k][0] - 1e-6);
      expect(a[ARM[k]]!).toBeLessThanOrEqual(LIMITS[k][1] + 1e-6);
    }
  });

  it("never adducts a hanging arm through the trunk (the shoulder cone)", () => {
    const a = new Float32Array(8);
    a[ARM.flex] = 0;
    a[ARM.abd] = -40 * DEG;
    clampArm(a);
    expect(a[ARM.abd]).toBeGreaterThanOrEqual(-5 * DEG - 1e-6);
    // raised in front, across the body is allowed
    a[ARM.flex] = 90 * DEG;
    a[ARM.abd] = -40 * DEG;
    clampArm(a);
    expect(a[ARM.abd]).toBeCloseTo(-40 * DEG, 5);
  });

  it("every keyed clip, sampled through its length, holds angles inside the limits (both arms)", () => {
    const tmp = new Float32Array(ARM_SIZE);
    for (const n of BOXING_CLIP_NAMES) {
      const info = BOXING_CLIPS[n];
      for (let k = 0; k <= 20; k++) {
        const p = sampleClip(n, (info.duration * k) / 20);
        if (p[P.fk]! < 0.01) continue;
        for (const at of [P.la, P.ra]) {
          for (let q = 0; q < ARM_SIZE; q++) tmp[q] = p[at + q]!;
          const before = Array.from(tmp);
          clampArm(tmp);
          // the authored keys are already anatomical: clamping moves nothing by more than a rounding
          for (let q = 0; q < ARM_SIZE; q++) expect(Math.abs(tmp[q]! - before[q]!), `${n}@${k} ch${q}`).toBeLessThan(2 * DEG);
        }
      }
    }
  });
});

describe("keyed arms: forward kinematics", () => {
  it("the elbow angle between the segments is exactly the hinge angle, and flexion bends the forearm forward", () => {
    const p = newPoints();
    for (const s of [1, -1])
      for (const flex of [0, 40, 90])
        for (const elbow of [0, 45, 90, 140]) {
          const a = new Float32Array(8);
          a[ARM.flex] = flex * DEG;
          a[ARM.elbow] = elbow * DEG;
          a[ARM.rot] = 20 * DEG;
          armPoints(dims(s), a, 0, p);
          expect(elbowAngle(p)).toBeCloseTo(elbow, 3);
          expect(p.el.distanceTo(p.sh)).toBeCloseTo(0.257, 6);
          expect(p.wr.distanceTo(p.el)).toBeCloseTo(0.268, 6);
        }
    // hanging arm, elbow at 90°: the forearm points forward (+z), on both sides
    const a = new Float32Array(8);
    a[ARM.elbow] = 90 * DEG;
    for (const s of [1, -1]) {
      armPoints(dims(s), a, 0, p);
      expect(p.wr.z - p.el.z).toBeGreaterThan(0.25);
    }
  });

  it("drives real bones the same way (bind directions mapped, no sideways elbow)", () => {
    // a small Bip01-like skeleton with the boxer's bind joint positions and identity bind rotations
    const root = new THREE.Group();
    const mk = (name: string, parent: THREE.Object3D, at: THREE.Vector3, parentAt: THREE.Vector3) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.copy(at).sub(parentAt);
      parent.add(b);
      return b;
    };
    const O = new THREE.Vector3();
    const chestAt = new THREE.Vector3(0, 1.295, -0.051);
    const chest = mk("Bip01_Spine2", root, chestAt, O);
    const neckAt = new THREE.Vector3(0, 1.508, 0.011);
    const neck = mk("Bip01_Neck", chest, neckAt, chestAt);
    const J = { cl: new THREE.Vector3(0.023, 1.433, 0.023), sh: new THREE.Vector3(0.207, 1.404, 0.017), el: new THREE.Vector3(0.379, 1.213, 0.017), wr: new THREE.Vector3(0.514, 1.084, 0.209), f2: new THREE.Vector3(0.6, 1.03, 0.29), th: new THREE.Vector3(0.53, 1.06, 0.27) };
    const clav = mk("Bip01_L_Clavicle", neck, J.cl, neckAt);
    const up = mk("Bip01_L_UpperArm", clav, J.sh, J.cl);
    const fo = mk("Bip01_L_Forearm", up, J.el, J.sh);
    const ha = mk("Bip01_L_Hand", fo, J.wr, J.el);
    mk("Bip01_L_Finger2", ha, J.f2, J.wr);
    mk("Bip01_L_Finger0", ha, J.th, J.wr);
    root.updateMatrixWorld(true);
    const bind = { rel: (b: THREE.Object3D) => (b as THREE.Bone).matrixWorld.clone() };
    const fk = new ArmFk(root, bind, chest, (n) => (root.getObjectByName(n) as THREE.Bone) ?? null);
    const arm = fk.arms.L!;
    const q = new THREE.Quaternion();
    const delta = fk.chestDelta(q, new THREE.Quaternion());
    const a = new Float32Array(8);
    a[ARM.flex] = 50 * DEG;
    a[ARM.abd] = 10 * DEG;
    a[ARM.rot] = 25 * DEG;
    a[ARM.elbow] = 110 * DEG;
    fk.apply(arm, a, 0, q, delta, 1);
    root.updateMatrixWorld(true);
    const w = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const pts = newPoints();
    pts.sh.copy(w(up));
    pts.el.copy(w(fo));
    pts.wr.copy(w(ha));
    expect(elbowAngle(pts)).toBeCloseTo(110, 1);
    // the bones agree with the pure FK (chest frame → world: + the chest joint)
    const ref = armPoints(arm.dims, a, 0, newPoints());
    expect(pts.el.distanceTo(ref.el.clone().add(chestAt))).toBeLessThan(0.003);
    expect(pts.wr.distanceTo(ref.wr.clone().add(chestAt))).toBeLessThan(0.003);
  });
});

describe("keyed arms: corrections", () => {
  it("keep-out moves an arm out of an obstacle by changing the shoulder, staying in the limits", () => {
    const d = dims(1);
    const a = new Float32Array(8);
    a[ARM.flex] = 50 * DEG;
    a[ARM.abd] = -19 * DEG;
    a[ARM.rot] = 6 * DEG;
    a[ARM.elbow] = 130 * DEG;
    const p = armPoints(d, a, 0, newPoints());
    // a head sitting right where the glove is
    const obs: Obstacle[] = [{ a: p.gl.clone().add(new THREE.Vector3(-0.05, 0, 0)), b: null, r: 0.11 }];
    const before = penetration(d, a, 0, obs, null);
    expect(before).toBeGreaterThan(0);
    const after = keepOut(d, a, 0, obs, null);
    expect(after).toBeLessThan(before * 0.2);
    const check = Array.from(a);
    clampArm(a);
    expect(Array.from(a)).toEqual(check);
  });

  it("aim brings the glove to a reachable contact point within the caps, never past the joint limits", () => {
    const d = dims(1);
    const a = new Float32Array(8);
    a[ARM.flex] = 95 * DEG;
    a[ARM.abd] = 60 * DEG;
    a[ARM.rot] = 40 * DEG;
    a[ARM.elbow] = 40 * DEG;
    const p0 = armPoints(d, a, 0, newPoints());
    const target = p0.gl.clone().add(new THREE.Vector3(-0.04, -0.05, -0.06));
    aimArm(d, a, 0, target, 1);
    const p1 = armPoints(d, a, 0, newPoints());
    expect(p1.gl.distanceTo(target)).toBeLessThan(0.025);
    expect(a[ARM.elbow]!).toBeGreaterThanOrEqual(0);
    expect(a[ARM.elbow]!).toBeLessThanOrEqual(150 * DEG + 1e-6);
  });
});

describe("keyed arms in the motion library", () => {
  it("the guard and the fighting clips are keyed; ceremony with wrist targets is not", () => {
    expect(GUARD[P.fk]).toBe(1);
    for (const n of ["jab", "cross", "leadHook", "rearHook", "leadUppercut", "rearUppercut", "leadBody", "rearBody", "blockHigh", "blockLow", "clinch", "hitHeadHeavy", "slipLeft", "duck"] as const) expect(sampleClip(n, BOXING_CLIPS[n].duration / 2)[P.fk], n).toBe(1);
    for (const n of ["refIdle", "refCount", "cornerRest", "walk", "victoryHold"] as const) expect(sampleClip(n, 0.1)[P.fk], n).toBe(0);
  });

  it("the knockdown, the count and getting up are keyed all the way (no wrist targets left)", () => {
    for (const n of ["knockdown", "count", "getUp"] as const) {
      const d = BOXING_CLIPS[n].duration;
      for (let k = 0; k <= 10; k++) expect(sampleClip(n, (d * k) / 10)[P.fk], `${n}@${k}`).toBe(1);
    }
  });

  it("a punch carries its contact point into the pose when aimed (weight 0 at the guard, 1 at impact)", () => {
    const m = new BoxingMotion();
    m.play({ clip: "jab", start: 0, aim: [0.05, 1.5, 0.8] });
    expect(m.sample(0.001)[P.aimK]).toBeLessThan(0.05);
    const p = m.sample(BOXING_CLIPS.jab.impact!);
    expect(p[P.aimK]).toBeGreaterThan(0.95);
    expect(p[P.az]).toBeGreaterThan(0.6);
    expect(p[P.aimRear]).toBe(0);
  });

  it("one-shots end in the guard's angles (no pop into guardIdle)", () => {
    for (const n of BOXING_CLIP_NAMES) {
      const info = BOXING_CLIPS[n];
      if (info.loop || info.kind === "referee" || info.then !== "guardIdle") continue;
      const end = sampleClip(n, info.duration);
      if (end[P.fk]! < 0.99) continue;
      const g = sampleClip("guardIdle", 0);
      for (let q = 0; q < ARM_SIZE * 2; q++) expect(Math.abs(end[P.la + q]! - g[P.la + q]!), `${n} ch${q}`).toBeLessThan(0.02);
    }
  });
});
