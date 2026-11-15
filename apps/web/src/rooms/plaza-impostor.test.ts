import { describe, expect, it } from "vitest";
import { FIGHT_BUILDING } from "@/fight/plan";
import { PLOTS } from "@/world/footprints";
import { ADMIN_ANGLE, DOOR_RING, EXPANSION_RING, FIGHT_ANGLE, PORTALS, ringOf } from "@/world/layout";
import { hallDoor, impostorBlocks } from "./plaza-impostor";

const bearing = (x: number, z: number) => (Math.atan2(x, -z) * 180) / Math.PI;
const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("what a hall sees out of its door (P2-WLD-15)", () => {
  it("the Administrative Block looks out from the expansion ring at 62°, every plaza hall from the door ring", () => {
    expect(hallDoor("admin")).toEqual({ deg: ADMIN_ANGLE, ring: EXPANSION_RING });
    expect(hallDoor("fight")).toEqual({ deg: FIGHT_ANGLE, ring: DOOR_RING });
    for (const p of PORTALS) expect(hallDoor(p.id)).toEqual({ deg: p.angleDeg, ring: ringOf(p) });
  });

  it("every building's wing block stands on its own plot's bearing and ring, never the viewer's", () => {
    for (const self of ["pool", "ludo", "igisoro", "arena", "admin", "fight"]) {
      const blocks = impostorBlocks(self);
      expect(blocks.some((b) => b.plot === self)).toBe(false);
      for (const p of PLOTS) {
        if (p.id === self || p.type === "arena") continue;
        const wing = blocks.find((b) => b.plot === p.id);
        expect(wing, p.id).toBeTruthy();
        // the first footprint is the entrance wing just behind the door: on the plot's bearing, a few metres out
        expect(gap(bearing(wing!.x, wing!.z), p.angleDeg)).toBeLessThan(6);
        expect(Math.hypot(wing!.x, wing!.z)).toBeGreaterThan(p.ring - 3);
        expect(Math.hypot(wing!.x, wing!.z)).toBeLessThan(p.ring + 20);
      }
    }
  });

  it("the 88° plot is the Fight Games pavilion with the Boxing hall's tall body behind it, the Block is at 62° out", () => {
    const blocks = impostorBlocks("pool");
    const fight = blocks.filter((b) => b.plot === "fight");
    expect(fight[0]!.h).toBeLessThan(FIGHT_BUILDING.H);
    expect(Math.max(...fight.map((b) => b.h))).toBeGreaterThanOrEqual(FIGHT_BUILDING.H);
    expect(fight.every((b) => b.mat === "charcoal")).toBe(true);
    const admin = blocks.filter((b) => b.plot === "admin");
    expect(admin.length).toBeGreaterThan(0);
    expect(gap(bearing(admin[0]!.x, admin[0]!.z), ADMIN_ANGLE)).toBeLessThan(6);
    expect(Math.hypot(admin[0]!.x, admin[0]!.z)).toBeGreaterThan(EXPANSION_RING - 3);
    // nothing of the Block is left on the plaza's door ring at 88°
    expect(admin.some((b) => Math.hypot(b.x, b.z) < DOOR_RING + 20 && gap(bearing(b.x, b.z), FIGHT_ANGLE) < 10)).toBe(false);
  });

  it("buildings keep their real facades: hoarding on the sites, brick at Ludo, thatch at Igisoro, lit shopfronts", () => {
    const blocks = impostorBlocks("arena");
    for (const b of blocks) {
      if (b.type === "soon" || b.type === "site") {
        expect(b.mat).toBe("hoarding");
        expect(b.glass).toBeNull();
      }
    }
    expect(blocks.find((b) => b.plot === "ludo")!.mat).toBe("brick");
    expect(blocks.find((b) => b.plot === "igisoro")!.roof).toBe("thatch");
    expect(blocks.find((b) => b.plot === "pool")!.glass).not.toBeNull();
  });
});
