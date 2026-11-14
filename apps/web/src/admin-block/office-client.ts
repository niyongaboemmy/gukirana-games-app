"use client";
import { create } from "zustand";
import {
  KNOCK_TTL_MS,
  MyRolesSchema,
  OfficeEvt,
  OfficeEvtV2,
  OfficeEvtV3,
  OfficeMsg,
  OfficeMsgV2,
  OfficeSummarySchema,
  SEED_OFFICES,
  type KnockOutcome,
  type MyRoles,
  type OfficeAnswerAction,
  type OfficeRefusal,
  type OfficeSummary,
  type WaitReason,
} from "@gukirana/contracts";
import { api, useSession } from "@/lib/session";
import { onRoomMessage, roomSend } from "@/lib/realtime";
import { uiAudio } from "@/lib/audio";

/**
 * Administrative Block client adapter (P2-ADM-02 / P2-ADM-04), against the contract in @gukirana/contracts `offices.ts`:
 *
 *   loadOffices()                GET /admin-block/offices → OfficeSummary[]   GET /me/roles → MyRoles
 *                                (404 / offline / signed out → the seeded directory, no roles: everyone knocks)
 *   bindOffices()                office-admitted / -knocking / -knock / -refused / -occupancy, and (v2) office-wait /
 *                                -knock-closed / -members / -chat on the hall room
 *   enterOffice(id)              office-enter (role holders are admitted at once, everyone else knocks)
 *   answerKnock(knockId, act)    office-answer { action: allow | wait | decline } (staff inside)
 *   cancelKnock()                office-cancel (stop waiting: the knock is withdrawn, staff prompts close)
 *   leaveOffice(id)              office-leave (stepped back out into the corridor)
 *   sendOfficeChat(text)         office-chat (the people inside the same office only)
 *
 * Messages go through the hall room connection of game "admin" (lib/realtime onRoomMessage / roomSend). Countdowns
 * run on this device's clock (re-based on the server's `expiresInMs`). The server is the authority; the client only
 * gates its own walking (admin-block/doors.ts).
 */

export type RefuseReason = OfficeRefusal;
export interface Knocking {
  office: string;
  knockId: string | null;
  /** local clock (Date.now) */
  expiresAt: number;
  /** the server confirmed the knock (office-knocking) */
  acked: boolean;
  /** staff asked you to wait, or the office is full: you stay in the queue (sit in the lobby meanwhile) */
  wait: WaitReason | null;
}
export interface IncomingKnock {
  office: string;
  knockId: string;
  from: { id: string; name: string; level?: number };
  expiresAt: number;
  /** "waiting": someone answered Please wait (or the office was full) */
  status: "new" | "waiting";
  /** every visitor chair is taken (Let in keeps them waiting) */
  full: boolean;
  /** first seen (local clock): the queue is shown oldest first */
  since: number;
}
export interface Refusal {
  office: string;
  reason: RefuseReason;
  at: number;
}
export interface OfficeMember {
  id: string;
  name: string;
  staff: boolean;
}
export interface OfficeChatLine {
  id: string;
  name: string;
  color: string;
  text: string;
  t: number;
}

interface OfficeState {
  offices: OfficeSummary[];
  roles: MyRoles;
  /** where the directory came from */
  source: "api" | "seed";
  loaded: boolean;
  /** staff inside per office from office-occupancy (realtime); absent = unknown */
  occupancy: Record<string, number>;
  /** visitors let in, and open knocks, per office (office-occupancy v2 fields; counts only) */
  visitors: Record<string, number>;
  queue: Record<string, number>;
  /** people seen inside each office right now (positions of the people in this hall; a fallback for the lamps) */
  presence: Record<string, number>;
  /** the office whose door opens for you (role, or let in) */
  admitted: string | null;
  /** how you were admitted */
  via: "role" | "invite" | null;
  /** you are inside this office */
  inside: string | null;
  /** asked to enter as a role holder, waiting for office-admitted */
  entering: string | null;
  knocking: Knocking | null;
  refused: Refusal | null;
  incoming: IncomingKnock[];
  /** the people in your office's conversation (yourself included); empty outside an office */
  members: OfficeMember[];
  /** office text chat (this visit only; cleared when you leave the office) */
  chat: OfficeChatLine[];
  /** standing at this office's door (corridor side) */
  atDoor: string | null;
  /** walking to this office (picker / reception "Take me there") */
  goingTo: string | null;
  /** standing at the reception counter (Talk to reception) */
  atReception: boolean;
  /** a knock (door rattle + sound) to play at this office: { office, at } */
  knockFx: { office: string; at: number } | null;
  /** the last staff member left the office you are visiting: you are shown back to the lobby at `until` (local clock) */
  alone: { office: string; until: number } | null;
  /** the server took you out of this office (nobody came back): walk out to the lobby (doors.ts does the walking) */
  walkOut: string | null;
  set: (p: Partial<Omit<OfficeState, "set">>) => void;
}

