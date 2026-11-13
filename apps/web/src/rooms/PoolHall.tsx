"use client";
import { useMemo } from "react";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { HallLayout, Table } from "./layouts";
import {
  BlobShadows,
  DownSpot,
  GltfInstances,
  Instanced,
  LightPools,
  model,
  usePbr,
  type Blob,
  type Xform,
} from "./interior-kit";
import { ballAtlas, clubRug, feltTexture } from "./room-textures";
import { SouthWall, WindowWall } from "./shell";

/**
 * Pool Hall — a dark, moody Kigali billiards club: four tournament 9-ft tables (walnut rails with pearl
 * diamonds, leather pocket drops, blue worsted cloth, numbered balls) each under a three-shade billiard
 * lamp, exposed brick and dark wainscot, a backlit bar on the west wall, a chesterfield lounge and neon on
 * the east wall, cue racks and bead scoreboards, and the full-width window onto the Virungas.
 */
const FONT = "/fonts/Baloo2.ttf";
const R = 0.028575; // ball radius (57.15 mm)
const n = (i: number) => {
  const x = Math.sin(i * 91.345 + 7.1) * 43758.5453;
  return x - Math.floor(x);
};

/* ---------------- shared geometry ---------------- */

function legGeometry(h: number) {
  const pts = [
    [0.0, 0],
    [0.09, 0],
    [0.09, 0.05],
    [0.065, 0.08],
    [0.06, h * 0.35],
    [0.085, h * 0.55],
    [0.07, h * 0.75],
    [0.075, h - 0.06],
    [0.095, h - 0.04],
    [0.095, h],
    [0, h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 20);
}

function shadeGeometry() {
  const pts = [
    [0.035, 0.22],
    [0.05, 0.2],
    [0.09, 0.14],
    [0.17, 0.04],
    [0.2, 0.0],
    [0.198, -0.01],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 28);
}

function cueGeometry() {
  // 1.47 m cue, standing on its butt: rubber bumper, black butt, wrap, maple shaft, ferrule, tip
  const L = 1.47;
  const pts = [
    [0, 0],
    [0.0145, 0],
    [0.0148, 0.02],
    [0.0145, 0.25],
    [0.0135, 0.45],
    [0.0125, 0.68],
    [0.0115, 0.74],
    [0.0085, 1.1],
    [0.0065, L - 0.03],
    [0.0064, L - 0.006],
    [0.006, L],
    [0, L],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 10);
}

/** All balls of the room merged into one mesh (one draw call) with UVs into the numbered-ball atlas. */
function ballsGeometry(tables: Table[]) {
  const base = new THREE.SphereGeometry(R, 14, 10);
  const parts: THREE.BufferGeometry[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const m = new THREE.Matrix4();
  const add = (num: number, x: number, z: number, seed: number) => {
    const g = base.clone();
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const col = num % 4;
    const row = Math.floor(num / 4);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, (3 - row + uv.getY(i)) / 4);
    e.set(n(seed) * 6.28, n(seed + 1) * 6.28, n(seed + 2) * 6.28);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g);
  };
  const ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  tables.forEach((t, ti) => {
    const y = t.h + R;
    const pushAt = (num: number, lx: number, lz: number, seed: number) => {
      add(num, t.x + lx, t.z + lz, seed);
      const last = parts[parts.length - 1]!;
      last.translate(0, y, 0);
    };
    if (ti % 3 === 0) {
      // racked on the foot spot, cue ball behind the head string
      let k = 0;
      for (let row = 0; row < 5; row++)
        for (let i = 0; i <= row; i++)
          pushAt(ORDER[k++]!, 0.635 + row * R * 1.74, (i - row / 2) * R * 2.01, ti * 100 + k * 3);
      pushAt(0, -0.635, 0, ti * 100 + 77);
    } else {
      // a game in progress
      for (let b = 0; b < 16; b++) {
        if (b > 0 && n(ti * 31 + b) < 0.35) continue;
        pushAt(b, (n(ti * 17 + b * 3) - 0.5) * 2.3, (n(ti * 23 + b * 5) - 0.5) * 1.1, ti * 100 + b * 7);
      }
    }
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  base.dispose();
  return merged;
}

/* ---------------- 9-ft table ---------------- */

const POCKETS: [number, number][] = [
  [-1.27, -0.635],
  [0, -0.665],
  [1.27, -0.635],
  [-1.27, 0.635],
  [0, 0.665],
  [1.27, 0.635],
];

function PoolTables({ tables, lite }: { tables: Table[]; lite: boolean }) {
  const h = tables[0]!.h;
  const walnut = usePbr("black_walnut_veneer_01", [2, 1]);
  const leather = usePbr("brown_leather", [1, 1]);
  const velour = usePbr("velour_velvet", [10, 5], { map: false });
  const felt = useMemo(() => feltTexture("#17508a"), []);
  const balls = useMemo(() => ballsGeometry(tables), [tables]);
  const atlas = useMemo(() => ballAtlas(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const leg = useMemo(() => legGeometry(h - 0.32), [h]);
  const disc = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 20), []);
  const cup = useMemo(() => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), []);

  const X = useMemo(() => {
    const per = (f: (t: Table) => Xform[]) => tables.flatMap(f);
    return {
      cabinet: per((t) => [{ p: [t.x, h - 0.17, t.z], s: [2.72, 0.26, 1.48] }]),
      rails: per((t) => [
        { p: [t.x, h - 0.01, t.z - 0.755], s: [2.9, 0.1, 0.14] },
        { p: [t.x, h - 0.01, t.z + 0.755], s: [2.9, 0.1, 0.14] },
        { p: [t.x - 1.385, h - 0.01, t.z], s: [0.13, 0.1, 1.37] },
        { p: [t.x + 1.385, h - 0.01, t.z], s: [0.13, 0.1, 1.37] },
      ]),
      bed: per((t) => [{ p: [t.x, h - 0.015, t.z], s: [2.64, 0.03, 1.37] }]),
      cushions: per((t) => [
        { p: [t.x - 0.635, h + 0.018, t.z - 0.66], s: [1.12, 0.042, 0.05] },
        { p: [t.x + 0.635, h + 0.018, t.z - 0.66], s: [1.12, 0.042, 0.05] },
        { p: [t.x - 0.635, h + 0.018, t.z + 0.66], s: [1.12, 0.042, 0.05] },
        { p: [t.x + 0.635, h + 0.018, t.z + 0.66], s: [1.12, 0.042, 0.05] },
        { p: [t.x - 1.295, h + 0.018, t.z], s: [0.05, 0.042, 1.1] },
        { p: [t.x + 1.295, h + 0.018, t.z], s: [0.05, 0.042, 1.1] },
      ]),
      legs: per((t) =>
        [
          [-1.12, -0.52],
          [1.12, -0.52],
          [-1.12, 0.52],
          [1.12, 0.52],
        ].map(([lx, lz]) => ({ p: [t.x + lx!, 0, t.z + lz!] }) as Xform),
      ),
      holes: per((t) =>
        POCKETS.map(
          ([px, pz]) => ({ p: [t.x + px, h + 0.001, t.z + pz], s: [0.062, 0.004, 0.062] }) as Xform,
        ),
      ),
      cups: per((t) =>
        POCKETS.map(
          ([px, pz]) =>
            ({ p: [t.x + px * 1.035, h - 0.04, t.z + pz * 1.09], s: [0.085, 0.11, 0.085] }) as Xform,
        ),
      ),
      irons: per((t) =>
        POCKETS.map(
          ([px, pz]) =>
            ({ p: [t.x + px * 1.035, h + 0.042, t.z + pz * 1.09], s: [0.085, 0.006, 0.085] }) as Xform,
        ),
      ),
      diamonds: per((t) => {
        const out: Xform[] = [];
        for (let k = 1; k < 8; k++) {
          if (k === 4) continue;
          const x = -1.27 + k * 0.3175;
          out.push({ p: [t.x + x, h + 0.041, t.z - 0.755], r: Math.PI / 4, s: [0.014, 0.003, 0.014] });
          out.push({ p: [t.x + x, h + 0.041, t.z + 0.755], r: Math.PI / 4, s: [0.014, 0.003, 0.014] });
        }
        for (let k = 1; k < 4; k++) {
          const z = -0.635 + k * 0.3175;
          out.push({ p: [t.x - 1.385, h + 0.041, t.z + z], r: Math.PI / 4, s: [0.014, 0.003, 0.014] });
          out.push({ p: [t.x + 1.385, h + 0.041, t.z + z], r: Math.PI / 4, s: [0.014, 0.003, 0.014] });
        }
        return out;
      }),
      spots: per((t) => [
        { p: [t.x + 0.635, h + 0.0012, t.z], s: [0.012, 0.001, 0.012] },
        { p: [t.x - 0.635, h + 0.0012, t.z], s: [0.012, 0.001, 0.012] },
      ]),
      chalk: per((t) => [{ p: [t.x - 1.385, h + 0.052, t.z + 0.2], r: 0.3, s: [0.022, 0.022, 0.022] }]),
    };
  }, [tables, h]);

  return (
    <group>
      <Instanced geometry={box} items={X.cabinet} castShadow={!lite}>
        <meshStandardMaterial {...walnut} color="#5a3a26" roughness={0.45} />
      </Instanced>
      <Instanced geometry={box} items={X.rails} castShadow={!lite}>
        <meshStandardMaterial {...walnut} color="#6a432a" roughness={0.32} envMapIntensity={1.2} />
      </Instanced>
      <Instanced geometry={box} items={X.bed}>
        <meshStandardMaterial
          map={felt}
          normalMap={velour.normalMap}
          normalScale={new THREE.Vector2(0.35, 0.35)}
          roughness={0.92}
        />
      </Instanced>
      <Instanced geometry={box} items={X.cushions} castShadow={!lite}>
        <meshStandardMaterial map={felt} roughness={0.95} />
      </Instanced>
      <Instanced geometry={leg} items={X.legs} castShadow={!lite}>
        <meshStandardMaterial {...walnut} color="#4a2e1c" roughness={0.4} />
      </Instanced>
      <Instanced geometry={disc} items={X.holes} receiveShadow={false}>
        <meshBasicMaterial color="#030303" />
      </Instanced>
      <Instanced geometry={cup} items={X.cups}>
        <meshStandardMaterial {...leather} color="#6b4630" roughness={0.6} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={disc} items={X.irons}>
        <meshStandardMaterial {...leather} color="#3a2416" roughness={0.5} />
      </Instanced>
      <Instanced geometry={box} items={X.diamonds} receiveShadow={false}>
        <meshStandardMaterial color="#efe9dc" roughness={0.2} metalness={0.1} />
      </Instanced>
      <Instanced geometry={disc} items={X.spots} receiveShadow={false}>
        <meshStandardMaterial color="#e8e8e0" roughness={0.8} />
      </Instanced>
      <Instanced geometry={box} items={X.chalk}>
        <meshStandardMaterial color="#2c78c8" roughness={0.9} />
      </Instanced>
      <mesh geometry={balls} castShadow={!lite} receiveShadow>
        <meshPhysicalMaterial map={atlas} roughness={0.08} clearcoat={1} clearcoatRoughness={0.05} />
      </mesh>
    </group>
  );
}

/* ---------------- billiard lamps ---------------- */

function TableLamps({ tables, lite }: { tables: Table[]; lite: boolean }) {
  const shade = useMemo(() => shadeGeometry(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const disc = useMemo(() => new THREE.CircleGeometry(1, 24).rotateX(Math.PI / 2), []);
  const rod = useMemo(() => new THREE.CylinderGeometry(0.004, 0.004, 1, 4), []);
  const Y = 1.82;
  const X = useMemo(() => {
    const shades: Xform[] = [];
    const bulbs: Xform[] = [];
    const bars: Xform[] = [];
    const rods: Xform[] = [];
    for (const t of tables) {
      for (const dx of [-0.82, 0, 0.82]) {
        shades.push({ p: [t.x + dx, Y, t.z] });
        bulbs.push({ p: [t.x + dx, Y + 0.02, t.z], s: [0.18, 1, 0.18] });
      }
      bars.push({ p: [t.x, Y + 0.25, t.z], s: [2.0, 0.07, 0.11] });
      for (const dx of [-0.7, 0.7])
        rods.push({ p: [t.x + dx, (Y + 0.29 + 4.4) / 2, t.z], s: [1, 4.4 - Y - 0.29, 1] });
    }
    return { shades, bulbs, bars, rods };
  }, [tables]);
  return (
    <group>
      <Instanced geometry={shade} items={X.shades} receiveShadow={false}>
        <meshStandardMaterial
          color="#123a2a"
          metalness={0.55}
          roughness={0.28}
          side={THREE.DoubleSide}
          emissive="#3a2a10"
          emissiveIntensity={0.15}
        />
      </Instanced>
      <Instanced geometry={disc} items={X.bulbs} receiveShadow={false}>
        <meshBasicMaterial color={[6, 5.2, 4.0]} toneMapped={false} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={box} items={X.bars}>
        <meshStandardMaterial color="#3a2618" roughness={0.4} metalness={0.2} />
      </Instanced>
      <Instanced geometry={rod} items={X.rods} receiveShadow={false}>
        <meshStandardMaterial color="#9a7a3a" metalness={0.9} roughness={0.3} />
      </Instanced>
      {!lite &&
        tables.map((t) => (
          <DownSpot
            key={t.id}
            x={t.x}
            y={Y - 0.05}
            z={t.z}
            angle={1.0}
            penumbra={0.55}
            intensity={18}
            distance={7}
            color="#ffe9c8"
            shadow
          />
        ))}
    </group>
  );
}

/* ---------------- room ---------------- */

export function PoolHall({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const tables = layout.tables;
  const floor = usePbr("dark_wooden_planks", [w / 2, d / 2]);
  const brick = usePbr("red_brick_03", [d, h]);
  const brickN = usePbr("red_brick_03", [w, 0.65]);
  const walnut = usePbr("black_walnut_veneer_01", [6, 1]);
  const leather = usePbr("brown_leather", [2, 1]);
  const velour = usePbr("velour_velvet", [4, 4], { map: false });
  const rug = useMemo(() => clubRug(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 24), []);
  const cue = useMemo(() => cueGeometry(), []);
  const bead = useMemo(() => new THREE.SphereGeometry(1, 8, 6), []);

  const BAR_X = -10.0;
  const BAR_Z0 = -5;
  const BAR_Z1 = 3;
  const barLen = BAR_Z1 - BAR_Z0;
  const barZ = (BAR_Z0 + BAR_Z1) / 2;

  const X = useMemo(() => {
    // acoustic panels on the south wall (fabric over mineral wool, 1.2 × 1.2 m)
    const panels: Xform[] = [];
    for (const x of [-10.5, -9.1, -7.7, -6.3, -4.9, -3.5, 3.5, 4.9, 6.3, 7.7, 9.1, 10.5])
      for (const y of [1.6, 2.95]) panels.push({ p: [x, y, d / 2 - 0.04], s: [1.3, 1.25, 0.06] });
    // wainscot panels on the brick side walls
    const wains: Xform[] = [
      { p: [-w / 2 + 0.03, 0.55, 0], s: [0.06, 1.1, d] },
      { p: [w / 2 - 0.03, 0.55, 0], s: [0.06, 1.1, d] },
    ];
    const capRail: Xform[] = [
      { p: [-w / 2 + 0.06, 1.12, 0], s: [0.1, 0.04, d] },
      { p: [w / 2 - 0.06, 1.12, 0], s: [0.1, 0.04, d] },
    ];
    // cue racks: west (north of the bar) + east walls
    const racks: { x: number; z: number; s: number }[] = [
      { x: -w / 2 + 0.05, z: -7.2, s: 1 },
      { x: w / 2 - 0.05, z: -6.2, s: -1 },
      { x: w / 2 - 0.05, z: 3.4, s: -1 },
    ];
    const rackBoards: Xform[] = racks.flatMap((r) => [
      { p: [r.x + r.s * 0.03, 1.55, r.z], s: [0.04, 1.6, 1.0] },
      { p: [r.x + r.s * 0.1, 0.12, r.z], s: [0.14, 0.05, 1.0] },
      { p: [r.x + r.s * 0.09, 1.5, r.z], s: [0.12, 0.04, 1.0] },
    ]);
    const cues: Xform[] = racks.flatMap((r, ri) =>
      Array.from({ length: 8 }, (_, k) => ({
        p: [r.x + r.s * 0.1, 0.14, r.z - 0.42 + k * 0.12] as [number, number, number],
        rz: -r.s * 0.035,
        r: n(ri * 9 + k) * 6,
      })),
    );
    // bead scoreboards over the tables' long walls
    const boards: Xform[] = [];
    const beads: Xform[] = [];
    const beadCol: string[] = [];
    for (const t of tables) {
      const sx = Math.sign(t.x);
      const wx = sx * (w / 2 - 0.06);
      if (sx < 0 && t.z > BAR_Z0 - 0.5 && t.z < BAR_Z1 + 0.5) continue; // the bar takes that wall
      boards.push({ p: [wx, 2.4, t.z], s: [0.05, 0.3, 1.4] });
      for (let row = 0; row < 2; row++)
        for (let k = 0; k < 15; k++) {
          const off = k < 4 + ((row * 3 + tables.indexOf(t)) % 5) ? -0.6 + k * 0.05 : 0.0 + k * 0.05;
          beads.push({ p: [wx - sx * 0.05, 2.33 + row * 0.14, t.z + off], s: [0.028, 0.028, 0.028] });
          beadCol.push(row ? "#d9c7a2" : "#3a2516");
        }
    }
    const beadRails: Xform[] = boards.flatMap((b) =>
      [0, 1].map((row) => ({
        p: [b.p[0] - Math.sign(b.p[0]) * 0.05, 2.33 + row * 0.14, b.p[2]] as [number, number, number],
        s: [0.004, 0.004, 1.32],
      })),
    );
    // bar: counter, foot rail, back-bar shelves
    const barBody: Xform[] = [{ p: [BAR_X, 0.53, barZ], s: [0.7, 1.06, barLen] }];
    const barTop: Xform[] = [{ p: [BAR_X + 0.06, 1.085, barZ], s: [0.9, 0.05, barLen + 0.1] }];
    const backCab: Xform[] = [{ p: [-w / 2 + 0.3, 0.45, barZ], s: [0.55, 0.9, barLen - 0.6] }];
    const shelves: Xform[] = [1.45, 1.85, 2.25, 2.65].map((y) => ({
      p: [-w / 2 + 0.16, y, barZ],
      s: [0.28, 0.025, barLen - 1.2],
    }));
    const bottles: Record<string, Xform[]> = { bordeaux: [], alsace: [], burgundy: [], champagne: [] };
    const kinds = Object.keys(bottles);
    [1.465, 1.865, 2.265].forEach((y, si) => {
      for (let k = 0; k < 16; k++) {
        const z = barZ - (barLen - 1.4) / 2 + k * ((barLen - 1.4) / 15) + (n(k * 3 + si) - 0.5) * 0.12;
        const kind = kinds[(k + si * 3 + Math.floor(n(k * 7 + si) * 3)) % 4]!;
        bottles[kind]!.push({ p: [-w / 2 + 0.16, y, z], r: n(k + si * 30) * 6.28 });
      }
    });
    const stools: Xform[] = [-4.2, -2.9, -1.6, -0.3, 1.0, 2.3].map((z) => ({ p: [BAR_X + 0.85, 0, z] }));
    return {
      panels,
      wains,
      capRail,
      rackBoards,
      cues,
      boards,
      beads,
      beadCol,
      beadRails,
      barBody,
      barTop,
      backCab,
      shelves,
      bottles,
      stools,
    };
  }, [w, d, tables, barLen, barZ]);

  const rugs: Blob[] = tables.map((t) => ({ x: t.x, z: t.z, w: 6.2, d: 4.4 }));
  const shadowBlobs: Blob[] = useMemo(
    () => [
      ...tables.map((t) => ({ x: t.x, z: t.z, w: 3.6, d: 2.3, o: 1 })),
      ...layout.seats.map((s) => ({ x: s.x, z: s.z, w: 1.1, d: 1.1 })),
      { x: 11.2, z: -1.2, w: 1.4, d: 2.6 },
      { x: BAR_X, z: barZ, w: 1.3, d: barLen + 0.6 },
    ],
    [tables, layout.seats, barZ, barLen],
  );

  return (
    <group>
      {/* -------- lighting: dim warm club; light comes from the lamps, the back bar and the window -------- */}
      <Environment resolution={lite ? 32 : 64} frames={1} environmentIntensity={0.4}>
        <Lightformer
          intensity={1.2}
          position={[0, 3.5, 0]}
          rotation-x={Math.PI / 2}
          scale={[10, 6, 1]}
          color="#ffdcae"
        />
        <Lightformer intensity={2.2} position={[0, 2.2, -9]} scale={[22, 3, 1]} color="#cfe0ef" />
        <Lightformer
          intensity={1.2}
          position={[-11, 2, -1]}
          rotation-y={Math.PI / 2}
          scale={[8, 1.5, 1]}
          color="#ffb060"
        />
        <Lightformer
          intensity={0.8}
          position={[11, 2.6, -1]}
          rotation-y={-Math.PI / 2}
          scale={[4, 1, 1]}
          color="#3d8bff"
        />
      </Environment>
      <hemisphereLight args={["#ffe9cc", "#2a1d14", lite ? 0.75 : 0.22]} />
      {lite && <ambientLight intensity={0.35} />}
      <directionalLight position={[2, 6, -14]} intensity={lite ? 0.5 : 0.7} color="#dbe8f5" />
      {!lite && (
        <>
          <pointLight position={[-11.0, 2.2, barZ]} intensity={6} distance={7} decay={1.5} color="#ffaa55" />
          <pointLight
            position={[BAR_X + 0.6, 2.8, barZ]}
            intensity={5}
            distance={6}
            decay={1.5}
            color="#ffd29a"
          />
          <pointLight position={[10.6, 2.8, -1.2]} intensity={3} distance={6} decay={1.5} color="#4b8dff" />
          <pointLight position={[9.4, 2.3, -1.2]} intensity={6} distance={6} decay={1.5} color="#ffc98a" />
          <pointLight position={[0, 3.6, 6]} intensity={4} distance={9} decay={1.5} color="#ffdcae" />
        </>
      )}

      {/* -------- shell -------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        {/* matte floor: no glossy light streaks (the texture's roughness map is glossy) */}
        <meshStandardMaterial map={floor.map} normalMap={floor.normalMap} color="#a08070" roughness={0.95} metalness={0} envMapIntensity={0.15} />
      </mesh>
      {rugs.map((r, i) => (
        <mesh key={i} position={[r.x, 0.006, r.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[r.w, r.d]} />
          <meshStandardMaterial map={rug} roughness={1} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#121214" roughness={0.95} />
      </mesh>
      {/* black exposed ducts + beams */}
      <Instanced
        geometry={cyl}
        items={[
          { p: [-7.5, h - 0.35, 0], rx: Math.PI / 2, s: [0.28, d, 0.28] },
          { p: [7.5, h - 0.35, 0], rx: Math.PI / 2, s: [0.28, d, 0.28] },
        ]}
        receiveShadow={false}
      >
        <meshStandardMaterial color="#1b1c1f" metalness={0.6} roughness={0.5} />
      </Instanced>
      <Instanced
        geometry={box}
        items={[-6, -2, 2, 6].map((z) => ({ p: [0, h - 0.15, z], s: [w, 0.3, 0.22] }) as Xform)}
        receiveShadow={false}
      >
        <meshStandardMaterial color="#17181b" roughness={0.8} />
      </Instanced>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2), h / 2, 0]} rotation={[0, -s * (Math.PI / 2), 0]} receiveShadow>
          <planeGeometry args={[d, h]} />
          <meshStandardMaterial {...brick} color="#9a8a82" roughness={0.9} />
        </mesh>
      ))}
      <Instanced geometry={box} items={X.wains}>
        <meshStandardMaterial {...walnut} color="#3a2416" roughness={0.45} />
      </Instanced>
      <Instanced geometry={box} items={X.capRail}>
        <meshStandardMaterial color="#2a1a10" roughness={0.4} />
      </Instanced>
      <WindowWall w={w} d={d} h={h} glassTint="#6d7f8a" glassOpacity={0.14} frameColor="#141518">
        <meshStandardMaterial {...brickN} color="#8a7a72" roughness={0.9} />
      </WindowWall>
      <SouthWall layout={layout}>
        <meshStandardMaterial color="#1f2126" roughness={0.85} />
      </SouthWall>
      <Instanced geometry={box} items={X.panels}>
        <meshStandardMaterial
          normalMap={velour.normalMap}
          roughnessMap={velour.roughnessMap}
          color="#2b3442"
          roughness={1}
        />
      </Instanced>

      {/* -------- tables, lamps, club chairs -------- */}
      <PoolTables tables={tables} lite={lite} />
      <TableLamps tables={tables} lite={lite} />
      {lite && (
        <LightPools
          items={tables.map((t) => ({ x: t.x, z: t.z, w: 3.4, d: 2.2 }))}
          color="#ffe2b0"
          opacity={0.25}
          y={tables[0]!.h + 0.002}
        />
      )}
      <GltfInstances
        url={model("mid_century_lounge_chair")}
        items={layout.seats.map((s) => ({ p: [s.x, 0, s.z], r: s.yaw, s: 0.95 }))}
      />

      {/* -------- bar (west wall) -------- */}
      <Instanced geometry={box} items={X.barBody} castShadow={!lite}>
        <meshStandardMaterial {...leather} color="#4a2c1c" roughness={0.55} />
      </Instanced>
      <Instanced geometry={box} items={X.barTop}>
        <meshStandardMaterial color="#141414" roughness={0.12} metalness={0.3} envMapIntensity={1.4} />
      </Instanced>
      <mesh position={[BAR_X + 0.47, 0.22, barZ]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.022, 0.022, barLen, 12]} />
        <meshStandardMaterial color="#b08a3a" metalness={0.95} roughness={0.22} />
      </mesh>
      {/* LED strip under the bar top */}
      <mesh position={[BAR_X + 0.48, 1.05, barZ]}>
        <boxGeometry args={[0.02, 0.012, barLen]} />
        <meshBasicMaterial color={[3, 1.9, 0.9]} toneMapped={false} />
      </mesh>
      <Instanced geometry={box} items={X.backCab}>
        <meshStandardMaterial {...walnut} color="#3a2416" roughness={0.45} />
      </Instanced>
      {/* backlit amber panel behind the bottles */}
      <mesh position={[-w / 2 + 0.02, 2.05, barZ]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[barLen - 1.2, 1.5]} />
        <meshBasicMaterial color={[0.75, 0.38, 0.13]} toneMapped={false} />
      </mesh>
      <Instanced geometry={box} items={X.shelves}>
        <meshStandardMaterial color="#cfe3ea" transparent opacity={0.45} roughness={0.05} metalness={0.2} />
      </Instanced>
      {!lite && (
        <>
          {Object.entries(X.bottles).map(([k, items]) => (
            <GltfInstances key={k} url={model("wine_bottles_01")} pick={k} items={items} />
          ))}
        </>
      )}
      <BarStools items={X.stools} leather={leather} lite={lite} />
      <GltfInstances
        url={model("hanging_industrial_lamp")}
        items={[-3.8, -1.3, 1.2].map((z) => ({ p: [BAR_X + 0.1, h, z], s: 0.85 }) as Xform)}
        matOverride={(m) => {
          if (m.name.includes("glass")) {
            m.emissive.set("#ffcf8a");
            m.emissiveIntensity = 2.5;
          }
        }}
      />
      <Text
        font={FONT}
        fontSize={0.34}
        position={[-w / 2 + 0.05, 3.25, barZ]}
        rotation={[0, Math.PI / 2, 0]}
        anchorX="center"
      >
        THE BREAK BAR
        <meshBasicMaterial color={[2.6, 1.5, 0.6]} toneMapped={false} />
      </Text>

      {/* -------- lounge (east wall) -------- */}
      <mesh position={[9.9, 0.007, -1.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.8, 4.4]} />
        <meshStandardMaterial map={rug} color="#9aa0b8" roughness={1} />
      </mesh>
      <GltfInstances
        url={model("sofa_02")}
        items={[{ p: [11.35, 0, -1.2], r: -Math.PI / 2, s: 1.15 }]}
        castShadow={!lite}
      />
      <GltfInstances
        url={model("mid_century_lounge_chair")}
        items={[
          { p: [8.7, 0, -3.0], r: Math.PI / 2 + 0.5, s: 0.95 },
          { p: [8.7, 0, 0.6], r: Math.PI / 2 - 0.5, s: 0.95 },
        ]}
        castShadow={!lite}
      />
      <GltfInstances url={model("Ottoman_01")} items={[{ p: [8.0, 0, -1.2], r: Math.PI / 2, s: 0.75 }]} />
      <mesh position={[9.75, 0.42, -1.2]} castShadow={!lite}>
        <boxGeometry args={[0.6, 0.05, 1.1]} />
        <meshStandardMaterial {...walnut} color="#4a2e1c" roughness={0.3} />
      </mesh>
      <mesh position={[9.75, 0.2, -1.2]}>
        <boxGeometry args={[0.5, 0.4, 1.0]} />
        <meshStandardMaterial color="#141414" metalness={0.7} roughness={0.35} />
      </mesh>
      {!lite && (
        <>
          <GltfInstances
            url={model("dartboard")}
            items={[{ p: [w / 2 - 0.04, 1.73, 5.4], r: -Math.PI / 2 }]}
          />
          <mesh position={[w / 2 - 0.06, 1.73, 5.4]} rotation={[0, -Math.PI / 2, 0]}>
            <boxGeometry args={[1.0, 1.0, 0.04]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
        </>
      )}
      {/* neon: script logo + 8-ball ring */}
      <Text
        font={FONT}
        fontSize={0.55}
        position={[w / 2 - 0.05, 2.95, -1.2]}
        rotation={[0, -Math.PI / 2, 0]}
        anchorX="center"
        outlineWidth={0.01}
        outlineColor="#9ec9ff"
      >
        Gukirana Billiards
        <meshBasicMaterial color={[0.6, 1.6, 4.0]} toneMapped={false} />
      </Text>
      <mesh position={[w / 2 - 0.06, 2.95, 1.75]} rotation={[0, -Math.PI / 2, 0]}>
        <torusGeometry args={[0.32, 0.018, 8, 48]} />
        <meshBasicMaterial color={[4, 1.2, 2.6]} toneMapped={false} />
      </mesh>
      <Text
        font={FONT}
        fontSize={0.42}
        position={[w / 2 - 0.06, 2.93, 1.75]}
        rotation={[0, -Math.PI / 2, 0]}
        anchorX="center"
        anchorY="middle"
      >
        8
        <meshBasicMaterial color={[3.6, 3.6, 3.6]} toneMapped={false} />
      </Text>

      {/* -------- cue racks, scoreboards, screens -------- */}
      <Instanced geometry={box} items={X.rackBoards}>
        <meshStandardMaterial {...walnut} color="#4a2e1c" roughness={0.4} />
      </Instanced>
      {!lite && (
        <>
          <Instanced geometry={cue} items={X.cues} castShadow={false}>
            <meshStandardMaterial color="#d8b77e" roughness={0.35} />
          </Instanced>
          <Instanced geometry={box} items={X.boards}>
            <meshStandardMaterial {...walnut} color="#5a3a26" roughness={0.4} />
          </Instanced>
          <Instanced geometry={box} items={X.beadRails} receiveShadow={false}>
            <meshStandardMaterial color="#b9a26a" metalness={0.9} roughness={0.3} />
          </Instanced>
          <Instanced geometry={bead} items={X.beads} colors={X.beadCol} receiveShadow={false}>
            <meshStandardMaterial roughness={0.35} />
          </Instanced>
        </>
      )}
      {[-6.5, 6.5].map((x) => (
        <group key={x} position={[x, 2.45, d / 2 - 0.08]} rotation={[0, Math.PI, 0]}>
          <mesh>
            <boxGeometry args={[2.1, 1.2, 0.06]} />
            <meshStandardMaterial color="#0b0c10" roughness={0.3} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.032]}>
            <planeGeometry args={[2.0, 1.1]} />
            <meshBasicMaterial color="#0c1830" toneMapped={false} />
          </mesh>
          <Text font={FONT} fontSize={0.16} position={[0, 0.36, 0.04]} color="#7fb6ff" anchorX="center">
            LIVE TABLES · 8-BALL
          </Text>
          <Text
            font={FONT}
            fontSize={0.12}
            position={[0, -0.05, 0.04]}
            color="#ffffff"
            anchorX="center"
            maxWidth={1.8}
            textAlign="center"
            lineHeight={1.4}
          >
            {"Sit at a table to play\nRace to 5 · Call your pockets"}
          </Text>
        </group>
      ))}

      {/* -------- plants, contact shadows -------- */}
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [-11.3, 0, -8.3], s: 1.5, r: 0.3 },
          { p: [11.3, 0, -8.3], s: 1.5, r: 2.0 },
          { p: [11.3, 0, 8.3], s: 1.4, r: 4.1 },
          { p: [-11.3, 0, 8.3], s: 1.4, r: 1.1 },
        ]}
      />
      <BlobShadows items={shadowBlobs} opacity={0.6} />
    </group>
  );
}

