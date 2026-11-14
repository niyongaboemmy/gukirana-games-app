import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
