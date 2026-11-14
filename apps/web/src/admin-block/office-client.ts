"use client";
import { create } from "zustand";
import { KNOCK_TTL_MS, MyRolesSchema, OfficeEvt, OfficeMsg, OfficeSummarySchema, SEED_OFFICES, type MyRoles, type OfficeRefusal, type OfficeSummary } from "@gukirana/contracts";
import { api, useSession } from "@/lib/session";
import { onRoomMessage, roomSend } from "@/lib/realtime";
import { uiAudio } from "@/lib/audio";

/**
 * Administrative Block client adapter (P2-ADM-02), against the contract in @gukirana/contracts `offices.ts`:
 *
 *   loadOffices()            GET /admin-block/offices → OfficeSummary[]   GET /me/roles → MyRoles
 *                            (404 / offline / signed out → the seeded directory, no roles: everyone knocks)
 *   bindOffices()            listen to office-admitted / -knocking / -knock / -refused / -occupancy on the hall room
 *   enterOffice(id)          office-enter (role holders are admitted at once, everyone else knocks)
 *   answerKnock(knockId, ok) office-answer (staff inside: Let in / Decline)
 *   leaveOffice(id)          office-leave (stepped back out into the corridor)
 *
 * Messages go through the hall room connection of game "admin" (lib/realtime connectPlaza → onRoomMessage /
 * roomSend). Countdowns run on this device's clock (re-based on the server's `expiresInMs`). The server is the
 * authority; the client only gates its own walking (admin-block/doors.ts).
 */

export type RefuseReason = OfficeRefusal;
export interface Knocking {
  office: string;
  knockId: string | null;
  /** local clock (Date.now) */
  expiresAt: number;
  /** the server confirmed the knock (office-knocking) */
  acked: boolean;
}
export interface IncomingKnock {
  office: string;
  knockId: string;
  from: { id: string; name: string; level?: number };
  expiresAt: number;
}
export interface Refusal {
  office: string;
  reason: RefuseReason;
  at: number;
}

interface OfficeState {
  offices: OfficeSummary[];
  roles: MyRoles;
  /** where the directory came from */
  source: "api" | "seed";
  loaded: boolean;
  /** staff inside per office from office-occupancy (realtime); absent = unknown */
  occupancy: Record<string, number>;
  /** people seen inside each office right now (positions of the people in this hall; a fallback for the lamps) */
  presence: Record<string, number>;
  /** the office whose door opens for you (role, or let in) */
  admitted: string | null;
  /** you are inside this office */
  inside: string | null;
  /** asked to enter as a role holder, waiting for office-admitted */
  entering: string | null;
  knocking: Knocking | null;
  refused: Refusal | null;
  incoming: IncomingKnock[];
  /** standing at this office's door (corridor side) */
  atDoor: string | null;
  /** walking to this office (picker) */
  goingTo: string | null;
  /** a knock (door rattle + sound) to play at this office: { office, at } */
  knockFx: { office: string; at: number } | null;
  set: (p: Partial<Omit<OfficeState, "set">>) => void;
}

const seedOffices = (): OfficeSummary[] => SEED_OFFICES.map((o) => ({ id: o.id, name: o.name, description: o.description, canEnter: false, occupants: 0 }));

export const useOffices = create<OfficeState>()((set) => ({
  offices: seedOffices(),
  roles: { roles: [], offices: [] },
  source: "seed",
  loaded: false,
  occupancy: {},
  presence: {},
  admitted: null,
  inside: null,
  entering: null,
  knocking: null,
  refused: null,
  incoming: [],
  atDoor: null,
  goingTo: null,
  knockFx: null,
  set,
}));

/** May I walk straight in? (the directory's flag, or one of my roles' offices) */
export function canEnter(id: string): boolean {
  const s = useOffices.getState();
  return !!s.offices.find((o) => o.id === id)?.canEnter || s.roles.offices.includes(id);
}
/** staff inside: the server's count when known, else the people seen inside */
export function occupantsOf(id: string, s = useOffices.getState()): number {
  const o = s.offices.find((x) => x.id === id);
  return s.occupancy[id] ?? Math.max(o?.occupants ?? 0, s.presence[id] ?? 0);
}

