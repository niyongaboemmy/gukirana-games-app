import { describe, expect, it } from "vitest";
import { CULL_AT, keepRadius, eased, FADE_IN_S, FOCUS_IDLE, focusTarget, ringCulled, SPECTATOR_DIM, stepFocus, type FocusState, type FocusTarget } from "./focus";

const run = (s: FocusState, t: FocusTarget, secs: number, dt = 1 / 60) => {
  const seen: FocusState[] = [];
  for (let i = 0; i < Math.round(secs / dt); i++) {
    s = stepFocus(s, t, dt);
    seen.push(s);
  }
  return { s, seen };
};

describe("focus mode state", () => {
  it("target: my fight (practice / live) → fighter; a watch camera → spectator; else none", () => {
    expect(focusTarget({ mine: { ring: "R7", snap: { phase: "round" } }, watched: null, watchCam: null })).toEqual({ ring: "R7", mode: "fighter" });
    expect(focusTarget({ mine: null, watched: { ring: "R3" }, watchCam: "rail" })).toEqual({ ring: "R3", mode: "spectator" });
    expect(focusTarget({ mine: null, watched: { ring: "R3" }, watchCam: null })).toEqual({ ring: null, mode: null });
  });
  it("fades in smoothly, culls only once fully dark, and never culls mid-fade", () => {
    const { s, seen } = run(FOCUS_IDLE, { ring: "R7", mode: "fighter" }, FADE_IN_S + 0.2);
    expect(s.k).toBe(1);
    expect(s.hidden).toBe(true);
    for (const x of seen) if (x.k < CULL_AT) expect(x.hidden).toBe(false);
    // monotonic, small steps (no pop)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.k).toBeGreaterThanOrEqual(seen[i - 1]!.k);
      expect(seen[i]!.k - seen[i - 1]!.k).toBeLessThan(0.05);
    }
  });
  it("leaving un-culls on the first frame (still dark), then fades back to the hall", () => {
    const inn = run(FOCUS_IDLE, { ring: "R7", mode: "fighter" }, 2).s;
    const first = stepFocus(inn, { ring: null, mode: null }, 1 / 60);
    expect(first.hidden).toBe(false);
    expect(first.k).toBeGreaterThan(0.9);
    expect(first.ring).toBe("R7"); // the fade-out happens around the same ring
    const out = run(first, { ring: null, mode: null }, 2).s;
    expect(out).toEqual(FOCUS_IDLE);
  });
  it("spectators get the lighter version: dimmed, only what the fog swallowed is culled, other rings stay", () => {
    const { s } = run(FOCUS_IDLE, { ring: "R3", mode: "spectator" }, 2);
    expect(s.k).toBeCloseTo(SPECTATOR_DIM, 5);
    expect(s.hidden).toBe(true);
    expect(ringCulled("R4", s)).toBe(false);
    expect(keepRadius("spectator", 2.45)).toBeGreaterThan(keepRadius("fighter", 2.45));
  });
  it("a ring change fades out first, then in around the new ring", () => {
    const a = run(FOCUS_IDLE, { ring: "R7", mode: "fighter" }, 2).s;
    const mid = run(a, { ring: "R9", mode: "fighter" }, 0.3).s;
    expect(mid.ring).toBe("R7");
    expect(mid.hidden).toBe(false);
    const b = run(mid, { ring: "R9", mode: "fighter" }, 3).s;
    expect(b.ring).toBe("R9");
    expect(b.k).toBe(1);
  });
  it("culling helpers and easing", () => {
    expect(ringCulled("R3", { ring: "R7", hidden: true, mode: "fighter" })).toBe(true);
    expect(ringCulled("R7", { ring: "R7", hidden: true, mode: "fighter" })).toBe(false);
    expect(ringCulled("R3", { ring: "R7", hidden: false, mode: "fighter" })).toBe(false);
    expect(eased(0)).toBe(0);
    expect(eased(1)).toBe(1);
    expect(eased(0.5)).toBeCloseTo(0.5);
  });
});
