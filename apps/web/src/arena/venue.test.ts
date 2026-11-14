import { describe, expect, it } from "vitest";
import type { ArenaStatus } from "@gukirana/contracts";
import {
  ARENA_DOOR_Z,
  BOWL_SEATS,
  CONCOURSE,
  FLOOR_Y,
  GANTRY,
  LOBBY,
  LOWER,
  LOWER_AISLES,
  RESTROOM,
  UPPER,
  UPPER_AISLES,
  UPPER_BACK,
  OUTER_R,
  groundAt,
  lowerTreadY,
  polar,
  routeBetween,
  seatFront,
  snapWalkable,
  walkable,
  type P,
} from "./bowl";
import { announcementFor, boxAt, countdown, crowdLevel, nearestSpot, PA, seatArrival, SPOTS, voiceRule } from "./venue";

/** every point along the straight legs of a route is walkable */
function routeOk(from: P, route: P[], floor = false) {
  let at = from;
  for (const p of route) {
    const n = Math.max(2, Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.08));
    for (let k = 0; k <= n; k++) {
      const x = at.x + ((p.x - at.x) * k) / n;
      const z = at.z + ((p.z - at.z) * k) / n;
      if (!walkable(x, z, floor)) return { x, z };
    }
    at = p;
  }
  return null;
}
const door = { x: 0, z: ARENA_DOOR_Z - 1.5 };

describe("arena: move anywhere (P2-ARN-04)", () => {
  it("every seat's front (the legroom of its row) is walkable and reachable from the door, and back out", () => {
    for (const s of BOWL_SEATS) {
      const f = seatFront(s);
      expect(walkable(f.x, f.z), `${s.id} front`).toBe(true);
    }
    // a sample across every section (first, middle, last seat of every row would be 1,224 routes: sample 3 per section)
    const bySection = new Map<string, typeof BOWL_SEATS>();
    for (const s of BOWL_SEATS) bySection.set(s.table, [...(bySection.get(s.table) ?? []), s]);
    for (const [, seats] of bySection)
      for (const s of [seats[0]!, seats[Math.floor(seats.length / 2)]!, seats[seats.length - 1]!]) {
        const f = seatFront(s);
        expect(routeOk(door, routeBetween(door, f)), `${s.id} in`).toBeNull();
        expect(routeOk(f, routeBetween(f, { x: 0, z: ARENA_DOOR_Z + 1.2 })), `${s.id} out`).toBeNull();
      }
  });

  it("along a row: from one seat to another of the same row, and to another row through the aisle", () => {
    const a = BOWL_SEATS.find((s) => s.id === "B-4-2")!;
    const b = BOWL_SEATS.find((s) => s.id === "B-4-9")!;
    const c = BOWL_SEATS.find((s) => s.id === "B-1-5")!;
    const u = BOWL_SEATS.find((s) => s.id === "U3-5-7")!;
    for (const [x, y] of [
      [a, b],
      [a, c],
      [c, u],
      [u, a],
    ])
      expect(routeOk(seatFront(x!), routeBetween(seatFront(x!), seatFront(y!))), `${x!.id} → ${y!.id}`).toBeNull();
  });

  it("stairs follow the real steps: two steps per row in the aisles, the tread height in the legroom", () => {
    for (const a of LOWER_AISLES.slice(0, 3)) {
      let prev = -Infinity;
      for (let r = LOWER.front + 0.05; r < CONCOURSE.r0; r += 0.05) {
        const y = groundAt(polar(r, a).x, polar(r, a).z);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9); // never goes down on the way up
        prev = y;
      }
      const half = (LOWER.depth * LOWER.slope) / 2;
      const y1 = groundAt(polar(LOWER.front + 0.1, a).x, polar(LOWER.front + 0.1, a).z);
      const y2 = groundAt(polar(LOWER.front + LOWER.depth * 0.75, a).x, polar(LOWER.front + LOWER.depth * 0.75, a).z);
      expect(y1).toBeCloseTo(lowerTreadY(1), 5);
      expect(y2 - y1).toBeCloseTo(half, 5);
    }
    for (const a of UPPER_AISLES) {
      const lo = groundAt(polar(UPPER.r0 + 0.2, a).x, polar(UPPER.r0 + 0.2, a).z);
      const hi = groundAt(polar(UPPER_BACK - 0.2, a).x, polar(UPPER_BACK - 0.2, a).z);
      expect(hi).toBeGreaterThan(lo + 1.5);
    }
    // the players' tunnel stair reaches the floor
    expect(groundAt(0, -12.2)).toBeCloseTo(FLOOR_Y, 5);
    expect(groundAt(0, -(CONCOURSE.r0 - 0.05))).toBeGreaterThan(-0.4);
  });

  it("the top walkway, the media gantry and the VIP boxes are walkable and reachable", () => {
    const walk = polar((UPPER_BACK + OUTER_R - 0.4) / 2, 30);
    expect(walkable(walk.x, walk.z)).toBe(true);
    expect(routeOk(door, routeBetween(door, walk))).toBeNull();
    const g = polar(GANTRY.r0 + 1.4, 170);
    expect(walkable(g.x, g.z)).toBe(true);
    expect(groundAt(g.x, g.z)).toBeCloseTo(GANTRY.y, 5);
    expect(routeOk(door, routeBetween(door, g))).toBeNull();
    const box = polar(24.2, 80);
    expect(walkable(box.x, box.z)).toBe(true);
    expect(routeOk(door, routeBetween(door, box))).toBeNull();
  });

  it("a tap anywhere snaps to a sensible walkable spot (a seat → its row's legroom)", () => {
    for (const s of BOWL_SEATS.filter((_, i) => i % 37 === 0)) {
      const p = snapWalkable({ x: s.x, z: s.z });
      expect(walkable(p.x, p.z), s.id).toBe(true);
      if (!s.table.startsWith("V")) expect(Math.hypot(p.x - s.x, p.z - s.z), s.id).toBeLessThan(1.2);
    }
    for (let a = 0; a < 360; a += 23) for (const r of [5, 13.7, 18.8, 21.4, 23.9, 25.5]) {
      const p = snapWalkable(polar(r, a));
      expect(walkable(p.x, p.z), `${r}@${a}`).toBe(true);
      expect(routeOk(door, routeBetween(door, p)), `route to ${r}@${a}`).toBeNull();
    }
  });

  it("restrooms open only during a visit; railings, walls and the floor block", () => {
    const inside = { x: -(LOBBY.hw + RESTROOM.depth / 2), z: (RESTROOM.z0 + RESTROOM.z1) / 2 };
    expect(walkable(inside.x, inside.z)).toBe(false);
    expect(walkable(inside.x, inside.z, { restroom: -1 })).toBe(true);
    expect(walkable(-(LOBBY.hw), RESTROOM.doorZ, { restroom: -1 })).toBe(true);
    expect(walkable(0, 0)).toBe(false); // floor (participants only)
    expect(walkable(polar(OUTER_R - 0.1, 40).x, polar(OUTER_R - 0.1, 40).z)).toBe(false); // the shell
  });
});

