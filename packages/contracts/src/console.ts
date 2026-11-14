import { z } from "zod";

/**
 * Staff admin console (P2-CON-01): opened from the office computer (full screen) or at /console.
 * Sections are granted by role; the API enforces the same map on every endpoint (RoleGuard + RequireRole).
 */
export const CONSOLE_SECTIONS = ["overview", "visitors", "users", "reports", "buildings", "monitor", "roles", "finance"] as const;
export type ConsoleSection = (typeof CONSOLE_SECTIONS)[number];

/** every staff role that may open the console at all */
export const STAFF_ROLES = ["super_admin", "it_admin", "accountant", "support_agent", "event_manager"] as const;

/** who may use each section (super_admin may use everything) */
export const SECTION_ROLES: Record<ConsoleSection, readonly string[]> = {
  overview: STAFF_ROLES,
  visitors: STAFF_ROLES,
  users: ["super_admin", "it_admin", "support_agent"],
  reports: ["super_admin", "it_admin", "support_agent"],
  buildings: ["super_admin", "it_admin"],
  monitor: ["super_admin", "it_admin"],
  roles: ["super_admin"],
  finance: ["super_admin", "accountant"],
};
/** may change a player's account status (suspend / reactivate) */
export const USER_STATUS_ROLES = ["super_admin", "it_admin", "support_agent"] as const;

export function sectionsFor(roles: readonly string[]): ConsoleSection[] {
  return CONSOLE_SECTIONS.filter((s) => SECTION_ROLES[s].some((r) => roles.includes(r)));
}

export const UserStatusSchema = z.enum(["active", "suspended"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;
/** every status an account can be in (deleted = anonymised, kept for the ledger) */
export const AccountStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Account management (P2-CON-02): sanctions with reasons + expiry, staff notes, sessions, username reset, deletion,
// search / export, reports queue. Every staff mutation takes a reason, is rate limited and audited.
// ---------------------------------------------------------------------------------------------------------------

export const REASON_MIN = 3;
export const REASON_MAX = 200;
/** a staff reason: kept in the account history and the audit trail */
export const ReasonSchema = z.string().trim().min(REASON_MIN, "REASON_TOO_SHORT").max(REASON_MAX, "REASON_TOO_LONG");
export const SetUserStatusSchema = z.object({ status: UserStatusSchema, reason: ReasonSchema });

/** who may export the people list (masked CSV) */
export const EXPORT_ROLES = ["super_admin", "it_admin"] as const;
/** who may delete (anonymise) an account or reveal a full contact */
export const SUPER_ONLY = ["super_admin"] as const;

export const SANCTION_KINDS = ["warn", "mute", "suspend"] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];
/** longest mute (30 days) and longest timed suspension (365 days), in hours */
export const MUTE_MAX_HOURS = 24 * 30;
export const SUSPEND_MAX_HOURS = 24 * 365;
/** the durations the console offers (hours; null = until lifted) */
export const MUTE_CHOICES = [1, 6, 24, 72, 168] as const;
export const SUSPEND_CHOICES = [24, 72, 168, 720, null] as const;

/**
 * warn: a recorded warning (the player is told, if online). mute: no chat or private messages for `hours`.
 * suspend: no sign-in or play for `hours`, or until lifted when `hours` is null.
 */
export const SanctionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("warn"), reason: ReasonSchema }),
  z.object({ kind: z.literal("mute"), reason: ReasonSchema, hours: z.number().int().min(1).max(MUTE_MAX_HOURS) }),
  z.object({ kind: z.literal("suspend"), reason: ReasonSchema, hours: z.number().int().min(1).max(SUSPEND_MAX_HOURS).nullable() }),
]);
export type SanctionInput = z.infer<typeof SanctionSchema>;
/** lift the mute or suspension in force, early */
export const LiftSanctionSchema = z.object({ kind: z.enum(["mute", "suspend"]), reason: ReasonSchema });
export const ReasonOnlySchema = z.object({ reason: ReasonSchema });
export const NOTE_MAX = 1000;
export const StaffNoteSchema = z.object({ body: z.string().trim().min(REASON_MIN, "NOTE_TOO_SHORT").max(NOTE_MAX, "NOTE_TOO_LONG") });
/** delete + anonymise: the operator types the account's current username (or DELETE when it has none) */
export const DeleteAccountSchema = z.object({ reason: ReasonSchema, confirm: z.string().trim().min(1).max(40) });

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "BAD_DATE");
const intQ = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const opt = <T extends z.ZodTypeAny>(t: T) => z.union([z.literal("").transform(() => undefined), t]).optional();
/** GET /console/users query (all optional; empty strings mean "any") */
export const UserSearchSchema = z
  .object({
    q: z.string().trim().max(60).optional(),
    status: opt(AccountStatusSchema),
    role: opt(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "BAD_ROLE")),
    minLevel: opt(intQ(1, 999)),
    maxLevel: opt(intQ(1, 999)),
    joinedFrom: opt(isoDay),
    joinedTo: opt(isoDay),
    /** seen in the last N days; negative N = not seen for N days (or never) */
    seen: opt(intQ(-365, 365)),
    page: opt(intQ(0, 400)),
  })
  .refine((v) => v.minLevel === undefined || v.maxLevel === undefined || v.minLevel <= v.maxLevel, { message: "LEVEL_RANGE", path: ["maxLevel"] })
  .refine((v) => !v.joinedFrom || !v.joinedTo || v.joinedFrom <= v.joinedTo, { message: "DATE_RANGE", path: ["joinedTo"] });
