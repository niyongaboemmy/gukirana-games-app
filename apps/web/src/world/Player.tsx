"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import {
  COLLIDERS,
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
import { decodeLook } from "./outfits";
import type { Tier } from "./materials";
import { useWorld } from "@/lib/world-store";
import { lookOf, useProfile } from "@/lib/profile-store";
import { sendMove } from "@/lib/realtime";
import { selfPose } from "@/lib/world-store";
import { saveDoorPose, takeWorldPose } from "@/lib/return-point";
import { preloadHall } from "@/rooms/preload";
import { autoFollow, nav, pointerNav, steer, TargetMarker } from "./navigation";
import { useVoice } from "@/voice/voice";

/** Walking speeds (m/s): real walking pace by default; the player can change it (HUD speed control). */
export const WALK_SPEEDS = { slow: 1.4, normal: 2.2, fast: 3.2 } as const;
const keys = new Set<string>();

/** Camera orbit state shared between the camera rig and the movement code. */
export const cameraState = { yaw: 0, pitch: 0.42, distance: 9 }; // start zoomed out
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
  const look = useMemo(
    () => lookOf({ bodyType, skinTone, hairStyle, hairColor, outfit, color: liveColor }),
    [bodyType, skinTone, hairStyle, hairColor, outfit, liveColor],
  );
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  // come back exactly where you were (after a game / a room); otherwise spawn by the gate
  const restored = useRef(typeof window !== "undefined" ? takeWorldPose() : null);
  const pos = useRef(
    restored.current ? new THREE.Vector3(restored.current.x, 0, restored.current.z) : spawnPoint(name),
  );
  const facing = useRef(restored.current?.yaw ?? Math.PI);
  const stepOut = useRef(restored.current?.fromDoor ? 1.6 : 0);
  /** don't pull the player straight back through the door they just came out of */
  const reentryAfter = useRef(restored.current?.fromDoor ? performance.now() + 2500 : 0);
  if (restored.current?.fromDoor && typeof window !== "undefined") {
    cameraState.yaw = (restored.current.yaw ?? 0) + Math.PI; // behind the player, between them and the hall
    cameraState.distance = Math.min(cameraState.distance, 4.2); // stays in front of the facade
  }
  const lookAt = useRef<THREE.Vector3 | null>(null);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const { camera, gl } = useThree();
  const inXR = useXR((s) => s.session != null);

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
            return { x: Math.sin(a) * (DOOR_RING + 0.2), z: -Math.cos(a) * (DOOR_RING + 0.2) };
        }
        return r > PLAZA_RADIUS ? { x: (p.x / r) * PLAZA_RADIUS, z: (p.z / r) * PLAZA_RADIUS } : p;
      },
    );
    const wheel = (e: WheelEvent) => {
      cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + e.deltaY * 0.006, 2.5, 18);
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
      stepOut.current -= dt;
      const sp = 1.35 * Math.min(1, stepOut.current / 0.4 + 0.2);
      pos.current.x += Math.sin(facing.current) * sp * dt;
      pos.current.z += Math.cos(facing.current) * sp * dt;
      anim.current = stepOut.current > 0.05 ? 1 : 0;
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
      if (s.moving) anim.current = run || s.speed > 2.6 ? 2 : 1;
      else {
        const e = w.emote;
        anim.current = e && e.until > Date.now() ? e.id : 0;
      }
    }

    // collisions: plaza edge (except through an open arena doorway), then round obstacles
    const r = Math.hypot(pos.current.x, pos.current.z);
    let limit = PLAZA_RADIUS;
    for (const p of PORTALS) {
      if (!p.href || (doorOpen[p.id] ?? 0) < 0.55) continue;
      const a = (p.angleDeg * Math.PI) / 180;
      const lateral = Math.abs(pos.current.x * Math.cos(a) + pos.current.z * Math.sin(a));
      if (lateral < DOOR.w / 2 - 0.35 && pos.current.x * Math.sin(a) - pos.current.z * Math.cos(a) > 0) {
        limit = DOOR_RING + 0.4;
        // crossing the threshold of an open door: fade and go inside (no button needed; E stays as a fallback)
        if (r > DOOR_RING - 0.9 && !entering && performance.now() > reentryAfter.current) {
          // coming back from the room puts you just outside this door, facing the plaza
          // a few steps out from the door (camera stays on the plaza side, no prompt to walk straight back in)
          saveDoorPose({ x: Math.sin(a) * (DOOR_RING - 4.5), z: -Math.cos(a) * (DOOR_RING - 4.5), yaw: -a });
          useTransition.getState().enter(p.href);
        }
      }
    }
    if (r > limit) pos.current.multiplyScalar(limit / r);
    // other people are solid: walk around them (soft push, no passing through)
    for (const op of Object.values(w.players)) {
      const dx = pos.current.x - op.x / 100;
      const dz = pos.current.z - op.z / 100;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.64 && dist > 1e-4) {
        pos.current.x = op.x / 100 + (dx / dist) * 0.64;
        pos.current.z = op.z / 100 + (dz / dist) * 0.64;
      }
    }
    for (const c of COLLIDERS) {
      const dx = pos.current.x - c.x;
      const dz = pos.current.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.r && d > 0.0001) {
        pos.current.x = c.x + (dx / d) * c.r;
        pos.current.z = c.z + (dz / d) * c.r;
      }
    }

    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // third-person camera (DESIGN-SPEC §8.1)
    if (!inXR) {
      // short camera push towards the doorway while the door transition fades out
      const d = entering ? Math.min(cameraState.distance, 3) : cameraState.distance;
      const cx = pos.current.x + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * d;
      const cz = pos.current.z + Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * d;
      let cy = 1.6 + Math.sin(cameraState.pitch) * d;
      // keep the camera below the entry gate canopy (soffit at ~5.2 m) instead of clipping through it
      if (Math.abs(cx) < 10 && Math.abs(cz - ENTRY_Z) < 4.6) cy = Math.min(cy, 4.6);
      camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 8));
      camera.lookAt(pos.current.x, 1.5, pos.current.z);
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
    lookAt.current = speaker ? lookTarget.set(speaker.x / 100, 1.6, speaker.z / 100) : null;

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
        />
      </group>
    </>
  );
}

