import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { eyeballGeometry, fitSphere } from "./eyes";
import { crowd } from "./crowd";

describe("eyeballs (P2-AVA-12)", () => {
  it("fits a sphere through a front cap of points (the painted eye caps)", () => {
    const c = new THREE.Vector3(0.032, -0.094, 1.686);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 60; i++) {
      const th = (i % 6) * 0.12;
      const ph = Math.floor(i / 6) * 0.63;
      pts.push(new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)).multiplyScalar(0.012).add(c));
    }
    const s = fitSphere(pts)!;
    expect(s.radius).toBeCloseTo(0.012, 5);
    expect(s.center.distanceTo(c)).toBeLessThan(1e-5);
  });
  it("builds both eyes with a cornea bulge and iris coordinates of 1 at an 11.7 mm limbus", () => {
    const fits = [
      { bone: 3, center: new THREE.Vector3(0.03, 0, 0), radius: 0.018 },
      { bone: 4, center: new THREE.Vector3(-0.03, 0, 0), radius: 0.018 },
    ];
    const g = eyeballGeometry(fits, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const si = g.attributes.skinIndex as THREE.BufferAttribute;
    const half = pos.count / 2;
    // the front pole stands proud of the sphere (the cornea), the vertices are rigid on their own eye bone
    const front = new THREE.Vector3().fromBufferAttribute(pos, 0);
    expect(front.distanceTo(fits[0]!.center)).toBeGreaterThan(0.0195);
    expect(si.getX(0)).toBe(3);
    expect(si.getX(half)).toBe(4);
    // where |uv| = 1 the iris radius (distance off the forward axis) is ≈ 5.9 mm
    let best = 9;
    let r = 0;
    for (let i = 0; i < half; i++) {
      const d = Math.abs(Math.hypot(uv.getX(i), uv.getY(i)) - 1);
      if (d < best) {
        best = d;
        const p = new THREE.Vector3().fromBufferAttribute(pos, i).sub(fits[0]!.center);
        r = Math.hypot(p.x, p.y);
      }
    }
    expect(best).toBeLessThan(0.12);
    expect(r).toBeGreaterThan(0.0053);
    expect(r).toBeLessThan(0.0066);
  });
});

describe("crowd bumps", () => {
  it("someone walking into you faster than a stroll is a bump; standing side by side is not", () => {
    const a = {},
      b = {},
      c = {};
    crowd.update(a, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), 10);
    crowd.update(b, new THREE.Vector3(0.4, 0, 0), new THREE.Vector3(-2, 0, 0), 10);
    crowd.update(c, new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(0, 0, 0), 10);
    const hit = crowd.bumpOn(a, 10)!;
    expect(hit.from.x).toBeCloseTo(0.4);
    expect(hit.strength).toBeGreaterThan(0.5);
    // b walks away from c: c is not bumped; b (moving) is not bumped by people standing still
    expect(crowd.bumpOn(c, 10)).toBeNull();
    expect(crowd.bumpOn(b, 10)).toBeNull();
    for (const k of [a, b, c]) crowd.remove(k);
    expect(crowd.size).toBe(0);
  });
});
