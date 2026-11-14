import { describe, expect, it } from "vitest";
import { ADMIN_SEAT_IDS, OFFICE_CAPACITY, parseAdminSeat, SEED_OFFICES } from "@gukirana/contracts";
import { HALLS } from "@/rooms/layouts";
import {
  ADMIN_COLLIDERS,
  ADMIN_SEATS,
  ADMIN_WALLS,
  atOfficerDesk,
  doorFront,
  doorInside,
  doorRect,
  EXIT_POINT,
  FRONT_Z,
  OFFICE_PLANS,
  officerChair,
  officerMonitor,
  officeAt,
  RECEPTION,
  RECEPTION_TALK,
  routeBetween,
  SCREEN_Z,
  visitorApproach,
  zoneOf,
  type P,
} from "./plan";

describe("Administrative Block seats (P2-ADM-04)", () => {
  it("has every contract seat, in order, with the right office and kind", () => {
    expect(ADMIN_SEATS.map((s) => s.id)).toEqual([...ADMIN_SEAT_IDS]);
    expect(HALLS.admin.seats.map((s) => s.id)).toEqual([...ADMIN_SEAT_IDS]);
    for (const s of ADMIN_SEATS) {
      const p = parseAdminSeat(s.id)!;
      expect(p.kind).toBe(s.kind);
      if (p.kind !== "lobby") {
        expect(s.table).toBe(p.office);
        // office chairs stand inside their own office
        expect(officeAt(s.x, s.z)?.id).toBe(p.office);
        expect(s.z).toBeLessThan(FRONT_Z);
      } else expect(zoneOf(s.x, s.z).kind).toBe("lobby");
    }
    for (const o of OFFICE_PLANS) expect(ADMIN_SEATS.filter((s) => s.table === o.id && s.kind === "visitor")).toHaveLength(OFFICE_CAPACITY);
  });
  it("visitor chairs face the officer across the desk; the stand-up strip and the approach are clear", () => {
    for (const o of OFFICE_PLANS) {
      const off = ADMIN_SEATS.find((s) => s.id === `${o.id}-officer`)!;
      expect(off).toMatchObject({ ...officerChair(o), yaw: 0 });
      for (const v of ADMIN_SEATS.filter((s) => s.table === o.id && s.kind === "visitor")) {
        expect(Math.cos(v.yaw)).toBeCloseTo(-1); // facing north, towards the desk
        expect(v.z).toBeGreaterThan(off.z + 1.5);
        // where the staged sit stands you (in front of the chair) is free of walls and desks
        const stand = { x: v.x + Math.sin(v.yaw) * 0.41, z: v.z + Math.cos(v.yaw) * 0.41 };
        expect(hits(stand, [...ADMIN_WALLS, ...ADMIN_COLLIDERS.filter((r) => Math.abs(r.x - v.x) > 0.3 || Math.abs(r.z - v.z) > 0.3)])).toBe(false);
      }
      for (const side of [-1, 1]) expect(hits(visitorApproach(o, { x: o.cx + side, z: -4 }), [...ADMIN_WALLS, ...ADMIN_COLLIDERS])).toBe(false);
      // the computer: on the officer's desk, facing the chair; behind the desk counts as "at the computer"
      const m = officerMonitor(o);
      expect(m.z).toBeGreaterThan(off.z);
      expect(Math.abs(m.x - off.x)).toBeLessThan(0.7);
      expect(atOfficerDesk(o, { x: off.x, z: off.z + 0.1 })).toBe(true);
      expect(atOfficerDesk(o, { x: o.cx, z: -6 })).toBe(false);
    }
  });
  it("the reception talk point is in front of the counter, reachable", () => {
    expect(RECEPTION_TALK.z).toBeGreaterThan(RECEPTION.z + RECEPTION.d / 2);
    expect(hits(RECEPTION_TALK, [...ADMIN_WALLS, ...ADMIN_COLLIDERS])).toBe(false);
  });
});

const BODY = 0.32;
const hits = (p: P, rects: { x: number; z: number; w: number; d: number }[]) => rects.some((r) => Math.abs(p.x - r.x) < r.w / 2 + BODY - 0.02 && Math.abs(p.z - r.z) < r.d / 2 + BODY - 0.02);
/** every leg of a route is a straight line clear of walls and furniture */
function clear(from: P, route: P[], extra: { x: number; z: number; w: number; d: number }[] = []) {
  let at = from;
  for (const p of route) {
    const n = Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.1);
    for (let i = 1; i <= n; i++) {
      const q = { x: at.x + ((p.x - at.x) * i) / n, z: at.z + ((p.z - at.z) * i) / n };
      if (hits(q, [...ADMIN_WALLS, ...ADMIN_COLLIDERS, ...extra])) return q;
    }
    at = p;
  }
  return null;
}

describe("Administrative Block plan", () => {
  it("has the four seeded offices with closed doors on the corridor, inside a 36 × 28 m hall", () => {
    expect(OFFICE_PLANS.map((o) => o.id)).toEqual(SEED_OFFICES.map((o) => o.id));
    expect(HALLS.admin.size.w).toBe(36);
    expect(HALLS.admin.size.d).toBe(28);
    expect(HALLS.admin.tables).toHaveLength(0);
    expect(HALLS.admin.walls).toBe(ADMIN_WALLS);
    for (const o of OFFICE_PLANS) {
      expect(zoneOf(doorFront(o).x, doorFront(o).z).kind).toBe("corridor");
      const inside = zoneOf(doorInside(o).x, doorInside(o).z);
      expect(inside.kind === "office" && inside.office.id).toBe(o.id);
    }
  });

  it("routes from the entrance to every office and back out are clear of walls and furniture", () => {
    const entry = { x: 0, z: 14 - 1.2 };
    for (const o of OFFICE_PLANS) {
      const there = routeBetween(entry, { x: o.cx, z: -6.5 });
      expect(clear(entry, there), `in to ${o.id}`).toBeNull();
      const back = routeBetween({ x: o.cx, z: -6.5 }, EXIT_POINT);
      expect(clear({ x: o.cx, z: -6.5 }, back), `out of ${o.id}`).toBeNull();
      // office to office along the corridor
      for (const p of OFFICE_PLANS) if (p !== o) expect(clear({ x: o.cx, z: -6.5 }, routeBetween({ x: o.cx, z: -6.5 }, { x: p.cx, z: -6.5 }))).toBeNull();
    }
  });

  it("a closed door blocks the way in: the office is reachable only through its door", () => {
    for (const o of OFFICE_PLANS) {
      const r = routeBetween(doorFront(o), { x: o.cx, z: -6.5 });
      expect(clear(doorFront(o), r, [doorRect(o)])).not.toBeNull();
    }
    // the corridor screen keeps the lobby and the corridor apart except at the opening
    expect(hits({ x: 10, z: SCREEN_Z }, ADMIN_WALLS)).toBe(true);
    expect(hits({ x: 0, z: SCREEN_Z }, ADMIN_WALLS)).toBe(false);
    expect(hits({ x: OFFICE_PLANS[0]!.cx + 2, z: FRONT_Z }, ADMIN_WALLS)).toBe(true);
  });
});
