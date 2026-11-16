import { describe, expect, it } from "vitest";
import { clampArm, LIMITS } from "./arm-fk";
import { ARM, armRad, GUARD_V8_LEAD_ARM, GUARD_V8_REAR_ARM, V8_GUARD_BIAS_F } from "./pose";

/**
 * P3-FGT-19B: the v8 guard data (pose.ts) — the fitted keyed-arm angles, the female body's guard correction and the
 * degrees → radians helper the rig uses — stay inside the joint limits the rig clamps to, so the shipped guard is the
 * fitted one, not a clamped one.
 */
const inside = (a: Float32Array) => {
  const b = Float32Array.from(a);
  clampArm(b, 0);
  return [...a].every((v, i) => Math.abs(v - b[i]!) < 1e-6);
};

describe("v8 guard", () => {
  it("converts an arm spec to radians in the ARM layout", () => {
    const r = armRad({ flex: 90, elbow: 45 });
    expect(r[ARM.flex]).toBeCloseTo(Math.PI / 2);
    expect(r[ARM.elbow]).toBeCloseTo(Math.PI / 4);
    expect(r[ARM.abd]).toBe(0);
  });
  it("keeps the fitted guard arms inside the joint limits, wrists straight", () => {
    for (const a of [GUARD_V8_LEAD_ARM, GUARD_V8_REAR_ARM]) {
      expect(inside(armRad(a))).toBe(true);
      expect(a.wrist).toBe(0);
    }
  });
  it("keeps the female guard correction inside the limits too", () => {
    const add = (a: typeof GUARD_V8_LEAD_ARM, b: Record<keyof typeof ARM, number>) => armRad(Object.fromEntries(Object.keys(ARM).map((k) => [k, a[k as keyof typeof ARM] + b[k as keyof typeof ARM]])));
    expect(inside(add(GUARD_V8_LEAD_ARM, V8_GUARD_BIAS_F.lead))).toBe(true);
    expect(inside(add(GUARD_V8_REAR_ARM, V8_GUARD_BIAS_F.rear))).toBe(true);
    // (the clavicle stays under its elevation limit even with the guard's shrug: 0.2 × 0.5 rad on top)
    expect(((GUARD_V8_LEAD_ARM.elev + V8_GUARD_BIAS_F.lead.elev) * Math.PI) / 180 + 0.1).toBeLessThanOrEqual(LIMITS.elev[1] + 0.02);
  });
});
