import { describe, expect, it } from "vitest";
import { HALL_SEATING, isValidSeat } from "@gukirana/contracts";
import { HALLS, POOL_CUE_CLEARANCE, type HallLayout } from "./layouts";
import { freeChair, nearestTable, tableAt, tableStatuses } from "./table-status";

const overlaps = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;

describe("hall layouts", () => {
  it.each(Object.values(HALLS))("$game: seats match the server's seat contract", (L: HallLayout) => {
    const spec = HALL_SEATING[L.game];
    expect(L.tables.length).toBe(spec.tables);
    expect(L.seats.length).toBe(spec.tables * spec.chairs);
    for (const s of L.seats) expect(isValidSeat(L.game, s.id)).toBe(true);
    expect(new Set(L.seats.map((s) => s.id)).size).toBe(L.seats.length);
  });

  const pool = HALLS.pool;
  it("pool: big hall, 10–16 tables, door centred on the south wall", () => {
    expect(pool.size.w * pool.size.d).toBeGreaterThanOrEqual(2 * 24 * 18);
    expect(pool.tables.length).toBeGreaterThanOrEqual(10);
    expect(pool.tables.length).toBeLessThanOrEqual(16);
    expect(pool.door.x).toBe(0);
  });

  it("pool: 1.5 m cue clearance round every table — no other table, chair, furniture or wall inside it", () => {
    const c = POOL_CUE_CLEARANCE;
    for (const t of pool.tables) {
      const zone = { x: t.x, z: t.z, w: t.w + 2 * c, d: t.d + 2 * c };
      for (const o of pool.tables) if (o !== t) expect(overlaps(zone, o), `${t.id} vs ${o.id}`).toBe(false);
      for (const f of pool.colliders) expect(overlaps(zone, f), `${t.id} vs collider at ${f.x},${f.z}`).toBe(false);
      // chairs (≈ 0.8 m round, the seat point is the chair centre) stand outside every table's zone
      for (const s of pool.seats) expect(overlaps(zone, { x: s.x, z: s.z, w: 0.76, d: 0.76 }), `${t.id} vs chair ${s.id}`).toBe(false);
      expect(Math.abs(t.x) + zone.w / 2).toBeLessThan(pool.size.w / 2);
      expect(Math.abs(t.z) + zone.d / 2).toBeLessThan(pool.size.d / 2);
    }
  });

  it("pool: the aisles are table- and chair-free and reach the open band in front of the door", () => {
    expect(pool.aisles).toContain(0);
    for (const a of pool.aisles) {
      for (const t of pool.tables) expect(Math.abs(t.x - a)).toBeGreaterThan(t.w / 2 + 1.05);
      for (const s of pool.seats) expect(Math.abs(s.x - a)).toBeGreaterThan(0.42 + 0.35);
      for (const f of pool.colliders) if (f.z > -pool.size.d / 2 + 1.5 && f.z < pool.size.d / 2 - 1.5) expect(Math.abs(f.x - a) > f.w / 2 + 0.35, `aisle ${a} vs ${f.x},${f.z}`).toBe(true);
    }
    const lastChair = Math.max(...pool.seats.map((s) => s.z));
    expect(pool.size.d / 2 - 2.4).toBeGreaterThan(lastChair + 0.8);
  });

  it("pool: table status from the claimed seats (free / waiting / playing) and free-chair picking", () => {
    const seats = { t0s0: "A", t1s0: "B", t1s1: "C" };
    const st = tableStatuses(pool, seats);
    expect(st.t0).toBe("waiting");
    expect(st.t1).toBe("playing");
    expect(st.t2).toBe("free");
    expect(freeChair(pool, "t0", seats, "me", 0, 0)?.id).toBe("t0s1");
    expect(freeChair(pool, "t0", seats, "A", 0, 0)).not.toBeNull();
    expect(freeChair(pool, "t1", seats, "me", 0, 0)).toBeNull();
    const t = nearestTable(pool, st, "free", 0, pool.size.d / 2);
    expect(t && st[t.id]).toBe("free");
    expect(tableAt(pool, pool.tables[5]!.x + 1, pool.tables[5]!.z)?.id).toBe("t5");
    expect(tableAt(pool, 0, pool.size.d / 2 - 1)).toBeNull();
  });
});
