"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { GAME_COLORS, worldMaterials, type Tier } from "../materials";
import { ENTRY_Z, EXIT_KIOSK, EXIT_RADIUS } from "../layout";
import { buildGate, Guard } from "./Gate";
import { selfPose } from "@/lib/world-store";
import { useGate } from "./gate-store";

const FONT = "/fonts/Baloo2.ttf";

/**
 * The entrance gate where players came in, at the plaza end of the avenue: same basalt pylons, canopy, turnstiles
 * and guard booth as the arrival gate, seen from inside. Players spawn just inside the turnstiles. The kiosk inside
 * is the exit: standing at it offers "Sign out at the gate" (prompt + confirm sheet: world/GateExitPrompt.tsx).
 */
/**
 * Centre-lane flaps: shut, except while someone walks in from the avenue (they swing in, towards the plaza) or
 * walks out signing off (they swing out, towards the avenue).
 */
function EntryFlaps() {
  const l = useRef<THREE.Group>(null);
  const r = useRef<THREE.Group>(null);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const step = useGate.getState().step;
    const passing = (step === "entering" || step === "opening" || step === "leaving") && Math.abs(selfPose.x) < 1.6 && Math.abs(selfPose.z - ENTRY_Z) < 4.5;
    const target = passing ? (step === "leaving" ? -1 : 1) * (Math.PI / 2 - 0.05) : 0;
    if (l.current) l.current.rotation.y += (target - l.current.rotation.y) * Math.min(1, dt * 5);
    if (r.current) r.current.rotation.y += (-target - r.current.rotation.y) * Math.min(1, dt * 5);
  });
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#dff3ff", transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.2 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group position={[0, 0.75, ENTRY_Z]} userData={{ noMerge: true }}>
      <group ref={l} position={[-0.62, 0, 0]}>
        <mesh material={mat} position={[0.3, 0, 0]}>
          <boxGeometry args={[0.6, 0.85, 0.025]} />
        </mesh>
      </group>
      <group ref={r} position={[0.62, 0, 0]}>
        <mesh material={mat} position={[-0.3, 0, 0]}>
          <boxGeometry args={[0.6, 0.85, 0.025]} />
        </mesh>
      </group>
    </group>
  );
}

export function EntryGate({ tier }: { tier: Tier }) {
  const geos = useMemo(() => buildGate(tier, ENTRY_Z, "entry", EXIT_KIOSK), [tier]);
  const mats = useMemo(() => worldMaterials(tier), [tier]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const idle = useMemo(() => new THREE.Color("#22266E"), []);
  const lit = useMemo(() => new THREE.Color(GAME_COLORS.sky).multiplyScalar(0.8), []);
  useFrame((_, dt) => {
    const near = Math.hypot(selfPose.x - EXIT_KIOSK.x, selfPose.z - EXIT_KIOSK.z) < EXIT_RADIUS;
    glow.current?.color.lerp(near ? lit : idle, Math.min(1, dt * 5));
  });
  return (
    <group>
      {[...geos.entries()].map(([key, g]) => {
        const m = mats[key];
        if (!m) return null;
        const unlit = m instanceof THREE.MeshBasicMaterial;
        return <mesh key={key} geometry={g} material={m} castShadow={!unlit && !m.transparent && tier !== "lite"} receiveShadow={!unlit && tier !== "lite"} />;
      })}
      <EntryFlaps />
      {/* exit kiosk screen */}
      <group position={[EXIT_KIOSK.x, 0, EXIT_KIOSK.z]} rotation={[0, EXIT_KIOSK.rotY, 0]}>
        <group position={[0, 1.42, 0.025]} rotation={[-0.22, 0, 0]}>
          <mesh userData={{ noMerge: true }}>
            <planeGeometry args={[0.84, 0.58]} />
            <meshBasicMaterial ref={glow} color="#22266E" toneMapped={false} />
          </mesh>
          <Text font={FONT} fontSize={0.04} color="#FFC83D" position={[0, 0.2, 0.002]} anchorX="center" letterSpacing={0.08}>
            GUKIRANA PLAYGROUND
          </Text>
          <Text font={FONT} fontSize={0.085} color="#ffffff" position={[0, 0.07, 0.002]} anchorX="center">
            Exit · Sign out
          </Text>
          <Text font={FONT} fontSize={0.045} color="#c9d2e6" position={[0, -0.06, 0.002]} anchorX="center">
            Murabeho! See you soon
          </Text>
        </group>
      </group>
      {/* inner canopy sign */}
      <Text font={FONT} fontSize={0.42} position={[0, 5.0, ENTRY_Z - 4.3]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
        EXIT · SIGN OUT AT THE KIOSK
        <meshBasicMaterial color={new THREE.Color("#ffffff").multiplyScalar(1.3)} toneMapped={false} />
      </Text>
      {/* security guard on duty (non-player staff, never in player lists) */}
      <Guard x={4.4} z={ENTRY_Z - 2.3} rotY={Math.PI + 0.25} tier={tier} />
    </group>
  );
}
