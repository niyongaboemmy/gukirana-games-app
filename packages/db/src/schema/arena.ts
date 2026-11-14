import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/**
 * Tournament Arena access and events (P2-ARN-02, docs/ARENA-REQUIREMENTS.md). No money here: entry fees and prizes
 * arrive with the tournament engine through LedgerService. Admin changes are audited in `access_audit`.
 */

/** Single row (id = 1): the building switch and defaults. `version` bumps on every change. */
export const arenaSettings = pgTable("arena_settings", {
  id: integer("id").primaryKey(),
  open: boolean("open").notNull().default(false),
  defaultCapacity: integer("default_capacity").notNull().default(200),
  maxConcourse: integer("max_concourse").notNull().default(50),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").notNull().default("seed"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const arenaEvents = pgTable(
  "arena_events",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    game: text("game"),
    status: text("status").notNull().default("draft"),
    description: text("description").notNull().default(""),
    doorsOpenAt: timestamp("doors_open_at", { withTimezone: true }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** ArenaScopeRule[] (validated with the contract schema on every write), combined with AND */
    rules: jsonb("rules").notNull(),
    /** spectator seats (zone "seats") and VIP box seats (zone "vip") */
    capacity: integer("capacity").notNull(),
    vipCapacity: integer("vip_capacity").notNull().default(0),
    /** passes issued per zone — changed only together with arena_passes, in one transaction */
    seatsIssued: integer("seats_issued").notNull().default(0),
    vipIssued: integer("vip_issued").notNull().default(0),
    floorIssued: integer("floor_issued").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("arena_events_status_idx").on(t.status, t.startsAt)],
);

/** One pass per (event, user); zone seats | vip | floor; `seat` reserved for assigned seating (null = free choice). */
export const arenaPasses = pgTable(
  "arena_passes",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => arenaEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    zone: text("zone").notNull(),
    seat: text("seat"),
    /** scope | invite | participant — revoking a list entry revokes passes issued through it */
    via: text("via").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index("arena_passes_user_idx").on(t.userId)],
);

export const arenaInvites = pgTable(
  "arena_invites",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => arenaEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** zone the invite admits to: seats | vip | floor */
    zone: text("zone").notNull().default("seats"),
    invitedBy: text("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index("arena_invites_user_idx").on(t.userId)],
);

export const arenaParticipants = pgTable(
  "arena_participants",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => arenaEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index("arena_participants_user_idx").on(t.userId)],
);

/** Bars from the arena building (with reason, optional expiry). One row per user: barring again updates it. */
export const arenaBars = pgTable("arena_bars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  until: timestamp("until", { withTimezone: true }),
  barredBy: text("barred_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
