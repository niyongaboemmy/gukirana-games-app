"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import {
  DOOR,
  DOOR_RING,
  ENTRY_Z,
  EXIT_KIOSK,
  EXIT_RADIUS,
  INTERACT_RADIUS,
  PLAZA_RADIUS,
  PORTALS,
  portalTransform,
  SPAWN,
} from "./layout";
import { doorOpen, useTransition } from "./transition";
import { useDoorway } from "./doorway";
import { clearHandoff, peekHandoff } from "./stage";
import { cameraArm, freePoint, planRoute, plazaObstacles, resolve } from "./obstacles";
import type { Tier } from "./materials";
import { useWorld } from "@/lib/world-store";
import { lookOf, useProfile } from "@/lib/profile-store";
import { sendMove } from "@/lib/realtime";
import { selfPose } from "@/lib/world-store";
import { saveDoorPose, takeWorldPose } from "@/lib/return-point";
import { preloadHall } from "@/rooms/preload";
import { autoFollow, nav, pointerNav, steer, TargetMarker } from "./navigation";
import { useVoice } from "@/voice/voice";
import { applyBenchSeat, benchBusy } from "@/social/bench";
import { applyPeople, lookTarget as personLook, nearSpot, people, SPOTS } from "@/social/people";
import { useSocial } from "@/social/social-store";
import { HUMAN_MODELS } from "./human/meta";

/** Walking speeds (m/s): real walking pace by default; the player can change it (HUD speed control). */
export const WALK_SPEEDS = { slow: 1.4, normal: 2.2, fast: 3.2 } as const;
const keys = new Set<string>();

