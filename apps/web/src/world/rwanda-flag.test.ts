import { describe, expect, it } from "vitest";
import { RWANDA, rwandaFlagSpec } from "./rwanda-flag";
import { ARENA_FLAGPOLES, ARENA_FLAG } from "./footprints";

describe("Rwanda's flag (P2-WLD-17)", () => {
  const s = rwandaFlagSpec(768);

  it("is 2:3 with the official colours", () => {
    expect(s.h / s.w).toBeCloseTo(2 / 3, 10);
    expect(RWANDA).toEqual({ blue: "#00A1DE", yellow: "#FAD201", green: "#20603D", sun: "#E5BE01" });
  });

  it("bands: sky blue over the top half, then yellow and green a quarter each, edge to edge", () => {
    expect(s.bands.map((b) => b[2])).toEqual([RWANDA.blue, RWANDA.yellow, RWANDA.green]);
    expect(s.bands[0]![0]).toBe(0);
    expect(s.bands[0]![1]).toBeCloseTo(s.h / 2, 10);
    expect(s.bands[1]![1] - s.bands[1]![0]).toBeCloseTo(s.h / 4, 10);
    expect(s.bands[2]![1] - s.bands[2]![0]).toBeCloseTo(s.h / 4, 10);
    expect(s.bands[2]![1]).toBeCloseTo(s.h, 10);
    for (let i = 1; i < 3; i++) expect(s.bands[i]![0]).toBeCloseTo(s.bands[i - 1]![1], 10);
  });

  it("the sun: 24 straight rays in the upper fly corner, wholly inside the blue band, a disc ringed in blue", () => {
    const { sun } = s;
    expect(sun.rays).toHaveLength(24);
    expect(sun.x / s.w).toBeCloseTo(5 / 6, 6);
    expect(sun.y / s.h).toBeCloseTo(0.2375, 6);
    // inside the blue band and the flag, on the fly side (away from the hoist at x = 0)
    expect(sun.y - sun.rayOut).toBeGreaterThan(0);
    expect(sun.y + sun.rayOut).toBeLessThan(s.h / 2);
    expect(sun.x + sun.rayOut).toBeLessThan(s.w);
    expect(sun.x - sun.rayOut).toBeGreaterThan(s.w / 2);
    // the rays: tips on the outer radius, bases on the inner one, neighbours' bases meeting (15° each)
    for (const [a, tip, b] of sun.rays) {
      expect(Math.hypot(tip![0] - sun.x, tip![1] - sun.y)).toBeCloseTo(sun.rayOut, 6);
      expect(Math.hypot(a![0] - sun.x, a![1] - sun.y)).toBeCloseTo(sun.rayIn, 6);
      expect(Math.hypot(b![0] - sun.x, b![1] - sun.y)).toBeCloseTo(sun.rayIn, 6);
    }
    for (let i = 0; i < 24; i++) {
      const end = sun.rays[i]![2]!;
      const next = sun.rays[(i + 1) % 24]![0]!;
      expect(Math.hypot(end[0] - next[0], end[1] - next[1])).toBeLessThan(1e-6);
    }
    // the blue ring sits between the golden disc and the ray bases
    expect(sun.disc + sun.ring / 2).toBeCloseTo(sun.rayIn, 6);
    expect(sun.disc - sun.ring / 2).toBeGreaterThan(0);
  });

  it("the arena flies it on every pole, cloth 2:3, the poles clear of the canopy columns", () => {
    expect(ARENA_FLAGPOLES.length).toBe(4);
    expect(ARENA_FLAG.h / ARENA_FLAG.w).toBeCloseTo(2 / 3, 10);
    // the cloth hangs under the pole top and above the canopy
    expect(ARENA_FLAG.y + ARENA_FLAG.h / 2).toBeLessThan(ARENA_FLAG.pole);
  });
});
