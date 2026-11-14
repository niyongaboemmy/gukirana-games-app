"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import { ARENA, buildDistrict } from "./District";
import { LUDO_DIE, PLOTS } from "./footprints";
import { Landscape } from "./Landscape";
import { Lighting } from "./Lighting";
import { DOOR, DOOR_OPEN_RADIUS, DOOR_RING, doorInset, doorLocal, VESTIBULE_DEPTH, PORTALS, portalTransform, ringPoint, SERVICE_ANGLE, TOTEMS, WAYFINDING, wayfindingRows, EXPANSION_PLOTS, EXPANSION_RING, FOUNTAIN_COURT, OUTER_PROMENADE, PLAZA_RADIUS, SPAWN, type PortalDef } from "./layout";
import { doorHold, doorOpen } from "./transition";
import { selfPose, useWorld } from "@/lib/world-store";
import { plazaDoorSound, PlazaLife } from "./Ambience";
import { PlazaActivities } from "./PlazaActivities";
import { EntryGate } from "./gate/EntryGate";
import { GAME_COLORS, LED_BOOST, worldMaterials, type Tier } from "./materials";
import { arenaScreenTexture } from "./textures";
import { FountainWater } from "./Fountain";
import { DoorBadge, Vestibule } from "./Vestibule";
import { watchBuildings } from "./buildings";
import { useDoorShut } from "./door-access";
import { atlasPlane, labelAtlas, type LabelAtlas } from "./label-atlas";
import { W } from "./strings";
import { arenaGate } from "@/arena/flags";
import { NearOnly, StaticMerge } from "./static-merge";

const FONT = "/fonts/Baloo2.ttf";

const NO_SHADOW = new Set(["basalt", "granite", "basinFloor", "brass", "lampHead", "screenFrame"]);

