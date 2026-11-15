import { describe, expect, it } from "vitest";
import { buildRig } from "./rig";
import { ANIM, PHOTOCELL } from "./show";

const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b };
};

describe("night rig", () => {
  const std = buildRig("standard");
  const lite = buildRig("lite");
  const all = [...std.pools, ...std.halos, ...std.washes];

  it("places every fixture at a finite position with a positive size", () => {
    for (const p of std.pools) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      expect(p.r).toBeGreaterThan(0);
    }
    for (const h of std.halos) {
      expect(h.p.every(Number.isFinite)).toBe(true);
      expect(h.size).toBeGreaterThan(0);
    }
    for (const w of std.washes) {
      expect(w.p.every(Number.isFinite)).toBe(true);
      expect(w.w).toBeGreaterThan(0);
      expect(w.h).toBeGreaterThan(0);
    }
  });

  it("switches every fixture on inside its photocell group's window", () => {
    for (const f of all) {
      const [a, b] = PHOTOCELL[f.group];
      expect(f.thr).toBeGreaterThanOrEqual(a);
      expect(f.thr).toBeLessThanOrEqual(b);
    }
    // staggered: the lamps do not share one threshold
    expect(new Set(std.pools.filter((p) => p.group === "lamps").map((p) => p.thr.toFixed(3))).size).toBeGreaterThan(20);
  });

  it("uses only known animation modes, and the Lite rig is lighter", () => {
    const modes = new Set<number>(Object.values(ANIM));
    for (const f of all) expect(modes.has(f.anim ?? 0)).toBe(true);
    expect(lite.pools.length).toBeLessThan(std.pools.length);
    expect(lite.halos.length).toBeLessThan(std.halos.length);
  });

  it("keeps to the warm campus palette (blue only for the Fight Games spill)", () => {
    for (const f of all) {
      const { r, b } = hue(f.col);
      if (b > r) expect(f.anim).toBe(ANIM.pulse);
    }
  });

  it("lights the Agaseke, every hall and the gates", () => {
    // six basin uplights round the sculpture, close to the plinth
    expect(std.halos.filter((h) => Math.hypot(h.p[0], h.p[2]) < 1.2 && h.p[1] < 1.3).length).toBe(6);
    expect(std.washes.length).toBeGreaterThan(20);
    // beacons on the construction sites
    expect(std.halos.filter((h) => h.anim === ANIM.beacon).length).toBeGreaterThan(4);
  });
});
