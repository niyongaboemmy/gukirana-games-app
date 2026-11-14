import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/** Personal block list (SRS FR-COM-07, SAFE-04): blocked people are invisible and silent to each other. */
export const userBlocks = pgTable(
  "user_blocks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.blockedId] })],
);

/** Player reports for the moderation queue (DESIGN-SPEC §12.3, SRS FR-COM-11). Evidence = recent chat lines. */
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id),
  targetId: uuid("target_id")
    .notNull()
    .references(() => users.id),
  reason: text("reason").notNull(),
  details: text("details"),
  /** where it happened + recent chat lines involving the reported player (no audio in this version) */
  context: jsonb("context"),
  /** open | resolved | dismissed */
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** staff handling (P2-CON-02): who closed it, when, and the internal note they left */
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
});
