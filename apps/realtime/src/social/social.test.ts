import { describe, expect, it } from "vitest";
import { SeatRegistry } from "./seats.js";
import { BlockGraph, blockKeyFor } from "./blocks.js";
import { DmRouter } from "./dm.js";
import { CallRegistry } from "./calls.js";
import { InterestManager, type Mover } from "./interest.js";
import { RateLimiter } from "./rate.js";

describe("SeatRegistry", () => {
  it("claims plaza bench places: one person per seat, one seat per person", () => {
    const s = new SeatRegistry("plaza");
    expect(s.claim("b0s0", "A")).toBe("ok");
    expect(s.claim("b0s0", "B")).toBe("taken");
    expect(s.claim("b0s1", "B")).toBe("ok");
    // moving to another place frees the first one
    expect(s.claim("b1s2", "A")).toBe("ok");
    expect(s.snapshot()).toEqual({ b0s1: "B", b1s2: "A" });
    expect(s.claim("b0s0", "B")).toBe("ok");
    expect(s.snapshot()).toEqual({ b0s0: "B", b1s2: "A" });
  });
  it("rejects seat ids that don't exist in this place", () => {
    const plaza = new SeatRegistry("plaza");
    expect(plaza.claim("t0s0", "A")).toBe("invalid");
    expect(plaza.claim("b9s0", "A")).toBe("invalid");
    expect(plaza.claim({}, "A")).toBe("invalid");
    const pool = new SeatRegistry("pool");
    expect(pool.claim("t3s1", "A")).toBe("ok");
    expect(pool.claim("t11s1", "B")).toBe("ok"); // 12-table hall (P1-WLD-05)
    expect(pool.claim("t12s0", "C")).toBe("invalid");
    expect(pool.claim("t5s2", "C")).toBe("invalid");
    expect(pool.claim("b0s0", "B")).toBe("invalid");
  });
  it("releases on stand / leave", () => {
    const s = new SeatRegistry("ludo");
    s.claim("t5s3", "A");
    expect(s.release("A")).toBe(true);
    expect(s.release("A")).toBe(false);
    expect(s.snapshot()).toEqual({});
  });
});

describe("BlockGraph", () => {
  const a = { sid: "sa", uid: "ua" };
  const b = { sid: "sb", uid: "ub" };
  const guest = { sid: "sg" };
  it("separates both ways once either side blocks", () => {
    const g = new BlockGraph();
    expect(g.separated(a, b)).toBe(false);
    g.add(a.sid, blockKeyFor(b));
    expect(g.blocks(a, b)).toBe(true);
    expect(g.blocks(b, a)).toBe(false);
    expect(g.separated(a, b)).toBe(true);
    expect(g.separated(b, a)).toBe(true);
    g.remove(a.sid, "u:ub");
    expect(g.separated(a, b)).toBe(false);
  });
  it("blocks accounts across sessions and guests by session", () => {
    const g = new BlockGraph();
    g.set(a.sid, ["u:ub"]);
    expect(g.separated(a, { sid: "another-session", uid: "ub" })).toBe(true);
    g.add(a.sid, blockKeyFor(guest));
    expect(blockKeyFor(guest)).toBe("s:sg");
    expect(g.separated(guest, a)).toBe(true);
    g.forget(a.sid);
    expect(g.separated(a, b)).toBe(false);
  });
});

describe("DmRouter", () => {
  it("first message is a request; the sender waits until accepted", () => {
    const d = new DmRouter();
    expect(d.route("A", "B")).toBe("request");
    expect(d.route("A", "B")).toBe("wait");
    expect(d.isOpen("A", "B")).toBe(false);
  });
  it("a reply accepts the thread", () => {
    const d = new DmRouter();
    d.route("A", "B");
    expect(d.route("B", "A")).toBe("deliver");
    expect(d.route("A", "B")).toBe("deliver");
    expect(d.isOpen("B", "A")).toBe(true);
  });
  it("explicit accept only by the recipient of the request", () => {
    const d = new DmRouter();
    d.route("A", "B");
    expect(d.accept("A", "B")).toBe(false); // the requester cannot accept their own request
    expect(d.accept("B", "A")).toBe(true);
    expect(d.route("A", "B")).toBe("deliver");
  });
  it("forget closes threads (leave / block)", () => {
    const d = new DmRouter();
    d.route("A", "B");
    d.route("B", "A");
    d.route("A", "C");
    d.forget("A", "B");
    expect(d.isOpen("A", "B")).toBe(false);
    expect(d.route("A", "C")).toBe("wait");
    d.forget("A");
    expect(d.route("A", "C")).toBe("request");
  });
});

