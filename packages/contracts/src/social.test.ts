import { describe, expect, it } from "vitest";
import { isValidSeat, PLAZA_SEATS, plazaSeat } from "./social.js";

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
    expect(isValidSeat("pool", "t4s0")).toBe(false);
    expect(isValidSeat("ludo", "t5s3")).toBe(true);
    expect(isValidSeat("igisoro", "t0s2")).toBe(false);
    expect(isValidSeat("pool", 7)).toBe(false);
  });
});
