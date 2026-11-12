import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

export interface AccessClaims {
  sub: string;
  name: string;
  color: string;
  lvl: number;
  look?: string;
  bt?: string;
}

const key = () => new TextEncoder().encode(env().JWT_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("gukirana-api")
    .setAudience("gukirana")
    .setExpirationTime("15m")
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(), { issuer: "gukirana-api", audience: "gukirana" });
  return payload as unknown as AccessClaims;
}

interface Req {
  headers: Record<string, string | string[] | undefined>;
  user?: AccessClaims;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const h = req.headers.authorization;
    const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) throw new UnauthorizedException("MISSING_TOKEN");
    try {
      req.user = await verifyAccessToken(token);
      return true;
    } catch {
      throw new UnauthorizedException("INVALID_TOKEN");
    }
  }
}

/** Service-to-service calls (realtime → api). */
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Req>();
    const given = Buffer.from(String(req.headers["x-internal-token"] ?? ""));
    const expected = Buffer.from(env().INTERNAL_SERVICE_TOKEN);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException();
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessClaims => {
  return ctx.switchToHttp().getRequest<Req>().user!;
});
