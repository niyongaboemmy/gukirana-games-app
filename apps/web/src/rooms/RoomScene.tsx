"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox, Text } from "@react-three/drei";
import type * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { useRoom } from "./room-store";
import type { HallLayout, Table } from "./layouts";
import { cloth, imigongo, ludoBoard, plaster, terrazzo, volcanoView, woodPlanks } from "./room-textures";

const FONT = "/fonts/Baloo2.ttf";
const DOOR_OPEN_RANGE = 3.6;

/* ---------- furniture ---------- */

function Legs({ w, d, h, inset = 0.08, r = 0.035, color = "#2a1d14" }: { w: number; d: number; h: number; inset?: number; r?: number; color?: string }) {
  return (
    <>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[sx! * (w / 2 - inset), h / 2, sz! * (d / 2 - inset)]} castShadow>
          <cylinderGeometry args={[r, r * 0.8, h, 10]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
    </>
  );
}

function Chair({ x, z, yaw, wood }: { x: number; z: number; yaw: number; wood: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <RoundedBox args={[0.46, 0.06, 0.46]} radius={0.02} position={[0, 0.46, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={wood} roughness={0.55} />
      </RoundedBox>
      <RoundedBox args={[0.46, 0.5, 0.05]} radius={0.02} position={[0, 0.74, -0.21]} castShadow>
        <meshStandardMaterial color={wood} roughness={0.55} />
      </RoundedBox>
      <Legs w={0.44} d={0.44} h={0.44} r={0.018} color="#1e1611" />
    </group>
  );
}

function Stool({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.07, 24]} />
        <meshStandardMaterial color="#5a2f1d" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.72, 10]} />
        <meshStandardMaterial color="#c9ccd4" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.03, 24]} />
        <meshStandardMaterial color="#c9ccd4" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
}

const BALL_COLORS = ["#f7c600", "#1e5bd8", "#d7262b", "#5b2a86", "#f07f1a", "#178a43", "#7a1f22", "#111111", "#f7c600", "#1e5bd8", "#d7262b", "#5b2a86", "#f07f1a", "#178a43", "#7a1f22"];

