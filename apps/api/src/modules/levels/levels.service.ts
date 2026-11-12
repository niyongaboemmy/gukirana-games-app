import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql, users, xpEvents } from "@gukirana/db";
import { DB, type Db } from "../../common/db.module.js";
import { kigaliDay, newId } from "../../common/ids.js";
import { DAILY_XP_CAP, PRACTICE_DAILY_CAP } from "./xp.js";

@Injectable()
export class LevelsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async todayXp(userId: string, reason?: string): Promise<number> {
    const conds = [eq(xpEvents.userId, userId), eq(xpEvents.day, kigaliDay())];
    if (reason) conds.push(eq(xpEvents.reason, reason));
    const rows = await this.db.select({ s: sql<number>`coalesce(sum(${xpEvents.xp}), 0)::int` }).from(xpEvents).where(and(...conds));
    return Number(rows[0]?.s ?? 0);
  }

  /** Records XP (respecting the daily cap) and returns the XP actually granted. */
  async award(userId: string, xp: number, reason: string, refId?: string): Promise<number> {
    const today = await this.todayXp(userId);
    const granted = Math.max(0, Math.min(xp, DAILY_XP_CAP - today));
    if (granted === 0) return 0;
    await this.db.insert(xpEvents).values({ id: newId(), userId, reason, refId, xp: granted, day: kigaliDay() });
    await this.db.update(users).set({ xp: sql`${users.xp} + ${granted}` }).where(eq(users.id, userId));
    return granted;
  }

  /** Practice vs AI: +2 XP, max 20/day (SRS §5.9.1). No Stars change — prevents client-side minting. */
  async awardPractice(userId: string, game: string): Promise<number> {
    const practiceToday = await this.todayXp(userId, "practice");
    if (practiceToday >= PRACTICE_DAILY_CAP) return 0;
    return this.award(userId, Math.min(2, PRACTICE_DAILY_CAP - practiceToday), "practice", game);
  }
}
