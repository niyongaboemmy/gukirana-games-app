"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { selfPose, useWorld } from "@/lib/world-store";
import { useRoom } from "./room-store";
import type { HallLayout } from "./layouts";
import { GltfInstances, Instanced, model, type Xform } from "./interior-kit";
import { uiAudio } from "@/lib/audio";
import { PlazaGlimpse } from "./PlazaGlimpse";

const FONT = "/fonts/Baloo2.ttf";
/**
 * Door operator (like a real sensor-driven sliding door): latched open / closed with hysteresis, so standing near the
 * door never makes the leaves hover or replay the whoosh. Opens when you are within OPEN_R and walking towards it
 * (or already in the doorway, or leaving); closes once you have been beyond CLOSE_R for CLOSE_DELAY seconds.
 */
const OPEN_R = 3.2;
const DOORWAY_R = 1.6;
const CLOSE_R = 4.8;
const CLOSE_DELAY = 0.6;
const OPEN_S = 0.9;
const CLOSE_S = 1.2;
const WHOOSH_COOLDOWN = 1.5;

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

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Surface-mounted automatic sliding door on the inside face of the entrance wall (`z` = the wall face). The two leaves
 * run on their own tracks in front of the wall (left 10 cm, right 13 cm into the room: never in the wall's plane, never
 * coplanar with each other), under a header track + operator housing that also stands clear of the wall. Glass is one
 * shared low-opacity physical material with a fixed render order; every other part is opaque (no sorting flicker).
 */