function PoolTable({ t, lite }: { t: Table; lite: boolean }) {
  const felt = useMemo(() => cloth("#1F6F78"), []);
  const R = 0.0286;
  const rack = useMemo(() => {
    const out: [number, number][] = [];
    for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) out.push([0.55 + row * R * 1.75, (i - row / 2) * R * 2.02]);
    return out;
  }, []);
  return (
    <group position={[t.x, 0, t.z]}>
      {/* rails + cloth */}
      <RoundedBox args={[t.w, 0.16, t.d]} radius={0.05} position={[0, t.h - 0.02, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#4a2614" roughness={0.35} metalness={0.05} />
      </RoundedBox>
      <mesh position={[0, t.h + 0.065, 0]} receiveShadow>
        <boxGeometry args={[2.54, 0.02, 1.27]} />
        <meshStandardMaterial map={felt} roughness={0.95} />
      </mesh>
      {/* body + legs */}
      <RoundedBox args={[t.w - 0.2, 0.42, t.d - 0.2]} radius={0.04} position={[0, t.h - 0.3, 0]} castShadow>
        <meshStandardMaterial color="#3b1e10" roughness={0.4} />
      </RoundedBox>
      <Legs w={t.w - 0.3} d={t.d - 0.3} h={t.h - 0.45} r={0.07} color="#2b150a" />
      {/* pockets */}
      {[-1, 0, 1].flatMap((px) =>
        [-1, 1].map((pz) => (
          <mesh key={`${px}${pz}`} position={[px * 1.27, t.h + 0.07, pz * 0.635]}>
            <cylinderGeometry args={[0.055, 0.055, 0.03, 16]} />
            <meshStandardMaterial color="#050505" roughness={1} />
          </mesh>
        )),
      )}
      {/* racked balls + cue ball */}
      {rack.map(([bx, bz], i) => (
        <mesh key={i} position={[bx, t.h + 0.075 + R, bz]} castShadow>
          <sphereGeometry args={[R, 16, 12]} />
          <meshStandardMaterial color={BALL_COLORS[i]} roughness={0.15} metalness={0.05} />
        </mesh>
      ))}
      <mesh position={[-0.64, t.h + 0.075 + R, 0]} castShadow>
        <sphereGeometry args={[R, 16, 12]} />
        <meshStandardMaterial color="#f5f5f0" roughness={0.12} />
      </mesh>
      {/* hanging lamp */}
      <mesh position={[0, 2.25, 0]}>
        <boxGeometry args={[1.9, 0.12, 0.5]} />
        <meshStandardMaterial color="#14161f" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[0, 2.18, 0]}>
        <boxGeometry args={[1.8, 0.02, 0.42]} />
        <meshBasicMaterial color="#fff6dc" toneMapped={false} />
      </mesh>
      {[-0.8, 0.8].map((cx) => (
        <mesh key={cx} position={[cx, 3.3, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 2.1, 4]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      {!lite && <spotLight position={[0, 2.15, 0]} angle={0.9} penumbra={0.6} intensity={18} distance={5} color="#fff2d6" target-position={[t.x, 0, t.z]} />}
    </group>
  );
}

function LudoTable({ t }: { t: Table }) {
  const board = useMemo(() => ludoBoard(), []);
  return (
    <group position={[t.x, 0, t.z]}>
      <RoundedBox args={[t.w, 0.05, t.d]} radius={0.02} position={[0, t.h, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#6b4428" roughness={0.45} />
      </RoundedBox>
      <mesh position={[0, t.h + 0.027, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[t.w * 0.82, t.d * 0.82]} />
        <meshStandardMaterial map={board} roughness={0.6} />
      </mesh>
      <mesh position={[0.2, t.h + 0.05, 0.15]} castShadow>
        <boxGeometry args={[0.04, 0.04, 0.04]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <Legs w={t.w} d={t.d} h={t.h - 0.02} r={0.03} />
    </group>
  );
}

function IgisoroTable({ t }: { t: Table }) {
  const pits = useMemo(() => {
    const out: [number, number][] = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) out.push([(c - 3.5) * 0.15, (r - 1.5) * 0.13]);
    return out;
  }, []);
  return (
    <group position={[t.x, 0, t.z]}>
      <RoundedBox args={[t.w, 0.09, t.d]} radius={0.03} position={[0, t.h, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#5b3a21" roughness={0.5} />
      </RoundedBox>
      {/* carved board */}
      <RoundedBox args={[1.3, 0.06, 0.6]} radius={0.03} position={[0, t.h + 0.075, 0]} castShadow>
        <meshStandardMaterial color="#8b5a2d" roughness={0.55} />
      </RoundedBox>
      {pits.map(([px, pz], i) => (
        <group key={i} position={[px, t.h + 0.108, pz]}>
          <mesh>
            <cylinderGeometry args={[0.052, 0.045, 0.012, 14]} />
            <meshStandardMaterial color="#3b2410" roughness={0.9} />
          </mesh>
          {[0, 1].map((s) => (
            <mesh key={s} position={[(s - 0.5) * 0.03, 0.012, 0]}>
              <sphereGeometry args={[0.013, 8, 6]} />
              <meshStandardMaterial color="#d8c39a" roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
      {/* trestle legs */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (t.w / 2 - 0.18), (t.h - 0.04) / 2, 0]} castShadow>
          <boxGeometry args={[0.12, t.h - 0.04, t.d - 0.15]} />
          <meshStandardMaterial color="#3e2716" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Plant({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.18, 0.5, 20]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.5} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <mesh key={i} position={[Math.sin(i * 2.4) * 0.15, 0.75 + (i % 3) * 0.22, Math.cos(i * 2.4) * 0.15]} rotation={[Math.sin(i) * 0.5, i, Math.cos(i) * 0.5]} castShadow>
          <sphereGeometry args={[0.22, 8, 6]} />
          <meshStandardMaterial color={i % 2 ? "#2f6b34" : "#3b7d3f"} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- auto door ---------- */

function AutoDoor({ x, z, w, color }: { x: number; z: number; w: number; color: string }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(0);
  useFrame((_, dt) => {
    const near = Math.hypot(selfPose.x - x, selfPose.z - z) < DOOR_OPEN_RANGE;
    open.current += ((near ? 1 : 0) - open.current) * Math.min(1, dt * 4);
    const slide = open.current * (w / 2 - 0.05);
    if (left.current) left.current.position.x = -w / 4 - slide;
    if (right.current) right.current.position.x = w / 4 + slide;
    const isOpen = open.current > 0.7;
    if (isOpen !== useRoom.getState().doorOpen) useRoom.getState().set({ doorOpen: isOpen });
  });
  const panel = (
    <>
      <mesh>
        <boxGeometry args={[w / 2, 2.6, 0.04]} />
        <meshPhysicalMaterial color="#cfe6f2" transmission={0.9} roughness={0.05} thickness={0.02} transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[w / 2, 0.05, 0.02]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
      </mesh>
    </>
  );
  return (
    <group position={[x, 1.3, z]}>
      <group ref={left}>{panel}</group>
      <group ref={right}>{panel}</group>
      <mesh position={[0, 1.42, 0]}>
        <boxGeometry args={[w + 0.3, 0.24, 0.3]} />
        <meshStandardMaterial color="#2a2d3a" metalness={0.6} roughness={0.35} />
      </mesh>
      <Text font={FONT} fontSize={0.16} position={[0, 1.42, -0.16]} rotation={[0, Math.PI, 0]} color="#ffffff" anchorX="center" anchorY="middle">
        EXIT TO PLAZA
      </Text>
    </group>
  );
}

/* ---------- room shell ---------- */

export function RoomScene({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const g = layout.game;
  const floor = useMemo(() => (g === "ludo" ? terrazzo([6, 4.5]) : g === "pool" ? woodPlanks([92, 58, 36], [5, 4]) : woodPlanks([120, 82, 50], [5, 4])), [g]);
  const wall = useMemo(() => plaster(g === "pool" ? "#2a2c36" : g === "ludo" ? "#efe6d6" : "#e8dcc6", [6, 2]), [g]);
  const frieze = useMemo(() => imigongo([12, 1]), []);
  const view = useMemo(() => volcanoView(), []);
  const wallColor = g === "pool" ? "#3a3d4a" : "#ffffff";
  const half = layout.door.w / 2;
  const seg = (w - layout.door.w) / 2;

  return (
    <group>
      {/* local, offline environment lighting (no HDRI download) */}
      <Environment resolution={lite ? 32 : 128} frames={1}>
        <Lightformer intensity={2.5} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} color={g === "pool" ? "#ffe6c4" : "#ffffff"} />
        <Lightformer intensity={1.6} position={[0, 2, -9]} scale={[14, 3, 1]} color="#cfe8ff" />
        <Lightformer intensity={0.8} position={[10, 2, 0]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} color={layout.color} />
      </Environment>
      <ambientLight intensity={g === "pool" ? 0.25 : 0.45} />
      <hemisphereLight args={["#fff4e0", "#3a2a1c", g === "pool" ? 0.35 : 0.6]} />
      <directionalLight
        position={[4, 8, -14]}
        intensity={g === "pool" ? 0.6 : 1.4}
        color="#fff1d8"
        castShadow={!lite}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />

      {/* floor + ceiling */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={floor} roughness={g === "ludo" ? 0.35 : 0.55} metalness={0.02} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={g === "pool" ? "#15161d" : "#f4efe6"} roughness={0.9} />
      </mesh>
      {[-6, 0, 6].map((x) =>
        [-4, 1.5].map((z) => (
          <mesh key={`${x}${z}`} position={[x, h - 0.02, z]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, 0.5]} />
            <meshBasicMaterial color={g === "pool" ? "#ffe2b0" : "#fffaf0"} toneMapped={false} />
          </mesh>
        )),
      )}

      {/* side walls with Imigongo frieze */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (w / 2), h / 2, 0]} rotation={[0, -s * (Math.PI / 2), 0]}>
          <mesh receiveShadow>
            <planeGeometry args={[d, h]} />
            <meshStandardMaterial map={wall} color={wallColor} roughness={0.85} />
          </mesh>
          <mesh position={[0, -h / 2 + 1.25, 0.01]}>
            <planeGeometry args={[d, 0.45]} />
            <meshStandardMaterial map={frieze} roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* north wall: panoramic window onto the volcanoes */}
      <group position={[0, 0, -d / 2]}>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[w, 0.9, 0.2]} />
          <meshStandardMaterial map={wall} color={wallColor} roughness={0.85} />
        </mesh>
        <mesh position={[0, h - 0.35, 0]}>
          <boxGeometry args={[w, 0.7, 0.2]} />
          <meshStandardMaterial map={wall} color={wallColor} roughness={0.85} />
        </mesh>
        <mesh position={[0, 2.25, -6]}>
          <planeGeometry args={[34, 12]} />
          <meshBasicMaterial map={view} toneMapped={false} />
        </mesh>
        <mesh position={[0, 2.25, -0.02]}>
          <planeGeometry args={[w, h - 1.6]} />
          <meshPhysicalMaterial color="#e8f4fb" transmission={1} roughness={0.03} transparent opacity={0.12} />
        </mesh>
        {[-9, -6, -3, 0, 3, 6, 9].map((mx) => (
          <mesh key={mx} position={[mx, 2.25, 0.02]}>
            <boxGeometry args={[0.08, h - 1.6, 0.12]} />
            <meshStandardMaterial color="#20232e" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
        {/* neon sign */}
        <Text font={FONT} fontSize={0.62} position={[0, h - 0.32, 0.14]} color={layout.color} anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#ffffff">
          {layout.title.toUpperCase()}
        </Text>
      </group>

      {/* south wall with the entrance door opening */}
      <group position={[0, h / 2, d / 2]} rotation={[0, Math.PI, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (half + seg / 2), 0, 0]} receiveShadow>
            <planeGeometry args={[seg, h]} />
            <meshStandardMaterial map={wall} color={wallColor} roughness={0.85} />
          </mesh>
        ))}
        <mesh position={[0, 1.45, 0]}>
          <planeGeometry args={[layout.door.w, h - 2.9]} />
          <meshStandardMaterial map={wall} color={wallColor} roughness={0.85} />
        </mesh>
        {/* live screen beside the door */}
        <mesh position={[-6, 0.5, 0.02]}>
          <planeGeometry args={[3.2, 1.8]} />
          <meshBasicMaterial color="#0b0d1a" toneMapped={false} />
        </mesh>
        <Text font={FONT} fontSize={0.26} position={[-6, 0.85, 0.04]} color={layout.color} anchorX="center">
          {layout.title}
        </Text>
        <Text font={FONT} fontSize={0.17} position={[-6, 0.45, 0.04]} color="#ffffff" anchorX="center" maxWidth={2.9} textAlign="center">
          {`${layout.subtitle}\nSit at a table to play`}
        </Text>
      </group>
      <AutoDoor x={layout.door.x} z={d / 2 - 0.05} w={layout.door.w} color={layout.color} />
      {/* outside the door: a glimpse of the plaza */}
      <mesh position={[0, 0.001, d / 2 + 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6, 4]} />
        <meshStandardMaterial color="#cfd3dc" roughness={0.8} />
      </mesh>

      {/* tables + seats */}
      {layout.tables.map((t) =>
        g === "pool" ? <PoolTable key={t.id} t={t} lite={lite} /> : g === "ludo" ? <LudoTable key={t.id} t={t} /> : <IgisoroTable key={t.id} t={t} />,
      )}
      {layout.seats.map((s) => (g === "pool" ? <Stool key={s.id} x={s.x} z={s.z} /> : <Chair key={s.id} x={s.x} z={s.z} yaw={s.yaw} wood={g === "igisoro" ? "#4a2f1c" : "#8a5a35"} />))}

      {/* room-specific details */}
      {g === "pool" && (
        <group position={[0, 0, -7.6]}>
          <RoundedBox args={[7, 1.1, 0.7]} radius={0.05} position={[0, 0.55, 0]} castShadow receiveShadow>
            <meshStandardMaterial color="#3b1e10" roughness={0.35} />
          </RoundedBox>
          <mesh position={[0, 1.12, 0]}>
            <boxGeometry args={[7.1, 0.05, 0.8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.4} />
          </mesh>
          {/* cue rack */}
          {[-3, -2.8, -2.6, -2.4].map((cx) => (
            <mesh key={cx} position={[cx + 8.3, 1.4, 0.2]} rotation={[0, 0, 0.04]}>
              <cylinderGeometry args={[0.012, 0.018, 1.45, 8]} />
              <meshStandardMaterial color="#e9c58b" roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}
      {[
        [-10.8, -7.8],
        [10.8, -7.8],
        [-10.8, 7.6],
        [10.8, 7.6],
        [-10.8, -1.5],
        [10.8, -1.5],
      ].map(([px, pz], i) => (
        <Plant key={i} x={px!} z={pz!} s={g === "igisoro" ? 1.3 : 1} />
      ))}
      {!lite && <ContactShadows position={[0, 0.005, 0]} scale={[w, d]} opacity={0.35} blur={2.4} far={2.5} resolution={512} />}
    </group>
  );
}
