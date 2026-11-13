"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Sparkles, Text } from "@react-three/drei";
import * as THREE from "three";
import { ARENA, buildDistrict } from "./District";
import { Landscape } from "./Landscape";
import { Lighting } from "./Lighting";
import { DOOR, DOOR_RING, FOUNTAIN_RADIUS, PORTALS, portalTransform, ringPoint, SERVICE_ANGLE, TOTEMS, type PortalDef } from "./layout";
import { GAME_COLORS, worldMaterials, type Tier } from "./materials";
import { arenaScreenTexture, doorPreviewTexture } from "./textures";

const FONT = "/fonts/Baloo2.ttf";

/** Merged static district: ~one draw call per material. */
function District({ tier }: { tier: Tier }) {
  const geos = useMemo(() => buildDistrict(tier), [tier]);
  const mats = useMemo(() => worldMaterials(tier), [tier]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  // the arena's LED ribbons slowly cycle purple → blue → gold (one shared material, cheap to animate)
  const halo = mats["led-halo"] as THREE.MeshBasicMaterial;
  const base = useMemo(() => [new THREE.Color(GAME_COLORS.arena), new THREE.Color(GAME_COLORS.sky), new THREE.Color(GAME_COLORS.gold)], []);
  const boost = tier === "lite" ? 1.15 : 2.6;
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.08) % 3;
    const i = Math.floor(t);
    const a = base[i]!;
    const b = base[(i + 1) % 3]!;
    halo.color.copy(a).lerp(b, THREE.MathUtils.smoothstep(t - i, 0.2, 0.8)).multiplyScalar(boost);
  });
  return (
    <group>
      {[...geos.entries()].map(([key, g]) => {
        const m = mats[key];
        if (!m) return null;
        const unlit = m instanceof THREE.MeshBasicMaterial;
        const transparent = m.transparent;
        const ground = key === "paving" || key === "asphalt";
        return <mesh key={key} geometry={g} material={m} castShadow={!unlit && !transparent && !ground && tier !== "lite"} receiveShadow={!unlit && tier !== "lite"} />;
      })}
    </group>
  );
}

/** Door: interior glimpse + floor halo that brightens when you're close (interaction point, §6.2). */
function Door({ def, active, tier }: { def: PortalDef; active: boolean; tier: Tier }) {
  const { x, z, rotY } = portalTransform(def);
  const tex = useMemo(() => doorPreviewTexture(def.kind, def.color, def.sub), [def]);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const soon = def.href === null;
  const inset = def.kind === "arena" ? -1.15 : def.kind === "igisoro" ? -2.15 : def.kind === "pool" ? -0.55 : def.kind === "ludo" ? -0.4 : -0.45;
  const ledColor = useMemo(() => new THREE.Color(def.color).multiplyScalar(tier === "lite" ? 1.1 : 2.2), [def.color, tier]);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.opacity = (active ? 0.95 : 0.45) + Math.sin(clock.elapsedTime * 2.2 + def.angleDeg) * 0.12;
  });
  const signY = def.kind === "pool" ? 8.0 : def.kind === "ludo" ? 6.75 : def.kind === "igisoro" ? 5.35 : def.kind === "arena" ? 6.98 : 4.9;
  const signZ = def.kind === "pool" ? 1.44 : def.kind === "ludo" ? 0.3 : def.kind === "igisoro" ? 0.82 : def.kind === "arena" ? 2.08 : -0.28;
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, DOOR.h / 2, inset]}>
        <planeGeometry args={[DOOR.w, DOOR.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} transparent opacity={soon ? 0.7 : 1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, DOOR_RING - (DOOR_RING - 2.4) + 0.2]}>
        <ringGeometry args={[0.85, 1.1, 48]} />
        <meshBasicMaterial ref={ring} color={ledColor} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
      <Text font={FONT} fontSize={def.kind === "arena" ? 0.4 : 0.5} color={ledColor} position={[0, signY, signZ]} anchorX="center" anchorY="middle" letterSpacing={0.06}>
        {def.label.toUpperCase()}
        <meshBasicMaterial color={ledColor} toneMapped={false} />
      </Text>
      {soon && (
        <Text font={FONT} fontSize={0.34} color="#ffffff" position={[0, 3.2, -0.25]} anchorX="center" anchorY="middle">
          {def.sub}
        </Text>
      )}
    </group>
  );
}

/** Arena LED screen (scrolling content) and the "GUKIRANA PLAYGROUND" crown letters. */
function ArenaScreen({ tier }: { tier: Tier }) {
  const a = PORTALS.find((p) => p.kind === "arena")!;
  const { x, z, rotY } = portalTransform(a);
  const tex = useMemo(() => {
    const t = arenaScreenTexture();
    t.repeat.set(0.25, 1);
    return t;
  }, []);
  useFrame(({ clock }) => {
    tex.offset.x = Math.floor(clock.elapsedTime / 5) * 0.25 + Math.min(1, (clock.elapsedTime % 5) / 0.6) * 0.25 - 0.25;
  });
  const gold = useMemo(() => new THREE.Color(GAME_COLORS.gold).multiplyScalar(tier === "lite" ? 1.1 : 1.8), [tier]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 12.6, ARENA.cz + ARENA.rz + 1.17]}>
        <planeGeometry args={[16.4, 4.8]} />
        <meshBasicMaterial map={tex} toneMapped={false} color={tier === "lite" ? "#ffffff" : "#d8d8d8"} />
      </mesh>
      <Text font={FONT} fontSize={1.5} position={[0, 16.4, ARENA.cz + ARENA.rz + 0.95]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
        GUKIRANA PLAYGROUND
        <meshBasicMaterial color={gold} toneMapped={false} />
      </Text>
    </group>
  );
}

