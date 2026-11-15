import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { clearRopes, ROPE_CLEAR } from "./camera";
import { RING_SIZES } from "@/rooms/fight/ring-kit-core";

/** P3-FGT-14: no rope across the middle of the frame when the camera stands outside the ropes */
const ring = { x: 10, z: -4, rotY: 0.4, canvasY: 0.8, feature: false };
const D = RING_SIZES.training;

/** height above the canvas where the eye → look line crosses the rope line nearest the eye (ring frame u axis) */
function crossing(eye: THREE.Vector3, look: THREE.Vector3) {
  const co = Math.cos(ring.rotY),
    sn = Math.sin(ring.rotY);
  const u = (p: THREE.Vector3) => (p.x - ring.x) * co - (p.z - ring.z) * sn;
  const t = (u(eye) - Math.sign(u(eye)) * D.post) / (u(eye) - u(look));
  return eye.y + t * (look.y - eye.y) - ring.canvasY;
}
/** a point in the ring frame (u, height above canvas, v) → hall */
const at = (uu: number, h: number, v: number) => {
  const co = Math.cos(ring.rotY),
    sn = Math.sin(ring.rotY);
  return new THREE.Vector3(ring.x + uu * co + v * sn, ring.canvasY + h, ring.z - uu * sn + v * co);
};

describe("fight camera: ropes out of the shot", () => {
  it("a watch shot at rope height is moved so its sight line goes through a gap (or over the top)", () => {
    for (const h of [...D.ropes, 0.5, 1.1, 1.4]) {
      const eye = at(D.half + 1.8, h, 0.3);
      const look = at(0, 1.2, 0);
      clearRopes(ring, eye, look);
      const y = crossing(eye, look);
      for (const r of D.ropes) expect(Math.abs(y - r), `eye at ${h}: crossing ${y.toFixed(3)} vs rope ${r}`).toBeGreaterThanOrEqual(ROPE_CLEAR - 1e-6);
    }
  });
  it("leaves a clear shot alone, and never touches a camera inside the ropes", () => {
    const eye = at(D.half + 1.8, 1.22 + 0.0, 0);
    const look = at(0, 1.22, 0);
    expect(clearRopes(ring, eye, look)).toBe(0);
    const inside = at(1.6, 1.07, 0.2);
    expect(clearRopes(ring, inside, at(-0.5, 1.3, 0))).toBe(0);
  });
  it("moves the least: the nearest gap", () => {
    const eye = at(D.half + 2, D.ropes[2]! + 0.02, 0);
    const look = at(0, 1.2, 0);
    const dy = clearRopes(ring, eye, look);
    expect(Math.abs(dy)).toBeLessThan(0.3);
  });
});
