import { describe, expect, it } from "vitest";
import { ringSteps } from "@/rooms/fight/ring-kit-core";
import { CLIMB, CLIMB_S, climbPose, kitSpec } from "./climb";
import { RING_BY_ID } from "./plan";

describe("ring climb (P3-FGT-03)", () => {
  for (const id of ["R7", "R1"] as const) {
    const r = RING_BY_ID[id]!;
    it(`${id}: walks up the corner steps from the foot, ducks through the ropes, ends on the canvas facing the centre`, () => {
      for (const c of ["red", "blue"] as const) {
        const s = ringSteps(kitSpec(r), c);
        const a = climbPose(r, c, "in", 0);
        expect(Math.hypot(a.x - s.foot.x, a.z - s.foot.z)).toBeLessThan(1e-6);
        expect(a.walk).toBe(true);
        // the height never drops on the way up and reaches the canvas
        let last = -1;
        for (let t = 0; t <= CLIMB_S; t += 0.05) {
          const p = climbPose(r, c, "in", t);
          expect(p.y).toBeGreaterThanOrEqual(last - 1e-9);
          last = p.y;
        }
        const mid = climbPose(r, c, "in", CLIMB.walk + CLIMB.duck / 2);
        expect(mid.duck).toBeGreaterThan(0.8);
        const end = climbPose(r, c, "in", CLIMB_S);
        expect(end.done).toBe(true);
        expect(end.y).toBeCloseTo(r.canvasY, 6);
        expect(Math.hypot(end.x - s.in.x, end.z - s.in.z)).toBeLessThan(1e-6);
        const toCentre = Math.atan2(r.x - end.x, r.z - end.z);
        expect(Math.abs(Math.atan2(Math.sin(end.yaw - toCentre), Math.cos(end.yaw - toCentre)))).toBeLessThan(1e-6);
        // out is the same path backwards: it ends at the foot of the steps
        const out = climbPose(r, c, "out", CLIMB_S);
        expect(Math.hypot(out.x - s.foot.x, out.z - s.foot.z)).toBeLessThan(1e-6);
      }
    });
  }
});
