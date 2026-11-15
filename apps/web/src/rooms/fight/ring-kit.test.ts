import { describe, expect, it } from "vitest";
import { cornerKit, cornerPost, fightSpots, onStepsFootprint, LOD_BY_TIER, RING, ringDrawCalls, ringSteps, selectLods, stepHeight, stepsReach, stoolParked, stoolSpot, toHall, TRAINING_RING, type RingLod, type RingSpec } from "./ring-kit-core";
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

describe("training ring size (P3-FGT-03)", () => {
  const t: RingSpec = { id: "t", x: 4, z: -2, rotY: 0, status: "free", size: "training" };

  it("is 4.3 m inside the ropes on a 0.8 m deck, and fits the hall's 6.2 × 6.4 m pitch with its rail and steps", () => {
    expect(2 * (TRAINING_RING.post - 0.13)).toBeCloseTo(4.3, 2);
    expect(TRAINING_RING.deck).toBe(0.8);
    // neighbouring rails leave a walkable aisle (≥ 0.85 m) in both directions
    expect(6.2 - 2 * TRAINING_RING.rail).toBeGreaterThanOrEqual(0.85);
    expect(6.4 - 2 * TRAINING_RING.rail).toBeGreaterThanOrEqual(0.85);
    // the steps stay clear of the neighbouring platform
    expect(TRAINING_RING.half + 3 * TRAINING_RING.stepRun).toBeLessThan(6.2 - TRAINING_RING.half - 0.3);
  });

  it("keeps the corner convention and its helpers follow the size", () => {
    const red = cornerPost(t, "red");
    expect(red.x).toBeCloseTo(4 - TRAINING_RING.post, 6);
    expect(red.z).toBeCloseTo(-2 - TRAINING_RING.post, 6);
    expect(Math.hypot(stoolSpot(t, "blue").x - cornerPost(t, "blue").x, stoolSpot(t, "blue").z - cornerPost(t, "blue").z)).toBeLessThan(1);
  });

  it("the steps climb foot → top → in over three treads", () => {
    for (const c of ["red", "blue"] as const) {
      const s = ringSteps(t, c);
      expect(s.foot.y).toBe(0);
      expect(s.top.y).toBe(TRAINING_RING.deck);
      expect(Math.abs(s.in.x - t.x)).toBeLessThan(TRAINING_RING.post);
      // the treads rise monotonically from the foot to the apron
      let last = 0;
      for (let k = 1; k <= 8; k++) {
        const x = s.foot.x + ((s.top.x - s.foot.x) * k) / 9;
        const h = stepHeight(t, x, s.foot.z) ?? (k > 4 ? TRAINING_RING.deck : 0);
        expect(h).toBeGreaterThanOrEqual(last);
        last = h;
      }
      expect(last).toBeCloseTo(TRAINING_RING.deck, 6);
    }
    expect(stepHeight(t, t.x, t.z)).toBeNull();
  });

  it("the steps' footprint covers every tread (a body radius beyond with a pad) and leaves the foot spot free (P3-FGT-08)", () => {
    for (const c of ["red", "blue"] as const) {
      const s = ringSteps(t, c);
      // every point with a tread height is on the footprint (so a walker kept off it never stands inside a tread)
      for (let k = 0; k <= 20; k++) {
        const x = s.foot.x + ((s.top.x - s.foot.x) * k) / 20;
        for (const dz of [-0.4, 0, 0.4]) if (stepHeight(t, x, s.foot.z + dz) != null) expect(onStepsFootprint(t, x, s.foot.z + dz)).toBe(true);
      }
      // the foot of the steps (where the prompt is used) stays walkable even with the body-radius pad
      expect(onStepsFootprint(t, s.foot.x, s.foot.z, 0.22)).toBe(false);
      // just off the bottom tread: free without a pad, blocked with it
      const off = s.foot.x + (s.top.x - s.foot.x) * 0.2;
      expect(onStepsFootprint(t, off, s.foot.z, 0.22)).toBe(true);
    }
    expect(onStepsFootprint(t, t.x + 8, t.z, 0.22)).toBe(false);
  });

  it("a training ring's corner kit is tucked in the rail's bay: against the skirt, inside the steps' reach, off the treads (P3-FGT-11)", () => {
    const K = TRAINING_RING;
    for (const c of ["red", "blue"] as const) {
      const kit = cornerKit(K, c);
      expect(kit.map((k) => k.kind).sort()).toEqual(["bottle", "bottle", "bucket", "spit", "stool"]);
      for (const it of kit) {
        const out = Math.abs(it.lx) + it.r - K.half;
        expect(out).toBeLessThanOrEqual(0.42);
        expect(out).toBeLessThan(stepsReach(K));
        expect(Math.abs(it.lx) - it.r).toBeGreaterThan(K.half); // on the floor, not in the skirt
        expect(Math.abs(it.lz) + it.r).toBeLessThanOrEqual(K.half); // not past the corner
        expect(onStepsFootprint({ x: 0, z: 0, rotY: 0, size: "training" }, it.lx, it.lz, it.r)).toBe(false);
        for (const o of kit) if (o !== it) expect(Math.hypot(o.lx - it.lx, o.lz - it.lz)).toBeGreaterThanOrEqual(o.r + it.r);
      }
    }
    // the parked stool is the kit's stool
    expect(stoolParked({ x: 0, z: 0, rotY: 0, size: "training" }, "red")).toMatchObject({ x: cornerKit(K, "red")[0]!.lx, z: cornerKit(K, "red")[0]!.lz });
  });

  it("training geometry is lighter than the pro kit; the field stays in budget", () => {
    const nearT = triangles(nearRingGeometry({ size: "training", boards: false }));
    const farT = triangles(farRingGeometry({ size: "training", boards: false }));
    expect(nearT).toBeLessThan(triangles(nearRingGeometry()));
    expect(farT).toBeLessThan(nearT / 8);
    // 48 rings, ~10 near on Standard
    expect(10 * nearT + 38 * farT).toBeLessThan(400_000);
    const lods = selectLods([t], { x: 4, y: 1.7, z: 30 }, { ...LOD_BY_TIER.standard, near: 15 }, () => true, null, null);
    expect(lods[0]).toBe("far");
  });
});
