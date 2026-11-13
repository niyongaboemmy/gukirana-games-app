"use client";
import * as THREE from "three";
import { PLAZA_SEATS, plazaSeat } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { sitAt, standUp } from "@/lib/realtime";
import { nav } from "@/world/navigation";
import { SIT_TIMING, sitDownSeconds, standUpSeconds } from "@/world/human/meta";
import { useSocial } from "./social-store";

/**
 * Sitting on the plaza benches (local player). The bench places are claimed on the server like hall chairs, so
 * everyone sees you seated on the same place; walking (keys / joystick / tap-to-walk) stands you up.
 *
 * Sitting down is staged like a real person does it (motion review batch 1):
 *  1. walk on the normal gait to a spot in front of the place (outside the bench),
 *  2. turn round on the spot (stepping, ≤ 6 rad/s) and take a short step back until the calves touch the bench,
 *  3. sit: the avatar origin moves to the seat and the trimmed sit-down clip's own root motion carries the hips
 *     back and down onto it (no sliding while standing, no standing inside the bench).
 * Standing up is the reverse: the origin is already where you will stand, the stand-up clip lifts the body off the
 * seat, then one step forward clears the bench before you walk on (from zero speed).
 */
export const SEAT_RANGE = 1.7;
/** where the walk up to the bench ends (m in front of the seat centre) — outside the bench collider */
const APPROACH = 0.86;
/** after standing up, one step forward to here (outside the collider) */
const CLEAR = 0.74;
const SIT_ANIM = 13;
const TURN_RATE = 6;

const moveKeys = new Set<string>();
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    if (["KeyW", "KeyS", "ArrowUp", "ArrowDown"].includes(e.code)) moveKeys.add(e.code);
  });
  window.addEventListener("keyup", (e) => moveKeys.delete(e.code));
  window.addEventListener("blur", () => moveKeys.clear());
}

type PhaseKind = "approach" | "turn" | "back" | "sitting" | "standing" | "clear";
interface Phase {
  kind: PhaseKind;
  start: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}
let pendingWalk: { x: number; z: number } | null = null;
const state: { seat: string | null; phase: Phase | null; set: "m" | "f"; claimed: boolean } = { seat: null, phase: null, set: "m", claimed: false };

const fwdOf = (id: string, d: number) => {
  const s = plazaSeat(id)!;
  return new THREE.Vector3(s.x + Math.sin(s.yaw) * d, 0, s.z + Math.cos(s.yaw) * d);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k: number) => k * k * (3 - 2 * k);
const phase = (kind: PhaseKind, dur: number, from: THREE.Vector3, to: THREE.Vector3): Phase => ({ kind, start: performance.now(), dur, from: from.clone(), to: to.clone() });

/** Take a free bench place: walk up to it, turn, sit (the server claim is made as you sit down). */
export function sitOnBench(id: string, pos: { x: number; z: number }): void {
  const s = plazaSeat(id);
  if (!s || state.seat) return;
  const holder = useWorld.getState().seats[id];
  if (holder && holder !== useWorld.getState().you) return;
  state.seat = id;
  state.claimed = false;
  const here = new THREE.Vector3(pos.x, 0, pos.z);
  const approach = fwdOf(id, APPROACH);
  if (here.distanceTo(approach) < 0.3) state.phase = phase("turn", 0, here, approach);
  else {
    nav.goal = null;
    nav.target = { x: approach.x, z: approach.z };
    state.phase = phase("approach", 6000, here, approach);
  }
  useSocial.setState({ seated: id, nearSeat: null });
}

export function standFromBench(): void {
  const id = state.seat;
  if (!id) return;
  const k = state.phase?.kind;
  if (k === "standing" || k === "clear") return;
  if (k === "approach" || k === "turn" || k === "back") {
    // not seated yet: just stop
    resetBench();
    useSocial.setState({ seated: null });
    return;
  }
  const stand = fwdOf(id, SIT_TIMING[state.set].upFront);
  state.phase = phase("standing", standUpSeconds(state.set) * 1000, stand, stand);
  standUp();
}

/** Ask to sit at the nearest free place (from the HUD prompt / E). */
let lastPose = { x: 0, z: 0, yaw: 0 };
export function sitNearest(): void {
  const id = useSocial.getState().nearSeat;
  if (id) sitOnBench(id, lastPose);
}

/** True while seated / sitting down / standing up (the player controller's camera frames the seated person). */
export const benchBusy = () => !!state.seat && state.phase?.kind !== "approach";

/**
 * Called by the plaza player controller every frame AFTER its own movement + collisions.
 * `set` = the local avatar's animation set (clip timings). Returns true while the pose is overridden.
 */
