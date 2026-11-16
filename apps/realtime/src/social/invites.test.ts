import { describe, expect, it } from "vitest";
import { InviteBook } from "./invites.js";

const p = (uid: string) => ({ uid, name: uid.toUpperCase() });
const book = () => new InviteBook({ ttlMs: 45_000, perMinute: 6, open: 3 });
const send = (b: InviteBook, from: string, to: string, now = 0) => b.send({ from: p(from), to: p(to), game: "ludo", stake: 25 }, now);

describe("challenges between accounts (P2-MM-05)", () => {
  it("send → the invitee answers (only the invitee, only in time)", () => {
    const b = book();
    const r = send(b, "a", "b");
    expect(r.ok).toBe(true);
    const id = r.ok ? r.invite.id : "";
    expect(b.incoming("b").map((i) => i.id)).toEqual([id]);
    expect(b.respond(id, "a", 1)).toBeNull();
    expect(b.respond(id, "b", 46_000)).toBeNull();
    expect(b.respond(id, "b", 1)?.id).toBe(id);
    expect(b.get(id)).toBeUndefined();
  });

  it("duplicates, crossed challenges, yourself", () => {
    const b = book();
    send(b, "a", "b");
    expect(send(b, "a", "b")).toEqual({ ok: false, reason: "DUPLICATE" });
    expect(send(b, "b", "a")).toMatchObject({ ok: false, reason: "CROSSED", invite: { from: { uid: "a" } } });
    expect(send(b, "a", "a")).toEqual({ ok: false, reason: "SELF" });
  });

  it("anti-spam: at most 3 open and 6 a minute", () => {
    const b = book();
    for (const to of ["b", "c", "d"]) expect(send(b, "a", to).ok).toBe(true);
    expect(send(b, "a", "e")).toEqual({ ok: false, reason: "TOO_MANY_OPEN" });
    for (const i of b.outgoing("a")) b.cancel(i.id, "a");
    for (const to of ["e", "f", "g"]) expect(send(b, "a", to, 10).ok).toBe(true);
    for (const i of b.outgoing("a")) b.cancel(i.id, "a");
    expect(send(b, "a", "h", 20)).toEqual({ ok: false, reason: "RATE_LIMITED" });
    expect(send(b, "a", "h", 61_000).ok).toBe(true);
  });

  it("expiry and the account going away close them", () => {
    const b = book();
    send(b, "a", "b", 0);
    send(b, "c", "a", 0);
    send(b, "d", "e", 30_000);
    expect(b.sweep(44_000)).toEqual([]);
    expect(b.sweep(46_000).map((i) => i.from.uid).sort()).toEqual(["a", "c"]);
    send(b, "a", "b", 50_000);
    expect(b.forget("b").map((i) => i.from.uid)).toEqual(["a"]);
    expect(b.forgetPair("d", "e")).toHaveLength(1);
    expect(b.incoming("e")).toEqual([]);
  });

  it("only the sender cancels", () => {
    const b = book();
    const r = send(b, "a", "b");
    const id = r.ok ? r.invite.id : "";
    expect(b.cancel(id, "b")).toBeNull();
    expect(b.cancel(id, "a")?.id).toBe(id);
  });
});
