import { z } from "zod";
import { ReasonSchema } from "./console.js";

/**
 * Live-match rules per game (P1-GAME-06, docs/GAME-EXIT-RULES.md). Stored versioned in `game_settings` (append-only,
 * audited, edited in the staff console "Games" section and the back office /games page). A match copies the rules in
 * force when it is created (`matches.rules`), so an edit applies to new matches only — running matches keep theirs.
 * Practice vs AI never reads these: it is unlimited and has no stake.
 */
export const GAME_IDS = ["igisoro", "ludo", "pool"] as const;
export const GameIdSchema = z.enum(GAME_IDS);
export type GameId = z.infer<typeof GameIdSchema>;
export const GAME_NAMES: Record<GameId, string> = { igisoro: "Igisoro", ludo: "Ludo", pool: "8-Ball Pool" };

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
    /** seconds a disconnected player has to come back before forfeiting */
    reconnectSeconds: int(B.reconnectSeconds),
    /** seconds both players have to open the match before it is voided */
    joinSeconds: int(B.joinSeconds),
    /** timeouts in a row that forfeit the match */
    maxTimeouts: int(B.maxTimeouts),
    /** longest a match may run; past it the match is voided and stakes refunded */
    maxMatchMinutes: int(B.maxMatchMinutes),
  })
  .refine((s) => new Set(s.stakes).size === s.stakes.length, { message: "DUPLICATE_STAKE", path: ["stakes"] })
  .refine((s) => s.reconnectSeconds < s.maxMatchMinutes * 60, { message: "RECONNECT_TOO_LONG", path: ["reconnectSeconds"] });
export type GameSettings = z.infer<typeof GameSettingsSchema>;

/** console / back office edit: the whole settings for one game + why (kept in the audit trail) */
export const UpdateGameSettingsSchema = z.object({ settings: GameSettingsSchema, reason: ReasonSchema });
export type UpdateGameSettings = z.infer<typeof UpdateGameSettingsSchema>;

const base = { enabled: true, friendlyPerDay: 20, stakes: [25, 50, 100, 200], turnSeconds: 30, reconnectSeconds: 60, joinSeconds: 60, maxTimeouts: 3 };
/** seeded as version 1 of each game (migration-free first run) */
export const DEFAULT_GAME_SETTINGS: Record<GameId, GameSettings> = {
  igisoro: { ...base, maxMatchMinutes: 45 },
  ludo: { ...base, maxMatchMinutes: 90 },
  pool: { ...base, maxMatchMinutes: 60 },
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
}
export const rulesOf = (s: GameSettings, version: number): MatchRules => ({
  settingsVersion: version,
  turnSeconds: s.turnSeconds,
  reconnectSeconds: s.reconnectSeconds,
  joinSeconds: s.joinSeconds,
  maxTimeouts: s.maxTimeouts,
  maxMatchMinutes: s.maxMatchMinutes,
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
] as const;
export type VoidCause = (typeof VOID_CAUSES)[number];
export const VoidCauseSchema = z.enum(VOID_CAUSES);
export const FORFEIT_CAUSES = ["RESIGN", "DISCONNECT", "TIMEOUTS"] as const;
export type ForfeitCause = (typeof FORFEIT_CAUSES)[number];

/** realtime → API heartbeat: the matches this game server is running (stale escrow sweep) */
export const MatchHeartbeatSchema = z.object({ matchIds: z.array(z.string().uuid()).max(5000) });
export const VoidMatchSchema = z.object({ cause: VoidCauseSchema.optional() }).default({});
