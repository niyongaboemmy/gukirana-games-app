import { z } from "zod";
import { ReasonSchema } from "./console.js";
import { DEFAULT_FIGHT_RULES, FightRulesSchema, type FightRules } from "./boxing.js";

/**
 * Live-match rules per game (P1-GAME-06, docs/GAME-EXIT-RULES.md). Stored versioned in `game_settings` (append-only,
 * audited, edited in the staff console "Games" section and the back office /games page). A match copies the rules in
 * force when it is created (`matches.rules`), so an edit applies to new matches only — running matches keep theirs.
 * Practice vs AI never reads these: it is unlimited and has no stake.
 */
export const GAME_IDS = ["igisoro", "ludo", "pool", "boxing"] as const;
export const GameIdSchema = z.enum(GAME_IDS);
export type GameId = z.infer<typeof GameIdSchema>;
export const GAME_NAMES: Record<GameId, string> = { igisoro: "Igisoro", ludo: "Ludo", pool: "8-Ball Pool", boxing: "Boxing" };
/** real-time fight games (rounds on a fixed tick, no turns): their settings carry the `fight` block (boxing.ts) */
export const FIGHT_GAME_IDS = ["boxing"] as const satisfies readonly GameId[];
export const isFightGame = (g: GameId): boolean => (FIGHT_GAME_IDS as readonly string[]).includes(g);

/** bounds for every editable value (the editors show them; the API enforces them) */
export const GAME_SETTING_BOUNDS = {
  friendlyPerDay: { min: 0, max: 200 },
  stake: { min: 10, max: 10_000 },
  stakesCount: { min: 0, max: 8 },
  turnSeconds: { min: 10, max: 120 },
  reconnectSeconds: { min: 15, max: 300 },
  joinSeconds: { min: 15, max: 300 },
  maxTimeouts: { min: 1, max: 10 },
  maxMatchMinutes: { min: 5, max: 240 },
  /** P2-NET-05: connection losses one player may have in a match (the next one forfeits at once) */
  maxDisconnects: { min: 1, max: 10 },
  /** P2-NET-05: all of one player's time away in a match together (abuse guard) */
  reconnectBudgetSeconds: { min: 15, max: 900 },
} as const;

const B = GAME_SETTING_BOUNDS;
const int = (b: { min: number; max: number }) => z.number().int("WHOLE_NUMBER").min(b.min, "TOO_SMALL").max(b.max, "TOO_BIG");

export const GameSettingsSchema = z
  .object({
    /** live matches (friendly + staked) can be started; practice vs AI is always open */
    enabled: z.boolean(),
    /** friendly (stake 0) live matches one player may start per Kigali day in this game; 0 = none */
    friendlyPerDay: int(B.friendlyPerDay),
    /** the stakes (Stars each) players may choose, besides Friendly; empty = friendly only */
    stakes: z.array(int(B.stake)).max(B.stakesCount.max, "TOO_MANY_STAKES"),
    /** seconds per turn before a timeout */
    turnSeconds: int(B.turnSeconds),
    /** seconds a disconnected player has to come back before forfeiting: the opponent's maximum wait (P2-NET-05) */
    reconnectSeconds: int(B.reconnectSeconds),
    /** connection losses one player may have per match; one more forfeits (void before the first move). Missing = 3 */
    maxDisconnects: int(B.maxDisconnects).optional(),
    /** one player's total time away per match (every drop together). Missing = 2 × reconnectSeconds (boxing: = reconnectSeconds) */
    reconnectBudgetSeconds: int(B.reconnectBudgetSeconds).optional(),
    /** seconds both players have to open the match before it is voided */
    joinSeconds: int(B.joinSeconds),
    /** timeouts in a row that forfeit the match */
    maxTimeouts: int(B.maxTimeouts),
    /** longest a match may run; past it the match is voided and stakes refunded */
    maxMatchMinutes: int(B.maxMatchMinutes),
    /** fight games only (boxing): rounds, round / rest length, idle limit. Turn games leave it out; `turnSeconds` is unused by fight games. */
    fight: FightRulesSchema.optional(),
  })
  .refine((s) => new Set(s.stakes).size === s.stakes.length, { message: "DUPLICATE_STAKE", path: ["stakes"] })
  .refine((s) => s.reconnectSeconds < s.maxMatchMinutes * 60, { message: "RECONNECT_TOO_LONG", path: ["reconnectSeconds"] })
  .refine((s) => s.reconnectBudgetSeconds === undefined || s.reconnectBudgetSeconds >= s.reconnectSeconds, { message: "BUDGET_BELOW_WAIT", path: ["reconnectBudgetSeconds"] });
