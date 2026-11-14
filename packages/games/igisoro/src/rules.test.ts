import { describe, expect, it } from "vitest";
import { createFairRng } from "@gukirana/fairness";
import { facingPits, igisoroBotMove, igisoroModule, initIgisoro, legalPits, playIgisoro, PITS_PER_PLAYER, ROW, totalSeeds, type IgisoroState } from "./index.js";

const empty = (): IgisoroState => {
  const s = initIgisoro(["a", "b"]);
  s.pits = [Array(16).fill(0), Array(16).fill(0)];
  return s;
};

/** Rebuild the board from the event log alone (what the client animation does) — it must match the engine. */
function replay(from: IgisoroState, next: IgisoroState): [number[], number[]] {
  const pits: [number[], number[]] = [[...from.pits[0]], [...from.pits[1]]];
  let hand = 0;
  for (const e of next.lastEvents) {
    if (e.kind === "pickup") {
      expect(pits[e.player][e.pit]).toBe(e.seeds);
      pits[e.player][e.pit] = 0;
      hand = e.seeds;
    } else if (e.kind === "sow") {
      expect(hand).toBeGreaterThan(0);
      pits[e.player][e.pit]! += 1;
      hand -= 1;
    } else {
      expect(hand).toBe(0); // a capture only happens on the last seed
      hand = e.pits.reduce((a, p) => a + pits[e.from][p]!, 0);
      expect(hand).toBe(e.seeds);
      for (const p of e.pits) pits[e.from][p] = 0;
    }
  }
  expect(hand).toBe(0);
  return pits;
}

