import { describe, expect, it } from "vitest";
import { createFairRng } from "@gukirana/fairness";
import { fairRackOrder, initPool, inGroup, legalTargets, playShot, poolBotShot, poolModule, U, type Ball, type PoolState } from "./index.js";

const ball = (n: number, x: number, y: number, inPocket = false): Ball => ({ n, x: x * U, y: y * U, vx: 0, vy: 0, in: inPocket });
const far = (n: number, i: number) => ball(n, 14000 + (i % 5) * 900, 9500 + Math.trunc(i / 5) * 900);

/** A table with the cue at (5000,5000), `target` on the straight line into the top-left pocket, the rest parked far away. */
function table(target: number, opts: Partial<PoolState> = {}): PoolState {
  const balls: Ball[] = [ball(0, 5000, 5000), ball(target, 1500, 1500)];
  let i = 0;
  for (let n = 1; n <= 15; n++) if (n !== target) balls.push(far(n, i++));
  return { players: ["a", "b"], turn: 0, balls, groups: [null, null], winner: null, shots: 5, ballInHand: false, lastShot: null, ...opts };
}
const POT = { dx: -1000, dy: -1000, power: 450, spin: 0 };

describe("8-ball rules (edge cases)", () => {
  it("fair rack: 15 distinct balls, the 8 in the centre of row 3, a solid and a stripe in the back corners", () => {
    for (let g = 0; g < 50; g++) {
      const order = fairRackOrder(createFairRng(`rack-${g}`, ["c"], "m"));
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(order[4]).toBe(8);
      const corners = [order[10]!, order[14]!];
      expect(corners.some((n) => inGroup(n, "solids"))).toBe(true);
      expect(corners.some((n) => inGroup(n, "stripes"))).toBe(true);
    }
    const s = initPool(["a", "b"], createFairRng("x", ["c"], "m"));
    expect(s.balls.filter((b) => !b.in)).toHaveLength(16);
    expect(s.groups).toEqual([null, null]);
  });

  it("open table: the first legal pot decides the groups and the shooter keeps the table", () => {
    const solid = playShot(table(3), POT);
    expect(solid.lastShot?.foul).toBeNull();
    expect(solid.groups).toEqual(["solids", "stripes"]);
    expect(solid.turn).toBe(0);
    const stripe = playShot(table(11, { turn: 1, players: ["a", "b"] }), POT);
    expect(stripe.groups).toEqual(["solids", "stripes"]); // shooter 1 took stripes
    expect(stripe.turn).toBe(1);
  });

  it("open table: legal targets are every object ball but the 8", () => {
    expect(legalTargets(table(3)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("hitting the opponent's group first is a foul: ball in hand, the potted ball stays down, groups unchanged", () => {
    const r = playShot(table(11, { groups: ["solids", "stripes"] }), POT);
    expect(r.lastShot?.foul).toBe("wrong ball first");
    expect(r.turn).toBe(1);
    expect(r.ballInHand).toBe(true);
    expect(r.balls.find((b) => b.n === 11)!.in).toBe(true);
    expect(r.groups).toEqual(["solids", "stripes"]);
  });

  it("a foul does not assign groups on an open table", () => {
    // follow-through scratch while potting a solid on an open table
    const r = playShot(table(3), { ...POT, spin: 60 });
    expect(r.lastShot?.events.pocketed).toContain(0);
    expect(r.lastShot?.foul).toBe("scratch");
    expect(r.groups).toEqual([null, null]);
    expect(r.ballInHand).toBe(true);
    expect(r.balls.find((b) => b.n === 0)!.in).toBe(false); // the cue ball comes back for ball in hand
  });

  it("hitting the 8 first on an open table (after the break) is a foul", () => {
    const s = table(3);
    s.balls = s.balls.map((b) => (b.n === 0 ? ball(0, 10000, 6350) : b.n === 8 ? ball(8, 11000, 6350) : b.n === 3 ? ball(3, 20000, 2000) : b));
    const r = playShot(s, { dx: 1000, dy: 0, power: 120, spin: 0 });
    expect(r.lastShot?.events.firstHit).toBe(8);
    expect(r.lastShot?.foul).toBe("8-ball hit first");
    expect(r.winner).toBeNull();
  });

  it("missing every ball is a foul", () => {
    const s = table(3);
    const r = playShot(s, { dx: 0, dy: 1000, power: 150, spin: 0 }); // straight down the table, away from every ball
    expect(r.lastShot?.events.firstHit).toBeNull();
    expect(r.lastShot?.foul).toBe("no ball hit");
    expect(r.ballInHand).toBe(true);
  });

  it("on the 8: sinking it with a scratch loses, even in the called pocket", () => {
    const s = table(8, { groups: ["solids", "stripes"] });
    s.balls = s.balls.map((b) => (inGroup(b.n, "solids") ? { ...b, in: true } : b));
    const r = playShot(s, { ...POT, spin: 60, pocket: 0 });
    expect(r.lastShot?.events.pocketed).toEqual(expect.arrayContaining([8, 0]));
    expect(r.winner).toBe(1);
    expect(r.lastShot?.message).toMatch(/foul/);
  });

  it("the timeout and every rejected intent leave the table untouched", () => {
    const s = table(3);
    expect(poolModule.validate(s, "b", POT)).toEqual({ ok: false, reason: "NOT_YOUR_TURN" });
    expect(poolModule.validate(s, "a", { ...POT, dx: 0, dy: 0 })).toEqual({ ok: false, reason: "NO_DIRECTION" });
    const t = poolModule.onTimeout(s, "a");
    expect(t.balls).toEqual(s.balls);
  });

  it("bot shots are always valid intents, at every level, through a whole game", () => {
    for (const level of [1, 3, 5]) {
      let s = initPool(["a", "b"], createFairRng(`bot-${level}`, ["c"], "m"));
      for (let i = 0; i < 12 && s.winner === null; i++) {
        const shot = poolBotShot(s, level);
        expect(poolModule.validate(s, s.players[s.turn], shot).ok).toBe(true);
        s = playShot(s, shot);
        expect(s.balls.filter((b) => b.n === 0 && b.in)).toHaveLength(0); // the cue ball is always back on the table
      }
    }
  }, 60_000);
});