/** Merged static district: ~one draw call per material. */
function District({ tier }: { tier: Tier }) {
  const geos = useMemo(() => buildDistrict(tier), [tier]);
  const mats = useMemo(() => worldMaterials(tier), [tier]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  // the arena's LED ribbons: a steady arena purple (P2-WLD-09: the purple → blue → gold colour cycle was one more
  // thing moving in every view of the plaza; a calm, constant accent reads better)
  const halo = mats["led-halo"] as THREE.MeshBasicMaterial;
  useEffect(() => void halo.color.set(GAME_COLORS.arena).multiplyScalar(LED_BOOST[tier]), [halo, tier]);
  return (
    <group>
      {[...geos.entries()].map(([key, g]) => {
        const m = mats[key];
        if (!m) return null;
        const unlit = m instanceof THREE.MeshBasicMaterial;
        const transparent = m.transparent;
        // flush / flat or tiny parts cast no shadow (P2-WLD-09: each merged material is one more shadow-pass draw;
        // kerb strips, granite discs, the basin floor, brass inlays, lamp diffusers and screen panels add nothing seen)
        const ground = key === "paving" || key === "asphalt" || NO_SHADOW.has(key);
        return <mesh key={key} geometry={g} material={m} castShadow={!unlit && !transparent && !ground && tier !== "lite"} receiveShadow={!unlit && tier !== "lite"} userData={{ noMerge: key === "led-halo" }} />;
      })}
    </group>
  );
}

/** Small game sign over each door: on the wall above the door, on the lintel (Ludo) or the porch fascia (Igisoro). */
const BADGE: Record<PortalDef["kind"], [number, number] | null> = {
  pool: [4.62, -0.28],
  ludo: [5.0, 0.87],
  igisoro: null, // the lettered timber fascia board on the porch is its sign
  arena: [4.62, -0.93],
  admin: null, // the lettered limestone fascia is its sign
  soon: null,
};

/**
 * Door: the entrance vestibule behind it (a real lobby, not a poster), the small lit game sign above it and a floor
 * halo that brightens when you're close (interaction point, §6.2). Construction sites show their closed site gate.
 */
function Door({ def, active, tier }: { def: PortalDef; active: boolean; tier: Tier }) {
  const { x, z, rotY } = portalTransform(def);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const soon = def.kind === "soon";
  // closed by staff (admin console) or the arena not letting you in: the doors stay shut, visibly (GAP-004)
  const closed = useDoorShut(def.id);
  const inset = doorInset(def.kind);
  const ledColor = useMemo(() => new THREE.Color(def.color).multiplyScalar(LED_BOOST[tier]), [def.color, tier]);
  const hoarding = worldMaterials(tier)["hoarding"];
  useFrame(({ clock }) => {
    if (ring.current) ring.current.opacity = (active ? 0.5 : 0.3) + Math.sin(clock.elapsedTime * 2.2 + def.angleDeg) * 0.04;
  });
  const signY = def.kind === "pool" ? 8.0 : def.kind === "ludo" ? 6.75 : def.kind === "igisoro" ? 5.35 : def.kind === "arena" ? 6.98 : 4.9;
  const signZ = def.kind === "pool" ? 1.44 : def.kind === "ludo" ? 0.3 : def.kind === "igisoro" ? 0.82 : def.kind === "arena" ? 2.08 : -0.28;
  const badge = BADGE[def.kind];
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <StaticMerge>
      {soon ? (
        // closed site gate: two plywood hoarding leaves between the steel gate posts
        [-1, 1].map((sd) => (
          <mesh key={sd} material={hoarding} position={[sd * 0.86, 1.6, inset + 0.05]} castShadow={tier !== "lite"}>
            <boxGeometry args={[1.66, 3.2, 0.06]} />
          </mesh>
        ))
      ) : (
        <Vestibule def={def} inset={inset} tier={tier} />
      )}
      {badge && <DoorBadge def={def} y={badge[0]} z={badge[1]} />}
      {!soon && <AutoDoors def={def} inset={inset} tier={tier} locked={!def.href || closed} />}
      {!soon && def.href && closed && <ClosedSign wooden={def.kind === "igisoro"} inset={inset} />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, DOOR_RING - (DOOR_RING - 2.4) + 0.2]} userData={{ noMerge: true }}>
        <ringGeometry args={[0.85, 1.1, 48]} />
        <meshBasicMaterial ref={ring} color={ledColor} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
      {def.kind === "admin" ? (
        // cut bronze capitals on the limestone fascia (lit by daylight, not an LED sign)
        <Text font={FONT} fontSize={0.52} position={[0, 6.45, 0.13]} anchorX="center" anchorY="middle" letterSpacing={0.16}>
          {def.label.toUpperCase()}
          <meshStandardMaterial color="#3a3227" roughness={0.75} metalness={0.2} />
        </Text>
      ) : def.kind === "igisoro" ? (
        // carved lettering on the timber fascia board hung under the porch roof (District.ts igisoroCourt)
        <Text font={FONT} fontSize={0.36} color="#f1e3c4" position={[0, 4.16, 0.9]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
          {def.label.toUpperCase()}
        </Text>
      ) : (
        <Text font={FONT} fontSize={def.kind === "arena" ? 0.4 : 0.5} color={ledColor} position={[0, signY, signZ]} anchorX="center" anchorY="middle" letterSpacing={0.06}>
          {def.label.toUpperCase()}
          <meshBasicMaterial color={ledColor} toneMapped={false} />
        </Text>
      )}
      {soon && (
        <Text font={FONT} fontSize={0.26} color="#1b1b1b" position={[0, 2.6, inset + 0.1]} anchorX="center" anchorY="middle">
          {`${def.sub} · coming soon`}
        </Text>
      )}
      </StaticMerge>
    </group>
  );
}

let closedAtlas: LabelAtlas | null = null;
/**
 * A door that is shut for you says so (GAP-004): a red "CLOSED" plaque on the doors at eye height and a red door
 * lamp over them (it blooms, like the LED signs). Not part of the static batch: it comes and goes with the state.
 */
function ClosedSign({ inset, wooden }: { inset: number; wooden: boolean }) {
  const parts = useMemo(() => {
    closedAtlas ??= labelAtlas([{ text: W.closedSign, px: 96 }], { cols: 1, cellW: 512, cellH: 160, ink: "#ffffff", paper: "#8f2620", letterSpacing: 0.14 });
    return {
      plaque: atlasPlane(1.15, 0.36, closedAtlas.uv(0)),
      plaqueMat: new THREE.MeshBasicMaterial({ map: closedAtlas.texture, toneMapped: false }),
      lampMat: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff3b30").multiplyScalar(2.2), toneMapped: false }),
    };
  }, []);
  useEffect(
    () => () => {
      parts.plaque.dispose();
      parts.plaqueMat.dispose();
      parts.lampMat.dispose();
    },
    [parts],
  );
  const z = inset + 0.07 + (wooden ? 0.1 : 0.06);
  return (
    <group userData={{ noMerge: true }}>
      <mesh geometry={parts.plaque} material={parts.plaqueMat} position={[0, 1.62, z]} renderOrder={3} />
      <mesh material={parts.lampMat} position={[0, DOOR.h + 0.32, inset + 0.12]}>
        <boxGeometry args={[0.7, 0.1, 0.05]} />
      </mesh>
    </group>
  );
}

