import { describe, expect, it } from "vitest";
import { isGame, isStake, QuickMatchQueue } from "./matchmaking.js";

const ticket = (userId: string) => ({ userId, since: Date.now(), notify: () => undefined });

describe("quick match queue", () => {
  it("pairs two people on the same game and stake", () => {
    const q = new QuickMatchQueue();
    expect(q.join("pool", 25, ticket("a"))).toBeNull();
    expect(q.join("pool", 50, ticket("b"))).toBeNull(); // different stake: no pair
    expect(q.join("pool", 25, ticket("c"))?.userId).toBe("a");
    expect(q.size("pool", 25)).toBe(0);
  });

  it("never pairs a person with themselves and keeps one ticket per person", () => {
    const q = new QuickMatchQueue();
    q.join("ludo", 0, ticket("a"));
    expect(q.join("ludo", 0, ticket("a"))).toBeNull();
    expect(q.size("ludo", 0)).toBe(1);
    // switching game replaces the old ticket, so "a" cannot be matched twice
    q.join("igisoro", 0, ticket("a"));
    expect(q.size("ludo", 0)).toBe(0);
    expect(q.join("ludo", 0, ticket("b"))).toBeNull();
    expect(q.join("igisoro", 0, ticket("c"))?.userId).toBe("a");
  });

  it("leave removes every ticket", () => {
    const q = new QuickMatchQueue();
    q.join("pool", 0, ticket("a"));
    q.leave("a");
    expect(q.join("pool", 0, ticket("b"))).toBeNull();
  });

  it("validates games and stakes", () => {
    expect(isGame("pool") && isGame("ludo") && isGame("igisoro")).toBe(true);
    expect(isGame("chess")).toBe(false);
    expect(isStake(25) && isStake(0)).toBe(true);
    expect(isStake(30) || isStake("25")).toBe(false);
  });
});