describe("CallRegistry", () => {
  it("request → accept → active; only the callee answers", () => {
    const r = new CallRegistry();
    const c = r.request("A", "B", 0);
    expect(typeof c).toBe("object");
    if (typeof c === "string") return;
    expect(r.respond(c.id, "A", true, 1)).toBeNull();
    expect(r.inCallTogether("A", "B")).toBe(false);
    expect(r.respond(c.id, "B", true, 1)?.state).toBe("active");
    expect(r.inCallTogether("A", "B")).toBe(true);
    expect(r.inCallTogether("B", "A")).toBe(true);
    expect(r.end(c.id, "C")).toBeNull();
    expect(r.end(c.id, "B")?.id).toBe(c.id);
    expect(r.callOf("A")).toBeUndefined();
  });
  it("one call per person", () => {
    const r = new CallRegistry();
    r.request("A", "B", 0);
    expect(r.request("A", "C", 0)).toBe("BUSY");
    expect(r.request("C", "B", 0)).toBe("TARGET_BUSY");
    expect(r.request("C", "C", 0)).toBe("SELF");
  });
  it("decline and ring timeout remove the call", () => {
    const r = new CallRegistry();
    const c = r.request("A", "B", 0);
    if (typeof c === "string") throw new Error(c);
    expect(r.respond(c.id, "B", false, 1)).not.toBeNull();
    expect(r.callOf("A")).toBeUndefined();
    r.request("A", "B", 0);
    expect(r.expire(10, 30)).toHaveLength(0);
    expect(r.expire(30, 30)).toHaveLength(1);
    expect(r.callOf("B")).toBeUndefined();
  });
});

describe("InterestManager", () => {
  const mover = (id: string, x: number, seq: number, anim = 1): Mover => ({ id, x, z: 0, yaw: 0, anim, seq });
  it("sends near people every tick, far people less often, only when they changed", () => {
    const im = new InterestManager();
    const viewer = mover("V", 0, 0);
    const near = mover("N", 500, 1);
    const far = mover("F", 6000, 1);
    // first tick: everybody (first pose = anim change)
    expect(im.collect(viewer, [viewer, near, far], 1, () => true).map((e) => e[0])).toEqual(["N", "F"]);
    // unchanged → nothing
    expect(im.collect(viewer, [viewer, near, far], 2, () => true)).toEqual([]);
    near.seq++;
    far.seq++;
    expect(im.collect(viewer, [viewer, near, far], 3, () => true).map((e) => e[0])).toEqual(["N"]);
    expect(im.collect(viewer, [viewer, near, far], 4, () => true).map((e) => e[0])).toEqual(["F"]);
  });
  it("animation changes skip the tier wait; invisible people are never sent", () => {
    const im = new InterestManager();
    const viewer = mover("V", 0, 0);
    const far = mover("F", 6000, 1);
    im.collect(viewer, [far], 4, () => true);
    far.seq++;
    far.anim = 13;
    expect(im.collect(viewer, [far], 5, () => true)).toHaveLength(1);
    far.seq++;
    expect(im.collect(viewer, [far], 8, () => false)).toHaveLength(0);
  });
});

describe("RateLimiter", () => {
  it("allows max per window", () => {
    const r = new RateLimiter();
    expect(r.allow("a", 2, 1000, 0)).toBe(true);
    expect(r.allow("a", 2, 1000, 10)).toBe(true);
    expect(r.allow("a", 2, 1000, 20)).toBe(false);
    expect(r.allow("a", 2, 1000, 1000)).toBe(true);
  });
});
