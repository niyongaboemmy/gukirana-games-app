import { describe, expect, it } from "vitest";
import { alongPath, GYM_COLLIDERS, GYM_PROPS, LOBBY_VENUE_COLLIDERS, STAFF, STEP_FEET } from "./gym-plan";
import { gymTimer } from "./training-zone";
import { BOXING_SIZE, inFeatureStage, LOBBY_SIZE, ringAt, SUBHALL_DOOR_X } from "./plan";
import { boxingWalkable } from "./hooks";

const inBox = (r: { x: number; z: number; w: number; d: number }, x: number, z: number, m = 0) => Math.abs(x - r.x) < r.w / 2 + m && Math.abs(z - r.z) < r.d / 2 + m;

describe("gym life (P3-FGT-04)", () => {
  it("staff never stand or walk in a ring or on the feature stage", () => {
    for (const s of STAFF.filter((x) => x.room === "boxing")) {
      const pts = s.path ? Array.from({ length: 200 }, (_, i) => alongPath(s.path!, i * 0.5)) : [s];
      for (const p of pts) {
        expect(ringAt(p.x, p.z, 0.35), `${s.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeNull();
        expect(inFeatureStage(p.x, p.z, 0.5), `${s.id} stage`).toBe(false);
        expect(Math.abs(p.x)).toBeLessThan(BOXING_SIZE.w / 2 - 0.4);
        expect(Math.abs(p.z)).toBeLessThan(BOXING_SIZE.d / 2 - 0.2);
      }
    }
  });

  it("training-wall props keep the cross aisle, the ring steps and the walking routes clear", () => {
    for (const c of GYM_COLLIDERS) {
      for (const f of STEP_FEET) expect(inBox(c, f.x, f.z, 0.4), `collider at ${c.x},${c.z} vs step foot`).toBe(false);
      // the front cross aisle's walking line (fight/hooks CROSS_Z = 13.25) and the door
      for (let x = -BOXING_SIZE.w / 2 + 1; x < BOXING_SIZE.w / 2 - 1; x += 0.5) expect(inBox(c, x, 13.25, 0.25)).toBe(false);
      expect(ringAt(c.x, c.z, 0.3)).toBeNull();
    }
  });

  it("each player prop has an open spot to stand at, clear of every ring prompt", () => {
    for (const p of GYM_PROPS.filter((x) => !x.npc)) {
      expect(boxingWalkable(p.stand.x, p.stand.z)).toBe(true);
      for (const c of GYM_COLLIDERS) expect(inBox(c, p.stand.x, p.stand.z, 0.25), p.id).toBe(false);
      for (const f of STEP_FEET) expect(Math.hypot(f.x - p.stand.x, f.z - p.stand.z), p.id).toBeGreaterThan(1.6);
    }
  });

  it("lobby venue props keep the plaza door and the Boxing doorway clear", () => {
    for (const c of LOBBY_VENUE_COLLIDERS) {
      expect(inBox(c, 0, LOBBY_SIZE.d / 2 - 1, 1.2)).toBe(false);
      expect(inBox(c, SUBHALL_DOOR_X.boxing, -2, 1.2)).toBe(false);
      expect(Math.abs(c.x) + c.w / 2).toBeLessThanOrEqual(LOBBY_SIZE.w / 2);
    }
  });

  it("the gym timer runs 3 min rounds and 1 min rests from the clock", () => {
    expect(gymTimer(0)).toEqual({ phase: "round", left: 180 });
    expect(gymTimer(179)).toEqual({ phase: "round", left: 1 });
    expect(gymTimer(180)).toEqual({ phase: "rest", left: 60 });
    expect(gymTimer(240)).toEqual({ phase: "round", left: 180 });
  });
});