describe("igisoro rules (property / edge cases)", () => {
  it("board: 2 players × 2 rows × 8 pits, 2 seeds per pit (64 seeds), seeds configurable", () => {
    const s = initIgisoro(["a", "b"]);
    expect(s.pits.map((p) => p.length)).toEqual([PITS_PER_PLAYER, PITS_PER_PLAYER]);
    expect(ROW * 2).toBe(PITS_PER_PLAYER);
    expect(totalSeeds(s)).toBe(64);
    expect(totalSeeds(initIgisoro(["a", "b"], { seedsPerPit: 4 }))).toBe(128);
  });

  it("facing pits pair each inner column with the opponent's inner and outer pit of the same column (both sides agree)", () => {
    for (let c = 0; c < ROW; c++) {
      const f = facingPits(c);
      // the opponent's inner pit f.inner sits at their column 7 - c, which faces my column c
      expect(facingPits(f.inner).inner).toBe(c);
      expect(f.outer).toBe(ROW + c);
      expect(f.outer - ROW).toBe(ROW - 1 - f.inner);
    }
  });

  it("sowing goes round the player's own 16 pits only, one seed per pit, in loop order", () => {
    const s = empty();
    s.pits[0][14] = 5;
    s.pits[1][0] = 2;
    const r = playIgisoro(s, 14);
    const sown = r.lastEvents.filter((e) => e.kind === "sow").map((e) => (e.kind === "sow" ? [e.player, e.pit] : []));
    expect(sown).toEqual([
      [0, 15],
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    expect(r.pits[1]).toEqual(s.pits[1]); // never sows into the opponent's pits
  });

  it("relay sowing: the last seed in an occupied pit picks the pit up and continues", () => {
    const s = empty();
    s.pits[0][10] = 2; // → 11, 12; 12 holds 2 (outer row: no capture) → pick up 3 → 13, 14, 15
    s.pits[0][12] = 2;
    s.pits[1][0] = 2;
    const r = playIgisoro(s, 10);
    expect(r.lastEvents.filter((e) => e.kind === "pickup")).toEqual([
      { kind: "pickup", player: 0, pit: 10, seeds: 2 },
      { kind: "pickup", player: 0, pit: 12, seeds: 3 },
    ]);
    expect(r.pits[0].slice(10, 16)).toEqual([0, 1, 0, 1, 1, 1]);
    expect(r.turn).toBe(1);
  });

  it("no capture from the outer row, nor when one of the facing pits is empty", () => {
    const s = empty();
    s.pits[0][0] = 2;
    s.pits[0][2] = 1; // last seed lands on 2 (inner) → occupied
    s.pits[1][5] = 3; // facing inner of column 2 …
    s.pits[1][10] = 0; // … but its outer partner is empty → relay instead of capture
    s.pits[1][0] = 2;
    const r = playIgisoro(s, 0);
    expect(r.lastEvents.some((e) => e.kind === "capture")).toBe(false);
    expect(r.pits[1][5]).toBe(3);
  });

  it("captured seeds are sown on from the pit after the capturing pit", () => {
    const s = empty();
    s.pits[0][0] = 2;
    s.pits[0][2] = 1;
    s.pits[1][5] = 1;
    s.pits[1][10] = 1; // capture 2 seeds → sow into 3 and 4
    s.pits[1][0] = 2;
    const r = playIgisoro(s, 0);
    expect(r.lastEvents.map((e) => e.kind)).toEqual(["pickup", "sow", "sow", "capture", "sow", "sow"]);
    expect(r.pits[0].slice(0, 5)).toEqual([0, 1, 2, 1, 1]);
  });

  it("pits with fewer than 2 seeds cannot be played (validation and legal list agree)", () => {
    const s = empty();
    s.pits[0][3] = 1;
    s.pits[0][4] = 2;
    s.pits[1][0] = 2;
    expect(legalPits(s)).toEqual([4]);
    expect(igisoroModule.validate(s, "a", { pit: 3 })).toEqual({ ok: false, reason: "PIT_NEEDS_2_SEEDS" });
    expect(igisoroModule.validate(s, "b", { pit: 4 })).toEqual({ ok: false, reason: "NOT_YOUR_TURN" });
    expect(igisoroModule.validate(s, "a", { pit: 4 }).ok).toBe(true);
  });

  it("random games: seeds are conserved, the event log replays to the same board, games end, both sides scored", () => {
    for (let g = 0; g < 60; g++) {
      const rng = createFairRng(`igi-${g}`, ["c"], `m-${g}`);
      let s = initIgisoro(["a", "b"], { seedsPerPit: g % 3 === 0 ? 4 : 2 });
      const total = totalSeeds(s);
      let guard = 0;
      while (!igisoroModule.isTerminal(s) && guard++ < 400) {
        const legal = legalPits(s);
        expect(legal.length).toBeGreaterThan(0);
        const pit = legal[rng.int(0, legal.length - 1)]!;
        const next = playIgisoro(s, pit);
        expect(replay(s, next)).toEqual(next.pits);
        expect(totalSeeds(next)).toBe(total);
        expect(next.pits.every((side) => side.every((n) => n >= 0 && Number.isInteger(n)))).toBe(true);
        s = next;
      }
      expect(igisoroModule.isTerminal(s)).toBe(true);
      const r = igisoroModule.result(s);
      if (s.draw) expect(Object.values(r.ranks)).toEqual([1, 1]);
      else {
        // the loser has no legal move left (or the move cap decided it on seeds)
        const loser = (1 - s.winner!) as 0 | 1;
        if (s.moveCount < 300) expect(legalPits(s, loser)).toEqual([]);
        expect(r.ranks[s.players[s.winner!]]).toBe(1);
      }
    }
  });

  it("every bot level only plays legal pits, deterministically; deeper bots beat Easy", () => {
    let deepWins = 0;
    for (let g = 0; g < 16; g++) {
      let s = playIgisoro(initIgisoro(["a", "b"]), g); // vary the opening
      let guard = 0;
      while (!igisoroModule.isTerminal(s) && guard++ < 300) {
        const lv = s.turn === 1 ? 4 : 1;
        const pit = igisoroBotMove(s, lv);
        expect(legalPits(s)).toContain(pit);
        expect(igisoroBotMove(s, lv)).toBe(pit);
        s = playIgisoro(s, pit);
      }
      if (s.winner === 1) deepWins++;
    }
    expect(deepWins).toBeGreaterThan(9);
  });

  it("a timeout plays the first legal pit for the player who ran out of time", () => {
    const s = initIgisoro(["a", "b"]);
    const r = igisoroModule.onTimeout(s, "a");
    expect(r.moveCount).toBe(1);
    expect(r.lastEvents[0]).toMatchObject({ kind: "pickup", player: 0, pit: 0 });
  });
});
