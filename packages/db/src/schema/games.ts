import { doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey(),
    game: text("game").notNull(),
    variant: text("variant").notNull().default("classic"),
    currency: text("currency").notNull().default("STAR"),
    stake: integer("stake").notNull(),
    fee: integer("fee").notNull().default(0),
    status: text("status").notNull().default("active"), // active | settled | void | disputed
    seedCommit: text("seed_commit"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** the game rules this match runs with (game_settings snapshot at creation; P1-GAME-06) */
    rules: jsonb("rules"),
    /** past this, an unsettled match is voided and refunded by the reconciliation sweep */
    voidAfter: timestamp("void_after", { withTimezone: true }),
    /** last time a game server said it is running this match (stale escrow sweep) */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** why it was voided (docs/GAME-EXIT-RULES.md: NO_SHOW, BOTH_DISCONNECTED, STALE_ESCROW, …) */
    voidCause: text("void_cause"),
    /** P2-NET-05 resume: the game server room running this match (reported once the room exists) + the boxing ring */
    roomId: text("room_id"),
    ring: text("ring"),
  },
  (t) => [index("matches_status_idx").on(t.status)],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    seat: integer("seat").notNull(),
    rank: integer("rank"),
    ratingBefore: integer("rating_before"),
    ratingAfter: integer("rating_after"),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] }), index("match_players_user_idx").on(t.userId)],
);

/**
 * Live-match rules per game (P1-GAME-06): append-only versions, like economy_settings. The latest version of a game
 * is in force; every edit carries who and why (also written to access_audit).
 */
export const gameSettings = pgTable(
  "game_settings",
  {
    id: uuid("id").primaryKey(),
    game: text("game").notNull(),
    version: integer("version").notNull(),
    settings: jsonb("settings").notNull(),
    reason: text("reason"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("game_settings_game_version").on(t.game, t.version)],
);

/**
 * Friendly (stake 0) live matches started per player, game and Kigali day. Taken with one conditional upsert per
 * player (count < limit) inside the match-create transaction, so parallel creates can never exceed the limit; a
 * voided friendly match gives its game back.
 */
export const friendlyPlays = pgTable(
  "friendly_plays",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    game: text("game").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game, t.day] })],
);

/**
 * Fight skill rating (P3-FGT-10, docs/FIGHT-GAME-V2.md §7): Glicko-2 per player and fight game (boxing today).
 * Written ONLY by GamesService.settle for a settled, non-void live match (never practice, never a client); one
 * `fight_rating_events` row per (match, player) makes the update idempotent and keeps the before → after history and
 * the signed skill line of every rated fight (the "own average" of the skill report).
 */
export const fightRatings = pgTable(
  "fight_ratings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    game: text("game").notNull(),
    rating: doublePrecision("rating").notNull().default(1500),
    rd: doublePrecision("rd").notNull().default(350),
    vol: doublePrecision("vol").notNull().default(0.06),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    peak: doublePrecision("peak").notNull().default(1500),
    lastAt: timestamp("last_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game] }), index("fight_ratings_game_idx").on(t.game, t.rating)],
);

export const fightRatingEvents = pgTable(
  "fight_rating_events",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    game: text("game").notNull(),
    opponentId: uuid("opponent_id").notNull(),
    /** 1 win, 0.5 draw, 0 loss */
    score: doublePrecision("score").notNull(),
    ratingBefore: doublePrecision("rating_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    rdBefore: doublePrecision("rd_before").notNull(),
    rdAfter: doublePrecision("rd_after").notNull(),
    /** the signed skill line of this fight (FightStatLine) */
    stats: jsonb("stats"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] }), index("fight_rating_events_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Rules cards accepted (P2-NET-05): one row per user, game and rules version (GAME_RULES_VERSION in contracts). A
 * player is seated in a live match only with a row for that game's current version; a new version asks again. Rows
 * are never updated or deleted (the acceptance trail).
 */
export const rulesAcceptances = pgTable(
  "rules_acceptances",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    game: text("game").notNull(),
    version: integer("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game, t.version] })],
);
