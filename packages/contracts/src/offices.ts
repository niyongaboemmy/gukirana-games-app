import { z } from "zod";

/**
 * Administrative Block — shared contract between the 3D block (web), the realtime room and the API.
 *
 * Offices are closed rooms. A person whose ROLE is assigned to an office walks straight in (the door opens for them);
 * anyone else knocks, and someone inside who holds the office's role (or a super admin) can Let in / Decline.
 * Roles, offices and role→office assignments live in the database (API); this file fixes the ids, messages and shapes.
 */

/** Seeded offices (more can be created in the DB; ids are stable slugs). */
export const SEED_OFFICES = [
  { id: "super-admin", name: "Super Admin", description: "Whole compound: halls, games, staff, settings" },
  { id: "it-office", name: "IT Office", description: "Systems, servers, incidents, accounts" },
  { id: "accountant", name: "Accountant", description: "Ledger, revenue, payouts, reports" },
  { id: "customer-support", name: "Customer Support", description: "Player help, reports, disputes" },
] as const;
export type SeedOfficeId = (typeof SEED_OFFICES)[number]["id"];

/** Seeded roles and the office each is assigned to at seed time (the assignment is editable in the DB). */
export const SEED_ROLES = [
  { id: "super_admin", name: "Super Admin", offices: ["super-admin"], all: true },
  { id: "it_admin", name: "IT Administrator", offices: ["it-office"], all: false },
  { id: "accountant", name: "Accountant", offices: ["accountant"], all: false },
  { id: "support_agent", name: "Support Agent", offices: ["customer-support"], all: false },
] as const;
export type SeedRoleId = (typeof SEED_ROLES)[number]["id"];

/** slug: lowercase letters, digits, dashes / underscores */
export const OfficeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/);
export const RoleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/);

/** GET /admin-block/offices (any signed-in player): the directory shown at reception. */
export const OfficeSummarySchema = z.object({
  id: OfficeIdSchema,
  name: z.string(),
  description: z.string(),
  /** the viewer may walk straight in (holds an assigned role, or a role with `all`) */
  canEnter: z.boolean(),
  /** number of staff currently inside (from realtime presence; 0 if unknown) */
  occupants: z.number().int().nonnegative(),
});
export type OfficeSummary = z.infer<typeof OfficeSummarySchema>;

/** GET /me/roles */
export const MyRolesSchema = z.object({ roles: z.array(RoleIdSchema), offices: z.array(OfficeIdSchema) });
export type MyRoles = z.infer<typeof MyRolesSchema>;

/* ---------------- realtime messages (admin-block room = the hall room for game "admin") ---------------- */

/** client → server */
export const OfficeMsg = {
  /** ask to enter an office (role holders are admitted at once; others trigger a knock) */
  enter: "office-enter", // { office }
  /** answer a knock (only someone inside with the office's role, or a super admin) */
  answer: "office-answer", // { knockId, allow: boolean }
  /** leave the office (back to the corridor) */
  leave: "office-leave", // { office }
} as const;

/** server → client */
export const OfficeEvt = {
  /** you may go in now (door opens for you) */
  admitted: "office-admitted", // { office, via: "role" | "invite" }
  /** your knock was sent; wait at the door */
  knocking: "office-knocking", // { office, knockId, expiresInMs }
  /** to people inside: someone is knocking */
  knock: "office-knock", // { office, knockId, from: { id, name, level } , expiresInMs }
  /** your knock was declined / expired / nobody with the role is inside */
  refused: "office-refused", // { office, knockId?, reason: OfficeRefusal }
  /** occupancy changed (for door lamps + reception directory) */
  occupancy: "office-occupancy", // { office, occupants }
} as const;

/**
 * Why a door stays shut. NOT_ALLOWED: unknown office; LOGIN_REQUIRED: guests can't enter offices;
 * RATE_LIMITED: knocking too often (1 per 5 s per door, max 3 open knocks); NOBODY_INSIDE is also sent when the last
 * staff member leaves while you knock.
 */
export const OFFICE_REFUSALS = ["DECLINED", "EXPIRED", "NOBODY_INSIDE", "NOT_ALLOWED", "LOGIN_REQUIRED", "RATE_LIMITED"] as const;
export type OfficeRefusal = (typeof OFFICE_REFUSALS)[number];

export const OfficeEnterSchema = z.object({ office: OfficeIdSchema });
export const OfficeAnswerSchema = z.object({ knockId: z.string().min(1).max(40), allow: z.boolean() });
export const KNOCK_TTL_MS = 30_000;
