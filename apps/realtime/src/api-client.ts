import { loadEnv } from "@gukirana/config";
import type { SignedMatchResult } from "@gukirana/signing";
import type { ArenaRealtimeState, ArenaUserAccess } from "@gukirana/contracts";

const env = loadEnv();
const headers = { "content-type": "application/json", "x-internal-token": env.INTERNAL_SERVICE_TOKEN };

export interface CreatedMatch {
  matchId: string;
  players: { userId: string; seat: number; rating: number; name: string; color: string }[];
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${env.API_INTERNAL_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await r.json().catch(() => ({}))) as T & { message?: { code?: string }; code?: string };
  if (!r.ok) throw new Error(json?.message?.code ?? json?.code ?? `API_${r.status}`);
  return json;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${env.API_INTERNAL_URL}${path}`, { headers, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`API_${r.status}`);
  return (await r.json()) as T;
}

export interface UserAccess {
  roles: string[];
  /** offices the user may walk into */
  offices: string[];
  /** every office id that exists */
  known: string[];
}

export const api = {
  createMatch: (input: { game: string; variant: string; stake: number; players: { userId: string; seat: number }[] }) =>
    call<CreatedMatch>("/internal/matches", input),
  submitResult: (r: SignedMatchResult) =>
    call<{ status: string; pot?: number; ratings?: Record<string, number>; xp?: Record<string, number> }>(`/internal/matches/${r.matchId}/result`, r),
  voidMatch: (matchId: string) => call<{ status: string }>(`/internal/matches/${matchId}/void`, {}),
  /** Administrative Block: roles + enterable offices (cached briefly by social/office-access.ts) */
  access: (userId: string) => get<UserAccess>(`/internal/access/${encodeURIComponent(userId)}`),
  /** people in one world room, for the staff console's live monitor (P2-CON-01); best effort */
  reportPresence: async (room: string, area: string, count: number, signedIn: number) => {
    await fetch(`${env.API_INTERNAL_URL}/internal/presence`, { method: "POST", headers, body: JSON.stringify({ room, area, count, signedIn }), signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  },
  /** staff per office in one admin-block room (the API sums rooms for the reception directory) */
  reportOccupancy: async (room: string, offices: Record<string, number>) => {
    const r = await fetch(`${env.API_INTERNAL_URL}/internal/admin-block/occupancy`, { method: "POST", headers, body: JSON.stringify({ room, offices }), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`API_${r.status}`);
  },
  /** Tournament Arena (P2-ARN-02): building switch, current event, active bars — polled ~5 s by social/arena-access.ts */
  arenaState: () => get<ArenaRealtimeState>("/internal/arena/state"),
  arenaAccess: (userId: string, eventId?: string) =>
    get<ArenaUserAccess>(`/internal/arena/access/${encodeURIComponent(userId)}${eventId ? `?event=${encodeURIComponent(eventId)}` : ""}`),
  reportArena: async (room: string, p: { concourse: number; seats: number; inside: string[] }) => {
    const r = await fetch(`${env.API_INTERNAL_URL}/internal/arena/occupancy`, { method: "POST", headers, body: JSON.stringify({ room, ...p }), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`API_${r.status}`);
  },
};
