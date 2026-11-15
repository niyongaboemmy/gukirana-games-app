import { describe, expect, it } from "vitest";
import { clearance, hallAisles, ringObstacles } from "./aisles";
import { RINGS } from "./plan";

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

  it("reports every aisle", () => {
    const a = hallAisles();
    console.info(a.map((x) => `${x.id}: clear ${x.clear} band ${x.band}`).join("\n"));
    expect(a.some((x) => x.kind === "column")).toBe(true);
    expect(a.some((x) => x.kind === "row")).toBe(true);
  });
});
