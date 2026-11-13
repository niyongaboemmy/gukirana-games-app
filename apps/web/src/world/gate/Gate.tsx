"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { GeoBatch } from "../geo";
import { GAME_COLORS, worldMaterials, type Tier } from "../materials";
import { ledScreenTexture } from "../textures";
import { useGate } from "./gate-store";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { Avatar } from "../Avatar";
import { DEFAULT_LOOK } from "../outfits";

/**
 * Arrival gate on the southern avenue: basalt pylons, a timber-soffit canopy, five turnstile lanes, a guard booth,
 * an ID-check kiosk, a welcome LED screen, and a wardrobe/locker station just inside for new players.
 * Visitors approach from +z (south) and walk −z (north) into the arena district.
 */
export const GATE_Z = 96;
export const KIOSK = { x: -1.55, z: GATE_Z + 1.9, rotY: 0.55 };
export const STAND = { x: 0.45, z: GATE_Z + 2.6 }; // where the avatar stands to show ID
export const INSIDE = { x: 0, z: GATE_Z - 4 };
export const WARDROBE = { x: 6.4, z: GATE_Z - 6.5, stand: { x: 4.7, z: GATE_Z - 6.5 } };
const FONT = "/fonts/Baloo2.ttf";

/** Guard post beside the booth, relative to the gate centre (non-player staff, never counted or listed). */
export const GUARD_POST = { x: 4.6, dz: 2.6, rotY: -0.35 };

/**
 * Gate geometry. `variant` "arrival" is the full arrival gate on the southern avenue (forecourt, kiosk outside,
 * wardrobe inside); "entry" is the same structure placed at the plaza entry and seen from inside the district:
 * no forecourt or wardrobe, shorter perimeter walls, and the kiosk pedestal moved inside as the exit kiosk.
 */
