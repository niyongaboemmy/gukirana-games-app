"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { useRoom } from "./room-store";
import type { HallLayout } from "./layouts";
import { GltfInstances, Instanced, model, type Xform } from "./interior-kit";
import { uiAudio } from "@/lib/audio";
import { PlazaGlimpse } from "./PlazaGlimpse";

const FONT = "/fonts/Baloo2.ttf";
/** The doors start sliding at ~4.2 m and are fully open by ~2 m, so you can walk straight in without stopping. */
const DOOR_START = 4.2;
const DOOR_FULL = 2.0;

/* ---------------- door chime: a soft pneumatic "whoosh" (filtered noise, WebAudio, no asset) ---------------- */
function whoosh(opening: boolean) {
  try {
    const ctx = uiAudio();
    if (!ctx) return;
    const len = 0.7;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647; // cosmetic noise, not game randomness
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.Q.value = 0.9;
    const t = ctx.currentTime;
    filt.frequency.setValueAtTime(opening ? 380 : 900, t);
    filt.frequency.exponentialRampToValueAtTime(opening ? 1100 : 320, t + len);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + len);
  } catch {
    /* audio unavailable: silent doors */
  }
}

/* ---------------- auto sliding door ---------------- */

export function AutoDoor({ x, z, w, color }: { x: number; z: number; w: number; color: string }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(0);
  const wasOpening = useRef(false);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const dist = Math.hypot(selfPose.x - x, selfPose.z - z);
    // target opening follows distance (smoothstep), the panels ease towards it (fast enough to beat a running player)
    const k = THREE.MathUtils.clamp((DOOR_START - dist) / (DOOR_START - DOOR_FULL), 0, 1);
    const target = k * k * (3 - 2 * k);
    const rate = target > open.current ? 7 : 2.5;
    open.current += (target - open.current) * Math.min(1, dt * rate);
    const opening = target > 0.05;
    if (opening !== wasOpening.current) {
      wasOpening.current = opening;
      whoosh(opening);
    }
    const slide = open.current * (w / 2 - 0.04);
    if (left.current) left.current.position.x = -w / 4 - slide;
    if (right.current) right.current.position.x = w / 4 + slide;
    const isOpen = open.current > 0.55;
    if (isOpen !== useRoom.getState().doorOpen) useRoom.getState().set({ doorOpen: isOpen });
  });
  const panel = (
    <>
      <mesh>
        <boxGeometry args={[w / 2, 2.7, 0.025]} />
        <meshStandardMaterial
          color="#9fb7c4"
          transparent
          opacity={0.22}
          roughness={0.04}
          metalness={0.2}
          envMapIntensity={1.5}
          depthWrite={false}
        />
      </mesh>
      {/* aluminium stiles + rails */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * w) / 4 - s * 0.025, 0, 0]}>
          <boxGeometry args={[0.05, 2.7, 0.05]} />
          <meshStandardMaterial color="#b9bec6" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, -1.33, 0]}>
        <boxGeometry args={[w / 2, 0.06, 0.05]} />
        <meshStandardMaterial color="#b9bec6" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* vertical pull handle (stainless) on the meeting edge */}
      <mesh position={[0, 0, 0.05]}>
        <cylinderGeometry args={[0.014, 0.014, 0.9, 10]} />
        <meshStandardMaterial color="#d6d9de" metalness={0.95} roughness={0.15} />
      </mesh>
      {/* frosted manifestation band (safety marking) */}
      <mesh position={[0, -0.25, 0.016]}>
        <boxGeometry args={[w / 2 - 0.06, 0.08, 0.004]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          transparent
          opacity={0.85}
        />
      </mesh>
    </>
  );
  return (
    <group position={[x, 1.35, z]}>
      <group ref={left}>{panel}</group>
      <group ref={right}>{panel}</group>
      {/* operator housing + sensor */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[w + 0.4, 0.3, 0.32]} />
        <meshStandardMaterial color="#2a2d34" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.36, 0.17]}>
        <boxGeometry args={[0.18, 0.04, 0.03]} />
        <meshStandardMaterial color="#111" emissive="#ff2a2a" emissiveIntensity={0.8} />
      </mesh>
      {/* illuminated EXIT sign above the operator */}
      <mesh position={[0, 1.92, -0.2]}>
        <boxGeometry args={[0.9, 0.3, 0.08]} />
        <meshStandardMaterial color="#0d7a3e" emissive="#16a34a" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <Text
        font={FONT}
        fontSize={0.17}
        position={[0, 1.91, -0.245]}
        rotation={[0, Math.PI, 0]}
        anchorX="center"
        anchorY="middle"
      >
        EXIT · PLAZA
        <meshBasicMaterial color={[2.4, 2.4, 2.4]} toneMapped={false} />
      </Text>
    </group>
  );
}

