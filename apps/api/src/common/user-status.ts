import { eq, users } from "@gukirana/db";
import type { Db } from "./db.module.js";

/**
 * Account state for every authenticated request (GAP-001, P2-CON-02). Access tokens live 15 minutes, so a suspension
 * or a staff "sign out everywhere" must not wait for them to expire: AuthGuard and RoleGuard ask here on each request.
 * The answer is cached per user for STATUS_CACHE_MS to keep the hot path at about one primary-key lookup per user per
 * 10 s; every staff change drops the entry (forgetUserStatus), so on this API process it is effective on the very next
 * request, and on any other instance within 10 s.
 */
export const STATUS_CACHE_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface State {
  active: boolean;
  /** access tokens issued before this (ms) are refused */
  revokedAt: number | null;
  at: number;
}
const cache = new Map<string, State>();

async function stateOf(db: Db, userId: string, now: number): Promise<State> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < STATUS_CACHE_MS) return hit;
  const [row] = await db.select({ status: users.status, revokedAt: users.sessionsRevokedAt }).from(users).where(eq(users.id, userId));
  const s: State = { active: row?.status === "active", revokedAt: row?.revokedAt ? row.revokedAt.getTime() : null, at: now };
  cache.set(userId, s);
  if (cache.size > 20_000) for (const [k, v] of cache) if (now - v.at >= STATUS_CACHE_MS) cache.delete(k);
  return s;
}

/** true only for an existing account whose status is `active` */
export async function isActiveUser(db: Db, userId: string, now = Date.now()): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  return (await stateOf(db, userId, now)).active;
}

/**
 * The access token (issued at `iat`, JWT seconds) was issued before a staff "sign out everywhere". `iat` has whole
 * seconds, so a token from the same second as the revoke is refused too (the player signs in again either way).
 */
export function issuedBeforeRevoke(iat: number | undefined, revokedAt: number | null): boolean {
  if (revokedAt === null) return false;
  if (typeof iat !== "number") return true;
  return iat < Math.ceil(revokedAt / 1000);
}

/** ACCOUNT_INACTIVE | SESSION_REVOKED | null (fine) for a verified access token */
export async function tokenRefusal(db: Db, userId: string, iat: number | undefined, now = Date.now()): Promise<"ACCOUNT_INACTIVE" | "SESSION_REVOKED" | null> {
  if (!UUID.test(userId)) return "ACCOUNT_INACTIVE";
  const s = await stateOf(db, userId, now);
  if (!s.active) return "ACCOUNT_INACTIVE";
  if (issuedBeforeRevoke(iat, s.revokedAt)) return "SESSION_REVOKED";
  return null;
}

/** a status / session change: the next request reads the database again */
export function forgetUserStatus(userId: string): void {
  cache.delete(userId);
}
