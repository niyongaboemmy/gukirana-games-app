import { describe, expect, it } from "vitest";
import { BOWL_SEATS, CONCOURSE, FLOOR_R, LOWER, LOWER_AISLES, SECTIONS, STAGE, STAIRS, UPPER, UPPER_AISLES, VIP, bowlSeat, groundAt, lowerTreadY, polar, upperTreadY, walkable, yawToCentre } from "./bowl";
import { C_MIN, SEATED_EYE, STAGE_TARGETS, seatEye, seatSightline, sightlineReport } from "./sightlines";

describe("arena sightlines (P2-HAL-11): every seat sees the whole stage", () => {
  it("all 1,224 seats: the stage centre and its four corners clear the structure and the heads in front (C ≥ 0.06 m)", () => {
    const r = sightlineReport();
    expect(r.seats).toBe(1224);
    expect(r.failed, JSON.stringify(r.failed.slice(0, 5))).toEqual([]);
  });

  it("VIP boxes have the best eye line: higher than every upper-tier front row, the box front well under it", () => {
    for (const s of BOWL_SEATS.filter((x) => x.table.startsWith("V"))) {
      expect(seatSightline(s, true)).toEqual([]);
      expect(seatEye(s).y).toBeGreaterThan(upperTreadY(1) + SEATED_EYE.h);
    }
    // the low glass front stays ≥ 0.3 m under the seated eye
    expect(VIP.floorY + SEATED_EYE.h - (VIP.floorY + 0.83)).toBeGreaterThanOrEqual(0.3);
  });

  it("the audit is real: a lowered eye in the back row is caught by the heads in front", () => {
    const s = bowlSeat("C-6-5")!;
    const low = { ...s, y: s.y - 0.45 };
    expect(seatSightline(low).length).toBeGreaterThan(0);
  });

  it("the stage fits the audit's assumptions (corners ≥ 4 m inside the front barrier)", () => {
    for (const t of STAGE_TARGETS) expect(FLOOR_R - Math.hypot(t.x, t.z)).toBeGreaterThanOrEqual(4);
    expect(STAGE.hw).toBeGreaterThan(0);
  });
});

describe("arena seats (P2-HAL-11 audit)", () => {
  it("evenly spaced along each row, never overlapping (≥ 0.5 m centre to centre, ≤ 2 cm spread)", () => {
    const rows = new Map<string, typeof BOWL_SEATS>();
    for (const s of BOWL_SEATS) {
      const k = `${s.table}-${s.row}`;
      rows.set(k, [...(rows.get(k) ?? []), s]);
    }
    for (const [k, seats] of rows) {
      seats.sort((a, b) => a.n - b.n);
      const gaps = seats.slice(1).map((s, i) => Math.hypot(s.x - seats[i]!.x, s.z - seats[i]!.z));
      if (!gaps.length) continue;
      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      expect(min, k).toBeGreaterThanOrEqual(k.startsWith("V") ? 0.62 : 0.5);
      expect(max - min, k).toBeLessThan(0.02);
    }
  });

  it("every seat faces the bowl centre and sits on its own tread / box floor", () => {
    for (const s of BOWL_SEATS) {
      expect(Math.abs(Math.atan2(Math.sin(s.yaw - yawToCentre(s.x, s.z)), Math.cos(s.yaw - yawToCentre(s.x, s.z))))).toBeLessThan(1e-9);
      const sec = SECTIONS.find((x) => x.id === s.table)!;
      const y = sec.tier === "lower" ? lowerTreadY(s.row) : sec.tier === "upper" ? upperTreadY(s.row) : VIP.floorY;
      expect(s.y).toBeCloseTo(y, 9);
      if (sec.tier === "lower") expect(s.r).toBeGreaterThan(LOWER.front + LOWER.depth * (s.row - 1) + 0.3);
      if (sec.tier === "upper") expect(s.r).toBeGreaterThan(UPPER.r0 + UPPER.depth * (s.row - 1) + 0.3);
    }
  });

  it("no seat stands on a walking line (aisles, stairs, legroom) and none blocks a stair", () => {
    for (const s of BOWL_SEATS) expect(walkable(s.x, s.z), s.id).toBe(false);
  });

  it("every walking line climbs in comfortable steps (≤ 0.2 m): lower aisles to the concourse, the stairs up from it", () => {
    const climb = (a: number, r0: number, r1: number) => {
      let last = groundAt(polar(r0, a).x, polar(r0, a).z);
      let worst = 0;
      for (let r = r0; r <= r1; r += 0.01) {
        const p = polar(r, a);
        const y = groundAt(p.x, p.z);
        worst = Math.max(worst, Math.abs(y - last));
        last = y;
      }
      return worst;
    };
    for (const a of LOWER_AISLES) expect(climb(a, LOWER.front + 0.05, CONCOURSE.r0 + 0.5), `lower aisle ${a}`).toBeLessThanOrEqual(0.2);
    for (const f of STAIRS) expect(climb(f.a, CONCOURSE.r0 + 0.5, f.r1 + 0.4), `stair ${f.a}`).toBeLessThanOrEqual(0.2);
    for (const a of UPPER_AISLES) expect(climb(a, CONCOURSE.mid, UPPER.r0 + UPPER.depth * (UPPER.rows - 1)), `upper aisle ${a}`).toBeLessThanOrEqual(0.25);
    expect(C_MIN).toBe(0.06);
  });
});
