import { Body, Controller, Get, Header, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { EconomySettings } from "@gukirana/money";
import { AdminGuard } from "../../common/auth.js";
import { EconomyService } from "./economy.service.js";

const range = (from?: string, to?: string) => {
  const t = to ? new Date(to) : new Date();
  const f = from ? new Date(from) : new Date(t.getTime() - 30 * 86_400_000);
  return { from: f, to: t };
};

/** Public: what the client needs to show prices honestly (rates are display estimates; Stars have no cash value). */
@Controller("economy")
export class EconomyPublicController {
  constructor(private readonly economy: EconomyService) {}

  @Get()
  async current() {
    const s = await this.economy.current();
    return {
      version: s.version,
      dailyStars: s.dailyStars,
      levelUpStars: s.levelUpStars,
      streakStars: s.streakStars,
      pilotEnabled: s.pilotEnabled,
      feeBands: s.feeBands,
      currencies: s.currencies.filter((c) => c.enabled).map((c) => ({ code: c.code, exponent: c.exponent, minorPerCoinMicro: c.minorPerCoinMicro })),
    };
  }
}

/** Back office (apps/admin, header x-admin-token): settings versions + ledger reports. */
@Controller("admin")
@UseGuards(AdminGuard)
export class EconomyAdminController {
  constructor(private readonly economy: EconomyService) {}

  @Get("economy")
  current() {
    return this.economy.current();
  }

  @Get("economy/versions")
  versions() {
    return this.economy.versions();
  }

  /** Publish a new version (validated, never retroactive). Body: full settings minus version; optional effectiveFrom, note. */
  @Post("economy")
  publish(@Body() body: Omit<EconomySettings, "version" | "effectiveFrom"> & { effectiveFrom?: string; note?: string }, @Req() req: { headers: Record<string, unknown> }) {
    const { note, ...settings } = body;
    const by = String(req.headers["x-admin-user"] ?? "admin").slice(0, 64);
    return this.economy.publish(settings, by, note);
  }

  @Get("reports/summary")
  summary(@Query("from") from?: string, @Query("to") to?: string) {
    const r = range(from, to);
    return this.economy.summary(r.from, r.to);
  }

  @Get("reports/daily")
  daily(@Query("from") from?: string, @Query("to") to?: string) {
    const r = range(from, to);
    return this.economy.daily(r.from, r.to);
  }

  @Get("reports/daily.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="gukirana-daily-report.csv"')
  async dailyCsv(@Query("from") from?: string, @Query("to") to?: string) {
    const r = range(from, to);
    const rows = await this.economy.daily(r.from, r.to);
    return ["day,currency,type,entries,revenue,volume", ...rows.map((x) => [x.day, x.currency, x.type, x.entries, x.revenue, x.volume].join(","))].join("\n");
  }

  @Get("reports/reconciliation")
  reconciliation() {
    return this.economy.reconciliation();
  }
}
