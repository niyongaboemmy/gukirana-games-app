import { describe, expect, it } from "vitest";
import { BOWL_SEATS } from "./bowl";
import { EYE_FOV, FOV_MAX, FOV_MIN, VIEW_TARGETS, ZOOM_STEPS, fitFov, framing, targetSphere } from "./spectate";
import { seatEye } from "./sightlines";

describe("arena stage zoom (P2-HAL-11)", () => {
  it("fits a target: nearer / bigger → wider lens, always within the lens limits", () => {
    expect(fitFov(2, 10)).toBeGreaterThan(fitFov(2, 20));
    expect(fitFov(4, 20)).toBeGreaterThan(fitFov(2, 20));
    for (const d of [1, 5, 30, 300]) {
      expect(fitFov(2, d)).toBeGreaterThanOrEqual(FOV_MIN);
      expect(fitFov(2, d)).toBeLessThanOrEqual(FOV_MAX);
    }
    // a portrait screen fits the width (a wider vertical lens)
    expect(fitFov(2, 20, 0.5)).toBeGreaterThan(fitFov(2, 20, 16 / 9));
  });

  it("every seat can frame every target; far seats zoom right in on a single table (≤ 12°)", () => {
    for (const s of BOWL_SEATS) {
      const e = seatEye(s);
      for (const t of VIEW_TARGETS) {
        const f = framing(e, t, 0);
        expect(f.framed).toBe(true);
        expect(f.fov).toBeGreaterThanOrEqual(FOV_MIN);
        expect(f.fov).toBeLessThanOrEqual(FOV_MAX);
        expect(f.look.x).toBeCloseTo(targetSphere(t).x, 9);
      }
    }
    const far = seatEye(BOWL_SEATS.find((s) => s.id === "U3-5-6")!);
    expect(framing(far, "ludo", 0).fov).toBeLessThanOrEqual(12);
    const vip = seatEye(BOWL_SEATS.find((s) => s.id === "V1-1-3")!);
    expect(framing(vip, "stage", 0).fov).toBeLessThan(EYE_FOV);
  });

  it("zoom steps narrow the lens; no target + no zoom = the natural eye lens", () => {
    const e = seatEye(BOWL_SEATS[0]!);
    expect(framing(e, null, 0)).toMatchObject({ fov: EYE_FOV, framed: false });
    let last = Infinity;
    for (let z = 0; z < ZOOM_STEPS.length; z++) {
      const f = framing(e, "stage", z).fov;
      expect(f).toBeLessThan(last);
      last = f;
    }
    expect(framing(e, null, 2).framed).toBe(true);
  });
});
