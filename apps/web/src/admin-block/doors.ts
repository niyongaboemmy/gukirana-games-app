"use client";
import { ACT } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { playEmote } from "@/lib/realtime";
import { nav } from "@/world/navigation";
import { hallHooks, walkQueue } from "@/rooms/hall-hooks";
import type { Rect } from "@/rooms/layouts";
import { canEnter, enterOffice, leaveOffice, useOffices } from "./office-client";
import { doorFront, doorInside, doorRect, FRONT_Z, OFFICE_PLANS, officeAt, officePlan, routeBetween, zoneOf, type P } from "./plan";

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

export function registerAdminHooks(): () => void {
  hallHooks.admin = { solids: closedDoors, route: routeBetween, tap: tapTarget };
  // let in (or a role holder admitted) while standing at the door: walk on in once the door has swung open
  const unsub = useOffices.subscribe((s, prev) => {
    if (s.admitted && s.admitted !== prev.admitted) pendingWalkIn = s.admitted;
  });
  return () => {
    unsub();
    delete hallHooks.admin;
    pendingWalkIn = null;
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
  Object.assign(window as unknown as Record<string, unknown>, { __gkAdmin: { goToOffice, knockAt, doors } });
