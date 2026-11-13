"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor, Text } from "@react-three/drei";
import { XR, XROrigin, useXR } from "@react-three/xr";
import * as THREE from "three";
import { Plaza } from "../Plaza";
import { Effects } from "../Lighting";
import { Avatar } from "../Avatar";
import { BODY_TYPES } from "../outfits";
import type { Tier } from "../materials";
import { xrStore } from "../WorldCanvas";
import { Gate, GATE_Z, INSIDE, KIOSK, STAND, WARDROBE } from "./Gate";
import { useGate } from "./gate-store";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { lookOf, useProfile } from "@/lib/profile-store";
import { useWorld } from "@/lib/world-store";
import { autoFollow, nav, pointerNav, steer, TargetMarker } from "../navigation";

const FONT = "/fonts/Baloo2.ttf";

/** Shot list per step: avatar target, camera position, camera look-at (screens only; VR moves the XR origin). */
const SHOTS = {
  arriveFrom: { cam: new THREE.Vector3(18, 26, GATE_Z + 52), look: new THREE.Vector3(0, 4, GATE_Z) },
  kiosk: { cam: new THREE.Vector3(0.55, 1.8, GATE_Z + 4.5), look: new THREE.Vector3(-0.75, 1.22, GATE_Z + 1.9) },
  wardrobe: { cam: new THREE.Vector3(1.6, 1.75, GATE_Z - 5.4), look: new THREE.Vector3(4.6, 1.05, GATE_Z - 6.5) },
};

function useLocalLook() {
  const p = useProfile();
  return useMemo(() => lookOf(p), [p]);
}

const gateKeys = new Set<string>();

/**
 * Moves the arriving avatar: fly-in → FREE ROAM while signing in (the player keeps walking; the tablet is in hand) →
 * walk through the opened turnstiles → wardrobe / playground.
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
  const pos = useRef(new THREE.Vector3(STAND.x + 0.3, 0, GATE_Z + 17));
  const t0 = useRef(performance.now());
  const camPos = useRef(SHOTS.arriveFrom.cam.clone());
  const camLook = useRef(SHOTS.arriveFrom.look.clone());
  const facing = useRef(Math.PI);
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
      (p) => ({ x: THREE.MathUtils.clamp(p.x, -9, 9), z: THREE.MathUtils.clamp(p.z, GATE_Z + 1.3, GATE_Z + 22) }),
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
    if (step === "arrive") {
      const t = setTimeout(() => useGate.getState().step === "arrive" && set({ step: "id" }), 4200);
      return () => clearTimeout(t);
    }
    if (step === "opening") {
      const t = setTimeout(() => set({ step: isNew ? "setup" : "entering" }), 3000);
      return () => clearTimeout(t);
    }
  }, [step, isNew, set]);

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
      return;
    }
    // avatar waypoint for this step
    let target = new THREE.Vector3(STAND.x, 0, STAND.z);
    let face = Math.PI; // facing north (−z)
    if (step === "arrive") target = new THREE.Vector3(STAND.x, 0, STAND.z);
    if (step === "id" || step === "code") face = Math.atan2(KIOSK.x - STAND.x, KIOSK.z - STAND.z);
    if (step === "opening") target = since > 0.9 ? new THREE.Vector3(INSIDE.x, 0, INSIDE.z) : new THREE.Vector3(0, 0, GATE_Z + 2.2);
    if (step === "setup") {
      target = new THREE.Vector3(WARDROBE.stand.x, 0, WARDROBE.stand.z);
      face = -Math.PI / 2; // face the camera, back to the lockers
    }
    if (step === "entering") target = new THREE.Vector3(0, 0, GATE_Z - 26);
    const d = target.clone().sub(pos.current);
    d.y = 0;
    const dist = d.length();
    const speed = step === "entering" ? 3.2 : 2.4;
    if (dist > 0.05) {
      pos.current.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
      face = Math.atan2(d.x, d.z);
      anim.current = 1;
    } else anim.current = 0;
    if (avatar.current) {
      avatar.current.position.copy(pos.current);
      let diff = face - avatar.current.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      avatar.current.rotation.y += diff * Math.min(1, dt * 8);
      facing.current = avatar.current.rotation.y;
    }

    if (inXR) {
      // VR: origin stands at the kiosk / follows the avatar path (teleport-style steps, no smooth camera flights)
      if (origin.current) {
        const o = step === "setup" ? new THREE.Vector3(WARDROBE.stand.x - 0.6, 0, WARDROBE.stand.z) : step === "id" || step === "code" || step === "arrive" ? new THREE.Vector3(STAND.x, 0, STAND.z) : pos.current;
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
      const u = THREE.MathUtils.smootherstep(Math.min(1, since / 4), 0, 1);
      wantPos = SHOTS.arriveFrom.cam.clone().lerp(SHOTS.kiosk.cam, u);
      wantLook = SHOTS.arriveFrom.look.clone().lerp(SHOTS.kiosk.look, u);
      k = 12;
    } else if (step === "opening" || step === "entering") {
      wantPos = pos.current.clone().add(new THREE.Vector3(0.8, 2.3, 4.6));
      wantLook = pos.current.clone().add(new THREE.Vector3(0, 1.3, -2));
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
      <group ref={avatar} position={pos.current.toArray()}>
        <Avatar look={look} name={name || undefined} animRef={anim} showTag={false} />
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

function MaybeEffects({ enabled }: { enabled: boolean }) {
  const inXR = useXR((s) => s.session != null);
  return enabled && !inXR ? <Effects /> : null;
}

function pickTier(): Tier {
  const q = new URLSearchParams(location.search).get("tier");
  if (q === "lite" || q === "standard") return q;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "standard";
}

function GateScene({ tier }: { tier: Tier }) {
  const inXR = useXR((s) => s.session != null);
  return (
    <>
      <Plaza nearPortal={null} tier={tier} />
      <Gate tier={tier} inXR={inXR} />
      <Rig />
      <VRSetup />
      <XRWatch />
    </>
  );
}

export default function GateCanvas() {
  const tier = useMemo(pickTier, []);
  const [fx, setFx] = useState(tier === "standard");
  return (
    <Canvas
      shadows={tier === "lite" ? false : "percentage"}
      dpr={tier === "lite" ? [1, 1.25] : [1, 1.75]}
      camera={{ fov: 55, near: 0.1, far: 3200, position: SHOTS.arriveFrom.cam.toArray() }}
      gl={{ antialias: tier !== "lite", powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
      style={{ touchAction: "none" }}
    >
      <PerformanceMonitor onDecline={() => setFx(false)} onIncline={() => setFx(tier === "standard")} flipflops={3} onFallback={() => setFx(false)} />
      <AdaptiveDpr pixelated={false} />
      <XR store={xrStore}>
        <Suspense fallback={null}>
          <GateScene tier={tier} />
        </Suspense>
        <MaybeEffects enabled={fx} />
      </XR>
    </Canvas>
  );
}
