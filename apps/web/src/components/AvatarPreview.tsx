"use client";
import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { Avatar } from "@/world/Avatar";
import type { AvatarLook } from "@/world/outfits";

export type PreviewFocus = "body" | "face";

/** Eye height per body type (m), for the face close-up. */
const EYES_Y: Record<string, number> = { feminine: 1.6, masculine: 1.675, neutral: 1.67 };
const _target = new THREE.Vector3();
const _pos = new THREE.Vector3();

/** Eases the camera between the full-body framing and a head-and-shoulders close-up (Face tab). */
function CameraRig({ focus, bodyType }: { focus: PreviewFocus; bodyType: string }) {
  const camera = useThree((s) => s.camera);
  const cur = useRef({ y: 0.92, d: 4.8, py: 1.1 });
  useFrame((_, dt) => {
    const face = focus === "face";
    const ty = face ? (EYES_Y[bodyType] ?? 1.66) - 0.04 : 0.92;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
    const c = cur.current;
    c.y += (ty - c.y) * k;
    c.d += ((face ? 1.05 : 4.8) - c.d) * k;
    c.py += ((face ? ty + 0.02 : 1.1) - c.py) * k;
    camera.position.copy(_pos.set(0, c.py, c.d));
    camera.lookAt(_target.set(0, c.y, 0));
  });
  return null;
}

/** Dev / screenshot hook: `window.__gkPreview = { yaw }` holds the turntable at a fixed angle (not in production). */
const devYaw = () => (process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? (window as unknown as { __gkPreview?: { yaw?: number } }).__gkPreview?.yaw : undefined);

/** Small studio scene for the avatar creator: turntable + drag to rotate, local Lightformer environment (offline). */
function Turntable({ look, emote, focus }: { look: AvatarLook; emote: number; focus: PreviewFocus }) {
  const g = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const drag = useRef({ on: false, x: 0, v: 0.25 });
  useEffect(() => {
    anim.current = emote;
    if (!emote) return;
    const t = setTimeout(() => (anim.current = 0), 2500);
    return () => clearTimeout(t);
  }, [emote]);
  useFrame((_, dt) => {
    if (!g.current) return;
    const fixed = devYaw();
    if (typeof fixed === "number") {
      g.current.rotation.y = fixed;
      return;
    }
    // close-up: no auto spin (drag to turn); full body: slow turntable
    const spin = focus === "face" ? 0 : 0.25;
    if (!drag.current.on) drag.current.v += (spin - drag.current.v) * Math.min(1, dt * (focus === "face" ? 3 : 0.8));
    g.current.rotation.y += drag.current.v * dt;
  });
  return (
    <group
      ref={g}
      onPointerDown={(e) => {
        drag.current.on = true;
        drag.current.x = e.clientX;
        (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current.on || !g.current) return;
        g.current.rotation.y += (e.clientX - drag.current.x) * 0.012;
        drag.current.x = e.clientX;
        drag.current.v = 0;
      }}
      onPointerUp={() => (drag.current.on = false)}
      onPointerLeave={() => (drag.current.on = false)}
    >
      <Avatar look={look} animRef={anim} showTag={false} shadows />
      {/* invisible hit target so the whole figure is draggable */}
      <mesh position={[0, 0.9, 0]} visible={false}>
        <cylinderGeometry args={[0.5, 0.5, 1.9, 8]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

export default function AvatarPreview({ look, emote = 0, focus = "body" }: { look: AvatarLook; emote?: number; focus?: PreviewFocus }) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 1.75]}
      camera={{ fov: 28, position: [0, 1.1, 4.8], near: 0.1, far: 50 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ camera }) => camera.lookAt(0, 0.92, 0)}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={["#1a1b1e"]} />
      <hemisphereLight args={["#dfe9ff", "#2a2440", 0.7]} />
      <directionalLight position={[2.5, 4, 3]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
      <directionalLight position={[-3, 2, -2]} intensity={0.9} color="#9fc4ff" />
      <Environment frames={1} resolution={64}>
        <Lightformer form="rect" intensity={3} position={[2, 3, 3]} scale={[4, 4, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.5} color="#9fc4ff" position={[-3, 2, -1]} scale={[3, 3, 1]} target={[0, 1, 0]} />
        <Lightformer form="ring" intensity={2} color="#FFC83D" position={[0, 4, -3]} scale={2} target={[0, 1, 0]} />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.1, 48]} />
        <meshStandardMaterial color="#232a52" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[1.05, 1.1, 64]} />
        <meshBasicMaterial color={new THREE.Color("#3DA9FC").multiplyScalar(1.5)} toneMapped={false} />
      </mesh>
      <CameraRig focus={focus} bodyType={look.bodyType} />
      <Turntable look={look} emote={emote} focus={focus} />
    </Canvas>
  );
}
