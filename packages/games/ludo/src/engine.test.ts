import { describe, expect, it } from "vitest";
import { createFairRng } from "@gukirana/fairness";
import { HOME, initLudo, ludoBotMove, ludoModule, moveToken, movableTokens, rollDice } from "./index.js";

describe("ludo engine", () => {
  it("needs a 6 to leave base", () => {
    const s = initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
    expect(movableTokens(s.players[0]!, 5)).toEqual([]);
    expect(movableTokens(s.players[0]!, 6)).toEqual([0, 1, 2, 3]);
  });

  it("captures on unsafe squares", () => {
    let s = initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
    s.players[0]!.tokens[0] = 2; // abs 2
    s.players[1]!.tokens[0] = 30; // seat 2: (26 + 30) % 52 = 4
    s = { ...s, phase: "move", dice: 2 };
    s = moveToken(s, 0);
    expect(s.players[1]!.tokens[0]).toBe(-1);
    expect(s.phase).toBe("roll"); // bonus turn after capture
    expect(s.turn).toBe(0);
  });

  it("never captures on a safe square (star or start)", () => {
    let s = initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
    s.players[0]!.tokens[0] = 5; // → 8 (star)
    s.players[1]!.tokens[0] = 34; // seat 2: (26 + 34) % 52 = 8
    s = moveToken({ ...s, phase: "move", dice: 3 }, 0);
    expect(s.players[1]!.tokens[0]).toBe(34);
    expect(s.turn).toBe(1); // no bonus
  });

  it("a 6 gives another roll; three 6s in a row lose the turn", () => {
    const fixed = (values: number[]) => ({ int: () => values.shift()! });
    let s = initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
    s = rollDice(s, fixed([6]));
    expect(s.phase).toBe("move");
    s = moveToken(s, 0);
    expect(s.turn).toBe(0);
    expect(s.phase).toBe("roll");
    s = rollDice(s, fixed([6]));
    s = moveToken(s, 0);
    s = rollDice(s, fixed([6]));
    expect(s.lastEvent).toEqual({ kind: "pass", player: "a", reason: "three-sixes" });
    expect(s.turn).toBe(1);
  });

  it("needs the exact count to reach home and gets a bonus roll on arrival", () => {
    let s = initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
    s.players[0]!.tokens = [53, -1, -1, -1];
    expect(movableTokens(s.players[0]!, 4)).toEqual([]); // 53 + 4 > 56
    s = moveToken({ ...s, phase: "move", dice: 3 }, 0);
    expect(s.players[0]!.tokens[0]).toBe(HOME);
    expect(s.turn).toBe(0);
  });

  it("passes the turn when no token can move", () => {
    const s = rollDice(initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]), { int: () => 3 });
    expect(s.turn).toBe(1);
    expect(s.lastEvent).toMatchObject({ kind: "roll", dice: 3, movable: [] });
  });

  it("finishes bot-vs-bot games with fair dice (4 players)", () => {
    for (let g = 0; g < 30; g++) {
      const rng = createFairRng(`seed-${g}`, ["c1"], `m-${g}`);
      let s = initLudo([
        { id: "a", seat: 0 },
        { id: "b", seat: 1 },
        { id: "c", seat: 2 },
        { id: "d", seat: 3 },
      ]);
      let guard = 0;
      while (!s.winner && guard++ < 5000) {
        s = s.phase === "roll" ? rollDice(s, rng) : moveToken(s, ludoBotMove(s));
        if (s.players.some((p) => p.tokens.some((t) => t < -1 || t > HOME))) throw new Error("token out of range");
      }
      expect(s.winner).not.toBeNull();
    }
  });

  it("validates intents", () => {
    const s = initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
    expect(ludoModule.validate(s, "b", { type: "roll" }).ok).toBe(false);
    expect(ludoModule.validate(s, "a", { type: "move", token: 0 }).ok).toBe(false);
    expect(ludoModule.validate(s, "a", { type: "roll" }).ok).toBe(true);
  });
});