describe("arena: seat arrival", () => {
  const s = BOWL_SEATS.find((x) => x.id === "A-3-1")!;
  const f = seatFront(s);
  it("asks when close, or when the walk ran out nearby; cancels when it ran out far away", () => {
    expect(seatArrival(s.id, f, true)).toBe("ask");
    expect(seatArrival(s.id, { x: f.x + 0.9, z: f.z }, true)).toBe("ask");
    expect(seatArrival(s.id, { x: f.x + 2.0, z: f.z }, true)).toBe("wait");
    expect(seatArrival(s.id, { x: f.x + 2.0, z: f.z }, false)).toBe("ask");
    expect(seatArrival(s.id, { x: f.x + 8, z: f.z }, false)).toBe("cancel");
  });
});

describe("arena: venue state", () => {
  it("one interaction at a time; the desk only for staff", () => {
    const desk = SPOTS.find((x) => x.kind === "desk")!;
    expect(nearestSpot(desk.x, desk.z, { staff: false })).toBeNull();
    expect(nearestSpot(desk.x, desk.z, { staff: true })?.kind).toBe("desk");
    for (const sp of SPOTS) if (sp.kind !== "desk") expect(nearestSpot(sp.x, sp.z, { staff: false })?.id).toBe(sp.id);
    // spots stand on walkable ground (the desk on the floor: participants / staff)
    for (const sp of SPOTS) expect(walkable(sp.x, sp.z, sp.kind === "desk"), sp.id).toBe(true);
  });

  const ev = (status: string, id = "e1") => ({ id, title: "Cup", status, startsAt: new Date(Date.now() + 3e5).toISOString() }) as unknown as NonNullable<ArenaStatus["current"]>;
  const st = (current: ReturnType<typeof ev> | null, open = true) => ({ open, current, occupancy: { concourse: 3, seats: 1 } }) as unknown as ArenaStatus;
  it("PA announcements follow real status changes (none on first load)", () => {
    expect(announcementFor(null, st(ev("live")))).toBeNull();
    expect(announcementFor(st(ev("scheduled")), st(ev("doors_open")))).toBe(PA.doorsOpen("Cup"));
    expect(announcementFor(st(ev("doors_open")), st(ev("live")))).toBe(PA.live("Cup"));
    expect(announcementFor(st(ev("live")), st(null))).toBe(PA.ended("Cup"));
    expect(announcementFor(st(ev("live")), st(ev("live")))).toBeNull();
    expect(announcementFor(st(null), st(null, false))).toBe(PA.closed);
  });

  it("countdown text", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    expect(countdown("2026-11-14T10:04:05Z", now)?.text).toBe("4:05");
    expect(countdown("2026-11-14T10:30:00Z", now)?.text).toBe("30 min");
    expect(countdown("2026-11-14T09:00:00Z", now)).toBeNull();
  });

  it("crowd sound follows the REAL number of people and real reactions (an empty arena is quiet)", () => {
    const now = 100_000;
    expect(crowdLevel(1, [], now)).toEqual({ bed: 0, swell: 0 });
    const few = crowdLevel(5, [], now).bed;
    const many = crowdLevel(400, [], now).bed;
    expect(many).toBeGreaterThan(few);
    expect(crowdLevel(50, [now - 500, now - 900, now - 1500], now).swell).toBeGreaterThan(0);
    expect(crowdLevel(50, [now - 9000], now).swell).toBe(0);
  });

  it("VIP box voice: your box only (plus the PA); outside, normal proximity", () => {
    const inBox = polar(24, 80);
    expect(boxAt(inBox.x, inBox.z)).toBe("V1");
    expect(boxAt(0, 18.8)).toBeNull();
    expect(voiceRule({ box: "V1" }, { id: "a", box: "V1" }, null)).toEqual({ allow: true, room: true });
    expect(voiceRule({ box: "V1" }, { id: "b", box: null }, null).allow).toBe(false);
    expect(voiceRule({ box: null }, { id: "b", box: "V1" }, null).allow).toBe(false);
    expect(voiceRule({ box: null }, { id: "c", box: null }, "c")).toEqual({ allow: true, room: true });
  });
});
