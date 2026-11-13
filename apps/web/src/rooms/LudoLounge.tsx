"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import type { HallLayout, Table } from "./layouts";
import { BlobShadows, GltfInstances, Instanced, model, usePbr, type Blob, type Xform } from "./interior-kit";
import { diceAtlas, kitenge, ludoBoard, menuBoard } from "./room-textures";
import { SouthWall, WindowWall } from "./shell";
import { hallFrame } from "./OutdoorView";

/**
 * Ludo Lounge — a bright Kigali social café: herringbone oak floor, warm plaster with a terracotta accent
 * wall, oak ceiling baffles, six café tables with Ludo boards, tokens and dice, upholstered armchairs,
 * globe pendants, a coffee bar with espresso machine and chalk menu, a velvet-sofa lounge on a Kitenge rug,
 * plants, and the morning sun slanting in through the window onto the terraced hills (real sun direction).
 */
const FONT = "/fonts/Baloo2.ttf";
const TOKEN_COLORS = ["#E53935", "#43A047", "#FDD835", "#1E88E5"];
const n = (i: number) => {
  const x = Math.sin(i * 51.77 + 3.3) * 43758.5453;
  return x - Math.floor(x);
};

function pawnGeometry() {
  const pts = [
    [0, 0],
    [0.017, 0],
    [0.017, 0.006],
    [0.012, 0.01],
    [0.007, 0.026],
    [0.011, 0.03],
    [0.006, 0.033],
    [0.0095, 0.038],
    [0.0095, 0.044],
    [0.006, 0.05],
    [0, 0.052],
  ].map(([x, y]) => new THREE.Vector2(x! * 1.25, y! * 1.25));
  return new THREE.LatheGeometry(pts, 14);
}

/** Box with each face mapped to a cell of the 3 × 2 dice atlas (opposite faces sum to 7). */
function diceGeometry(s: number) {
  const g = new THREE.BoxGeometry(s, s, s);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z → pips 3, 4, 1, 6, 2, 5
  const faces = [2, 3, 0, 5, 1, 4];
  for (let f = 0; f < 6; f++) {
    const cx = faces[f]! % 3;
    const cy = Math.floor(faces[f]! / 3);
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (cx + uv.getX(i)) / 3, (1 - cy) * 0.5 + uv.getY(i) * 0.5);
    }
  }
  return g;
}

