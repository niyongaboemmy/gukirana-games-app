import { describe, expect, it } from "vitest";
import { createFairRng } from "@gukirana/fairness";
import { initPool, playShot, poolBotShot, poolModule, isqrt, simulateShot, TABLE_W, TABLE_H, R } from "./index.js";

const rng = () => createFairRng("seed", ["c"], "m");

describe("pool physics", () => {
  it("isqrt is exact", () => {
    for (const v of [0, 1, 2, 3, 4, 15, 16, 17, 99_999_999, 2 ** 52]) {
      const r = isqrt(v);
      expect(r * r <= v && (r + 1) * (r + 1) > v).toBe(true);
    }
  });

  it("is deterministic: same shot, same hash", () => {
    const a = initPool(["a", "b"], rng());
    const b = initPool(["a", "b"], rng());
    const s1 = playShot(a, { dx: 10000, dy: 37, power: 1000, spin: 0 });
    const s2 = playShot(b, { dx: 10000, dy: 37, power: 1000, spin: 0 });
    expect(poolModule.hash(s1)).toBe(poolModule.hash(s2));
    expect(s1.lastShot!.frames).toEqual(s2.lastShot!.frames);
  });

  it("keeps balls on the table and terminates", () => {
    const s = initPool(["a", "b"], rng());
    const r = simulateShot(s.balls, 10000, 120, 1000, 0);
    expect(r.ticks).toBeLessThan(240 * 25);
    for (const b of r.balls) if (!b.in) {
      expect(b.x).toBeGreaterThanOrEqual(R - 1);
      expect(b.x).toBeLessThanOrEqual(TABLE_W - R + 1);
      expect(b.y).toBeGreaterThanOrEqual(R - 1);
      expect(b.y).toBeLessThanOrEqual(TABLE_H - R + 1);
      expect(Number.isSafeInteger(b.x) && Number.isSafeInteger(b.y)).toBe(true);
    }
  });

  it("bot-vs-bot games end", () => {
    for (let g = 0; g < 4; g++) {
      let s = initPool(["a", "b"], createFairRng(`s${g}`, ["c"], "m"));
      let n = 0;
      while (s.winner === null && n++ < 120) s = playShot(s, poolBotShot(s, 3));
      expect(n).toBeLessThan(120);
    }
  }, 60_000);

  it("validates turn and direction", () => {
    const s = initPool(["a", "b"], rng());
    expect(poolModule.validate(s, "b", { dx: 1, dy: 0, power: 500, spin: 0 }).ok).toBe(false);
    expect(poolModule.validate(s, "a", { dx: 0, dy: 0, power: 500, spin: 0 }).ok).toBe(false);
    expect(poolModule.validate(s, "a", { dx: 1, dy: 0, power: 500, spin: 0 }).ok).toBe(true);
  });
});
