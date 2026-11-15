import { describe, expect, it } from "vitest";
import { conservativeSkill, decayForIdle, expectedScore, GLICKO_DEFAULT, glickoUpdate, rateFight, RD_MIN } from "./rating.js";

/** Glicko-2 (P3-FGT-10): the reference example of Glickman's paper, and the properties the API relies on */
describe("Glicko-2", () => {
  it("matches the paper's worked example (1500 / 200 / 0.06 vs three opponents, τ = 0.5)", () => {
    const r = glickoUpdate({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opp: { rating: 1400, rd: 30, vol: 0.06 }, score: 1 },
      { opp: { rating: 1550, rd: 100, vol: 0.06 }, score: 0 },
      { opp: { rating: 1700, rd: 300, vol: 0.06 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });

  it("a fight: the winner goes up, the loser down, by the same amount for equal new players; draws between equals change nothing", () => {
    const [a, b] = rateFight(GLICKO_DEFAULT, GLICKO_DEFAULT, 1);
    expect(a.rating).toBeGreaterThan(1500);
    expect(b.rating).toBeLessThan(1500);
    expect(a.rating - 1500).toBeCloseTo(1500 - b.rating, 6);
    expect(a.rd).toBeLessThan(350);
    const [c, d] = rateFight(GLICKO_DEFAULT, GLICKO_DEFAULT, 0.5);
    expect(c.rating).toBeCloseTo(1500, 6);
    expect(d.rating).toBeCloseTo(1500, 6);
  });

  it("beating a much stronger player gains more than beating a weaker one; an upset loss costs the favourite more", () => {
    const me = { rating: 1500, rd: 80, vol: 0.06 };
    const strong = { rating: 1800, rd: 80, vol: 0.06 };
    const weak = { rating: 1200, rd: 80, vol: 0.06 };
    const upGainStrong = glickoUpdate(me, [{ opp: strong, score: 1 }]).rating - 1500;
    const upGainWeak = glickoUpdate(me, [{ opp: weak, score: 1 }]).rating - 1500;
    expect(upGainStrong).toBeGreaterThan(3 * upGainWeak);
    expect(expectedScore(strong, me)).toBeGreaterThan(0.8);
  });

  it("provisional players move fast, established ones slowly; RD shrinks with fights and grows back when idle", () => {
    const fresh = glickoUpdate(GLICKO_DEFAULT, [{ opp: GLICKO_DEFAULT, score: 1 }]).rating - 1500;
    const est = glickoUpdate({ rating: 1500, rd: 60, vol: 0.06 }, [{ opp: { rating: 1500, rd: 60, vol: 0.06 }, score: 1 }]).rating - 1500;
    expect(fresh).toBeGreaterThan(4 * est);
    let p = GLICKO_DEFAULT;
    for (let k = 0; k < 30; k++) p = glickoUpdate(p, [{ opp: { rating: 1500, rd: 80, vol: 0.06 }, score: k % 2 }]);
    expect(p.rd).toBeLessThan(120);
    expect(p.rd).toBeGreaterThanOrEqual(RD_MIN);
    expect(decayForIdle(p, 90).rd).toBeGreaterThan(p.rd);
    expect(decayForIdle(p, 3).rd).toBe(p.rd);
  });

  it("the conservative skill (r − 2·RD) keeps a two-fight newcomer under an established winner", () => {
    let fresh = GLICKO_DEFAULT;
    for (let k = 0; k < 2; k++) fresh = glickoUpdate(fresh, [{ opp: GLICKO_DEFAULT, score: 1 }]);
    const vet = { rating: 1650, rd: 60, vol: 0.06 };
    expect(fresh.rating).toBeGreaterThan(1600);
    expect(conservativeSkill(fresh)).toBeLessThan(conservativeSkill(vet));
  });
});
