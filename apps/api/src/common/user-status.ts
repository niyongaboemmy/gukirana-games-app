import { eq, users } from "@gukirana/db";
import type { Db } from "./db.module.js";

/**
 * Account status for every authenticated request (GAP-001). Access tokens live 15 minutes, so a suspension must not
 * wait for them to expire: AuthGuard asks here on each request. The answer is cached per user for STATUS_CACHE_MS to
 * keep the hot path at about one primary-key lookup per user per 10 s; ConsoleService.setStatus() drops the entry, so
 * on this API process a suspension is effective on the very next request, and on any other instance within 10 s.
 */
export const STATUS_CACHE_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map<string, { active: boolean; at: number }>();

/** true only for an existing account whose status is `active` */
export async function isActiveUser(db: Db, userId: string, now = Date.now()): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  const hit = cache.get(userId);
  if (hit && now - hit.at < STATUS_CACHE_MS) return hit.active;
  const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  const active = row?.status === "active";
  cache.set(userId, { active, at: now });
  if (cache.size > 20_000) for (const [k, v] of cache) if (now - v.at >= STATUS_CACHE_MS) cache.delete(k);
  return active;
}

/** a status change: the next request reads the database again */
export function forgetUserStatus(userId: string): void {
  cache.delete(userId);
}
