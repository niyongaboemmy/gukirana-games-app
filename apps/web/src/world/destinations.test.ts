import { describe, expect, it } from "vitest";
import { PLAZA_RADIUS, PORTALS, SPAWN } from "./layout";
import { walkDepth } from "./campus";
import { DESTINATIONS, destDistance, destination, destRoute, FEATURED, FIRST_VISIT_DEST, pathLength, routeHeading } from "./destinations";
import { walkPlan } from "./goto-walk";
import { GO } from "@/hud/goto-strings";

describe("Go To destinations (P2-WLD-13)", () => {
  it("lists every hall door once, the featured ones first, and every place has a name", () => {
    const halls = DESTINATIONS.filter((d) => d.group === "halls");
    expect(halls.map((d) => d.id).sort()).toEqual(PORTALS.map((p) => p.id).sort());
    expect(halls.slice(0, FEATURED.length).map((d) => d.id)).toEqual([...FEATURED]);
    expect(FEATURED).toContain("fight");
    expect(destination(FIRST_VISIT_DEST)).not.toBeNull();
    for (const d of DESTINATIONS) expect(GO.dest[d.label], d.id).toBeTruthy();
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
  });

  it("routes from the spawn to every destination over walkable ground, ending at its stop", () => {
    for (const d of DESTINATIONS) {
      const pts = destRoute(SPAWN, d);
      expect(pts[0]).toEqual({ x: SPAWN.x, z: SPAWN.z });
      const end = pts[pts.length - 1]!;
      expect(Math.hypot(end.x - d.stop.x, end.z - d.stop.z), d.id).toBeLessThan(0.01);
      for (let i = 1; i < pts.length; i++)
        for (let t = 0; t <= 1; t += 0.05) {
          const x = pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t;
          const z = pts[i - 1]!.z + (pts[i]!.z - pts[i - 1]!.z) * t;
          if (Math.hypot(x, z) > PLAZA_RADIUS - 0.5) expect(walkDepth(x, z).depth, `${d.id} at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(0);
        }
      expect(routeHeading(pts), d.id).not.toBeNull();
    }
  });

  it("Fight Games: ≤ 135 m from the spawn, the distance shown is the route's", () => {
    const fight = destination("fight")!;
    const L = pathLength(destRoute(SPAWN, fight));
    expect(L).toBeLessThanOrEqual(135);
    const shown = destDistance(SPAWN, fight);
    expect(Math.abs(shown.m - L)).toBeLessThanOrEqual(2.5);
    expect(shown.s).toBe(Math.round(L / 2.2));
  });

  it("Walk there goes to the doorstep, then through the door only when it opens for you", () => {
    for (const id of ["fight", "pool", "arena"] as const) {
      const d = destination(id)!;
      const open = walkPlan(SPAWN, d, true);
      expect(open[open.length - 1]).toEqual(d.through);
      const shut = walkPlan(SPAWN, d, false);
      const last = shut[shut.length - 1]!;
      expect(Math.hypot(last.x - d.stop.x, last.z - d.stop.z), id).toBeLessThan(1.5);
    }
  });
});
