import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/**
 * Administrative Block access control (P2-ADM-03): roles, offices, which roles open which office, and who holds which
 * role. Ids are stable slugs (see SEED_OFFICES / SEED_ROLES in @gukirana/contracts). Every change is written to
 * `access_audit`.
 */
export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** the role opens every office (super admin) */
  allOffices: boolean("all_offices").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offices = pgTable("offices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** role → office assignment: a holder of the role walks straight into the office */
export const roleOffices = pgTable(
  "role_offices",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    officeId: text("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.officeId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    /** user id of the granting super admin, "admin-token:<name>", "bootstrap" or "cli" */
    grantedBy: text("granted_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_role_idx").on(t.roleId)],
);

/** Append-only log of every access-control change (who did what to which target). */
export const accessAudit = pgTable(
  "access_audit",
  {
    id: uuid("id").primaryKey(),
    who: text("who").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_audit_at_idx").on(t.at)],
);