function LudoTables({ tables, lite }: { tables: Table[]; lite: boolean }) {
  const oak = usePbr("oak_veneer_01", [1, 1]);
  const board = useMemo(() => ludoBoard(), []);
  const dice = useMemo(() => diceAtlas(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 20), []);
  const pawn = useMemo(() => pawnGeometry(), []);
  const die = useMemo(() => diceGeometry(0.022), []);
  const X = useMemo(() => {
    const tops: Xform[] = [];
    const stems: Xform[] = [];
    const feet: Xform[] = [];
    const boards: Xform[] = [];
    const frames: Xform[] = [];
    const pawns: Xform[] = [];
    const pawnCols: string[] = [];
    const dices: Xform[] = [];
    const cups: Xform[] = [];
    tables.forEach((t, ti) => {
      tops.push({ p: [t.x, t.h - 0.02, t.z], s: [t.w, 0.04, t.d] });
      stems.push({ p: [t.x, (t.h - 0.04) / 2, t.z], s: [0.045, t.h - 0.04, 0.045] });
      feet.push({ p: [t.x, 0.012, t.z], s: [0.7, 0.024, 0.08], r: Math.PI / 4 });
      feet.push({ p: [t.x, 0.012, t.z], s: [0.7, 0.024, 0.08], r: -Math.PI / 4 });
      const rot = (ti % 4) * (Math.PI / 2) + 0.06 * (n(ti) - 0.5);
      boards.push({ p: [t.x, t.h + 0.008, t.z], r: rot, s: [0.86, 0.016, 0.86] });
      frames.push({ p: [t.x, t.h + 0.006, t.z], r: rot, s: [0.9, 0.012, 0.9] });
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const at = (lx: number, lz: number): [number, number, number] => [
        t.x + lx * c + lz * sn,
        t.h + 0.016,
        t.z - lx * sn + lz * c,
      ];
      // tokens: some at home, some out on the track
      for (let p = 0; p < 4; p++)
        for (let k = 0; k < 4; k++) {
          const S = 0.86 / 15;
          const home: [number, number][] = [
            [1.9, 1.9],
            [4.1, 1.9],
            [1.9, 4.1],
            [4.1, 4.1],
          ];
          const corner = [
            [0, 0],
            [9, 0],
            [9, 9],
            [0, 9],
          ][p]!;
          let gx = (corner[0]! + home[k]![0]) * S - 0.43;
          let gz = (corner[1]! + home[k]![1]) * S - 0.43;
          if (n(ti * 40 + p * 4 + k) < 0.4) {
            const cell = Math.floor(n(ti * 13 + p * 7 + k) * 13);
            const arm = Math.floor(n(ti * 3 + p + k * 5) * 4);
            const along = (cell - 6) * S;
            const across = (Math.floor(n(ti + k * 2 + p) * 3) - 1) * S;
            gx = arm % 2 ? along : across;
            gz = arm % 2 ? across : along;
          }
          pawns.push({ p: at(gx, gz) });
          pawnCols.push(TOKEN_COLORS[p]!);
        }
      for (let k = 0; k < 2; k++)
        dices.push({ p: at(0.5 + k * 0.035, 0.42 - k * 0.02), r: n(ti * 5 + k) * 6, s: 1 });
      dices.forEach((d) => (d.p[1] = t.h + 0.011));
      cups.push({ p: at(-0.48, -0.47), s: [0.04, 0.09, 0.04] });
    });
    return { tops, stems, feet, boards, frames, pawns, pawnCols, dices, cups };
  }, [tables]);
  return (
    <group>
      <Instanced geometry={box} items={X.tops} castShadow={!lite}>
        <meshStandardMaterial {...oak} color="#e9d2b0" roughness={0.45} />
      </Instanced>
      <Instanced geometry={cyl} items={X.stems} castShadow={!lite}>
        <meshStandardMaterial color="#1c1c1e" metalness={0.6} roughness={0.4} />
      </Instanced>
      <Instanced geometry={box} items={X.feet}>
        <meshStandardMaterial color="#1c1c1e" metalness={0.6} roughness={0.4} />
      </Instanced>
      <Instanced geometry={box} items={X.frames}>
        <meshStandardMaterial color="#6b4428" roughness={0.4} />
      </Instanced>
      <Instanced geometry={box} items={X.boards}>
        {/* the board texture is on the top face (+y) of the unit box */}
        <meshStandardMaterial map={board} roughness={0.35} />
      </Instanced>
      <Instanced geometry={pawn} items={X.pawns} colors={X.pawnCols} castShadow={!lite}>
        <meshStandardMaterial roughness={0.25} />
      </Instanced>
      <Instanced geometry={die} items={X.dices} castShadow={!lite}>
        <meshStandardMaterial map={dice} roughness={0.3} />
      </Instanced>
      <Instanced geometry={cyl} items={X.cups}>
        <meshStandardMaterial color="#f6f2ea" roughness={0.3} />
      </Instanced>
    </group>
  );
}

/** Modern sofa: plinth, seat cushions, back cushions, arms (procedural, velvet). */
function Sofa({
  x,
  z,
  yaw,
  color,
  velour,
  lite,
}: {
  x: number;
  z: number;
  yaw: number;
  color: string;
  velour: ReturnType<typeof usePbr>;
  lite: boolean;
}) {
  const mat = (
    <meshStandardMaterial
      normalMap={velour.normalMap}
      roughnessMap={velour.roughnessMap}
      color={color}
      roughness={1}
    />
  );
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[2.0, 0.08, 0.85]} />
        <meshStandardMaterial color="#2a2018" roughness={0.6} />
      </mesh>
      <RoundedBox
        args={[2.1, 0.26, 0.9]}
        radius={0.05}
        position={[0, 0.23, 0]}
        castShadow={!lite}
        receiveShadow
      >
        {mat}
      </RoundedBox>
      {[-0.47, 0.47].map((sx) => (
        <RoundedBox
          key={sx}
          args={[0.92, 0.14, 0.7]}
          radius={0.06}
          position={[sx, 0.42, 0.06]}
          castShadow={!lite}
          receiveShadow
        >
          {mat}
        </RoundedBox>
      ))}
      <RoundedBox
        args={[2.1, 0.5, 0.22]}
        radius={0.08}
        position={[0, 0.6, -0.34]}
        castShadow={!lite}
        receiveShadow
      >
        {mat}
      </RoundedBox>
      {[-1, 1].map((s) => (
        <RoundedBox
          key={s}
          args={[0.18, 0.56, 0.9]}
          radius={0.07}
          position={[s * 1.0, 0.4, 0]}
          castShadow={!lite}
          receiveShadow
        >
          {mat}
        </RoundedBox>
      ))}
    </group>
  );
}

