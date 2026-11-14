"use client";
import * as THREE from "three";
import { create } from "zustand";
import { nav } from "@/world/navigation";
import { cameraState } from "@/world/Player";
import { selfPose } from "@/lib/world-store";
import { hallHooks, walkQueue } from "@/rooms/hall-hooks";
import { useRoom } from "@/rooms/room-store";
import { arenaStand, floorAllowed, requestSeat, seatDenial, useArena } from "./arena-client";
import { useSpectate } from "./spectate";
import { bowlSeat, CONCOURSE, FLOOR_Y, groundAt, LOBBY, OUTER_R, PORTAL_HW, RESTROOM, routeBetween, seatFront, snapWalkable, STAGE, VIP, walkable, type WalkOpts } from "./bowl";
import { nearestSpot, PHOTO_SPOT, seatArrival, type Spot } from "./venue";

/**
 * The arena's extensions of the generic hall controller (rooms/RoomPlayer via rooms/hall-hooks) and the venue's
 * interaction state (P2-ARN-03 / P2-ARN-04): walking on several levels (raked rows and their legroom, stepped stair
 * aisles, the top walkway, gantry, boxes, the sunken floor for participants), taps that hit the real bowl surfaces,
 * routes along the concourse, seats taken from the row in front of them, a follow camera that stays in the bowl, and
 * the scripted moments (restroom visit, photo pose, the players' walk-on).
 */

/* ---------------- venue state (HUD ↔ scene) ---------------- */

export type Panel = "kiosk" | "board" | "concession" | "desk" | "tunnel" | "finder" | null;
interface VenueState {
  /** the interaction in reach (one prompt at a time) */
  near: Spot | null;
  /** the open window */
  panel: Panel;
  /** concession side chosen (snack / drink) */
  counter: "snack" | "drink";
  /** a restroom visit in progress (−1 west, 1 east) and its phase */
  restroom: { side: -1 | 1; phase: "to" | "in" | "out"; at: number } | null;
  /** photo mode: the camera faces you with the bowl behind; `hideHud` hides every control */
  photo: boolean;
  hideHud: boolean;
  /** carrying a drink / snack (cosmetic, free) */
  treat: { item: string; until: number } | null;
  /** participants: the walk-on spotlight is on until this time */
  walkOn: number;
  set: (p: Partial<Omit<VenueState, "set">>) => void;
}
export const useVenue = create<VenueState>()((set) => ({
  near: null,
  panel: null,
  counter: "drink",
  restroom: null,
  photo: false,
  hideHud: false,
  treat: null,
  walkOn: 0,
  set,
}));

/* ---------------- tap picking against the real bowl geometry ---------------- */

/** meshes a tap may land on (treads, legroom, aisles, concourse, lobby, floor, gantry, box floors, seats) */
export const pickables: THREE.Object3D[] = [];
const caster = new THREE.Raycaster();
function pick(ray: THREE.Ray) {
  if (!pickables.length) return null;
  caster.ray.copy(ray);
  caster.far = 80;
  const hits = caster.intersectObjects(pickables, false);
  const opts = walkOpts();
  for (const h of hits) {
    // a walking surface faces up; a seat counts as its row
    const up = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).y : 1;
    if (up < 0.5 && !(h.object as THREE.InstancedMesh).isInstancedMesh) continue;
    const p = { x: h.point.x, z: h.point.z };
    return walkable(p.x, p.z, opts) ? p : snapWalkable(p, opts.floor);
  }
  return null;
}

/* ---------------- hall hooks ---------------- */

const walkOpts = (): WalkOpts => ({ floor: floorAllowed(), restroom: useVenue.getState().restroom?.side ?? 0 });

