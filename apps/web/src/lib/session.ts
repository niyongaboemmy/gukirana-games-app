"use client";
import { create } from "zustand";
import { useProfile } from "./profile-store";

export interface Me {
  id: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  color: string;
  bodyType: "feminine" | "masculine" | "neutral";
  look: string | null;
  xp: number;
  level: number;
  stars: number;
  ratings: Record<string, { rating: number; games: number; wins: number }>;
}

interface SessionState {
  status: "loading" | "anonymous" | "authenticated";
  accessToken: string | null;
  me: Me | null;
}

export const useSession = create<SessionState>()(() => ({ status: "loading", accessToken: null, me: null }));

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function raw<T>(path: string, init: RequestInit = {}, token = useSession.getState().accessToken): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init,
    credentials: "include",
    // only declare JSON when there is a body (Fastify rejects empty JSON bodies)
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body?.message?.code ?? body?.code ?? body?.message ?? `HTTP_${r.status}`);
  return body as T;
}

let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= raw<{ accessToken: string }>("/auth/refresh", { method: "POST" }, null)
    .then(async ({ accessToken }) => {
      useSession.setState({ accessToken });
      await loadMe();
      return true;
    })
    .catch(() => {
      useSession.setState({ status: "anonymous", accessToken: null, me: null });
      return false;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Authenticated request with one transparent refresh on 401. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await raw<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && (await refreshSession())) return raw<T>(path, init);
    throw e;
  }
}

/** Mirrors the server profile into the local profile store used by the 3D world and HUD. */
function mirror(me: Me) {
  useProfile.setState({ name: me.username ?? "", color: me.color, xp: me.xp, stars: me.stars, onboarded: !!me.username });
}

export async function loadMe(): Promise<Me> {
  const me = await raw<Me>("/me");
  useSession.setState({ me, status: "authenticated" });
  mirror(me);
  return me;
}

/** identifier = phone number (e.g. 0788123456) or email */
export const requestOtp = (identifier: string) => raw<{ devCode?: string }>("/auth/otp/request", { method: "POST", body: JSON.stringify({ identifier }) }, null);

export async function verifyOtp(identifier: string, code: string): Promise<{ isNew: boolean }> {
  const r = await raw<{ accessToken: string; isNew: boolean }>("/auth/otp/verify", { method: "POST", body: JSON.stringify({ identifier, code }) }, null);
  useSession.setState({ accessToken: r.accessToken });
  await loadMe();
  return { isNew: r.isNew };
}

export async function updateMe(p: Partial<Pick<Me, "username" | "color" | "bodyType" | "look">>): Promise<Me> {
  const r = await api<Me & { accessToken: string }>("/me", { method: "PATCH", body: JSON.stringify(p) });
  useSession.setState({ accessToken: r.accessToken, me: r });
  mirror(r);
  return r;
}

export async function logout(): Promise<void> {
  await raw("/auth/logout", { method: "POST" }).catch(() => undefined);
  useSession.setState({ status: "anonymous", accessToken: null, me: null });
  useProfile.setState({ onboarded: false });
}

export const claimDailyStars = () => api<{ granted: number; stars: number }>("/wallet/daily-stars", { method: "POST" }).then((r) => {
  useProfile.setState({ stars: r.stars });
  return r;
});

export const reportPractice = (game: string, won: boolean) =>
  api<{ xp: number }>("/me/practice-result", { method: "POST", body: JSON.stringify({ game, won }) })
    .then(async (r) => {
      await loadMe();
      return r.xp;
    })
    .catch(() => 0);