/** Leather-topped bar stools with chrome stem, foot ring and base (procedural, instanced). */
function BarStools({
  items,
  leather,
  lite,
}: {
  items: Xform[];
  leather: ReturnType<typeof usePbr>;
  lite: boolean;
}) {
  const seat = useMemo(() => new THREE.CylinderGeometry(0.2, 0.18, 0.09, 24).translate(0, 0.76, 0), []);
  const stem = useMemo(() => new THREE.CylinderGeometry(0.028, 0.028, 0.72, 10).translate(0, 0.38, 0), []);
  const base = useMemo(() => new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24).translate(0, 0.015, 0), []);
  const ring = useMemo(
    () => new THREE.TorusGeometry(0.17, 0.01, 6, 24).rotateX(Math.PI / 2).translate(0, 0.3, 0),
    [],
  );
  return (
    <>
      <Instanced geometry={seat} items={items} castShadow={!lite}>
        <meshStandardMaterial {...leather} color="#5a2f1d" roughness={0.5} />
      </Instanced>
      <Instanced geometry={stem} items={items}>
        <meshStandardMaterial color="#c9ccd4" metalness={0.95} roughness={0.18} />
      </Instanced>
      <Instanced geometry={base} items={items}>
        <meshStandardMaterial color="#c9ccd4" metalness={0.95} roughness={0.18} />
      </Instanced>
      <Instanced geometry={ring} items={items}>
        <meshStandardMaterial color="#c9ccd4" metalness={0.95} roughness={0.18} />
      </Instanced>
    </>
  );
}