hallHooks.arena = {
  ground: groundAt,
  walkable: (x, z) => walkable(x, z, walkOpts()),
  chairR: 0.14,
  route: routeBetween,
  tap: (p) => snapWalkable(p, floorAllowed()),
  pick,
  standSpot: (id) => {
    const s = bowlSeat(id);
    return s ? seatFront(s) : null;
  },
  stand: arenaStand,
  // a seat is offered from the legroom right in front of it (or within reach on a VIP box floor)
  seatOk: (id) => {
    const s = bowlSeat(id);
    if (!s) return false;
    const f = seatFront(s);
    return Math.hypot(selfPose.x - f.x, selfPose.z - f.z) < (s.table.startsWith("V") ? 0.9 : 0.62);
  },
  face: () => (useVenue.getState().photo ? PHOTO_SPOT.yaw : null),
  // spectator eye view: from your own eyes (seated eye height, nudged forward past the seat back), aimed at the podium
  seatedView: (id) => {
    const sp = useSpectate.getState();
    if (!sp.eye) return null;
    const s = bowlSeat(id);
    if (!s) return null;
    const r = Math.hypot(s.x, s.z) || 1;
    const fwd = 0.22; // towards the floor: in front of your own head, never inside the row in front
    return {
      eye: { x: s.x - (s.x / r) * fwd, y: s.y + 1.2, z: s.z - (s.z / r) * fwd },
      look: { x: 0, y: FLOOR_Y + STAGE.h + 0.85, z: STAGE.z },
      focus: sp.focus,
    };
  },
  camClamp: (c) => {
    const r = Math.hypot(c.x, c.z);
    const inLobby = selfPose.z > 0 && Math.hypot(selfPose.x, selfPose.z) > OUTER_R;
    if (inLobby) {
      // in the lobby: stay out of the drum wall (except through the entry portal); never into a restroom (privacy)
      if (r < OUTER_R + 0.35 && Math.abs(c.x) > PORTAL_HW - 0.4) {
        const k = (OUTER_R + 0.35) / Math.max(r, 1e-3);
        c.x *= k;
        c.z *= k;
      }
      c.x = Math.max(-LOBBY.hw + 0.3, Math.min(LOBBY.hw - 0.3, c.x));
      c.y = Math.min(c.y, 4.3);
    } else if (r > OUTER_R - 0.5 && !(c.z > 0 && Math.abs(c.x) < PORTAL_HW - 0.3)) {
      const k = (OUTER_R - 0.5) / r;
      c.x *= k;
      c.z *= k;
    }
    // inside a VIP box the camera stays below its roof; on the floor it stays above the floor
    if (!inLobby && r > VIP.front && groundAt(c.x, c.z) === VIP.floorY) c.y = Math.min(c.y, VIP.floorY + 2.8);
    // seated / standing on the rake: never inside the rows behind (comfortable eye line, no clipping)
    c.y = Math.max(c.y, groundAt(c.x, c.z) + 1.15);
    // and always below the ceiling
    c.y = Math.min(c.y, 13.8);
  },
};

/* ---------------- seats ---------------- */

/** Walk to a seat: along the concourse, down / up the stair aisle and along the row to the seat's front. */
export function goToSeat(id: string) {
  const s = bowlSeat(id);
  if (!s) return;
  const d = seatDenial(id);
  if (d) return void useArena.setState({ denied: { action: "sit", reason: d }, cardOpen: d === "NO_PASS" });
  if (useRoom.getState().seated) {
    arenaStand();
    useRoom.getState().set({ seated: null });
  }
  const front = seatFront(s);
  walkTo(front);
  useArena.setState({ walkingTo: id, denied: null, pending: null });
}

/** Scripted walk along the venue's routes. */
export function walkTo(p: { x: number; z: number }) {
  const legs = routeBetween({ x: selfPose.x, z: selfPose.z }, p);
  nav.goal = null;
  nav.target = legs[0] ?? p;
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
  walkQueue.legs = legs.slice(1);
}

/** ask for the seat now (E on the prompt, arrival): always sends, whatever the walk state */
export function takeSeat(id: string) {
  nav.target = null;
  walkQueue.legs = [];
  useArena.setState({ walkingTo: null });
  requestSeat(id);
}

/* ---------------- per frame ---------------- */

