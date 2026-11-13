"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { XROrigin, useXR } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "../Avatar";
import { BODY_TYPES } from "../outfits";
import { clearHandoff, crossTo, peekHandoff, useStage } from "../stage";
import { ENTRY_Z, PLAZA_RADIUS } from "../layout";
import { GATE_Z, INSIDE, KIOSK, STAND, WARDROBE } from "./Gate";
import { useGate } from "./gate-store";
import { freePoint, GATE_OBSTACLES, resolve } from "../obstacles";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { lookOf, useProfile } from "@/lib/profile-store";
import { selfPose, useWorld } from "@/lib/world-store";
import { clearPositions } from "@/lib/return-point";
import { autoFollow, nav, onReleaseInput, pointerNav, steer, TargetMarker } from "../navigation";

const FONT = "/fonts/Baloo2.ttf";

/** Shot list per step: avatar target, camera position, camera look-at (screens only; VR moves the XR origin). */
const SHOTS = {
  arriveFrom: { cam: new THREE.Vector3(18, 26, GATE_Z + 52), look: new THREE.Vector3(0, 4, GATE_Z) },
  kiosk: { cam: new THREE.Vector3(0.55, 1.8, GATE_Z + 4.5), look: new THREE.Vector3(-0.75, 1.22, GATE_Z + 1.9) },
  wardrobe: { cam: new THREE.Vector3(1.6, 1.75, GATE_Z - 5.4), look: new THREE.Vector3(4.6, 1.05, GATE_Z - 6.5) },
  /** signing out: the plaza's entry gate seen from beside the avenue as the person walks away out of frame */
  farewell: { cam: new THREE.Vector3(-3.4, 1.9, ENTRY_Z + 9.5), look: new THREE.Vector3(0.6, 1.5, ENTRY_Z - 0.5) },
};
/** arrival fly-in after the reveal (ms) */
const ARRIVE_MS = 2200;
/** inside the plaza ring: the plaza's own controller takes over the walk-in here */
const PLAZA_IN_Z = PLAZA_RADIUS - 0.4;
/** sign-out: the camera's drift back down the avenue to the arrival gate */
const FLIGHT_MS = 3200;
/** walking pace through the gate (m/s); the plaza step-out carries the same stride on across the cut */
const GATE_WALK = 2.4;
const LEAVE_WALK = 2.0; // a purposeful stride out (the walk-out from the kiosk lasts ≈ 6–7 s)

function useLocalLook() {
  const p = useProfile();
  return useMemo(() => lookOf(p), [p]);
}

const gateKeys = new Set<string>();
onReleaseInput(() => gateKeys.clear());

/**
 * Moves the arriving avatar: fly-in → FREE ROAM while signing in (the player keeps walking; the tablet is in hand) →
 * walk through the opened turnstiles → (wardrobe) → the whole way up the avenue and through the plaza's entry gate,
 * where the plaza's controller carries on with the same pose. Signing out runs it in reverse from the entry gate.
 */
