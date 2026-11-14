"use client";
import { ACT } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { playEmote } from "@/lib/realtime";
import { nav } from "@/world/navigation";
import { hallHooks, walkQueue } from "@/rooms/hall-hooks";
import type { Rect } from "@/rooms/layouts";
import { useRoom } from "@/rooms/room-store";
import { getUp, sitDown } from "@/rooms/RoomPlayer";
import { useConsole } from "@/console/console-store";
import { voiceScope } from "@/voice/voice";
import { canEnter, enterOffice, leaveOffice, useOffices } from "./office-client";
import {
  ADMIN_SEATS,
  adminSeat,
  doorFront,
  doorInside,
  doorRect,
  FRONT_Z,
  OFFICE_PLANS,
  officeAt,
  officePlan,
  RECEPTION_TALK,
  RECEPTION_TALK_R,
  routeBetween,
  visitorApproach,
  zoneOf,
  type P,
} from "./plan";

/**
 * Office doors on the client (P2-ADM-02). Each door is a collider while closed; it swings open (into the office)
 * for you only once you are admitted (role, or let in), and visibly opens for anyone passing through it (people
 * inside are seen by everyone). The office interior is therefore reachable only when admitted (client-side gate;
 * the server enforces the same rule). Module state, advanced once per frame by the Administrative Block scene.
 */
export interface DoorAnim {
  /** 0 closed … 1 open (eased) */
  open: number;
}
export const doors: Record<string, DoorAnim> = Object.fromEntries(OFFICE_PLANS.map((o) => [o.id, { open: 0 }]));

/** the door counts as passable once it is this far open */
const PASSABLE = 0.62;
const OPEN_S = 1.0;
const CLOSE_S = 1.35;
/** within this distance of the door front you are "at the door" (Knock / Enter prompt) */
const AT_DOOR_R = 1.25;

const mine = (id: string) => {
  const s = useOffices.getState();
  return s.admitted === id || s.inside === id;
};

/** closed (or not yet open enough) doors you may not pass right now */
export function closedDoors(): Rect[] {
  const out: Rect[] = [];
  for (const o of OFFICE_PLANS) if (!(mine(o.id) && doors[o.id]!.open > PASSABLE)) out.push(doorRect(o));
  return out;
}

/** a tap inside an office you may not enter walks you to its door instead */
function tapTarget(p: P): P {
  const o = officeAt(p.x, p.z);
  if (o && !mine(o.id)) return doorFront(o);
  return p;
}

/**
 * Shown out of an office (GAP-013: the officer left and nobody came back): stand up, walk out through the door and
 * on to the reception counter in the lobby. The door stays passable until you are out (you are still "inside" for
 * the client until you cross the door line, which then sends office-leave as for any step out).
 */
export function walkToLobby(): void {
  if (useRoom.getState().seated) getUp();
  pendingSeat = null;
  pendingWalkIn = null;
  const legs = routeBetween({ x: selfPose.x, z: selfPose.z }, RECEPTION_TALK);
  nav.target = legs.shift() ?? null;
  nav.goal = null;
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
  walkQueue.legs = legs;
  useOffices.getState().set({ goingTo: null });
}

/** walk to an office door from anywhere in the block; the last short leg turns you to face the door */
export function goToOffice(id: string): void {
  const o = officePlan(id);
  if (!o) return;
  const s = useOffices.getState();
  const here = officeAt(selfPose.x, selfPose.z);
  if (here && here.id === id) return;
  const f = doorFront(o);
  const legs = [...routeBetween({ x: selfPose.x, z: selfPose.z }, { x: f.x, z: f.z + 0.6 }), f];
  nav.target = legs.shift() ?? null;
  nav.goal = null;
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
  walkQueue.legs = legs;
  suppressAuto = null;
  s.set({ goingTo: id, refused: null });
}

let pendingWalkIn: string | null = null;
let suppressAuto: string | null = null;
let lastAtDoor: string | null = null;

/** knock: the rattle + sound + a raised hand, then office-enter (the server routes the knock inside) */
export function knockAt(id: string): void {
  playEmote(ACT.point, undefined, 1500);
  enterOffice(id);
}

/** may this chair be offered to you? lobby: always; office chairs: only inside that office; the officer's chair: staff */
export function seatOk(id: string): boolean {
  const seat = adminSeat(id);
  if (!seat) return false;
  if (seat.kind === "lobby") return true;
  const s = useOffices.getState();
  if (s.inside !== seat.table) return false;
  return seat.kind !== "officer" || (s.via === "role" && canEnter(seat.table));
}

