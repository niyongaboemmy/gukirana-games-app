import { describe, expect, it } from "vitest";
import { ZOOM_MIN } from "./aerial";
import { EYE_BLEND_S, EYE_FWD, EYE_H, EYE_PITCH_MAX, EYE_PITCH_MIN, eyeDrag, eyePose, smooth01, stepBlend, useCamMode, zoomEye } from "./eye-view";

describe("eye view (P2-WLD-16)", () => {
  it("puts the camera at the eyes, a little in front of the head, looking where you face", () => {
    const e = eyePose(3, 0, -2, Math.PI / 2, 0);
    expect(e.p.y).toBeCloseTo(EYE_H);
    expect(e.p.x).toBeCloseTo(3 + EYE_FWD);
    expect(e.p.z).toBeCloseTo(-2);
    // facing +x, level: the look point is straight ahead at eye height
    expect(e.look.x).toBeGreaterThan(e.p.x + 3);
    expect(e.look.y).toBeCloseTo(e.p.y);
    expect(e.look.z).toBeCloseTo(e.p.z);
    // looking up raises the look point; on a raised floor everything rides along
    expect(eyePose(0, 0, 0, 0, 0.5).look.y).toBeGreaterThan(EYE_H + 1);
    expect(eyePose(0, 2, 0, 0, 0).p.y).toBeCloseTo(EYE_H + 2);
  });

  it("turns with a horizontal drag and clamps the pitch", () => {
    const r = eyeDrag(1, 0, 100, 0);
    expect(r.facing).toBeLessThan(1);
    expect(eyeDrag(0, 0, 0, -10000).pitch).toBe(EYE_PITCH_MAX);
    expect(eyeDrag(0, 0, 0, 10000).pitch).toBe(EYE_PITCH_MIN);
    // drag up = look up
    expect(eyeDrag(0, 0, 0, -20).pitch).toBeGreaterThan(0);
  });

  it("glides between the views over EYE_BLEND_S, instantly with reduced motion", () => {
    let b = 0;
    let t = 0;
    while (b < 1 && t < 5) {
      b = stepBlend(b, true, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(EYE_BLEND_S, 1);
    expect(stepBlend(0.3, true, 0.016, true)).toBe(1);
    expect(stepBlend(0.3, false, 0.016, true)).toBe(0);
    // eased (no jump at either end)
    expect(smooth01(0.02)).toBeLessThan(0.002);
    expect(smooth01(0.98)).toBeGreaterThan(0.998);
  });

  it("zooming all the way in enters the eye view, zooming out leaves it", () => {
    expect(zoomEye("follow", 6, -1)).toBeNull();
    expect(zoomEye("follow", ZOOM_MIN, 1)).toBeNull();
    expect(zoomEye("follow", ZOOM_MIN, -1)).toEqual({ distance: ZOOM_MIN, mode: "eye" });
    expect(zoomEye("eye", ZOOM_MIN, 1)?.mode).toBe("follow");
    expect(zoomEye("eye", ZOOM_MIN, -1)?.mode).toBe("eye");
  });

  it("toggles the mode", () => {
    useCamMode.getState().set("follow");
    useCamMode.getState().toggle();
    expect(useCamMode.getState().mode).toBe("eye");
    useCamMode.getState().toggle();
    expect(useCamMode.getState().mode).toBe("follow");
  });
});