export function buildGate(tier: Tier, Z: number = GATE_Z, variant: "arrival" | "entry" = "arrival", exitKiosk?: { x: number; z: number; rotY: number }) {
  const b = new GeoBatch();
  const entry = variant === "entry";
  const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
  if (!entry) {
    // forecourt + avenue link over the ring road
    b.add("paving", flat(new THREE.CircleGeometry(19, tier === "lite" ? 48 : 96)), { p: [0, 0.018, Z], tile: 4 });
    b.box("paving", 8, 0.02, Z - 81 - 15, { p: [0, 0.012, (81 + Z - 15) / 2], tile: 4 });
    b.add("lava", flat(new THREE.RingGeometry(19, 19.6, 96, 1)), { p: [0, 0.022, Z], tile: 1.2 });
  }
  // canopy: white slab, timber soffit battens, LED edges
  b.box("white", 19, 0.45, 8.4, { p: [0, 5.6, Z] });
  for (let x = -9.2; x <= 9.2; x += 0.46) b.box("wood", 0.1, 0.14, 8.0, { p: [x, 5.31, Z], tile: 1 });
  b.box("led-warm", 19.04, 0.02, 0.03, { p: [0, 5.4, Z + 4.22] }); // slim 2 cm warm-white strip (daytime)
  b.box("led-warm", 19.04, 0.02, 0.03, { p: [0, 5.4, Z - 4.22] });
  // basalt pylons with Imigongo inlays
  for (const s of [-1, 1]) {
    b.box("lava", 1.6, 5.4, 2.4, { p: [s * 8.6, 2.7, Z], tile: 1.2 });
    b.box("diamond", 1.0, 4.4, 0.04, { p: [s * 8.6, 2.7, Z + 1.22], uv: [1, 4] });
    // perimeter walls with an Imigongo frieze
    const wl = entry ? 7 : 17;
    b.box("lava", wl, 2.2, 0.6, { p: [s * (9.4 + wl / 2), 1.1, Z], tile: 1.2 });
    b.box("imigongo", wl, 0.5, 0.62, { p: [s * (9.4 + wl / 2), 2.0, Z], uv: [Math.round(wl / 2.1), 1] });
  }
  // turnstile cabinets (status LEDs for the centre lane are dynamic)
  for (const x of [-3.75, -2.25, -0.75, 0.75, 2.25, 3.75]) {
    b.box("alu", 0.26, 1.0, 1.7, { p: [x, 0.5, Z] });
    b.box("steel", 0.28, 0.05, 1.72, { p: [x, 1.02, Z] });
    if (Math.abs(x) > 1) b.box(x > 0 ? "led-igisoro" : "led-red", 0.05, 0.03, 1.4, { p: [x, 1.05, Z] });
  }
  for (const x of [-3, -1.5, 1.5, 3]) for (const s of [-1, 1]) b.box("jet", 0.5, 0.85, 0.02, { p: [x + s * 0.37, 0.75, Z], r: [0, 0, 0] });
  // kiosk pedestal (screen + keyboard are dynamic); at the plaza entry it is the exit / sign-out kiosk inside
  const kp = entry && exitKiosk ? exitKiosk : { x: KIOSK.x, z: KIOSK.z - GATE_Z + Z, rotY: KIOSK.rotY };
  b.frame([kp.x, 0, kp.z], kp.rotY, () => {
    b.box("steel", 0.5, 1.0, 0.36, { p: [0, 0.5, 0] });
    b.box("lava", 0.8, 0.08, 0.6, { p: [0, 0.04, 0], tile: 1.2 });
    b.box("screenFrame", 0.92, 0.66, 0.08, { p: [0, 1.42, -0.02], r: [-0.22, 0, 0] });
    b.box("alu", 0.06, 0.6, 0.06, { p: [0, 1.0, -0.05] });
  });
  // guard booth
  b.frame([6.4, 0, Z + 1.6], 0, () => {
    b.box("lava", 2.8, 0.5, 2.6, { p: [0, 0.25, 0], tile: 1.2 });
    b.box("glassCool", 2.6, 2.3, 0.08, { p: [0, 1.65, 1.25], tile: 6 });
    for (const s of [-1, 1]) b.box("glassCool", 0.08, 2.3, 2.5, { p: [s * 1.3, 1.65, 0], tile: 6 });
    b.box("wood", 2.6, 2.3, 0.08, { p: [0, 1.65, -1.25], tile: 1 });
    b.box("wood", 3.4, 0.25, 3.2, { p: [0, 2.92, 0], tile: 1 });
    b.box("white", 2.0, 0.9, 0.5, { p: [0, 0.95, 0.6] });
  });
  // welcome LED screen standing on the canopy
  b.box("screenFrame", 11.4, 2.3, 0.35, { p: [0, 7.0, Z + 3.4] });
  b.box("steel", 0.3, 1.2, 0.3, { p: [-4, 6.1, Z + 3.4] });
  b.box("steel", 0.3, 1.2, 0.3, { p: [4, 6.1, Z + 3.4] });
  if (entry) return b.build();
  // wardrobe / locker station (inside, east side) under a timber roof
  b.frame([WARDROBE.x, 0, WARDROBE.z], -Math.PI / 2, () => {
    b.box("wood", 5.2, 2.4, 0.6, { p: [0, 1.2, -0.3], tile: 1 });
    for (let x = -2.2; x <= 2.21; x += 0.88) if (Math.abs(x) > 0.6) b.box("steel", 0.02, 2.2, 0.02, { p: [x + 0.44, 1.2, 0.01] });
    b.box("alu", 1.0, 2.0, 0.03, { p: [0, 1.2, 0.02] }); // mirror (high-metal, reflects the env map)
    b.box("woodDark", 2.4, 0.45, 0.45, { p: [0, 0.23, 1.0], tile: 1 });
    b.box("wood", 6.4, 0.25, 3.0, { p: [0, 3.0, 0.8], tile: 1 });
    for (const s of [-1, 1]) b.box("steel", 0.12, 3.0, 0.12, { p: [s * 3.0, 1.5, 2.1] });
    b.box("led-gold", 6.42, 0.025, 0.03, { p: [0, 2.9, 2.32] });
  });
  // planters with hedges along the forecourt
  for (const x of [-13, -10.5, 10.5, 13]) {
    b.box("lava", 1.6, 0.6, 3.2, { p: [x, 0.3, Z + 7], tile: 1.2 });
    b.box("hedge", 1.4, 0.7, 3.0, { p: [x, 0.9, Z + 7] });
  }
  return b.build();
}

