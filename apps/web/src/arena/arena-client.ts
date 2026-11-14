"use client";
import { create } from "zustand";
import { ArenaEvt, ArenaMsg, ArenaStatusSchema, arenaSeatZone, isValidArenaSeat, type ArenaDenial, type ArenaStatus } from "@gukirana/contracts";
import { api, ApiError, useSession } from "@/lib/session";
import { onRoomMessage, roomSend } from "@/lib/realtime";
import { useRoom } from "@/rooms/room-store";
import { useWorld } from "@/lib/world-store";
import { arenaGate } from "./flags";
import { mockClaim, mockForced, mockStatus } from "./arena-mock";

/**
 * Tournament Arena client (P2-ARN-03): the door / pass / seat flow, mirroring the server's checks so the person gets
 * a plain answer at once — the server (API + realtime hall room "arena") always has the final say.
 *
 *   GET  /arena/status                 → status (door, current / next event, my pass, may I claim)
 *   POST /arena/events/:id/pass        → { pass } | 403 { denial }
 *   realtime  arena-sit { seat } / arena-stand  →  arena-seated { seat } | arena-denied { action, reason }
 *             arena-event (refresh), arena-occupancy, arena-removed { reason } (walk out to the plaza)
 *
 * While the API answers 404 for /arena/* (backend not deployed yet), the MOCK in arena-mock.ts stands in (`mock`).
 */
interface ArenaState {
  status: ArenaStatus | null;
  loading: boolean;
  /** the API has no arena endpoints yet: everything below is the local mock */
  mock: boolean;
  claiming: boolean;
  /** last refusal shown to the person (plain words come from strings.ts DENIAL) */
  denied: { action: "enter" | "zone" | "sit" | "pass"; reason: ArenaDenial | "NO_ANSWER" } | null;
  /** walking to a seat's aisle (the seat request goes out on arrival) */
  walkingTo: string | null;
  /** seat requested, waiting for arena-seated */
  pending: string | null;
  /** removed by an admin (closed / barred): shown on the plaza after the walk out */
  removed: "ARENA_CLOSED" | "BARRED" | null;
  /** the event card is open */
  cardOpen: boolean;
  set: (p: Partial<Omit<ArenaState, "set">>) => void;
}
export const useArena = create<ArenaState>()((set) => ({
  status: null,
  loading: false,
  mock: false,
  claiming: false,
  denied: null,
  walkingTo: null,
  pending: null,
  removed: null,
  cardOpen: false,
  set,
}));

const me = () => {
  const s = useSession.getState();
  return { signedIn: s.status === "authenticated", level: s.me?.level ?? 1 };
};
/** 404 (route missing) or a network failure: the arena backend is not there yet */
const missing = (e: unknown) => (e instanceof ApiError && e.status === 404) || e instanceof TypeError;

function apply(st: ArenaStatus, mock: boolean) {
  arenaGate.canEnter = st.canEnter;
  arenaGate.checkedAt = performance.now();
  useArena.setState({ status: st, mock, loading: false });
}

