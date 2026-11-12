import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Users (SRS §5.1). Phone is stored in E.164; production adds field-level encryption (SEC-05). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  /** E.164 phone or null; at least one of phone/email is set. Production adds field-level encryption (SEC-05). */
  phone: text("phone").unique(),
  email: text("email").unique(),
  username: text("username").unique(),
  color: text("color").notNull().default("#2F80ED"),
  /** Avatar style chosen by the player (never inferred): feminine | masculine | neutral */
  bodyType: text("body_type").notNull().default("neutral"),
  /** Encoded avatar look (skin, hair, outfit ids) — validated by the API, max 300 chars */
  look: text("look"),
  xp: integer("xp").notNull().default(0),
  kycTier: integer("kyc_tier").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey(),
  /** login identifier: E.164 phone or lower-cased email (column kept as "phone" for compatibility) */
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  device: text("device"),
  revoked: boolean("revoked").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-game rating (Elo for now; Glicko-2 in P1-MM-02). */
export const ratings = pgTable(
  "ratings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    game: text("game").notNull(),
    rating: integer("rating").notNull().default(1500),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game] })],
);

export const xpEvents = pgTable("xp_events", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  reason: text("reason").notNull(),
  refId: text("ref_id"),
  xp: integer("xp").notNull(),
  day: text("day").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
