import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@gukirana/db";
import { DEFAULT_ECONOMY } from "@gukirana/money";
import { LedgerService } from "../ledger/ledger.service.js";
import { matchEscrow, starsBudget, userStars } from "../ledger/accounts.js";
import { EconomyService } from "./economy.service.js";

let close: () => Promise<void>;
let ledger: LedgerService;
let economy: EconomyService;

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  close = d.close;
  ledger = new LedgerService(d.db);
  economy = new EconomyService(d.db);
});
afterAll(() => close());

const u1 = "11111111-1111-1111-1111-111111111111";
const u2 = "22222222-2222-2222-2222-222222222222";
const m1 = "44444444-4444-4444-4444-444444444444";

describe("EconomyService", () => {
  it("seeds the defaults on first read", async () => {
    const s = await economy.current();
    expect(s.version).toBe(1);
    expect(s.dailyStars).toBe(DEFAULT_ECONOMY.dailyStars);
    expect((await economy.versions()).length).toBe(1);
  });

  it("publishes a new version (never edits history) and serves it", async () => {
    const { version: _v, effectiveFrom: _e, ...base } = await economy.current();
    void _v;
    void _e;
    const next = await economy.publish({ ...base, dailyStars: 250 }, "test-admin", "raise daily claim");
    expect(next.version).toBe(2);
    expect((await economy.current()).dailyStars).toBe(250);
    expect((await economy.versions()).map((v) => v.version)).toEqual([2, 1]);
  });

  it("rejects invalid and retroactive edits", async () => {
    const { version: _v, effectiveFrom: _e, ...base } = await economy.current();
    void _v;
    void _e;
    await expect(economy.publish({ ...base, tournamentPayoutBp: [5000] }, "t")).rejects.toThrow();
    await expect(economy.publish({ ...base, effectiveFrom: "2020-01-01T00:00:00Z" }, "t")).rejects.toThrow();
  });

  it("reports flows from the ledger and the books reconcile", async () => {
    const v = (await economy.current()).version;
    for (const u of [u1, u2]) {
      await ledger.post({ type: "stars_daily", idempotencyKey: `daily:${u}:t`, createdBy: "test", economyVersion: v, lines: [
        { account: starsBudget(), amount: 250, direction: "D" },
        { account: userStars(u), amount: 250, direction: "C" },
      ] });
    }
    await ledger.post({ type: "stake_lock", idempotencyKey: "lock:m1", createdBy: "test", economyVersion: v, lines: [
      { account: userStars(u1), amount: 50, direction: "D" },
      { account: userStars(u2), amount: 50, direction: "D" },
      { account: matchEscrow(m1, "STAR"), amount: 100, direction: "C" },
    ] });
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const s = await economy.summary(from, to);
    expect(s.byCurrency.STAR?.starsIssued).toBe(500);
    expect(s.byCurrency.STAR?.dailyClaims).toBe(2);
    expect(s.byCurrency.STAR?.escrowOutstanding).toBe(100);
    expect(s.byCurrency.STAR?.playerBalances).toBe(400);
    const daily = await economy.daily(from, to);
    expect(daily.some((d) => d.type === "stars_daily" && d.entries === 2)).toBe(true);
    const rec = await economy.reconciliation();
    expect(rec.ok).toBe(true);
    expect(rec.mismatchedAccounts).toBe(0);
  });
});
