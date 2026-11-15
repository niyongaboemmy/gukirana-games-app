import { describe, expect, it } from "vitest";
import { PORTALS } from "./layout";
import { decodeInteriorUV, hasInterior, INTERIOR_KINDS, INTERIOR_ROOMS, INTERIOR_VIEWS, interiorUV, roomHit } from "./interior-plan";

describe("interior glass plan (P2-WLD-15)", () => {
  it("every playable building with glass has a room behind it; construction sites do not", () => {
    for (const p of PORTALS) expect(hasInterior(p.kind)).toBe(p.kind !== "soon");
  });

  it("the (kind, view) code in the UVs survives the round trip for every pair", () => {
    for (const k of INTERIOR_KINDS)
      for (const v of INTERIOR_VIEWS) {
        const [u, w] = interiorUV(k, v);
        // merged / transformed geometry keeps UVs exactly; allow float noise anyway
        expect(decodeInteriorUV(u + 0.3, w - 0.3)).toEqual({ kind: k, view: v });
      }
    expect(decodeInteriorUV(99, 0)).toBeNull();
  });

  it("rooms are believable: furniture cards stand inside the room, ceilings above the door head", () => {
    for (const k of INTERIOR_KINDS) {
      const r = INTERIOR_ROOMS[k];
      expect(r.near).toBeGreaterThan(1);
      expect(r.near).toBeLessThan(r.far);
      expect(r.far).toBeLessThan(r.depth);
      expect(r.hallDepth).toBeGreaterThan(r.depth);
      expect(r.ceiling).toBeGreaterThanOrEqual(4.2); // door head 4.0 m (layout DOOR.h)
      expect(r.tile).toBeGreaterThanOrEqual(5);
    }
  });

  it("a ray through the glass meets the floor, the back wall or the ceiling as a real room would", () => {
    const room = { depth: 6, ceiling: 4.5 };
    // looking straight in at eye height: the back wall, 6 m deep
    expect(roomHit(room, 1.65, { x: 0, y: 0, z: 1 })).toMatchObject({ surface: "back", depth: 6 });
    // looking down: the floor, before the back wall
    const down = roomHit(room, 1.65, { x: 0, y: -0.6, z: 0.8 });
    expect(down.surface).toBe("floor");
    expect(down.y).toBeCloseTo(0);
    expect(down.depth).toBeCloseTo(2.2);
    // looking up from low on the glass: the ceiling
    const up = roomHit(room, 1, { x: 0.2, y: 0.8, z: 0.56 });
    expect(up.surface).toBe("ceiling");
    expect(up.y).toBeCloseTo(4.5);
  });
});
