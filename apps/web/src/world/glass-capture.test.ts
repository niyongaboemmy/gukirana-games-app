import { describe, expect, it } from "vitest";
import { HALLS } from "@/rooms/layouts";
import { PLAZA_OBSTACLES } from "./obstacles";
import { inBuilding, toLocal } from "./footprints";
import {
  apply,
  CAPTURE_INSET,
  cubeBytes,
  decodePaneUV,
  doorFrame,
  GLAZED,
  INTERIOR_SIZE,
  localToRoom,
  Lru,
  maxCaptures,
  nextCapture,
  PANE_MODES,
  paneUV,
  projectionOf,
  REFLECT_SIZE,
  reflectionPoint,
  worldToLocal,
} from "./glass-capture";

describe("glass capture: frames", () => {
  it("world → local matches the district's door frame (toLocal) for every glazed hall", () => {
    for (const g of GLAZED) {
      const f = doorFrame(g);
      const m = worldToLocal(g);
      for (const [x, z] of [
        [f.x, f.z],
        [f.x + 3, f.z - 7],
        [0, 0],
        [-20, 14],
      ] as const) {
        const a = apply(m, { x, y: 1.2, z });
        const b = toLocal(f.angleDeg, x, z, f.ring);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.z).toBeCloseTo(b.z, 9);
        expect(a.y).toBeCloseTo(1.2, 9);
      }
      // the door itself is the local origin, the fountain is in front (+z)
      const o = apply(m, { x: f.x, y: 0, z: f.z });
      expect(Math.hypot(o.x, o.z)).toBeLessThan(1e-9);
      if (f.ring < 50) expect(apply(m, { x: 0, y: 0, z: 0 }).z).toBeGreaterThan(30);
    }
  });

  it("the glass line maps onto the room's south wall, the door axis onto the room's door", () => {
    for (const g of GLAZED) {
      const L = HALLS[g];
      const zRef = -0.6;
      const r = localToRoom(g, { x: 0, y: 1, z: zRef }, zRef);
      expect(r.z).toBeCloseTo(L.size.d / 2, 9);
      expect(r.x).toBeCloseTo(L.door.x, 9);
      // a metre behind the glass is a metre into the room
      expect(localToRoom(g, { x: 2, y: 1, z: zRef - 1 }, zRef).z).toBeCloseTo(L.size.d / 2 - 1, 9);
    }
  });
});

describe("glass capture: placement and projection per hall", () => {
  it("captures from just inside the door, at eye height, inside the room box", () => {
    for (const g of GLAZED) {
      const p = projectionOf(g);
      const L = HALLS[g];
      expect(p.at[0]).toBe(L.door.x);
      expect(p.at[2]).toBeCloseTo(L.size.d / 2 - CAPTURE_INSET, 9);
      expect(p.at[1]).toBeGreaterThan(1.2);
      expect(p.at[1]).toBeLessThan(L.size.h);
      for (let i = 0; i < 3; i++) {
        expect(p.at[i]!).toBeGreaterThan(p.min[i]!);
        expect(p.at[i]!).toBeLessThan(p.max[i]!);
      }
    }
  });

  it("box = the real room, distance range covers its diagonal", () => {
    for (const g of GLAZED) {
      const p = projectionOf(g);
      const { w, d, h } = HALLS[g].size;
      expect(p.max[0] - p.min[0]).toBeCloseTo(w, 9);
      expect(p.max[1] - p.min[1]).toBeCloseTo(h, 9);
      expect(p.max[2] - p.min[2]).toBeCloseTo(d, 9);
      expect(p.maxD).toBeGreaterThanOrEqual(Math.hypot(w, d, h));
      expect(p.maxD).toBeLessThan(Math.hypot(w, d, h) + 1);
    }
  });

  it("the reflection is captured on open ground in front of each facade (not inside a planter, bench, lamp or building)", () => {
    for (const g of GLAZED) {
      const [x, y, z] = reflectionPoint(g);
      expect(y).toBeGreaterThan(1.2);
      const l = toLocal(doorFrame(g).angleDeg, x, z, doorFrame(g).ring);
      expect(l.x).toBeCloseTo(0, 6);
      expect(l.z).toBeGreaterThan(3);
      expect(inBuilding(x, z, 0.3)).toBe(false);
      for (const o of PLAZA_OBSTACLES) {
        if (o.kind === "circle") expect(Math.hypot(x - o.x, z - o.z)).toBeGreaterThan(o.r + 0.3);
      }
    }
  });
});

describe("glass capture: pane modes, queue, memory", () => {
  it("pane UVs round-trip (mode cell + the south-wall plane)", () => {
    for (const m of PANE_MODES) {
      const [u, v] = paneUV(m, -1.535);
      expect(decodePaneUV(u)).toBe(m);
      expect(v).toBe(-1.535);
    }
    expect(decodePaneUV(9.5)).toBeNull();
  });

  it("captures the nearest open hall in range first, skips captured / out of range", () => {
    const pool = doorFrame("pool");
    expect(nextCapture({ x: pool.x * 0.9, z: pool.z * 0.9 }, new Set())).toBe("pool");
    expect(nextCapture({ x: pool.x * 0.9, z: pool.z * 0.9 }, new Set(["pool"]))).not.toBe("pool");
    expect(nextCapture({ x: 0, z: 400 }, new Set())).toBeNull();
    const all = new Set<string>(GLAZED);
    expect(nextCapture({ x: 0, z: 0 }, all)).toBeNull();
  });

  it("GPU memory of the captures is bounded (≤ 6 interiors + 6 reflections ≈ 38 MB; 3 on small devices)", () => {
    expect(maxCaptures(undefined)).toBe(6);
    expect(maxCaptures(8)).toBe(6);
    expect(maxCaptures(4)).toBe(3);
    const total = maxCaptures(8) * cubeBytes(INTERIOR_SIZE) + GLAZED.length * cubeBytes(REFLECT_SIZE);
    expect(total).toBeLessThanOrEqual(40 * 1024 * 1024);
  });

  it("LRU releases the least recently captured beyond its capacity", () => {
    const l = new Lru(2);
    expect(l.touch("a")).toEqual([]);
    expect(l.touch("b")).toEqual([]);
    expect(l.touch("a")).toEqual([]);
    expect(l.touch("c")).toEqual(["b"]);
    expect(l.keys).toEqual(["a", "c"]);
  });
});