const seedOffices = (): OfficeSummary[] => SEED_OFFICES.map((o) => ({ id: o.id, name: o.name, description: o.description, canEnter: false, occupants: 0 }));

export const useOffices = create<OfficeState>()((set) => ({
  offices: seedOffices(),
  roles: { roles: [], offices: [] },
  source: "seed",
  loaded: false,
  occupancy: {},
  visitors: {},
  queue: {},
  presence: {},
  admitted: null,
  via: null,
  inside: null,
  entering: null,
  knocking: null,
  refused: null,
  incoming: [],
  members: [],
  chat: [],
  atDoor: null,
  goingTo: null,
  atReception: false,
  knockFx: null,
  alone: null,
  walkOut: null,
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
export const visitorsOf = (id: string, s = useOffices.getState()) => s.visitors[id] ?? 0;
export const queueOf = (id: string, s = useOffices.getState()) => s.queue[id] ?? 0;

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
type KnockMsg = { office: string; knockId: string; from: { id: string; name: string; level?: number }; expiresInMs?: number; status?: "new" | "waiting"; full?: boolean };
type RefusedMsg = { office: string; knockId?: string; reason: RefuseReason };
type OccupancyMsg = { office: string; occupants: number; visitors?: number; queue?: number };
type WaitMsg = { office: string; knockId: string; expiresInMs?: number; reason?: WaitReason };
type ClosedMsg = { office: string; knockId: string; outcome?: KnockOutcome };
type MembersMsg = { office: string; members: OfficeMember[] };
type ChatMsg = { office: string } & OfficeChatLine;
type AloneMsg = { office: string; graceMs?: number };

const dropIncoming = (knockId: string) => useOffices.setState((s) => ({ incoming: s.incoming.filter((x) => x.knockId !== knockId) }));

export const handlers = {
  [OfficeEvt.admitted]: (m: AdmittedMsg) => {
    clearSilent();
    useOffices.setState({ admitted: m.office, via: m.via ?? null, entering: null, knocking: null, refused: null });
  },
  [OfficeEvt.knocking]: (m: KnockingMsg) => {
    clearSilent();
    const prev = useOffices.getState().knocking;
    const wait = prev && prev.knockId === m.knockId ? prev.wait : null;
    useOffices.setState({ knocking: { office: m.office, knockId: m.knockId, expiresAt: Date.now() + (m.expiresInMs ?? KNOCK_TTL_MS), acked: true, wait } });
  },
  [OfficeEvt.knock]: (m: KnockMsg) => {
    const s = useOffices.getState();
    const old = s.incoming.find((x) => x.knockId === m.knockId);
    const k: IncomingKnock = {
      office: m.office,
      knockId: m.knockId,
      from: m.from,
      expiresAt: Date.now() + (m.expiresInMs ?? KNOCK_TTL_MS),
      status: m.status ?? "new",
      full: !!m.full,
      since: old?.since ?? Date.now(),
    };
    useOffices.setState({ incoming: [...s.incoming.filter((x) => x.knockId !== k.knockId), k].sort((a, b) => a.since - b.since) });
    if (!old) knockSound(0.6);
  },
  [OfficeEvt.refused]: (m: RefusedMsg) => {
    const s = useOffices.getState();
    // a closed knock at someone else's door (we let them in / it expired): drop it from our queue
    if (m.knockId && s.incoming.some((x) => x.knockId === m.knockId)) dropIncoming(m.knockId);
    if (s.knocking && (s.knocking.office === m.office || s.knocking.knockId === m.knockId)) refuse(m.office, m.reason);
    else if (s.entering === m.office) refuse(m.office, m.reason);
  },
  [OfficeEvt.occupancy]: (m: OccupancyMsg) =>
    useOffices.setState((s) => ({
      occupancy: { ...s.occupancy, [m.office]: m.occupants },
      ...(m.visitors !== undefined ? { visitors: { ...s.visitors, [m.office]: m.visitors } } : {}),
      ...(m.queue !== undefined ? { queue: { ...s.queue, [m.office]: m.queue } } : {}),
    })),
  [OfficeEvtV2.wait]: (m: WaitMsg) => {
    clearSilent();
    useOffices.setState({ knocking: { office: m.office, knockId: m.knockId, expiresAt: Date.now() + (m.expiresInMs ?? KNOCK_TTL_MS), acked: true, wait: m.reason ?? "ASKED" }, refused: null });
  },
  [OfficeEvtV2.knockClosed]: (m: ClosedMsg) => dropIncoming(m.knockId),
  [OfficeEvtV2.members]: (m: MembersMsg) => {
    const s = useOffices.getState();
    if (!m.members.length) {
      if (!s.inside || s.inside === m.office) useOffices.setState({ members: [] });
      return;
    }
    useOffices.setState({ members: m.members });
  },
  [OfficeEvtV2.chat]: (m: ChatMsg) =>
    useOffices.setState((s) => ({ chat: [...s.chat, { id: m.id, name: m.name, color: m.color, text: m.text, t: m.t }].slice(-60) })),
  // GAP-013: the officer left while you visit; after the grace time the server shows you out (walk to the lobby)
  [OfficeEvtV3.officerLeft]: (m: AloneMsg) => useOffices.setState({ alone: { office: m.office, until: Date.now() + (m.graceMs ?? 60_000) } }),
  [OfficeEvtV3.officerBack]: (m: AloneMsg) => useOffices.setState((s) => (s.alone?.office === m.office ? { alone: null } : {})),
  [OfficeEvtV3.walkOut]: (m: AloneMsg) => useOffices.setState({ alone: null, walkOut: m.office, members: [], chat: [] }),
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
    useOffices.setState({
      admitted: null,
      via: null,
      inside: null,
      entering: null,
      knocking: null,
      refused: null,
      incoming: [],
      members: [],
      chat: [],
      atDoor: null,
      goingTo: null,
      atReception: false,
      alone: null,
      walkOut: null,
      occupancy: {},
      visitors: {},
      queue: {},
      presence: {},
    });
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
      if (useOffices.getState().entering === id) useOffices.setState({ entering: null, admitted: id, via: "role" }); // the API says this is your office
    }, sent ? SERVER_SILENT_MS : 300);
    return;
  }
  useOffices.setState({ knocking: { office: id, knockId: null, expiresAt: Date.now() + KNOCK_TTL_MS, acked: false, wait: null }, refused: null, knockFx: { office: id, at: performance.now() } });
  knockSound(1);
  silentTimer = setTimeout(() => {
    const k = useOffices.getState().knocking;
    if (k && k.office === id && !k.acked) refuse(id, "NOBODY_INSIDE");
  }, SERVER_SILENT_MS);
}

