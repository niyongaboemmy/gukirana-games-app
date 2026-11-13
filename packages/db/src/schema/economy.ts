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
