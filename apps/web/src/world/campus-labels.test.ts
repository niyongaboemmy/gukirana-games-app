import { describe, expect, it } from "vitest";
import { inBuilding, PLOTS, toLocal } from "./footprints";
import { PORTALS } from "./layout";
import { FIGHT_BUILDING } from "@/fight/plan";
import { campusLabels } from "./campus-labels";

const labels = campusLabels();
/** is the world point inside one of the plot's own footprint rectangles? */
function inPlot(id: string, x: number, z: number) {
  const p = PLOTS.find((q) => q.id === id)!;
  const l = toLocal(p.angleDeg, x, z, p.ring);
  return p.rects.some((f) => l.x > f.x0 && l.x < f.x1 && l.z < f.z0 && l.z > f.z1);
}

describe("campus aerial labels sit over their own buildings (P2-WLD-16)", () => {
  it("puts every building's name inside that building's footprint, never over another building", () => {
    const named = PORTALS.filter((p) => p.kind !== "soon");
    expect(named.length).toBeGreaterThan(4);
    for (const p of named) {
      const l = labels.find((q) => q.key === p.id)!;
      expect(l, p.id).toBeTruthy();
      expect(inPlot(p.id, l.x, l.z), `${p.label} over its own footprint`).toBe(true);
      for (const o of PLOTS) if (o.id !== p.id) expect(inPlot(o.id, l.x, l.z), `${p.label} not over ${o.id}`).toBe(false);
    }
  });

  it("keeps the Pool Hall's name off the Tournament Arena (the reported bug)", () => {
    const pool = labels.find((q) => q.key === "pool")!;
    expect(inPlot("arena", pool.x, pool.z)).toBe(false);
    expect(inPlot("pool", pool.x, pool.z)).toBe(true);
  });

  it("labels the Fight Games building over the Boxing hall's long body", () => {
    const f = labels.find((q) => q.key === "fight")!;
    const p = PLOTS.find((q) => q.id === "fight")!;
    const l = toLocal(p.angleDeg, f.x, f.z, p.ring);
    expect(l.z).toBeLessThan(FIGHT_BUILDING.front);
  });

  it("puts the help desk over the service pavilion and the district names over open lawn", () => {
    const h = labels.find((q) => q.key === "help")!;
    expect(inPlot("service", h.x, h.z)).toBe(true);
    for (const l of labels.filter((q) => q.key.startsWith("d-"))) expect(inBuilding(l.x, l.z, 2), l.key).toBe(false);
  });

  it("floats each building name just above its roof (lower than before: no parallax onto a neighbour)", () => {
    for (const l of labels.filter((q) => PORTALS.some((p) => p.id === q.key))) expect(l.y).toBeLessThanOrEqual(26);
  });
});
