import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/**
 * Account sanctions (P2-CON-02): warnings, chat mutes and suspensions, each with a reason and an optional end.
 * A row is never deleted: lifting one sets lifted_at / lifted_by / lift_reason, so the account history stays whole.
 * `users.status` stays the single switch for "may this account play"; a suspension row explains it and carries its
 * end (the console's sweep reactivates the account when ends_at passes).
 */
export const accountSanctions = pgTable(
  "account_sanctions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** warn | mute | suspend */
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** null = until lifted (warnings never end; a mute always has an end) */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: text("lifted_by"),
    liftReason: text("lift_reason"),
  },
  (t) => [index("account_sanctions_user_idx").on(t.userId, t.createdAt), index("account_sanctions_ends_idx").on(t.kind, t.endsAt)],
);

/** Internal staff notes on an account (P2-CON-02). Never shown to the player; every note is audited. */
export const staffNotes = pgTable(
  "staff_notes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("staff_notes_user_idx").on(t.userId, t.createdAt)],
);
