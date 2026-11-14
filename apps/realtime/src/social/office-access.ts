import { KNOCK_TTL_MS, OFFICER_LEFT_GRACE_MS } from "@gukirana/contracts";
import { api, type UserAccess } from "../api-client.js";

/** Role changes in the back office reach the doors within this time (no re-login). */
export const ACCESS_CACHE_MS = 15_000;
const ERROR_CACHE_MS = 2_000;
const NONE: UserAccess = { roles: [], offices: [], known: [] };

type Source = (userId: string) => Promise<UserAccess>;
/** staff per office, and (P2-ADM-04) visitors let in per office — counts only */
type Reporter = (room: string, offices: Record<string, number>, visitors?: Record<string, number>) => Promise<void>;

/** Tunables (tests shorten them). */
export const officeConfig = {
  knockTtlMs: KNOCK_TTL_MS,
  /** one knock per door per this many ms (per session) */
  knockGapMs: 5_000,
  /** open knocks per session */
  maxOpenKnocks: 3,
  /** occupancy heartbeat to the API */
  reportMs: 30_000,
  /** visitors left alone in an office are walked out after this (GAP-013) */
  officerLeftGraceMs: OFFICER_LEFT_GRACE_MS,
};

let source: Source = (uid) => api.access(uid);
let reporter: Reporter = (room, offices, visitors) => api.reportOccupancy(room, offices, visitors);
const cache = new Map<string, { at: number; ttl: number; p: Promise<UserAccess> }>();

/**
 * A user's roles + enterable offices, fetched from the API (x-internal-token) and cached for ACCESS_CACHE_MS.
 * An API error means "no access" (doors stay shut) and is retried after 2 s.
 */
export function accessOf(userId: string, now = Date.now()): Promise<UserAccess> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < hit.ttl) return hit.p;
  const entry = { at: now, ttl: ACCESS_CACHE_MS, p: NONE as unknown as Promise<UserAccess> };
  entry.p = source(userId).catch(() => {
    entry.ttl = ERROR_CACHE_MS;
    return NONE;
  });
  cache.set(userId, entry);
  if (cache.size > 5_000) for (const [k, v] of cache) if (now - v.at >= v.ttl) cache.delete(k);
  return entry.p;
}

export function reportOccupancy(room: string, offices: Record<string, number>, visitors?: Record<string, number>): void {
  void reporter(room, offices, visitors).catch(() => undefined); // best effort: the reception count is informational
}

/** test hooks */
export function setAccessSource(s: Source): void {
  source = s;
  cache.clear();
}
export function setOccupancyReporter(r: Reporter): void {
  reporter = r;
}
export function clearAccessCache(): void {
  cache.clear();
}
/** one account's cached roles (a suspension or a role change must not wait for the cache) */
export function forgetAccess(userId: string): void {
  cache.delete(userId);
}