function Fountain() {
  const water = useRef<THREE.Mesh>(null);
  const holo = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (water.current) water.current.position.y = 0.46 + Math.sin(clock.elapsedTime * 1.6) * 0.008;
    if (holo.current) holo.current.rotation.y = clock.elapsedTime * 0.5;
  });
  return (
    <group>
      <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.46, 0]}>
        <ringGeometry args={[1.12, FOUNTAIN_RADIUS - 0.36, 64]} />
        <meshStandardMaterial color="#2d6f8f" metalness={0.5} roughness={0.04} envMapIntensity={1.8} transparent opacity={0.9} />
      </mesh>
      {/* Player of the Day hologram (SRS §5.10) */}
      <group ref={holo} position={[0, 6.0, 0]}>
        <mesh>
          <cylinderGeometry args={[1.0, 1.0, 0.03, 40]} />
          <meshBasicMaterial color={new THREE.Color(GAME_COLORS.gold).multiplyScalar(1.4)} transparent opacity={0.45} toneMapped={false} />
        </mesh>
        {[0, Math.PI].map((r) => (
          <group key={r} rotation={[0, r, 0]}>
            <Text font={FONT} fontSize={0.3} color="#FFC83D" position={[0, 0.55, 0]} anchorX="center">
              Player of the Day
            </Text>
            <Text font={FONT} fontSize={0.2} color="#ffffff" position={[0, 0.22, 0]} anchorX="center">
              Announced daily at 10:00
            </Text>
          </group>
        ))}
      </group>
      <Sparkles count={30} scale={[5, 3, 5]} position={[0, 5, 0]} size={2.5} speed={0.3} color="#FFC83D" />
    </group>
  );
}

/** Ludo Lounge signature: a giant floating die over the rooftop garden (DESIGN-SPEC §6.3). */
function GiantDie() {
  const p = PORTALS.find((x) => x.kind === "ludo")!;
  const { x, z, rotY } = portalTransform(p);
  const die = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!die.current) return;
    die.current.rotation.set(clock.elapsedTime * 0.3, clock.elapsedTime * 0.45, 0.4);
    die.current.position.y = 11.6 + Math.sin(clock.elapsedTime * 0.9) * 0.25;
  });
  const pips: [number, number, number][] = [
    [0, 0, 1],
    [0.5, 0.5, -1],
    [-0.5, -0.5, -1],
  ];
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <group ref={die} position={[0, 11.6, -6.5]}>
        <RoundedBox args={[2.2, 2.2, 2.2]} radius={0.32} smoothness={3} castShadow>
          <meshStandardMaterial color="#f7f4ee" roughness={0.25} metalness={0.05} />
        </RoundedBox>
        {pips.map(([px, py, s], i) => (
          <mesh key={i} position={[px * 0.8, py * 0.8, s * 1.11]}>
            <circleGeometry args={[0.2, 20]} />
            <meshBasicMaterial color={new THREE.Color(GAME_COLORS.ludo).multiplyScalar(1.6)} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Totems() {
  const content = {
    welcome: { title: "Welcome", color: "#3DA9FC", lines: ["Walk to a lit door to play", "Tap a player to say hi", "Fair dice, verified rolls"] },
    wallet: { title: "Wallet Kiosk", color: "#F5B301", lines: ["Practice with Stars today", "Coins arrive with the", "licensed real-money pilot"] },
  } as const;
  return (
    <>
      {TOTEMS.map((t) => {
        const c = content[t.id];
        return (
          <group key={t.id} position={[t.x, 0, t.z]} rotation={[0, t.rotY, 0]}>
            <mesh position={[0, 1.95, 0.152]}>
              <planeGeometry args={[2.2, 3.2]} />
              <meshBasicMaterial color="#14183f" toneMapped={false} />
            </mesh>
            <Text font={FONT} fontSize={0.3} color={c.color} position={[0, 3.1, 0.16]} anchorX="center">
              {c.title}
            </Text>
            {c.lines.map((l, i) => (
              <Text key={i} font={FONT} fontSize={0.16} color="#ffffff" position={[0, 2.55 - i * 0.32, 0.16]} anchorX="center" maxWidth={2}>
                {l}
              </Text>
            ))}
          </group>
        );
      })}
    </>
  );
}

function ServiceSign() {
  const s = ringPoint(SERVICE_ANGLE, DOOR_RING);
  return (
    <group position={[s.x, 0, s.z]} rotation={[0, s.rotY, 0]}>
      <Text font={FONT} fontSize={0.45} position={[0, 4.75, 0.45]} anchorX="center" anchorY="middle" letterSpacing={0.06}>
        HELP DESK  ·  CAFE
        <meshBasicMaterial color={new THREE.Color(GAME_COLORS.sky).multiplyScalar(1.6)} toneMapped={false} />
      </Text>
    </group>
  );
}

export function Plaza({ nearPortal, tier = "standard" }: { nearPortal: string | null; tier?: Tier }) {
  return (
    <group>
      <Lighting tier={tier} />
      <Landscape tier={tier} />
      <District tier={tier} />
      <Fountain />
      {PORTALS.map((p) => (
        <Door key={p.id} def={p} active={nearPortal === p.id} tier={tier} />
      ))}
      <ArenaScreen tier={tier} />
      <GiantDie />
      <Totems />
      <ServiceSign />
    </group>
  );
}
