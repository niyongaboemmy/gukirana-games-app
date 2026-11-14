import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { OfficeIdSchema, ReceptionRequestSchema, RoleIdSchema, type MyRoles, type OfficeSummary, type ReceptionReply } from "@gukirana/contracts";
import { AuthGuard, CurrentUser, InternalGuard, type AccessClaims } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { AccessService } from "./access.service.js";
import { OccupancyStore } from "./occupancy.js";
import { ReceptionService } from "./reception.service.js";
import { Actor, RoleGuard } from "./role.guard.js";

const Name = z.string().trim().min(1).max(60);
const Desc = z.string().trim().max(300);
const RoleCreateSchema = z.object({
  id: RoleIdSchema,
  name: Name,
  description: Desc.optional(),
  allOffices: z.boolean().optional(),
  offices: z.array(OfficeIdSchema).max(50).optional(),
});
const RolePatchSchema = z.object({
  name: Name.optional(),
  description: Desc.optional(),
  allOffices: z.boolean().optional(),
});
const OfficeCreateSchema = z.object({
  id: OfficeIdSchema,
  name: Name,
  description: Desc.optional(),
  sort: z.number().int().min(0).max(100_000).optional(),
});
const OfficePatchSchema = z.object({
  name: Name.optional(),
  description: Desc.optional(),
  sort: z.number().int().min(0).max(100_000).optional(),
});
/** user: id, username, email or phone */
const GrantSchema = z.object({ user: z.string().trim().min(1).max(254), role: RoleIdSchema });
const OccupancySchema = z.object({
  room: z.string().min(1).max(64),
  offices: z.record(OfficeIdSchema, z.number().int().min(0).max(1000)),
  /** visitors let in per office (P2-ADM-04, optional) */
  visitors: z.record(OfficeIdSchema, z.number().int().min(0).max(1000)).optional(),
});

/** Path params: validated with the contract slug schemas. */
const slug = (schema: { safeParse(v: unknown): { success: boolean } }, v: string): string => {
  if (!schema.safeParse(v).success)
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      issues: [{ path: "id", message: "INVALID_ID" }],
    });
  return v;
};

/** Signed-in players: own roles + the reception directory. */
@Controller()
@UseGuards(AuthGuard)
export class AdminBlockController {
  constructor(
    private readonly access: AccessService,
    private readonly occupancy: OccupancyStore,
    private readonly reception_: ReceptionService,
  ) {}

  @Get("me/roles")
  myRoles(@CurrentUser() u: AccessClaims): Promise<MyRoles> {
    return this.access.access(u.sub);
  }

  @Get("admin-block/offices")
  offices(@CurrentUser() u: AccessClaims): Promise<OfficeSummary[]> {
    return this.access.officesFor(u.sub, this.occupancy.totals());
  }

  /** the reception assistant (P2-ADM-04): availability, knock rules, directions — nothing else, nothing stored */
  @Post("admin-block/reception")
  @HttpCode(200)
  reception(@CurrentUser() u: AccessClaims, @Body() body: unknown): Promise<ReceptionReply> {
    return this.reception_.answer(u.sub, parse(ReceptionRequestSchema, body));
  }
}

/** Staff management (super_admin account, or the back-office x-admin-token). Every change is audited. */
@Controller("admin/access")
@UseGuards(RoleGuard)
export class AccessAdminController {
  constructor(private readonly access: AccessService) {}

  @Get("roles")
  roles() {
    return this.access.listRoles();
  }
  @Post("roles")
  createRole(@Body() body: unknown, @Actor() who: string) {
    return this.access.createRole(parse(RoleCreateSchema, body), who);
  }
  @Patch("roles/:id")
  updateRole(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    return this.access.updateRole(slug(RoleIdSchema, id), parse(RolePatchSchema, body), who);
  }
  @Delete("roles/:id")
  deleteRole(@Param("id") id: string, @Actor() who: string) {
    return this.access.deleteRole(slug(RoleIdSchema, id), who);
  }
  @Put("roles/:id/offices/:office")
  assign(@Param("id") id: string, @Param("office") office: string, @Actor() who: string) {
    return this.access.assign(slug(RoleIdSchema, id), slug(OfficeIdSchema, office), who);
  }
  @Delete("roles/:id/offices/:office")
  unassign(@Param("id") id: string, @Param("office") office: string, @Actor() who: string) {
    return this.access.unassign(slug(RoleIdSchema, id), slug(OfficeIdSchema, office), who);
  }

  @Get("offices")
  offices() {
    return this.access.listOffices();
  }
  @Post("offices")
  createOffice(@Body() body: unknown, @Actor() who: string) {
    return this.access.createOffice(parse(OfficeCreateSchema, body), who);
  }
  @Patch("offices/:id")
  updateOffice(@Param("id") id: string, @Body() body: unknown, @Actor() who: string) {
    return this.access.updateOffice(slug(OfficeIdSchema, id), parse(OfficePatchSchema, body), who);
  }
  @Delete("offices/:id")
  deleteOffice(@Param("id") id: string, @Actor() who: string) {
    return this.access.deleteOffice(slug(OfficeIdSchema, id), who);
  }

  @Get("users")
  users(@Query("q") q?: string) {
    return this.access.listUsers(q);
  }
  @Post("grant")
  @HttpCode(200)
  grant(@Body() body: unknown, @Actor() who: string) {
    const g = parse(GrantSchema, body);
    return this.access.grant(g.user, g.role, who);
  }
  @Post("revoke")
  @HttpCode(200)
  revoke(@Body() body: unknown, @Actor() who: string) {
    const g = parse(GrantSchema, body);
    return this.access.revoke(g.user, g.role, who);
  }

  @Get("audit")
  audit(@Query("limit") limit?: string) {
    return this.access.auditLog(Number(limit) || 100);
  }
}

/** realtime → api (x-internal-token): roles for office doors (cached ~15 s there), occupancy reports. */
@Controller("internal")
@UseGuards(InternalGuard)
export class AccessInternalController {
  constructor(
    private readonly access: AccessService,
    private readonly occupancy: OccupancyStore,
  ) {}

  @Get("access/:userId")
  async userAccess(@Param("userId") userId: string): Promise<MyRoles & { known: string[] }> {
    return { ...(await this.access.access(userId)), known: await this.access.officeIds() };
  }

  @Post("admin-block/occupancy")
  @HttpCode(204)
  report(@Body() body: unknown) {
    const r = parse(OccupancySchema, body);
    this.occupancy.report(r.room, r.offices, Date.now(), r.visitors ?? {});
  }
}