let inflight: Promise<ArenaStatus | null> | null = null;
/** GET /arena/status (also refreshes the plaza door gate). */
export function fetchArenaStatus(): Promise<ArenaStatus | null> {
  if (inflight) return inflight;
  const run = (async () => {
    await Promise.resolve(); // never settle synchronously (the in-flight slot is cleared below)
    useArena.setState({ loading: true });
    try {
      if (mockForced()) throw new TypeError("arena mock forced (QA)");
      const raw = await api<unknown>("/arena/status");
      const st = ArenaStatusSchema.parse(raw);
      apply(st, false);
      return st;
    } catch (e) {
      if (missing(e) || useArena.getState().mock) {
        const st = mockStatus(me());
        apply(st, true);
        return st;
      }
      // the server answered with something else (5xx, bad shape): keep the last answer, doors as they were
      useArena.setState({ loading: false });
      return useArena.getState().status;
    }
  })();
  inflight = run;
  void run.finally(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/** POST /arena/events/:id/pass — claim a pass for the current event. */
export async function claimPass(eventId: string): Promise<boolean> {
  const st = useArena.getState();
  if (st.claiming) return false;
  useArena.setState({ claiming: true, denied: null });
  try {
    if (st.mock) {
      const r = mockClaim(eventId, me());
      if ("denial" in r) return void useArena.setState({ denied: { action: "pass", reason: r.denial } }), false;
      return true;
    }
    await api(`/arena/events/${encodeURIComponent(eventId)}/pass`, { method: "POST" });
    return true;
  } catch (e) {
    if (missing(e)) {
      useArena.setState({ mock: true });
      return claimPass(eventId);
    }
    const code = e instanceof ApiError ? e.code : "";
    useArena.setState({ denied: { action: "pass", reason: (code as ArenaDenial) || "NO_ANSWER" } });
    return false;
  } finally {
    useArena.setState({ claiming: false });
    void fetchArenaStatus();
  }
}

/** Client mirror of the seat rule: during an event a bowl seat needs a pass (a VIP seat a VIP pass). */
export function seatDenial(seat: string): ArenaDenial | null {
  const st = useArena.getState().status;
  if (!isValidArenaSeat(seat)) return "SEAT_TAKEN";
  if (!st) return null;
  if (!st.canEnter) return st.denial ?? "ARENA_CLOSED";
  if (!st.current) return null; // no event: free seating
  if (!st.pass) return "NO_PASS";
  if (arenaSeatZone(seat) === "vip" && st.pass.zone !== "vip") return "NO_PASS";
  return null;
}
/** May I walk onto the competition floor (participants and staff: a floor pass)? */
export const floorAllowed = () => useArena.getState().status?.pass?.zone === "floor";

let answerTimer: ReturnType<typeof setTimeout> | null = null;
/** Ask the server for a seat (you are standing in its aisle). */
export function requestSeat(seat: string) {
  const d = seatDenial(seat);
  if (d) return void useArena.setState({ denied: { action: "sit", reason: d }, walkingTo: null, cardOpen: d === "NO_PASS" });
  useArena.setState({ pending: seat, walkingTo: null, denied: null });
  if (answerTimer) clearTimeout(answerTimer);
  if (useArena.getState().mock || !roomSend(ArenaMsg.sit, { seat })) {
    // MOCK: the realtime room has no arena handlers yet → confirm locally
    answerTimer = setTimeout(() => onSeated({ seat }), 350);
    return;
  }
  answerTimer = setTimeout(() => {
    if (useArena.getState().pending === seat) useArena.setState({ pending: null, denied: { action: "sit", reason: "NO_ANSWER" } });
  }, 5000);
}

/** Leave the seat (hall hooks `stand`: RoomPlayer calls it when you walk off or tap Stand up). */
export function arenaStand() {
  useArena.setState({ pending: null });
  if (!useArena.getState().mock) roomSend(ArenaMsg.stand, {});
}
export function standFromSeat() {
  arenaStand();
  useRoom.getState().set({ seated: null });
}

function onSeated(m: { seat: string }) {
  if (answerTimer) clearTimeout(answerTimer);
  const { pending } = useArena.getState();
  if (pending && pending !== m.seat) return; // an older answer
  useArena.setState({ pending: null, denied: null });
  useRoom.getState().set({ seated: m.seat, nearSeat: null });
}

let bound = false;
/** Listen to the arena's realtime messages (once per session; the bindings follow every new room connection). */
export function bindArenaRealtime() {
  if (bound) return;
  bound = true;
  onRoomMessage<{ seat: string }>(ArenaEvt.seated, onSeated);
  onRoomMessage<{ action: "enter" | "zone" | "sit"; reason: ArenaDenial }>(ArenaEvt.denied, (m) => {
    if (answerTimer) clearTimeout(answerTimer);
    useArena.setState({ pending: null, walkingTo: null, denied: { action: m.action, reason: m.reason }, cardOpen: m.reason === "NO_PASS" });
    if (m.action === "sit" && useRoom.getState().seated) useRoom.getState().set({ seated: null });
  });
  // taken bowl seats (server list, no names): merged into the world seat map the seat finder / prompts read;
  // your own seat stays yours, everyone else's shows as taken
  onRoomMessage<{ taken: string[] }>(ArenaEvt.seats, (m) => {
    const w = useWorld.getState();
    const mine = useRoom.getState().seated;
    const next: Record<string, string> = {};
    for (const [id, who] of Object.entries(w.seats)) if (!isValidArenaSeat(id)) next[id] = who;
    for (const id of m.taken ?? []) if (isValidArenaSeat(id)) next[id] = id === mine && w.you ? w.you : "taken";
    w.set({ seats: next });
  });
  onRoomMessage<{ eventId: string; status: string }>(ArenaEvt.event, () => void fetchArenaStatus());
  onRoomMessage<{ concourse: number; seats: number }>(ArenaEvt.occupancy, (o) => {
    const st = useArena.getState().status;
    if (st) useArena.setState({ status: { ...st, occupancy: o } });
  });
  onRoomMessage<{ reason: "ARENA_CLOSED" | "BARRED" }>(ArenaEvt.removed, (m) => {
    arenaGate.canEnter = false;
    useArena.setState({ removed: m.reason, pending: null, walkingTo: null, cardOpen: false });
    // the person walks out through the door (RoomPlayer's Leave route + fail-safe), live, onto the plaza
    useRoom.getState().set({ leaving: true });
  });
}

// QA hook (dev, or a production build with NEXT_PUBLIC_GK_QA=1), like window.__gkOffice
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined")
  (window as unknown as { __gkArena: unknown }).__gkArena = { store: useArena, requestSeat };
