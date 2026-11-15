import { describe, expect, it } from "vitest";
import { clearance, hallAisles, ringObstacles } from "./aisles";
import { BOXING_SIZE, RINGS } from "./plan";

describe("Boxing hall aisle clearance (P3-FGT-11)", () => {
  it("measures the free width between obstacle boxes, station by station", () => {
    // a step on one side narrows a 3 m gap to 2 m at that station; the straight band is the same 2 m
    const low = [{ x0: -1, x1: 0, z0: 0, z1: 10 }];
    const high = [
      { x0: 3, x1: 4, z0: 0, z1: 10 },
      { x0: 2, x1: 3, z0: 4, z1: 5 },
    ];
    expect(clearance(low, high, "x", 0, 10)).toEqual({ clear: 2, band: 2 });
    // a step on each side, at different stations: each station keeps 2 m, the straight band only 1 m
    const low2 = [...low, { x0: 0, x1: 1, z0: 7, z1: 8 }];
    const c = clearance(low2, high, "x", 0, 10);
    expect(c.clear).toBeCloseTo(2);
    expect(c.band).toBeCloseTo(1);
  });

  it("a standard ring's obstacles: the rail square, both corner steps and the corner kit", () => {
    const r = RINGS.find((q) => !q.feature)!;
    expect(ringObstacles(r)).toHaveLength(1 + 2 * 6);
  });

  it("every walking aisle lets two adults pass: ≥ 2.4 m clear and straight, main and front cross aisles ≥ 3 m", () => {
    const a = hallAisles();
    // 2 blocks × (4 column + 2 row aisles), 2 main, front cross, back, 2 end strips
    expect(a).toHaveLength(2 * (4 + 2) + 2 + 1 + 1 + 2);
    for (const x of a) {
      const min = x.kind === "main" || x.kind === "cross" ? 3 : 2.4;
      expect(x.clear, `${x.id} clear`).toBeGreaterThanOrEqual(min);
      expect(x.band, `${x.id} straight band`).toBeGreaterThanOrEqual(min);
    }
  });

  it("no two rings' obstacles touch (rails, steps, kit), and none reaches a wall", () => {
    const rings = RINGS.filter((r) => !r.feature);
    const all = rings.map(ringObstacles);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        for (const p of all[i]!) for (const q of all[j]!) expect(p.x1 <= q.x0 || q.x1 <= p.x0 || p.z1 <= q.z0 || q.z1 <= p.z0, `${rings[i]!.id} ↔ ${rings[j]!.id}`).toBe(true);
    for (const b of all.flat()) {
      expect(Math.max(-b.x0, b.x1)).toBeLessThan(BOXING_SIZE.w / 2 - 2.4);
      expect(Math.max(-b.z0, b.z1)).toBeLessThan(BOXING_SIZE.d / 2 - 2.4);
    }
  });
});
