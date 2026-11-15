"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import {
  DOOR,
  DOOR_RING,
  doorInset,
  doorLocal,
  doorWorld,
  ENTRY_Z,
  EXIT_KIOSK,
  EXIT_RADIUS,
  INTERACT_RADIUS,
  PLAZA_RADIUS,
  PORTALS,
  portalTransform,
  SPAWN,
  VESTIBULE_DEPTH,
} from "./layout";
import { doorOpen, useTransition } from "./transition";
import { useDoorway } from "./doorway";
import { doorRefusal } from "./door-access";
import { clearHandoff, peekHandoff } from "./stage";
import { cameraArm, freePoint, planRoute, plazaObstacles, resolve } from "./obstacles";
import { ringOf } from "./layout";
import { clampToCampusWalk, onCampusWalk, walkDepth } from "./campus";
import { walkRoute } from "./goto-walk";
import type { Tier } from "./materials";
import { useWorld } from "@/lib/world-store";
import { lookOf, useProfile } from "@/lib/profile-store";
import { sendMove } from "@/lib/realtime";
import { selfPose } from "@/lib/world-store";
import { saveDoorPose, takeWorldPose } from "@/lib/return-point";
import { preloadHall } from "@/rooms/preload";
import { autoFollow, nav, onReleaseInput, pointerNav, steer, TargetMarker } from "./navigation";
import { useVoice } from "@/voice/voice";
import { useWalletSheet } from "@/wallet/WalletSheet";
import { applyBenchSeat, benchBusy } from "@/social/bench";
import { SEAT_PROFILES, type SeatProfile } from "./human/seat-profiles";
import { applyPeople, lookTarget as personLook, nearSpot, people, SPOTS } from "@/social/people";
import { useSocial } from "@/social/social-store";
import { HUMAN_MODELS } from "./human/meta";
import { aerialPivot, FOLLOW_MAX, isAerial, maxPitch, pinchZoom, viewPitch, wheelZoom } from "./aerial";

/** Walking speeds (m/s): real walking pace by default; the player can change it (HUD speed control). */
export const WALK_SPEEDS = { slow: 1.4, normal: 2.2, fast: 3.2 } as const;
const keys = new Set<string>();
onReleaseInput(() => keys.clear()); // lost key-ups (area change, focus, background tab) never keep you walking

/** Click-to-walk over the campus walks: the network's waypoints, the plaza crossings routed round the furniture. */
/**
 * The open outer-ring hall (beyond the plaza: the Administrative Block since P2-WLD-14) whose building a ground point falls on: within
 * its bearing span and from just in front of its door to the back of the building (the halls are ≤ 50 m deep).
 */
function outerHallAt(x: number, z: number) {
  const r = Math.hypot(x, z);
  const deg = (Math.atan2(x, -z) * 180) / Math.PI;
  for (const d of PORTALS) {
    const R = ringOf(d);
    if (!d.href || R === DOOR_RING) continue;
    const half = (Math.atan2(50, R) * 180) / Math.PI; // ≈ 25 m either side of the door at the door ring
    const gap = Math.abs(((deg - d.angleDeg + 540) % 360) - 180);
    if (gap < half && r > R - 6 && r < R + 52) return d;
  }
  return null;
}

/** Tap-to-walk routes longer than this (m) are jogged (across the campus); the last AUTO_RUN_OFF m are walked. */
const AUTO_RUN_ON = 30;
const AUTO_RUN_OFF = 9;
/** Within this distance (m) of a hall door's doorstep you are "at the door" (door notices, GAP-004). */
const DOOR_NOTICE_R = 4.5;

/** Camera orbit state shared between the camera rig and the movement code. */
export const cameraState = { yaw: 0, pitch: 0.42, distance: 9 }; // start zoomed out
/** Farthest follow distance (m); zooming out beyond it rises into the campus aerial view (world/aerial.ts). */
export const MAX_ORBIT = FOLLOW_MAX;
/** Over-the-shoulder offset (m, to the right) when the camera is close, so your own avatar doesn't hide who you face. */
const SHOULDER = 0.45;
/** Walking in through a hall door: the follow camera closes to this distance (m) and height, over the shoulder. */
export const ENTER_CAM_L = 2.1;
const ENTER_CAM_Y = 1.9;
// dev-only hook for visual QA scripts (headless screenshots of wide views); stripped from production logic
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined")
  Object.assign(window as unknown as Record<string, unknown>, { __gkCam: cameraState, __gkNav: nav });