/** a person's office from where they stand (inside the office, past the door line) */
const officeOfPerson = (x: number, z: number) => (z < FRONT_Z - 0.3 ? officeAt(x, z)?.id ?? null : null);

/**
 * Voice in the block: an office is a closed room. Inside one you hear (and are heard by) only the people in its
 * conversation, at full level; in the lobby / corridor, the normal proximity voice, never through an office wall.
 */
function bindVoiceZones() {
  voiceScope.allow = (id) => {
    const s = useOffices.getState();
    if (s.inside) return s.members.some((m) => m.id === id);
    const p = useWorld.getState().players[id];
    return !!p && !officeOfPerson(p.x / 100, p.z / 100);
  };
  voiceScope.room = (id) => {
    const s = useOffices.getState();
    return !!s.inside && s.members.some((m) => m.id === id);
  };
}

/** Choose a free visitor chair in `office` (else a meeting chair), walk round the row and sit (after being let in). */
let pendingSeat: { office: string; seat: string | null; phase: "wait" | "walk" } | null = null;
export function guideToSeat(office: string): void {
  pendingSeat = { office, seat: null, phase: "wait" };
}
/** the free chair of that kind nearest to `near` */
function freeSeat(office: string, kind: "visitor" | "meeting", near: P = selfPose): string | null {
  const w = useWorld.getState();
  const free = ADMIN_SEATS.filter((x) => x.table === office && x.kind === kind && (!w.seats[x.id] || w.seats[x.id] === w.you));
  free.sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
  return free[0]?.id ?? null;
}

export function registerAdminHooks(): () => void {
  hallHooks.admin = { solids: closedDoors, route: routeBetween, tap: tapTarget, seatOk, frozen: () => useConsole.getState().open };
  bindVoiceZones();
  const unsub = useOffices.subscribe((s, prev) => {
    if (s.walkOut && s.walkOut !== prev.walkOut) {
      const office = s.walkOut;
      useOffices.setState({ walkOut: null });
      if (s.inside === office || s.admitted === office) {
        suppressAuto = office; // no automatic re-entry at that door
        walkToLobby();
      }
      return;
    }
    if (s.admitted && s.admitted !== prev.admitted) {
      // let in (or a role holder admitted) while standing at the door: walk on in once the door has swung open;
      // let in while waiting elsewhere (seated in the lobby): stand up and walk to the door first
      pendingWalkIn = s.admitted;
      const o = officePlan(s.admitted);
      if (o && Math.hypot(selfPose.x - o.cx, selfPose.z - FRONT_Z) > 2.4) {
        if (useRoom.getState().seated) getUp();
        goToOffice(s.admitted);
      }
      if (s.via === "invite") guideToSeat(s.admitted);
    }
  });
  return () => {
    unsub();
    delete hallHooks.admin;
    voiceScope.allow = null;
    voiceScope.room = null;
    pendingWalkIn = null;
    pendingSeat = null;
    suppressAuto = null;
    lastAtDoor = null;
    for (const d of Object.values(doors)) d.open = 0;
  };
}