export function applyBenchSeat(pos: THREE.Vector3, facing: { current: number }, anim: { current: number }, set: "m" | "f" = "m", dt = 1 / 60): boolean {
  lastPose = { x: pos.x, z: pos.z, yaw: facing.current };
  state.set = set;
  const w = useWorld.getState();
  // room left / reconnected: the social state was reset
  if (state.seat && !useSocial.getState().seated && !state.phase) resetBench();
  // the server gave the place to someone else first
  if (state.seat && state.phase?.kind !== "standing" && state.phase?.kind !== "clear" && w.seats[state.seat] && w.seats[state.seat] !== w.you) {
    resetBench();
    useSocial.setState({ seated: null });
  }
  if (!state.seat) {
    updateNearSeat(pos);
    return false;
  }
  const id = state.seat;
  const s = plazaSeat(id)!;
  const ph = state.phase;
  const now = performance.now();
  const joy = Math.hypot(w.input.x, w.input.y) > 0.3;
  if (ph) {
    const k = Math.min(1, ph.dur ? (now - ph.start) / ph.dur : 1);
    switch (ph.kind) {
      case "approach": {
        // the normal controller walks us there; any other input (or a new tap elsewhere) cancels
        const d = Math.hypot(pos.x - ph.to.x, pos.z - ph.to.z);
        const retarget = nav.target && Math.hypot(nav.target.x - ph.to.x, nav.target.z - ph.to.z) > 0.05;
        if (moveKeys.size || joy || retarget || (!nav.target && d > 0.45) || k >= 1) {
          resetBench();
          useSocial.setState({ seated: null });
          return false;
        }
        if (d < 0.3 || !nav.target) {
          nav.target = null;
          state.phase = phase("turn", 0, pos, fwdOf(id, APPROACH));
        }
        return false;
      }
      case "turn": {
        // turn round on the spot (the animator plays small turning steps from the yaw rate)
        anim.current = 0;
        const d = wrap(s.yaw - facing.current);
        facing.current += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt);
        pos.lerp(ph.to, Math.min(1, dt * 6));
        if (Math.abs(d) < 0.05) state.phase = phase("back", 520, pos, fwdOf(id, SIT_TIMING[set].front));
        return true;
      }
      case "back": {
        // a short step back to the bench (the gait runs backwards)
        anim.current = 0;
        pos.lerpVectors(ph.from, ph.to, ease(k));
        facing.current = s.yaw;
        if (k >= 1) {
          state.phase = phase("sitting", sitDownSeconds(set) * 1000, ph.to, new THREE.Vector3(s.x, 0, s.z));
          state.claimed = true;
          sitAt(id);
        }
        return true;
      }
      case "sitting": {
        // origin on the seat; the sit-down clip's root motion moves the body from the front spot onto it
        pos.set(s.x, 0, s.z);
        facing.current = s.yaw;
        anim.current = SIT_ANIM;
        if (k >= 1) state.phase = null;
        return true;
      }
      case "standing": {
        // origin already where we will stand; the stand-up clip lifts the body off the seat
        pos.copy(ph.to);
        facing.current = s.yaw;
        anim.current = 0;
        if (nav.target) {
          pendingWalk = nav.target;
          nav.target = null;
        }
        if (k >= 1) state.phase = phase("clear", 420, ph.to, fwdOf(id, CLEAR));
        return true;
      }
      case "clear": {
        // one step forward, clear of the bench, then hand back to the controller (walking on from zero speed)
        pos.lerpVectors(ph.from, ph.to, ease(k));
        facing.current = s.yaw;
        anim.current = 0;
        if (nav.target) {
          pendingWalk = nav.target;
          nav.target = null;
        }
        if (k >= 1) {
          if (pendingWalk) nav.target = pendingWalk;
          pendingWalk = null;
          resetBench();
          useSocial.setState({ seated: null });
        }
        return true;
      }
    }
  }
  // seated: any walking input stands you up (turning keys don't)
  if (moveKeys.size || joy || nav.target) {
    // tap-to-walk while seated: stand up first, then continue to where you tapped
    pendingWalk = nav.goal ?? nav.target;
    nav.target = null;
    nav.goal = null;
    standFromBench();
  }
  pos.set(s.x, 0, s.z);
  facing.current = s.yaw;
  anim.current = SIT_ANIM;
  return true;
}

let lastScan = 0;
function updateNearSeat(pos: THREE.Vector3) {
  const now = performance.now();
  if (now - lastScan < 150) return;
  lastScan = now;
  const w = useWorld.getState();
  let best = SEAT_RANGE;
  let near: string | null = null;
  for (const s of PLAZA_SEATS) {
    const holder = w.seats[s.id];
    if (holder && holder !== w.you) continue;
    const d = Math.hypot(s.x - pos.x, s.z - pos.z);
    if (d < best) {
      best = d;
      near = s.id;
    }
  }
  if (near !== useSocial.getState().nearSeat) useSocial.setState({ nearSeat: near });
}

/** Leaving the plaza (door, sign out): forget the seat locally (the server frees it on leave). */
export function resetBench(): void {
  state.seat = null;
  state.phase = null;
  state.claimed = false;
}
