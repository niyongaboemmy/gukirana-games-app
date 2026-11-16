import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { JUMP, jumpPose, jumpSeconds, MotionLayer } from "./motion-layer";
import { nextJump } from "../jump";

describe("jump pose (P2-AVA-12)", () => {
  for (const running of [false, true]) {
    const j = running ? JUMP.running : JUMP.standing;
    const T = jumpSeconds(running);
    it(`${running ? "running" : "standing"}: anticipation, flight to the right height, landing, then done`, () => {
      // anticipation crouches with the arms back, feet on the ground
      const a = jumpPose(j.anticipate * 0.9, running)!;
      expect(a.crouch).toBeGreaterThan(0.04);
      expect(a.arms).toBeGreaterThan(0.3);
      expect(a.air).toBe(false);
      // the highest point of the flight is the jump's height (ballistic)
      let top = 0;
      for (let t = 0; t < T; t += 1 / 240) top = Math.max(top, jumpPose(t, running)?.lift ?? 0);
      expect(top).toBeGreaterThan(j.height * 0.97);
      expect(top).toBeLessThan(j.height * 1.03);
      // the landing absorbs (knees bend) after the flight
      const v0 = Math.sqrt(2 * 9.81 * j.height);
      const land = jumpPose(j.anticipate + j.push + (2 * v0) / 9.81 + 0.07, running)!;
      expect(land.air).toBe(false);
      expect(land.crouch).toBeGreaterThan(0.05);
      expect(jumpPose(T + 0.01, running)).toBeNull();
    });
    it(`${running ? "running" : "standing"}: continuous (no snapping between frames at 120 fps)`, () => {
      let prev = jumpPose(0, running)!;
      for (let t = 1 / 120; t < T; t += 1 / 120) {
        const p = jumpPose(t, running);
        if (!p) break;
        expect(Math.abs(p.crouch - prev.crouch)).toBeLessThan(0.025);
        expect(Math.abs(p.lift - prev.lift)).toBeLessThan(0.04);
        expect(Math.abs(p.arms - prev.arms)).toBeLessThan(0.25); // a running take-off swings the arms at ≈ 18 rad/s
        expect(p.lift).toBeGreaterThanOrEqual(-1e-9);
        prev = p;
      }
    });
  }
});

describe("jump control", () => {
  it("one jump at a time; a request during a jump is dropped", () => {
    const a = nextJump(0, 0, 100, 100, false)!;
    expect(a.until).toBeCloseTo(100 + jumpSeconds(false) * 1000);
    const b = nextJump(a.until, a.handled, 300, 300, false)!;
    expect(b.until).toBe(a.until);
    expect(nextJump(b.until, b.handled, 300, 2000, false)).toBeNull();
    const c = nextJump(b.until, b.handled, 2500, 2500, true)!;
    expect(c.until).toBeCloseTo(2500 + jumpSeconds(true) * 1000);
  });
});

/** A minimal Biped-named skeleton: root → Bip01 → pelvis → spine → spine1 → spine2 → neck → head / clavicles … */
function rig() {
  const root = new THREE.Group();
  const mk = (n: string, p: THREE.Object3D, y: number, x = 0) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(x, y, 0);
    p.add(b);
    return b;
  };
  const hips = mk("Bip01", root, 0.9);
  const pelvis = mk("Bip01_Pelvis", hips, 0);
  const spine = mk("Bip01_Spine", pelvis, 0.1);
  const s1 = mk("Bip01_Spine1", spine, 0.12);
  const s2 = mk("Bip01_Spine2", s1, 0.12);
  const neck = mk("Bip01_Neck", s2, 0.15);
  mk("Bip01_Head", neck, 0.1);
  for (const [s, x] of [
    ["L", 0.1],
    ["R", -0.1],
  ] as const) {
    const th = mk(`Bip01_${s}_Thigh`, spine, -0.1, x);
    const calf = mk(`Bip01_${s}_Calf`, th, -0.42);
    calf.position.z = 0.01;
    mk(`Bip01_${s}_Foot`, calf, -0.4);
    mk(`Bip01_${s}_Clavicle`, neck, 0, x * 0.5);
  }
  root.updateMatrixWorld(true);
  return root;
}

describe("motion layer", () => {
  const input = { speed: 0, forward: 0, yawRate: 0, anim: 0, moveW: 0, seated: false, now: 0 };
  it("leans into a curve, towards its centre, and never past ~11°", () => {
    const root = rig();
    const m = new MotionLayer(root, (n) => root.getObjectByName(n) ?? null, []);
    for (let i = 0; i < 120; i++) m.apply(1 / 60, { ...input, speed: 3.6, forward: 3.6, yawRate: 1.4, moveW: 1, now: i / 60 });
    // turning left (yaw increasing): the body tilts to its left (+x when facing +z), a negative roll about +z
    expect(m.out.roll).toBeLessThan(-0.05);
    expect(Math.abs(m.out.roll)).toBeLessThanOrEqual(0.2 * 0.65 + 1e-6);
  });
  it("a jump lifts the body and ends; a seated person never jumps", () => {
    const root = rig();
    const m = new MotionLayer(root, (n) => root.getObjectByName(n) ?? null, []);
    let top = 0;
    for (let i = 0; i < 120; i++) {
      m.apply(1 / 60, { ...input, anim: 32, now: i / 60 });
      top = Math.max(top, m.out.lift);
    }
    expect(top).toBeGreaterThan(0.25);
    expect(m.jumping).toBe(false);
    const s = new MotionLayer(root, (n) => root.getObjectByName(n) ?? null, []);
    for (let i = 0; i < 60; i++) s.apply(1 / 60, { ...input, anim: 32, seated: true, now: i / 60 });
    expect(s.out.lift).toBe(0);
  });
  it("the face follows the action: joy for a cheer, sadness for 'oh no', surprise for a startle", () => {
    const root = rig();
    const m = new MotionLayer(root, (n) => root.getObjectByName(n) ?? null, []);
    const run = (anim: number) => {
      for (let i = 0; i < 90; i++) m.apply(1 / 60, { ...input, anim, now: i / 60 + anim });
      return { ...m.emotion };
    };
    expect(run(20).joy).toBeGreaterThan(0.8);
    expect(run(25).sad).toBeGreaterThan(0.8);
    expect(run(33).surprise).toBeGreaterThan(0.6);
  });
  it("a bump from the front-left makes a stagger and a glance that fade out", () => {
    const root = rig();
    const m = new MotionLayer(root, (n) => root.getObjectByName(n) ?? null, []);
    m.bump(new THREE.Vector3(0.3, 0, 0.4), 1, 0);
    let glance = 0;
    for (let i = 1; i < 60; i++) {
      m.apply(1 / 60, { ...input, now: i / 60 });
      glance = Math.max(glance, m.out.glanceW);
    }
    expect(m.out.glance).toBeGreaterThan(0.3); // towards the person's left (+x), where the bump came from
    expect(glance).toBeGreaterThan(0.3);
    for (let i = 60; i < 300; i++) m.apply(1 / 60, { ...input, now: i / 60 });
    expect(m.out.glanceW).toBeLessThan(0.05);
  });
});
