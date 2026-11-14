import { BadRequestException, ConflictException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { accessAudit, desc, eq, gameSettings } from "@gukirana/db";
import {
  DEFAULT_GAME_SETTINGS,
  GAME_IDS,
  GAME_NAMES,
  GameSettingsSchema,
  type GameId,
  type GameSettings,
  type GameSettingsRow,
} from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";

/** a settings edit reaches new matches within this (the editing process sees it at once) */
const CACHE_MS = 5_000;

/** one access_audit row (the console's live monitor and account history read this table) */
export async function writeAudit(db: Db, who: string, action: string, target: string, detail: string | null): Promise<void> {
  await db.insert(accessAudit).values({ id: newId(), who: who.slice(0, 120), action, target, detail: detail?.slice(0, 2000) ?? null });
}

/** a short "field: old → new" list for the audit trail */
export function settingsDiff(a: GameSettings | null, b: GameSettings): string {
  if (!a) return "first version";
  const keys = Object.keys(b) as (keyof GameSettings)[];
  const fmt = (v: unknown) => (Array.isArray(v) ? `[${v.join(", ")}]` : String(v));
  const out = keys.filter((k) => fmt(a[k]) !== fmt(b[k])).map((k) => `${k}: ${fmt(a[k])} → ${fmt(b[k])}`);
  return out.length ? out.join("; ") : "no change";
}

/**
 * Live-match rules per game (P1-GAME-06): versioned + audited like economy_settings. `current()` is what
 * GamesService.create() copies onto a new match; running matches keep the copy they started with.
 */
@Injectable()
export class GameSettingsService implements OnModuleInit {
  private cache = new Map<GameId, { at: number; value: { version: number; settings: GameSettings } }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /** version 1 of every game from the defaults (only what is missing) */
  async seed(): Promise<void> {
    await this.db
      .insert(gameSettings)
      .values(GAME_IDS.map((g) => ({ id: newId(), game: g, version: 1, settings: DEFAULT_GAME_SETTINGS[g], reason: "defaults", createdBy: "system" })))
      .onConflictDoNothing();
  }

  async current(game: GameId): Promise<{ version: number; settings: GameSettings }> {
    const hit = this.cache.get(game);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    let [row] = await this.db
      .select({ version: gameSettings.version, settings: gameSettings.settings })
      .from(gameSettings)
      .where(eq(gameSettings.game, game))
      .orderBy(desc(gameSettings.version))
      .limit(1);
    if (!row) {
      await this.seed();
      row = { version: 1, settings: DEFAULT_GAME_SETTINGS[game] };
    }
    // a stored row is re-read through the schema; anything unreadable falls back to the defaults (never a crash)
    const parsed = GameSettingsSchema.safeParse(row.settings);
    const value = { version: row.version, settings: parsed.success ? parsed.data : DEFAULT_GAME_SETTINGS[game] };
    this.cache.set(game, { at: Date.now(), value });
    return value;
  }

  async all(): Promise<GameSettingsRow[]> {
    const out: GameSettingsRow[] = [];
    for (const g of GAME_IDS) {
      const [r] = await this.history(g, 1);
      if (r) out.push(r);
    }
    return out;
  }

  async history(game: GameId, limit = 20): Promise<GameSettingsRow[]> {
    await this.current(game); // seeds on first use
    const rows = await this.db.select().from(gameSettings).where(eq(gameSettings.game, game)).orderBy(desc(gameSettings.version)).limit(limit);
    return rows.map((r) => ({
      game,
      name: GAME_NAMES[game],
      version: r.version,
      settings: r.settings as GameSettings,
      reason: r.reason,
      updatedBy: r.createdBy,
      updatedAt: r.createdAt.toISOString(),
    }));
  }

  /** a new version (validated, bounded, never edits history); effective at once for new matches; audited */
  async update(game: GameId, input: unknown, reason: string, by: string): Promise<GameSettingsRow> {
    const parsed = GameSettingsSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException({ code: "INVALID_SETTINGS", errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const next: GameSettings = { ...parsed.data, stakes: [...parsed.data.stakes].sort((a, b) => a - b) };
    const cur = await this.current(game);
    const [latest] = await this.db
      .select({ version: gameSettings.version, settings: gameSettings.settings })
      .from(gameSettings)
      .where(eq(gameSettings.game, game))
      .orderBy(desc(gameSettings.version))
      .limit(1);
    const version = (latest?.version ?? cur.version) + 1;
    const inserted = await this.db
      .insert(gameSettings)
      .values({ id: newId(), game, version, settings: next, reason, createdBy: by.slice(0, 120) })
      .onConflictDoNothing()
      .returning();
    // two editors saved at the same moment: the second one must look again (no silent overwrite)
    if (!inserted.length) throw new ConflictException({ code: "SETTINGS_CHANGED" });
    this.cache.delete(game);
    await writeAudit(this.db, by, "game.settings", `game:${game}`, `v${version} · ${settingsDiff((latest?.settings as GameSettings) ?? null, next)} · reason: ${reason}`);
    const [row] = await this.history(game, 1);
    return row!;
  }

  /** test hook */
  forget(): void {
    this.cache.clear();
  }
}
