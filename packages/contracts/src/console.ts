import { z } from "zod";

/**
 * Staff admin console (P2-CON-01): opened from the office computer (full screen) or at /console.
 * Sections are granted by role; the API enforces the same map on every endpoint (RoleGuard + RequireRole).
 */
export const CONSOLE_SECTIONS = ["overview", "visitors", "users", "buildings", "monitor", "roles", "finance"] as const;
export type ConsoleSection = (typeof CONSOLE_SECTIONS)[number];

/** every staff role that may open the console at all */
export const STAFF_ROLES = ["super_admin", "it_admin", "accountant", "support_agent", "event_manager"] as const;

/** who may use each section (super_admin may use everything) */
export const SECTION_ROLES: Record<ConsoleSection, readonly string[]> = {
  overview: STAFF_ROLES,
  visitors: STAFF_ROLES,
  users: ["super_admin", "it_admin", "support_agent"],
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
export const SetUserStatusSchema = z.object({ status: UserStatusSchema, reason: z.string().trim().min(3).max(200) });

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
}

export interface PresenceTotals {
  total: number;
  signedIn: number;
  /** "plaza" | "hall:pool" | "hall:ludo" | "hall:igisoro" | "hall:admin" | "hall:arena" → people */
  byArea: Record<string, number>;
}

export interface ConsoleOverview {
  users: { total: number; newToday: number; suspended: number } | null;
  online: PresenceTotals;
  offices: Record<string, number>;
  buildings: Building[];
  audit: { id: string; who: string; action: string; target: string; detail: string | null; at: string }[] | null;
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