export type GameSettings = z.infer<typeof GameSettingsSchema>;

/** console / back office edit: the whole settings for one game + why (kept in the audit trail) */
export const UpdateGameSettingsSchema = z.object({ settings: GameSettingsSchema, reason: ReasonSchema });
export type UpdateGameSettings = z.infer<typeof UpdateGameSettingsSchema>;

// P2-NET-05 waits: a turn game waits up to 90 s for a dropped player (3 drops, 3 min away in all per match); a fight
// pauses up to 60 s per drop (90 s of pauses in all per fighter) — a fight cools down, so it waits less
const base = { enabled: true, friendlyPerDay: 20, stakes: [25, 50, 100, 200], turnSeconds: 30, reconnectSeconds: 90, joinSeconds: 60, maxTimeouts: 3, maxDisconnects: 3, reconnectBudgetSeconds: 180 };
/** seeded as version 1 of each game (migration-free first run) */
export const DEFAULT_GAME_SETTINGS: Record<GameId, GameSettings> = {
  igisoro: { ...base, maxMatchMinutes: 45 },
  ludo: { ...base, maxMatchMinutes: 90 },
  pool: { ...base, maxMatchMinutes: 60 },
  // P3-FGT-01: seeded switched OFF — staff open it in the console Games section once the Boxing hall ships
  boxing: { ...base, enabled: false, reconnectSeconds: 60, reconnectBudgetSeconds: 90, maxMatchMinutes: 15, fight: DEFAULT_FIGHT_RULES },
};

/** the settings row as the editors list it */
export interface GameSettingsRow {
  game: GameId;
  name: string;
  version: number;
  settings: GameSettings;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
}

/** the rules one match runs with (snapshot at creation; sent to the realtime room) */
export interface MatchRules {
  settingsVersion: number;
  turnSeconds: number;
  reconnectSeconds: number;
  joinSeconds: number;
  maxTimeouts: number;
  maxMatchMinutes: number;
  /** P2-NET-05: connection losses allowed per player (missing in older matches: 3) */
  maxDisconnects?: number;
  /** P2-NET-05: total time away allowed per player, seconds (missing: 2 × reconnectSeconds; boxing: reconnectSeconds) */
  reconnectBudgetSeconds?: number;
  /** fight games only (copied from the settings' fight block) */
  fight?: FightRules;
}
export const rulesOf = (s: GameSettings, version: number): MatchRules => ({
  ...(s.fight ? { fight: s.fight } : {}),
  settingsVersion: version,
  turnSeconds: s.turnSeconds,
  reconnectSeconds: s.reconnectSeconds,
  joinSeconds: s.joinSeconds,
  maxTimeouts: s.maxTimeouts,
  maxMatchMinutes: s.maxMatchMinutes,
  ...(s.maxDisconnects !== undefined ? { maxDisconnects: s.maxDisconnects } : {}),
  ...(s.reconnectBudgetSeconds !== undefined ? { reconnectBudgetSeconds: s.reconnectBudgetSeconds } : {}),
});

/**
 * Why a player can't be put into a live match. Personal reasons are told only to that player; the other side hears
 * OPPONENT_CANT_PLAY. GAME_DISABLED / STAKE_NOT_ALLOWED are about the table, so both may hear them.
 */
export const PERSONAL_REFUSALS = [
  "ACCOUNT_INACTIVE",
  "ON_A_BREAK",
  "DAILY_LIMIT_REACHED",
  "INSUFFICIENT_FUNDS",
  "FRIENDLY_LIMIT_REACHED",
  "ALREADY_IN_MATCH",
  // P2-NET-05: the player hasn't accepted this game's current rules card
  "RULES_NOT_ACCEPTED",
] as const;
export type PersonalRefusal = (typeof PERSONAL_REFUSALS)[number];
export const TABLE_REFUSALS = ["GAME_DISABLED", "STAKE_NOT_ALLOWED"] as const;
export type MatchRefusal = PersonalRefusal | (typeof TABLE_REFUSALS)[number] | "UNKNOWN_PLAYER";
export const isPersonalRefusal = (r: unknown): r is PersonalRefusal => typeof r === "string" && (PERSONAL_REFUSALS as readonly string[]).includes(r);