/** Signature element (DESIGN-SPEC §6.3): the giant floating die over the lounge, slowly turning. */
function GiantDie({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Group>(null);
  const dice = useMemo(() => diceAtlas(), []);
  const geo = useMemo(() => diceGeometry(0.8), []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.set(0.6 + Math.sin(t * 0.21) * 0.2, t * 0.25, 0.5);
    g.position.y = 2.75 + Math.sin(t * 0.6) * 0.06;
  });
  return (
    <group position={[x, 2.75, z]}>
      <group ref={ref}>
        <mesh geometry={geo}>
          <meshStandardMaterial map={dice} roughness={0.25} emissive="#ff8a1f" emissiveIntensity={0.05} />
        </mesh>
      </group>
    </group>
  );
}

export function LudoLounge({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const tables = layout.tables;
  const frame = useMemo(() => hallFrame(layout), [layout]);
  const floor = usePbr("herringbone_parquet", [w / 3.4, d / 3.4]);
  const plaster = usePbr("white_plaster_02", [d / 2, h / 2]);
  const plasterN = usePbr("white_plaster_02", [w / 2, 0.5]);
  const oak = usePbr("oak_veneer_01", [4, 1]);
  const velour = usePbr("velour_velvet", [3, 2], { map: false });
  const rug = useMemo(() => kitenge(["#f3e3c3", "#e2621b", "#0f7c7a", "#f2b632", "#2b2d6e"]), []);
  const cushion = useMemo(() => kitenge(["#2b2d6e", "#f2b632", "#e2621b", "#0f7c7a", "#f3e3c3"], [2, 2]), []);
  const menu = useMemo(() => menuBoard(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cord = useMemo(() => new THREE.CylinderGeometry(0.004, 0.004, 1, 4), []);
  const bean = useMemo(() => new THREE.SphereGeometry(1, 24, 16), []);
  const pastry = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  const jar = useMemo(() => new THREE.CylinderGeometry(0.8, 0.8, 1, 14), []);
  const PENDANT_Y = 1.95;

  const X = useMemo(() => {
    const baffles: Xform[] = [];
    for (let x = -11; x <= 11; x += 0.5) baffles.push({ p: [x, h - 0.2, -0.5], s: [0.06, 0.3, d - 3] });
    const pendants: Xform[] = tables.map((t) => ({ p: [t.x, PENDANT_Y - 0.22, t.z], s: 0.95 }));
    const counterPend: Xform[] = [-2.2, 0.5, 3.2].map((z) => ({ p: [-10.6, 2.35 - 0.22, z], s: 0.75 }));
    const cords: Xform[] = [...pendants, ...counterPend].map((p) => {
      const top = p.p[1] + 1.17 * (p.s as number);
      return { p: [p.p[0], (top + h) / 2, p.p[2]], s: [1, h - top, 1] };
    });
    // coffee counter (west): body + top + back counter + shelves
    const counter: Xform[] = [{ p: [-10.55, 0.5, 0.5], s: [0.75, 1.0, 6.6] }];
    const counterTop: Xform[] = [{ p: [-10.5, 1.02, 0.5], s: [0.9, 0.04, 6.8] }];
    const slats: Xform[] = [];
    for (let z = -2.7; z <= 3.7; z += 0.1) slats.push({ p: [-10.16, 0.5, z], s: [0.025, 0.96, 0.05] });
    const backCounter: Xform[] = [{ p: [-11.72, 0.45, 0.5], s: [0.55, 0.9, 6.6] }];
    const shelves: Xform[] = [1.55, 2.05].map((y) => ({ p: [-11.82, y, 0.5], s: [0.3, 0.04, 5.0] }));
    const jars: Xform[] = [];
    for (let k = 0; k < 14; k++)
      for (const y of [1.57, 2.07])
        jars.push({ p: [-11.82, y + 0.09, -1.6 + k * 0.32], s: [0.06, 0.18, 0.06] });
    const cups: Xform[] = [];
    for (let k = 0; k < 8; k++)
      cups.push({ p: [-11.65, 0.95, 2.4 + (k % 4) * 0.1], s: [0.04, 0.07 + Math.floor(k / 4) * 0.0, 0.04] });
    // wall art: Kitenge canvases on the south wall
    const art: Xform[] = [-9, -5.5, 5.5, 9].map((x) => ({ p: [x, 2.1, d / 2 - 0.03], s: [2.2, 1.5, 0.04] }));
    return {
      baffles,
      pendants,
      counterPend,
      cords,
      counter,
      counterTop,
      slats,
      backCounter,
      shelves,
      jars,
      cups,
      art,
    };
  }, [tables, h, d]);

  const shadowBlobs: Blob[] = useMemo(
    () => [
      ...tables.map((t) => ({ x: t.x, z: t.z, w: 2.6, d: 2.6 })),
      // contact shadow under every armchair so the furniture sits on the floor
      ...layout.seats.map((s) => ({ x: s.x, z: s.z, w: 1.05, d: 1.05, r: s.yaw })),
      { x: -10.8, z: 0.5, w: 1.6, d: 7.2 },
      { x: 11.2, z: -3.4, w: 1.4, d: 2.6 },
      { x: 11.2, z: 1.6, w: 1.4, d: 2.6 },
    ],
    [tables, layout.seats],
  );
  const sunPos = useMemo(() => frame.sun.clone().multiplyScalar(30), [frame]);
  const beans: Xform[] = [
    { p: [8.3, 0.24, -2.1], s: [0.45, 0.3, 0.45] },
    { p: [8.1, 0.24, 0.3], s: [0.45, 0.3, 0.45] },
  ];

  return (
    <group>
      {/* -------- lighting: bright morning, sun from the real direction (north-east glazing) -------- */}
      <Environment resolution={lite ? 32 : 64} frames={1} environmentIntensity={0.9}>
        <Lightformer
          intensity={2.2}
          position={[0, 4, 0]}
          rotation-x={Math.PI / 2}
          scale={[16, 10, 1]}
          color="#fff6ea"
        />
        <Lightformer intensity={3} position={[0, 2.2, -9]} scale={[22, 3.2, 1]} color="#e6f1ff" />
        <Lightformer
          intensity={1}
          position={[-11, 2, 0]}
          rotation-y={Math.PI / 2}
          scale={[10, 2, 1]}
          color="#ffe2c0"
        />
      </Environment>
      <hemisphereLight args={["#fff4e2", "#8a6a4a", lite ? 1.2 : 0.75]} />
      {lite && <ambientLight intensity={0.4} />}
      <directionalLight
        position={sunPos}
        intensity={lite ? 0.85 : 1.05}
        color="#ffe6c4"
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
      {/* window skylight fill (no shadow) */}
      <directionalLight position={[0, 5, -20]} intensity={lite ? 0.35 : 0.45} color="#dcecff" />
      {!lite &&
        tables.map((t) => (
          <pointLight
            key={t.id}
            position={[t.x, PENDANT_Y - 0.1, t.z]}
            intensity={2.4}
            distance={4.5}
            decay={1.8}
            color="#ffd7a0"
          />
        ))}

      {/* -------- shell -------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        {/* warm oak, matte-satin: keeps its grain and colour in the sun patches (no washed-out white) */}
        <meshStandardMaterial map={floor.map} normalMap={floor.normalMap} color="#d9b98f" roughness={1} metalness={0} envMapIntensity={0.12} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#f5f0e8" roughness={0.9} />
      </mesh>
      <Instanced geometry={box} items={X.baffles} receiveShadow={false}>
        <meshStandardMaterial {...oak} color="#e3c69e" roughness={0.6} />
      </Instanced>
      {/* west: warm plaster; east: terracotta accent wall */}
      <mesh position={[-w / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow={!lite}>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial
          normalMap={plaster.normalMap}
          roughnessMap={plaster.roughnessMap}
          color="#f4ead8"
          roughness={0.9}
        />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow castShadow={!lite}>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial
          normalMap={plaster.normalMap}
          roughnessMap={plaster.roughnessMap}
          color="#c8643a"
          roughness={0.9}
        />
      </mesh>
      <WindowWall
        w={w}
        d={d}
        h={h}
        sill={0.45}
        head={4.05}
        glassTint="#c8dce6"
        glassOpacity={0.07}
        frameColor="#2a2a2c"
      >
        <meshStandardMaterial normalMap={plasterN.normalMap} color="#f4ead8" roughness={0.9} />
      </WindowWall>
      <SouthWall layout={layout}>
        <meshStandardMaterial normalMap={plasterN.normalMap} color="#f3ebdd" roughness={0.9} />
      </SouthWall>
      <Instanced geometry={box} items={X.art}>
        <meshStandardMaterial map={cushion} roughness={0.85} />
      </Instanced>

      {/* -------- tables, armchairs, pendants -------- */}
      <LudoTables tables={tables} lite={lite} />
      <GltfInstances
        url={model("modern_arm_chair_01")}
        items={layout.seats.map((s) => ({ p: [s.x, 0, s.z], r: s.yaw, s: 0.92 }))}
        castShadow={!lite}
      />
      <GltfInstances
        url={model("modern_ceiling_lamp_01")}
        items={[...X.pendants, ...X.counterPend]}
        matOverride={(m) => {
          if (m.name.includes("glass")) {
            m.emissive.set("#ffd9a6");
            m.emissiveIntensity = 1.6;
          }
        }}
      />
      <Instanced geometry={cord} items={X.cords} receiveShadow={false}>
        <meshStandardMaterial color="#1a1a1a" />
      </Instanced>

      {/* -------- coffee bar (west wall) -------- */}
      <Instanced geometry={box} items={X.counter} castShadow={!lite}>
        <meshStandardMaterial color="#2f3a3a" roughness={0.6} />
      </Instanced>
      <Instanced geometry={box} items={X.slats}>
        <meshStandardMaterial {...oak} color="#e0bf90" roughness={0.5} />
      </Instanced>
      <Instanced geometry={box} items={X.counterTop}>
        <meshStandardMaterial color="#f1ede6" roughness={0.18} metalness={0.05} />
      </Instanced>
      <Instanced geometry={box} items={X.backCounter}>
        <meshStandardMaterial {...oak} color="#d8b98c" roughness={0.5} />
      </Instanced>
      <Instanced geometry={box} items={X.shelves}>
        <meshStandardMaterial {...oak} color="#d8b98c" roughness={0.5} />
      </Instanced>
      {!lite && (
        <>
          <Instanced
            geometry={jar}
            items={X.jars}
            colors={["#6b3e1f", "#c98a3c", "#3f2a1a", "#e9e2d0", "#8a4b2a"]}
          >
            <meshStandardMaterial roughness={0.15} metalness={0.05} transparent opacity={0.92} />
          </Instanced>
        </>
      )}
      <Instanced geometry={jar} items={X.cups}>
        <meshStandardMaterial color="#f8f6f0" roughness={0.25} />
      </Instanced>
      {/* espresso machine + grinder */}
      <group position={[-11.72, 0.9, -1.2]}>
        <RoundedBox args={[0.5, 0.42, 0.8]} radius={0.04} position={[0, 0.21, 0]} castShadow={!lite}>
          <meshStandardMaterial color="#d0d3d8" metalness={0.95} roughness={0.15} />
        </RoundedBox>
        <mesh position={[0.2, 0.25, 0]}>
          <boxGeometry args={[0.12, 0.08, 0.7]} />
          <meshStandardMaterial color="#e2621b" roughness={0.4} />
        </mesh>
        {[-0.2, 0.2].map((gz) => (
          <mesh key={gz} position={[0.28, 0.12, gz]}>
            <cylinderGeometry args={[0.035, 0.03, 0.08, 16]} />
            <meshStandardMaterial color="#222" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      </group>
      <group position={[-11.72, 0.9, 0.0]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.09, 0.11, 0.4, 16]} />
          <meshStandardMaterial color="#222" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.48, 0]}>
          <coneGeometry args={[0.11, 0.18, 16, 1, true]} />
          <meshStandardMaterial color="#6b3e1f" transparent opacity={0.7} roughness={0.1} />
        </mesh>
      </group>
      {/* pastry case */}
      <mesh position={[-10.45, 1.2, 2.6]}>
        <boxGeometry args={[0.5, 0.32, 1.2]} />
        <meshStandardMaterial
          color="#dfeef2"
          transparent
          opacity={0.25}
          roughness={0.05}
          depthWrite={false}
        />
      </mesh>
      <Instanced
        geometry={pastry}
        items={Array.from(
          { length: 8 },
          (_, k) =>
            ({
              p: [-10.5 + (k % 2) * 0.16, 1.08, 2.15 + Math.floor(k / 2) * 0.28],
              s: [0.07, 0.035, 0.05],
            }) as Xform,
        )}
        colors={["#c98a3c", "#a86a2a", "#e0b070"]}
      >
        <meshStandardMaterial roughness={0.7} />
      </Instanced>
      <mesh position={[-w / 2 + 0.03, 2.75, 0.5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.4, 1.5]} />
        <meshStandardMaterial map={menu} roughness={0.9} />
      </mesh>
      {!lite && (
        <>
          <GltfInstances
            url={model("potted_plant_04")}
            items={[
              { p: [-11.82, 2.07, 2.9], s: 1.1 },
              { p: [-11.82, 1.57, -2.2], s: 1.0, r: 1 },
              { p: [-10.5, 1.04, -2.4], s: 0.9, r: 2 },
            ]}
          />
        </>
      )}

      {/* -------- lounge (east): sofas, bean bags, rug, coffee table, giant die -------- */}
      <mesh position={[9.8, 0.006, -0.9]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4.0, 6.4]} />
        <meshStandardMaterial map={rug} roughness={1} />
      </mesh>
      <Sofa x={11.3} z={-3.4} yaw={-Math.PI / 2} color="#0f6f6c" velour={velour} lite={lite} />
      <Sofa x={11.3} z={1.6} yaw={-Math.PI / 2} color="#d9a12a" velour={velour} lite={lite} />
      {!lite && (
        <>
          <GltfInstances
            url={model("throw_pillows_01")}
            items={[
              { p: [11.15, 0.47, -3.4], r: -Math.PI / 2, s: 0.8 },
              { p: [11.15, 0.47, 1.6], r: -Math.PI / 2, s: 0.8 },
            ]}
          />
        </>
      )}
      <Instanced geometry={bean} items={beans} castShadow={!lite}>
        <meshStandardMaterial map={cushion} roughness={0.95} />
      </Instanced>
      <RoundedBox
        args={[1.0, 0.38, 1.0]}
        radius={0.05}
        position={[9.4, 0.19, -0.9]}
        castShadow={!lite}
        receiveShadow
      >
        <meshStandardMaterial {...oak} color="#c9a070" roughness={0.45} />
      </RoundedBox>
      <GltfInstances
        url={model("Ottoman_01")}
        items={[{ p: [9.1, 0, 2.6], r: 0.3, s: 0.7 }]}
        tint="#d9cbb5"
      />
      <GiantDie x={9.6} z={-0.9} />
      <Text
        font={FONT}
        fontSize={0.62}
        position={[w / 2 - 0.04, 3.2, -0.9]}
        rotation={[0, -Math.PI / 2, 0]}
        anchorX="center"
      >
        Ludo Lounge
        <meshBasicMaterial color={[3.2, 1.4, 0.3]} toneMapped={false} />
      </Text>
      <Text
        font={FONT}
        fontSize={0.2}
        position={[w / 2 - 0.04, 2.7, -0.9]}
        rotation={[0, -Math.PI / 2, 0]}
        color="#fff4e0"
        anchorX="center"
      >
        Every roll verified fair · Gukirana
      </Text>

      {/* -------- plants -------- */}
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [-11.3, 0, -8.3], s: 1.6, r: 0.3 },
          { p: [11.3, 0, -8.3], s: 1.6, r: 2.0 },
          { p: [11.3, 0, 8.3], s: 1.4, r: 4.1 },
          { p: [-11.3, 0, 8.3], s: 1.4, r: 1.1 },
          { p: [-5.0, 0, -8.4], s: 1.2, r: 0.8 },
          { p: [5.0, 0, -8.4], s: 1.2, r: 2.8 },
          { p: [11.4, 0, 5.4], s: 1.2, r: 1.8 },
        ]}
      />
      <BlobShadows items={shadowBlobs} opacity={0.5} />
    </group>
  );
}
