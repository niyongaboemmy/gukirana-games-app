import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, fightRatingEvents, fightRatings, inArray, sql, users } from "@gukirana/db";
import { decayForIdle, GLICKO_DEFAULT, rateFight, type Glicko } from "@gukirana/boxing";
import {
  FightStatLineSchema,
  fightTierOf,
  isProvisional,
  type FightLeaderboard,
  type FightRating,
  type FightRatingChange,
  type FightStatLine,
} from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";

/** the fight games that are skill-rated (P3-FGT-10) */
export const RATED_FIGHT_GAMES = new Set(["boxing"]);
/** a leaderboard row needs this many rated fights (and every row is a real account: only settled live fights rate) */
export const LEADERBOARD_MIN_GAMES = 3;
const DAY_MS = 86_400_000;
/** the average skill line keys (FightStatLine fields averaged over the player's rated fights) */
const AVG_KEYS = ["accuracy", "defencePct", "counters", "controlS", "perMin", "diff", "landed", "gassedS"] as const;

type Row = typeof fightRatings.$inferSelect;
const glickoOf = (r: Row | undefined, now: number): Glicko =>
  r ? decayForIdle({ rating: r.rating, rd: r.rd, vol: r.vol }, r.lastAt ? (now - r.lastAt.getTime()) / DAY_MS : 0) : GLICKO_DEFAULT;

/**
 * Glicko-2 fight ratings (docs/FIGHT-GAME-V2.md §7). `apply` is called by GamesService.settle exactly once per settled,
 * non-void live match (the `flip` guard) and is idempotent on its own as well: one event row per (match, player).
 * Practice never reaches the API; a void never calls it; ratings are computed from both PRE-fight values.
 */