function Rig() {
  const step = useGate((s) => s.step);
  const set = useGate((s) => s.set);
  const isNew = useGate((s) => s.isNew);
  const inXR = useXR((s) => s.session != null);
  const look = useLocalLook();
  const name = useProfile((s) => s.name);
  const { camera } = useThree();
  const avatar = useRef<THREE.Group>(null);
  const origin = useRef<THREE.Group>(null);
  const anim = useRef(0);
  // signing out arrives with a hand-off: the person mid-walk towards / through the turnstiles, camera behind
  const [hand] = useState(() => peekHandoff("gate"));
  useEffect(() => clearHandoff("gate"), []);
  // first visit: a few steps short of the kiosk (the arrival is a short fly-in once the scene is drawing)
  const pos = useRef(hand ? new THREE.Vector3(hand.x, 0, hand.z) : new THREE.Vector3(STAND.x + 0.3, 0, GATE_Z + 6.8));
  const t0 = useRef(performance.now());
  // intro skipped (remembered): open straight on the kiosk shot instead of the far fly-in start
  const skipStart = !hand && useGate.getState().step === "id";
  const camPos = useRef(hand?.cam ? new THREE.Vector3(...hand.cam) : (skipStart ? SHOTS.kiosk : SHOTS.arriveFrom).cam.clone());
  const camLook = useRef(hand?.look ? new THREE.Vector3(...hand.look) : (skipStart ? SHOTS.kiosk : SHOTS.arriveFrom).look.clone());
  const facing = useRef(hand?.yaw ?? Math.PI);
  /** the walk-in has been handed to the plaza's controller (inside the plaza ring, same pose) */
  const handed = useRef(false);
  const lastSpeed = useRef(0);
  /** sign-out: walking away ("out"), then the camera drifts to the arrival gate for the next visitor ("next") */
  const leave = useRef({ phase: "out" as "out" | "next", t0: 0, fromCam: new THREE.Vector3(), fromLook: new THREE.Vector3() });
  const orbit = useRef({ yaw: 0, pitch: 0.38, dist: 6.5 });
  const { gl } = useThree();

  // free roam while signing in: keyboard (ignored while typing on the tablet) + drag to look + wheel zoom
  useEffect(() => {
    const keys = gateKeys;
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };
    const down = (e: KeyboardEvent) => !typing() && keys.add(e.code);
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const el = gl.domElement;
    const stopPointer = pointerNav(
      el,
      () => camera,
      (dx, dy) => {
        orbit.current.yaw -= dx * 0.006;
        orbit.current.pitch = THREE.MathUtils.clamp(orbit.current.pitch + dy * 0.004, 0.1, 1.1);
      },
      (p) => freePoint({ x: THREE.MathUtils.clamp(p.x, -9, 9), z: THREE.MathUtils.clamp(p.z, GATE_Z + 1.3, GATE_Z + 22) }, GATE_OBSTACLES),
    );
    const blurTyping = () => (document.activeElement as HTMLElement | null)?.blur?.(); // tapping the world hands the keys back to walking
    el.addEventListener("pointerdown", blurTyping);
    const wheel = (e: WheelEvent) => (orbit.current.dist = THREE.MathUtils.clamp(orbit.current.dist + e.deltaY * 0.006, 2.5, 14));
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      stopPointer();
      el.removeEventListener("pointerdown", blurTyping);
      el.removeEventListener("wheel", wheel);
      keys.clear();
      nav.target = null;
    };
  }, [gl, camera]);

  useEffect(() => {
    t0.current = performance.now();
  }, [step]);

  // step timers: arrival → id; opening → setup / entering
  useEffect(() => {
    if (step === "opening") {
      const t = setTimeout(() => set({ step: isNew ? "setup" : "entering" }), 3000);
      return () => clearTimeout(t);
    }
  }, [step, isNew, set]);

  // the first frame already shows the hand-off camera (no ease from the default fly-in shot)
  useEffect(() => {
    if (!hand) return;
    camera.position.copy(camPos.current);
    camera.lookAt(camLook.current);
  }, [hand, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const since = (performance.now() - t0.current) / 1000;
    const free = !inXR && (step === "id" || step === "code");
    if (free) {
      // ---- free roam outside the turnstiles while the player types on the tablet ----
      const w = useWorld.getState();
      const run = w.input.run || gateKeys.has("ShiftLeft") || gateKeys.has("ShiftRight");
      const s = steer({ keys: gateKeys, joyX: w.input.x, joyY: w.input.y, camYaw: orbit.current.yaw, facing: facing.current, x: pos.current.x, z: pos.current.z, walkSpeed: ({ slow: 1.4, normal: 2.2, fast: 3.2 } as const)[w.speed] ?? 1.4, run, dt });
      pos.current.x += s.dx;
      pos.current.z += s.dz;
      facing.current = s.facing;
      autoFollow(orbit.current, s, dt);
      anim.current = s.moving ? (run || s.speed > 2.6 ? 2 : 1) : 0;
      // stay on the arrival side until the ID check passes; keep clear of the kiosk
      pos.current.x = THREE.MathUtils.clamp(pos.current.x, -9, 9);
      pos.current.z = THREE.MathUtils.clamp(pos.current.z, GATE_Z + 1.3, GATE_Z + 22);
      const kx = pos.current.x - KIOSK.x;
      const kz = pos.current.z - KIOSK.z;
      const kd = Math.hypot(kx, kz);
      if (kd < 0.7 && kd > 0.001) {
        pos.current.x = KIOSK.x + (kx / kd) * 0.7;
        pos.current.z = KIOSK.z + (kz / kd) * 0.7;
      }
      // booth, guard, pylons and forecourt flower beds are solid
      resolve(pos.current, GATE_OBSTACLES);
      if (avatar.current) {
        avatar.current.position.copy(pos.current);
        avatar.current.rotation.y = facing.current;
      }
      const o = orbit.current;
      const want = new THREE.Vector3(
        pos.current.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
        1.6 + Math.sin(o.pitch) * o.dist,
        pos.current.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
      );
      camPos.current.lerp(want, Math.min(1, dt * 5));
      camLook.current.lerp(new THREE.Vector3(pos.current.x, 1.35, pos.current.z), Math.min(1, dt * 6));
      camera.position.copy(camPos.current);
      camera.lookAt(camLook.current);
      selfPose.x = pos.current.x;
      selfPose.z = pos.current.z;
      selfPose.yaw = facing.current;
      return;
    }
    // avatar waypoint for this step
    let target = new THREE.Vector3(STAND.x, 0, STAND.z);
    let face = Math.PI; // facing north (−z)
    const p = pos.current;
    if (step === "arrive") {
      const ra = useStage.getState().revealAt;
      target = ra ? new THREE.Vector3(STAND.x, 0, STAND.z) : p.clone(); // walks up to the kiosk during the fly-in
      // the tablet slides in over the last ~0.8 s of the fly-in
      if (ra && performance.now() - Math.max(ra, t0.current) > ARRIVE_MS - 1000 && useGate.getState().step === "arrive") set({ step: "id" });
    }
    if (step === "id" || step === "code") face = Math.atan2(KIOSK.x - STAND.x, KIOSK.z - STAND.z);
    if (step === "setup") {
      target = new THREE.Vector3(WARDROBE.stand.x, 0, WARDROBE.stand.z);
      face = -Math.PI / 2; // face the camera, back to the lockers
    }
    // the walk in: through the arrival turnstiles, out of the compound, the whole way up the avenue, through the
    // plaza's entry gate and into the plaza (new players first stop at the wardrobe inside the compound)
    const walkingIn = step === "entering" || (step === "opening" && !isNew && since > 0.9);
    if (step === "opening" && (isNew || since <= 0.9)) target = since > 0.9 ? new THREE.Vector3(INSIDE.x, 0, INSIDE.z) : new THREE.Vector3(0, 0, GATE_Z + 2.2);
    if (walkingIn) {
      if (p.z > GATE_Z - 10 && Math.abs(p.x) > 0.6) target = new THREE.Vector3(0.3, 0, GATE_Z - 10);
      else if (p.z > ENTRY_Z + 3) target = new THREE.Vector3(0, 0, ENTRY_Z + 2.5);
      else target = new THREE.Vector3(0, 0, ENTRY_Z - 8);
    }
    const lv = leave.current;
    if (step === "leaving") {
      if (lv.phase === "next") target = new THREE.Vector3(STAND.x, 0, STAND.z);
      // signing out: line up with the entry gate's centre lane, out through the flaps (they swing outward), then on
      // down the avenue, away from the plaza
      else if (p.z < ENTRY_Z - 0.5 && Math.abs(p.x) > 0.25) target = new THREE.Vector3(0, 0, ENTRY_Z - 1.0);
      else if (p.z < ENTRY_Z + 2.4) target = new THREE.Vector3(0, 0, ENTRY_Z + 3);
      else target = new THREE.Vector3(0.5, 0, ENTRY_Z + 40);
      if (lv.phase === "next") face = Math.atan2(KIOSK.x - STAND.x, KIOSK.z - STAND.z);
    }
    const d = target.clone().sub(p);
    d.y = 0;
    const dist = d.length();
    const speed = step === "leaving" && lv.phase !== "next" ? LEAVE_WALK : GATE_WALK;
    if (dist > 0.05) {
      const stepLen = Math.min(dist, speed * dt);
      p.addScaledVector(d.normalize(), stepLen);
      lastSpeed.current = stepLen / Math.max(dt, 1e-3);
      face = Math.atan2(d.x, d.z);
      anim.current = 1;
    } else {
      anim.current = 0;
      lastSpeed.current = 0;
    }
    if (avatar.current) {
      avatar.current.position.copy(p);
      let diff = face - avatar.current.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      avatar.current.rotation.y += diff * Math.min(1, dt * 8);
      facing.current = avatar.current.rotation.y;
    }
    selfPose.x = p.x;
    selfPose.z = p.z;
    selfPose.yaw = facing.current;

    // inside the plaza ring: the plaza's controller carries on with exactly this pose, stride and camera (same
    // scene, same coordinates: a hand-over between controllers, nothing on screen changes)
    if (walkingIn && !handed.current && p.z < PLAZA_IN_Z) {
      handed.current = true;
      clearPositions(); // coming in through the gate: no stale "where you were"
      crossTo(
        "plaza",
        "/world",
        () => ({
          x: p.x,
          z: p.z,
          yaw: facing.current,
          speed: GATE_WALK,
          walk: 1.3,
          cam: [camera.position.x, camera.position.y, camera.position.z],
          look: [camLook.current.x, camLook.current.y, camLook.current.z],
        }),
        { dissolve: false },
      );
    }
    // signing out, once the person has walked off down the avenue (behind the farewell camera, out of frame): the
    // camera drifts back down the avenue to the arrival gate and the next visitor walks up to the tablet
    if (step === "leaving" && lv.phase === "out" && p.z > ENTRY_Z + 10.8) {
      lv.phase = "next";
      lv.t0 = performance.now();
      lv.fromCam.copy(camPos.current);
      lv.fromLook.copy(camLook.current);
      p.set(STAND.x + 0.3, 0, GATE_Z + 17);
      if (avatar.current) {
        avatar.current.position.copy(p);
        avatar.current.rotation.y = Math.PI;
      }
      facing.current = Math.PI;
    }
    if (step === "leaving" && lv.phase === "next" && dist <= 0.05 && performance.now() - lv.t0 > FLIGHT_MS) {
      const o = orbit.current;
      const dx = camera.position.x - p.x;
      const dz = camera.position.z - p.z;
      o.yaw = Math.atan2(dx, dz);
      o.dist = THREE.MathUtils.clamp(Math.hypot(dx, dz, camera.position.y - 1.6), 2.5, 14);
      o.pitch = THREE.MathUtils.clamp(Math.asin((camera.position.y - 1.6) / o.dist), 0.1, 1.1);
      lv.phase = "out";
      set({ step: "id" });
    }

    if (inXR) {
      // VR: origin stands at the kiosk / follows the avatar path (teleport-style steps, no smooth camera flights)
      if (origin.current) {
        const o = step === "setup" ? new THREE.Vector3(WARDROBE.stand.x - 0.6, 0, WARDROBE.stand.z) : step === "id" || step === "code" || step === "arrive" ? new THREE.Vector3(STAND.x, 0, STAND.z) : p;
        origin.current.position.copy(o);
        origin.current.rotation.y = step === "setup" ? -Math.PI / 2 : step === "id" || step === "code" || step === "arrive" ? Math.atan2(-(KIOSK.x - STAND.x), -(KIOSK.z - STAND.z)) : 0;
      }
      return;
    }
    // screens: camera choreography
    let wantPos = SHOTS.kiosk.cam;
    let wantLook = SHOTS.kiosk.look;
    let k = 2.2;
    if (step === "arrive") {
      // the fly-in plays only once the boot screen has revealed the drawing scene (never behind a loading state)
      const ra = useStage.getState().revealAt;
      const u = ra ? THREE.MathUtils.smootherstep(Math.min(1, (performance.now() - Math.max(ra, t0.current)) / ARRIVE_MS), 0, 1) : 0;
      wantPos = SHOTS.arriveFrom.cam.clone().lerp(SHOTS.kiosk.cam, u);
      wantLook = SHOTS.arriveFrom.look.clone().lerp(SHOTS.kiosk.look, u);
      k = 12;
    } else if (step === "opening" || step === "entering") {
      wantPos = p.clone().add(new THREE.Vector3(0.8, 2.3, 4.6));
      wantLook = p.clone().add(new THREE.Vector3(0, 1.3, -2));
    } else if (step === "leaving") {
      if (lv.phase === "next") {
        // a smooth drift back down the avenue (facing the gates all the way) onto the arrival kiosk
        const u = THREE.MathUtils.smootherstep(Math.min(1, (performance.now() - lv.t0) / FLIGHT_MS), 0, 1);
        camPos.current.lerpVectors(lv.fromCam, SHOTS.kiosk.cam, u);
        camLook.current.lerpVectors(lv.fromLook, SHOTS.kiosk.look, u);
        wantPos = camPos.current;
        wantLook = camLook.current;
        k = 60;
      } else if (p.z < ENTRY_Z + 2.6) {
        // follow from behind (on the plaza side) while they walk out through the lane
        wantPos = p.clone().add(new THREE.Vector3(-0.5, 2.25, -4.4));
        wantLook = p.clone().add(new THREE.Vector3(0, 1.25, 2.6));
        k = 3;
      } else {
        // then settle beside the avenue on the entry gate, watching them walk away out of frame
        wantPos = SHOTS.farewell.cam;
        wantLook = SHOTS.farewell.look;
        k = 1.4;
      }
    } else if (step === "setup") {
      wantPos = SHOTS.wardrobe.cam;
      wantLook = SHOTS.wardrobe.look;
      k = 1.6;
    }
    camPos.current.lerp(wantPos, Math.min(1, dt * k));
    camLook.current.lerp(wantLook, Math.min(1, dt * k));
    camera.position.copy(camPos.current);
    camera.lookAt(camLook.current);
  });

  return (
    <>
      {(step === "id" || step === "code") && <TargetMarker />}
      <group ref={avatar} position={pos.current.toArray()} rotation={[0, facing.current, 0]}>
        <Avatar look={look} name={name || undefined} animRef={anim} showTag={false} holdPhone={step === "id" || step === "code"} />
      </group>
      <XROrigin ref={origin} position={[STAND.x, 0, STAND.z]} />
    </>
  );
}