/**
 * Spawn spread over a ring around the arrival point (the avenue from the gate), so players who arrive together
 * don't overlap: angle from a hash of the username plus a small per-session jitter (cosmetic, not game randomness).
 */
function spawnPoint(name: string): THREE.Vector3 {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const a = (((h >>> 0) % 360) * Math.PI) / 180 + Math.random() * 0.8;
  const r = 1.6 + Math.random() * 1.6;
  return new THREE.Vector3(SPAWN.x + Math.sin(a) * r, 0, SPAWN.z + Math.cos(a) * r * 0.6);
}

export function LocalPlayer({
  color,
  name,
  level,
  tier = "standard",
}: {
  color: string;
  name: string;
  level: number;
  tier?: Tier;
}) {
  const walletOpen = useWalletSheet((s) => s.open);
  const bodyType = useProfile((s) => s.bodyType);
  const skinTone = useProfile((s) => s.skinTone);
  const hairStyle = useProfile((s) => s.hairStyle);
  const hairColor = useProfile((s) => s.hairColor);
  const outfit = useProfile((s) => s.outfit);
  const liveColor = useProfile((s) => s.color) || color;
  const topColor = useProfile((s) => s.topColor);
  // the chosen face too (P2-AVA-08): without it your own avatar showed the seeded default face (e.g. a goatee you
  // never picked) while everyone else saw your real one
  const face = useProfile((s) => s.face);
  const look = useMemo(
    () => lookOf({ bodyType, skinTone, hairStyle, hairColor, outfit, color: liveColor, topColor, face }),
    [bodyType, skinTone, hairStyle, hairColor, outfit, liveColor, topColor, face],
  );
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  // walking in from the gate: the same walk carries straight on (pose, stride, camera handed over at the cut)
  const [hand] = useState(() => (typeof window !== "undefined" ? peekHandoff("plaza") : null));
  useEffect(() => clearHandoff("plaza"), []);
  // come back exactly where you were (after a game / a room); otherwise spawn by the gate
  const restored = useRef(hand ? null : typeof window !== "undefined" ? takeWorldPose() : null);
  const pos = useRef(
    hand ? new THREE.Vector3(hand.x, 0, hand.z) : restored.current ? new THREE.Vector3(restored.current.x, 0, restored.current.z) : spawnPoint(name),
  );
  const facing = useRef(hand?.yaw ?? restored.current?.yaw ?? Math.PI);
  const stepOut = useRef(hand ? hand.walk : restored.current?.fromDoor ? 2.0 : restored.current ? 0 : 1.4); // out of a hall: ~2.6 m out through the door; fresh arrival: walk in from the gate
  /** pace of the scripted step-out / walk-in (m/s): carried over from the walk that came before */
  const stepSpeed = hand?.speed ?? 1.35;
  /** don't pull the player straight back through the door they just came out of */
  // (stepping out of a hall: straight from the hall's controller, or restored after a reload / back button)
  const fromDoor = !!hand?.fromDoor || !!restored.current?.fromDoor;
  const reentryAfter = useRef(fromDoor ? performance.now() + 2500 : 0);
  // once, before the first frame (not on every re-render: e.g. when `you` arrives after connecting, a re-render
  // used to reset the orbit to the hand-off pose a second after arriving)
  const camInit = useRef<{ done: boolean; arm: number | null }>({ done: false, arm: null });
  if (!camInit.current.done && typeof window !== "undefined") {
    camInit.current.done = true;
    if (fromDoor) {
      cameraState.yaw = (hand?.yaw ?? restored.current?.yaw ?? 0) + Math.PI; // behind the player, between them and the hall
      cameraState.distance = Math.min(cameraState.distance, 4.2); // stays in front of the facade
    }
    if (hand?.cam) {
      // the follow camera starts exactly where the previous camera was (same orbit around the person): the gate
      // camera, or the hall's camera stepping out through its door (then in the doorway, close behind you: the
      // arm starts that short and eases out to your usual distance)
      const [cx, cy, cz] = hand.cam;
      const dx = cx - hand.x;
      const dz = cz - hand.z;
      const dist = Math.hypot(dx, dz, cy - 1.6);
      cameraState.yaw = Math.atan2(dx, dz);
      cameraState.distance = THREE.MathUtils.clamp(dist, 2.5, MAX_ORBIT);
      cameraState.pitch = THREE.MathUtils.clamp(Math.asin((cy - 1.6) / Math.max(dist, 1e-3)), 0.08, 1.1);
      camInit.current.arm = Math.min(cameraState.distance, Math.max(1.2, dist));
    }
  }
  const lookAt = useRef<THREE.Vector3 | null>(null);
  const social = useRef({ listening: false, company: false });
  const seatCam = useRef(0);
  /** the plaza bench you sit on (seat fit: feet planted on the paving) */
  const seatProf = useRef<SeatProfile | null>(null);
  const spotScan = useRef(0);
  const you = useWorld((s) => s.you);
  const animSet = HUMAN_MODELS[look.bodyType]?.anim ?? "m";
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const armLen = useRef(camInit.current.arm ?? cameraState.distance);
  const enterCam = useRef({ on: false, L: 0 });
  /** remaining click-to-walk waypoints (routed around benches, beds, planters …) */
  const route = useRef<{ x: number; z: number }[]>([]);
  const stuck = useRef({ t: 0, x: 0, z: 0 });
  const manual = useRef(false);
  /** jogging along a long tap-to-walk route (see AUTO_RUN_ON) */
  const autoRun = useRef(false);
  const still = useRef(true);
  const { camera, gl } = useThree();
  const inXR = useXR((s) => s.session != null);
  useLayoutEffect(() => {
    if (hand?.cam) camera.position.set(...hand.cam);
  }, [hand, camera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    // drag = look around, click/tap on the ground = walk there, wheel = zoom
    const el = gl.domElement;
    const stopPointer = pointerNav(
      el,
      () => camera,
      (dx, dy) => {
        cameraState.yaw -= dx * 0.006;
        cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + dy * 0.004, 0.08, maxPitch(cameraState.distance));
      },
      (p) => {
        const r = Math.hypot(p.x, p.z);
        // tapping a playable building's doorway walks you through it (the door opens as you arrive)
        // a tap on a campus walk (P2-WLD-12, the generalised Fight walk): over the walk network (across the plaza to
        // the best walk exit, along the walks' corners), then to the spot (and through a door there)
        if (r > PLAZA_RADIUS - 0.5 && onCampusWalk(p.x, p.z, 0.6)) {
          route.current = walkRoute(pos.current, walkDepth(p.x, p.z).at);
          return route.current.shift()!;
        }
        // a tap on an outer hall itself (the Administrative Block: its roof, walls or forecourt, from the ground or from the
        // campus aerial view): along the walks to its door and on through it
        if (r > PLAZA_RADIUS + 4) {
          const hall = outerHallAt(p.x, p.z);
          if (hall) {
            const t = portalTransform(hall);
            const a = (hall.angleDeg * Math.PI) / 180;
            const R = ringOf(hall);
            route.current = [...walkRoute(pos.current, walkDepth(t.entryX, t.entryZ).at), { x: Math.sin(a) * (R + 0.2), z: -Math.cos(a) * (R + 0.2) }];
            return route.current.shift()!;
          }
        }
        // out on a walk, a tap back in the plaza: back along the walks to the plaza first
        const out = Math.hypot(pos.current.x, pos.current.z) > PLAZA_RADIUS - 0.5 && onCampusWalk(pos.current.x, pos.current.z, 0.5);
        if (out && r < PLAZA_RADIUS) {
          route.current = walkRoute(pos.current, freePoint(p, plazaObstacles()));
          return route.current.shift()!;
        }
        for (const d of PORTALS) {
          if (!d.href || r < PLAZA_RADIUS - 1 || ringOf(d) !== DOOR_RING) continue;
          const a = (d.angleDeg * Math.PI) / 180;
          if (
            Math.abs(p.x * Math.cos(a) + p.z * Math.sin(a)) < DOOR.w / 2 &&
            p.x * Math.sin(a) - p.z * Math.cos(a) > 0
          )
          {
            // route to the doorstep inside the plaza, then straight through the door
            const step = { x: Math.sin(a) * (PLAZA_RADIUS - 0.4), z: -Math.cos(a) * (PLAZA_RADIUS - 0.4) };
            route.current = [...planRoute(pos.current, step), { x: Math.sin(a) * (DOOR_RING + 0.2), z: -Math.cos(a) * (DOOR_RING + 0.2) }];
            return route.current.shift()!;
          }
        }
        const q = r > PLAZA_RADIUS ? { x: (p.x / r) * PLAZA_RADIUS, z: (p.z / r) * PLAZA_RADIUS } : p;
        // a tap on a bench, planter or flower bed walks to the nearest free spot next to it, around obstacles
        route.current = planRoute(pos.current, freePoint(q, plazaObstacles()));
        return route.current.shift()!;
      },
    );
    const wheel = (e: WheelEvent) => {
      cameraState.distance = wheelZoom(cameraState.distance, e.deltaY);
    };
    el.addEventListener("wheel", wheel, { passive: true });
    // two-finger pinch on phones and tablets: spread to zoom in, pinch to zoom out (all the way up to the campus view)
    let spread = 0;
    const touchSpread = (e: TouchEvent) => (e.touches.length === 2 ? Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY) : 0);
    const tstart = (e: TouchEvent) => {
      spread = touchSpread(e);
    };
    const tmove = (e: TouchEvent) => {
      const now = touchSpread(e);
      if (spread > 0 && now > 0) cameraState.distance = pinchZoom(cameraState.distance, spread, now);
      spread = now;
    };
    el.addEventListener("touchstart", tstart, { passive: true });
    el.addEventListener("touchmove", tmove, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      stopPointer();
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("touchstart", tstart);
      el.removeEventListener("touchmove", tmove);
      nav.target = null;
    };
  }, [gl, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const w = useWorld.getState();
    // Go To (P2-WLD-13, world/goto.ts): turn to face a destination; take over a whole route ("Walk there", [] = stop)
    if (nav.face != null) {
      facing.current = nav.face;
      nav.face = null;
    }
    if (nav.queue) {
      route.current = nav.queue;
      nav.queue = null;
      nav.goal = null;
      nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
      nav.target = route.current.shift() ?? null;
    }
    // run on purpose (Run button / Shift) — never just because the joystick hits its edge — or on a long tap-to-walk
    // route (across the campus to a district hall): jog while more than AUTO_RUN_ON m remain, walk the last metres
    if (nav.target) {
      let left = Math.hypot(nav.target.x - pos.current.x, nav.target.z - pos.current.z);
      let prev = nav.target;
      for (const q of route.current) {
        left += Math.hypot(q.x - prev.x, q.z - prev.z);
        prev = q;
      }
      if (left > AUTO_RUN_ON) autoRun.current = true;
      else if (left < AUTO_RUN_OFF) autoRun.current = false;
    } else autoRun.current = false;
    const run = w.input.run || keys.has("ShiftLeft") || keys.has("ShiftRight") || autoRun.current;
    const entering = useTransition.getState().entering;
    if (!inXR && !entering && stepOut.current > 0 && !keys.size && Math.hypot(w.input.x, w.input.y) < 0.1 && !nav.target) {
      // stepping out of a hall: a few natural steps towards the plaza while the door closes behind
      const held = useDoorway.getState().phase === "closed"; // step out once the doors have opened
      if (!held) stepOut.current -= dt;
      const sp = held ? 0 : stepSpeed * Math.min(1, stepOut.current / 0.4 + 0.2);
      pos.current.x += Math.sin(facing.current) * sp * dt;
      pos.current.z += Math.cos(facing.current) * sp * dt;
      anim.current = stepOut.current > 0.05 && sp > 0 ? 1 : 0;
    } else if (!inXR && entering) {
      // walking in through the door while the doors close behind the camera
      pos.current.x += Math.sin(facing.current) * 1.35 * dt;
      pos.current.z += Math.cos(facing.current) * 1.35 * dt;
      anim.current = 1;
    } else if (!inXR && !entering) {
      stepOut.current = 0;
      const s = steer({
        keys,
        joyX: w.input.x,
        joyY: w.input.y,
        camYaw: cameraState.yaw,
        facing: facing.current,
        x: pos.current.x,
        z: pos.current.z,
        // jogging a long route (tap-to-walk, Go To "Walk there"): at least the normal pace's jog, whatever the pace
        // setting (P2-WLD-13: the slow default made the far halls feel twice as far)
        walkSpeed: autoRun.current ? Math.max(WALK_SPEEDS[w.speed] ?? WALK_SPEEDS.slow, WALK_SPEEDS.normal) : (WALK_SPEEDS[w.speed] ?? WALK_SPEEDS.slow),
        run,
        dt,
      });
      pos.current.x += s.dx;
      pos.current.z += s.dz;
      facing.current = s.facing;
      autoFollow(cameraState, s, dt); // the camera follows the person
      // click-to-walk: manual input cancels the route; arriving at a waypoint continues to the next one
      if (s.mode === "keys" || s.mode === "joy") route.current = [];
      else if (!nav.target && route.current.length) nav.target = route.current.shift()!;
      // never push into an obstacle forever: give up a target that makes no progress for 1.5 s
      const st = stuck.current;
      if (nav.target) {
        st.t += dt;
        if (st.t > 1.5) {
          if (Math.hypot(pos.current.x - st.x, pos.current.z - st.z) < 0.25) {
            nav.target = null;
            route.current = [];
          }
          st.t = 0;
          st.x = pos.current.x;
          st.z = pos.current.z;
        }
      } else st.t = 0;
      if (s.moving) {
        anim.current = run || s.speed > 2.6 ? 2 : 1;
        // walking off ends what you were doing (coffee, leaning, a gesture)
        if (w.emote) w.set({ emote: null });
      } else {
        const e = w.emote;
        anim.current = e && e.until > Date.now() ? e.id : 0;
      }
      manual.current = s.mode === "keys" || s.mode === "joy" || s.mode === "click" || s.turning;
      still.current = !s.moving && !s.turning;
    }

    // collisions: plaza edge (except through an open arena doorway), then round obstacles
    const r = Math.hypot(pos.current.x, pos.current.z);
    let limit = PLAZA_RADIUS;
    for (const p of PORTALS) {
      if (!p.href || (doorOpen[p.id] ?? 0) < 0.55) continue;
      const R = ringOf(p);
      // an outer-ring door (the Administrative Block) only counts at its own doorstep, not all along its bearing
      if (R !== DOOR_RING && r < R - 6) continue;
      // a door held open for someone stepping out is not a way in when it is shut for you (closed / not allowed)
      if (!entering && stepOut.current <= 0 && doorRefusal(p.id)) continue;
      const a = (p.angleDeg * Math.PI) / 180;
      const lateral = Math.abs(pos.current.x * Math.cos(a) + pos.current.z * Math.sin(a));
      if (lateral < DOOR.w / 2 - 0.35 && pos.current.x * Math.sin(a) - pos.current.z * Math.cos(a) > 0) {
        // walking in: on into the vestibule (a cold hall keeps loading while you are still visibly walking)
        // (entering: up to just short of the lobby's far end; the hall takes over once the camera is through the door)
        // (not entering but already in the lobby, e.g. a crossing was called off: never shove the person back out)
        const lobbyEnd = R - doorInset(p.kind) + VESTIBULE_DEPTH - 0.45;
        limit = entering ? lobbyEnd : Math.max(R + 0.4, Math.min(r, lobbyEnd));
        // crossing the threshold of an open door: fade and go inside (no button needed; E stays as a fallback)
        if (r > R - 0.9 && !entering && performance.now() > reentryAfter.current) {
          // coming back from the room puts you just outside this door, facing the plaza
          // a few steps out from the door (camera stays on the plaza side, no prompt to walk straight back in)
          saveDoorPose({ x: Math.sin(a) * (R - 1.2), z: -Math.cos(a) * (R - 1.2), yaw: -a });
          useTransition.getState().enter(p.href);
        }
      }
    }
    // beyond the plaza edge only the campus walks are walkable (P2-WLD-12): slide along their kerbs
    if (r > limit && !(r > PLAZA_RADIUS - 0.5 && clampToCampusWalk(pos.current))) pos.current.multiplyScalar(limit / r);
    // other people are solid: walk around them (soft push, no passing through) — except my partner in a hug
    for (const op of Object.values(w.players)) {
      if (op.id === people.partner) continue;
      const dx = pos.current.x - op.x / 100;
      const dz = pos.current.z - op.z / 100;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.64 && dist > 1e-4) {
        pos.current.x = op.x / 100 + (dx / dist) * 0.64;
        pos.current.z = op.z / 100 + (dz / dist) * 0.64;
      }
    }
    // solid furniture, planters, flower beds, lamp posts, kiosks: slide along them (body radius 0.32 m)
    resolve(pos.current, plazaObstacles());

    // plaza benches: seated / sitting down / standing up overrides the pose (social/bench.ts)
    const onBench = applyBenchSeat(pos.current, facing, anim, animSet, dt);
    seatProf.current = onBench ? SEAT_PROFILES.bench : null;
    // person-level behaviour: gestures turn to their target, contact actions, leaning / coffee, social facing
    if (!onBench && !inXR) applyPeople(pos.current, facing, anim, dt, manual.current, still.current);

    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // third-person camera (DESIGN-SPEC §8.1)
    const enterPortal = entering ? PORTALS.find((p) => p.href === entering) : undefined;
    if (!inXR && enterPortal) {
      // walking in through a door: the camera follows close behind (over the shoulder), centred in the doorway,
      // through the door line and into the lobby; the hall takes over with this exact camera pose once it is
      // through (world/stage.ts enterHall), so the person never leaves the frame and never jumps on screen
      const ec = enterCam.current;
      if (!ec.on) {
        ec.on = true;
        ec.L = Math.hypot(camera.position.x - pos.current.x, camera.position.z - pos.current.z);
        // coming down from the campus view: back to the normal follow range and near plane
        if (isAerial(cameraState.distance)) cameraState.distance = 9;
        const pc = camera as THREE.PerspectiveCamera;
        if (pc.near !== 0.15) {
          pc.near = 0.15;
          pc.updateProjectionMatrix();
        }
      }
      ec.L += (ENTER_CAM_L - ec.L) * Math.min(1, dt * 2.6);
      const fx = Math.sin(facing.current);
      const fz = Math.cos(facing.current);
      const loc = doorLocal(enterPortal, pos.current.x - fx * ec.L, pos.current.z - fz * ec.L);
      const line = doorInset(enterPortal.kind);
      // near and inside the door: stay clear of the jambs and the lobby walls
      if (loc.lz < line + 1.8) loc.lx = THREE.MathUtils.clamp(loc.lx, -0.8, 0.8);
      const w = doorWorld(enterPortal, loc.lx, loc.lz);
      const wy = THREE.MathUtils.lerp(camera.position.y, ENTER_CAM_Y, Math.min(1, dt * 3));
      camera.position.lerp(new THREE.Vector3(w.x, wy, w.z), Math.min(1, dt * 7));
      camera.lookAt(pos.current.x + fx * 1.2, 1.45, pos.current.z + fz * 1.2);
    } else if (!inXR) {
      enterCam.current.on = false;
      const aerial = isAerial(cameraState.distance);
      let want = seatCam.current > 0.01 && !aerial ? THREE.MathUtils.lerp(cameraState.distance, Math.min(cameraState.distance, 3.6), seatCam.current) : cameraState.distance;
      // walking up to an open hall door: the camera closes in behind you over the last few metres, so that walking
      // through it is one continuous follow (no swoop at the threshold)
      for (const p of aerial ? [] : PORTALS) {
        if (!p.href || (doorOpen[p.id] ?? 0) < 0.2) continue;
        const loc = doorLocal(p, pos.current.x, pos.current.z);
        const depth = loc.lz - doorInset(p.kind);
        if (depth > 7 || depth < -0.5 || Math.abs(loc.lx) > 3) continue;
        const t = portalTransform(p);
        const towards = -(Math.sin(facing.current) * Math.sin(t.rotY) + Math.cos(facing.current) * Math.cos(t.rotY));
        const k = THREE.MathUtils.smoothstep(7 - depth, 0, 5.5) * THREE.MathUtils.smoothstep(towards, 0.3, 0.9);
        want = THREE.MathUtils.lerp(want, Math.min(want, ENTER_CAM_L + 0.5), k);
      }
      // spring arm: pull the camera in front of anything solid between the head and the wanted position
      // (buildings around the plaza, sign totems, lamp posts, kiosks, the gate canopy); snap in, ease out
      // (the aerial view is far above every roof: nothing to pull it in)
      const d = aerial ? want : cameraArm(pos.current.x, pos.current.z, cameraState.yaw, cameraState.pitch, want);
      armLen.current = d < armLen.current ? d : armLen.current + (d - armLen.current) * Math.min(1, dt * 2.5);
      const L = armLen.current;
      // close up (< 3 m): slide camera and aim point to the right shoulder
      const sh = SHOULDER * THREE.MathUtils.smoothstep(3.6 - L, 0, 1.0);
      const rx = Math.cos(cameraState.yaw) * sh;
      const rz = -Math.sin(cameraState.yaw) * sh;
      // seated: frame the seated person (look lower, come a little closer) instead of aiming over their head
      seatCam.current += ((benchBusy() ? 1 : 0) - seatCam.current) * Math.min(1, dt * 3);
      const aimY = 1.5 - 0.5 * seatCam.current;
      // zoomed out past the follow range: the pivot glides to the campus centre and the view tilts down (aerial.ts)
      const pv = viewPitch(cameraState.pitch, L);
      const pivot = aerialPivot(pos.current.x, pos.current.z, aimY, L);
      const cx = pivot.x + Math.sin(cameraState.yaw) * Math.cos(pv) * L + rx;
      const cz = pivot.z + Math.cos(cameraState.yaw) * Math.cos(pv) * L + rz;
      let cy = pivot.y + 0.1 + Math.sin(pv) * L;
      // keep the camera below the entry gate canopy (soffit at ~5.2 m) instead of clipping through it
      if (!aerial && Math.abs(cx) < 10 && Math.abs(cz - ENTRY_Z) < 4.6) cy = Math.min(cy, 4.6);
      camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * (d < L + 0.01 ? 14 : 8)));
      // aim only a little right of the head: the camera's own sideways offset then puts you left of centre
      camera.lookAt(pivot.x + rx * 0.25, pivot.y, pivot.z + rz * 0.25);
      // far views: push the near plane out with the distance so the far campus keeps its depth precision
      const near = L > FOLLOW_MAX ? Math.min(2, 0.15 + (L - FOLLOW_MAX) * 0.004) : 0.15;
      const pc = camera as THREE.PerspectiveCamera;
      if (Math.abs(pc.near - near) > 0.01) {
        pc.near = near;
        pc.updateProjectionMatrix();
      }
    }
    // dev QA: a fixed camera pose for screenshots (like rooms/RoomPlayer's __gkRoomQA.cam)
    const qaCam = process.env.NODE_ENV !== "production" ? (window as unknown as { __gkPlazaCam?: { p: [number, number, number]; l: [number, number, number] } | null }).__gkPlazaCam : null;
    if (qaCam) {
      camera.position.set(...qaCam.p);
      camera.lookAt(...qaCam.l);
    }

    // proximity: portals and players
    let nearPortal: (typeof PORTALS)[number]["id"] | null = null;
    // the hall door you stand at, whatever way you face (a shut door explains itself on every approach: GAP-004)
    let nearDoor: (typeof PORTALS)[number]["id"] | null = null;
    let doorBest = DOOR_NOTICE_R;
    for (const p of PORTALS) {
      const t = portalTransform(p);
      const doorDist = Math.hypot(t.entryX - pos.current.x, t.entryZ - pos.current.z);
      if (p.href && doorDist < doorBest) {
        doorBest = doorDist;
        nearDoor = p.id;
      }
      if (doorDist < 12 && (p.id === "pool" || p.id === "ludo" || p.id === "igisoro" || p.id === "admin" || (p.id === "arena" && !!p.href) || (p.id === "fight" && !!p.href))) preloadHall(p.id); // warm the hall while walking up
      if (doorDist >= INTERACT_RADIUS) continue;
      // no "Enter …" prompt while stepping out of a hall or when walking away from that door
      if (performance.now() < reentryAfter.current) continue;
      const towardX = t.entryX - pos.current.x;
      const towardZ = t.entryZ - pos.current.z;
      const facingDoor = Math.sin(facing.current) * towardX + Math.cos(facing.current) * towardZ > -0.2;
      if (facingDoor) nearPortal = p.id;
    }
    // nearest verified player within reach (players without the field — older servers — count as eligible)
    let nearPlayer: string | null = null;
    let best = 2.6;
    for (const op of Object.values(w.players)) {
      if (op.verified === false) continue;
      const d = Math.hypot(op.x / 100 - pos.current.x, op.z / 100 - pos.current.z);
      if (d < best) {
        best = d;
        nearPlayer = op.id;
      }
    }
    const nearGateExit = Math.hypot(EXIT_KIOSK.x - pos.current.x, EXIT_KIOSK.z - pos.current.z) < EXIT_RADIUS;
    if (nearPortal !== w.nearPortal || nearPlayer !== w.nearPlayer || nearGateExit !== w.nearGateExit || nearDoor !== w.nearDoor)
      w.set({ nearPortal, nearPlayer, nearGateExit, nearDoor });

    // turn the head towards the nearest player who is speaking on voice (within 6 m)
    const talking = useVoice.getState().talking;
    let speaker: (typeof w.players)[string] | null = null;
    let sd = 6;
    for (const op of Object.values(w.players)) {
      if (!talking[op.id]) continue;
      const d = Math.hypot(op.x / 100 - pos.current.x, op.z / 100 - pos.current.z);
      if (d < sd) {
        sd = d;
        speaker = op;
      }
    }
    lookAt.current = personLook(pos.current.x, pos.current.z, speaker ? { x: speaker.x / 100, z: speaker.z / 100 } : null, lookTarget);
    // idle mood: someone talking within 4 m (listen, nod) / standing with me (attentive)
    social.current.listening = !!speaker && sd < 4;
    social.current.company = nearPlayer != null && best < 1.8;
    // context places (lamp posts, café) for the action prompt
    if (performance.now() - spotScan.current > 200) {
      spotScan.current = performance.now();
      const cur = useSocial.getState().nearSpot;
      const sp = onBench ? null : nearSpot(pos.current.x, pos.current.z, cur != null ? (SPOTS[cur] ?? null) : null);
      const idx = sp ? SPOTS.indexOf(sp) : null;
      if (useSocial.getState().nearSpot !== idx) useSocial.setState({ nearSpot: idx });
    }

    sendMove(pos.current.x, pos.current.z, facing.current, anim.current);
    selfPose.x = pos.current.x;
    selfPose.z = pos.current.z;
    selfPose.yaw = facing.current;
  });

  return (
    <>
      <TargetMarker />
      <group ref={group}>
        <Avatar
          look={look}
          name={name}
          level={level}
          animRef={anim}
          shadows={tier !== "lite"}
          quality={tier}
          self
          holdWallet={walletOpen}
          lookAtRef={lookAt}
          showTag={false}
          seedId={you ?? name}
          rootMotion="clip"
          socialRef={social}
          footsteps
          seatRef={seatProf}
        />
      </group>
    </>
  );
}

// Remote people (interpolation, seats, bubbles, crowd budget) live in social/RemotePlayers.tsx
export { RemotePlayers } from "@/social/RemotePlayers";
