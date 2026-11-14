import { describe, expect, it } from "vitest";
import { auditUserIds, describeAudit, type AuditNames } from "./audit-text.js";

const boss = "11111111-0000-4000-8000-000000000001";
const lv30 = "11111111-0000-4000-8000-000000000030";
const names: AuditNames = {
  users: new Map([
    [boss, "qa_super"],
    [lv30, "qa_lv30"],
  ]),
  buildings: new Map([["ludo", "Ludo Lounge"]]),
  offices: new Map([
    ["it-office", "IT Office"],
    ["accountant", "Accountant"],
  ]),
  roles: new Map([
    ["it_admin", "IT Administrator"],
    ["support_agent", "Support Agent"],
  ]),
};

describe("audit rows in plain words (GAP-016)", () => {
  it("usernames instead of ids; reasons as typed", () => {
    expect(describeAudit({ who: boss, target: `user:${lv30}`, detail: "Abusive chat after a warning" }, names)).toEqual({
      whoName: "qa_super",
      targetName: "qa_lv30",
      detailText: "Abusive chat after a warning",
    });
  });
  it("building / office / role names; key=value details in words", () => {
    expect(describeAudit({ who: "admin-token:back-office", target: "building:ludo", detail: "Back at 18:00" }, names)).toMatchObject({ whoName: "Back office", targetName: "Ludo Lounge" });
    expect(describeAudit({ who: boss, target: `user:${lv30}`, detail: "role=support_agent" }, names).detailText).toBe("Role: Support Agent");
    expect(describeAudit({ who: boss, target: "role:it_admin", detail: "office=accountant" }, names)).toMatchObject({ targetName: "IT Administrator", detailText: "Office: Accountant" });
  });
  it("JSON details read as words, ids inside resolved", () => {
    const d = describeAudit({ who: "seed", target: "role:it_admin", detail: JSON.stringify({ name: "IT Administrator", allOffices: false, offices: ["it-office", "accountant"] }) }, names);
    expect(d.whoName).toBe("System");
    expect(d.detailText).toBe("Name: IT Administrator · All offices: no · Offices: IT Office, Accountant");
    expect(d.detailText).not.toMatch(/[{}"]/);
  });
  it("unknown ids never leak raw", () => {
    const ghost = "11111111-0000-4000-8000-0000000000ff";
    const d = describeAudit({ who: ghost, target: `user:${ghost}`, detail: `user=${ghost} zone=floor` }, names);
    expect(JSON.stringify(d)).not.toContain(ghost);
    expect(d.detailText).toBe("User: an unknown account · Zone: floor");
  });
  it("collects every account id the rows mention", () => {
    expect(auditUserIds([{ who: boss, target: `user:${lv30}`, detail: null }, { who: "cli", target: "building:ludo", detail: `user=${boss}` }]).sort()).toEqual([boss, lv30].sort());
  });
});
