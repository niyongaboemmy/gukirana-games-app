import { describe, expect, it } from "vitest";
import { ACT, PAIR_DISTANCE, PAIR_INVITE_MS } from "@gukirana/contracts";
import { PairRegistry } from "./pairs.js";

const at = (x: number, z: number) => ({ x, z });

describe("PairRegistry (contact actions need consent)", () => {
  it("ask → accept → both placed face to face; contact anim allowed only for the pair", () => {
    const r = new PairRegistry();
    const inv = r.request("A", "B", "handshake", 1.6, 0);
    if (typeof inv === "string") throw new Error(inv);
    // before consent: no contact for anyone
    expect(r.allowAnim("A", ACT.handshake, 10)).toBe(0);
    // only the invited person can answer
    expect(r.respond(inv.id, "C", true, () => at(0, 0), 20)).toBeNull();
    const pos = { A: at(0, 0), B: at(1.6, 0) } as Record<string, { x: number; z: number }>;
    const res = r.respond(inv.id, "B", true, (s) => pos[s], 30);
    if (!res || !("pair" in res)) throw new Error("expected a pair");
    expect(Math.hypot(res.place.b.x - res.place.a.x, res.place.b.z - res.place.a.z)).toBeCloseTo(PAIR_DISTANCE.handshake);
    expect(r.allowAnim("A", ACT.handshake, 100)).toBe(ACT.handshake);
    expect(r.allowAnim("B", ACT.handshake, 100)).toBe(ACT.handshake);
    // a different contact code than the consented one is refused, other people too
    expect(r.allowAnim("A", ACT.hug, 100)).toBe(0);
    expect(r.allowAnim("C", ACT.handshake, 100)).toBe(0);
    // non-contact codes always pass
    expect(r.allowAnim("C", ACT.wave, 100)).toBe(ACT.wave);
    // after the action (plus grace) contact is refused again
    r.sweep(60_000);
    expect(r.allowAnim("A", ACT.handshake, 60_000)).toBe(0);
  });
  it("declines, distance, busy, expiry and leaving", () => {
    const r = new PairRegistry();
    expect(r.request("A", "A", "hug", 0, 0)).toBe("SELF");
    expect(r.request("A", "B", "hug", 3.5, 0)).toBe("FAR");
    const inv = r.request("A", "B", "hug", 1, 0);
    if (typeof inv === "string") throw new Error(inv);
    const res = r.respond(inv.id, "B", false, () => at(0, 0), 5);
    expect(res && "result" in res && res.result).toBe("DECLINED");
    // moved apart before accepting
    const inv2 = r.request("A", "B", "fistBump", 1, 0);
    if (typeof inv2 === "string") throw new Error(inv2);
    const far = r.respond(inv2.id, "B", true, (s) => (s === "A" ? at(0, 0) : at(6, 0)), 5);
    expect(far && "result" in far && far.result).toBe("FAR");
    // expiry
    const inv3 = r.request("A", "B", "fistBump", 1, 0);
    if (typeof inv3 === "string") throw new Error(inv3);
    expect(r.sweep(PAIR_INVITE_MS + 1).map((i) => i.id)).toEqual([inv3.id]);
    // busy while paired; leaving forgets
    const inv4 = r.request("A", "B", "fistBump", 1, 0);
    if (typeof inv4 === "string") throw new Error(inv4);
    r.respond(inv4.id, "B", true, () => at(0, 0), 1);
    expect(r.request("C", "A", "hug", 1, 2)).toBe("TARGET_BUSY");
    r.forget("A");
    expect(r.allowAnim("B", ACT.fistBump, 3)).toBe(0);
  });
  it("a new invitation replaces the asker's pending one", () => {
    const r = new PairRegistry();
    const a = r.request("A", "B", "handshake", 1, 0);
    const b = r.request("A", "C", "handshake", 1, 1);
    if (typeof a === "string" || typeof b === "string") throw new Error("unexpected");
    expect(r.respond(a.id, "B", true, () => at(0, 0), 2)).toBeNull();
    expect(r.respond(b.id, "C", true, () => at(0, 0), 2)).not.toBeNull();
  });
});
