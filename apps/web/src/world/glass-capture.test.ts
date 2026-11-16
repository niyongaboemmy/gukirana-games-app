import { describe, expect, it } from "vitest";
import { HALLS } from "@/rooms/layouts";
import { PLAZA_OBSTACLES } from "./obstacles";
import { inBuilding, toLocal } from "./footprints";
import {
  apply,
  captureBudget,
  cubeBytes,
  decodePaneUV,
  doorFrame,
  GLAZED,
  isDesktopClass,
  localToRoom,
  nextCapture,
  PANE_MODES,
  paneUV,
  reflectionPoint,
  reflectSize,
  roomBox,
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

describe("glass capture: room box and reflection point per hall", () => {
  it("the room box is the real room (vision glass outside it turns into spandrel)", () => {
    for (const g of GLAZED) {
      const p = roomBox(g);
      const { w, d, h } = HALLS[g].size;
      expect(p.max[0] - p.min[0]).toBeCloseTo(w, 9);
      expect(p.max[1] - p.min[1]).toBeCloseTo(h, 9);
      expect(p.max[2] - p.min[2]).toBeCloseTo(d, 9);
      expect(p.min[1]).toBe(0);
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
  it("pane UVs round-trip (mode cell + the south-wall plane); door leaves have their own mode, no open doorway mode", () => {
    for (const m of PANE_MODES) {
      const [u, v] = paneUV(m, -1.535);
      expect(decodePaneUV(u)).toBe(m);
      expect(v).toBe(-1.535);
    }
    expect(decodePaneUV(9.5)).toBeNull();
    expect(PANE_MODES).toContain("door");
    expect(PANE_MODES as readonly string[]).not.toContain("doorway");
  });

  it("captures the nearest hall in range first (closed halls too: it is the plaza), skips captured / out of range", () => {
    const pool = doorFrame("pool");
    expect(nextCapture({ x: pool.x * 0.9, z: pool.z * 0.9 }, new Set())).toBe("pool");
    expect(nextCapture({ x: pool.x * 0.9, z: pool.z * 0.9 }, new Set(["pool"]))).not.toBe("pool");
    expect(nextCapture({ x: 0, z: 400 }, new Set())).toBeNull();
    const all = new Set<string>(GLAZED);
    expect(nextCapture({ x: 0, z: 0 }, all)).toBeNull();
    const arena = doorFrame("arena");
    expect(nextCapture({ x: arena.x * 0.9, z: arena.z * 0.9 }, new Set())).toBe("arena");
  });

  it("reflection sizes and the GPU memory budget (desktop 256 px, phone 128 px, all six halls, no interiors)", () => {
    expect(reflectSize(true)).toBe(256);
    expect(reflectSize(false)).toBe(128);
    expect(isDesktopClass(undefined, false)).toBe(true);
    expect(isDesktopClass(8, false)).toBe(true);
    expect(isDesktopClass(4, false)).toBe(false);
    expect(isDesktopClass(8, true)).toBe(false);
    expect(cubeBytes(512)).toBe(Math.round(512 * 512 * 24 * (4 / 3)));
    expect(cubeBytes(256, false)).toBe(256 * 256 * 24);
    expect(captureBudget(true)).toBe(GLAZED.length * 256 * 256 * 24);
    expect(captureBudget(true)).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(captureBudget(false)).toBeLessThanOrEqual(2.5 * 1024 * 1024);
  });
});
