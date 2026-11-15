import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { SignedMatchResult } from "@gukirana/signing";
import { GameIdSchema, MatchHeartbeatSchema, VoidMatchSchema } from "@gukirana/contracts";
import { AuthGuard, CurrentUser, InternalGuard, type AccessClaims } from "../../common/auth.js";
import { parse } from "../../common/zod.js";
import { uuidParam } from "../../common/ids.js";
import { GamesService } from "./games.service.js";
import { FightRatingService } from "./fight-rating.service.js";

/** P3-FGT-10 rating UI / leaderboard flag: on unless FF_FIGHT_RATING=0 (dev default on; production sets it) */
const ratingOn = () => process.env.FF_FIGHT_RATING !== "0";
const FightGame = z.enum(["boxing"]).default("boxing");

const CreateSchema = z.object({
  game: GameIdSchema,
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
  /** P3-FGT-10: per-player integer skill lines (boxing), signed by the game server */
  stats: z.record(z.string(), z.record(z.string(), z.number().int())).optional(),
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

  /** the matches a game server is running (every ~20 s); answers with the ones it should end (no longer active) */
  @Post("heartbeat")
  @HttpCode(200)
  heartbeat(@Body() body: unknown) {
    return this.games.heartbeat(parse(MatchHeartbeatSchema, body).matchIds);
  }

  @Post(":id/result")
  @HttpCode(200)
  result(@Param("id") id: string, @Body() body: unknown) {
    return this.games.settle(uuidParam(id), parse(ResultSchema, body) as SignedMatchResult);
  }

  @Post(":id/void")
  @HttpCode(200)
  void(@Param("id") id: string, @Body() body: unknown) {
    return this.games.void(uuidParam(id), parse(VoidMatchSchema, body ?? {}).cause ?? null);
  }
}

const StakeQuery = z.coerce.number().int().min(0).max(10_000);
const GameQuery = z.union([z.literal("").transform(() => undefined), GameIdSchema]).optional();

/** realtime → api: may this player be put into a match at this stake (pre-check for challenges / quick match)? */
@Controller("internal/players")
@UseGuards(InternalGuard)
export class PlayersInternalController {
  constructor(private readonly games: GamesService) {}

  @Get(":id/eligibility")
  eligibility(@Param("id") id: string, @Query("stake") stake?: string, @Query("game") game?: string) {
    return this.games.eligibility(uuidParam(id), parse(StakeQuery, stake ?? 0), parse(GameQuery, game));
  }
}

/** player: what can I start right now (stakes I can afford, friendly games left today), per game */
@Controller("games")
@UseGuards(AuthGuard)
export class GamesPublicController {
  constructor(private readonly games: GamesService) {}

  @Get("offer")
  offer(@CurrentUser() u: AccessClaims) {
    return this.games.offer(u.sub);
  }
}

/** realtime → api: a player's boxing rating for matchmaking (null = never rated) */
@Controller("internal/fight")
@UseGuards(InternalGuard)
export class FightInternalController {
  constructor(private readonly ratings: FightRatingService) {}

  @Get("rating/:id")
  rating(@Param("id") id: string) {
    return this.ratings.glicko(uuidParam(id));
  }
}

/** player: my fight rating (+ my average skill line) and the leaderboard of real players (P3-FGT-10) */
@Controller("fight")
@UseGuards(AuthGuard)
export class FightPublicController {
  constructor(private readonly ratings: FightRatingService) {}

  @Get("rating/me")
  mine(@CurrentUser() u: AccessClaims, @Query("game") game?: string) {
    if (!ratingOn()) throw new NotFoundException();
    return this.ratings.mine(u.sub, parse(FightGame, game));
  }

  @Get("leaderboard")
  leaderboard(@CurrentUser() u: AccessClaims, @Query("game") game?: string, @Query("limit") limit?: string) {
    if (!ratingOn()) throw new NotFoundException();
    return this.ratings.leaderboard(u.sub, parse(FightGame, game), parse(z.coerce.number().int().min(1).max(100).default(50), limit));
  }
}
