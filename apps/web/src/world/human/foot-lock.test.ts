import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FootLock, solveLeg } from "./foot-lock";

/** a leg: hip at 1 m, knee bent forward, ankle under the hip, the ball of the foot 12 cm ahead on the ground */
function leg(side = "L", x = 0.1) {
  const root = new THREE.Group();
  const thigh = new THREE.Bone();
  thigh.name = `Bip01_${side}_Thigh`;
  thigh.position.set(x, 1, 0);
  const calf = new THREE.Bone();
  calf.name = `Bip01_${side}_Calf`;
  calf.position.set(0, -0.45, 0.06);
  const foot = new THREE.Bone();
  foot.name = `Bip01_${side}_Foot`;
  foot.position.set(0, -0.45, -0.06);
  const toe = new THREE.Bone();
  toe.name = `Bip01_${side}_Toe0`;
  toe.position.set(0, -0.08, 0.12);
  root.add(thigh);
  thigh.add(calf);
  calf.add(foot);
  foot.add(toe);
  root.updateMatrixWorld(true);
  return { root, thigh, calf, foot, toe };
}

describe("solveLeg (two-bone IK)", () => {
  it("reaches a target a few centimetres away, the knee staying forward and the foot's orientation kept", () => {
    const { thigh, calf, foot } = leg();
    const q0 = foot.getWorldQuaternion(new THREE.Quaternion());
    const target = foot.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.01, 0.02, 0.05));
    const err = solveLeg(thigh, calf, foot, target, new THREE.Vector3(1, 0, 0));
    expect(err).toBeLessThan(1e-3);
    expect(calf.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(0.03);
    expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(q0)).toBeLessThan(1e-4);
    // bone lengths unchanged (rotations only)
    expect(calf.position.length()).toBeCloseTo(Math.hypot(0.45, 0.06), 6);
  });

  it("clamps an unreachable target to a straight leg instead of breaking", () => {
    const { thigh, calf, foot } = leg();
    const err = solveLeg(thigh, calf, foot, new THREE.Vector3(0.1, -1, 0), new THREE.Vector3(1, 0, 0));
    expect(Number.isFinite(err)).toBe(true);
  });
});

describe("FootLock", () => {
  it("pins a planted foot while the clip lets it drift, and lets go of it when it lifts", () => {
    const L = leg("L", 0.1),
      R = leg("R", -0.1);
    const root = new THREE.Group();
    root.add(L.root, R.root);
    const byName = (n: string) => root.getObjectByName(n);
    const lock = new FootLock(root, byName);
    expect(lock.ready).toBe(true);
    const start = L.toe.getWorldPosition(new THREE.Vector3());
    // the clip drifts the whole left leg forward 0.5 cm per frame while the foot is down (the mixer re-poses the
    // bones every frame: the IK starts from the clip's pose each time)
    const pose = [L.thigh, L.calf, L.foot].map((b) => b.quaternion.clone());
    for (let i = 0; i < 10; i++) {
      [L.thigh, L.calf, L.foot].forEach((b, k) => b.quaternion.copy(pose[k]!));
      L.root.position.z += 0.005;
      L.root.updateMatrixWorld(true);
      lock.apply(1 / 60, 1);
    }
    const pinned = L.toe.getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(pinned.x - start.x, pinned.z - start.z)).toBeLessThan(0.006);
    // lifted: the lock lets go (no correction pulling the swinging foot back)
    L.root.position.y += 0.1;
    L.root.updateMatrixWorld(true);
    for (let i = 0; i < 30; i++) lock.apply(1 / 60, 1);
    L.root.updateMatrixWorld(true);
    expect(L.toe.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(start.y + 0.05);
  });
});