/** VR-only setup at the wardrobe: username via the world keyboard + explicit body-type choice; outfit later on any screen. */
function VRSetup() {
  const inXR = useXR((s) => s.session != null);
  const step = useGate((s) => s.step);
  const { username, error, busy, key, finishSetup } = useGate();
  const profile = useProfile();
  if (!inXR || step !== "setup") return null;
  return (
    <group position={[WARDROBE.stand.x - 1.6, 1.25, WARDROBE.stand.z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, 0.25, -0.01]}>
        <planeGeometry args={[1.1, 0.75]} />
        <meshBasicMaterial color="#101536" toneMapped={false} transparent opacity={0.92} />
      </mesh>
      <Text font={FONT} fontSize={0.06} position={[0, 0.55, 0]} anchorX="center" color="#ffffff">
        Welcome! Choose a username
      </Text>
      <Text font={FONT} fontSize={0.06} position={[0, 0.44, 0]} anchorX="center" color={username ? "#ffffff" : "#8a94a6"}>
        {username || "username"}
      </Text>
      <Text font={FONT} fontSize={0.035} position={[0, 0.36, 0]} anchorX="center" color="#c9d2e6">
        Your body style (you choose):
      </Text>
      {BODY_TYPES.map((b, i) => (
        <group key={b.id} position={[(i - 1) * 0.34, 0.27, 0]} onClick={(e) => (e.stopPropagation(), profile.setBodyType(b.id))}>
          <mesh>
            <planeGeometry args={[0.31, 0.09]} />
            <meshBasicMaterial color={profile.bodyType === b.id ? "#2F80ED" : "#22266E"} toneMapped={false} />
          </mesh>
          <Text font={FONT} fontSize={0.04} position={[0, 0, 0.002]} anchorX="center" anchorY="middle" color="#ffffff">
            {b.label}
          </Text>
        </group>
      ))}
      <group position={[0, 0.14, 0]} onClick={(e) => (e.stopPropagation(), void finishSetup(lookOf(useProfile.getState())))}>
        <mesh>
          <planeGeometry args={[0.5, 0.1]} />
          <meshBasicMaterial color={busy ? "#3a3f5c" : "#27AE60"} toneMapped={false} />
        </mesh>
        <Text font={FONT} fontSize={0.045} position={[0, 0, 0.002]} anchorX="center" anchorY="middle" color="#ffffff">
          {busy ? "Saving..." : "Enter the playground"}
        </Text>
      </group>
      {error && (
        <Text font={FONT} fontSize={0.03} position={[0, 0.05, 0]} anchorX="center" color="#ff8a8a" maxWidth={1}>
          {error}
        </Text>
      )}
      <group position={[0, -0.22, 0.12]} rotation={[-0.7, 0, 0]}>
        <VirtualKeyboard mode="full" onKey={(k) => (k === "OK" ? void finishSetup(lookOf(useProfile.getState())) : key(k))} width={0.9} />
      </group>
    </group>
  );
}

function XRWatch() {
  const inXR = useXR((s) => s.session != null);
  const set = useGate((s) => s.set);
  useEffect(() => set({ inXR }), [inXR, set]);
  return null;
}

/** The gate's people + controls inside the persistent stage (the gate structure itself stays in the outdoor area). */
export function GateActors() {
  return (
    <>
      <Rig />
      <VRSetup />
      <XRWatch />
    </>
  );
}
