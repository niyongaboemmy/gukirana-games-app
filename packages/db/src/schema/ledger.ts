import { bigint, bigserial, boolean, char, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Double-entry, append-only ledger (SRS §6, plan Appendix A.1).
 * Only the API `ledger` module writes these tables, through LedgerService.post().
 */
export const accountOwner = pgEnum("account_owner", [
  "user",
  "platform",
  "escrow",
  "fee_held",
  "tax",
  "provider",
  "promo",
]);

export const accountKind = pgEnum("account_kind", [
  "available",
  "bonus",
  "locked",
  "pending",
  "stars",
  "revenue",
  "payable",
  "clearing",
  "budget",
]);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey(),
    ownerType: accountOwner("owner_type").notNull(),
    ownerId: uuid("owner_id"),
    kind: accountKind("kind").notNull(),
    currency: text("currency").notNull().default("COIN"),
    allowNegative: boolean("allow_negative").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ledger_accounts_owner_kind_currency").on(t.ownerType, t.ownerId, t.kind, t.currency)],
);

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  createdBy: text("created_by").notNull(),
  /** economy_settings.version in effect when this entry was posted (fees / rates used) */
  economyVersion: integer("economy_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journalLines = pgTable("journal_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => journalEntries.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => ledgerAccounts.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  direction: char("direction", { length: 1 }).notNull(),
});

export const accountBalances = pgTable("account_balances", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => ledgerAccounts.id),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  version: bigint("version", { mode: "number" }).notNull().default(0),
});

export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});
