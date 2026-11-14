import { describe, expect, it } from "vitest";
import { ADMIN_SEAT_IDS, answerAction, isAdminSeat, OfficeAnswerSchema, parseAdminSeat, ReceptionRequestSchema } from "./offices.js";
import { isValidSeat } from "./social.js";

describe("Administrative Block seats (P2-ADM-04)", () => {
  it("parses lobby, officer, visitor and meeting seats", () => {
    expect(parseAdminSeat("lobby-0")).toEqual({ kind: "lobby", n: 0 });
    expect(parseAdminSeat("lobby-10")).toEqual({ kind: "lobby", n: 10 });
    expect(parseAdminSeat("it-office-officer")).toEqual({ kind: "officer", office: "it-office" });
    expect(parseAdminSeat("customer-support-visitor-2")).toEqual({ kind: "visitor", office: "customer-support", n: 2 });
    expect(parseAdminSeat("super-admin-meeting-3")).toEqual({ kind: "meeting", office: "super-admin", n: 3 });
  });
  it("refuses unknown offices, out-of-range numbers and malformed ids", () => {
    for (const bad of ["lobby-11", "lobby-01", "lobby-", "it-office-visitor-3", "it-office-meeting-4", "it-office-officer-1", "it-office-visitor", "vault-officer", "t0s0", "", 7, null, "x".repeat(60)])
      expect(isAdminSeat(bad)).toBe(false);
  });
  it("lists every seat once, all valid in the admin hall and nowhere else", () => {
    expect(new Set(ADMIN_SEAT_IDS).size).toBe(ADMIN_SEAT_IDS.length);
    expect(ADMIN_SEAT_IDS.length).toBe(11 + 4 * (1 + 3 + 4));
    for (const id of ADMIN_SEAT_IDS) {
      expect(isValidSeat("admin", id)).toBe(true);
      expect(isValidSeat("pool", id)).toBe(false);
    }
    expect(isValidSeat("admin", "t0s0")).toBe(false);
  });
});

describe("knock answers", () => {
  it("accepts the old boolean form and the new action form", () => {
    expect(OfficeAnswerSchema.safeParse({ knockId: "k1", allow: true }).success).toBe(true);
    expect(OfficeAnswerSchema.safeParse({ knockId: "k1", action: "wait" }).success).toBe(true);
    expect(OfficeAnswerSchema.safeParse({ knockId: "k1" }).success).toBe(false);
    expect(OfficeAnswerSchema.safeParse({ knockId: "k1", action: "maybe" }).success).toBe(false);
    expect(answerAction({ allow: true })).toBe("allow");
    expect(answerAction({ allow: false })).toBe("decline");
    expect(answerAction({ allow: true, action: "wait" })).toBe("wait");
  });
  it("bounds reception requests", () => {
    expect(ReceptionRequestSchema.parse({ message: " hi " })).toEqual({ message: "hi", history: [] });
    expect(ReceptionRequestSchema.safeParse({ message: "x".repeat(301) }).success).toBe(false);
    expect(ReceptionRequestSchema.safeParse({ message: "hi", history: Array.from({ length: 9 }, () => ({ role: "visitor", text: "a" })) }).success).toBe(false);
  });
});