@Injectable()
export class FightRatingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async apply(
    matchId: string,
    game: string,
    players: { userId: string }[],
    ranks: Record<string, number>,
    stats?: Record<string, Record<string, number>>,
  ): Promise<Record<string, FightRatingChange> | null> {
    if (!RATED_FIGHT_GAMES.has(game) || players.length !== 2) return null;
    const [pa, pb] = players as [{ userId: string }, { userId: string }];
    const ids = [pa.userId, pb.userId];
    // already rated (a replayed settlement): answer with what was stored
    const done = await this.db.select().from(fightRatingEvents).where(eq(fightRatingEvents.matchId, matchId));
    if (done.length) return this.changesOf(done, game);
    const now = Date.now();
    const rows = await this.db.select().from(fightRatings).where(and(inArray(fightRatings.userId, ids), eq(fightRatings.game, game)));
    const rowOf = (u: string) => rows.find((r) => r.userId === u);
    const before = ids.map((u) => glickoOf(rowOf(u), now)) as [Glicko, Glicko];
    const ra = ranks[pa.userId]!;
    const rb = ranks[pb.userId]!;
    const scoreA = ra === rb ? 0.5 : ra < rb ? 1 : 0;
    const after = rateFight(before[0], before[1], scoreA);
    const changes: Record<string, FightRatingChange> = {};
    await this.db.transaction(async (tx) => {
      for (const k of [0, 1] as const) {
        const u = ids[k]!;
        const score = k === 0 ? scoreA : 1 - scoreA;
        const line = stats?.[u] ? FightStatLineSchema.safeParse(stats[u]) : null;
        const inserted = await tx
          .insert(fightRatingEvents)
          .values({
            matchId,
            userId: u,
            game,
            opponentId: ids[1 - k]!,
            score,
            ratingBefore: before[k].rating,
            ratingAfter: after[k].rating,
            rdBefore: before[k].rd,
            rdAfter: after[k].rd,
            stats: line?.success ? line.data : null,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length) continue;
        const old = rowOf(u);
        const games = (old?.games ?? 0) + 1;
        const win = score === 1 ? 1 : 0;
        const loss = score === 0 ? 1 : 0;
        const draw = score === 0.5 ? 1 : 0;
        await tx
          .insert(fightRatings)
          .values({ userId: u, game, rating: after[k].rating, rd: after[k].rd, vol: after[k].vol, games: 1, wins: win, losses: loss, draws: draw, peak: Math.max(1500, after[k].rating), lastAt: new Date(now) })
          .onConflictDoUpdate({
            target: [fightRatings.userId, fightRatings.game],
            set: {
              rating: after[k].rating,
              rd: after[k].rd,
              vol: after[k].vol,
              games: sql`${fightRatings.games} + 1`,
              wins: sql`${fightRatings.wins} + ${win}`,
              losses: sql`${fightRatings.losses} + ${loss}`,
              draws: sql`${fightRatings.draws} + ${draw}`,
              peak: sql`greatest(${fightRatings.peak}, ${after[k].rating})`,
              lastAt: new Date(now),
            },
          });
        changes[u] = {
          before: Math.round(before[k].rating),
          after: Math.round(after[k].rating),
          rdBefore: Math.round(before[k].rd),
          rdAfter: Math.round(after[k].rd),
          tierBefore: fightTierOf(before[k].rating),
          tierAfter: fightTierOf(after[k].rating),
          provisional: isProvisional(games, after[k].rd),
          games,
        };
      }
    });
    return changes;
  }

  private async changesOf(done: (typeof fightRatingEvents.$inferSelect)[], game: string): Promise<Record<string, FightRatingChange>> {
    const rows = await this.db.select().from(fightRatings).where(and(inArray(fightRatings.userId, done.map((d) => d.userId)), eq(fightRatings.game, game)));
    return Object.fromEntries(
      done.map((d) => {
        const games = rows.find((r) => r.userId === d.userId)?.games ?? 1;
        return [
          d.userId,
          {
            before: Math.round(d.ratingBefore),
            after: Math.round(d.ratingAfter),
            rdBefore: Math.round(d.rdBefore),
            rdAfter: Math.round(d.rdAfter),
            tierBefore: fightTierOf(d.ratingBefore),
            tierAfter: fightTierOf(d.ratingAfter),
            provisional: isProvisional(games, d.rdAfter),
            games,
          },
        ];
      }),
    );
  }

  private view(r: Row, name: string | undefined, now: number): FightRating {
    const g = glickoOf(r, now);
    return {
      userId: r.userId,
      ...(name ? { name } : {}),
      rating: Math.round(g.rating),
      rd: Math.round(g.rd),
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      tier: fightTierOf(g.rating),
      provisional: isProvisional(r.games, g.rd),
      skill: Math.round(g.rating - 2 * g.rd),
    };
  }

  /** for matchmaking (internal): null = never rated */
  async glicko(userId: string, game = "boxing"): Promise<{ rating: number; rd: number } | null> {
    const [r] = await this.db.select().from(fightRatings).where(and(eq(fightRatings.userId, userId), eq(fightRatings.game, game)));
    if (!r) return null;
    const g = glickoOf(r, Date.now());
    return { rating: Math.round(g.rating), rd: Math.round(g.rd) };
  }

  /** my rating + my average skill line (the "own average" of the skill report); an unrated player gets the start */
  async mine(userId: string, game = "boxing"): Promise<FightRating> {
    const now = Date.now();
    const [r] = await this.db.select().from(fightRatings).where(and(eq(fightRatings.userId, userId), eq(fightRatings.game, game)));
    const base: FightRating = r
      ? this.view(r, undefined, now)
      : { userId, rating: 1500, rd: 350, games: 0, wins: 0, losses: 0, draws: 0, tier: fightTierOf(1500), provisional: true, skill: 1500 - 700 };
    const ev = await this.db
      .select({ stats: fightRatingEvents.stats })
      .from(fightRatingEvents)
      .where(and(eq(fightRatingEvents.userId, userId), eq(fightRatingEvents.game, game)))
      .orderBy(desc(fightRatingEvents.createdAt))
      .limit(20);
    const lines = ev.map((e) => FightStatLineSchema.safeParse(e.stats)).filter((x) => x.success).map((x) => x.data as FightStatLine);
    if (lines.length) {
      const avg: Partial<FightStatLine> = {};
      for (const k of AVG_KEYS) avg[k] = Math.round(lines.reduce((n, l) => n + l[k], 0) / lines.length);
      base.avg = avg;
    }
    const rank = await this.rankOf(userId, game, base);
    return rank ? { ...base, rank } : base;
  }

  private async rankOf(userId: string, game: string, me: FightRating): Promise<number | undefined> {
    if (me.games < LEADERBOARD_MIN_GAMES) return undefined;
    const board = await this.board(game, 500);
    const i = board.findIndex((x) => x.userId === userId);
    return i >= 0 ? i + 1 : undefined;
  }

  private async board(game: string, limit: number): Promise<FightRating[]> {
    const now = Date.now();
    const rows = await this.db
      .select({ r: fightRatings, name: users.username })
      .from(fightRatings)
      .innerJoin(users, eq(users.id, fightRatings.userId))
      .where(and(eq(fightRatings.game, game), sql`${fightRatings.games} >= ${LEADERBOARD_MIN_GAMES}`))
      .orderBy(desc(sql`${fightRatings.rating} - 2 * ${fightRatings.rd}`))
      .limit(limit);
    // the idle decay can reorder: sort by the conservative skill as shown
    return rows
      .map((x) => this.view(x.r, x.name ?? undefined, now))
      .sort((a, b) => b.skill - a.skill || b.rating - a.rating || a.userId.localeCompare(b.userId));
  }

  /** the leaderboard: real players with rated live fights only, ranked by the conservative skill (rating − 2·RD) */
  async leaderboard(userId: string | null, game = "boxing", limit = 50): Promise<FightLeaderboard> {
    const all = await this.board(game, Math.max(limit, 500));
    const rows = all.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
    let me: FightRating | null = null;
    if (userId) me = await this.mine(userId, game);
    return { rows, me };
  }
}
