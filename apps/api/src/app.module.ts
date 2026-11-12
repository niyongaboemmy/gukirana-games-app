import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";

/**
 * Modular monolith root (plan §3). Feature modules (identity, ledger, wallet, payments,
 * matchmaking, challenges, games, ...) are added per task in docs/IMPLEMENTATION-PLAN.md.
 */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
