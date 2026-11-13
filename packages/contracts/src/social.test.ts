import { describe, expect, it } from "vitest";
import { ACT, EmoteSendSchema, isContactAction, isKnownAnim, isValidSeat, PAIR_DISTANCE, PAIR_KINDS, pairPlacement, PairRequestSchema, PairRespondSchema, PLAZA_SEATS, plazaSeat } from "./social.js";

describe("people actions", () => {
  it("accepts player emotes, refuses locomotion, sitting and contact codes", () => {
    expect(EmoteSendSchema.safeParse({ emote: ACT.wave }).success).toBe(true);
    expect(EmoteSendSchema.safeParse({ emote: ACT.photo, to: "abc" }).success).toBe(true);
    for (const bad of [0, 1, 2, ACT.sit, ACT.handshake, ACT.fistBump, ACT.hug, 99, 1.5]) expect(EmoteSendSchema.safeParse({ emote: bad }).success).toBe(false);
    expect(isKnownAnim(ACT.hug)).toBe(true);
    expect(isKnownAnim(77)).toBe(false);
    expect(isContactAction(ACT.handshake)).toBe(true);
    expect(isContactAction(ACT.wave)).toBe(false);
  });
  it("validates pair requests", () => {
    expect(PairRequestSchema.safeParse({ to: "s1", kind: "handshake" }).success).toBe(true);
    expect(PairRequestSchema.safeParse({ to: "s1", kind: "kiss" }).success).toBe(false);
    expect(PairRespondSchema.safeParse({ id: "p1", accept: true }).success).toBe(true);
  });
  it("places two people face to face at the action's distance", () => {
    for (const kind of PAIR_KINDS) {
      const p = pairPlacement(kind, { x: 1, z: 2 }, { x: 3, z: 2.5 });
      expect(Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z)).toBeCloseTo(PAIR_DISTANCE[kind], 5);
      // A looks at B, B looks at A
      expect(Math.sin(p.a.yaw) * (p.b.x - p.a.x) + Math.cos(p.a.yaw) * (p.b.z - p.a.z)).toBeCloseTo(PAIR_DISTANCE[kind], 5);
      expect(Math.sin(p.b.yaw) * (p.a.x - p.b.x) + Math.cos(p.b.yaw) * (p.a.z - p.b.z)).toBeCloseTo(PAIR_DISTANCE[kind], 5);
      expect((p.a.x + p.b.x) / 2).toBeCloseTo(2, 5);
    }
  });
});

describe("seats", () => {
  it("offers three bench places per plaza bench, facing the fountain", () => {
    expect(PLAZA_SEATS).toHaveLength(18);
    for (const s of PLAZA_SEATS) {
      // forward vector points (roughly) at the fountain at the origin
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      const toCentre = Math.hypot(s.x, s.z);
      expect((-s.x * fx - s.z * fz) / toCentre).toBeGreaterThan(0.95);
    }
    expect(plazaSeat("b0s1")).toBeDefined();
  });
  it("validates seat ids per place", () => {
    expect(isValidSeat("plaza", "b5s2")).toBe(true);
    expect(isValidSeat("plaza", "b6s0")).toBe(false);
    expect(isValidSeat("plaza", "t0s0")).toBe(false);
    expect(isValidSeat("pool", "t3s1")).toBe(true);
    expect(isValidSeat("pool", "t11s1")).toBe(true);
    expect(isValidSeat("pool", "t11s2")).toBe(false);
    expect(isValidSeat("pool", "t12s0")).toBe(false);
    expect(isValidSeat("ludo", "t5s3")).toBe(true);
    expect(isValidSeat("igisoro", "t0s2")).toBe(false);
    expect(isValidSeat("pool", 7)).toBe(false);
  });
});
