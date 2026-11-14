import { describe, expect, it } from "vitest";
import { AERIAL_MAX, aerialBlend, aerialPivot, FOLLOW_MAX, isAerial, maxPitch, pinchZoom, stepZoom, viewPitch, wheelZoom, ZOOM_MIN } from "./aerial";

describe("campus aerial view", () => {
  it("zoom buttons go from the shoulder to the whole campus and back in a handful of presses", () => {
    let d = 9;
    let out = 0;
    while (d < AERIAL_MAX && out < 40) {
      d = stepZoom(d, 1);
      out++;
    }
    expect(d).toBe(AERIAL_MAX);
    expect(out).toBeLessThan(22);
    let back = 0;
    while (d > ZOOM_MIN && back < 60) {
      d = stepZoom(d, -1);
      back++;
    }
    expect(d).toBe(ZOOM_MIN);
    // coming down from the sky lands exactly on the follow limit before the close-up steps
    expect(stepZoom(FOLLOW_MAX * 1.2, -1)).toBe(FOLLOW_MAX);
  });

  it("wheel and pinch stay inside the range and cross smoothly into the aerial range", () => {
    expect(wheelZoom(FOLLOW_MAX - 0.1, 100)).toBe(FOLLOW_MAX);
    expect(wheelZoom(FOLLOW_MAX, 100)).toBeGreaterThan(FOLLOW_MAX);
    expect(wheelZoom(AERIAL_MAX, 5000)).toBe(AERIAL_MAX);
    expect(wheelZoom(FOLLOW_MAX + 1, -5000)).toBe(FOLLOW_MAX);
    expect(pinchZoom(100, 200, 100)).toBe(200);
    expect(pinchZoom(AERIAL_MAX, 300, 10)).toBe(AERIAL_MAX);
    expect(pinchZoom(3, 10, 300)).toBe(ZOOM_MIN);
  });

  it("the follow camera is unchanged up close; the aerial view pivots on the campus and looks down", () => {
    expect(aerialBlend(FOLLOW_MAX)).toBe(0);
    expect(isAerial(FOLLOW_MAX)).toBe(false);
    expect(aerialPivot(10, 20, 1.5, 9)).toEqual({ x: 10, y: 1.5, z: 20 });
    expect(viewPitch(0.3, 9)).toBe(0.3);
    expect(maxPitch(9)).toBeCloseTo(1.1);
    const far = aerialPivot(10, 20, 1.5, AERIAL_MAX);
    expect(far.x).toBeCloseTo(0);
    expect(far.z).toBeCloseTo(0);
    expect(viewPitch(0.1, AERIAL_MAX)).toBeCloseTo(0.62);
    expect(maxPitch(AERIAL_MAX)).toBeGreaterThan(1.3);
  });

  it("the farthest view frames the whole campus (ring road r 165 m) with the 60° lens", () => {
    // vertical half-fov 30°: the visible ground half-width at the pivot ≈ distance · tan(30°)
    expect(AERIAL_MAX * Math.tan(Math.PI / 6)).toBeGreaterThan(165 * 1.6);
  });
});
