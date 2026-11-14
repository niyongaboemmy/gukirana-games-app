import { describe, expect, it } from "vitest";
import { ARENA_BOWL, isValidArenaSeat } from "@gukirana/contracts";
import {
  ARENA_DOOR_Z,
  BOWL_SEATS,
  CONCOURSE,
  FLOOR_Y,
  LOWER_AISLES,
  SECTIONS,
  UPPER_AISLES,
  aisleSpot,
  angleOf,
  groundAt,
  polar,
  routeBetween,
  walkable,
  type P,
} from "./bowl";

/** every point along the straight legs of a route is walkable */
function routeWalkable(from: P, route: P[], floor = false) {
  let at = from;
  for (const p of route) {
    const n = Math.max(2, Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.1));
    for (let k = 0; k <= n; k++) {
      const x = at.x + ((p.x - at.x) * k) / n;
      const z = at.z + ((p.z - at.z) * k) / n;
      if (!walkable(x, z, floor)) return { x, z };
    }
    at = p;
  }
  return null;
}

describe("arena bowl (P2-ARN-03)", () => {
  it("builds exactly the contract's seats: 12 × 6 × 10 + 8 × 5 × 12 + 4 × 6, all valid and unique", () => {
    const n = (t: { sections: readonly string[]; rows: number; seats: number }) => t.sections.length * t.rows * t.seats;
    expect(BOWL_SEATS.length).toBe(n(ARENA_BOWL.lower) + n(ARENA_BOWL.upper) + n(ARENA_BOWL.vip));
    expect(BOWL_SEATS.length).toBe(1224);
    for (const s of BOWL_SEATS) expect(isValidArenaSeat(s.id), s.id).toBe(true);
    expect(new Set(BOWL_SEATS.map((s) => s.id)).size).toBe(BOWL_SEATS.length);
  });

  it("no two seats overlap (≥ 0.5 m apart) and every seat faces the floor", () => {
    for (let i = 0; i < BOWL_SEATS.length; i++) {
      const a = BOWL_SEATS[i]!;
      // forward points at the centre
      expect(Math.sin(a.yaw) * -a.x + Math.cos(a.yaw) * -a.z).toBeGreaterThan(0.99 * Math.hypot(a.x, a.z));
      for (let j = i + 1; j < BOWL_SEATS.length; j++) {
        const b = BOWL_SEATS[j]!;
        if (Math.abs(a.y - b.y) > 0.2) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThan(0.5);
      }
    }
  });

  it("seat rows are not walkable, the stair aisles and the concourse are", () => {
    for (const s of BOWL_SEATS) expect(walkable(s.x, s.z), s.id).toBe(false);
    // and the stand point in front of each seat is on its row (reached by the staged sit, not by walking)
    for (const a of LOWER_AISLES) for (const r of [13, 15, 17]) expect(walkable(polar(r, a).x, polar(r, a).z), `lower aisle ${a} @ ${r}`).toBe(true);
    for (const a of UPPER_AISLES) for (const r of [20.8, 22.5, 24.3]) expect(walkable(polar(r, a).x, polar(r, a).z), `upper aisle ${a} @ ${r}`).toBe(true);
    for (let a = 0; a < 360; a += 5) expect(walkable(polar(CONCOURSE.mid, a).x, polar(CONCOURSE.mid, a).z)).toBe(true);
  });

  it("the floor is for participants only", () => {
    expect(walkable(0, 0)).toBe(false);
    expect(walkable(0, 0, true)).toBe(true);
    expect(walkable(0, -15)).toBe(false); // players' tunnel
    expect(walkable(0, -15, true)).toBe(true);
    expect(groundAt(0, 5)).toBeCloseTo(FLOOR_Y, 5);
  });

  it("the lower bowl falls towards the floor, the upper tier rises outward", () => {
    for (const a of LOWER_AISLES) expect(groundAt(polar(13, a).x, polar(13, a).z)).toBeLessThan(groundAt(polar(16.5, a).x, polar(16.5, a).z));
    for (const a of UPPER_AISLES) expect(groundAt(polar(21, a).x, polar(21, a).z)).toBeLessThan(groundAt(polar(24, a).x, polar(24, a).z));
    expect(groundAt(0, ARENA_DOOR_Z - 2)).toBe(0);
  });

  it("from the door, every seat's aisle spot is reachable along walkable straight legs, and back out", () => {
    const door = { x: 0, z: ARENA_DOOR_Z - 1.5 };
    for (const sec of SECTIONS) {
      const seats = BOWL_SEATS.filter((s) => s.table === sec.id);
      for (const s of [seats[0]!, seats[seats.length - 1]!]) {
        const spot = aisleSpot(s);
        expect(walkable(spot.x, spot.z), `${s.id} spot`).toBe(true);
        const r = routeBetween(door, spot);
        expect(r.at(-1)).toEqual(spot);
        expect(routeWalkable(door, r), `${s.id} in (θ ${angleOf(spot.x, spot.z).toFixed(1)})`).toBeNull();
        const out = routeBetween(spot, { x: 0, z: ARENA_DOOR_Z + 1.2 });
        expect(routeWalkable(spot, out), `${s.id} out`).toBeNull();
      }
    }
  });

  it("aisle to aisle across the bowl (lower ↔ upper ↔ VIP) stays walkable", () => {
    const pts = [aisleSpot(BOWL_SEATS.find((s) => s.id === "C-2-1")!), aisleSpot(BOWL_SEATS.find((s) => s.id === "U6-4-12")!), aisleSpot(BOWL_SEATS.find((s) => s.id === "V3-1-1")!)];
    for (const a of pts) for (const b of pts) if (a !== b) expect(routeWalkable(a, routeBetween(a, b))).toBeNull();
  });
});
