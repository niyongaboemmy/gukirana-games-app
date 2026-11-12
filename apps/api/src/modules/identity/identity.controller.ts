import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthGuard, CurrentUser, type AccessClaims } from "../../common/auth.js";
import { env } from "../../common/env.js";
import { parse } from "../../common/zod.js";
import { IdentityService, type Tokens } from "./identity.service.js";
import { parseLoginId } from "./phone.js";
import { LevelsService } from "../levels/levels.service.js";

const COOKIE = "gk_rt";
/** Login identifier: phone (Rwandan / E.164) or email. `phone` kept as an alias for older clients. */
const IdSchema = z
  .object({ identifier: z.string().max(254).optional(), phone: z.string().max(32).optional() })
  .transform((o, ctx) => parseLoginId(o.identifier ?? o.phone ?? "") ?? (ctx.addIssue({ code: "custom", message: "INVALID_IDENTIFIER" }), z.NEVER));
const VerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).passthrough();
const ProfileSchema = z.object({
  username: z.string().regex(/^[\p{L}\p{N}_.-]{2,16}$/u).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bodyType: z.enum(["feminine", "masculine", "neutral"]).optional(),
  look: z.string().max(300).regex(/^[\w.:;,|#=-]*$/).optional(),
});
const PracticeSchema = z.object({ game: z.enum(["pool", "ludo", "igisoro"]), won: z.boolean() });

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly levels: LevelsService,
  ) {}

  @Post("auth/otp/request")
  @HttpCode(200)
  async request(@Body() body: unknown) {
    return this.identity.requestOtp(parse(IdSchema, body));
  }

  @Post("auth/otp/verify")
  @HttpCode(200)
  async verify(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const id = parse(IdSchema, body);
    const { code } = parse(VerifySchema, body);
    const t = await this.identity.verifyOtp(id, code, req.headers["user-agent"]);
    this.setCookie(res, t);
    return { accessToken: t.accessToken, isNew: t.isNew };
  }

  @Post("auth/refresh")
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const t = await this.identity.refresh(req.cookies[COOKIE] ?? "", req.headers["user-agent"]);
    this.setCookie(res, t);
    return { accessToken: t.accessToken };
  }

  @Post("auth/logout")
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    await this.identity.logout(req.cookies[COOKIE] ?? "");
    res.clearCookie(COOKIE, { path: "/" });
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() u: AccessClaims) {
    return this.identity.me(u.sub);
  }

  @Patch("me")
  @UseGuards(AuthGuard)
  async update(@CurrentUser() u: AccessClaims, @Body() body: unknown) {
    const me = await this.identity.updateProfile(u.sub, parse(ProfileSchema, body));
    const { accessToken } = await this.identity.issue(u.sub); // fresh claims (name/look) for realtime
    return { ...me, accessToken };
  }

  @Post("me/practice-result")
  @UseGuards(AuthGuard)
  async practice(@CurrentUser() u: AccessClaims, @Body() body: unknown) {
    const { game } = parse(PracticeSchema, body);
    return { xp: await this.levels.awardPractice(u.sub, game) };
  }

  private setCookie(res: FastifyReply, t: Tokens) {
    res.setCookie(COOKIE, t.refreshToken, { httpOnly: true, sameSite: "lax", secure: env().NODE_ENV === "production", path: "/", expires: t.refreshExpires });
  }
}
