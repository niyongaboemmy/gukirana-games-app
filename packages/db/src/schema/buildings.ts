import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Buildings on the plaza that staff can open or close from the admin console (P2-CON-01). Ids match the plaza portal
 * ids (pool, ludo, igisoro, arena, admin). A closed building keeps its doors shut for players; staff still get in.
 */
export const buildings = pgTable("buildings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  open: boolean("open").notNull().default(true),
  /** shown at the closed door, e.g. "Back at 18:00 — maintenance" */
  message: text("message").notNull().default(""),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
