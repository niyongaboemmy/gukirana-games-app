"use client";
import { create } from "zustand";
import { selfPose } from "@/lib/world-store";
import { PORTALS } from "./layout";
import { doorRefusal } from "./door-access";
import { nav, releaseAllInput } from "./navigation";
import { cameraState } from "./Player";
import { aerialFocus, resetAerialFocus } from "./aerial";
import { useStage } from "./stage";
import { destination, destRoute, routeHeading, type Destination, type DestId } from "./destinations";
import { walkPlan } from "./goto-walk";

/**
 * Go To navigation state (P2-WLD-13): pure client navigation, nothing goes to the server. The HUD (hud/GoToModal)
 * picks a destination from world/destinations.ts; the plaza scene draws the route guide (world/GoToGuide) and the
 * plaza controller walks the route (world/Player reads `nav.queue` / `nav.face`).
 *
 * Inside a hall Go To is not offered (the list says why: walk out through the door first). Simplest robust choice:
 * the hall controllers have their own exits and seats, and a scripted exit from mid-room would cut the picture.
 */
/** Go To in the HUD (kill switch NEXT_PUBLIC_FF_GOTO=0; on by default). */
export const GOTO_ON = process.env.NEXT_PUBLIC_FF_GOTO !== "0";

interface GoToState {
  /** the Go To window */
  open: boolean;
  /** the destination being guided to (route on the ground, beacon, guide card) */
  dest: DestId | null;
  /** walking there on the auto-walk */
  walking: boolean;
  /** "Show on map": the aerial view frames the destination */
  map: boolean;
  /** shown by the first-visit guide ("Fight Games is this way") */
  firstVisit: boolean;
  /** when the person arrived (performance.now; the guide card says so briefly) */
  arrivedAt: number;
}
export const useGoTo = create<GoToState>()(() => ({ open: false, dest: null, walking: false, map: false, firstVisit: false, arrivedAt: 0 }));

export type DestStatus = "open" | "closed" | "soon";
/** Open, closed by staff (or the arena turning you away), or not built / switched on yet. */
export function destStatus(d: Destination): DestStatus {
  if (!d.portal) return "open";
  const p = PORTALS.find((q) => q.id === d.portal);
  if (!p?.href) return "soon";
  return doorRefusal(p.id) ? "closed" : "open";
}

const me = () => ({ x: selfPose.x, z: selfPose.z });

export const openGoTo = () => useGoTo.setState({ open: true });
export const closeGoTo = () => useGoTo.setState({ open: false });

/** Pick a destination: the route guide appears, the person and the camera turn towards it. */
export function guideTo(id: DestId, opts: { firstVisit?: boolean; turn?: boolean } = {}) {
  const d = destination(id);
  if (!d) return;
  useGoTo.setState({ dest: id, open: false, walking: false, firstVisit: !!opts.firstVisit, arrivedAt: 0 });
  if (opts.turn === false) return;
  const h = routeHeading(destRoute(me(), d));
  if (h == null) return;
  nav.face = h;
  // the follow camera behind the person, looking along the way (its offset is (sin yaw, cos yaw) from the head)
  cameraState.yaw = h + Math.PI;
}

/** "Walk there": along the route (jogged while it is long, Player AUTO_RUN_ON), through the door if it opens. */
export function walkThere(id: DestId) {
  const d = destination(id);
  if (!d) return;
  guideTo(id);
  backToMe();
  releaseAllInput();
  nav.queue = walkPlan(me(), d, destStatus(d) === "open");
  useGoTo.setState({ walking: true });
}

/** "Show on map": up into the campus aerial view, framing the destination (its beacon marks it). */
export function showOnMap(id: DestId) {
  const d = destination(id);
  if (!d) return;
  if (useGoTo.getState().dest !== id) guideTo(id, { turn: false });
  const f = d.focus ?? d.stop;
  aerialFocus.x = f.x;
  aerialFocus.z = f.z;
  cameraState.distance = 170;
  cameraState.pitch = Math.max(cameraState.pitch, 0.9);
  useGoTo.setState({ map: true, open: false });
}

/** "Back to me": down from the aerial view onto the person. */
export function backToMe() {
  resetAerialFocus();
  if (useGoTo.getState().map || cameraState.distance > 24) cameraState.distance = 9;
  useGoTo.setState({ map: false });
}

/** Stop guiding (and stop the auto-walk if it is still going). */
export function endGuide() {
  if (useGoTo.getState().walking) nav.queue = [];
  if (useGoTo.getState().map) backToMe();
  useGoTo.setState({ dest: null, walking: false, firstVisit: false, arrivedAt: 0 });
}

/** Called by the guide every few frames: arrival at the stop, the walk ending (arrived or cut short by hand). */
export function tickGuide() {
  const s = useGoTo.getState();
  const d = destination(s.dest);
  if (!d) return;
  // walked into a hall (the destination's or any other): the guide has done its job
  if (useStage.getState().view !== "plaza") return endGuide();
  const dist = Math.hypot(selfPose.x - d.stop.x, selfPose.z - d.stop.z);
  if (s.walking && !nav.target && !nav.queue) useGoTo.setState({ walking: false });
  if (!s.arrivedAt && dist < 2.2) useGoTo.setState({ arrivedAt: performance.now(), walking: false });
  if (s.arrivedAt && performance.now() - s.arrivedAt > 6000) endGuide();
}

/* ---------------------------------------------------------------- first visit ---------------------------------------------------------------- */

const seenKey = (user: string) => `gk-goto-seen:${user}`;
/** Has this user been shown the first-visit guide on this device? (storage blocked: say yes, never nag) */
export function firstVisitSeen(user: string): boolean {
  try {
    return localStorage.getItem(seenKey(user)) === "1";
  } catch {
    return true;
  }
}
export function markFirstVisitSeen(user: string) {
  try {
    localStorage.setItem(seenKey(user), "1");
  } catch {
    /* private mode: shown again next time */
  }
}
