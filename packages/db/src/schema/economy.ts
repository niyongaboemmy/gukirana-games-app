import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Versioned economy settings (fee bands, Stars rewards, currencies + conversion rates, tournament rake/payout).
 * Append-only: an admin edit inserts a new version with an effective-from time; nothing is ever retroactive.
 * Every journal entry records the version in effect (journal_entries.economy_version) for auditability.
 */
export const economySettings = pgTable("economy_settings", {
  id: uuid("id").primaryKey(),
  version: integer("version").notNull().unique(),
  settings: jsonb("settings").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Responsible play (player-set, enforced by the server): a daily stake limit, a play-time reminder and "take a break"
 * (self-exclusion). Lowering a limit applies at once; raising one only after 24 h (cooling-off).
 */
export const walletLimits = pgTable("wallet_limits", {
  userId: uuid("user_id").primaryKey(),
  dailyStakeLimit: integer("daily_stake_limit"),
  pendingStakeLimit: integer("pending_stake_limit"),
  pendingFrom: timestamp("pending_from", { withTimezone: true }),
  reminderMinutes: integer("reminder_minutes").notNull().default(60),
  selfExcludedUntil: timestamp("self_excluded_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
