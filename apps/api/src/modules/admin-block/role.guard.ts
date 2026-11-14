import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import { verifyAccessToken } from "../../common/auth.js";
import { env } from "../../common/env.js";
import { AccessService, SUPER_ADMIN } from "./access.service.js";

const ROLES_KEY = "gk:roles";
/** Roles allowed through RoleGuard (any of them). Default: super_admin. */
export const RequireRole = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

interface Req {
  headers: Record<string, string | string[] | undefined>;
  actor?: string;
}

const tokenOk = (given: unknown, expected: string) => {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Staff management access: either the back-office service token (`x-admin-token`, apps/admin; actor from
 * `x-admin-user`) or a player access token whose account holds the required role — checked against the DB on every
 * request, so a revoke takes effect at once.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly access: AccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (req.headers["x-admin-token"] !== undefined) {
      if (!tokenOk(req.headers["x-admin-token"], env().ADMIN_SERVICE_TOKEN))
        throw new UnauthorizedException();
      req.actor = `admin-token:${String(req.headers["x-admin-user"] ?? "back-office").slice(0, 64)}`;
      return true;
    }
    const h = req.headers.authorization;
    const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) throw new UnauthorizedException("MISSING_TOKEN");
    let sub: string;
    let iat: number | undefined;
    try {
      ({ sub, iat } = await verifyAccessToken(token));
    } catch {
      throw new UnauthorizedException("INVALID_TOKEN");
    }
    // a token from before a staff "sign out everywhere" carries no staff powers either (P2-CON-02)
    if ((await this.access.tokenRefusal(sub, iat)) === "SESSION_REVOKED") throw new UnauthorizedException({ code: "SESSION_REVOKED" });
    const need = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) ?? [SUPER_ADMIN];
    const mine = (await this.access.access(sub)).roles;
    if (!need.some((r) => mine.includes(r)))
      throw new ForbiddenException({ code: "ROLE_REQUIRED", roles: need });
    req.actor = sub;
    return true;
  }
}

/** Who is making the management call (user id or `admin-token:<name>`), set by RoleGuard; used in the audit log. */
export const Actor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<Req>().actor ?? "unknown",
);
