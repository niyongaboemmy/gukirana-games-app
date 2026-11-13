import { describe, expect, it } from "vitest";
import { facingPits, igisoroBotMove, igisoroModule, initIgisoro, legalPits, MAX_MOVES, playIgisoro, totalSeeds } from "./index.js";

describe("igisoro engine", () => {
  it("starts with 64 seeds and 16 legal moves", () => {
    const s = initIgisoro(["a", "b"]);
    expect(totalSeeds(s)).toBe(64);
    expect(legalPits(s)).toHaveLength(16);
  });

  it("maps facing pits by column", () => {
    expect(facingPits(0)).toEqual({ inner: 7, outer: 8 });
    expect(facingPits(7)).toEqual({ inner: 0, outer: 15 });
  });

  it("conserves seeds and always terminates (bot vs bot simulations)", () => {
    for (let game = 0; game < 40; game++) {
      let s = initIgisoro(["a", "b"]);
      // vary the opening deterministically
      s = playIgisoro(s, legalPits(s)[game % 16]!);
      let guard = 0;
      while (s.winner === null && guard++ < 500) {
        s = playIgisoro(s, igisoroBotMove(s, 1 + (guard % 2)));
        expect(totalSeeds(s)).toBe(64);
      }
      expect(guard).toBeLessThan(500);
    }
  });

  it("captures both facing pits when the last seed lands in an occupied inner pit", () => {
    const s = initIgisoro(["a", "b"]);
    s.pits = [Array(16).fill(0), Array(16).fill(0)];
    s.pits[0][0] = 2; // sow into pits 1 and 2; pit 2 already holds 1 → last seed lands in an occupied inner pit
    s.pits[0][2] = 1;
    s.pits[1][5] = 3; // facing pit 2: opponent inner 7-2=5 and outer 8+2=10
    s.pits[1][10] = 4;
    s.pits[1][0] = 2; // keeps the opponent alive
    const r = playIgisoro(s, 0);
    const capture = r.lastEvents.find((e) => e.kind === "capture");
    expect(capture).toEqual({ kind: "capture", from: 1, pits: [5, 10], seeds: 7 });
    expect(r.pits[1][5]).toBe(0);
    expect(r.pits[1][10]).toBe(0);
    expect(totalSeeds(r)).toBe(totalSeeds(s));
  });

  it("a player left without a legal move loses", () => {
    const s = initIgisoro(["a", "b"]);
    s.pits = [Array(16).fill(0), Array(16).fill(0)];
    s.pits[0][0] = 2;
    s.pits[1][15] = 1; // only singletons: no legal move after a's turn
    const r = playIgisoro(s, 0);
    expect(r.winner).toBe(0);
    expect(igisoroModule.isTerminal(r)).toBe(true);
  });

  it("the move cap ends the game: more seeds wins, equal seeds is a draw (both rank 1)", () => {
    const s = initIgisoro(["a", "b"]);
    s.pits = [Array(16).fill(0), Array(16).fill(0)];
    s.pits[0][0] = 2; // sows into two empty pits: the turn simply ends
    s.pits[1][3] = 2;
    s.moveCount = MAX_MOVES - 1;
    const more = structuredClone(s);
    more.pits[1][4] = 2;
    const won = playIgisoro(more, 0);
    expect(won.winner).toBe(1);
    const r = playIgisoro(s, 0);
    expect(r.draw).toBe(true);
    expect(igisoroModule.isTerminal(r)).toBe(true);
    expect(igisoroModule.currentTurn(r)).toBeNull();
    expect(igisoroModule.result(r).ranks).toEqual({ a: 1, b: 1 });
    expect(igisoroModule.validate(r, "b", { pit: 0 }).ok).toBe(false);
  });

  it("bot only plays legal pits", () => {
    const s = initIgisoro(["a", "b"]);
    expect(legalPits(s)).toContain(igisoroBotMove(s, 2));
  });
});