/* ---------------- API ---------------- */

const OfficeList = OfficeSummarySchema.array();

export async function loadOffices(): Promise<void> {
  const authed = useSession.getState().status === "authenticated";
  const [offices, roles] = await Promise.all([
    authed
      ? api<unknown>("/admin-block/offices")
          .then((r) => OfficeList.parse(Array.isArray(r) ? r : (r as { offices?: unknown }).offices))
          .catch(() => null)
      : Promise.resolve(null),
    authed
      ? api<unknown>("/me/roles")
          .then((r) => MyRolesSchema.parse(r))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const r = roles ?? { roles: [], offices: [] };
  // backend not there yet (404) / offline: the seeded directory, nobody may walk in
  const list = (offices && offices.length ? offices : seedOffices()).map((o) => ({ ...o, canEnter: o.canEnter || r.offices.includes(o.id) }));
  useOffices.setState({ offices: list, roles: r, source: offices ? "api" : "seed", loaded: true });
}

/* ---------------- realtime ---------------- */

/** no office-knocking / office-admitted from the server within this time: it does not run the office protocol */
const SERVER_SILENT_MS = 3500;
let silentTimer: ReturnType<typeof setTimeout> | null = null;
let expiryTimer: ReturnType<typeof setInterval> | null = null;

const clearSilent = () => {
  if (silentTimer) clearTimeout(silentTimer);
  silentTimer = null;
};

function refuse(office: string, reason: RefuseReason) {
  clearSilent();
  useOffices.setState({ knocking: null, entering: null, refused: { office, reason, at: Date.now() } });
}

type AdmittedMsg = { office: string; via?: "role" | "invite" };
type KnockingMsg = { office: string; knockId: string; expiresInMs?: number };
type KnockMsg = { office: string; knockId: string; from: { id: string; name: string; level?: number }; expiresInMs?: number };
type RefusedMsg = { office: string; knockId?: string; reason: RefuseReason };
type OccupancyMsg = { office: string; occupants: number };

export const handlers = {
  [OfficeEvt.admitted]: (m: AdmittedMsg) => {
    clearSilent();
    useOffices.setState({ admitted: m.office, entering: null, knocking: null, refused: null });
  },
  [OfficeEvt.knocking]: (m: KnockingMsg) => {
    clearSilent();
    useOffices.setState({ knocking: { office: m.office, knockId: m.knockId, expiresAt: Date.now() + (m.expiresInMs ?? KNOCK_TTL_MS), acked: true } });
  },
  [OfficeEvt.knock]: (m: KnockMsg) => {
    const k: IncomingKnock = { office: m.office, knockId: m.knockId, from: m.from, expiresAt: Date.now() + (m.expiresInMs ?? KNOCK_TTL_MS) };
    useOffices.setState((s) => ({ incoming: [...s.incoming.filter((x) => x.knockId !== k.knockId), k] }));
    knockSound(0.6);
  },
  [OfficeEvt.refused]: (m: RefusedMsg) => {
    const s = useOffices.getState();
    // a closed knock at someone else's door (we let them in / it expired): drop it from our toasts
    if (m.knockId && s.incoming.some((x) => x.knockId === m.knockId)) useOffices.setState({ incoming: s.incoming.filter((x) => x.knockId !== m.knockId) });
    if (s.knocking && (s.knocking.office === m.office || s.knocking.knockId === m.knockId)) refuse(m.office, m.reason);
    else if (s.entering === m.office) refuse(m.office, m.reason);
  },
  [OfficeEvt.occupancy]: (m: OccupancyMsg) => useOffices.setState((s) => ({ occupancy: { ...s.occupancy, [m.office]: m.occupants } })),
} as const;

/** Start listening (the admin hall is on screen). Returns the unbind. */
export function bindOffices(): () => void {
  const offs = Object.entries(handlers).map(([type, fn]) => onRoomMessage(type, fn as (m: unknown) => void));
  // countdowns on the local clock: my knock and the knocks at my door expire here too (the server says so as well)
  expiryTimer = setInterval(() => {
    const s = useOffices.getState();
    const now = Date.now();
    if (s.knocking && now > s.knocking.expiresAt) refuse(s.knocking.office, "EXPIRED");
    if (s.incoming.some((k) => now > k.expiresAt)) useOffices.setState({ incoming: s.incoming.filter((k) => now <= k.expiresAt) });
    if (s.refused && now - s.refused.at > 6000) useOffices.setState({ refused: null });
  }, 250);
  return () => {
    offs.forEach((f) => f());
    if (expiryTimer) clearInterval(expiryTimer);
    expiryTimer = null;
    clearSilent();
    useOffices.setState({ admitted: null, inside: null, entering: null, knocking: null, refused: null, incoming: [], atDoor: null, goingTo: null, occupancy: {}, presence: {} });
  };
}

/**
 * At an office door: role holders ask to enter (the door opens on office-admitted), everyone else knocks (the knock
 * plays here at once; the answer comes from someone inside). Without a server that runs the office protocol (not
 * deployed yet / offline), role holders are let in on their API role and a knock reads "Nobody inside".
 */
export function enterOffice(id: string): void {
  const s = useOffices.getState();
  if (s.admitted === id || s.entering === id || s.knocking?.office === id) return;
  const staff = canEnter(id);
  const sent = roomSend(OfficeMsg.enter, { office: id });
  clearSilent();
  if (staff) {
    useOffices.setState({ entering: id, refused: null });
    silentTimer = setTimeout(() => {
      if (useOffices.getState().entering === id) useOffices.setState({ entering: null, admitted: id }); // the API says this is your office
    }, sent ? SERVER_SILENT_MS : 300);
    return;
  }
  useOffices.setState({ knocking: { office: id, knockId: null, expiresAt: Date.now() + KNOCK_TTL_MS, acked: false }, refused: null, knockFx: { office: id, at: performance.now() } });
  knockSound(1);
  silentTimer = setTimeout(() => {
    const k = useOffices.getState().knocking;
    if (k && k.office === id && !k.acked) refuse(id, "NOBODY_INSIDE");
  }, SERVER_SILENT_MS);
}

/** Stop waiting at the door (the server lets the knock expire). */
export function cancelKnock(): void {
  clearSilent();
  useOffices.setState({ knocking: null });
}

export function answerKnock(knockId: string, allow: boolean): void {
  roomSend(OfficeMsg.answer, { knockId, allow });
  useOffices.setState((s) => ({ incoming: s.incoming.filter((k) => k.knockId !== knockId) }));
}

export function leaveOffice(id: string): void {
  roomSend(OfficeMsg.leave, { office: id });
  useOffices.setState((s) => ({ inside: s.inside === id ? null : s.inside, admitted: s.admitted === id ? null : s.admitted }));
}

/* ---------------- knock sound: three soft knuckle raps on a timber door (WebAudio, no asset) ---------------- */

export function knockSound(gain = 1): void {
  try {
    const ctx = uiAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [0, 0.21, 0.42].forEach((dt, i) => {
      const t = t0 + dt;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(190 - i * 6, t);
      osc.frequency.exponentialRampToValueAtTime(95, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 * gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      // the knuckle click on the timber face
      const click = ctx.createOscillator();
      click.type = "triangle";
      click.frequency.setValueAtTime(1400, t);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.03 * gain, t + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      osc.connect(g).connect(ctx.destination);
      click.connect(cg).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
      click.start(t);
      click.stop(t + 0.03);
    });
  } catch {
    /* audio unavailable: silent knock */
  }
}

// QA hook (dev, or a production build with NEXT_PUBLIC_GK_QA=1): drive the protocol without a server
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined")
  Object.assign(window as unknown as Record<string, unknown>, {
    __gkOffice: { store: useOffices, emit: (type: keyof typeof handlers, m: unknown) => (handlers[type] as (x: unknown) => void)(m) },
  });
