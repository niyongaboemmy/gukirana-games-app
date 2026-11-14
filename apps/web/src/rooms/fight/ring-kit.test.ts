import { describe, expect, it } from "vitest";
import { cornerPost, fightSpots, LOD_BY_TIER, RING, ringDrawCalls, ringSteps, selectLods, stoolSpot, toHall, type RingLod, type RingSpec } from "./ring-kit-core";
import { farRingGeometry, nearRingGeometry, stoolGeometry, triangles } from "./ring-kit-geometry";

/** a 50-ring hall field: 10 × 5 rings on a 12 m grid */
const field = (): RingSpec[] =>
  Array.from({ length: 50 }, (_, i) => ({ id: `ring-${i + 1}`, x: (i % 10) * 12 - 54, z: Math.floor(i / 10) * 12 - 24, rotY: 0, status: (["free", "waiting", "fighting"] as const)[i % 3]! }));

describe("ring LOD / culling selection", () => {
  const all = () => true;

  it("near within the tier's radius, far beyond, culled outside the view; counts add up", () => {
    const rings = field();
    const lods = selectLods(rings, { x: -54, y: 1.7, z: -24 }, LOD_BY_TIER.standard, all, null, null);
    const n = (k: RingLod) => lods.filter((x) => x === k).length;
    expect(n("near") + n("far") + n("culled")).toBe(50);
    // standing at ring 1: the rings within 26 m are near ((0,0), (12,0), (24,0), (0,12), (12,12), (0,24) …)
    expect(n("near")).toBeGreaterThanOrEqual(5);
    expect(n("near")).toBeLessThanOrEqual(9);
    expect(lods[0]).toBe("near");
    expect(lods[49]).toBe("far");
    // a frustum that only sees the left half of the hall
    const half = selectLods(rings, { x: -54, y: 1.7, z: -24 }, LOD_BY_TIER.standard, (r) => r.x < 0, null, null);
    expect(half.filter((x) => x === "culled").length).toBe(25);
  });

  it("Lite keeps fewer rings near", () => {
    const rings = field();
    const cam = { x: 0, y: 1.7, z: 0 };
    const std = selectLods(rings, cam, LOD_BY_TIER.standard, all, null, null).filter((x) => x === "near").length;
    const lite = selectLods(rings, cam, LOD_BY_TIER.lite, all, null, null).filter((x) => x === "near").length;
    expect(lite).toBeLessThan(std);
  });

  it("has a hysteresis at the threshold (no flicker) and keeps the feature ring near", () => {
    const rings: RingSpec[] = [{ id: "a", x: 0, z: 27, rotY: 0, status: "free" }];
    const cam = { x: 0, y: RING.deck, z: 0 };
    expect(selectLods(rings, cam, LOD_BY_TIER.standard, all, null, null)[0]).toBe("far");
    expect(selectLods(rings, cam, LOD_BY_TIER.standard, all, ["near"], null)[0]).toBe("near");
    expect(selectLods(rings, cam, LOD_BY_TIER.standard, all, null, "a")[0]).toBe("near");
    expect(selectLods(rings, { x: 0, y: 0, z: 200 }, LOD_BY_TIER.standard, all, null, null)).toEqual(["far"]);
    expect(selectLods(rings, { x: 0, y: 0, z: 900 }, LOD_BY_TIER.standard, all, null, null)).toEqual(["culled"]);
  });

  it("is deterministic and reuses the output array", () => {
    const rings = field();
    const out: RingLod[] = [];
    const a = selectLods(rings, { x: 3, y: 1.7, z: 4 }, LOD_BY_TIER.standard, all, null, "ring-7", out);
    expect(a).toBe(out);
    expect([...a]).toEqual(selectLods(rings, { x: 3, y: 1.7, z: 4 }, LOD_BY_TIER.standard, all, null, "ring-7"));
  });
});

describe("draw-call budget", () => {
  it("≤ 7 draw calls for the whole field on Standard (≤ 25 budget), fewer on Lite", () => {
    const std = ringDrawCalls("standard", { anyNear: true, anyFar: true, feature: true, boards: true });
    const lite = ringDrawCalls("lite", { anyNear: true, anyFar: true, feature: true, boards: true });
    expect(std).toBe(7);
    expect(std).toBeLessThanOrEqual(25);
    expect(lite).toBeLessThan(std);
    expect(ringDrawCalls("standard", { anyNear: false, anyFar: false, feature: false, boards: true })).toBe(0);
  });

  it("the far kit is a small fraction of the near kit (triangles)", () => {
    const near = triangles(nearRingGeometry());
    const far = triangles(farRingGeometry());
    expect(far).toBeLessThan(near / 8);
    // a 50-ring field with ~8 rings near stays well under a million triangles
    expect(8 * near + 42 * far + 16 * triangles(stoolGeometry())).toBeLessThan(400_000);
  });
});

describe("ring placement helpers", () => {
  const r: RingSpec = { id: "x", x: 10, z: -5, rotY: Math.PI / 2, status: "free" };

  it("transforms from the ring frame into the hall", () => {
    const p = toHall(r, 1, 0, 0);
    // rotY 90°: the ring's +x points along hall −z
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(-6, 6);
  });

  it("puts the fighters face to face on the red–blue diagonal, the stools inside the corners", () => {
    const f = fightSpots({ ...r, rotY: 0 }, 1.3);
    expect(Math.hypot(f.red.x - f.blue.x, f.red.z - f.blue.z)).toBeCloseTo(1.3, 6);
    // facing each other
    const dir = (s: { yaw: number }) => [Math.sin(s.yaw), Math.cos(s.yaw)] as const;
    const [rx, rz] = dir(f.red);
    expect(rx * (f.blue.x - f.red.x) + rz * (f.blue.z - f.red.z)).toBeGreaterThan(1.2);
    const post = cornerPost({ ...r, rotY: 0 }, "red");
    const stool = stoolSpot({ ...r, rotY: 0 }, "red");
    expect(Math.hypot(stool.x - post.x, stool.z - post.z)).toBeLessThan(1);
    expect(stool.y).toBe(RING.deck);
  });

  it("the steps lead from the hall floor up to the apron and through the ropes", () => {
    const s = ringSteps({ ...r, rotY: 0 }, "blue");
    expect(s.foot.y).toBe(0);
    expect(s.top.y).toBe(RING.deck);
    expect(Math.abs(s.foot.x - r.x)).toBeGreaterThan(RING.half);
    expect(Math.abs(s.in.x - r.x)).toBeLessThan(RING.post);
  });
});
