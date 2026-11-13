"use client";
import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { Avatar } from "@/world/Avatar";
import type { AvatarLook } from "@/world/outfits";

/** Small studio scene for the avatar creator: turntable + drag to rotate, local Lightformer environment (offline). */
function Turntable({ look, emote }: { look: AvatarLook; emote: number }) {
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
    if (!drag.current.on) drag.current.v += (0.25 - drag.current.v) * Math.min(1, dt * 0.8);
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

export default function AvatarPreview({ look, emote = 0 }: { look: AvatarLook; emote?: number }) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 1.75]}
      camera={{ fov: 28, position: [0, 1.1, 4.8], near: 0.1, far: 50 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ camera }) => camera.lookAt(0, 0.92, 0)}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={["#141833"]} />
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
      <Turntable look={look} emote={emote} />
    </Canvas>
  );
}
