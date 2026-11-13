"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Sparkles, Text } from "@react-three/drei";
import * as THREE from "three";
import { ARENA, buildDistrict } from "./District";
import { Landscape } from "./Landscape";
import { Lighting } from "./Lighting";
import { DOOR, DOOR_OPEN_RADIUS, DOOR_RING, FOUNTAIN_RADIUS, PORTALS, portalTransform, ringPoint, SERVICE_ANGLE, TOTEMS, type PortalDef } from "./layout";
import { doorOpen } from "./transition";
import { selfPose } from "@/lib/world-store";
import { EntryGate } from "./gate/EntryGate";
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
      {def.href && <AutoDoors def={def} inset={inset} tier={tier} />}
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

/**
 * Automatic doors (playable buildings only): sliding glass doors, or carved timber double doors at Igisoro Court.
 * They start opening when the local player comes within DOOR_OPEN_RADIUS of the entry point and close again when
 * they leave; the open amount is shared with the player controller so the doorway becomes walkable.
 */
function AutoDoors({ def, inset, tier }: { def: PortalDef; inset: number; tier: Tier }) {
  const { entryX, entryZ } = portalTransform(def);
  const wooden = def.kind === "igisoro";
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(0);
  const mats = useMemo(() => {
    const m = worldMaterials(tier);
    return {
      frame: new THREE.MeshStandardMaterial({ color: "#c9ced6", metalness: 0.85, roughness: 0.32 }),
      glass: new THREE.MeshStandardMaterial({ color: "#cfe6f2", metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false }),
      wood: (m["woodDark"] as THREE.MeshStandardMaterial | undefined) ?? new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.6 }),
      handle: new THREE.MeshStandardMaterial({ color: "#b08a4a", metalness: 1, roughness: 0.3 }),
    };
  }, [tier]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const near = Math.hypot(selfPose.x - entryX, selfPose.z - entryZ) < DOOR_OPEN_RADIUS;
    // eased motion: opening a little quicker than closing, like a real sensor door
    const target = near ? 1 : 0;
    open.current += (target - open.current) * (1 - Math.exp(-dt * (near ? 3.2 : 2.2)));
    doorOpen[def.id] = open.current;
    const e = open.current * open.current * (3 - 2 * open.current);
    if (wooden) {
      if (left.current) left.current.rotation.y = -e * 1.55;
      if (right.current) right.current.rotation.y = e * 1.55;
    } else {
      if (left.current) left.current.position.x = -DOOR.w / 4 - e * (DOOR.w / 2 - 0.08);
      if (right.current) right.current.position.x = DOOR.w / 4 + e * (DOOR.w / 2 - 0.08);
    }
  });
  const w = DOOR.w / 2;
  const h = DOOR.h;
  const z = inset + 0.07;
  if (wooden)
    return (
      <group position={[0, 0, z]}>
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? left : right} position={[s * w, 0, 0]}>
            <mesh position={[-s * (w / 2), h / 2, 0]} material={mats.wood} castShadow={tier !== "lite"}>
              <boxGeometry args={[w - 0.02, h, 0.08]} />
            </mesh>
            {/* carved Imigongo-style panels: raised diamonds */}
            {[0.9, 2.0, 3.1].map((y) => (
              <mesh key={y} position={[-s * (w / 2), y, 0.05]} rotation={[0, 0, Math.PI / 4]} material={mats.wood}>
                <boxGeometry args={[0.42, 0.42, 0.03]} />
              </mesh>
            ))}
            <mesh position={[-s * (w - 0.14), 1.1, 0.07]} material={mats.handle}>
              <cylinderGeometry args={[0.02, 0.02, 0.3, 10]} />
            </mesh>
          </group>
        ))}
      </group>
    );
  return (
    <group position={[0, 0, z]}>
      {/* overhead track + sensor */}
      <mesh position={[0, h + 0.09, -0.02]} material={mats.frame}>
        <boxGeometry args={[DOOR.w * 2, 0.18, 0.14]} />
      </mesh>
      <mesh position={[0, h + 0.09, 0.06]}>
        <boxGeometry args={[0.22, 0.06, 0.02]} />
        <meshBasicMaterial color={new THREE.Color(def.color).multiplyScalar(1.6)} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} ref={s < 0 ? left : right} position={[s * (w / 2), 0, s * 0.03]}>
          <mesh position={[0, h / 2, 0]} material={mats.glass} renderOrder={2}>
            <boxGeometry args={[w - 0.06, h - 0.1, 0.02]} />
          </mesh>
          {/* slim aluminium frame */}
          <mesh position={[0, h - 0.03, 0]} material={mats.frame}>
            <boxGeometry args={[w, 0.06, 0.05]} />
          </mesh>
          <mesh position={[0, 0.04, 0]} material={mats.frame}>
            <boxGeometry args={[w, 0.08, 0.05]} />
          </mesh>
          {[-1, 1].map((k) => (
            <mesh key={k} position={[(k * w) / 2, h / 2, 0]} material={mats.frame}>
              <boxGeometry args={[0.05, h, 0.05]} />
            </mesh>
          ))}
          <mesh position={[-s * (w / 2 - 0.12), 1.1, 0.04]} material={mats.frame}>
            <boxGeometry args={[0.03, 0.6, 0.03]} />
          </mesh>
        </group>
      ))}
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
      <EntryGate tier={tier} />
    </group>
  );
}
