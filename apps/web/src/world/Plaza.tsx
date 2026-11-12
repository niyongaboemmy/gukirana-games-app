"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, RoundedBox, Sky, Sparkles, Text } from "@react-three/drei";
import type * as THREE from "three";
import { FOUNTAIN_RADIUS, PLAZA_RADIUS, PORTALS, portalTransform, SPAWN, type PortalDef } from "./layout";
import { imigongoTexture, plazaFloorTexture, portalPreviewTexture } from "./textures";

const FONT = "/fonts/Baloo2.ttf";

function Portal({ def, active }: { def: PortalDef; active: boolean }) {
  const { x, z, rotY } = portalTransform(def);
  const preview = useMemo(() => portalPreviewTexture(def.emoji, def.color, def.sub), [def]);
  const frame = useMemo(() => imigongoTexture(3), []);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const soon = def.href === null;
  useFrame(({ clock }) => {
    if (glow.current) {
      const base = soon ? 0.6 : 2.2;
      glow.current.emissiveIntensity = base + Math.sin(clock.elapsedTime * 2 + def.angleDeg) * 0.5 + (active ? 1.5 : 0);
    }
  });
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      {/* stone pillars with Imigongo inlay */}
      {[-1.9, 1.9].map((px) => (
        <group key={px} position={[px, 0, 0]}>
          <RoundedBox args={[0.7, 4.6, 0.9]} radius={0.12} position={[0, 2.3, 0]} castShadow receiveShadow>
            <meshStandardMaterial color="#8f93a8" roughness={0.6} />
          </RoundedBox>
          <mesh position={[0, 2.3, 0.46]}>
            <planeGeometry args={[0.5, 4.2]} />
            <meshStandardMaterial map={frame} roughness={0.8} />
          </mesh>
        </group>
      ))}
      <RoundedBox args={[4.6, 0.7, 0.9]} radius={0.12} position={[0, 4.75, 0]} castShadow>
        <meshStandardMaterial color="#8f93a8" roughness={0.6} />
      </RoundedBox>
      {/* neon frame */}
      <mesh position={[0, 2.2, 0.3]}>
        <torusGeometry args={[1.62, 0.07, 12, 48, Math.PI]} />
        <meshStandardMaterial ref={glow} color={def.color} emissive={def.color} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {[-1.62, 1.62].map((px) => (
        <mesh key={px} position={[px, 1.1, 0.3]}>
          <boxGeometry args={[0.14, 2.2, 0.14]} />
          <meshStandardMaterial color={def.color} emissive={def.color} emissiveIntensity={soon ? 0.6 : 2.2} toneMapped={false} />
        </mesh>
      ))}
      {/* room preview */}
      <mesh position={[0, 2.0, 0.1]}>
        <planeGeometry args={[3.1, 3.9]} />
        <meshBasicMaterial map={preview} transparent opacity={soon ? 0.55 : 0.95} toneMapped={false} />
      </mesh>
      {/* sign */}
      <group position={[0, 5.55, 0.2]}>
        <RoundedBox args={[3.8, 0.8, 0.14]} radius={0.2}>
          <meshStandardMaterial color="#22266E" roughness={0.4} />
        </RoundedBox>
        <Text font={FONT} fontSize={0.42} color="#ffffff" position={[0, 0.02, 0.09]} anchorX="center" anchorY="middle">
          {def.label}
        </Text>
      </group>
      {/* floor glow ring at the entrance */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 2.2]}>
        <ringGeometry args={[0.9, 1.2, 40]} />
        <meshBasicMaterial color={def.color} transparent opacity={active ? 0.95 : 0.45} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Fountain() {
  const water = useRef<THREE.Mesh>(null);
  const holo = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (water.current) water.current.position.y = 0.55 + Math.sin(clock.elapsedTime * 2) * 0.02;
    if (holo.current) holo.current.rotation.y = clock.elapsedTime * 0.6;
  });
  return (
    <group>
      <mesh position={[0, 0.3, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.2, 0.6, 48]} />
        <meshStandardMaterial color="#c7c2d6" roughness={0.5} />
      </mesh>
      <mesh ref={water} position={[0, 0.55, 0]}>
        <cylinderGeometry args={[FOUNTAIN_RADIUS - 0.25, FOUNTAIN_RADIUS - 0.25, 0.1, 48]} />
        <meshStandardMaterial color="#3DA9FC" transparent opacity={0.75} metalness={0.2} roughness={0.1} />
      </mesh>
      {/* Agaseke basket sculpture */}
      <group position={[0, 0.6, 0]}>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.55, 0.75, 1.8, 24]} />
          <meshStandardMaterial map={imigongoTexture(4)} roughness={0.7} />
        </mesh>
        <mesh position={[0, 2.35, 0]} castShadow>
          <coneGeometry args={[0.6, 1.4, 24]} />
          <meshStandardMaterial color="#B5532A" roughness={0.6} />
        </mesh>
      </group>
      {/* Player of the Day hologram (SRS §5.10) */}
      <group ref={holo} position={[0, 3.7, 0]}>
        <mesh>
          <cylinderGeometry args={[0.9, 0.9, 0.04, 32]} />
          <meshBasicMaterial color="#FFC83D" transparent opacity={0.5} toneMapped={false} />
        </mesh>
        <Text font={FONT} fontSize={0.32} color="#FFC83D" position={[0, 0.55, 0]} anchorX="center">
          Player of the Day
        </Text>
        <Text font={FONT} fontSize={0.22} color="#ffffff" position={[0, 0.2, 0]} anchorX="center">
          Announced daily at 10:00
        </Text>
      </group>
      <Sparkles count={40} scale={[6, 4, 6]} position={[0, 3, 0]} size={3} speed={0.4} color="#FFC83D" />
    </group>
  );
}

