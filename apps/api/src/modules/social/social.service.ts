import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, gte, ratings, reports, sql, userBlocks, users } from "@gukirana/db";
import { MAX_BLOCKS, type ReportReason } from "@gukirana/contracts";
import { createLogger } from "@gukirana/observability";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";
import { levelForXp } from "../levels/xp.js";

const log = createLogger("social");
export const REPORTS_PER_DAY = 20;

export interface ReportInput {
  targetId: string;
  reason: ReportReason;
  details?: string;
  context?: { place?: string; chat?: { name: string; text: string; t: number }[] };
}

/** Public profiles, personal block lists and reports (SRS FR-COM-07, FR-COM-11, SAFE-04). */
@Injectable()
export class SocialService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** What anyone signed in may see about a player: name, colour, look, level, ratings. Never phone / email. */
  async publicProfile(id: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u || u.status !== "active" || !u.username) throw new NotFoundException({ code: "PLAYER_NOT_FOUND" });
    const r = await this.db.select().from(ratings).where(eq(ratings.userId, id));
    return {
      id: u.id,
      username: u.username,
      color: u.color,
      bodyType: u.bodyType,
      look: u.look,
      level: levelForXp(u.xp),
      memberSince: u.createdAt.toISOString().slice(0, 7),
      ratings: Object.fromEntries(r.map((x) => [x.game, { rating: x.rating, games: x.games, wins: x.wins }])),
    };
  }

  async blocks(userId: string) {
    const rows = await this.db
      .select({ id: userBlocks.blockedId, username: users.username, since: userBlocks.createdAt })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.userId, userId));
    return rows.map((r) => ({ id: r.id, username: r.username ?? "", since: r.since.toISOString() }));
  }

  async block(userId: string, blockedId: string): Promise<void> {
    if (userId === blockedId) throw new BadRequestException({ code: "CANNOT_BLOCK_SELF" });
    const [target] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, blockedId));
    if (!target) throw new NotFoundException({ code: "PLAYER_NOT_FOUND" });
    const [count] = await this.db.select({ n: sql<number>`count(*)::int` }).from(userBlocks).where(eq(userBlocks.userId, userId));
    if (Number(count?.n ?? 0) >= MAX_BLOCKS) throw new BadRequestException({ code: "TOO_MANY_BLOCKS" });
    await this.db.insert(userBlocks).values({ userId, blockedId }).onConflictDoNothing();
  }

  async unblock(userId: string, blockedId: string): Promise<void> {
    await this.db.delete(userBlocks).where(and(eq(userBlocks.userId, userId), eq(userBlocks.blockedId, blockedId)));
  }

  async report(reporterId: string, r: ReportInput): Promise<{ id: string }> {
    if (reporterId === r.targetId) throw new BadRequestException({ code: "CANNOT_REPORT_SELF" });
    const [target] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, r.targetId));
    if (!target) throw new NotFoundException({ code: "PLAYER_NOT_FOUND" });
    const since = new Date(Date.now() - 24 * 3600_000);
    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.reporterId, reporterId), gte(reports.createdAt, since)));
    if (Number(count?.n ?? 0) >= REPORTS_PER_DAY) throw new HttpException({ code: "REPORT_RATE_LIMITED" }, HttpStatus.TOO_MANY_REQUESTS);
    const id = newId();
    await this.db.insert(reports).values({ id, reporterId, targetId: r.targetId, reason: r.reason, details: r.details, context: r.context ?? null });
    log.info({ reportId: id, reason: r.reason }, "player report queued"); // no names / chat text in logs
    return { id };
  }
}