function Flaps() {
  const step = useGate((s) => s.step);
  const open = step === "opening" || step === "setup" || step === "entering";
  const l = useRef<THREE.Group>(null);
  const r = useRef<THREE.Group>(null);
  const led = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const red = useMemo(() => new THREE.Color("#ff3b3b").multiplyScalar(2), []);
  const green = useMemo(() => new THREE.Color(GAME_COLORS.igisoro).multiplyScalar(2.4), []);
  useFrame((_, dt) => {
    const target = open ? Math.PI / 2 - 0.05 : 0;
    for (const [g, s] of [
      [l.current, 1],
      [r.current, -1],
    ] as const) {
      if (g) g.rotation.y += (s * target - g.rotation.y) * Math.min(1, dt * 5);
    }
    led.color.lerp(open ? green : red, Math.min(1, dt * 6));
  });
  return (
    <group position={[0, 0, GATE_Z]}>
      <group ref={l} position={[-0.62, 0.75, 0]}>
        <mesh position={[0.3, 0, 0]}>
          <boxGeometry args={[0.6, 0.85, 0.025]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.45} roughness={0.05} metalness={0.2} />
        </mesh>
      </group>
      <group ref={r} position={[0.62, 0.75, 0]}>
        <mesh position={[-0.3, 0, 0]}>
          <boxGeometry args={[0.6, 0.85, 0.025]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.45} roughness={0.05} metalness={0.2} />
        </mesh>
      </group>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 1.055, 0]} material={led}>
          <boxGeometry args={[0.06, 0.035, 1.5]} />
        </mesh>
      ))}
      {/* floor arrow light in the open lane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={led}>
        <planeGeometry args={[0.16, 2.2]} />
      </mesh>
    </group>
  );
}

/** Kiosk screen: mirrors the ID flow state in 3D; in VR the virtual keyboard appears below it. */
function Kiosk({ inXR }: { inXR: boolean }) {
  const { step, identifier, code, devCode, error, busy } = useGate();
  const key = useGate((s) => s.key);
  const title =
    step === "code" ? "Enter your code" : step === "opening" || step === "setup" || step === "entering" ? "Access granted" : "Show your ID";
  const value = step === "code" ? (code + "------").slice(0, 6).split("").join(" ") : identifier || "Phone or email";
  const green = step === "opening" || step === "setup" || step === "entering";
  return (
    <group position={[KIOSK.x, 0, KIOSK.z]} rotation={[0, KIOSK.rotY, 0]}>
      <group position={[0, 1.42, 0.025]} rotation={[-0.22, 0, 0]}>
        <mesh>
          <planeGeometry args={[0.84, 0.58]} />
          <meshBasicMaterial color={green ? "#0f3a26" : "#101536"} toneMapped={false} />
        </mesh>
        <Text font={FONT} fontSize={0.035} color="#FFC83D" position={[0, 0.235, 0.002]} anchorX="center" letterSpacing={0.08}>
          GUKIRANA PLAYGROUND · ID CHECK
        </Text>
        <Text font={FONT} fontSize={0.07} color="#ffffff" position={[0, 0.15, 0.002]} anchorX="center">
          {title}
        </Text>
        {!green && (
          <>
            <mesh position={[0, 0.02, 0.001]}>
              <planeGeometry args={[0.7, 0.11]} />
              <meshBasicMaterial color="#1d2350" toneMapped={false} />
            </mesh>
            <Text font={FONT} fontSize={step === "code" ? 0.07 : 0.045} color={identifier || step === "code" ? "#ffffff" : "#8a94a6"} position={[0, 0.02, 0.003]} anchorX="center" anchorY="middle" maxWidth={0.66}>
              {busy ? "Checking..." : value}
            </Text>
          </>
        )}
        {step === "code" && devCode && (
          <Text font={FONT} fontSize={0.04} color="#7CC4FF" position={[0, -0.1, 0.002]} anchorX="center">
            {`Dev code: ${devCode}`}
          </Text>
        )}
        {green && (
          <Text font={FONT} fontSize={0.045} color="#9ff0bf" position={[0, 0.02, 0.002]} anchorX="center" maxWidth={0.7} textAlign="center">
            Welcome. The gate is open.
          </Text>
        )}
        {error && (
          <Text font={FONT} fontSize={0.03} color="#ff8a8a" position={[0, -0.19, 0.002]} anchorX="center" maxWidth={0.76} textAlign="center">
            {error}
          </Text>
        )}
      </group>
      {inXR && (step === "id" || step === "code") && (
        <group position={[0, 1.02, 0.32]} rotation={[-0.95, 0, 0]}>
          <VirtualKeyboard mode={step === "code" ? "digits" : "full"} onKey={key} width={step === "code" ? 0.42 : 0.82} />
        </group>
      )}
    </group>
  );
}

function WelcomeScreen({ tier }: { tier: Tier }) {
  const tex = useMemo(() => {
    const t = ledScreenTexture("gate-screen", ["MURAKAZA NEZA", "WELCOME", "SHOW YOUR ID TO ENTER", "GUKIRANA PLAYGROUND"]).clone();
    t.repeat.set(0.25, 1);
    t.needsUpdate = true;
    return t;
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    tex.offset.x = Math.floor(t / 4) * 0.25 + Math.min(1, (t % 4) / 0.5) * 0.25 - 0.25;
  });
  return (
    <group>
      <mesh position={[0, 7.0, GATE_Z + 3.59]}>
        <planeGeometry args={[11, 2.0]} />
        <meshBasicMaterial map={tex} toneMapped={false} color={tier === "lite" ? "#ffffff" : "#dcdcdc"} />
      </mesh>
      <Text font={FONT} fontSize={0.42} position={[0, 5.62, GATE_Z + 4.24]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
        ENTRANCE  ·  ID CHECK
        <meshBasicMaterial color={new THREE.Color("#ffffff").multiplyScalar(1.3)} toneMapped={false} />
      </Text>
      <group position={[WARDROBE.x, 0, WARDROBE.z]} rotation={[0, -Math.PI / 2, 0]}>
        <Text font={FONT} fontSize={0.32} position={[0, 3.0, 2.34]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
          WARDROBE
          <meshBasicMaterial color={new THREE.Color(GAME_COLORS.gold).multiplyScalar(1.1)} toneMapped={false} />
        </Text>
      </group>
    </group>
  );
}

/** The gate's security guard: a clearly non-player staff character in uniform (no name tag, never in player lists). */
export function Guard({ x, z, rotY, tier }: { x: number; z: number; rotY: number; tier: Tier }) {
  const anim = useRef(0);
  const look = useMemo(() => ({ ...DEFAULT_LOOK, bodyType: "masculine" as const, skinTone: "#4A2C21", hairColor: "#141010" }), []);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <Avatar look={look} animRef={anim} showTag={false} model="guard" keepClothes shadows={tier !== "lite"} quality={tier} lod />
    </group>
  );
}

export function Gate({ tier, inXR }: { tier: Tier; inXR: boolean }) {
  const geos = useMemo(() => buildGate(tier), [tier]);
  const mats = useMemo(() => worldMaterials(tier), [tier]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <group>
      {[...geos.entries()].map(([key, g]) => {
        const m = mats[key];
        if (!m) return null;
        const unlit = m instanceof THREE.MeshBasicMaterial;
        return <mesh key={key} geometry={g} material={m} castShadow={!unlit && !m.transparent && key !== "paving" && tier !== "lite"} receiveShadow={!unlit && tier !== "lite"} />;
      })}
      <Flaps />
      <Kiosk inXR={inXR} />
      <Guard x={GUARD_POST.x} z={GATE_Z + GUARD_POST.dz} rotY={GUARD_POST.rotY} tier={tier} />
      <WelcomeScreen tier={tier} />
    </group>
  );
}
