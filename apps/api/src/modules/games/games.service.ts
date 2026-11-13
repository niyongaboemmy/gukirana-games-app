import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, gte, inArray, matches, matchPlayers, ratings, sql, users, xpEvents } from "@gukirana/db";
import { keyFromSeed, verifyResult, type SignedMatchResult } from "@gukirana/signing";
import { DB, type Db } from "../../common/db.module.js";
import { env } from "../../common/env.js";
import { kigaliDay, newId } from "../../common/ids.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { EconomyService } from "../economy/economy.service.js";
import { WalletService } from "../wallet/wallet.service.js";
import { matchEscrow, userStars } from "../ledger/accounts.js";
import { LevelsService } from "../levels/levels.service.js";
import { eloUpdate, xpForMatch } from "../levels/xp.js";

export interface CreateMatchInput {
  game: "ludo" | "igisoro" | "pool";
  variant: string;
  stake: number;
  players: { userId: string; seat: number }[];
}

/**
 * Match money flow (SRS §6.5, plan Appendix A.4/A.5) — Stars only until the licensed Coins pilot.
 * Pot = Σ stakes, paid in full to the winner (FR-ESC-03). Settlement only from a signed result.
 */
@Injectable()
export class GamesService {
  private readonly publicKey = keyFromSeed(env().RESULT_SIGNING_SEED).publicKey;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly levels: LevelsService,
    private readonly economy: EconomyService,
    private readonly wallet: WalletService,
  ) {}

  async create(
    input: CreateMatchInput,
  ): Promise<{
    matchId: string;
    players: { userId: string; seat: number; rating: number; name: string; color: string }[];
  }> {
    const ids = input.players.map((p) => p.userId);
    // responsible play: a player on a break, or over their own daily stake limit, can't be staked into a match
    if (input.stake > 0) for (const id of ids) await this.wallet.assertCanStake(id, input.stake);
    if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: "DUPLICATE_PLAYER" });
    const found = await this.db.select().from(users).where(inArray(users.id, ids));
    if (found.length !== ids.length) throw new NotFoundException({ code: "UNKNOWN_PLAYER" });

    const matchId = newId();
    await this.db
      .insert(matches)
      .values({
        id: matchId,
        game: input.game,
        variant: input.variant,
        currency: "STAR",
        stake: input.stake,
        status: "active",
      });
    const r = await this.db
      .select()
      .from(ratings)
      .where(and(inArray(ratings.userId, ids), eq(ratings.game, input.game)));
    const ratingOf = (u: string) => r.find((x) => x.userId === u)?.rating ?? 1500;
    await this.db
      .insert(matchPlayers)
      .values(
        input.players.map((p) => ({
          matchId,
          userId: p.userId,
          seat: p.seat,
          ratingBefore: ratingOf(p.userId),
        })),
      );

    if (input.stake > 0) {
      try {
        await this.ledger.post({
          economyVersion: (await this.economy.current()).version,
          type: "stake_lock",
          idempotencyKey: `lock:${matchId}`,
          ref: { type: "match", id: matchId },
          createdBy: "games",
          lines: [
            ...input.players.map((p) => ({
              account: userStars(p.userId),
              amount: input.stake,
              direction: "D" as const,
            })),
            {
              account: matchEscrow(matchId, "STAR"),
              amount: input.stake * input.players.length,
              direction: "C" as const,
            },
          ],
        });
      } catch (e) {
        await this.db
          .update(matches)
          .set({ status: "void", endedAt: new Date() })
          .where(eq(matches.id, matchId));
        throw e;
      }
    }
    return {
      matchId,
      players: input.players.map((p) => {
        const u = found.find((x) => x.id === p.userId)!;
        return {
          userId: p.userId,
          seat: p.seat,
          rating: ratingOf(p.userId),
          name: u.username ?? "Player",
          color: u.color,
        };
      }),
    };
  }

  async settle(matchId: string, result: SignedMatchResult) {
    if (result.matchId !== matchId) throw new BadRequestException({ code: "MATCH_MISMATCH" });
    if (!verifyResult(result, this.publicKey))
      throw new UnauthorizedException({ code: "BAD_RESULT_SIGNATURE" });
    const [m] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new NotFoundException();
    if (m.status === "settled") return { status: "settled", replayed: true };
    if (m.status !== "active") throw new ConflictException({ code: "MATCH_NOT_ACTIVE" });
    const players = await this.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId));
    if (players.some((p) => !(p.userId in result.ranks)))
      throw new BadRequestException({ code: "RANKS_INCOMPLETE" });
    if (result.reason === "void") return this.void(matchId);

    const pot = m.stake * players.length;
    if (pot > 0) {
      const best = Math.min(...players.map((p) => result.ranks[p.userId]!));
      const winners = players.filter((p) => result.ranks[p.userId] === best);
      const share = Math.floor(pot / winners.length);
      const remainder = pot - share * winners.length; // draws: split evenly, remainder to the first seat
      await this.ledger.post({
        economyVersion: (await this.economy.current()).version,
        type: "settle",
        idempotencyKey: `settle:${matchId}`,
        ref: { type: "match", id: matchId },
        createdBy: "games",
        lines: [
          { account: matchEscrow(matchId, "STAR"), amount: pot, direction: "D" },
          ...winners.map((w, i) => ({
            account: userStars(w.userId),
            amount: share + (i === 0 ? remainder : 0),
            direction: "C" as const,
          })),
        ],
      });
    }

    // ratings
    const before = players.map((p) => ({
      id: p.userId,
      rating: p.ratingBefore ?? 1500,
      rank: result.ranks[p.userId]!,
    }));
    const after = eloUpdate(before);
    const xpOut: Record<string, number> = {};
    for (const p of players) {
      const rank = result.ranks[p.userId]!;
      const won = rank === 1 && players.filter((q) => result.ranks[q.userId] === 1).length === 1;
      const draw = players.every((q) => result.ranks[q.userId] === rank);
      await this.db
        .insert(ratings)
        .values({ userId: p.userId, game: m.game, rating: after[p.userId]!, games: 1, wins: won ? 1 : 0 })
        .onConflictDoUpdate({
          target: [ratings.userId, ratings.game],
          set: {
            rating: after[p.userId]!,
            games: sql`${ratings.games} + 1`,
            wins: sql`${ratings.wins} + ${won ? 1 : 0}`,
          },
        });
      await this.db
        .update(matchPlayers)
        .set({ rank, ratingAfter: after[p.userId]! })
        .where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.userId, p.userId)));

      const winsToday = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(xpEvents)
        .where(
          and(eq(xpEvents.userId, p.userId), eq(xpEvents.day, kigaliDay()), eq(xpEvents.reason, "match_win")),
        );
      const opp = players.find((q) => q.userId !== p.userId)!;
      const vsOpp = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(
          and(
            eq(matchPlayers.userId, opp.userId),
            gte(matches.createdAt, new Date(Date.now() - 24 * 3600_000)),
          ),
        );
      const xp = xpForMatch(
        {
          outcome: result.reason === "forfeit" && !won ? "forfeit" : won ? "win" : draw ? "draw" : "loss",
          beatHigherRated: won && (opp.ratingBefore ?? 1500) > (p.ratingBefore ?? 1500),
          firstWinToday: won && Number(winsToday[0]?.n ?? 0) === 0,
          sameOpponentCountToday: Math.max(0, Number(vsOpp[0]?.n ?? 0) - 1),
        },
        await this.levels.todayXp(p.userId),
      );
      xpOut[p.userId] = await this.levels.award(p.userId, xp, won ? "match_win" : "match", matchId);
    }
    await this.db
      .update(matches)
      .set({ status: "settled", result, endedAt: new Date() })
      .where(eq(matches.id, matchId));
    return { status: "settled", pot, ratings: after, xp: xpOut };
  }

  async void(matchId: string) {
    const [m] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new NotFoundException();
    if (m.status !== "active") return { status: m.status, replayed: true };
    const players = await this.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId));
    if (m.stake > 0) {
      await this.ledger.post({
        economyVersion: (await this.economy.current()).version,
        type: "refund",
        idempotencyKey: `void:${matchId}`,
        ref: { type: "match", id: matchId },
        createdBy: "games",
        lines: [
          { account: matchEscrow(matchId, "STAR"), amount: m.stake * players.length, direction: "D" },
          ...players.map((p) => ({ account: userStars(p.userId), amount: m.stake, direction: "C" as const })),
        ],
      });
    }
    await this.db.update(matches).set({ status: "void", endedAt: new Date() }).where(eq(matches.id, matchId));
    return { status: "void" };
  }
}