/* ---------------- window wall (north) ---------------- */

/**
 * Full-width glazing: low sill, slim black aluminium mullions + transom, near-clear glass with environment
 * reflections (no transmission pass — cheap). The real landscape is the scene background (OutdoorView).
 */
export function WindowWall({
  w,
  d,
  h,
  sill = 0.55,
  head = 4.05,
  glassTint = "#a9c2cf",
  glassOpacity = 0.1,
  frameColor = "#1d1f24",
  children,
}: {
  w: number;
  d: number;
  h: number;
  sill?: number;
  head?: number;
  glassTint?: string;
  glassOpacity?: number;
  frameColor?: string;
  children: React.ReactNode; // wall material for the sill / header
}) {
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mull = useMemo<Xform[]>(() => {
    const out: Xform[] = [];
    const bays = 8;
    for (let i = 0; i <= bays; i++)
      out.push({ p: [-w / 2 + (i * w) / bays, (sill + head) / 2, 0.02], s: [0.07, head - sill, 0.14] });
    out.push({ p: [0, sill + 0.03, 0.02], s: [w, 0.06, 0.16] });
    out.push({ p: [0, head - 0.03, 0.02], s: [w, 0.06, 0.16] });
    out.push({ p: [0, 3.05, 0.02], s: [w, 0.05, 0.12] }); // transom
    return out;
  }, [w, sill, head]);
  return (
    <group position={[0, 0, -d / 2]}>
      <mesh position={[0, sill / 2, -0.1]} receiveShadow>
        <boxGeometry args={[w, sill, 0.2]} />
        {children}
      </mesh>
      <mesh position={[0, (h + head) / 2, -0.1]}>
        <boxGeometry args={[w, h - head, 0.2]} />
        {children}
      </mesh>
      {/* window board */}
      <mesh position={[0, sill + 0.01, 0.08]} receiveShadow>
        <boxGeometry args={[w, 0.03, 0.3]} />
        <meshStandardMaterial color="#d9d4ca" roughness={0.35} />
      </mesh>
      <mesh position={[0, (sill + head) / 2, -0.04]} renderOrder={2}>
        <planeGeometry args={[w, head - sill]} />
        <meshStandardMaterial
          color={glassTint}
          transparent
          opacity={glassOpacity}
          roughness={0.03}
          metalness={0.4}
          envMapIntensity={1.2}
          depthWrite={false}
        />
      </mesh>
      <Instanced geometry={box} items={mull}>
        <meshStandardMaterial color={frameColor} metalness={0.6} roughness={0.35} />
      </Instanced>
    </group>
  );
}

/* ---------------- south wall with the entrance ---------------- */

export function SouthWall({ layout, children }: { layout: HallLayout; children: React.ReactNode }) {
  const { w, d, h } = layout.size;
  const half = layout.door.w / 2;
  const seg = (w - layout.door.w) / 2;
  return (
    <group position={[0, h / 2, d / 2]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (half + seg / 2), 0, 0.15]} receiveShadow>
          <boxGeometry args={[seg, h, 0.3]} />
          {children}
        </mesh>
      ))}
      <mesh position={[0, 1.45, 0.15]}>
        <boxGeometry args={[layout.door.w, h - 2.9, 0.3]} />
        {children}
      </mesh>
      {/* door frame trim */}
      {[-1, 1].map((s) => (
        <mesh key={`j${s}`} position={[s * (half + 0.04), -h / 2 + 1.45, 0.15]}>
          <boxGeometry args={[0.08, 2.9, 0.34]} />
          <meshStandardMaterial color="#2a2d34" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- what you glimpse through the glass doors ---------------- */

/**
 * Right outside the entrance (seen only through the glass; no porch to walk on): the plaza itself at its true bearing
 * (paving, fountain + Agaseke, ring planters, the arena drum and the neighbouring halls; PlazaGlimpse) and a pair of
 * potted plants flanking the door.
 */
export function DoorGlimpse({ layout, lite = false }: { layout: HallLayout; lite?: boolean }) {
  const { d } = layout.size;
  const z0 = d / 2 + 0.3;
  return (
    <group>
      <PlazaGlimpse layout={layout} lite={lite} />
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [layout.door.x - 2.2, 0, z0 + 1.6], s: 1.7, r: 0.4 },
          { p: [layout.door.x + 2.2, 0, z0 + 1.6], s: 1.7, r: 2.2 },
        ]}
      />
    </group>
  );
}
