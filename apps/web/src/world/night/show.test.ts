import { describe, expect, it } from "vitest";
import {
  ANIM,
  animLevel,
  breath,
  countFlashes,
  maxShowHz,
  PHOTO_SAFE_HZ,
  PHOTOCELL,
  SHOW,
  SHOW_GLSL,
  SHOW_WRAP,
  showAmp,
  swell,
  switchOn,
  threshold,
  wave,
} from "./show";

describe("night show timing", () => {
  it("every period divides the show clock wrap (no jump when it wraps)", () => {
    for (const p of Object.values(SHOW)) expect(SHOW_WRAP % p).toBe(0);
  });

  it("eases: zero slope at both ends of a breath, a swell rises and falls smoothly", () => {
    const e = 1e-4;
    expect(Math.abs(breath(e, 7) - breath(0, 7))).toBeLessThan(1e-6);
    expect(breath(3.5, 7)).toBeCloseTo(1, 6);
    expect(swell(0)).toBe(0);
    expect(swell(0.25)).toBeCloseTo(1, 6);
    expect(swell(0.7)).toBe(0);
    // continuous: no step anywhere over a period
    for (let x = 0; x < 1; x += 0.001) expect(Math.abs(swell(x + 0.001) - swell(x))).toBeLessThan(0.03);
    expect(wave(0, 0, 12)).toBeCloseTo(1, 6);
    expect(wave(6, 0, 12)).toBeCloseTo(0, 6);
  });

  it("is photosensitivity-safe: ≤ 3 Hz by period and by counted flashes for every mode", () => {
    expect(maxShowHz()).toBeLessThanOrEqual(PHOTO_SAFE_HZ);
    // in fact far below it: the fastest light (the beacons) is 0.5 Hz
    expect(maxShowHz()).toBeLessThanOrEqual(0.5);
    const fps = 60;
    for (const anim of Object.values(ANIM)) {
      // sample 10 s at 60 fps and count flashes in each 1 s window
      const s: number[] = [];
      for (let i = 0; i < 10 * fps; i++) s.push(animLevel(anim, i / fps, 0.3, 1));
      for (let w = 0; w + fps <= s.length; w += fps) expect(countFlashes(s.slice(w, w + fps))).toBeLessThanOrEqual(PHOTO_SAFE_HZ);
      // and no frame-to-frame jump larger than 5 % (no flicker, ever)
      for (let i = 1; i < s.length; i++) expect(Math.abs(s[i]! - s[i - 1]!)).toBeLessThan(0.05);
    }
  });

  it("counts flashes correctly on a known signal", () => {
    // a 5 Hz square wave over 1.1 s at 60 fps: 10 transitions = 5 flashes
    const sq = Array.from({ length: 66 }, (_, i) => (Math.floor(i / 6) % 2 ? 1 : 0));
    expect(countFlashes(sq)).toBe(5);
    expect(countFlashes(Array(60).fill(0.5))).toBe(0);
  });

  it("holds the static warm state with no motion (reduced motion / Lite)", () => {
    for (const anim of Object.values(ANIM)) for (const t of [0, 1.3, 5, 77]) expect(animLevel(anim, t, 0.4, 0)).toBe(1);
    expect(showAmp(1, false)).toBe(0);
    expect(showAmp(1, true)).toBe(1);
    // no show while the sky is still bright: the animation only begins once it is dark
    expect(showAmp(0.5, true)).toBe(0);
  });

  it("animated lights never go fully dark (a gentle show, not blinking)", () => {
    for (const anim of Object.values(ANIM))
      for (let t = 0; t < 40; t += 0.05) expect(animLevel(anim, t, 0.2, 1)).toBeGreaterThanOrEqual(0.25);
  });
});

describe("photocells", () => {
  it("thresholds stay inside their group's window and are deterministic", () => {
    for (const g of Object.keys(PHOTOCELL) as (keyof typeof PHOTOCELL)[]) {
      const [a, b] = PHOTOCELL[g];
      for (let i = 0; i < 200; i++) {
        const t = threshold(g, i);
        expect(t).toBeGreaterThanOrEqual(a);
        expect(t).toBeLessThanOrEqual(b);
        expect(threshold(g, i)).toBe(t);
      }
    }
  });

  it("stagger the switch-on: not all at once, all on by full dark, all off by day", () => {
    const thr = Array.from({ length: 100 }, (_, i) => threshold("lamps", i));
    const on = (l: number) => thr.filter((t) => switchOn(l, t) > 0.5).length;
    expect(on(0)).toBe(0);
    expect(on(1)).toBe(100);
    // half-way through the dusk wave a part of the lamps is on, a part is not
    const mid = on(0.32);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(90);
    // the facades follow the street lights
    expect(threshold("facades", 3)).toBeGreaterThan(PHOTOCELL.lamps[0]);
  });

  it("generates GLSL with the same periods", () => {
    expect(SHOW_GLSL).toContain(SHOW.breathe.toFixed(4));
    expect(SHOW_GLSL).toContain(SHOW.fightPulse.toFixed(4));
    expect(SHOW_GLSL).toContain("gkAnim");
  });
});
