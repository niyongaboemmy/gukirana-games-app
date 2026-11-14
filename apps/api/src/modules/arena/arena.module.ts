import { Module } from "@nestjs/common";
import { AuthGuard, InternalGuard } from "../../common/auth.js";
import { AdminBlockModule } from "../admin-block/admin-block.module.js";
import { RoleGuard } from "../admin-block/role.guard.js";
import { ArenaAdminController, ArenaController, ArenaInternalController } from "./arena.controller.js";
import { ArenaService } from "./arena.service.js";
import { ArenaPresence } from "./presence.js";

/** Tournament Arena: building switch, events, scopes, passes, invites, participants, bars (P2-ARN-02). */
@Module({
  imports: [AdminBlockModule],
  controllers: [ArenaController, ArenaAdminController, ArenaInternalController],
  providers: [ArenaService, ArenaPresence, RoleGuard, AuthGuard, InternalGuard],
})
export class ArenaModule {}
