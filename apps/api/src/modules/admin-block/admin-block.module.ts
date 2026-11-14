import { Module } from "@nestjs/common";
import { AuthGuard, InternalGuard } from "../../common/auth.js";
import {
  AccessAdminController,
  AccessInternalController,
  AdminBlockController,
} from "./admin-block.controller.js";
import { AccessService } from "./access.service.js";
import { OccupancyStore } from "./occupancy.js";
import { ReceptionService } from "./reception.service.js";
import { RoleGuard } from "./role.guard.js";

/** Administrative Block: roles, offices, role → office assignments, user grants, audit (P2-ADM-03). */
@Module({
  controllers: [AdminBlockController, AccessAdminController, AccessInternalController],
  providers: [AccessService, OccupancyStore, ReceptionService, RoleGuard, AuthGuard, InternalGuard],
  exports: [AccessService, OccupancyStore, RoleGuard],
})
export class AdminBlockModule {}
