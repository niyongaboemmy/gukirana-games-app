import { describe, expect, it } from "vitest";
import type { ArenaScopeRule } from "@gukirana/contracts";
import { canTransition, evaluateScope, isOpenSeating, overlaps, timeStatus, validateTimes, type Viewer } from "./rules.js";

const guest: Viewer = { userId: null, level: 0, roles: [], ageVerified: false, invited: false, participant: false };
const player: Viewer = { userId: "u1", level: 5, roles: [], ageVerified: false, invited: false, participant: false };
const R = (...r: ArenaScopeRule[]) => r;

describe("evaluateScope", () => {
  it("public admits everyone, guests included", () => {
    expect(evaluateScope(R({ kind: "public" }), guest)).toBeNull();
    expect(isOpenSeating(R({ kind: "public" }))).toBe(true);
    expect(isOpenSeating(R({ kind: "public" }, { kind: "members" }))).toBe(false);
  });
  it("every non-public rule needs an account", () => {
    for (const r of [
      { kind: "members" },
      { kind: "min_level", level: 1 },
      { kind: "invite" },
      { kind: "participants", guests: 0 },
      { kind: "role", roles: ["press"] },
      { kind: "age_verified" },
    ] as ArenaScopeRule[])
      expect(evaluateScope([r], guest)).toBe("LOGIN_REQUIRED");
  });
  it("each rule kind on its own", () => {
    expect(evaluateScope(R({ kind: "members" }), player)).toBeNull();
    expect(evaluateScope(R({ kind: "min_level", level: 5 }), player)).toBeNull();
    expect(evaluateScope(R({ kind: "min_level", level: 6 }), player)).toBe("LEVEL_TOO_LOW");
    expect(evaluateScope(R({ kind: "invite" }), player)).toBe("NOT_INVITED");
    expect(evaluateScope(R({ kind: "invite" }), { ...player, invited: true })).toBeNull();
    expect(evaluateScope(R({ kind: "participants", guests: 0 }), player)).toBe("NOT_PARTICIPANT");
    expect(evaluateScope(R({ kind: "participants", guests: 0 }), { ...player, participant: true })).toBeNull();
    // companions: invitees pass only when the rule allows guests
    expect(evaluateScope(R({ kind: "participants", guests: 0 }), { ...player, invited: true })).toBe("NOT_PARTICIPANT");
    expect(evaluateScope(R({ kind: "participants", guests: 2 }), { ...player, invited: true })).toBeNull();
    expect(evaluateScope(R({ kind: "role", roles: ["press", "vip"] }), player)).toBe("ROLE_REQUIRED");
    expect(evaluateScope(R({ kind: "role", roles: ["press", "vip"] }), { ...player, roles: ["vip"] })).toBeNull();
    expect(evaluateScope(R({ kind: "age_verified" }), player)).toBe("AGE_CHECK_REQUIRED");
    expect(evaluateScope(R({ kind: "age_verified" }), { ...player, ageVerified: true })).toBeNull();
  });
  it("combines with AND and reports the first failure in a fixed order", () => {
    const rules = R({ kind: "age_verified" }, { kind: "invite" }, { kind: "min_level", level: 10 });
    expect(evaluateScope(rules, player)).toBe("LEVEL_TOO_LOW");
    expect(evaluateScope(rules, { ...player, level: 10 })).toBe("NOT_INVITED");
    expect(evaluateScope(rules, { ...player, level: 10, invited: true })).toBe("AGE_CHECK_REQUIRED");
    expect(evaluateScope(rules, { ...player, level: 10, invited: true, ageVerified: true })).toBeNull();
    expect(evaluateScope(R({ kind: "public" }, { kind: "members" }), guest)).toBe("LOGIN_REQUIRED");
  });
});

describe("lifecycle", () => {
  it("validates manual transitions", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("draft", "live")).toBe(false);
    expect(canTransition("scheduled", "draft")).toBe(true);
    expect(canTransition("live", "ended")).toBe(true);
    expect(canTransition("ended", "live")).toBe(false);
    expect(canTransition("cancelled", "scheduled")).toBe(false);
    expect(canTransition("doors_open", "cancelled")).toBe(true);
  });
  const t = { doorsOpenAt: new Date(1000), startsAt: new Date(2000), endsAt: new Date(3000) };
  it("moves by time; drafts and terminal states stay", () => {
    expect(timeStatus("scheduled", t, new Date(500))).toBe("scheduled");
    expect(timeStatus("scheduled", t, new Date(1000))).toBe("doors_open");
    expect(timeStatus("scheduled", t, new Date(2500))).toBe("live");
    expect(timeStatus("doors_open", t, new Date(2000))).toBe("live");
    expect(timeStatus("live", t, new Date(3000))).toBe("ended");
    expect(timeStatus("doors_open", t, new Date(10))).toBe("doors_open"); // opened early by hand
    expect(timeStatus("draft", t, new Date(5000))).toBe("draft");
    expect(timeStatus("cancelled", t, new Date(5000))).toBe("cancelled");
  });
  it("validates times and overlap", () => {
    expect(validateTimes(t)).toBeNull();
    expect(validateTimes({ ...t, doorsOpenAt: new Date(2500) })).toBe("DOORS_AFTER_START");
    expect(validateTimes({ ...t, endsAt: new Date(2000) })).toBe("END_BEFORE_START");
    expect(validateTimes({ ...t, endsAt: new Date(1000 + 25 * 3600_000) })).toBe("EVENT_TOO_LONG");
    expect(overlaps(t, { doorsOpenAt: new Date(2999), startsAt: new Date(3100), endsAt: new Date(4000) })).toBe(true);
    expect(overlaps(t, { doorsOpenAt: new Date(3000), startsAt: new Date(3100), endsAt: new Date(4000) })).toBe(false);
  });
});
