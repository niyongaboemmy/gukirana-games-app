import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  ARENA_SEATS,
  ARENA_STAFF_ROLES,
  ARENA_VIP_SEATS,
  ArenaEventKindSchema,
  ArenaEventStatusSchema,
  ArenaScopeRuleSchema,
  ArenaSettingsSchema,
  type ArenaEvent,
  type ArenaRealtimeState,
  type ArenaStatus,
  type ArenaUserAccess,
} from "@gukirana/contracts";
import { AuthGuard, CurrentUser, InternalGuard, verifyAccessToken, type AccessClaims } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { Actor, RequireRole, RoleGuard } from "../admin-block/role.guard.js";
import { ArenaService } from "./arena.service.js";
import { ArenaPresence } from "./presence.js";

const Iso = z.string().datetime({ offset: true });
const Zone = z.enum(["seats", "vip", "floor"]);
const EventFields = {
  title: z.string().trim().min(3).max(80),
  kind: ArenaEventKindSchema,
  game: z.enum(["pool", "ludo", "igisoro"]).nullable(),
  description: z.string().trim().max(400),
  doorsOpenAt: Iso,
  startsAt: Iso,
  endsAt: Iso,
  rules: z.array(ArenaScopeRuleSchema).min(1).max(7),
  capacity: z.number().int().min(1).max(ARENA_SEATS),
  vipCapacity: z.number().int().min(0).max(ARENA_VIP_SEATS),
};
const EventCreateSchema = z.object({
  ...EventFields,
  game: EventFields.game.optional(),
  description: EventFields.description.optional(),
  doorsOpenAt: Iso.optional(),
  capacity: EventFields.capacity.optional(),
  vipCapacity: EventFields.vipCapacity.optional(),
  status: z.enum(["draft", "scheduled"]).optional(),
});
const EventPatchSchema = z
  .object({ ...EventFields, status: ArenaEventStatusSchema })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "EMPTY_PATCH");
const SettingsPatchSchema = ArenaSettingsSchema.partial();
const UserRef = z.string().trim().min(1).max(254);
const InviteSchema = z.object({ user: UserRef, zone: Zone.default("seats") });
const UserSchema = z.object({ user: UserRef });
const BarSchema = z.object({ user: UserRef, reason: z.string().trim().min(3).max(200), until: Iso.optional() });
const OccupancySchema = z.object({
  room: z.string().min(1).max(64),
  concourse: z.number().int().min(0).max(10_000),
  seats: z.number().int().min(0).max(10_000),
  inside: z.array(z.string().uuid()).max(1000).default([]),
});
/** DELETE accepts the identifier in the body or as ?user= */
const userOf = (body: unknown, q?: string) => parse(UserSchema, q ? { user: q } : body).user;

/** Public arena endpoints: guests (no token) allowed on status and the events list. */
@Controller("arena")
export class ArenaController {
  constructor(private readonly arena: ArenaService) {}

  /** optional auth: no header → guest; a bad token → 401 (the client refreshes it) */
  @Get("status")
  async status(@Headers("authorization") h?: string): Promise<ArenaStatus> {
    if (!h) return this.arena.status(null);
    if (!h.startsWith("Bearer ")) throw new UnauthorizedException("INVALID_TOKEN");
    let sub: string;
    try {
      sub = (await verifyAccessToken(h.slice(7))).sub;
    } catch {
      throw new UnauthorizedException("INVALID_TOKEN");
    }
    return this.arena.status(sub);
  }

  @Get("events")
  events(@Query("upcoming") upcoming?: string): Promise<ArenaEvent[]> {
    return this.arena.listPublic(upcoming === "1" || upcoming === "true");
  }

  @Post("events/:id/pass")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  claim(@Param("id") id: string, @CurrentUser() u: AccessClaims) {
    return this.arena.claim(u.sub, id);
  }

  @Delete("events/:id/pass")
  @UseGuards(AuthGuard)
  release(@Param("id") id: string, @CurrentUser() u: AccessClaims) {
    return this.arena.release(u.sub, id);
  }
}

/** Arena back office: super_admin or event_manager account, or the x-admin-token. Every change is audited. */
@Controller("admin/arena")
@UseGuards(RoleGuard)
@RequireRole(...ARENA_STAFF_ROLES)
export class ArenaAdminController {
  constructor(private readonly arena: ArenaService) {}

  @Get("settings")
  settings() {
    return this.arena.settings();
  }
  @Put("settings")
  updateSettings(@Body() body: unknown, @Actor() who: string) {
    return this.arena.updateSettings(parse(SettingsPatchSchema, body), who);
  }

  @Get("events")
  events() {
    return this.arena.listEvents();
  }
  @Post("events")
  create(@Body() body: unknown, @Actor() who: string) {
    return this.arena.createEvent(parse(EventCreateSchema, body), who);
  }
  @Patch("events/:id")
  update(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    return this.arena.updateEvent(id, parse(EventPatchSchema, body), who);
  }
  @Delete("events/:id")
  remove(@Param("id") id: string, @Actor() who: string) {
    return this.arena.deleteEvent(id, who);
  }

  @Get("events/:id/invites")
  invites(@Param("id") id: string) {
    return this.arena.invites(id);
  }
  @Put("events/:id/invites")
  invite(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    const b = parse(InviteSchema, body);
    return this.arena.invite(id, b.user, b.zone, who);
  }
  @Delete("events/:id/invites")
  uninvite(@Param("id") id: string, @Body() body: unknown, @Actor() who: string, @Query("user") q?: string) {
    return this.arena.uninvite(id, userOf(body, q), who);
  }

  @Get("events/:id/participants")
  participants(@Param("id") id: string) {
    return this.arena.participants(id);
  }
  @Put("events/:id/participants")
  addParticipant(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    return this.arena.addParticipant(id, parse(UserSchema, body).user, who);
  }
  @Delete("events/:id/participants")
  removeParticipant(@Param("id") id: string, @Body() body: unknown, @Actor() who: string, @Query("user") q?: string) {
    return this.arena.removeParticipant(id, userOf(body, q), who);
  }

  @Get("events/:id/attendance")
  attendance(@Param("id") id: string) {
    return this.arena.attendance(id);
  }

  @Get("bars")
  bars() {
    return this.arena.bars();
  }
  @Post("bars")
  @HttpCode(200)
  bar(@Body() body: unknown, @Actor() who: string) {
    const b = parse(BarSchema, body);
    return this.arena.bar(b.user, b.reason, b.until, who);
  }
  @Delete("bars")
  unbar(@Body() body: unknown, @Actor() who: string, @Query("user") q?: string) {
    return this.arena.unbar(userOf(body, q), who);
  }

  @Get("audit")
  audit(@Query("limit") limit?: string) {
    return this.arena.auditLog(Number(limit) || 100);
  }
}

/** realtime → api (x-internal-token): state poll (~5 s), per-user access (cached ~10 s), occupancy reports. */
@Controller("internal/arena")
@UseGuards(InternalGuard)
export class ArenaInternalController {
  constructor(
    private readonly arena: ArenaService,
    private readonly presence: ArenaPresence,
  ) {}

  @Get("state")
  state(): Promise<ArenaRealtimeState> {
    return this.arena.realtimeState();
  }

  @Get("access/:userId")
  access(@Param("userId") userId: string, @Query("event") event?: string): Promise<ArenaUserAccess> {
    return this.arena.userAccess(userId, event);
  }

  @Post("occupancy")
  @HttpCode(204)
  report(@Body() body: unknown) {
    const r = parse(OccupancySchema, body);
    this.presence.report(r.room, r);
  }
}
