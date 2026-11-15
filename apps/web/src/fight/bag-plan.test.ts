import { describe, expect, it } from "vitest";
import { AUTO_COMBOS, BAG_R, bagClip, bagStance, ORBIT_MAX, stepOrbit } from "./bag-plan";
import { GYM_PROPS } from "./gym-plan";

describe("bag work (P3-FGT-08)", () => {
  const bag = GYM_PROPS.find((p) => p.id === "bag-1")!;
  it("stands square to the bag at jab reach, facing it, wherever the footwork circles", () => {
    for (const o of [-ORBIT_MAX, 0, 0.3]) {
      const s = bagStance(bag, o);
      expect(Math.hypot(bag.x - s.x, bag.z - s.z)).toBeCloseTo(BAG_R.heavyBag, 6);
      expect(Math.atan2(bag.x - s.x, bag.z - s.z)).toBeCloseTo(s.yaw, 6);
    }
  });
  it("hooks, uppercuts and body shots alternate hands; jab / cross stay", () => {
    expect([0, 1, 2].map((n) => bagClip("hook", n))).toEqual(["leadHook", "rearHook", "leadHook"]);
    expect(bagClip("jab", 3)).toBe("jab");
    expect(bagClip("cross", 0)).toBe("cross");
    expect(bagClip("body", 1)).toBe("rearBody");
  });
  it("side steps stay within the orbit limit (bouncing back at the edge)", () => {
    let o = 0;
    for (let i = 0; i < 20; i++) {
      o = stepOrbit(o, i % 5 === 4 ? "R" : "L");
      expect(Math.abs(o)).toBeLessThanOrEqual(ORBIT_MAX + 1e-6);
    }
    for (const c of AUTO_COMBOS) expect(c.punches.length).toBeGreaterThanOrEqual(3);
  });
});