/** One stake button in the challenge / quick-match sheets. `ok: false` → disabled with `reason`. */
export interface StakeOption {
  stake: number;
  /** table fee each (packages/money; Stars carry none today) */
  fee: number;
  /** what this player pays: stake + fee */
  total: number;
  ok: boolean;
  reason?: MatchRefusal;
}
/** GET /games/offer: what this player may start right now, per game (the server checks the same again) */
export interface GameOffer {
  game: GameId;
  enabled: boolean;
  friendly: { limit: number; used: number; left: number; ok: boolean; reason?: MatchRefusal };
  stakes: StakeOption[];
  rules: MatchRules;
}
export interface PlayerOffer {
  stars: number;
  /** already in a live match (another one can't be started) */
  inMatch: boolean;
  /** Kigali day the friendly counters are for */
  day: string;
  games: GameOffer[];
}

/**
 * How a live match ended, beyond the signed `reason` (normal | forfeit | timeout | void). Sent with the room's
 * `result` message (and the void call) so the result screen can say exactly what happened.
 */
export const VOID_CAUSES = [
  "NO_SHOW", // a player never opened the match within joinSeconds
  "LEFT_BEFORE_START", // a player left before the first move
  "NO_FIRST_MOVE", // timed out before anyone made a move
  "BOTH_DISCONNECTED", // nobody left at the table to win
  "PLAYER_SUSPENDED", // staff suspended a player mid-match
  "SERVER_ERROR", // the result could not be settled
  "ROOM_CLOSED", // the game server closed the room (restart, shutdown)
  "MATCH_TOO_LONG", // ran past maxMatchMinutes
  "STALE_ESCROW", // reconciliation sweep: no live room and no settlement
  "LEFT_WHILE_WAITING", // P2-NET-05: friendly only — the player left while their opponent was disconnected
] as const;
export type VoidCause = (typeof VOID_CAUSES)[number];
export const VoidCauseSchema = z.enum(VOID_CAUSES);
export const FORFEIT_CAUSES = ["RESIGN", "DISCONNECT", "TIMEOUTS"] as const;
export type ForfeitCause = (typeof FORFEIT_CAUSES)[number];

/** realtime → API heartbeat: the matches this game server is running (stale escrow sweep) */
export const MatchHeartbeatSchema = z.object({ matchIds: z.array(z.string().uuid()).max(5000) });
export const VoidMatchSchema = z.object({ cause: VoidCauseSchema.optional() }).default({});

/**
 * Rules to accept before a live match (P2-NET-05, docs/GAME-EXIT-RULES.md "Rules card"). The text lives in one place
 * per game (web i18n `rules.<game>.*`); this number names its version. Bump a game's version whenever its rules text
 * changes in substance: every player is asked to accept again before their next live match of that game. Number
 * changes from the console (turn time, waits) are shown on the card but do not need a new acceptance.
 */
export const GAME_RULES_VERSION: Record<GameId, number> = { igisoro: 1, ludo: 1, pool: 1, boxing: 1 };
export const AcceptRulesSchema = z.object({ game: GameIdSchema, version: z.number().int().min(1).max(10_000) });
export type AcceptRules = z.infer<typeof AcceptRulesSchema>;
/** GET /games/rules: per game, the current rules version and whether I accepted it */
export interface RulesStatus {
  games: { game: GameId; version: number; accepted: boolean; acceptedAt: string | null }[];
}

/**
 * GET /games/active (P2-NET-05 resume): the live match I am seated in, so a reload, a new tab or another device puts
 * me straight back. `roomId` is the game server room (null until the game server reported it); `ring` for boxing.
 */
export interface ActiveMatch {
  matchId: string;
  game: GameId;
  stake: number;
  roomId: string | null;
  ring: string | null;
  createdAt: string;
}
export const AttachRoomSchema = z.object({ roomId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/), ring: z.string().max(16).regex(/^[A-Za-z0-9_-]*$/).optional() });
