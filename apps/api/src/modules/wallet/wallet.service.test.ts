import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@gukirana/db";
import { LedgerService } from "../ledger/ledger.service.js";
import { userStars } from "../ledger/accounts.js";
import { EconomyService } from "../economy/economy.service.js";
import { WalletService } from "./wallet.service.js";

let close: () => Promise<void>;
let ledger: LedgerService;
let wallet: WalletService;

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  close = d.close;
  ledger = new LedgerService(d.db);
  wallet = new WalletService(d.db, ledger, new EconomyService(d.db));
});
afterAll(() => close());

const u = "55555555-5555-5555-5555-555555555555";

describe("WalletService", () => {
  it("daily claim is idempotent; the first day has no streak bonus", async () => {
    expect((await wallet.claimStatus(u)).claimedToday).toBe(false);
    const a = await wallet.claimDaily(u);
    expect(a.granted).toBe(200);
    expect(a.streak).toBe(1);
    expect(a.streakBonus).toBe(0);
    expect(a.nextStreakBonus).toBe(20);
    const b = await wallet.claimDaily(u);
    expect(b.granted).toBe(0);
    expect(await ledger.balance(userStars(u))).toBe(200);
    const st = await wallet.claimStatus(u);
    expect(st.claimedToday).toBe(true);
    const wait = new Date(st.nextClaimAt).getTime() - Date.now();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(86_400_000);
    expect(new Date(st.nextClaimAt).getUTCHours()).toBe(22); // Kigali midnight
  });

  it("level-up gifts once per level", async () => {
    expect(await wallet.grantLevelUps(u, 1, 3)).toBe(200); // levels 2 and 3 × 100
    expect(await wallet.grantLevelUps(u, 1, 3)).toBe(0); // replay
  });

  it("quotes buying and cashing out honestly", async () => {
    const b = await wallet.quote("buy", "USD", 1000);
    expect(b.coins).toBe(1379);
    expect(b.spreadMinor).toBeGreaterThanOrEqual(0);
    await expect(wallet.quote("buy", "XYZ", 1000)).rejects.toThrow();
  });

  it("limits: lowering is immediate, raising waits 24 h; breaks block stakes", async () => {
    let l = await wallet.setLimits(u, { dailyStakeLimit: 100 });
    expect(l.dailyStakeLimit).toBe(100);
    l = await wallet.setLimits(u, { dailyStakeLimit: 500 });
    expect(l.dailyStakeLimit).toBe(100);
    expect(l.pendingStakeLimit).toBe(500);
    await expect(wallet.assertCanStake(u, 150)).rejects.toThrow();
    await expect(wallet.assertCanStake(u, 50)).resolves.toBeUndefined();
    await wallet.takeBreak(u, 24);
    await expect(wallet.assertCanStake(u, 10)).rejects.toThrow();
  });
});
