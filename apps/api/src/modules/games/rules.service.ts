import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq, rulesAcceptances } from "@gukirana/db";
import { GAME_IDS, GAME_RULES_VERSION, type GameId, type RulesStatus } from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";

/** P2-NET-05 rules acceptance gate: on unless FF_RULES_ACCEPT=0 (dev default on) */
export const rulesGateOn = (): boolean => process.env.FF_RULES_ACCEPT !== "0";

/**
 * Rules cards (P2-NET-05, docs/GAME-EXIT-RULES.md "Rules card"): a player accepts a game's rules once per rules
 * version (GAME_RULES_VERSION). GamesService refuses to seat a player in a live match without the current acceptance
 * (`RULES_NOT_ACCEPTED`, a personal refusal), so the check is server-side; the web card is only how they accept.
 */
@Injectable()
export class RulesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async status(userId: string): Promise<RulesStatus> {
    const rows = await this.db.select().from(rulesAcceptances).where(eq(rulesAcceptances.userId, userId));
    return {
      games: GAME_IDS.map((game) => {
        const version = GAME_RULES_VERSION[game];
        const row = rows.find((r) => r.game === game && r.version === version);
        return { game, version, accepted: !!row, acceptedAt: row ? row.acceptedAt.toISOString() : null };
      }),
    };
  }

  /** idempotent; only the current version can be accepted (an old card in an open tab must be read again) */
  async accept(userId: string, game: GameId, version: number): Promise<{ game: GameId; version: number; accepted: true }> {
    if (version !== GAME_RULES_VERSION[game]) throw new BadRequestException({ code: "RULES_VERSION_OUTDATED", version: GAME_RULES_VERSION[game] });
    await this.db.insert(rulesAcceptances).values({ userId, game, version }).onConflictDoNothing();
    return { game, version, accepted: true };
  }

  /** has this player accepted the current rules of `game`? (always true with the gate off) */
  async accepted(userId: string, game: GameId): Promise<boolean> {
    if (!rulesGateOn()) return true;
    const rows = await this.db
      .select({ v: rulesAcceptances.version })
      .from(rulesAcceptances)
      .where(and(eq(rulesAcceptances.userId, userId), eq(rulesAcceptances.game, game), eq(rulesAcceptances.version, GAME_RULES_VERSION[game])))
      .limit(1);
    return rows.length > 0;
  }
}
