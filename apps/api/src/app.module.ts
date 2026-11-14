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
import { SocialController } from "./modules/social/social.controller.js";
import { SocialService } from "./modules/social/social.service.js";
import { AdminGuard, AuthGuard, InternalGuard } from "./common/auth.js";
import { EconomyAdminController, EconomyPublicController } from "./modules/economy/economy.controller.js";
import { EconomyService } from "./modules/economy/economy.service.js";
import { WalletService } from "./modules/wallet/wallet.service.js";
import { AdminBlockModule } from "./modules/admin-block/admin-block.module.js";
import { ArenaModule } from "./modules/arena/arena.module.js";

/** Modular monolith root (plan §3). */
@Module({
  imports: [DbModule, LedgerModule, AdminBlockModule, ArenaModule],
  controllers: [HealthController, IdentityController, WalletController, GamesController, SocialController, EconomyPublicController, EconomyAdminController],
  providers: [IdentityService, LevelsService, GamesService, SocialService, EconomyService, WalletService, AuthGuard, InternalGuard, AdminGuard],
})
export class AppModule {}
