import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { DbModule } from "./common/db.module.js";
import { LedgerModule } from "./modules/ledger/ledger.module.js";
import { IdentityController } from "./modules/identity/identity.controller.js";
import { IdentityService } from "./modules/identity/identity.service.js";
import { LevelsService } from "./modules/levels/levels.service.js";
import { WalletController } from "./modules/wallet/wallet.controller.js";
import { GamesController } from "./modules/games/games.controller.js";
import { GamesService } from "./modules/games/games.service.js";
import { AuthGuard, InternalGuard } from "./common/auth.js";

/** Modular monolith root (plan §3). */
@Module({
  imports: [DbModule, LedgerModule],
  controllers: [HealthController, IdentityController, WalletController, GamesController],
  providers: [IdentityService, LevelsService, GamesService, AuthGuard, InternalGuard],
})
export class AppModule {}