function RemoteAvatar({ id, tier }: { id: string; tier: Tier }) {
  const p = useWorld((s) => s.players[id]);
  const lookStr = p?.look;
  const color = p?.color ?? "#3DA9FC";
  // `look` is optional on the wire; without it the avatar falls back to the default look in the player's colour
  const bodyType = p?.bodyType;
  const look = useMemo(() => {
    const l = decodeLook(lookStr, color);
    // server may send the chosen body type on its own (no full look yet)
    if (!lookStr && (bodyType === "feminine" || bodyType === "masculine" || bodyType === "neutral"))
      l.bodyType = bodyType;
    return l;
  }, [lookStr, color, bodyType]);
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const lookAt = useRef<THREE.Vector3 | null>(null);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const cur = useWorld.getState().players[id];
    if (!cur || !group.current) return;
    // remote avatars glance at the local player while they are speaking nearby
    const near = Math.hypot(selfPose.x - group.current.position.x, selfPose.z - group.current.position.z) < 5;
    lookAt.current =
      near && useVoice.getState().selfTalking ? lookTarget.set(selfPose.x, 1.6, selfPose.z) : null;
    const k = Math.min(1, dt * 10); // interpolation
    group.current.position.x += (cur.x / 100 - group.current.position.x) * k;
    group.current.position.z += (cur.z / 100 - group.current.position.z) * k;
    const yaw = (cur.yaw / 65535) * Math.PI * 2;
    let diff = yaw - group.current.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    group.current.rotation.y += diff * k;
    anim.current = cur.emoteUntil && cur.emoteUntil > Date.now() ? cur.anim : cur.anim >= 10 ? 0 : cur.anim;
  });
  if (!p) return null;
  return (
    <group ref={group} position={[p.x / 100, 0, p.z / 100]}>
      <Avatar
        look={look}
        name={p.name}
        level={p.level}
        animRef={anim}
        lod
        shadows={tier !== "lite"}
        quality={tier}
        voiceId={id}
        lookAtRef={lookAt}
      />
    </group>
  );
}

export function RemotePlayers({ tier = "standard" }: { tier?: Tier }) {
  const ids = useWorld((s) => Object.keys(s.players).join(","));
  return (
    <>
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <RemoteAvatar key={id} id={id} tier={tier} />
        ))}
    </>
  );
}
