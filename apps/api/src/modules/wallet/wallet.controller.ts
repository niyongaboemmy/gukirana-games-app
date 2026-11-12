import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, type AccessClaims } from "../../common/auth.js";
import { kigaliDay } from "../../common/ids.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { starsBudget, userStars } from "../ledger/accounts.js";

export const DAILY_STARS = 200;

/** Stars wallet (practice currency, no cash value — FR-CUR-05). Coins arrive in P1b. */
@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  async wallet(@CurrentUser() u: AccessClaims) {
    return { stars: await this.ledger.balance(userStars(u.sub)), history: await this.ledger.history(userStars(u.sub)) };
  }

  /** One free Stars grant per Kigali day (idempotent by day). */
  @Post("daily-stars")
  @HttpCode(200)
  async daily(@CurrentUser() u: AccessClaims) {
    const r = await this.ledger.post({
      type: "stars_daily",
      idempotencyKey: `daily:${u.sub}:${kigaliDay()}`,
      ref: { type: "user", id: u.sub },
      createdBy: "wallet",
      lines: [
        { account: starsBudget(), amount: DAILY_STARS, direction: "D" },
        { account: userStars(u.sub), amount: DAILY_STARS, direction: "C" },
      ],
    });
    return { granted: r.replayed ? 0 : DAILY_STARS, stars: await this.ledger.balance(userStars(u.sub)) };
  }
}
