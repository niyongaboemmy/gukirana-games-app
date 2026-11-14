import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  BuildingIdSchema,
  PresenceReportSchema,
  SECTION_ROLES,
  STAFF_ROLES,
  SetBuildingSchema,
  SetUserStatusSchema,
} from "@gukirana/contracts";
import { InternalGuard } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { uuidParam } from "../../common/ids.js";
import { AccessService } from "../admin-block/access.service.js";
import { Actor, RequireRole, RoleGuard } from "../admin-block/role.guard.js";
import { EconomyService } from "../economy/economy.service.js";
import { BuildingsService } from "./buildings.service.js";
import { ConsoleService, kigaliDayStart } from "./console.service.js";
import { PresenceStore } from "./presence.js";

/**
 * Staff admin console (P2-CON-01). Player access token + a staff role (checked in the DB on every request), or the
 * back-office x-admin-token. Section access follows SECTION_ROLES in @gukirana/contracts. Changes are audited.
 */
@Controller("console")
@UseGuards(RoleGuard)
export class ConsoleController {
  constructor(
    private readonly console: ConsoleService,
    private readonly buildings: BuildingsService,
    private readonly presence: PresenceStore,
    private readonly access: AccessService,
    private readonly economy: EconomyService,
  ) {}

  @Get("me")
  @RequireRole(...STAFF_ROLES)
  me(@Actor() who: string) {
    return this.console.me(who);
  }

  @Get("overview")
  @RequireRole(...STAFF_ROLES)
  overview(@Actor() who: string) {
    return this.console.overview(who);
  }

  @Get("users")
  @RequireRole(...SECTION_ROLES.users)
  users(@Query("q") q?: string, @Query("status") status?: string, @Query("page") page?: string) {
    return this.console.listUsers(q, status, Number(page) || 0);
  }

  @Get("users/:id")
  @RequireRole(...SECTION_ROLES.users)
  user(@Param("id") id: string) {
    return this.console.userDetail(uuidParam(id));
  }

  @Post("users/:id/status")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.users)
  setStatus(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(SetUserStatusSchema, body);
    return this.console.setStatus(who, id, b.status, b.reason);
  }

  @Get("buildings")
  @RequireRole(...STAFF_ROLES)
  listBuildings() {
    return this.buildings.list();
  }

  @Put("buildings/:id")
  @RequireRole(...SECTION_ROLES.buildings)
  async setBuilding(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    const bid = parse(BuildingIdSchema, id);
    const b = parse(SetBuildingSchema, body);
    const r = await this.buildings.set(bid, b.open, b.message, who);
    await this.access.record(who, b.open ? "building.open" : "building.close", `building:${bid}`, b.open ? null : b.message || null);
    return r;
  }

  @Get("presence")
  @RequireRole(...SECTION_ROLES.monitor)
  livePresence() {
    return this.presence.totals();
  }

  @Get("audit")
  @RequireRole(...SECTION_ROLES.monitor)
  audit(@Query("limit") limit?: string, @Query("q") q?: string) {
    return this.console.auditFeed(Math.min(300, Number(limit) || 100), q);
  }

  @Get("finance")
  @RequireRole(...SECTION_ROLES.finance)
  async finance(@Query("days") days?: string) {
    const n = Math.max(1, Math.min(31, Number(days) || 7));
    const to = new Date(Date.now() + 60_000);
    const from = new Date(kigaliDayStart().getTime() - (n - 1) * 86_400_000);
    const [summary, daily, reconciliation] = await Promise.all([this.economy.summary(from, to), this.economy.daily(from, to), this.economy.reconciliation()]);
    return { days: n, summary, daily, reconciliation };
  }
}

/** public: which plaza buildings are open (doors stay shut for a closed one) */
@Controller("buildings")
export class BuildingsPublicController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  async list() {
    return (await this.buildings.list()).map((b) => ({ id: b.id, name: b.name, open: b.open, message: b.message }));
  }
}

/** realtime → api (x-internal-token): people per world room, for the console's live monitor */
@Controller("internal")
@UseGuards(InternalGuard)
export class PresenceInternalController {
  constructor(private readonly presence: PresenceStore) {}

  @Post("presence")
  @HttpCode(204)
  report(@Body() body: unknown) {
    const r = parse(PresenceReportSchema, body);
    this.presence.report(r.room, r.area, r.count, r.signedIn);
  }
}

/** realtime → api (x-internal-token): accounts suspended since `since` (ISO), so their connections are closed */
@Controller("internal")
@UseGuards(InternalGuard)
export class SuspensionsInternalController {
  constructor(private readonly console: ConsoleService) {}

  @Get("suspensions")
  suspensions(@Query("since") since?: string) {
    const t = since ? Date.parse(since) : NaN;
    return this.console.suspensionsSince(Number.isFinite(t) ? new Date(t) : null);
  }
}