let lastNear: string | null = null;
let photoArrived = false;
/** Per frame while the arena is on screen: seat arrival, the interaction in reach, scripted moments. */
export function updateVenue() {
  const a = useArena.getState();
  const v = useVenue.getState();
  const walking = !!nav.target || walkQueue.legs.length > 0;
  if (a.walkingTo) {
    const r = seatArrival(a.walkingTo, selfPose, walking);
    if (r === "ask") takeSeat(a.walkingTo);
    else if (r === "cancel") useArena.setState({ walkingTo: null });
  }
  // the interaction in reach (not while seated, walking to a seat, or in a scripted moment)
  const seated = !!useRoom.getState().seated;
  const near = seated || a.walkingTo || v.restroom || v.photo ? null : nearestSpot(selfPose.x, selfPose.z, { staff: a.staff });
  if ((near?.id ?? null) !== lastNear) {
    lastNear = near?.id ?? null;
    v.set({ near });
  }
  // restroom visit: in through the door, a short pause out of sight, back out to the lobby
  const rr = v.restroom;
  if (rr) {
    const now = performance.now();
    const doorX = rr.side * (LOBBY.hw - 0.9);
    if (rr.phase === "to" && !walking) {
      nav.target = { x: rr.side * (LOBBY.hw + RESTROOM.depth / 2), z: (RESTROOM.z0 + RESTROOM.z1) / 2 };
      walkQueue.legs = [];
      v.set({ restroom: { ...rr, phase: "in", at: now } });
    } else if (rr.phase === "in" && now - rr.at > 4500) {
      nav.target = { x: doorX, z: RESTROOM.doorZ };
      nav.progress = { best: Infinity, since: now, detours: 0 };
      v.set({ restroom: { ...rr, phase: "out", at: now } });
    } else if (rr.phase === "out" && (!walking || now - rr.at > 6000)) v.set({ restroom: null });
  }
  if (v.treat && v.treat.until < Date.now()) v.set({ treat: null });
  if (v.photo) {
    // photo mode ends when you walk away from the spot (after having arrived)
    const d = Math.hypot(selfPose.x - PHOTO_SPOT.x, selfPose.z - PHOTO_SPOT.z);
    if (d < 0.6) photoArrived = true;
    else if (photoArrived && d > 1.6) endPhoto();
  } else photoArrived = false;
}

/** Restroom: walk to the door; it opens, in, a short pause (camera stays in the lobby), out again. */
export function visitRestroom(side: -1 | 1) {
  walkTo({ x: side * (LOBBY.hw - 0.75), z: RESTROOM.doorZ });
  // the last leg goes through the open door
  useVenue.getState().set({ restroom: { side, phase: "to", at: performance.now() }, panel: null });
}

/** Photo spot: walk there, turn to the camera, the camera swings round in front (bowl behind you). */
export function startPhoto() {
  walkTo({ x: PHOTO_SPOT.x, z: PHOTO_SPOT.z });
  useVenue.getState().set({ photo: true, panel: null });
  cameraState.yaw = PHOTO_SPOT.yaw;
  cameraState.pitch = 0.16;
  cameraState.distance = 3.4;
  nav.lastManualCam = performance.now() + 1e9; // hold the framing (no auto-follow) until photo mode ends
}
export function endPhoto() {
  nav.lastManualCam = performance.now();
  useVenue.getState().set({ photo: false, hideHud: false });
}

/** Participants: down the players' tunnel onto the stage, with the walk-on spotlight. */
export function walkOnStage() {
  walkTo({ x: 0, z: STAGE.z - STAGE.hd + 0.6 });
  useVenue.getState().set({ walkOn: performance.now() + 14000, panel: null });
}
/** Up to the media gantry viewpoint. */
export function climbGantry() {
  walkTo({ x: 0, z: -(CONCOURSE.r1 + 2.2) });
}

// QA hook (dev, or a production build with NEXT_PUBLIC_GK_QA=1): seat geometry for scripted seating / view checks
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined")
  (window as unknown as { __gkArenaSeat: unknown }).__gkArenaSeat = {
    front: (id: string) => {
      const s = bowlSeat(id);
      return s ? seatFront(s) : null;
    },
    seat: bowlSeat,
  };
