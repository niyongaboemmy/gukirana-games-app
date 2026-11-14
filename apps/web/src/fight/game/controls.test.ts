import { describe, expect, it } from "vitest";
import { swipeAction } from "./controls";

describe("boxing touch swipes (§2.8)", () => {
  it("guard pad: left / right slip, up / down step, small moves are taps", () => {
    expect(swipeAction("guard", -60, 5)).toBe("slipL");
    expect(swipeAction("guard", 60, -5)).toBe("slipR");
    expect(swipeAction("guard", 3, -60)).toBe("stepIn");
    expect(swipeAction("guard", 3, 60)).toBe("stepOut");
    expect(swipeAction("guard", 10, 10)).toBeNull();
  });
  it("punch pad: right = cross, up = uppercut, sideways-down = hook", () => {
    expect(swipeAction("punch", 70, 0)).toBe("cross");
    expect(swipeAction("punch", 5, -70)).toBe("uppercut");
    expect(swipeAction("punch", -50, 40)).toBe("hook");
  });
});
