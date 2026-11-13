import { describe, expect, it } from "vitest";
import { HALLS } from "@/rooms/layouts";
import { hallToPlaza, plazaToHall } from "./stage";
import { doorInset, DOOR_RING, PORTALS, portalTransform } from "./layout";

/** The persistent-stage crossing maps the plaza door frame onto the hall door frame; it must follow the ring layout. */
describe("plaza ↔ hall door mapping follows DOOR_RING / PORTALS", () => {
  for (const game of ["pool", "ludo", "igisoro"] as const) {
    it(`${game}: the door line maps onto the hall's entrance wall and back`, () => {
      const p = PORTALS.find((q) => q.id === game)!;
      const t = portalTransform(p);
      expect(Math.hypot(t.x, t.z)).toBeCloseTo(DOOR_RING, 5);
      // the door centre on the door line → the hall door centre on its south wall
      const a = (p.angleDeg * Math.PI) / 180;
      const onLine = { x: t.x + Math.sin(a) * -doorInset(p.kind), z: t.z - Math.cos(a) * -doorInset(p.kind) };
      const h = plazaToHall(game, onLine.x, onLine.z, Math.PI - a); // walking outward, into the door
      expect(h.x).toBeCloseTo(HALLS[game].door.x, 5);
      expect(h.z).toBeCloseTo(HALLS[game].size.d / 2, 5);
      // facing out of the plaza (into the hall) → facing north inside the hall (yaw π: towards −z)
      expect(Math.cos(h.yaw - Math.PI)).toBeCloseTo(1, 5);
      // round trip for a few points near the door, both ways
      for (const [dx, dz] of [
        [0.4, -0.3],
        [-1.1, 1.2],
        [0, 2.5],
      ] as const) {
        const q = { x: t.entryX + dx, z: t.entryZ + dz };
        const back = hallToPlaza(game, ...(Object.values(plazaToHall(game, q.x, q.z, 0.7)) as [number, number, number]));
        expect(back.x).toBeCloseTo(q.x, 5);
        expect(back.z).toBeCloseTo(q.z, 5);
        expect(back.yaw).toBeCloseTo(0.7, 5);
      }
    });
  }
});