function Tree({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.22, 1.8, 8]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <mesh position={[0, 2.4, 0]} castShadow>
        <icosahedronGeometry args={[1.2, 1]} />
        <meshStandardMaterial color="#4E9F5B" flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.5, 2.0, 0.3]} castShadow>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial color="#5cb36a" flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}

function Hills() {
  const hills = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2;
        const r = 75 + ((i * 37) % 25);
        return { x: Math.sin(a) * r, z: Math.cos(a) * r, s: 14 + ((i * 53) % 12), c: i % 2 ? "#5e9e63" : "#4b8b55" };
      }),
    [],
  );
  return (
    <group>
      {hills.map((h, i) => (
        <mesh key={i} position={[h.x, -h.s * 0.45, h.z]}>
          <sphereGeometry args={[h.s, 16, 12]} />
          <meshStandardMaterial color={h.c} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Board({ x, z, rotY, title, lines, color }: { x: number; z: number; rotY: number; title: string; lines: string[]; color: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[0.15, 2, 0.15]} />
        <meshStandardMaterial color="#555b75" />
      </mesh>
      <RoundedBox args={[3.2, 2, 0.12]} radius={0.12} position={[0, 2.6, 0]} castShadow>
        <meshStandardMaterial color="#22266E" emissive={color} emissiveIntensity={0.15} />
      </RoundedBox>
      <Text font={FONT} fontSize={0.3} color={color} position={[0, 3.25, 0.08]} anchorX="center">
        {title}
      </Text>
      {lines.map((l, i) => (
        <Text key={i} font={FONT} fontSize={0.19} color="#ffffff" position={[0, 2.85 - i * 0.3, 0.08]} anchorX="center" maxWidth={2.9}>
          {l}
        </Text>
      ))}
    </group>
  );
}

export function Plaza({ nearPortal }: { nearPortal: string | null }) {
  const floor = useMemo(() => plazaFloorTexture(), []);
  const ring = useMemo(() => imigongoTexture(48), []);
  const pathTargets = PORTALS.filter((p) => p.href).map((p) => portalTransform(p));
  return (
    <group>
      <Sky distance={450} sunPosition={[40, 22, -60]} turbidity={3} rayleigh={0.9} mieCoefficient={0.004} mieDirectionalG={0.85} />
      <hemisphereLight args={["#cfe8ff", "#4E9F5B", 0.7]} />
      <directionalLight
        position={[20, 30, 15]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
      />
      <fog attach="fog" args={["#cfe8fb", 60, 220]} />

      {/* grass + plaza */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[160, 64]} />
        <meshStandardMaterial color="#6fb36f" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[PLAZA_RADIUS, 96]} />
        <meshStandardMaterial map={floor} roughness={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[PLAZA_RADIUS - 1.2, PLAZA_RADIUS, 128, 1]} />
        <meshStandardMaterial map={ring} roughness={0.8} />
      </mesh>
      {/* glowing paths from spawn to each open portal */}
      {pathTargets.map((t, i) => {
        const dx = t.entryX - SPAWN.x;
        const dz = t.entryZ - SPAWN.z;
        const len = Math.hypot(dx, dz);
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, -Math.atan2(dx, -dz)]} position={[(SPAWN.x + t.entryX) / 2, 0.015, (SPAWN.z + t.entryZ) / 2]}>
            <planeGeometry args={[0.18, len]} />
            <meshBasicMaterial color={PORTALS.filter((p) => p.href)[i]!.color} transparent opacity={0.55} toneMapped={false} />
          </mesh>
        );
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[SPAWN.x, 0.02, SPAWN.z]}>
        <ringGeometry args={[1.1, 1.35, 48]} />
        <meshBasicMaterial color="#3DA9FC" transparent opacity={0.7} toneMapped={false} />
      </mesh>

      <Fountain />
      {PORTALS.map((p) => (
        <Portal key={p.id} def={p} active={nearPortal === p.id} />
      ))}

      {/* title sign */}
      <Float speed={1.2} rotationIntensity={0} floatIntensity={0.6}>
        <group position={[0, 12.5, -32]}>
          <RoundedBox args={[16, 3.6, 0.5]} radius={0.6}>
            <meshStandardMaterial color="#22266E" emissive="#3DA9FC" emissiveIntensity={0.25} />
          </RoundedBox>
          <Text font={FONT} fontSize={1.5} color="#ffffff" position={[0, 0.55, 0.3]} anchorX="center" anchorY="middle">
            GUKIRANA
          </Text>
          <Text font={FONT} fontSize={1.0} color="#FFC83D" position={[0, -0.75, 0.3]} anchorX="center" anchorY="middle">
            PLAYGROUND
          </Text>
          <group position={[0, -2.35, 0]}>
            <RoundedBox args={[8, 0.9, 0.3]} radius={0.3}>
              <meshStandardMaterial color="#1a1d55" />
            </RoundedBox>
            <Text font={FONT} fontSize={0.5} color="#ffffff" position={[0, 0, 0.2]} anchorX="center" anchorY="middle">
              Play · Meet · Win
            </Text>
          </group>
        </group>
      </Float>

      <Board x={-9} z={7} rotY={0.6} title="Welcome!" color="#3DA9FC" lines={["Walk into a portal to play", "Tap a player to say hi", "Fair dice · verified rolls"]} />
      <Board x={9} z={7} rotY={-0.6} title="Wallet Kiosk" color="#F5B301" lines={["Practice with Stars today", "Coins arrive with the", "licensed real-money pilot"]} />

      {[...Array(14)].map((_, i) => {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        return <Tree key={i} x={Math.sin(a) * 34} z={Math.cos(a) * 34} s={0.9 + (i % 3) * 0.25} />;
      })}
      <Hills />
    </group>
  );
}
