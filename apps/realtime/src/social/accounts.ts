import { createLogger } from "@gukirana/observability";
import { api, type Eligibility, type SuspensionFeed } from "../api-client.js";
import { forgetAccess } from "./office-access.js";
import { forgetArenaAccess } from "./arena-access.js";

const log = createLogger("accounts");

/**
 * Account state in realtime (GAP-001 / GAP-011).
 *
 *  - Every world / match session of a signed-in account registers a `close` callback here (`trackAccount`).
 *  - `startSuspensionWatch()` polls the API's suspension feed (GET /internal/suspensions, the console's audit trail)
 *    about once a second; a suspended account's sessions are closed at once and its cached office / arena access is
 *    dropped. Polling (like the arena state poll) keeps the API free of any realtime address and survives restarts of
 *    either side; the worst case between "Suspend" and the closed connection is one poll interval plus one request.
 *  - The same feed carries staff sign-outs (sessions closed; access tokens issued before it are refused at join),
 *    chat mutes (until when; `mutedUntil()` is asked by chat / DM), lifted mutes and warnings (told to the player's
 *    open sessions). The first poll also lists every mute in force, so a restarted realtime knows who is muted (P2-CON-02).
 *  - `eligibilityOf()` asks the API whether a player may be put into a match at a stake (join checks, challenge /
 *    quick-match pre-checks). An unreachable API never locks people out here: the answer is "ok" and the API checks
 *    again when the match is created (stakes are only ever locked there).
 */
export const accountConfig = {
  /** suspension feed poll */
  pollMs: 1_000,
};

type Close = () => void;
/** a message to one tracked session (warnings, mutes) */
type Notify = (type: string, msg: Record<string, unknown>) => void;
type FeedSource = (since: string | null) => Promise<SuspensionFeed>;
type EligibilitySource = (userId: string, stake: number) => Promise<Eligibility>;

let feedSource: FeedSource = (since) => api.suspensions(since);
let eligibilitySource: EligibilitySource = (u, s) => api.eligibility(u, s);

const sessions = new Map<string, Set<Close>>();
const notifiers = new Map<Close, Notify>();
/** userId -> muted until (ms) */
const mutes = new Map<string, number>();
/** userId -> staff sign-out time (ms): access tokens issued before it may not join */
const revoked = new Map<string, number>();
/** feed event ids already handled (the feed overlaps by a couple of seconds) → when handled */
const handled = new Map<string, number>();
let cursor: string | null = null;

/** Register a live session of `userId`; returns the unregister function (call it when the session ends). */
export function trackAccount(userId: string, close: Close, notify?: Notify): () => void {
  let set = sessions.get(userId);
  if (!set) sessions.set(userId, (set = new Set()));
  set.add(close);
  if (notify) notifiers.set(close, notify);
  return () => {
    notifiers.delete(close);
    const s = sessions.get(userId);
    if (!s) return;
    s.delete(close);
    if (!s.size) sessions.delete(userId);
  };
}

/** muted until (ms since epoch) while a staff chat mute is in force, else null */
export function mutedUntil(userId: string, now = Date.now()): number | null {
  const t = mutes.get(userId);
  if (t === undefined) return null;
  if (t <= now) {
    mutes.delete(userId);
    return null;
  }
  return t;
}

/** an access token issued at `iat` (JWT seconds) predates a staff sign-out of this account */
export function signedOutSince(userId: string, iat: number | undefined): boolean {
  const t = revoked.get(userId);
  if (t === undefined) return false;
  return typeof iat !== "number" || iat < Math.ceil(t / 1000);
}

function tell(userId: string, type: string, msg: Record<string, unknown>): void {
  for (const close of sessions.get(userId) ?? []) {
    try {
      notifiers.get(close)?.(type, msg);
    } catch {
      /* the session is going away */
    }
  }
}

/** Close every session of `userId` in this process (suspension). Returns how many were closed. */
export function closeAccount(userId: string): number {
  forgetAccess(userId);
  forgetArenaAccess(userId);
  const set = sessions.get(userId);
  if (!set) return 0;
  sessions.delete(userId);
  let n = 0;
  for (const close of set) {
    notifiers.delete(close);
    try {
      close();
      n++;
    } catch (e) {
      log.warn({ err: String(e), userId }, "closing a session failed");
    }
  }
  return n;
}

/** One poll of the suspension feed; returns the accounts closed now. */
export async function pollSuspensions(now = Date.now()): Promise<string[]> {
  const r = await feedSource(cursor);
  cursor = r.cursor;
  for (const m of r.mutes ?? []) {
    const t = Date.parse(m.until);
    if (Number.isFinite(t) && t > now) mutes.set(m.userId, t);
  }
  const out: string[] = [];
  for (const e of r.events) {
    if (handled.has(e.id)) continue;
    handled.set(e.id, now);
    const kind = e.kind ?? "suspend";
    if (kind === "mute") {
      const t = Date.parse(e.until ?? "");
      if (Number.isFinite(t)) {
        mutes.set(e.userId, t);
        tell(e.userId, "account-muted", { until: t });
      }
      continue;
    }
    if (kind === "unmute") {
      mutes.delete(e.userId);
      tell(e.userId, "account-unmuted", {});
      continue;
    }
    if (kind === "warn") {
      tell(e.userId, "account-warning", { reason: String(e.reason ?? "").slice(0, 200) });
      continue;
    }
    if (kind === "signout") {
      const t = Date.parse(e.at);
      revoked.set(e.userId, Number.isFinite(t) ? t : now);
    }
    closeAccount(e.userId);
    out.push(e.userId);
  }
  // sign-outs matter only while the old access tokens live (15 min)
  for (const [u, t] of revoked) if (now - t > 16 * 60_000) revoked.delete(u);
  for (const [id, at] of handled) if (now - at > 60_000) handled.delete(id);
  if (out.length) log.info({ users: out.length }, "suspended accounts disconnected");
  return out;
}

/** Start polling (index.ts). Returns the stop function. */
export function startSuspensionWatch(): () => void {
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    pollSuspensions()
      .catch(() => undefined) // API unreachable: the next poll resumes from the same cursor
      .finally(() => (busy = false));
  }, accountConfig.pollMs);
  t.unref?.();
  return () => clearInterval(t);
}

/** May `userId` be put into a match at `stake`? (fail-open on API errors; the API re-checks at match creation) */
export async function eligibilityOf(userId: string, stake = 0): Promise<Eligibility> {
  try {
    return await eligibilitySource(userId, stake);
  } catch {
    return { ok: true };
  }
}

/** Reasons that keep a player out of a match / the world (anything else, e.g. an unknown id, is left to the API). */
export const isRefusal = (e: Eligibility): e is Eligibility & { reason: string } =>
  !e.ok && !!e.reason && ["ACCOUNT_INACTIVE", "ON_A_BREAK", "DAILY_LIMIT_REACHED", "INSUFFICIENT_FUNDS"].includes(e.reason);

/** test hooks */
export function setAccountSources(s: { feed?: FeedSource; eligibility?: EligibilitySource }): void {
  if (s.feed) feedSource = s.feed;
  if (s.eligibility) eligibilitySource = s.eligibility;
}
export function resetAccounts(): void {
  sessions.clear();
  notifiers.clear();
  handled.clear();
  mutes.clear();
  revoked.clear();
  cursor = null;
}