/**
 * Automatic doors (playable buildings only): sliding glass doors, or carved timber double doors at Igisoro Court.
 * They start opening when the local player comes within DOOR_OPEN_RADIUS of the entry point and close again when
 * they leave; the open amount is shared with the player controller so the doorway becomes walkable.
 */
function AutoDoors({ def, inset, tier, locked = false }: { def: PortalDef; inset: number; tier: Tier; locked?: boolean }) {
  const { entryX, entryZ } = portalTransform(def);
  const wooden = def.kind === "igisoro";
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(0);
  const wasNear = useRef(false);
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
    // a real sensor door opens for whoever walks up to it, not only for you
    // (also held open for someone about to step out of the hall: their position is inside it, out of sensor range)
    let near = Math.hypot(selfPose.x - entryX, selfPose.z - entryZ) < DOOR_OPEN_RADIUS || (doorHold[def.id] ?? 0) > performance.now();
    if (!near) {
      // anyone in the doorway or the lobby behind it keeps it open (walking in, the hall takes over only once the
      // camera is through the door, ~3 m in: the doors must not close on the way)
      const l = doorLocal(def, selfPose.x, selfPose.z);
      near = Math.abs(l.lx) < DOOR.w && l.lz < inset + 1.2 && l.lz > inset - VESTIBULE_DEPTH - 0.5;
    }
    if (!near) {
      const ps = useWorld.getState().players;
      for (const id in ps) {
        const o = ps[id]!;
        if (Math.hypot(o.x / 100 - entryX, o.z / 100 - entryZ) < DOOR_OPEN_RADIUS) {
          near = true;
          break;
        }
      }
    }
    // Tournament Arena: the doors open only while the arena status says you may come in (arena/ArenaDoorWatch);
    // someone walking out of it is always let out
    if (near && def.kind === "arena" && !arenaGate.canEnter && (doorHold[def.id] ?? 0) <= performance.now()) near = false;
    // shut for you (closed by staff, not open yet): the leaves close and stay closed — never frozen half open, and
    // the doorway is not walkable (world/Player needs doorOpen ≥ 0.55); someone stepping out is still let out
    if (near && locked && (doorHold[def.id] ?? 0) <= performance.now()) near = false;
    if (near !== wasNear.current) {
      wasNear.current = near;
      plazaDoorSound(entryX, entryZ, near);
    }
    // eased motion: opening a little quicker than closing, like a real sensor door
    const target = near ? 1 : 0;
    open.current += (target - open.current) * (1 - Math.exp(-dt * (near ? 3.2 : 2.2)));
    doorOpen[def.id] = open.current;
    const e = open.current * open.current * (3 - 2 * open.current);
    if (wooden) {
      // hinged at the jambs, swinging INTO the vestibule (−z), clear of the porch posts
      if (left.current) left.current.rotation.y = e * 1.5;
      if (right.current) right.current.rotation.y = -e * 1.5;
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
          <group key={s} ref={s < 0 ? left : right} position={[s * w, 0, 0]} userData={{ noMerge: true }}>
            <StaticMerge>
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
            </StaticMerge>
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
      <mesh position={[0, h + 0.09, 0.06]} userData={{ noMerge: true }}>
        <boxGeometry args={[0.22, 0.06, 0.02]} />
        <meshBasicMaterial color={new THREE.Color(locked ? "#d23c3c" : def.color).multiplyScalar(1.1)} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} ref={s < 0 ? left : right} position={[s * (w / 2), 0, s * 0.03]} userData={{ noMerge: true }}>
          <StaticMerge>
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
          </StaticMerge>
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
  // one message every 12 s with a slow 1.2 s slide (was 5 s / 0.6 s: a screen flipping in every plaza view)
  useFrame(({ clock }) => {
    tex.offset.x = Math.floor(clock.elapsedTime / 12) * 0.25 + Math.min(1, (clock.elapsedTime % 12) / 1.2) * 0.25 - 0.25;
  });
  const gold = useMemo(() => new THREE.Color(GAME_COLORS.gold).multiplyScalar(LED_BOOST[tier]), [tier]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 12.6, ARENA.cz + ARENA.rz + 1.17]}>
        <planeGeometry args={[16.4, 4.8]} />
        <meshBasicMaterial map={tex} toneMapped={false} color={tier === "lite" ? "#ffffff" : "#d8d8d8"} />
      </mesh>
      {/* ticket window sign, left of the doors (P2-WLD-09: the two made-up event posters on the right are gone —
          the real schedule is on the plaza notice board) */}
      <Text font={FONT} fontSize={0.2} color="#f4f1ea" position={[-4.6, 2.62, -0.69]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
        TICKETS
      </Text>
      <Text font={FONT} fontSize={1.5} position={[0, 16.4, ARENA.cz + ARENA.rz + 0.95]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
        GUKIRANA PLAYGROUND
        <meshBasicMaterial color={gold} toneMapped={false} />
      </Text>
    </group>
  );
}

