"use client";
import type { Building, BuildingId, ConsoleOverview, ConsoleSection, ConsoleUser, PresenceTotals, UserStatus } from "@gukirana/contracts";
import { api } from "@/lib/session";

/** Staff console API (apps/api modules/console). Every call carries the player's access token; the server checks roles. */
export interface AuditRow {
  id: string;
  who: string;
  action: string;
  target: string;
  detail: string | null;
  at: string;
}
export interface UserDetail {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  level: number;
  xp: number;
  status: string;
  kycTier: number;
  createdAt: string;
  roles: { role: string; grantedBy: string | null; grantedAt: string }[];
  stars: number;
  coins: number;
  history: { id: string; who: string; action: string; detail: string | null; at: string }[];
}
export interface RoleRow {
  id: string;
  name: string;
  description: string;
  allOffices: boolean;
  offices: string[];
}
export interface FinanceReport {
  days: number;
  summary: { from: string; to: string; byCurrency: Record<string, { revenue: number; starsIssued: number; dailyClaims: number; escrowOutstanding: number; playerBalances: number; matchesSettled: number }> };
  daily: { day: string; currency: string; type: string; entries: number; revenue: number; volume: number }[];
  reconciliation: Record<string, unknown>;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { "content-type": "application/json" } });

export const consoleApi = {
  me: () => api<{ roles: string[]; sections: ConsoleSection[] }>("/console/me"),
  overview: () => api<ConsoleOverview>("/console/overview"),
  users: (q: string, status: "" | UserStatus, page: number) =>
    api<{ items: ConsoleUser[]; page: number; more: boolean }>(`/console/users?q=${encodeURIComponent(q)}&status=${status}&page=${page}`),
  user: (id: string) => api<UserDetail>(`/console/users/${id}`),
  setStatus: (id: string, status: UserStatus, reason: string) =>
    api<{ id: string; status: UserStatus; changed: boolean }>(`/console/users/${id}/status`, { method: "POST", ...json({ status, reason }) }),
  buildings: () => api<Building[]>("/console/buildings"),
  setBuilding: (id: BuildingId, open: boolean, message: string) => api<Building>(`/console/buildings/${id}`, { method: "PUT", ...json({ open, message }) }),
  presence: () => api<PresenceTotals>("/console/presence"),
  audit: (q: string) => api<AuditRow[]>(`/console/audit?limit=150&q=${encodeURIComponent(q)}`),
  finance: (days: number) => api<FinanceReport>(`/console/finance?days=${days}`),
  roles: () => api<RoleRow[]>("/admin/access/roles"),
  grant: (user: string, role: string) => api<unknown>("/admin/access/grant", { method: "POST", ...json({ user, role }) }),
  revoke: (user: string, role: string) => api<unknown>("/admin/access/revoke", { method: "POST", ...json({ user, role }) }),
};

/** API error → short plain words */
export function errText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    ROLE_REQUIRED: "Your role does not allow this.",
    SUPER_ADMIN_PROTECTED: "Only a Super Admin can change a Super Admin's account.",
    CANNOT_CHANGE_SELF: "You can't change your own account status.",
    UNKNOWN_USER: "No account matches.",
    USER_NOT_FOUND: "No account matches.",
    VALIDATION: "Please check the fields.",
  };
  return map[code] ?? "Something went wrong. Please try again.";
}
