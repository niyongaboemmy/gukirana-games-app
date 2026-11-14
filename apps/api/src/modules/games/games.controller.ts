import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { SignedMatchResult } from "@gukirana/signing";
import { InternalGuard } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { GamesService } from "./games.service.js";

const CreateSchema = z.object({
  game: z.enum(["ludo", "igisoro", "pool"]),
  variant: z.string().min(1).max(32),
  stake: z.number().int().min(0).max(10_000),
  players: z.array(z.object({ userId: z.string().uuid(), seat: z.number().int().min(0).max(3) })).min(2).max(4),
});
const ResultSchema = z.object({
  matchId: z.string().uuid(),
  game: z.string(),
  ranks: z.record(z.string(), z.number().int().min(1).max(4)),
  reason: z.enum(["normal", "forfeit", "timeout", "void"]),
  stateHash: z.string(),
  seedCommit: z.string().optional(),
  seedReveal: z.string().optional(),
  finishedAt: z.string(),
  signature: z.string(),
});

/** Service-to-service endpoints for the realtime game fleet (never exposed to browsers). */
@Controller("internal/matches")
@UseGuards(InternalGuard)
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.games.create(parse(CreateSchema, body));
  }

  @Post(":id/result")
  @HttpCode(200)
  result(@Param("id") id: string, @Body() body: unknown) {
    return this.games.settle(id, parse(ResultSchema, body) as SignedMatchResult);
  }

  @Post(":id/void")
  @HttpCode(200)
  void(@Param("id") id: string) {
    return this.games.void(id);
  }
}

const UUID = z.string().uuid();
const StakeQuery = z.coerce.number().int().min(0).max(10_000);

/** realtime → api: may this player be put into a match at this stake (pre-check for challenges / quick match)? */
@Controller("internal/players")
@UseGuards(InternalGuard)
export class PlayersInternalController {
  constructor(private readonly games: GamesService) {}

  @Get(":id/eligibility")
  eligibility(@Param("id") id: string, @Query("stake") stake?: string) {
    if (!UUID.safeParse(id).success) throw new BadRequestException({ code: "BAD_ID" });
    return this.games.eligibility(id, parse(StakeQuery, stake ?? 0));
  }
}
