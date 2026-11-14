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
/**
 * Answer a knock. `action` (P2-ADM-04) is the full choice: Let in / Please wait / Decline. The older
 * `{ allow: boolean }` form keeps working (allow → "allow", !allow → "decline"); `action` wins when both are sent.
 */
export const OfficeAnswerActionSchema = z.enum(["allow", "wait", "decline"]);
export type OfficeAnswerAction = z.infer<typeof OfficeAnswerActionSchema>;
export const OfficeAnswerSchema = z
  .object({ knockId: z.string().min(1).max(40), allow: z.boolean().optional(), action: OfficeAnswerActionSchema.optional() })
  .refine((a) => a.allow !== undefined || a.action !== undefined, "allow or action is required");
export const answerAction = (a: { allow?: boolean; action?: OfficeAnswerAction }): OfficeAnswerAction => a.action ?? (a.allow ? "allow" : "decline");
export const KNOCK_TTL_MS = 30_000;

/* ---------------- P2-ADM-04: queue, Please wait, capacity, office conversation (all additive) ---------------- */

/** a knock answered "Please wait" (or queued at a full office) stays open this long, renewed on every wait */
export const KNOCK_WAIT_TTL_MS = 180_000;

/** client → server (additive) */
export const OfficeMsgV2 = {
  /** stop waiting: withdraw my knock */
  cancel: "office-cancel", // { knockId }
  /** office text chat: reaches only the people inside the same office */
  chat: "office-chat", // { text }
} as const;

/** server → client (additive) */
export const OfficeEvtV2 = {
  /** to the visitor: staff asked you to wait (or the office is full); the knock stays queued */
  wait: "office-wait", // { office, knockId, expiresInMs, reason: "ASKED" | "FULL" }
  /** to staff inside: this knock is finished (answered by someone, expired, withdrawn, the visitor left) */
  knockClosed: "office-knock-closed", // { office, knockId, outcome: KnockOutcome }
  /** to the people inside one office: who is in the conversation (only those inside ever see the names) */
  members: "office-members", // { office, members: { id, name, staff }[] }
  /** office text chat line (only to the people inside that office) */
  chat: "office-chat", // { office, id, name, color, text, t }
} as const;

export const KNOCK_OUTCOMES = ["ALLOWED", "DECLINED", "EXPIRED", "CANCELLED", "LEFT", "NOBODY_INSIDE"] as const;
export type KnockOutcome = (typeof KNOCK_OUTCOMES)[number];
export type WaitReason = "ASKED" | "FULL";
export const OfficeCancelSchema = z.object({ knockId: z.string().min(1).max(40) });
export const OfficeChatSchema = z.object({ text: z.string().min(1).max(400) });
/**
 * office-occupancy payload: `occupants` (staff inside, as before) plus, additively, `visitors` (people let in) and
 * `queue` (open knocks). Counts only, never who.
 */
export const OfficeOccupancySchema = z.object({
  office: OfficeIdSchema,
  occupants: z.number().int().nonnegative(),
  visitors: z.number().int().nonnegative().optional(),
  queue: z.number().int().nonnegative().optional(),
});
export type OfficeOccupancy = z.infer<typeof OfficeOccupancySchema>;

/* ---------------- seats (P2-ADM-04) ---------------- */

/**
 * Administrative Block seats (hall "admin"), validated by the realtime server (positions: apps/web admin-block/plan.ts):
 *  - `lobby-{n}`: sofa, armchairs and waiting benches (anyone);
 *  - `{office}-officer`: the chair behind the desk (a holder of that office's role who is inside);
 *  - `{office}-visitor-{n}`: the visitor chairs facing the desk (people inside that office);
 *  - `{office}-meeting-{n}`: the meeting-table chairs (people inside that office).
 * An office takes as many visitors (people let in) as it has visitor chairs.
 */
export const ADMIN_LOBBY_SEATS = 11;
export const OFFICE_VISITOR_SEATS = 3;
export const OFFICE_MEETING_SEATS = 4;
export const OFFICE_CAPACITY = OFFICE_VISITOR_SEATS;
export type AdminSeat =
  | { kind: "lobby"; n: number }
  | { kind: "officer"; office: SeedOfficeId }
  | { kind: "visitor" | "meeting"; office: SeedOfficeId; n: number };
const SEED_IDS = new Set<string>(SEED_OFFICES.map((o) => o.id));
const ADMIN_SEAT = /^(?:lobby-(\d{1,2})|([a-z-]{3,24}?)-(officer|visitor|meeting)(?:-(\d))?)$/;

/** Parses an Administrative Block seat id (null: not one). */
export function parseAdminSeat(id: unknown): AdminSeat | null {
  if (typeof id !== "string" || id.length > 40) return null;
  const m = ADMIN_SEAT.exec(id);
  if (!m) return null;
  if (m[1] !== undefined) {
    const n = Number(m[1]);
    return n < ADMIN_LOBBY_SEATS && String(n) === m[1] ? { kind: "lobby", n } : null;
  }
  const office = m[2]!;
  if (!SEED_IDS.has(office)) return null;
  const kind = m[3] as "officer" | "visitor" | "meeting";
  if (kind === "officer") return m[4] === undefined ? { kind, office: office as SeedOfficeId } : null;
  if (m[4] === undefined) return null;
  const n = Number(m[4]);
  return n < (kind === "visitor" ? OFFICE_VISITOR_SEATS : OFFICE_MEETING_SEATS) ? { kind, office: office as SeedOfficeId, n } : null;
}
export const isAdminSeat = (id: unknown): id is string => parseAdminSeat(id) !== null;
/** every admin seat id (lobby first, then per office: officer, visitors, meeting chairs) */
export const ADMIN_SEAT_IDS: readonly string[] = [
  ...Array.from({ length: ADMIN_LOBBY_SEATS }, (_, n) => `lobby-${n}`),
  ...SEED_OFFICES.flatMap((o) => [
    `${o.id}-officer`,
    ...Array.from({ length: OFFICE_VISITOR_SEATS }, (_, n) => `${o.id}-visitor-${n}`),
    ...Array.from({ length: OFFICE_MEETING_SEATS }, (_, n) => `${o.id}-meeting-${n}`),
  ]),
];

/* ---------------- reception (P2-ADM-04): POST /admin-block/reception ---------------- */

/** One chat turn with the reception assistant. History is the last few turns, held by the client (nothing is stored). */
export const ReceptionTurnSchema = z.object({ role: z.enum(["visitor", "reception"]), text: z.string().min(1).max(800) });
export const ReceptionRequestSchema = z.object({
  message: z.string().trim().min(1).max(300),
  history: z.array(ReceptionTurnSchema).max(8).default([]),
});
export type ReceptionRequest = z.infer<typeof ReceptionRequestSchema>;
export const ReceptionReplySchema = z.object({
  reply: z.string().min(1).max(800),
  /** quick follow-up chips */
  suggestions: z.array(z.string().max(60)).max(4).optional(),
  /** "Take me there": the office the reply is about */
  officeHint: OfficeIdSchema.optional(),
  /** who answered: the model, or the built-in rules (no key / slow / failed) */
  source: z.enum(["model", "rules"]),
});
export type ReceptionReply = z.infer<typeof ReceptionReplySchema>;
