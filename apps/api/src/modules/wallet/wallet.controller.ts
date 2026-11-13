import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, type AccessClaims } from "../../common/auth.js";
import { kigaliDay } from "../../common/ids.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { starsBudget, userStars } from "../ledger/accounts.js";
import { EconomyService } from "../economy/economy.service.js";

/** Fallback only; the live amount comes from the economy settings (EconomyService). */
export const DAILY_STARS = 200;

/** Stars wallet (practice currency, no cash value — FR-CUR-05). Coins arrive in P1b. */
@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly economy: EconomyService,
  ) {}

  @Get()
  async wallet(@CurrentUser() u: AccessClaims) {
    const s = await this.economy.current();
    return {
      stars: await this.ledger.balance(userStars(u.sub)),
      history: await this.ledger.history(userStars(u.sub)),
      dailyStars: s.dailyStars,
      pilotEnabled: s.pilotEnabled,
      economyVersion: s.version,
    };
  }

  /** One free Stars grant per Kigali day (idempotent by day). */
  @Post("daily-stars")
  @HttpCode(200)
  async daily(@CurrentUser() u: AccessClaims) {
    const s = await this.economy.current();
    const amount = s.dailyStars;
    const r = await this.ledger.post({
      type: "stars_daily",
      idempotencyKey: `daily:${u.sub}:${kigaliDay()}`,
      ref: { type: "user", id: u.sub },
      createdBy: "wallet",
      economyVersion: s.version,
      lines: [
        { account: starsBudget(), amount, direction: "D" },
        { account: userStars(u.sub), amount, direction: "C" },
      ],
    });
    return { granted: r.replayed ? 0 : amount, stars: await this.ledger.balance(userStars(u.sub)) };
  }
}
