import { describe, expect, it } from "vitest";
import { MatchFinder, type Ticket } from "./match-finder.js";

const t = (uid: string, stakes: number[], since: number, game: Ticket["game"] = "ludo"): Ticket => ({ uid, name: uid, game, stakes, since });

describe("find-an-opponent queue (P2-MM-05)", () => {
  it("pairs two people looking for the same game at the same stake, wherever they are", () => {
    const f = new MatchFinder(20_000);
    f.join(t("a", [0], 1));
    expect(f.pairAll(1)).toEqual([]);
    f.join(t("b", [0], 2));
    const [o] = f.pairAll(2);
    expect(o).toMatchObject({ game: "ludo", stake: 0, a: { uid: "a" }, b: { uid: "b" }, expires: 20_002 });
    expect(f.ticketOf("a")).toBeUndefined();
    expect(f.offerOf("b")?.id).toBe(o!.id);
  });

  it("different games or no shared stake never pair (the v1 root cause: 25 vs Friendly waited for ever)", () => {
    const f = new MatchFinder(20_000);
    f.join(t("a", [25], 1));
    f.join(t("b", [0], 2));
    f.join(t("c", [25], 3, "igisoro"));
    expect(f.pairAll(3)).toEqual([]);
    expect(f.counts("ludo")).toEqual({ "25": 1, "0": 1 });
    // a widened search (asked first in the UI) shares Friendly with b
    f.widen("a", [25, 0]);
    const [o] = f.pairAll(4);
    expect(o).toMatchObject({ stake: 0, a: { uid: "a" }, b: { uid: "b" } });
  });

  it("the longest waiter goes first, and their preferred stake wins", () => {
    const f = new MatchFinder(20_000);
    f.join(t("old", [50, 25], 1));
    f.join(t("mid", [25], 5));
    f.join(t("new", [25, 50], 9));
    const [o] = f.pairAll(9);
    expect(o).toMatchObject({ a: { uid: "old" }, b: { uid: "mid" }, stake: 25 });
    expect(f.ticketOf("new")).toBeDefined();
  });

  it("never pairs an account with itself, nor two people who blocked each other", () => {
    const f = new MatchFinder(20_000, (a, b) => [a, b].sort().join() === "a,b");
    f.join(t("a", [0], 1));
    f.join(t("a", [0], 2)); // a second tab replaces the ticket
    expect(f.tickets()).toHaveLength(1);
    f.join(t("b", [0], 3));
    expect(f.pairAll(3)).toEqual([]);
    f.join(t("c", [0], 4));
    expect(f.pairAll(4)[0]).toMatchObject({ a: { uid: "a" }, b: { uid: "c" } });
  });

  it("both accept → accepted; one accept is pending", () => {
    const f = new MatchFinder(20_000);
    f.join(t("a", [0], 1));
    f.join(t("b", [0], 2));
    const [o] = f.pairAll(2);
    expect(f.respond(o!.id, "a", true, 3)?.kind).toBe("pending");
    expect(f.respond(o!.id, "x", true, 3)).toBeNull();
    expect(f.respond(o!.id, "b", true, 4)?.kind).toBe("accepted");
    expect(f.offerOf("a")).toBeUndefined();
    expect(f.active("a")).toBe(false);
  });

  it("a decline sends the other one back to the front of the queue with their waiting time", () => {
    const f = new MatchFinder(20_000);
    f.join(t("a", [0], 1));
    f.join(t("b", [0], 2));
    const [o] = f.pairAll(2);
    const r = f.respond(o!.id, "b", false, 3);
    expect(r).toMatchObject({ kind: "declined", by: "b", requeued: ["a"] });
    expect(f.ticketOf("a")?.since).toBe(1);
    expect(f.ticketOf("b")).toBeUndefined();
    f.join(t("c", [0], 10));
    expect(f.pairAll(10)[0]).toMatchObject({ a: { uid: "a" }, b: { uid: "c" } });
  });

  it("expiry: whoever accepted is requeued, whoever never answered is dropped", () => {
    const f = new MatchFinder(1000);
    f.join(t("a", [0], 1));
    f.join(t("b", [0], 2));
    const [o] = f.pairAll(2);
    f.respond(o!.id, "a", true, 100);
    expect(f.sweep(500)).toEqual([]);
    const [x] = f.sweep(1003);
    expect(x).toMatchObject({ requeued: ["a"], dropped: ["b"] });
    expect(f.ticketOf("a")).toBeDefined();
    expect(f.ticketOf("b")).toBeUndefined();
    expect(f.respond(o!.id, "b", true, 1004)).toBeNull();
  });

  it("cancel during an offer counts as a decline", () => {
    const f = new MatchFinder(20_000);
    f.join(t("a", [0], 1));
    f.join(t("b", [0], 2));
    f.pairAll(2);
    expect(f.leave("a", 3)).toMatchObject({ kind: "declined", requeued: ["b"] });
    expect(f.leave("zzz", 3)).toBeNull();
  });
});
