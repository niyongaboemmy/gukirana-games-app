import { describe, expect, it } from "vitest";
import { createFairRng } from "@gukirana/fairness";
import {
  absoluteSquare,
  finishingOrder,
  HOME,
  initLudo,
  LAST_TRACK,
  ludoBotMove,
  ludoModule,
  movableTokens,
  moveToken,
  rollDice,
  SAFE_SQUARES,
  type LudoState,
} from "./index.js";

const two = () => initLudo([{ id: "a", seat: 0 }, { id: "b", seat: 2 }]);
const four = () =>
  initLudo([
    { id: "a", seat: 0 },
    { id: "b", seat: 1 },
    { id: "c", seat: 2 },
    { id: "d", seat: 3 },
  ]);
const fixed = (values: number[]) => ({ int: () => values.shift()! });

/** Invariants that must hold after every action of every game. */
function checkInvariants(s: LudoState) {
  for (const p of s.players) {
    expect(p.tokens).toHaveLength(4);
    for (const t of p.tokens) expect(t >= -1 && t <= HOME && Number.isInteger(t)).toBe(true);
  }
  // two different colours never share an unsafe track square (landing there always captures)
  const seen = new Map<number, string>();
  for (const p of s.players)
    for (const t of p.tokens) {
      if (t < 0 || t > LAST_TRACK) continue;
      const sq = absoluteSquare(p.seat, t);
      if (SAFE_SQUARES.has(sq)) continue;
      const other = seen.get(sq);
      if (other) expect(other).toBe(p.id);
      seen.set(sq, p.id);
    }
  if (s.winner) expect(s.players.find((p) => p.id === s.winner)!.tokens.every((t) => t === HOME)).toBe(true);
  expect(s.sixesInRow).toBeLessThan(3);
  if (s.phase === "move") expect(s.dice).not.toBeNull();
}

