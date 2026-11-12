import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createDatabase } from "@gukirana/db";
import { LedgerService } from "./ledger.service.js";
import { matchEscrow, starsBudget, userStars } from "./accounts.js";

let close: () => Promise<void>;
let ledger: LedgerService;

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  close = d.close;
  ledger = new LedgerService(d.db);
});
afterAll(() => close());

const users = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"];

describe("LedgerService", () => {
  it("grants, is idempotent, and keeps the books balanced", async () => {
    const grant = { type: "stars_grant", idempotencyKey: "welcome:u1", createdBy: "test", lines: [
      { account: starsBudget(), amount: 500, direction: "D" as const },
      { account: userStars(users[0]!), amount: 500, direction: "C" as const },
    ] };
    const a = await ledger.post(grant);
    const b = await ledger.post(grant);
    expect(b.replayed).toBe(true);
    expect(b.entryId).toBe(a.entryId);
    expect(await ledger.balance(userStars(users[0]!))).toBe(500);
    expect(await ledger.totalOfAllBalances()).toBe(0);
  });

  it("rejects unbalanced entries and overdrafts", async () => {
    await expect(ledger.post({ type: "x", idempotencyKey: "bad1", createdBy: "t", lines: [
      { account: starsBudget(), amount: 5, direction: "D" },
      { account: userStars(users[1]!), amount: 4, direction: "C" },
    ] })).rejects.toThrow(/UNBALANCED/);
    await expect(ledger.post({ type: "stake_lock", idempotencyKey: "bad2", createdBy: "t", lines: [
      { account: userStars(users[1]!), amount: 10, direction: "D" },
      { account: matchEscrow("44444444-4444-4444-4444-444444444444", "STAR"), amount: 10, direction: "C" },
    ] })).rejects.toThrow();
    expect(await ledger.balance(userStars(users[1]!))).toBe(0);
  });

  it("property: random grants/stakes/settlements never break invariants", async () => {
    for (const u of users) await ledger.post({ type: "stars_grant", idempotencyKey: `seed:${u}`, createdBy: "t", lines: [
      { account: starsBudget(), amount: 1000, direction: "D" },
      { account: userStars(u), amount: 1000, direction: "C" },
    ] });
    let n = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 400 }), fc.boolean(), async (i, j, stake, aWins) => {
        if (i === j) return;
        const match = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
        const esc = matchEscrow(match, "STAR");
        try {
          await ledger.post({ type: "stake_lock", idempotencyKey: `lock:${match}`, createdBy: "t", lines: [
            { account: userStars(users[i]!), amount: stake, direction: "D" },
            { account: userStars(users[j]!), amount: stake, direction: "D" },
            { account: esc, amount: stake * 2, direction: "C" },
          ] });
        } catch {
          return; // insufficient funds is a valid outcome
        }
        await ledger.post({ type: "settle", idempotencyKey: `settle:${match}`, createdBy: "t", lines: [
          { account: esc, amount: stake * 2, direction: "D" },
          { account: userStars(users[aWins ? i : j]!), amount: stake * 2, direction: "C" },
        ] });
        expect(await ledger.balance(esc)).toBe(0);
        for (const u of users) expect(await ledger.balance(userStars(u))).toBeGreaterThanOrEqual(0);
        expect(await ledger.totalOfAllBalances()).toBe(0);
      }),
      { numRuns: 60 },
    );
  }, 60_000);
});
