import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

export const matches = pgTable("matches", {
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
});

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
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);
