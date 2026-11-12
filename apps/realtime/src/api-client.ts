import { loadEnv } from "@gukirana/config";
import type { SignedMatchResult } from "@gukirana/signing";

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

export const api = {
  createMatch: (input: { game: string; variant: string; stake: number; players: { userId: string; seat: number }[] }) =>
    call<CreatedMatch>("/internal/matches", input),
  submitResult: (r: SignedMatchResult) =>
    call<{ status: string; pot?: number; ratings?: Record<string, number>; xp?: Record<string, number> }>(`/internal/matches/${r.matchId}/result`, r),
  voidMatch: (matchId: string) => call<{ status: string }>(`/internal/matches/${matchId}/void`, {}),
};
