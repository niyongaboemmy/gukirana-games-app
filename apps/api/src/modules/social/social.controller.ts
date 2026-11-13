import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ReportReasonSchema } from "@gukirana/contracts";
import { AuthGuard, CurrentUser, type AccessClaims } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { SocialService } from "./social.service.js";

const Id = z.string().uuid();
const ReportSchema = z.object({
  targetId: z.string().uuid(),
  reason: ReportReasonSchema,
  details: z.string().max(500).optional(),
  context: z
    .object({
      place: z.string().max(32).optional(),
      chat: z.array(z.object({ name: z.string().max(32), text: z.string().max(400), t: z.number().int() })).max(30).optional(),
    })
    .optional(),
});

/** Public player profile, personal block list, reports (SRS §8.4 safety; DESIGN-SPEC §12.3). */
@Controller()
@UseGuards(AuthGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get("players/:id")
  profile(@Param("id") id: string) {
    return this.social.publicProfile(parse(Id, id));
  }

  @Get("me/blocks")
  async blocks(@CurrentUser() u: AccessClaims) {
    return { blocks: await this.social.blocks(u.sub) };
  }

  @Put("me/blocks/:id")
  @HttpCode(204)
  async block(@CurrentUser() u: AccessClaims, @Param("id") id: string) {
    await this.social.block(u.sub, parse(Id, id));
  }

  @Delete("me/blocks/:id")
  @HttpCode(204)
  async unblock(@CurrentUser() u: AccessClaims, @Param("id") id: string) {
    await this.social.unblock(u.sub, parse(Id, id));
  }

  @Post("reports")
  @HttpCode(201)
  report(@CurrentUser() u: AccessClaims, @Body() body: unknown) {
    return this.social.report(u.sub, parse(ReportSchema, body));
  }
}
