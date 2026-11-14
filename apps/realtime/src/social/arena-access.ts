import type { ArenaRealtimeState, ArenaUserAccess } from "@gukirana/contracts";
import { api } from "../api-client.js";

/** Tunables (tests shorten them). */
export const arenaConfig = {
  /** state poll: how fast a close / bar / event change reaches people inside */
  statePollMs: 5_000,
  /** per-user access cache (pass, roles); a NO_PASS answer re-fetches once */
  accessCacheMs: 10_000,
  /** API unreachable: keep the last good state this long, then treat the arena as closed */
  staleStateMs: 30_000,
  /** time between arena-removed / an entry refusal and the server dropping the client */
  removeGraceMs: 1_500,
  /** zone / sit / stand per session per window */
  actionMax: 6,
  actionWindowMs: 3_000,
  /** occupancy heartbeat to the API */
  reportMs: 10_000,
};

const CLOSED: ArenaRealtimeState = { open: false, maxConcourse: 50, current: null, barred: [] };
const NONE: ArenaUserAccess = { open: false, barred: false, pass: null, roles: [], level: 0 };

type StateSource = () => Promise<ArenaRealtimeState>;
type AccessSource = (userId: string, eventId?: string) => Promise<ArenaUserAccess>;
type Reporter = (room: string, p: { concourse: number; seats: number; inside: string[] }) => Promise<void>;

let stateSource: StateSource = () => api.arenaState();
let accessSource: AccessSource = (u, e) => api.arenaAccess(u, e);
let reporter: Reporter = (room, p) => api.reportArena(room, p);

let state: { at: number; p: Promise<ArenaRealtimeState> } | null = null;
let lastGood: { at: number; s: ArenaRealtimeState } | null = null;
const access = new Map<string, { at: number; ttl: number; p: Promise<ArenaUserAccess> }>();

/** Shared by every arena room of this process; fetched at most once per statePollMs (`fresh` forces a fetch). */
export function arenaState(fresh = false, now = Date.now()): Promise<ArenaRealtimeState> {
  if (!fresh && state && now - state.at < arenaConfig.statePollMs) return state.p;
  const p = stateSource()
    .then((s) => {
      lastGood = { at: Date.now(), s };
      return s;
    })
    .catch(() => (lastGood && Date.now() - lastGood.at < arenaConfig.staleStateMs ? lastGood.s : CLOSED));
  state = { at: now, p };
  return p;
}

/** A user's pass (for `eventId`), roles, bar flag; cached accessCacheMs. API errors mean "no access" for 2 s. */
export function arenaAccessOf(userId: string, eventId: string | undefined, fresh = false, now = Date.now()): Promise<ArenaUserAccess> {
  const key = `${userId}:${eventId ?? ""}`;
  const hit = access.get(key);
  if (!fresh && hit && now - hit.at < hit.ttl) return hit.p;
  const entry = { at: now, ttl: arenaConfig.accessCacheMs, p: Promise.resolve(NONE) };
  entry.p = accessSource(userId, eventId).catch(() => {
    entry.ttl = 2_000;
    return NONE;
  });
  access.set(key, entry);
  if (access.size > 5_000) for (const [k, v] of access) if (now - v.at >= v.ttl) access.delete(k);
  return entry.p;
}

export function reportArena(room: string, p: { concourse: number; seats: number; inside: string[] }): void {
  void reporter(room, p).catch(() => undefined); // informational (status counts, attendance)
}

/** test hooks */
export function setArenaSources(s: { state?: StateSource; access?: AccessSource; reporter?: Reporter }): void {
  if (s.state) stateSource = s.state;
  if (s.access) accessSource = s.access;
  if (s.reporter) reporter = s.reporter;
  clearArenaCache();
}
export function clearArenaCache(): void {
  state = null;
  lastGood = null;
  access.clear();
}
