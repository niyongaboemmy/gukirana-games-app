import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  BuildingIdSchema,
  DeleteAccountSchema,
  EXPORT_ROLES,
  LiftSanctionSchema,
  PresenceReportSchema,
  ReasonOnlySchema,
  ReasonSchema,
  ReportStatusQuerySchema,
  ResolveReportSchema,
  SECTION_ROLES,
  STAFF_ROLES,
  SUPER_ONLY,
  SanctionSchema,
  SetBuildingSchema,
  SetUserStatusSchema,
  StaffNoteSchema,
  UserSearchSchema,
  type UserSearch,
} from "@gukirana/contracts";
import { InternalGuard } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { uuidParam } from "../../common/ids.js";
import { AccessService } from "../admin-block/access.service.js";
import { Actor, RequireRole, RoleGuard } from "../admin-block/role.guard.js";
import { StaffLimits } from "../admin-block/staff-limits.js";
import { EconomyService } from "../economy/economy.service.js";
import { BuildingsService } from "./buildings.service.js";
import { ConsoleService, kigaliDayStart } from "./console.service.js";
import { PresenceStore } from "./presence.js";
import { ModerationService } from "./moderation.service.js";
import { ReportsService } from "./reports.service.js";

const RevealSchema = z.object({ field: z.enum(["email", "phone"]), reason: ReasonSchema });
const PageQuery = z.union([z.literal("").transform(() => 0), z.coerce.number().int().min(0).max(400)]).default(0);
/** the filters in words for the audit trail (no free text beyond the search term) */
const filterText = (f: UserSearch) =>
  Object.entries(f)
    .filter(([k, v]) => k !== "page" && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "_").slice(0, 60)}`)
    .join(" ") || "all";

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
    private readonly moderation: ModerationService,
    private readonly reports: ReportsService,
    private readonly limits: StaffLimits,
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
  users(@Query() query: unknown) {
    return this.console.listUsers(parse(UserSearchSchema, query ?? {}));
  }

  /** the filtered people list as CSV (contacts masked); audited and rate limited */
  @Get("users/export")
  @RequireRole(...EXPORT_ROLES)
  async exportUsers(@Query() query: unknown, @Actor() who: string) {
    const f = parse(UserSearchSchema, query ?? {});
    this.limits.hit(who, "export");
    const r = await this.console.exportUsers(f);
    await this.access.record(who, "users.export", "users", `rows=${r.rows} (${filterText(f)})`);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return { ...r, filename: `gukirana-people-${stamp}.csv` };
  }

  @Get("users/:id")
  @RequireRole(...SECTION_ROLES.users)
  async user(@Param("id") id: string) {
    uuidParam(id);
    const [detail, sanctions, notes, sessions, mutedUntil] = await Promise.all([
      this.console.userDetail(id),
      this.moderation.sanctionsFor(id),
      this.moderation.notesFor(id),
      this.moderation.sessionsFor(id),
      this.moderation.mutedUntil(id),
    ]);
    return { ...detail, sanctions, notes, sessions, mutedUntil };
  }

  @Post("users/:id/status")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.users)
  setStatus(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(SetUserStatusSchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.setStatus(who, id, b.status, b.reason);
  }

  /** warn / mute N hours / suspend N hours or until lifted, with a reason */
  @Post("users/:id/sanctions")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.users)
  sanction(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(SanctionSchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.sanction(who, id, b);
  }

  /** lift the mute / suspension in force */
  @Post("users/:id/lift")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.users)
  lift(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(LiftSanctionSchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.lift(who, id, b.kind, b.reason);
  }

  /** internal staff note (never shown to the player) */
  @Post("users/:id/notes")
  @RequireRole(...SECTION_ROLES.users)
  note(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(StaffNoteSchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.addNote(who, id, b.body);
  }

  /** sign out everywhere (sessions end; the account stays active) */
  @Post("users/:id/sign-out")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.users)
  signOut(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(ReasonOnlySchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.signOut(who, id, b.reason);
  }

  /** replace an offensive username with a neutral one */
  @Post("users/:id/reset-username")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.users)
  resetUsername(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(ReasonOnlySchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.resetUsername(who, id, b.reason);
  }

  /** Super Admin: show one full contact, with a reason (audited, 10 an hour) */
  @Post("users/:id/reveal")
  @HttpCode(200)
  @RequireRole(...SUPER_ONLY)
  reveal(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(RevealSchema, body);
    this.limits.hit(who, "reveal");
    return this.moderation.reveal(who, id, b.field, b.reason);
  }

  /** Super Admin: delete the account and anonymise its personal data (ledger kept whole) */
  @Post("users/:id/delete")
  @HttpCode(200)
  @RequireRole(...SUPER_ONLY)
  remove(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(DeleteAccountSchema, body);
    this.limits.hit(who, "mutate");
    return this.moderation.deleteAccount(who, id, b.confirm, b.reason);
  }

  /** player reports queue */
  @Get("reports")
  @RequireRole(...SECTION_ROLES.reports)
  listReports(@Query("status") status?: string, @Query("page") page?: string, @Query("user") user?: string) {
    return this.reports.list(parse(ReportStatusQuerySchema, status || undefined), parse(PageQuery, page ?? ""), user ? uuidParam(user) : undefined);
  }

  @Post("reports/:id/resolve")
  @HttpCode(200)
  @RequireRole(...SECTION_ROLES.reports)
  resolveReport(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    uuidParam(id);
    const b = parse(ResolveReportSchema, body);
    this.limits.hit(who, "mutate");
    return this.reports.resolve(who, id, b.outcome, b.note);
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
    this.limits.hit(who, "mutate");
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
    return this.console.auditFeed(Math.max(1, Math.min(300, Number(limit) || 100)), q?.slice(0, 80));
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

/** realtime → api (x-internal-token): account events since `since` (ISO): connections closed, mutes applied live */
@Controller("internal")
@UseGuards(InternalGuard)
export class SuspensionsInternalController {
  constructor(private readonly moderation: ModerationService) {}

  /** suspensions, sign-outs, deletions, mutes and warnings since `since` (+ every mute in force on the first poll) */
  @Get("suspensions")
  suspensions(@Query("since") since?: string) {
    const t = since ? Date.parse(since) : NaN;
    return this.moderation.feed(Number.isFinite(t) ? new Date(t) : null);
  }
}
