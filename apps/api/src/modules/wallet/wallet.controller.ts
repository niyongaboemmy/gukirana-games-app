import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, type AccessClaims } from "../../common/auth.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { userStars } from "../ledger/accounts.js";
import { EconomyService } from "../economy/economy.service.js";
import { WalletService } from "./wallet.service.js";

/** Fallback only; the live amount comes from the economy settings (EconomyService). */
export const DAILY_STARS = 200;

/**
 * Wallet: Stars (practice, no cash value — FR-CUR-05), coins (licensed pilot), honest quotes, rewards and
 * responsible-play limits. Buying / cashing out coins executes only once the payment provider is integrated.
 */
@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly economy: EconomyService,
    private readonly wallet: WalletService,
  ) {}

  @Get()
  async get(@CurrentUser() u: AccessClaims) {
    const s = await this.economy.current();
    const streak = await this.wallet.streakDays(u.sub);
    return {
      stars: await this.ledger.balance(userStars(u.sub)),
      coins: await this.wallet.coinBalance(u.sub),
      history: await this.ledger.history(userStars(u.sub)),
      dailyStars: s.dailyStars,
      ...(await this.wallet.claimStatus(u.sub)),
      streak,
      pilotEnabled: s.pilotEnabled,
      economyVersion: s.version,
      limits: await this.wallet.limits(u.sub),
      stakedToday: await this.wallet.stakedToday(u.sub),
    };
  }

  /** One free Stars grant per Kigali day (idempotent) + the streak bonus. */
  @Post("daily-stars")
  @HttpCode(200)
  daily(@CurrentUser() u: AccessClaims) {
    return this.wallet.claimDaily(u.sub);
  }

  /** Honest buy / cash-out quote: you pay, you get, spread, fee, rate version. */
  @Post("quote")
  @HttpCode(200)
  quote(@Body() b: { kind: "buy" | "cashout"; currency: string; amount: number }) {
    return this.wallet.quote(b.kind === "cashout" ? "cashout" : "buy", String(b.currency ?? "RWF"), Number(b.amount));
  }

  @Get("limits")
  limits(@CurrentUser() u: AccessClaims) {
    return this.wallet.limits(u.sub);
  }

  @Put("limits")
  setLimits(@CurrentUser() u: AccessClaims, @Body() b: { dailyStakeLimit?: number | null; reminderMinutes?: number }) {
    return this.wallet.setLimits(u.sub, b);
  }

  @Post("break")
  @HttpCode(200)
  takeBreak(@CurrentUser() u: AccessClaims, @Body() b: { hours: number }) {
    return this.wallet.takeBreak(u.sub, Number(b.hours));
  }
}
