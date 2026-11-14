"use client";
import type {
  Building,
  BuildingId,
  ConsoleOverview,
  ConsoleReport,
  ConsoleSection,
  ConsoleUser,
  PresenceTotals,
  ReportStatus,
  Sanction,
  SanctionInput,
  SessionSummary,
  StaffNote,
  UserStatus,
} from "@gukirana/contracts";
import { api } from "@/lib/session";

/** Staff console API (apps/api modules/console). Every call carries the player's access token; the server checks roles. */
export interface AuditRow {
  id: string;
  who: string;
  action: string;
  target: string;
  detail: string | null;
  at: string;
  /** the row in plain words (server-side names: usernames, building / office / role names) */
  whoName?: string;
  targetName?: string;
  detailText?: string | null;
}
export interface UserDetail {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  hasEmail?: boolean;
  hasPhone?: boolean;
  level: number;
  xp: number;
  status: string;
  kycTier: number;
  createdAt: string;
  lastSeenAt?: string | null;
  deletedAt?: string | null;
  openReports?: number;
  mutedUntil?: string | null;
  roles: { role: string; grantedBy: string | null; grantedAt: string }[];
  stars: number;
  coins: number;
  history: { id: string; who: string; action: string; detail: string | null; at: string; whoName?: string; detailText?: string | null }[];
  sanctions?: Sanction[];
  notes?: StaffNote[];
  sessions?: SessionSummary[];
}
export interface RoleRow {
  id: string;
  name: string;
  description: string;
  allOffices: boolean;
  offices: string[];
  holders?: number;
}
export interface FinanceReport {
  days: number;
  summary: { from: string; to: string; byCurrency: Record<string, { revenue: number; starsIssued: number; dailyClaims: number; escrowOutstanding: number; playerBalances: number; matchesSettled: number }> };
  daily: { day: string; currency: string; type: string; entries: number; revenue: number; volume: number }[];
  reconciliation: Record<string, unknown>;
}
/** People-list filters (empty = any) */
export interface PeopleFilter {
  q: string;
  status: "" | "active" | "suspended" | "deleted";
  role: string;
  minLevel: string;
  maxLevel: string;
  joinedFrom: string;
  joinedTo: string;
  /** "" | "7" | "30" (seen within) | "-30" (not seen for) */
  seen: string;
}
export const NO_FILTER: PeopleFilter = { q: "", status: "", role: "", minLevel: "", maxLevel: "", joinedFrom: "", joinedTo: "", seen: "" };

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const qs = (f: Partial<PeopleFilter> & { page?: number }) =>
  Object.entries(f)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", ...json(body) });

export const consoleApi = {
  me: () => api<{ roles: string[]; sections: ConsoleSection[] }>("/console/me"),
  overview: () => api<ConsoleOverview>("/console/overview"),
  users: (f: Partial<PeopleFilter>, page: number) => api<{ items: ConsoleUser[]; page: number; more: boolean }>(`/console/users?${qs({ ...f, page })}`),
  exportUsers: (f: Partial<PeopleFilter>) => api<{ csv: string; rows: number; truncated: boolean; filename: string }>(`/console/users/export?${qs(f)}`),
  user: (id: string) => api<UserDetail>(`/console/users/${id}`),
  setStatus: (id: string, status: UserStatus, reason: string) => post<{ id: string; status: UserStatus; changed: boolean }>(`/console/users/${id}/status`, { status, reason }),
  sanction: (id: string, s: SanctionInput) => post<{ id: string; kind: string; endsAt: string | null; status: string }>(`/console/users/${id}/sanctions`, s),
  lift: (id: string, kind: "mute" | "suspend", reason: string) => post<{ changed: boolean; status: string }>(`/console/users/${id}/lift`, { kind, reason }),
  note: (id: string, body: string) => post<StaffNote>(`/console/users/${id}/notes`, { body }),
  signOut: (id: string, reason: string) => post<{ signedOut: number }>(`/console/users/${id}/sign-out`, { reason }),
  resetUsername: (id: string, reason: string) => post<{ username: string }>(`/console/users/${id}/reset-username`, { reason }),
  reveal: (id: string, field: "email" | "phone", reason: string) => post<{ field: string; value: string | null }>(`/console/users/${id}/reveal`, { field, reason }),
  deleteAccount: (id: string, confirm: string, reason: string) => post<{ status: string }>(`/console/users/${id}/delete`, { confirm, reason }),
  reports: (status: ReportStatus, page = 0) => api<{ items: ConsoleReport[]; page: number; more: boolean; open: number }>(`/console/reports?status=${status}&page=${page}`),
  resolveReport: (id: string, outcome: "resolved" | "dismissed", note: string) => post<{ status: string }>(`/console/reports/${id}/resolve`, { outcome, note }),
  buildings: () => api<Building[]>("/console/buildings"),
  setBuilding: (id: BuildingId, open: boolean, message: string) => api<Building>(`/console/buildings/${id}`, { method: "PUT", ...json({ open, message }) }),
  presence: () => api<PresenceTotals>("/console/presence"),
  audit: (q: string) => api<AuditRow[]>(`/console/audit?limit=150&q=${encodeURIComponent(q)}`),
  finance: (days: number) => api<FinanceReport>(`/console/finance?days=${days}`),
  roles: () => api<RoleRow[]>("/admin/access/roles"),
  grant: (user: string, role: string, reason?: string) => post<{ changed: boolean }>("/admin/access/grant", { user, role, ...(reason ? { reason } : {}) }),
  revoke: (user: string, role: string, reason?: string) => post<{ changed: boolean }>("/admin/access/revoke", { user, role, ...(reason ? { reason } : {}) }),
};

/** save text as a file on this device (CSV export) */
export function download(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** API error → short plain words */
export function errText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    ROLE_REQUIRED: "Your role does not allow this.",
    SUPER_ADMIN_PROTECTED: "Only a Super Admin can change a Super Admin's account.",
    STAFF_PROTECTED: "This person is staff. Only a Super Admin can act on a staff account.",
    CANNOT_CHANGE_SELF: "You can't do this to your own account.",
    UNKNOWN_USER: "No account matches.",
    USER_NOT_FOUND: "No account matches.",
    UNKNOWN_REPORT: "That report no longer exists.",
    REPORT_CLOSED: "Someone already closed this report.",
    CANNOT_REVOKE_OWN_SUPER_ADMIN: "You can't remove your own Super Admin role. Ask another Super Admin.",
    LAST_SUPER_ADMIN: "This is the last active Super Admin. Make someone else Super Admin first.",
    ACCOUNT_DELETED: "This account was deleted. Nothing more can be changed.",
    ACCOUNT_NOT_ACTIVE: "This account is suspended or deleted, so it can't be given a role.",
    CONFIRM_MISMATCH: "The name you typed doesn't match. Type the username exactly.",
    STAFF_ROLES_HELD: "Remove this person's staff roles first.",
    BALANCE_NOT_ZERO: "This account still holds coins. They must be cashed out before it can be deleted.",
    REASON_REQUIRED: "Please give a reason.",
    RATE_LIMITED: "Too many changes in a short time. Wait a minute and try again.",
    TRY_AGAIN: "That didn't work this time. Please try again.",
    BAD_ID: "That account id doesn't look right.",
    ACCOUNT_INACTIVE: "Your account is suspended. Contact support.",
    SESSION_REVOKED: "You were signed out. Please sign in again.",
    VALIDATION_ERROR: "Please check the fields: something is missing or too long.",
    VALIDATION: "Please check the fields: something is missing or too long.",
  };
  return map[code] ?? "Something went wrong. Please try again.";
}
