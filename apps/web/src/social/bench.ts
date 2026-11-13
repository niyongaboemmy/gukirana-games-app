"use client";
import * as THREE from "three";
import { PLAZA_SEATS, plazaSeat } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { sitAt, standUp } from "@/lib/realtime";
import { nav } from "@/world/navigation";
import { useSocial } from "./social-store";

/**
 * Sitting on the plaza benches (local player). The bench places are claimed on the server like hall chairs, so
 * everyone sees you seated on the same place; walking (keys / joystick / tap-to-walk) stands you up.
 * Sitting down and standing up are short eased moves between the spot in front of the bench and the seat,
 * timed with the avatar's sit-down / stand-up clips (no popping through the bench collider).
 */
export const SEAT_RANGE = 1.7;
const SIT_MS = 650;
const STAND_MS = 600;
/** where you stand in front of a seat (m, towards the fountain) — outside the bench collider */
const FRONT = 1.15;
const SIT_ANIM = 13;

const moveKeys = new Set<string>();
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    if (["KeyW", "KeyS", "ArrowUp", "ArrowDown"].includes(e.code)) moveKeys.add(e.code);
  });
  window.addEventListener("keyup", (e) => moveKeys.delete(e.code));
  window.addEventListener("blur", () => moveKeys.clear());
}

type Phase = { kind: "sitting" | "standing"; from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; start: number; dur: number };
let pendingWalk: { x: number; z: number } | null = null;
const state: { seat: string | null; phase: Phase | null } = { seat: null, phase: null };

const front = (id: string) => {
  const s = plazaSeat(id)!;
  return new THREE.Vector3(s.x + Math.sin(s.yaw) * FRONT, 0, s.z + Math.cos(s.yaw) * FRONT);
};

/** Take a free bench place (server confirms; refused → we stand back up). */
export function sitOnBench(id: string, pos: { x: number; z: number }, yaw: number): void {
  const s = plazaSeat(id);
  if (!s || state.seat) return;
  const holder = useWorld.getState().seats[id];
  if (holder && holder !== useWorld.getState().you) return;
  nav.target = null;
  nav.goal = null;
  state.seat = id;
  state.phase = { kind: "sitting", from: new THREE.Vector3(pos.x, 0, pos.z), to: new THREE.Vector3(s.x, 0, s.z), fromYaw: yaw, toYaw: s.yaw, start: performance.now(), dur: SIT_MS };
  useSocial.setState({ seated: id, nearSeat: null });
  sitAt(id);
}

export function standFromBench(): void {
  const id = state.seat;
  if (!id || state.phase?.kind === "standing") return;
  const s = plazaSeat(id)!;
  state.phase = { kind: "standing", from: new THREE.Vector3(s.x, 0, s.z), to: front(id), fromYaw: s.yaw, toYaw: s.yaw, start: performance.now(), dur: STAND_MS };
  standUp();
}

/** Ask to sit at the nearest free place (from the HUD prompt / E). */
let lastPose = { x: 0, z: 0, yaw: 0 };
export function sitNearest(): void {
  const id = useSocial.getState().nearSeat;
  if (id) sitOnBench(id, lastPose, lastPose.yaw);
}

const ease = (k: number) => k * k * (3 - 2 * k);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Called by the plaza player controller every frame AFTER its own movement + collisions.
 * Returns true while seated / sitting down / standing up (the pose has been overridden).
 */
export function applyBenchSeat(pos: THREE.Vector3, facing: { current: number }, anim: { current: number }): boolean {
  lastPose = { x: pos.x, z: pos.z, yaw: facing.current };
  const w = useWorld.getState();
  // room left / reconnected: the social state was reset
  if (state.seat && !useSocial.getState().seated && !state.phase) resetBench();
  // the server gave the place to someone else first
  if (state.seat && state.phase?.kind !== "standing" && w.seats[state.seat] && w.seats[state.seat] !== w.you) {
    state.seat = null;
    state.phase = null;
    useSocial.setState({ seated: null });
  }
  if (!state.seat) {
    updateNearSeat(pos);
    return false;
  }
  const s = plazaSeat(state.seat)!;
  const ph = state.phase;
  if (ph) {
    const k = Math.min(1, (performance.now() - ph.start) / ph.dur);
    const e = ease(k);
    pos.lerpVectors(ph.from, ph.to, e);
    facing.current = ph.fromYaw + wrap(ph.toYaw - ph.fromYaw) * Math.min(1, e * 1.6);
    anim.current = ph.kind === "sitting" ? SIT_ANIM : 0;
    if (ph.kind === "standing" && nav.target) {
      pendingWalk = nav.target;
      nav.target = null;
    }
    if (k >= 1) {
      state.phase = null;
      if (ph.kind === "standing") {
        if (pendingWalk) nav.target = pendingWalk;
        pendingWalk = null;
        state.seat = null;
        useSocial.setState({ seated: null });
      }
    }
    return true;
  }
  // seated: any walking input stands you up (turning keys don't)
  const joy = Math.hypot(w.input.x, w.input.y) > 0.3;
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
}
