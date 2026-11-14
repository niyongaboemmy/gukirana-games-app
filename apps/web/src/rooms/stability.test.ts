import { describe, expect, it } from "vitest";
import { damp, PROMPT, stickyNearest, stickyZone } from "./stability";

describe("prompt hysteresis (P2-HAL-10 stability)", () => {
  const pick = (cur: string | null, d: Record<string, number | null>) => stickyNearest(cur, Object.keys(d), (id) => d[id] ?? null, PROMPT.seat, PROMPT.seatMargin, PROMPT.switchGain);

  it("shows the nearest within range", () => {
    expect(pick(null, { a: 1.2, b: 0.9 })).toBe("b");
    expect(pick(null, { a: 1.6 })).toBe(null);
  });
  it("does not flash off while standing just past the boundary", () => {
    expect(pick("a", { a: 1.6 })).toBe("a");
    expect(pick("a", { a: 1.84 })).toBe("a");
    expect(pick("a", { a: 1.9 })).toBe(null);
  });
  it("no ping-pong between two chairs at almost the same distance", () => {
    expect(pick("a", { a: 1.0, b: 0.9 })).toBe("a");
    expect(pick("a", { a: 1.0, b: 0.7 })).toBe("b");
  });
  it("drops a candidate that is no longer allowed (taken)", () => {
    expect(pick("a", { a: null, b: 1.4 })).toBe("b");
    expect(pick("a", { a: null })).toBe(null);
  });
  it("a walk back and forth across the edge toggles at most once each way", () => {
    let cur: string | null = null;
    let flips = 0;
    for (let i = 0; i < 400; i++) {
      const d = 1.5 + Math.sin(i / 10) * 0.2; // wobbling around the 1.5 m edge
      const next = pick(cur, { a: d });
      if (next !== cur) flips++;
      cur = next;
    }
    expect(flips).toBe(1);
  });
  it("zones: on inside, off only outside the larger zone", () => {
    expect(stickyZone(false, false, true)).toBe(false);
    expect(stickyZone(false, true, true)).toBe(true);
    expect(stickyZone(true, false, true)).toBe(true);
    expect(stickyZone(true, false, false)).toBe(false);
  });
});

describe("camera smoothing", () => {
  it("is frame-rate independent: 1 s at 30 fps and at 120 fps end in the same place", () => {
    const run = (fps: number) => {
      let x = 0;
      for (let i = 0; i < fps; i++) x += (1 - x) * damp(6, 1 / fps);
      return x;
    };
    expect(run(30)).toBeCloseTo(run(120), 6);
    expect(damp(6, 0)).toBe(0);
    expect(damp(6, 10)).toBeCloseTo(1, 6);
  });
});