/** Stop waiting at the door: the knock is withdrawn (the staff's prompt closes). */
export function cancelKnock(): void {
  clearSilent();
  const k = useOffices.getState().knocking;
  if (k?.knockId) roomSend(OfficeMsgV2.cancel, { knockId: k.knockId });
  useOffices.setState({ knocking: null });
}

/** Staff inside: Let in / Please wait / Decline. A waiting knock stays in the queue (shown as waiting). */
export function answerKnock(knockId: string, action: OfficeAnswerAction | boolean): void {
  const a: OfficeAnswerAction = typeof action === "boolean" ? (action ? "allow" : "decline") : action;
  // `allow` keeps older servers working; `action` carries the full choice
  roomSend(OfficeMsg.answer, { knockId, action: a, allow: a === "allow" });
  if (a === "wait") useOffices.setState((s) => ({ incoming: s.incoming.map((k) => (k.knockId === knockId ? { ...k, status: "waiting" as const } : k)) }));
  else if (!(a === "allow" && useOffices.getState().incoming.find((k) => k.knockId === knockId)?.full)) dropIncoming(knockId);
}

export function leaveOffice(id: string): void {
  roomSend(OfficeMsg.leave, { office: id });
  useOffices.setState((s) => ({
    inside: s.inside === id ? null : s.inside,
    admitted: s.admitted === id ? null : s.admitted,
    via: s.admitted === id ? null : s.via,
    members: s.inside === id ? [] : s.members,
    chat: s.inside === id ? [] : s.chat,
    incoming: s.incoming.filter((k) => k.office !== id),
  }));
}

export function sendOfficeChat(text: string): boolean {
  const t = text.trim().slice(0, 400);
  if (!t || !useOffices.getState().inside) return false;
  return roomSend(OfficeMsgV2.chat, { text: t });
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