/** Per frame (the block is on screen): door motion, inside / at-door tracking, the walk-in after admission. */
export function updateDoors(dt: number): void {
  const s = useOffices.getState();
  const players = useWorld.getState().players;
  for (const o of OFFICE_PLANS) {
    const d = doors[o.id]!;
    const dist = Math.hypot(selfPose.x - o.cx, selfPose.z - FRONT_Z);
    let want = mine(o.id) && dist < 2.6;
    if (!want)
      for (const id in players) {
        const p = players[id]!;
        // someone passing through the doorway (they were let in): the door opens for them, everyone sees it
        if (Math.abs(p.x / 100 - o.cx) < 0.85 && Math.abs(p.z / 100 - FRONT_Z) < 1.05) {
          want = true;
          break;
        }
      }
    d.open = Math.min(1, Math.max(0, d.open + (want ? dt / OPEN_S : -dt / CLOSE_S)));
  }

  // inside / stepped out
  const z = zoneOf(selfPose.x, selfPose.z);
  if (z.kind === "office" && selfPose.z < FRONT_Z - 0.35 && s.admitted === z.office.id && s.inside !== z.office.id) s.set({ inside: z.office.id });
  if (s.inside && (z.kind !== "office" || z.office.id !== s.inside) && selfPose.z > FRONT_Z + 0.35) {
    suppressAuto = s.inside; // you just stepped out: no automatic re-entry while you stand at the door
    leaveOffice(s.inside);
  }

  // at a door (corridor side)
  let at: string | null = null;
  if (z.kind === "corridor")
    for (const o of OFFICE_PLANS) {
      const f = doorFront(o);
      if (Math.hypot(selfPose.x - f.x, selfPose.z - f.z) < AT_DOOR_R) at = o.id;
    }
  if (at !== s.atDoor) s.set({ atDoor: at });
  if (at !== lastAtDoor) {
    if (!at) suppressAuto = null;
    // arrived at a door you hold a role for: ask to enter at once (the door opens on office-admitted)
    if (at && canEnter(at) && suppressAuto !== at && !s.inside) enterOffice(at);
    lastAtDoor = at;
  }
  if (s.goingTo && (at === s.goingTo || (!nav.target && !walkQueue.legs.length))) s.set({ goingTo: null });

  // admitted at the door: step in as soon as the door is open enough
  if (pendingWalkIn) {
    const o = officePlan(pendingWalkIn);
    if (!o || s.admitted !== pendingWalkIn) pendingWalkIn = null;
    else if (doors[o.id]!.open > PASSABLE + 0.08) {
      pendingWalkIn = null;
      if (Math.hypot(selfPose.x - o.cx, selfPose.z - FRONT_Z) < 3) {
        const inside = doorInside(o);
        nav.target = { x: o.cx, z: FRONT_Z - 0.2 };
        nav.goal = null;
        nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
        walkQueue.legs = [inside, { x: o.cx, z: inside.z - 1.0 }];
      }
    }
  }

  // let in: once inside and the walk-in is done, round the visitor row to a free chair and sit down
  if (pendingSeat) {
    const ps = pendingSeat;
    const o = officePlan(ps.office);
    const R = useRoom.getState();
    if (!o || s.admitted !== ps.office || R.seated || R.leaving) pendingSeat = null;
    else if (s.inside === ps.office && !nav.target && !walkQueue.legs.length && !pendingWalkIn) {
      if (ps.phase === "wait") {
        const approach = visitorApproach(o, selfPose);
        const visitor = freeSeat(ps.office, "visitor", approach);
        ps.seat = visitor ?? freeSeat(ps.office, "meeting");
        if (!ps.seat) pendingSeat = null;
        else if (visitor) {
          ps.phase = "walk";
          nav.target = approach;
          nav.goal = null;
          nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
        } else {
          pendingSeat = null;
          sitDown(ps.seat);
        }
      } else {
        pendingSeat = null;
        const w = useWorld.getState();
        const holder = ps.seat ? w.seats[ps.seat] : undefined;
        const seat = holder && holder !== w.you ? freeSeat(ps.office, "visitor") ?? freeSeat(ps.office, "meeting") : ps.seat;
        if (seat) sitDown(seat);
      }
    }
  }

  // at the reception counter (lobby): Talk to reception
  const atRec = z.kind === "lobby" && Math.hypot(selfPose.x - RECEPTION_TALK.x, selfPose.z - RECEPTION_TALK.z) < RECEPTION_TALK_R;
  if (atRec !== s.atReception) s.set({ atReception: atRec });

  // people seen inside each office (lamp + directory fallback while the server's count is unknown)
  presenceTick += dt;
  if (presenceTick > 0.5) {
    presenceTick = 0;
    const counts: Record<string, number> = {};
    for (const id in players) {
      const p = players[id]!;
      const o = officeAt(p.x / 100, p.z / 100);
      if (o && p.z / 100 < FRONT_Z - 0.3) counts[o.id] = (counts[o.id] ?? 0) + 1;
    }
    if (s.inside) counts[s.inside] = (counts[s.inside] ?? 0) + 1;
    const prev = s.presence;
    if (OFFICE_PLANS.some((o) => (prev[o.id] ?? 0) !== (counts[o.id] ?? 0))) s.set({ presence: counts });
  }
}
let presenceTick = 0;

// QA hook (dev, or a production build with NEXT_PUBLIC_GK_QA=1), like window.__gkNav
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined")
  Object.assign(window as unknown as Record<string, unknown>, {
    __gkAdmin: {
      goToOffice,
      knockAt,
      doors,
      // exact walk targets for the QA journeys (lobby chairs, the officer's desk): seat poses + a walk along the
      // block's corridors (the same route legs goToOffice uses)
      seat: adminSeat,
      walkTo: (x: number, z: number) => {
        const legs = [...routeBetween({ x: selfPose.x, z: selfPose.z }, { x, z }), { x, z }];
        nav.target = legs.shift() ?? null;
        nav.goal = null;
        nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
        walkQueue.legs = legs;
      },
    },
  });