function Fountain({ tier }: { tier: Tier }) {
  const holo = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (holo.current) holo.current.rotation.y = clock.elapsedTime * 0.5;
  });
  return (
    <group>
      <FountainWater tier={tier} />
      {/* Player of the Day hologram (SRS §5.10) */}
      <group ref={holo} position={[0, 6.0, 0]}>
        <mesh>
          <cylinderGeometry args={[1.0, 1.0, 0.03, 40]} />
          <meshBasicMaterial color={new THREE.Color(GAME_COLORS.gold).multiplyScalar(1.4)} transparent opacity={0.45} toneMapped={false} />
        </mesh>
        {/* (lettering 0.2–0.3 m high: unreadable beyond ~30 m, not drawn there) */}
        <NearOnly max={32}>
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
        </NearOnly>
      </group>
      {/* (P2-WLD-09: the twinkling gold sparkles round the hologram are gone: flicker over the calmest spot) */}
    </group>
  );
}

/** Ludo Lounge signature (DESIGN-SPEC §6.3): a giant die turning slowly on its axle in a steel fork on the roof terrace. */
function GiantDie() {
  const p = PORTALS.find((x) => x.kind === "ludo")!;
  const { x, z, rotY } = portalTransform(p);
  const die = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (die.current) die.current.rotation.x = clock.elapsedTime * 0.35;
  });
  const pips: [number, number, number][] = [
    [0, 0, 1],
    [0.5, 0.5, -1],
    [-0.5, -0.5, -1],
  ];
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} userData={{ noMerge: true }}>
      {/* axle through the fork arms (District.ts ludoLounge) */}
      <mesh position={[LUDO_DIE.x, LUDO_DIE.y, LUDO_DIE.z]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 2.6, 8]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.9} roughness={0.4} />
      </mesh>
      <group ref={die} position={[LUDO_DIE.x, LUDO_DIE.y, LUDO_DIE.z]}>
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

/**
 * Campus map for the welcome totem, drawn from the plot data (footprints.ts PLOTS), so every new hall or plot shows up
 * on it without any edit: plaza, inner ring halls in their colours, reserved plots hatched grey, "you are here".
 */
function siteMapTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const span = OUTER_EDGE * 2;
  const px = (v: number) => S / 2 + (v / span) * S;
  g.fillStyle = "#1b1e23";
  g.fillRect(0, 0, S, S);
  g.lineWidth = 2;
  g.strokeStyle = "#3a414b";
  g.fillStyle = "#2a2f36";
  for (const [r, fill] of [
    [OUTER_PROMENADE.r1, false],
    [PLAZA_RADIUS, true],
  ] as const) {
    g.beginPath();
    g.arc(px(0), px(0), (r / span) * S, 0, Math.PI * 2);
    if (fill) g.fill();
    g.stroke();
  }
  const colour = (id: string) => PORTALS.find((p) => p.id === id && p.kind !== "soon")?.color ?? (id === "service" ? GAME_COLORS.sky : "#6b7380");
  for (const p of PLOTS) {
    const d = ringPoint(p.angleDeg, p.ring);
    const cs = Math.cos(d.rotY);
    const sn = Math.sin(d.rotY);
    g.fillStyle = colour(p.id);
    g.globalAlpha = p.type === "site" || p.type === "soon" ? 0.45 : 0.95;
    if (p.type === "arena") {
      g.beginPath();
      g.ellipse(px(d.x - ARENA.cz * sn), px(d.z + ARENA.cz * cs), (ARENA.rx / span) * S, (ARENA.rz / span) * S, 0, 0, Math.PI * 2);
      g.fill();
    } else
      for (const f of p.rects) {
        g.beginPath();
        for (const [lx, lz] of [
          [f.x0, f.z0],
          [f.x1, f.z0],
          [f.x1, f.z1],
          [f.x0, f.z1],
        ] as const)
          g.lineTo(px(d.x + lx * cs + lz * sn), px(d.z - lx * sn + lz * cs));
        g.closePath();
        g.fill();
      }
  }
  g.globalAlpha = 1;
  // the avenue to the gates, the fountain and "you are here"
  g.fillStyle = "#2a2f36";
  g.fillRect(px(-4), px(PLAZA_RADIUS), (8 / span) * S, S);
  g.fillStyle = "#3d7fd9";
  g.beginPath();
  g.arc(px(0), px(0), (FOUNTAIN_COURT / span) * S, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f5f6f8";
  g.beginPath();
  g.arc(px(SPAWN.x), px(SPAWN.z), 7, 0, Math.PI * 2);
  g.fill();
  g.font = "600 22px sans-serif";
  g.fillText("You are here", px(SPAWN.x) + 12, px(SPAWN.z) + 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const OUTER_EDGE = EXPANSION_RING + 50;

function Totems() {
  const map = useMemo(() => siteMapTexture(), []);
  useEffect(() => () => map.dispose(), [map]);
  const content = {
    welcome: { title: "Welcome", color: "#3DA9FC", lines: [] as string[] },
    wallet: { title: "Wallet Kiosk", color: "#F5B301", lines: ["Practice with Stars today", "Coins arrive with the", "licensed real-money pilot"] },
  } as const;
  return (
    <StaticMerge>
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
            {t.id === "welcome" && (
              <mesh position={[0, 1.78, 0.158]}>
                <planeGeometry args={[2.05, 2.05]} />
                <meshBasicMaterial map={map} toneMapped={false} />
              </mesh>
            )}
            <NearOnly max={24}>
              {c.lines.map((l, i) => (
                <Text key={i} font={FONT} fontSize={0.16} color="#ffffff" position={[0, 2.55 - i * 0.32, 0.16]} anchorX="center" maxWidth={2}>
                  {l}
                </Text>
              ))}
            </NearOnly>
          </group>
        );
      })}
    </StaticMerge>
  );
}