export function AutoDoor({ x, z, w, color }: { x: number; z: number; w: number; color: string }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const op = useRef({ latched: false, progress: 0, init: false, farFor: 0, lastDist: 0, approach: 0, lastWhoosh: -99, t: 0 });
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const o = op.current;
    o.t += dt;
    const dist = Math.hypot(selfPose.x - x, selfPose.z - z);
    // other people use the door too: it opens for anyone near it, and only closes once nobody is
    let others = Infinity;
    for (const p of Object.values(useWorld.getState().players)) others = Math.min(others, Math.hypot(p.x / 100 - x, p.z / 100 - z));
    if (!o.init) {
      // arriving through this door: it is already open behind you
      o.init = true;
      o.lastDist = dist;
      o.latched = dist < DOORWAY_R;
      o.progress = o.latched ? 1 : 0;
    }
    // approach speed (m/s towards the door), smoothed so a single jittery frame never triggers the sensor
    const v = (o.lastDist - dist) / Math.max(dt, 1e-3);
    o.lastDist = dist;
    o.approach += (v - o.approach) * Math.min(1, dt * 6);
    const leaving = useRoom.getState().leaving;
    if (!o.latched) {
      if (dist < DOORWAY_R || (dist < OPEN_R && o.approach > 0.25) || (leaving && dist < 6) || others < OPEN_R - 0.6) o.latched = true;
    } else {
      o.farFor = dist > CLOSE_R && others > CLOSE_R && !leaving ? o.farFor + dt : 0;
      if (o.farFor > CLOSE_DELAY) o.latched = false;
    }
    const before = o.progress;
    o.progress = THREE.MathUtils.clamp(o.progress + (o.latched ? dt / OPEN_S : -dt / CLOSE_S), 0, 1);
    if (o.progress !== before && (before === 0 || before === 1) && o.t - o.lastWhoosh > WHOOSH_COOLDOWN) {
      o.lastWhoosh = o.t;
      whoosh(o.latched);
    }
    const eased = easeInOutCubic(o.progress);
    const slide = eased * (w / 2 - 0.06);
    if (left.current) left.current.position.x = -w / 4 - slide;
    if (right.current) right.current.position.x = w / 4 + slide;
    const isOpen = eased >= 0.55; // collision gate for walking out (the leave flow relies on it)
    if (isOpen !== useRoom.getState().doorOpen) useRoom.getState().set({ doorOpen: isOpen });
  });
  const mats = useMemo(
    () => ({
      glass: new THREE.MeshPhysicalMaterial({ color: "#c5d3da", transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0, reflectivity: 0.6, envMapIntensity: 1.3, depthWrite: false }),
      alu: new THREE.MeshStandardMaterial({ color: "#b9bec6", metalness: 0.85, roughness: 0.3 }),
      steel: new THREE.MeshStandardMaterial({ color: "#d6d9de", metalness: 0.95, roughness: 0.15 }),
      // satin-frosted safety band, tinted towards the hall colour (opaque: never sorted against the glass)
      band: new THREE.MeshStandardMaterial({ color: new THREE.Color("#e9eef0").lerp(new THREE.Color(color), 0.35), roughness: 0.6, metalness: 0 }),
      housing: new THREE.MeshStandardMaterial({ color: "#2a2d34", metalness: 0.7, roughness: 0.35 }),
    }),
    [color],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const H = 2.6; // glass height (between the rails)
  const lw = w / 2; // leaf width
  const leaf = (
    <>
      <mesh material={mats.glass} renderOrder={3}>
        <boxGeometry args={[lw - 0.1, H, 0.012]} />
      </mesh>
      {/* aluminium stiles + top / bottom rails framing the glass (no shared faces with it) */}
      {[-1, 1].map((sd) => (
        <mesh key={sd} material={mats.alu} position={[sd * (lw / 2 - 0.025), 0, 0]}>
          <boxGeometry args={[0.05, H + 0.16, 0.044]} />
        </mesh>
      ))}
      {[-1, 1].map((sd) => (
        <mesh key={`r${sd}`} material={mats.alu} position={[0, sd * (H / 2 + 0.04), 0]}>
          <boxGeometry args={[lw - 0.1, 0.08, 0.04]} />
        </mesh>
      ))}
      {/* vertical pull handle on the room side, near the meeting edge */}
      <mesh material={mats.steel} position={[0, 0, -0.05]}>
        <cylinderGeometry args={[0.014, 0.014, 0.9, 10]} />
      </mesh>
      {/* frosted manifestation band (safety marking) on the room-side face, 2 mm proud of the glass */}
      <mesh material={mats.band} position={[0, -0.25, -0.009]}>
        <boxGeometry args={[lw - 0.1, 0.08, 0.002]} />
      </mesh>
    </>
  );
  // leaves hang so their bottom rail clears the floor by 1 cm
  const cy = 0.01 + 0.08 + H / 2;
  return (
    <group position={[x, 0, z]}>
      <group ref={left} position={[-w / 4, cy, -0.1]}>
        {leaf}
      </group>
      <group ref={right} position={[w / 4, cy, -0.13]}>
        {leaf}
      </group>
      {/* header track (full travel) + operator housing, standing clear of the wall face */}
      <mesh material={mats.alu} position={[0, cy + H / 2 + 0.13, -0.115]}>
        <boxGeometry args={[w * 2 - 0.1, 0.05, 0.08]} />
      </mesh>
      <mesh material={mats.housing} position={[0, cy + H / 2 + 0.3, -0.13]}>
        <boxGeometry args={[w * 2, 0.28, 0.2]} />
      </mesh>
      <mesh position={[0, cy + H / 2 + 0.18, -0.235]}>
        <boxGeometry args={[0.18, 0.04, 0.012]} />
        <meshStandardMaterial color="#111" emissive="#ff2a2a" emissiveIntensity={0.8} />
      </mesh>
      {/* illuminated EXIT sign above the operator */}
      <mesh position={[0, cy + H / 2 + 0.72, -0.06]}>
        <boxGeometry args={[0.9, 0.3, 0.08]} />
        <meshStandardMaterial color="#0d7a3e" emissive="#16a34a" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <Text font={FONT} fontSize={0.17} position={[0, cy + H / 2 + 0.71, -0.105]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle">
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
      {/* basalt threshold through the wall opening (the plaza impostor starts 35 cm outside the wall face) */}
      <mesh position={[layout.door.x, 0.003, d / 2 + 0.24]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[layout.door.w + 0.2, 0.52]} />
        <meshStandardMaterial color="#3a3836" roughness={0.85} />
      </mesh>
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