describe("ludo rules (property / edge cases)", () => {
  it("every seat starts on its own coloured square, 13 apart, and safe squares are the 4 starts + 4 stars", () => {
    expect([0, 1, 2, 3].map((seat) => absoluteSquare(seat, 0))).toEqual([0, 13, 26, 39]);
    for (const seat of [0, 1, 2, 3]) expect(SAFE_SQUARES.has(absoluteSquare(seat, 0))).toBe(true);
    expect([...SAFE_SQUARES].sort((a, b) => a - b)).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
    // the last track square is the one just before the seat's own start (51 squares round, then the home column)
    for (const seat of [0, 1, 2, 3]) expect((absoluteSquare(seat, LAST_TRACK) + 2) % 52).toBe(absoluteSquare(seat, 0));
  });

  it("tokens in the home column can never be captured, and never capture", () => {
    let s = four();
    s.players[0]!.tokens = [52, -1, -1, -1]; // in red's home column
    s.players[1]!.tokens = [37, -1, -1, -1]; // green at abs (13 + 37) % 52 = 50
    s = moveToken({ ...s, turn: 1, phase: "move", dice: 2 }, 0); // green moves past
    expect(s.players[0]!.tokens[0]).toBe(52);
  });

  it("captures every opponent token on the landing square (all of them go back to base)", () => {
    let s = four();
    s.players[0]!.tokens = [2, -1, -1, -1]; // abs 2 → moves to abs 4
    s.players[2]!.tokens = [30, 30, -1, -1]; // seat 2: (26 + 30) % 52 = 4, a pair
    s.players[3]!.tokens = [17, -1, -1, -1]; // seat 3: (39 + 17) % 52 = 4
    s = moveToken({ ...s, phase: "move", dice: 2 }, 0);
    expect(s.players[2]!.tokens.slice(0, 2)).toEqual([-1, -1]);
    expect(s.players[3]!.tokens[0]).toBe(-1);
    expect(s.lastEvent).toMatchObject({ kind: "move", captured: [{ player: "c", token: 0 }, { player: "c", token: 1 }, { player: "d", token: 0 }] });
  });

  it("own tokens stack without capturing each other", () => {
    let s = two();
    s.players[0]!.tokens = [3, 5, -1, -1];
    s = moveToken({ ...s, phase: "move", dice: 2 }, 0);
    expect(s.players[0]!.tokens).toEqual([5, 5, -1, -1]);
  });

  it("a token leaving base lands on the start square and is never captured there", () => {
    let s = two();
    s.players[1]!.tokens = [26, -1, -1, -1]; // seat 2 at (26 + 26) % 52 = 0: red's start
    s = moveToken({ ...s, phase: "move", dice: 6 }, 1);
    expect(s.players[0]!.tokens[1]).toBe(0);
    expect(s.players[1]!.tokens[0]).toBe(26);
  });

  it("exact roll to finish: no overshoot, every exact count lands HOME", () => {
    for (let from = 50; from < HOME; from++)
      for (let d = 1; d <= 6; d++) {
        const p = { id: "a", seat: 0 as const, tokens: [from, HOME, HOME, HOME] as [number, number, number, number] };
        expect(movableTokens(p, d)).toEqual(from + d <= HOME ? [0] : []);
      }
  });

  it("a 6 with no legal move passes the turn (no bonus roll)", () => {
    let s = two();
    s.players[0]!.tokens = [54, HOME, HOME, HOME];
    s = rollDice(s, fixed([6]));
    expect(s.turn).toBe(1);
    expect(s.lastEvent).toMatchObject({ kind: "roll", dice: 6, movable: [] });
  });

  it("the three-sixes counter resets on a new turn and after a non-6 bonus roll", () => {
    let s = two();
    s.players[0]!.tokens = [10, 20, -1, -1];
    s.players[1]!.tokens = [0, -1, -1, -1]; // seat 2 at abs 26
    s = rollDice(s, fixed([6]));
    s = moveToken(s, 1); // 20 → 26: yellow's start square (safe), no capture; the 6 gives a bonus roll
    expect(s.turn).toBe(0);
    expect(s.sixesInRow).toBe(1);
    s.players[1]!.tokens = [5, -1, -1, -1]; // seat 2 at abs 31, five ahead of red token 1 (abs 26)
    s = rollDice(s, fixed([5]));
    expect(s.sixesInRow).toBe(0);
    s = moveToken(s, 1); // abs 26 + 5 = 31: capture → bonus roll with a fresh counter
    expect(s.lastEvent).toMatchObject({ kind: "move", captured: [{ player: "b", token: 0 }] });
    expect(s.turn).toBe(0);
    s = rollDice(s, fixed([6]));
    expect(s.sixesInRow).toBe(1);
    s = moveToken(s, 0);
    s = rollDice(s, fixed([6]));
    s = moveToken(s, 0);
    s = rollDice(s, fixed([6]));
    expect(s.lastEvent).toMatchObject({ kind: "pass", reason: "three-sixes" });
    expect(s.turn).toBe(1);
    expect(s.sixesInRow).toBe(0);
  });

  it("a capture or reaching home gives a bonus roll; the last token home ends the game with no extra roll", () => {
    let s = two();
    s.players[0]!.tokens = [53, HOME, HOME, HOME];
    s = moveToken({ ...s, phase: "move", dice: 3 }, 0);
    expect(s.winner).toBe("a");
    expect(ludoModule.isTerminal(s)).toBe(true);
    expect(ludoModule.currentTurn(s)).toBeNull();
    expect(ludoModule.validate(s, "a", { type: "roll" })).toEqual({ ok: false, reason: "GAME_OVER" });
  });

  it("finishing order: winner first, then by tokens home and squares travelled; ties share a place", () => {
    const s = four();
    s.winner = "b";
    s.players[1]!.tokens = [HOME, HOME, HOME, HOME];
    s.players[0]!.tokens = [HOME, 10, -1, -1];
    s.players[2]!.tokens = [40, 40, 40, 40];
    s.players[3]!.tokens = [40, 40, 40, 40];
    expect(finishingOrder(s)).toEqual({ b: 1, a: 2, c: 3, d: 3 });
    const t = two();
    t.winner = "b";
    expect(ludoModule.result(t).ranks).toEqual({ b: 1, a: 2 });
  });

  it("timeouts: a move phase auto-moves a legal token, a roll phase passes the turn", () => {
    let s = two();
    s = rollDice(s, fixed([6]));
    const auto = ludoModule.onTimeout(s, "a");
    expect(auto.players[0]!.tokens.filter((t) => t === 0)).toHaveLength(1);
    const pass = ludoModule.onTimeout(two(), "a");
    expect(pass.turn).toBe(1);
  });

  it("random fair games keep every invariant, for every bot level, 2 and 4 players", () => {
    let games = 0;
    for (const players of [2, 4])
      for (let level = 1; level <= 5; level++)
        for (let g = 0; g < 6; g++) {
          const rng = createFairRng(`inv-${players}-${level}-${g}`, ["c"], `m-${g}`);
          let s = players === 2 ? two() : four();
          let guard = 0;
          while (!s.winner && guard++ < 6000) {
            if (s.phase === "roll") {
              const before = s.rolls;
              s = rollDice(s, rng);
              expect(s.rolls).toBe(before + 1);
              const ev = s.lastEvent!;
              if (ev.kind === "roll") expect(ev.dice >= 1 && ev.dice <= 6).toBe(true);
            } else {
              const tok = ludoBotMove(s, level);
              expect(ludoModule.validate(s, s.players[s.turn]!.id, { type: "move", token: tok }).ok).toBe(true);
              s = moveToken(s, tok);
            }
            checkInvariants(s);
          }
          expect(s.winner).not.toBeNull();
          games++;
        }
    expect(games).toBe(60);
  }, 60_000);

  it("stronger bots beat weaker bots over many fair games (same dice for both sides)", () => {
    const wins = (a: number, b: number) => {
      let w = 0;
      for (let g = 0; g < 120; g++) {
        const rng = createFairRng(`duel-${g}`, ["c"], `m-${g}`);
        // swap seats every other game so the first roll is not an advantage
        const first = g % 2 === 0;
        let s = initLudo([{ id: first ? "A" : "B", seat: 0 }, { id: first ? "B" : "A", seat: 2 }]);
        let guard = 0;
        while (!s.winner && guard++ < 6000) {
          const lv = s.players[s.turn]!.id === "A" ? a : b;
          s = s.phase === "roll" ? rollDice(s, rng) : moveToken(s, ludoBotMove(s, lv));
        }
        if (s.winner === "A") w++;
      }
      return w;
    };
    expect(wins(3, 1)).toBeGreaterThan(60);
    expect(wins(5, 2)).toBeGreaterThan(60);
  }, 60_000);
});