/** Camera orbit state shared between the camera rig and the movement code. */
export const cameraState = { yaw: 0, pitch: 0.42, distance: 9 }; // start zoomed out
/** Farthest orbit distance (m) for wheel / pinch zoom. */
export const MAX_ORBIT = 24;
/** Over-the-shoulder offset (m, to the right) when the camera is close, so your own avatar doesn't hide who you face. */
const SHOULDER = 0.45;
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
  const bodyType = useProfile((s) => s.bodyType);
  const skinTone = useProfile((s) => s.skinTone);
  const hairStyle = useProfile((s) => s.hairStyle);
  const hairColor = useProfile((s) => s.hairColor);
  const outfit = useProfile((s) => s.outfit);
  const liveColor = useProfile((s) => s.color) || color;
  const topColor = useProfile((s) => s.topColor);
  const look = useMemo(
    () => lookOf({ bodyType, skinTone, hairStyle, hairColor, outfit, color: liveColor, topColor }),
    [bodyType, skinTone, hairStyle, hairColor, outfit, liveColor, topColor],
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
  const stepOut = useRef(hand ? hand.walk : restored.current?.fromDoor ? 1.6 : restored.current ? 0 : 1.4); // fresh arrival: walk in from the gate
  /** pace of the scripted step-out / walk-in (m/s): carried over from the walk that came before */
  const stepSpeed = hand?.speed ?? 1.35;
  /** don't pull the player straight back through the door they just came out of */
  const reentryAfter = useRef(restored.current?.fromDoor ? performance.now() + 2500 : 0);
  if (restored.current?.fromDoor && typeof window !== "undefined") {
    cameraState.yaw = (restored.current.yaw ?? 0) + Math.PI; // behind the player, between them and the hall
    cameraState.distance = Math.min(cameraState.distance, 4.2); // stays in front of the facade
  }
  if (hand?.cam) {
    // the follow camera starts exactly where the gate camera was (same orbit around the person)
    const [cx, cy, cz] = hand.cam;
    const dx = cx - hand.x;
    const dz = cz - hand.z;
    const dist = Math.hypot(dx, dz, cy - 1.6);
    cameraState.yaw = Math.atan2(dx, dz);
    cameraState.distance = THREE.MathUtils.clamp(dist, 2.5, MAX_ORBIT);
    cameraState.pitch = THREE.MathUtils.clamp(Math.asin((cy - 1.6) / Math.max(dist, 1e-3)), 0.08, 1.1);
  }
  const lookAt = useRef<THREE.Vector3 | null>(null);
  const social = useRef({ listening: false, company: false });
  const seatCam = useRef(0);
  const spotScan = useRef(0);
  const you = useWorld((s) => s.you);
  const animSet = HUMAN_MODELS[look.bodyType]?.anim ?? "m";
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const armLen = useRef(cameraState.distance);
  /** remaining click-to-walk waypoints (routed around benches, beds, planters …) */
  const route = useRef<{ x: number; z: number }[]>([]);
  const stuck = useRef({ t: 0, x: 0, z: 0 });
  const manual = useRef(false);
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
        cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + dy * 0.004, 0.08, 1.1);
      },
      (p) => {
        const r = Math.hypot(p.x, p.z);
        // tapping a playable building's doorway walks you through it (the door opens as you arrive)
        for (const d of PORTALS) {
          if (!d.href || r < PLAZA_RADIUS - 1) continue;
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
      cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + e.deltaY * 0.006, 2.5, MAX_ORBIT);
    };
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      stopPointer();
      el.removeEventListener("wheel", wheel);
      nav.target = null;
    };
  }, [gl, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const w = useWorld.getState();
    // run only on purpose (Run button / Shift) — never just because the joystick hits its edge
    const run = w.input.run || keys.has("ShiftLeft") || keys.has("ShiftRight");
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
        walkSpeed: WALK_SPEEDS[w.speed] ?? WALK_SPEEDS.slow,
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
      const a = (p.angleDeg * Math.PI) / 180;
      const lateral = Math.abs(pos.current.x * Math.cos(a) + pos.current.z * Math.sin(a));
      if (lateral < DOOR.w / 2 - 0.35 && pos.current.x * Math.sin(a) - pos.current.z * Math.cos(a) > 0) {
        // walking in: on into the vestibule (a cold hall keeps loading while you are still visibly walking)
        limit = entering ? DOOR_RING + 2.6 : DOOR_RING + 0.4;
        // crossing the threshold of an open door: fade and go inside (no button needed; E stays as a fallback)
        if (r > DOOR_RING - 0.9 && !entering && performance.now() > reentryAfter.current) {
          // coming back from the room puts you just outside this door, facing the plaza
          // a few steps out from the door (camera stays on the plaza side, no prompt to walk straight back in)
          saveDoorPose({ x: Math.sin(a) * (DOOR_RING - 1.7), z: -Math.cos(a) * (DOOR_RING - 1.7), yaw: -a });
          useTransition.getState().enter(p.href);
        }
      }
    }
    if (r > limit) pos.current.multiplyScalar(limit / r);
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
    // person-level behaviour: gestures turn to their target, contact actions, leaning / coffee, social facing
    if (!onBench && !inXR) applyPeople(pos.current, facing, anim, dt, manual.current, still.current);

    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // third-person camera (DESIGN-SPEC §8.1)
    if (!inXR) {
      const want = seatCam.current > 0.01 ? THREE.MathUtils.lerp(cameraState.distance, Math.min(cameraState.distance, 3.6), seatCam.current) : cameraState.distance;
      // spring arm: pull the camera in front of anything solid between the head and the wanted position
      // (buildings around the plaza, sign totems, lamp posts, kiosks, the gate canopy); snap in, ease out
      const d = cameraArm(pos.current.x, pos.current.z, cameraState.yaw, cameraState.pitch, want);
      armLen.current = d < armLen.current ? d : armLen.current + (d - armLen.current) * Math.min(1, dt * 2.5);
      const L = armLen.current;
      // close up (< 3 m): slide camera and aim point to the right shoulder
      const sh = SHOULDER * THREE.MathUtils.smoothstep(3.6 - L, 0, 1.0);
      const rx = Math.cos(cameraState.yaw) * sh;
      const rz = -Math.sin(cameraState.yaw) * sh;
      const cx = pos.current.x + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * L + rx;
      const cz = pos.current.z + Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * L + rz;
      // seated: frame the seated person (look lower, come a little closer) instead of aiming over their head
      seatCam.current += ((benchBusy() ? 1 : 0) - seatCam.current) * Math.min(1, dt * 3);
      const aimY = 1.5 - 0.5 * seatCam.current;
      let cy = aimY + 0.1 + Math.sin(cameraState.pitch) * L;
      // keep the camera below the entry gate canopy (soffit at ~5.2 m) instead of clipping through it
      if (Math.abs(cx) < 10 && Math.abs(cz - ENTRY_Z) < 4.6) cy = Math.min(cy, 4.6);
      // going through a door: the camera stays on the plaza side and watches you walk in (it never follows into the wall)
      if (!entering) camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * (d < L + 0.01 ? 14 : 8)));
      // aim only a little right of the head: the camera's own sideways offset then puts you left of centre
      camera.lookAt(pos.current.x + rx * 0.25, aimY, pos.current.z + rz * 0.25);
    }

    // proximity: portals and players
    let nearPortal: (typeof PORTALS)[number]["id"] | null = null;
    for (const p of PORTALS) {
      const t = portalTransform(p);
      const doorDist = Math.hypot(t.entryX - pos.current.x, t.entryZ - pos.current.z);
      if (doorDist < 12 && (p.id === "pool" || p.id === "ludo" || p.id === "igisoro")) preloadHall(p.id); // warm the hall while walking up
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
    if (nearPortal !== w.nearPortal || nearPlayer !== w.nearPlayer || nearGateExit !== w.nearGateExit)
      w.set({ nearPortal, nearPlayer, nearGateExit });

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
      const sp = onBench ? null : nearSpot(pos.current.x, pos.current.z);
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
          lookAtRef={lookAt}
          showTag={false}
          seedId={you ?? name}
          rootMotion="clip"
          socialRef={social}
          footsteps
        />
      </group>
    </>
  );
}

// Remote people (interpolation, seats, bubbles, crowd budget) live in social/RemotePlayers.tsx
export { RemotePlayers } from "@/social/RemotePlayers";
