import { describe, expect, it } from "vitest";
import { HALL_SEATING, isValidSeat } from "@gukirana/contracts";
import { HALLS, IGISORO_STOOL_Z, LUDO_POUF, POOL_CUE_CLEARANCE, type HallLayout } from "./layouts";
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

  const ludo = HALLS.ludo;
  it("ludo: about 2× the old lounge, 12–16 tables, two player chairs each, door centred on the south wall", () => {
    expect(ludo.size.w * ludo.size.d).toBeGreaterThanOrEqual(2 * 24 * 18);
    expect(ludo.size.w).toBeGreaterThanOrEqual(32);
    expect(ludo.size.w).toBeLessThanOrEqual(36);
    expect(ludo.size.d).toBeGreaterThanOrEqual(26);
    expect(ludo.size.d).toBeLessThanOrEqual(28);
    expect(ludo.tables.length).toBeGreaterThanOrEqual(12);
    expect(ludo.tables.length).toBeLessThanOrEqual(16);
    expect(ludo.door).toEqual({ x: 0, w: 2.6 });
    for (const t of ludo.tables) {
      const chairs = ludo.seats.filter((s) => s.table === t.id);
      expect(chairs).toHaveLength(2);
      // the two players face each other across the board
      expect(Math.abs(chairs[0]!.x - chairs[1]!.x)).toBeLessThan(1e-6);
      expect(Math.abs(Math.abs(chairs[0]!.yaw - chairs[1]!.yaw) - Math.PI)).toBeLessThan(1e-6);
    }
  });

  it("ludo: nothing overlaps — tables, chairs, poufs, furniture and walls keep a walkable gap", () => {
    const chair = (s: { x: number; z: number; table: string }) => ({ x: s.x, z: s.z, w: 0.76, d: 0.76, own: s.table });
    const things: { x: number; z: number; w: number; d: number; id?: string; own?: string }[] = [...ludo.tables, ...ludo.colliders, ...ludo.seats.map(chair)];
    for (let i = 0; i < things.length; i++) {
      const a = things[i]!;
      expect(Math.abs(a.x) + a.w / 2, `${a.x},${a.z} inside the walls`).toBeLessThanOrEqual(ludo.size.w / 2);
      expect(Math.abs(a.z) + a.d / 2, `${a.x},${a.z} inside the walls`).toBeLessThanOrEqual(ludo.size.d / 2);
      for (let j = i + 1; j < things.length; j++) {
        const b = things[j]!;
        const gap = Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
        // an armchair is tucked up to its own table (no overlap); everything else keeps a gap
        const own = (a.id && a.id === b.own) || (b.id && b.id === a.own);
        expect(gap, `${a.x},${a.z} vs ${b.x},${b.z}`).toBeGreaterThan(own ? 0 : 0.1);
      }
    }
    // a pouf beside every table, clear of the board
    for (const t of ludo.tables) expect(ludo.colliders.some((c) => Math.abs(c.x - (t.x + LUDO_POUF.x)) < 1e-6 && c.z === t.z)).toBe(true);
  });

  it("ludo: aisles and cross aisles are free of tables, chairs and furniture; the door band is open", () => {
    expect(ludo.aisles).toContain(0);
    expect(ludo.aisles.length).toBeGreaterThanOrEqual(5);
    const inner = (f: { z: number }) => f.z > -ludo.size.d / 2 + 1.5 && f.z < ludo.size.d / 2 - 1.5;
    for (const a of ludo.aisles) {
      for (const t of ludo.tables) expect(Math.abs(t.x - a)).toBeGreaterThan(t.w / 2 + 1.05);
      for (const s of ludo.seats) expect(Math.abs(s.x - a)).toBeGreaterThan(0.38 + 0.35);
      for (const f of ludo.colliders) if (inner(f)) expect(Math.abs(f.x - a) > f.w / 2 + 0.35, `aisle ${a} vs ${f.x},${f.z}`).toBe(true);
    }
    const lanes = ludo.lanes ?? [];
    expect(lanes.length).toBeGreaterThanOrEqual(ludo.tables.length / 4);
    const x0 = Math.min(...ludo.aisles);
    const x1 = Math.max(...ludo.aisles);
    for (const l of lanes) {
      for (const t of ludo.tables) expect(Math.abs(t.z - l)).toBeGreaterThan(t.d / 2 + 0.6);
      // chair body (≈ 0.38 m) + a walking body (0.32 m) never reaches into the lane
      for (const s of ludo.seats) expect(Math.abs(s.z - l), `lane ${l} vs ${s.id}`).toBeGreaterThan(0.38 + 0.32 + 0.1);
      for (const f of ludo.colliders) if (f.x + f.w / 2 > x0 && f.x - f.w / 2 < x1) expect(Math.abs(f.z - l) > f.d / 2 + 0.32, `lane ${l} vs ${f.x},${f.z}`).toBe(true);
    }
    const lastChair = Math.max(...ludo.seats.map((s) => s.z));
    expect(ludo.spawn.z).toBeGreaterThan(lastChair + 0.8);
    // nothing stands in the foyer between the front tables and the door
    for (const f of ludo.colliders) if (Math.abs(f.x) < 9.6) expect(f.z < ludo.size.d / 2 - 2.6, `foyer vs ${f.x},${f.z}`).toBe(true);
  });

  it("ludo: table status and free-chair picking with two player chairs per table", () => {
    const seats = { t3s1: "A", t9s0: "B", t9s1: "C" };
    const st = tableStatuses(ludo, seats);
    expect(st.t3).toBe("waiting");
    expect(st.t9).toBe("playing");
    expect(st.t0).toBe("free");
    expect(freeChair(ludo, "t3", seats, "me", 0, 0)?.id).toBe("t3s0");
    expect(freeChair(ludo, "t9", seats, "me", 0, 0)).toBeNull();
    const t = nearestTable(ludo, st, "free", 0, ludo.spawn.z);
    expect(t && st[t.id]).toBe("free");
    expect(tableAt(ludo, ludo.tables[6]!.x + 0.4, ludo.tables[6]!.z)?.id).toBe("t6");
    expect(tableAt(ludo, 0, ludo.size.d / 2 - 1)).toBeNull();
  });

  const igi = HALLS.igisoro;
  it("igisoro: big court (≥ 2× the old 24 × 18 m), 12–16 tables × 2 stools, door centred on the south wall", () => {
    expect(igi.size.w * igi.size.d).toBeGreaterThanOrEqual(2 * 24 * 18);
    expect(igi.tables.length).toBeGreaterThanOrEqual(12);
    expect(igi.tables.length).toBeLessThanOrEqual(16);
    expect(igi.seats.length).toBe(igi.tables.length * 2);
    expect(igi.door).toEqual({ x: 0, w: 2.6 });
    // the two players face each other across the long sides of the board
    for (const t of igi.tables) {
      const [a, b] = igi.seats.filter((s) => s.table === t.id);
      expect(a!.z - t.z).toBeCloseTo(IGISORO_STOOL_Z);
      expect(b!.z - t.z).toBeCloseTo(-IGISORO_STOOL_Z);
      expect(Math.abs(a!.yaw)).toBeCloseTo(Math.PI); // s0 (south) faces north, towards the table
    }
  });

  it("igisoro: ≥ 1.2 m walkway between table clusters; nothing inside a cluster; all inside the walls", () => {
    // a cluster = the table plus its two stools (≈ 0.5 m round) and the knee gap
    const cluster = (t: { x: number; z: number; w: number }) => ({ x: t.x, z: t.z, w: t.w, d: 2 * IGISORO_STOOL_Z + 0.5 });
    for (const t of igi.tables) {
      const c = cluster(t);
      const zone = { ...c, w: c.w + 2 * 1.2, d: c.d + 2 * 1.2 };
      for (const o of igi.tables) if (o !== t) expect(overlaps({ ...zone, w: c.w + 1.2, d: c.d + 1.2 }, cluster(o)), `${t.id} vs ${o.id}`).toBe(false);
      for (const f of igi.colliders) expect(overlaps({ ...c, w: c.w + 2.0, d: c.d + 2.0 }, f), `${t.id} vs collider at ${f.x},${f.z}`).toBe(false);
      expect(Math.abs(t.x) + zone.w / 2).toBeLessThan(igi.size.w / 2);
      expect(Math.abs(t.z) + zone.d / 2).toBeLessThan(igi.size.d / 2);
    }
  });

  it("igisoro: the aisles are table-, stool- and furniture-free and reach the open band in front of the door", () => {
    expect(igi.aisles.length).toBeGreaterThanOrEqual(4);
    for (const a of igi.aisles) {
      expect(Math.abs(a)).toBeLessThan(igi.size.w / 2 - 0.6);
      for (const t of igi.tables) expect(Math.abs(t.x - a)).toBeGreaterThan(t.w / 2 + 1.05);
      for (const s of igi.seats) expect(Math.abs(s.x - a)).toBeGreaterThan(0.28 + 0.35);
      for (const f of igi.colliders) if (f.z > -igi.size.d / 2 + 1.5 && f.z < igi.size.d / 2 - 1.5) expect(Math.abs(f.x - a) > f.w / 2 + 0.35, `aisle ${a} vs ${f.x},${f.z}`).toBe(true);
    }
    const lastChair = Math.max(...igi.seats.map((s) => s.z));
    expect(igi.size.d / 2 - 2.4).toBeGreaterThan(lastChair + 0.8);
    // the band in front of the door (the last leg of the Leave route) is free of furniture except the corner plants
    for (const f of igi.colliders) if (f.z + f.d / 2 > igi.size.d / 2 - 2.8) expect(Math.abs(f.x), `${f.x},${f.z}`).toBeGreaterThan(igi.size.w / 2 - 1.2);
  });

  it("igisoro: the stand point in front of each stool is outside the table's collision box (the staged sit can reach it)", () => {
    const chairR = 0.28;
    for (const s of igi.seats) {
      const t = igi.tables.find((x) => x.id === s.table)!;
      const sz = s.z + Math.cos(s.yaw) * (chairR + 0.13);
      expect(Math.abs(sz - t.z)).toBeGreaterThan(t.d / 2 + 0.32 - 0.05);
    }
  });

  it("igisoro: table status and free-chair picking work for this hall too", () => {
    const seats = { t0s0: "A", t5s0: "B", t5s1: "C" };
    const st = tableStatuses(igi, seats);
    expect(st.t0).toBe("waiting");
    expect(st.t5).toBe("playing");
    expect(st.t15).toBe("free");
    expect(freeChair(igi, "t0", seats, "me", 0, 0)?.id).toBe("t0s1");
    expect(freeChair(igi, "t5", seats, "me", 0, 0)).toBeNull();
    const t = nearestTable(igi, st, "free", 0, igi.size.d / 2);
    expect(t && st[t.id]).toBe("free");
    expect(tableAt(igi, igi.tables[9]!.x + 0.7, igi.tables[9]!.z)?.id).toBe("t9");
    expect(tableAt(igi, 0, igi.size.d / 2 - 1)).toBeNull();
  });
});
