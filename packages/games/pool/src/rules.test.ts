import { describe, expect, it } from "vitest";
import { canPlaceCue, initPool, legalTargets, onTheEight, playShot, poolBotShot, poolModule, simulateShot, U, type Ball, type PoolState } from "./index.js";
import { createFairRng } from "@gukirana/fairness";

const ball = (n: number, x: number, y: number, inPocket = false): Ball => ({ n, x: x * U, y: y * U, vx: 0, vy: 0, in: inPocket });
/** all of a group potted (in) so the shooter is on the 8 */
const pottedGroup = (from: number) => Array.from({ length: 7 }, (_, i) => ball(from + i, 0, 0, true));

function onEight(cueAt: [number, number], eightAt: [number, number]): PoolState {
  return {
    players: ["a", "b"],
    turn: 0,
    balls: [ball(0, ...cueAt), ...pottedGroup(1), ball(8, ...eightAt), ball(9, 20000, 10000), ball(10, 20000, 3000)],
    groups: ["solids", "stripes"],
    winner: null,
    shots: 12,
    ballInHand: false,
    lastShot: null,
  };
}

describe("8-ball rules", () => {
  it("calls the pocket on the 8: right pocket wins, wrong pocket loses, no call is rejected", () => {
    // cue at (5000,5000), 8 at (1500,1500): a straight shot into the top-left corner (pocket 0)
    const s = onEight([5000, 5000], [1500, 1500]);
    expect(onTheEight(s)).toBe(true);
    expect(legalTargets(s)).toEqual([8]);
    const shot = { dx: -1000, dy: -1000, power: 450, spin: 0 };
    expect(poolModule.validate(s, "a", shot)).toEqual({ ok: false, reason: "CALL_POCKET" });
    const raw = simulateShot(s.balls, shot.dx, shot.dy, shot.power, 0);
    expect(raw.events.pocketed).toContain(8);
    expect(raw.events.pockets[raw.events.pocketed.indexOf(8)]).toBe(0);

    const right = playShot(s, { ...shot, pocket: 0 });
    expect(right.winner).toBe(0);
    const wrong = playShot(s, { ...shot, pocket: 5 });
    expect(wrong.winner).toBe(1);
    expect(wrong.lastShot?.message).toMatch(/wrong pocket/);
  });

  it("potting the 8 before the group is cleared loses", () => {
    const s = onEight([5000, 5000], [1500, 1500]);
    s.balls[1]!.in = false; // one solid still on the table, far away
    s.balls[1]!.x = 20000 * U;
    s.balls[1]!.y = 6000 * U;
    const r = playShot(s, { dx: -1000, dy: -1000, power: 450, spin: 0 });
    expect(r.winner).toBe(1);
  });

  it("a foul gives the opponent ball in hand; placement is validated and applied", () => {
    // cue straight into the top-left pocket: scratch
    const s = onEight([3000, 3000], [20000, 6000]);
    s.groups = [null, null];
    s.balls = s.balls.map((b) => (b.n >= 1 && b.n <= 7 ? { ...b, in: false, x: (12000 + b.n * 700) * U, y: 9000 * U } : b));
    const r = playShot(s, { dx: -1000, dy: -1000, power: 600, spin: 0 });
    expect(r.lastShot?.foul).toBe("scratch");
    expect(r.turn).toBe(1);
    expect(r.ballInHand).toBe(true);
    const cue = r.balls.find((b) => b.n === 0)!;
    expect(cue.in).toBe(false);

    // placing onto another ball is rejected; a clear spot is accepted and used
    const other = r.balls.find((b) => !b.in && b.n !== 0)!;
    const bad = { dx: 1000, dy: 0, power: 300, spin: 0, cue: { x: Math.trunc(other.x / U), y: Math.trunc(other.y / U) } };
    expect(poolModule.validate(r, "b", bad).ok).toBe(false);
    expect(canPlaceCue(r, 6000, 6350)).toBe(true);
    const good = { dx: 1000, dy: 0, power: 1, spin: 0, cue: { x: 6000, y: 6350 } };
    expect(poolModule.validate(r, "b", good).ok).toBe(true);
    const placed = playShot(r, good);
    const c2 = placed.balls.find((b) => b.n === 0)!;
    expect(Math.abs(c2.x - 6000 * U)).toBeLessThan(200 * U); // barely moved from the placement
  });

  it("cue placement without ball in hand is rejected", () => {
    const s = initPool(["a", "b"], createFairRng("x", ["c"], "m"));
    expect(poolModule.validate(s, "a", { dx: 1, dy: 0, power: 500, spin: 0, cue: { x: 5000, y: 6000 } })).toEqual({ ok: false, reason: "NO_BALL_IN_HAND" });
  });

  it("no rail after contact is a foul", () => {
    const s = onEight([10000, 6350], [11000, 6350]);
    s.groups = [null, null];
    s.balls = s.balls.map((b) => (b.n === 1 ? { ...b, in: false, x: 11000 * U, y: 6350 * U } : b.n === 8 ? { ...b, x: 18000 * U, y: 3000 * U } : b));
    const r = playShot(s, { dx: 1000, dy: 0, power: 40, spin: 0 });
    expect(r.lastShot?.events.firstHit).toBe(1);
    expect(r.lastShot?.foul).toBe("no rail after contact");
    expect(r.ballInHand).toBe(true);
  });

  it("the 8-ball on the break is re-spotted, not a loss", () => {
    const s = onEight([5000, 5000], [1500, 1500]);
    s.shots = 0;
    s.groups = [null, null];
    s.balls = s.balls.map((b) => (b.n >= 1 && b.n <= 7 ? { ...b, in: false, x: (12000 + b.n * 700) * U, y: 11000 * U } : b));
    const r = playShot(s, { dx: -1000, dy: -1000, power: 450, spin: 0 });
    expect(r.winner).toBeNull();
    const eight = r.balls.find((b) => b.n === 8)!;
    expect(eight.in).toBe(false);
    expect(r.lastShot?.message).toMatch(/re-spotted/);
  });

  it("a shot-clock timeout hands the opponent ball in hand", () => {
    const s = initPool(["a", "b"], createFairRng("x", ["c"], "m"));
    const t = poolModule.onTimeout(s, "a");
    expect(t.turn).toBe(1);
    expect(t.ballInHand).toBe(true);
  });

  it("the bot calls a pocket on the 8 and uses legal ball-in-hand spots", () => {
    const s = onEight([5000, 5000], [1500, 1500]);
    const shot = poolBotShot(s, 5);
    expect(shot.pocket).toBeDefined();
    expect(poolModule.validate(s, "a", shot).ok).toBe(true);
    const hand = { ...s, ballInHand: true };
    const h = poolBotShot(hand, 3);
    expect(poolModule.validate(hand, "a", h).ok).toBe(true);
  });

  it("bot levels differ only by deterministic error (same input → same shot)", () => {
    const s = initPool(["a", "b"], createFairRng("y", ["c"], "m"));
    expect(poolBotShot(s, 1)).toEqual(poolBotShot(s, 1));
  });
});