export type UserSearch = z.infer<typeof UserSearchSchema>;
/** most rows one CSV export may hold */
export const EXPORT_MAX_ROWS = 5000;

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const ReportStatusQuerySchema = z.enum(REPORT_STATUSES).default("open");
export const ResolveReportSchema = z.object({ outcome: z.enum(["resolved", "dismissed"]), note: ReasonSchema });

export interface Sanction {
  id: string;
  kind: SanctionKind;
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  endsAt: string | null;
  liftedAt: string | null;
  liftedByName: string | null;
  liftReason: string | null;
  /** still in force now */
  active: boolean;
}
export interface StaffNote {
  id: string;
  body: string;
  createdByName: string;
  createdAt: string;
}
/** a sign-in on one device (no token, no address): for "active sessions" */
export interface SessionSummary {
  id: string;
  device: string;
  createdAt: string;
  expiresAt: string;
}
export interface ConsoleReport {
  id: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reporter: { id: string; username: string | null };
  target: { id: string; username: string | null; status: string };
  /** where it happened + recent chat lines (as sent by the reporter's client) */
  context: unknown;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  /** open reports about the same person (this one included) */
  openAgainstTarget: number;
}

export const BuildingIdSchema = z.enum(["pool", "ludo", "igisoro", "arena", "admin"]);
export type BuildingId = z.infer<typeof BuildingIdSchema>;
export const SEED_BUILDINGS: { id: BuildingId; name: string }[] = [
  { id: "pool", name: "Pool Hall" },
  { id: "ludo", name: "Ludo Lounge" },
  { id: "igisoro", name: "Igisoro Court" },
  { id: "arena", name: "Tournament Arena" },
  { id: "admin", name: "Administrative Block" },
];
export const SetBuildingSchema = z.object({ open: z.boolean(), message: z.string().trim().max(120).default("") });

export interface Building {
  id: BuildingId;
  name: string;
  open: boolean;
  message: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ConsoleUser {
  id: string;
  username: string | null;
  email: string | null; // masked
  phone: string | null; // masked
  level: number;
  status: string;
  createdAt: string;
  roles: string[];
  /** last sign-in / token refresh (P2-CON-02; null = not since the column existed) */
  lastSeenAt?: string | null;
  /** muted until (ISO) while a chat mute is in force */
  mutedUntil?: string | null;
}

export interface PresenceTotals {
  total: number;
  signedIn: number;
  /** "plaza" | "hall:pool" | "hall:ludo" | "hall:igisoro" | "hall:admin" | "hall:arena" → people */
  byArea: Record<string, number>;
}

export interface ConsoleOverview {
  users: { total: number; newToday: number; suspended: number; openReports?: number } | null;
  online: PresenceTotals;
  offices: Record<string, number>;
  buildings: Building[];
  /** whoName / targetName / detailText: the same row in plain words (FIX-A GAP-016; additive) */
  audit: { id: string; who: string; action: string; target: string; detail: string | null; at: string; whoName?: string; targetName?: string; detailText?: string | null }[] | null;
  /** today (Kigali day): platform fees in Stars and coins, matches settled, Stars issued */
  finance: { feesStars: number; feesCoins: number; matchesSettled: number; starsIssued: number } | null;
}

/** realtime → API: people in one world room (POST /internal/presence) */
export const PresenceReportSchema = z.object({
  room: z.string().min(1).max(80),
  area: z.string().min(1).max(40),
  count: z.number().int().min(0).max(100_000),
  signedIn: z.number().int().min(0).max(100_000),
});
