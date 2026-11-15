import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AIM_DROP, EYE_OFFSET, LOOK_DOWN, LOOK_YAW, easeLook, eyeFrom, fpvPhase, hideSphere, HIDE_R, HIDE_UP, viewDir } from "./fpv";

const ID = new THREE.Quaternion();

describe("first-person view maths (P3-FGT-15)", () => {
  it("puts the eye over and in front of the head joint, turned with the head", () => {
    const e = eyeFrom(new THREE.Vector3(0, 1.6, 0), ID, new THREE.Vector3());
    expect(e.y).toBeCloseTo(1.6 + EYE_OFFSET.y);
    expect(e.z).toBeCloseTo(EYE_OFFSET.z);
    // head turned 90° to the left (about +y): the eye offset swings to +x
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const e2 = eyeFrom(new THREE.Vector3(0, 1.6, 0), q, new THREE.Vector3());
    expect(e2.x).toBeCloseTo(EYE_OFFSET.z);
    expect(e2.z).toBeCloseTo(0, 5);
  });

  it("aims at the opponent a little under their face, and follows the head's turn by the follow share", () => {
    const eye = new THREE.Vector3(0, 1.67, 0);
    const target = new THREE.Vector3(0, 1.67, 1);
    const d = viewDir(eye, target, ID, 0, 0, 0, new THREE.Vector3());
    expect(d.z).toBeGreaterThan(0.9);
    expect(d.y).toBeCloseTo(-AIM_DROP / Math.hypot(1, AIM_DROP), 4);
    // my head snapped 90° to the right (a hook landed): with follow 0.4 the view swings part of the way
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    const d2 = viewDir(eye, target, q, 0.4, 0, 0, new THREE.Vector3());
    expect(d2.x).toBeLessThan(-0.2);
    expect(d2.z).toBeGreaterThan(0.3);
  });

  it("free look: positive pitch looks DOWN (my body and legs), yaw turns about up", () => {
    const eye = new THREE.Vector3(0, 1.67, 0);
    const target = new THREE.Vector3(0, 1.67 + AIM_DROP, 1);
    const down = viewDir(eye, target, ID, 0, 0, 1.0, new THREE.Vector3());
    expect(down.y).toBeLessThan(-0.8);
    const left = viewDir(eye, target, ID, 0, 0.5, 0, new THREE.Vector3());
    expect(left.x).toBeGreaterThan(0.4);
  });

  it("clamps the free look and eases it back to centre once released", () => {
    const l = { yaw: 3, pitch: 5, held: true };
    easeLook(l, 0.016);
    expect(l.yaw).toBe(LOOK_YAW);
    expect(l.pitch).toBe(LOOK_DOWN);
    l.held = false;
    for (let i = 0; i < 300; i++) easeLook(l, 0.016);
    expect(l.yaw).toBe(0);
    expect(l.pitch).toBe(0);
  });

  it("hides a sphere over the head joint (head + headgear), radius from the constants", () => {
    const h = hideSphere(new THREE.Vector3(0, 1.55, 0.01), new THREE.Vector4());
    expect(h.y).toBeCloseTo(1.55 + HIDE_UP);
    expect(h.w).toBe(HIDE_R);
  });

  it("first person in the round, the countdown and when the other one is counted; not when I am down", () => {
    expect(fpvPhase("round", false)).toBe(true);
    expect(fpvPhase("knockdown", false)).toBe(true);
    expect(fpvPhase("knockdown", true)).toBe(false);
    expect(fpvPhase("rest", false)).toBe(false);
    expect(fpvPhase("over", false)).toBe(false);
  });
});
