import { describe, expect, it } from "vitest";
import { PLOTS } from "./footprints";
import { PLAZA_RADIUS, ringPoint } from "./layout";
import { inCompound, PARKING_BAYS } from "./campus";
import { BUILDING_RECTS, carInBay, freeBlocked, freeSpot, keepInCompound, PERIMETER_STONES, planFreeRoute, resolveSolids } from "./free-walk";

/** a world point well inside a plot's biggest footprint rectangle */
function insidePlot(id: string) {
  const r = BUILDING_RECTS.filter((b) => b.plot === id).sort((a, b) => b.hw * b.hd - a.hw * a.hd)[0]!;
  return { x: r.x, z: r.z };
}
const segBlocked = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
  for (let k = 1; k < n; k++) if (freeBlocked(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, 0.3)) return true;
  return false;
};

describe("walk anywhere in the compound (P2-WLD-16)", () => {
  it("leaves the lawns open and the buildings solid", () => {
    // lawns far from any walk: west of the plaza between the walks, north-west, east of the car parks
    for (const p of [ringPoint(0, 92), ringPoint(-75, 90), ringPoint(-140, 62), ringPoint(-100, 152), ringPoint(45, 140), ringPoint(-20, 150)]) expect(freeBlocked(p.x, p.z)).toBe(false);
    for (const plot of PLOTS) {
      const c = insidePlot(plot.id);
      expect(freeBlocked(c.x, c.z), plot.id).toBe(true);
    }
  });

  it("slides a body along a wall and never lets it into a building", () => {
    // walking straight at the Pool Hall's back wall from the lawn behind it, 2 cm a step
    const c = insidePlot("pool");
    const start = freeSpot({ x: c.x * 1.6, z: c.z * 1.6 });
    const p = { ...start };
    for (let i = 0; i < 4000; i++) {
      const d = Math.hypot(c.x - p.x, c.z - p.z) || 1;
      p.x += ((c.x - p.x) / d) * 0.02;
      p.z += ((c.z - p.z) / d) * 0.02;
      resolveSolids(p);
      expect(freeBlocked(p.x, p.z, 0.3)).toBe(false);
    }
    // a tap on the roof walks to a free spot beside the building
    const q = freeSpot(c);
    expect(freeBlocked(q.x, q.z, 0.3)).toBe(false);
  });

  it("keeps everyone inside the boundary wall", () => {
    expect(freeBlocked(0, 85)).toBe(true); // the public road
    expect(freeBlocked(0, -260)).toBe(true); // beyond the north arc
    const p = { x: 120, z: 79.9 };
    keepInCompound(p, { x: 120, z: 78 });
    expect(inCompound(p.x, p.z, 0.5)).toBe(true);
    // a tap beyond the wall walks to the nearest spot inside it
    const q = freeSpot({ x: 50, z: 120 });
    expect(inCompound(q.x, q.z, 0.6)).toBe(true);
  });

  it("makes the plaza's lava walls, the parked cars and the doors' neighbours solid", () => {
    expect(PERIMETER_STONES.length).toBeGreaterThan(3);
    const s = PERIMETER_STONES[0]!;
    expect(freeBlocked(s.x, s.z)).toBe(true);
    const car = PARKING_BAYS.find(carInBay)!;
    expect(freeBlocked(car.x, car.z)).toBe(true);
    // the inner halls' canopy fronts stop at the plaza edge: the plaza itself stays open
    for (const deg of [-88, -44, 0, 44, 88]) {
      const q = ringPoint(deg, PLAZA_RADIUS - 0.6);
      expect(freeBlocked(q.x, q.z, 0.25), `bearing ${deg}`).toBe(false);
    }
  });

  it("routes round a building instead of through it", () => {
    // from the lawn behind the Pool Hall to the lawn behind the Ludo Lounge's west side: the arena is in between
    const a = ringPoint(-60, 82);
    const b = ringPoint(28, 84);
    expect(segBlocked(a, b)).toBe(true);
    const route = planFreeRoute(a, b);
    expect(route.length).toBeGreaterThan(1);
    const end = route[route.length - 1]!;
    expect(Math.hypot(end.x - b.x, end.z - b.z)).toBeLessThan(0.01);
    let at = a;
    for (const w of route) {
      expect(segBlocked(at, w)).toBe(false);
      at = w;
    }
  });

  it("walks straight across open lawn", () => {
    const a = ringPoint(-80, 70);
    const b = ringPoint(-82, 90);
    expect(planFreeRoute(a, b)).toEqual([{ x: b.x, z: b.z }]);
  });
});