/** Wayfinding sign lettering (District.ts draws the posts, panels and colour bars): one Text per face. */
function Wayfinding() {
  const signs = useMemo(() => WAYFINDING.map((w) => ({ w, text: wayfindingRows(w).map((r) => `${r.name}   ${r.m} m`).join("\n") })), []);
  return (
    <>
      {signs.map(({ w, text }) => (
        // (8.5 cm letters: drawn within 16 m, where they can be read)
        <NearOnly key={w.deg} max={16} position={[w.x, 0, w.z]} rotation={[0, w.rotY, 0]}>
          {[0, Math.PI].map((face) => (
            <Text key={face} rotation={[0, face, 0]} font={FONT} fontSize={0.085} lineHeight={4.94} color="#eef0f3" position={[Math.cos(face) * -0.54, 1.45, Math.cos(face) * 0.095]} anchorX="left" anchorY="middle">
              {text}
            </Text>
          ))}
        </NearOnly>
      ))}
    </>
  );
}

/** Lettering on the site boards of the reserved expansion plots (District.ts hallSite draws the boards). */
function PlotSigns() {
  return (
    <>
      {EXPANSION_PLOTS.map((e) => {
        const d = ringPoint(e.angleDeg, EXPANSION_RING);
        return (
          <NearOnly key={e.id} max={45} position={[d.x, 0, d.z]} rotation={[0, d.rotY, 0]}>
            <Text font={FONT} fontSize={0.34} color="#e6e8eb" position={[4.4, 3.4, -0.24]} anchorX="center" anchorY="middle" textAlign="center" lineHeight={1.25}>
              {`HALL PLOT ${e.n}\nCOMING SOON`}
            </Text>
          </NearOnly>
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
  useEffect(() => watchBuildings(), []);
  return (
    // (named groups: the QA performance breakdown, qa/e2e/perf.mjs, reports draw calls per part)
    <group name="plaza">
      <group name="lighting">
        <Lighting tier={tier} />
      </group>
      <group name="landscape">
        <Landscape tier={tier} />
      </group>
      <group name="district">
        <District tier={tier} />
      </group>
      <group name="fountain" userData={{ noMerge: true }}>
        <Fountain tier={tier} />
      </group>
      <group name="plaza-life" userData={{ noMerge: true }}>
        <PlazaLife tier={tier} />
        <PlazaActivities tier={tier} />
      </group>
      <group name="doors">
        {PORTALS.map((p) => (
          <Door key={p.id} def={p} active={nearPortal === p.id} tier={tier} />
        ))}
      </group>
      <group name="signs">
        <ArenaScreen tier={tier} />
        <GiantDie />
        <Totems />
        <Wayfinding />
        <ServiceSign />
        <PlotSigns />
      </group>
      <group name="entry-gate">
        <EntryGate tier={tier} />
      </group>
    </group>
  );
}
