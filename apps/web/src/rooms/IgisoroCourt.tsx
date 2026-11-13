"use client";
import { useMemo } from "react";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { IGISORO_TREE, type HallLayout, type Table } from "./layouts";
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
import { imigongo, imigongoPanel, leafCard } from "./room-textures";
import { SouthWall, WindowWall } from "./shell";

/**
 * Igisoro Court — a traditional-modern Rwandan courtyard hall: terracotta floor and woven mats, clay-plaster
 * walls with tall Imigongo panels (black / white / red-ochre) between rough timber posts, a thatch-and-timber
 * ceiling with a skylight over the elders' tree (Hall of Masters, DESIGN-SPEC §6.3), carved low tables with
 * 4 × 8-pit Igisoro boards and seeds, low wooden stools, Agaseke baskets and woven pendant lamps.
 */
const FONT = "/fonts/Baloo2.ttf";
const n = (i: number) => {
  const x = Math.sin(i * 37.719 + 1.7) * 43758.5453;
  return x - Math.floor(x);
};
const BOARD = { w: 1.4, d: 0.7, pitR: 0.066, depth: 0.03, cols: 8, rows: 4 };
const pitCentre = (c: number, r: number): [number, number] => [
  (c - (BOARD.cols - 1) / 2) * (BOARD.w / BOARD.cols),
  (r - (BOARD.rows - 1) / 2) * (BOARD.d / BOARD.rows),
];

/** Carved board top: a finely tessellated plane with 32 spherical pits pressed in. */
function boardGeometry(lite: boolean) {
  const g = new THREE.PlaneGeometry(BOARD.w, BOARD.d, lite ? 64 : 96, lite ? 32 : 48).rotateX(-Math.PI / 2);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const c = Math.round(x / (BOARD.w / BOARD.cols) + (BOARD.cols - 1) / 2);
    const r = Math.round(z / (BOARD.d / BOARD.rows) + (BOARD.rows - 1) / 2);
    let y = 0;
    if (c >= 0 && c < BOARD.cols && r >= 0 && r < BOARD.rows) {
      const [cx, cz] = pitCentre(c, r);
      const d = Math.hypot(x - cx, z - cz) / BOARD.pitR;
      if (d < 1) y = -BOARD.depth * Math.sqrt(1 - d * d);
      else if (d < 1.12) y = 0.0025 * (1 - (d - 1) / 0.12); // worn lip
    }
    p.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

function taperedTube(points: THREE.Vector3[], r0: number, r1: number, segs = 24, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = frames.normals[i]!.clone()
        .multiplyScalar(Math.cos(a))
        .add(frames.binormals[i]!.clone().multiplyScalar(Math.sin(a)));
      pos.push(c.x + nx.x * r, c.y + nx.y * r, c.z + nx.z * r);
      uv.push(j / radial, t * curve.getLength() * 1.5);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The elders' tree: tapered trunk + limbs (bark PBR), leaf-card canopy rising into the skylight. */
function CourtTree({ lite }: { lite: boolean }) {
  const bark = usePbr("bark_brown_02", [2, 1]);
  const leaf = useMemo(() => leafCard(), []);
  const { trunk, limbs, ends } = useMemo(() => {
    const trunk = taperedTube(
      [
        new THREE.Vector3(0, -0.1, 0),
        new THREE.Vector3(0.08, 1.0, 0.05),
        new THREE.Vector3(-0.05, 2.0, -0.04),
        new THREE.Vector3(0.02, 2.7, 0.0),
      ],
      0.3,
      0.14,
      24,
      14,
    );
    const limbGeos: THREE.BufferGeometry[] = [];
    const ends: THREE.Vector3[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + n(k) * 0.6;
      const y0 = 1.8 + n(k + 9) * 0.8;
      const L = 1.4 + n(k + 3) * 0.9;
      const mid = new THREE.Vector3(Math.cos(a) * L * 0.5, y0 + 0.6, Math.sin(a) * L * 0.5);
      const end = new THREE.Vector3(Math.cos(a) * L, y0 + 1.3 + n(k + 5) * 0.8, Math.sin(a) * L);
      limbGeos.push(taperedTube([new THREE.Vector3(0, y0, 0), mid, end], 0.1, 0.03, 12, 8));
      ends.push(end, mid.clone().lerp(end, 0.4));
    }
    ends.push(
      new THREE.Vector3(0, 3.9, 0),
      new THREE.Vector3(0.4, 4.6, -0.3),
      new THREE.Vector3(-0.5, 4.3, 0.4),
    );
    return { trunk, limbs: limbGeos, ends };
  }, []);
  const cards = useMemo<Xform[]>(() => {
    const out: Xform[] = [];
    const count = lite ? 120 : 260;
    for (let i = 0; i < count; i++) {
      const e = ends[i % ends.length]!;
      const r = 0.2 + n(i * 3) * 0.9;
      const a = n(i * 5) * Math.PI * 2;
      out.push({
        p: [e.x + Math.cos(a) * r, e.y + (n(i * 7) - 0.4) * 0.8, e.z + Math.sin(a) * r],
        r: n(i * 11) * 6.28,
        rx: (n(i * 13) - 0.5) * 2.2,
        rz: (n(i * 17) - 0.5) * 1.2,
        s: 0.75 + n(i * 19) * 0.5,
      });
    }
    return out;
  }, [ends, lite]);
  const card = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  return (
    <group position={[IGISORO_TREE.x, 0, IGISORO_TREE.z]}>
      <mesh geometry={trunk} castShadow={!lite} receiveShadow>
        <meshStandardMaterial {...bark} color="#a08a78" roughness={0.95} />
      </mesh>
      {limbs.map((g, i) => (
        <mesh key={i} geometry={g} castShadow={!lite}>
          <meshStandardMaterial {...bark} color="#a08a78" roughness={0.95} />
        </mesh>
      ))}
      <Instanced
        geometry={card}
        items={cards}
        castShadow={!lite}
        colors={["#ffffff", "#e6f0d0", "#d0e0b8", "#f4f8e4"]}
      >
        <meshStandardMaterial map={leaf} alphaTest={0.45} side={THREE.DoubleSide} roughness={0.8} />
      </Instanced>
    </group>
  );
}

/** Agaseke: the woven basket with the tall conical lid, in natural sisal with black zig-zag bands. */
function agasekeTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d8bf8a";
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = `rgba(90,60,30,${0.08 + n(y) * 0.1})`;
    g.fillRect(0, y, 256, 1);
  }
  for (const band of [70, 150, 210]) {
    g.fillStyle = band === 150 ? "#8a2a1a" : "#1b1b1b";
    for (let x = 0; x < 256; x += 32) {
      g.beginPath();
      g.moveTo(x, band);
      g.lineTo(x + 16, band - 14);
      g.lineTo(x + 32, band);
      g.lineTo(x + 16, band + 14);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function agasekeGeometry() {
  const pts = [
    [0, 0],
    [0.07, 0],
    [0.1, 0.03],
    [0.13, 0.12],
    [0.12, 0.2],
    [0.09, 0.24],
    [0.1, 0.25],
    [0.085, 0.3],
    [0.05, 0.42],
    [0.02, 0.55],
    [0.012, 0.6],
    [0, 0.62],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 24);
}

function IgisoroTables({ tables, lite }: { tables: Table[]; lite: boolean }) {
  const wood = usePbr("wood_table_worn", [1, 0.5]);
  const woodB = usePbr("wood_table_worn", [1.4, 0.7]);
  const board = useMemo(() => boardGeometry(lite), [lite]);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const seed = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const X = useMemo(() => {
    const tops: Xform[] = [];
    const legs: Xform[] = [];
    const bodies: Xform[] = [];
    const boards: Xform[] = [];
    const seeds: Xform[] = [];
    tables.forEach((t, ti) => {
      tops.push({ p: [t.x, t.h - 0.04, t.z], s: [t.w, 0.08, t.d] });
      for (const s of [-1, 1])
        legs.push({
          p: [t.x + s * (t.w / 2 - 0.2), (t.h - 0.08) / 2, t.z],
          s: [0.16, t.h - 0.08, t.d - 0.12],
        });
      bodies.push({ p: [t.x, t.h + 0.03, t.z], s: [BOARD.w + 0.06, 0.06, BOARD.d + 0.06] });
      boards.push({ p: [t.x, t.h + 0.061, t.z] });
      const fresh = ti % 3 === 0;
      for (let c = 0; c < BOARD.cols; c++)
        for (let r = 0; r < BOARD.rows; r++) {
          const count = fresh ? 4 : Math.floor(n(ti * 97 + c * 7 + r * 31) * 7);
          const [cx, cz] = pitCentre(c, r);
          for (let k = 0; k < count; k++) {
            const a = (k / Math.max(1, count)) * Math.PI * 2 + n(ti + c + r * 3 + k);
            const rr = count === 1 ? 0 : 0.022 + n(k * 3 + c) * 0.01;
            seeds.push({
              p: [
                t.x + cx + Math.cos(a) * rr,
                t.h + 0.061 - BOARD.depth + 0.012 + (k > 4 ? 0.012 : 0),
                t.z + cz + Math.sin(a) * rr,
              ],
              r: n(k + c * 13 + r) * 6,
              rx: n(k * 7) * 3,
              s: [0.0115, 0.0085, 0.01],
            });
          }
        }
    });
    return { tops, legs, bodies, boards, seeds };
  }, [tables]);
  return (
    <group>
      <Instanced geometry={box} items={X.tops} castShadow={!lite}>
        <meshStandardMaterial {...wood} color="#d8a070" roughness={0.6} />
      </Instanced>
      <Instanced geometry={box} items={X.legs} castShadow={!lite}>
        <meshStandardMaterial {...wood} color="#b07a50" roughness={0.65} />
      </Instanced>
      <Instanced geometry={box} items={X.bodies}>
        <meshStandardMaterial {...woodB} color="#e0aa78" roughness={0.55} />
      </Instanced>
      <Instanced geometry={board} items={X.boards} castShadow={false}>
        <meshStandardMaterial {...woodB} color="#f0c08a" roughness={0.5} />
      </Instanced>
      <Instanced
        geometry={seed}
        items={X.seeds}
        colors={["#8d8a80", "#6f6a60", "#a49f92", "#5d5850", "#7e6b52"]}
        castShadow={false}
      >
        <meshStandardMaterial roughness={0.45} flatShading />
      </Instanced>
    </group>
  );
}

export function IgisoroCourt({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const tables = layout.tables;
  const floor = usePbr("terracotta_floor_tiles", [w / 2.08, d / 2.08]);
  const clay = usePbr("clay_plaster", [d / 2, h / 2]);
  const clayN = usePbr("clay_plaster", [w / 2, 0.4]);
  const thatch = usePbr("thatch_roof_angled", [6, 4]);
  const timber = usePbr("rough_wood", [1, 3]);
  const mat = usePbr("tatami_mat", [1.4, 1]);
  const panels = useMemo(() => [imigongoPanel(0), imigongoPanel(1)], []);
  const frieze = useMemo(() => imigongo([20, 1]), []);
  const agaseke = useMemo(() => agasekeTexture(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const agasekeGeo = useMemo(() => agasekeGeometry(), []);
  const shadeGeo = useMemo(() => new THREE.SphereGeometry(0.32, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), []);
  const disc = useMemo(() => new THREE.CircleGeometry(1, 20).rotateX(Math.PI / 2), []);
  const cord = useMemo(() => new THREE.CylinderGeometry(0.005, 0.005, 1, 4), []);
  const matGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const T = IGISORO_TREE;
  const SKY = { x: T.x, z: T.z, s: 5.2 };

  const X = useMemo(() => {
    // timber posts in two colonnades + along the walls
    const posts: Xform[] = [];
    for (const x of [-4.4, 4.4])
      for (const z of [-7.2, -3.2, 0.8, 4.8]) posts.push({ p: [x, h / 2, z], s: [0.22, h, 0.22] });
    // ceiling beams (along x) and purlins (along z)
    const beams: Xform[] = [];
    for (const z of [-7.2, -3.2, 0.8, 4.8]) beams.push({ p: [0, h - 0.14, z], s: [w, 0.26, 0.2] });
    for (const x of [-10, -7.2, -4.4, 4.4, 7.2, 10]) beams.push({ p: [x, h - 0.32, 0], s: [0.16, 0.14, d] });
    // Imigongo panels between wall posts on the side walls
    const panA: Xform[] = [];
    const panB: Xform[] = [];
    const wallPosts: Xform[] = [];
    [-1, 1].forEach((s) => {
      for (let i = 0; i < 6; i++) {
        const z = -7.5 + i * 3;
        (i % 2 ? panB : panA).push({
          p: [s * (w / 2 - 0.03), 2.0, z],
          r: -s * (Math.PI / 2),
          s: [1.5, 3.0, 1],
        });
        wallPosts.push({ p: [s * (w / 2 - 0.1), h / 2, z + 1.5], s: [0.2, h, 0.2] });
      }
    });
    // woven mats under each table, plus a ring of mats around the tree
    const mats: Xform[] = tables.map((t) => ({ p: [t.x, 0.006, t.z], s: [2.6, 1, 2.6] }));
    // low stools via glb; benches around the tree
    const benches: Xform[] = [
      { p: [0, 0.4, -4.7], s: [2.4, 0.08, 0.45] },
      { p: [0, 0.4, 1.5], s: [2.4, 0.08, 0.45] },
      { p: [-3.1, 0.4, -1.6], s: [0.45, 0.08, 2.4] },
      { p: [3.1, 0.4, -1.6], s: [0.45, 0.08, 2.4] },
    ];
    const benchLegs: Xform[] = benches.flatMap((b) => {
      const along = (b.s as number[])[0]! > 1;
      return [-0.9, 0, 0.9].map(
        (o) =>
          ({
            p: [b.p[0] + (along ? o : 0), 0.18, b.p[2] + (along ? 0 : o)],
            s: along ? [0.12, 0.36, 0.36] : [0.36, 0.36, 0.12],
          }) as Xform,
      );
    });
    // woven pendant lamps over the tables
    const shades: Xform[] = tables.map((t) => ({ p: [t.x, 2.3, t.z] }));
    const bulbs: Xform[] = tables.map((t) => ({ p: [t.x, 2.3, t.z], s: [0.3, 1, 0.3] }));
    const cords: Xform[] = tables.map((t) => ({ p: [t.x, (2.62 + h) / 2, t.z], s: [1, h - 2.62, 1] }));
    // Agaseke baskets on plinths along the walls
    const plinths: Xform[] = [];
    const agas: Xform[] = [];
    for (const [x, z] of [
      [-11.3, -4.4],
      [-11.3, 1.6],
      [11.3, -4.4],
      [11.3, 1.6],
      [-11.3, 5.6],
      [11.3, 5.6],
    ] as [number, number][]) {
      plinths.push({ p: [x, 0.35, z], s: [0.7, 0.7, 0.7] });
      agas.push(
        { p: [x - 0.12, 0.7, z - 0.1], s: 1.2 },
        { p: [x + 0.15, 0.7, z + 0.12], s: 0.85 },
        { p: [x + 0.1, 0.7, z - 0.2], s: 0.6 },
      );
    }
    // skylight light-well frame
    const well: Xform[] = [
      { p: [SKY.x, h + 0.5, SKY.z - SKY.s / 2], s: [SKY.s, 1.0, 0.12] },
      { p: [SKY.x, h + 0.5, SKY.z + SKY.s / 2], s: [SKY.s, 1.0, 0.12] },
      { p: [SKY.x - SKY.s / 2, h + 0.5, SKY.z], s: [0.12, 1.0, SKY.s] },
      { p: [SKY.x + SKY.s / 2, h + 0.5, SKY.z], s: [0.12, 1.0, SKY.s] },
    ];
    const skyBars: Xform[] = [-1.3, 0, 1.3].flatMap((o) => [
      { p: [SKY.x + o, h + 1.0, SKY.z], s: [0.08, 0.1, SKY.s] },
      { p: [SKY.x, h + 1.0, SKY.z + o], s: [SKY.s, 0.1, 0.08] },
    ]);
    return {
      posts,
      beams,
      panA,
      panB,
      wallPosts,
      mats,
      benches,
      benchLegs,
      shades,
      bulbs,
      cords,
      plinths,
      agas,
      well,
      skyBars,
    };
  }, [tables, w, d, h, SKY.s, SKY.x, SKY.z]);

  // ceiling with the skylight opening: four strips around it
  const ceil = useMemo(() => {
    const x0 = SKY.x - SKY.s / 2;
    const x1 = SKY.x + SKY.s / 2;
    const z0 = SKY.z - SKY.s / 2;
    const z1 = SKY.z + SKY.s / 2;
    return [
      { x: 0, z: (-d / 2 + z0) / 2, w, d: z0 + d / 2 },
      { x: 0, z: (z1 + d / 2) / 2, w, d: d / 2 - z1 },
      { x: (-w / 2 + x0) / 2, z: SKY.z, w: x0 + w / 2, d: SKY.s },
      { x: (x1 + w / 2) / 2, z: SKY.z, w: w / 2 - x1, d: SKY.s },
    ];
  }, [w, d, SKY.s, SKY.x, SKY.z]);

  const shadowBlobs: Blob[] = useMemo(
    () => [
      ...tables.map((t) => ({ x: t.x, z: t.z, w: 2.2, d: 1.4 })),
      ...layout.seats.map((s) => ({ x: s.x, z: s.z, w: 0.8, d: 0.6 })),
      { x: T.x, z: T.z, w: 4, d: 4 },
    ],
    [tables, layout.seats, T.x, T.z],
  );

  return (
    <group>
      {/* -------- lighting: warm daylight pouring through the skylight + woven pendants -------- */}
      <Environment resolution={lite ? 32 : 64} frames={1} environmentIntensity={1.0}>
        <Lightformer
          intensity={4}
          position={[T.x, 6, T.z]}
          rotation-x={Math.PI / 2}
          scale={[5, 5, 1]}
          color="#fff1d6"
        />
        <Lightformer intensity={2.4} position={[0, 2.2, -9]} scale={[22, 3, 1]} color="#e8f0f8" />
        <Lightformer
          intensity={0.8}
          position={[0, 3, 9]}
          rotation-y={Math.PI}
          scale={[22, 2, 1]}
          color="#ffcf9a"
        />
      </Environment>
      <hemisphereLight args={["#ffeccc", "#9a6a40", lite ? 1.2 : 0.9]} />
      {lite && <ambientLight intensity={0.35} />}
      <directionalLight position={[0, 6, -20]} intensity={lite ? 0.6 : 0.8} color="#e2ecf6" />
      {!lite && (
        <>
          <DownSpot
            x={T.x + 1.2}
            y={10}
            z={T.z - 0.8}
            tx={T.x}
            tz={T.z}
            angle={0.62}
            penumbra={0.6}
            intensity={140}
            distance={18}
            decay={1.4}
            color="#ffe2b0"
            shadow
          />
          {tables.map((t) => (
            <pointLight
              key={t.id}
              position={[t.x, 2.1, t.z]}
              intensity={1.6}
              distance={4}
              decay={1.8}
              color="#ffc887"
            />
          ))}
        </>
      )}
      {lite && <LightPools items={[{ x: T.x, z: T.z, w: 7, d: 7 }]} color="#ffe6b8" opacity={0.18} />}

      {/* -------- shell -------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={floor.map} normalMap={floor.normalMap} color="#d8a080" roughness={1} metalness={0} envMapIntensity={0.15} />
      </mesh>
      {ceil.map((c, i) => (
        <mesh key={i} position={[c.x, h, c.z]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[c.w, c.d]} />
          <meshStandardMaterial
            {...thatch}
            color="#e0bc80"
            roughness={1}
            emissive="#a07a48"
            emissiveMap={thatch.map}
            emissiveIntensity={1.1}
          />
        </mesh>
      ))}
      <Instanced geometry={box} items={X.well}>
        <meshStandardMaterial {...timber} color="#8a6a4a" roughness={0.9} />
      </Instanced>
      <Instanced geometry={box} items={X.skyBars} receiveShadow={false}>
        <meshStandardMaterial color="#2a2420" metalness={0.4} roughness={0.5} />
      </Instanced>
      <mesh position={[SKY.x, h + 1.04, SKY.z]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SKY.s, SKY.s]} />
        <meshStandardMaterial
          color="#dfeef6"
          transparent
          opacity={0.08}
          roughness={0.05}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Instanced geometry={box} items={X.beams} castShadow={!lite}>
        <meshStandardMaterial {...timber} color="#b08660" roughness={0.9} />
      </Instanced>
      <Instanced geometry={box} items={X.posts} castShadow={!lite}>
        <meshStandardMaterial {...timber} color="#b08660" roughness={0.9} />
      </Instanced>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2), h / 2, 0]} rotation={[0, -s * (Math.PI / 2), 0]} receiveShadow>
          <planeGeometry args={[d, h]} />
          <meshStandardMaterial {...clay} color="#e8d2b0" roughness={0.95} />
        </mesh>
      ))}
      <Instanced
        geometry={box}
        items={X.panA.map((p) => ({ ...p, s: [(p.s as number[])[0]!, (p.s as number[])[1]!, 0.03] }))}
      >
        <meshStandardMaterial map={panels[0]} roughness={0.85} />
      </Instanced>
      <Instanced
        geometry={box}
        items={X.panB.map((p) => ({ ...p, s: [(p.s as number[])[0]!, (p.s as number[])[1]!, 0.03] }))}
      >
        <meshStandardMaterial map={panels[1]} roughness={0.85} />
      </Instanced>
      <Instanced geometry={box} items={X.wallPosts}>
        <meshStandardMaterial {...timber} color="#a07850" roughness={0.9} />
      </Instanced>
      <WindowWall w={w} d={d} h={h} glassTint="#d8e6ee" glassOpacity={0.07} frameColor="#3a2a1e">
        <meshStandardMaterial {...clayN} color="#e8d2b0" roughness={0.95} />
      </WindowWall>
      <SouthWall layout={layout}>
        <meshStandardMaterial {...clayN} color="#e8d2b0" roughness={0.95} />
      </SouthWall>
      {/* Imigongo frieze above the entrance wall */}
      <mesh position={[0, 3.55, d / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w, 0.5]} />
        <meshStandardMaterial map={frieze} roughness={0.85} />
      </mesh>

      {/* -------- mats, tables, stools, pendants -------- */}
      <Instanced geometry={matGeo} items={X.mats}>
        <meshStandardMaterial {...mat} color="#c9b88e" roughness={1} />
      </Instanced>
      <IgisoroTables tables={tables} lite={lite} />
      <GltfInstances
        url={model("wooden_stool_02")}
        items={layout.seats.map((s) => ({ p: [s.x, 0, s.z], r: s.yaw + Math.PI / 2, s: 2.55 }))}
        castShadow={!lite}
      />
      <GltfInstances
        url={model("wooden_bowl_01")}
        items={tables.map((t, i) => ({ p: [t.x + (i % 2 ? -1 : 1) * 1.15, 0.01, t.z + 0.6], r: i, s: 0.9 }))}
      />
      <Instanced geometry={shadeGeo} items={X.shades} receiveShadow={false}>
        <meshStandardMaterial map={agaseke} color="#e8cf9a" roughness={0.9} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={disc} items={X.bulbs} receiveShadow={false}>
        <meshBasicMaterial color={[4, 3, 1.8]} toneMapped={false} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={cord} items={X.cords} receiveShadow={false}>
        <meshStandardMaterial color="#3a2a1e" />
      </Instanced>

      {/* -------- courtyard: planter, tree, benches, Hall of Masters -------- */}
      <mesh position={[T.x, 0.22, T.z]} castShadow={!lite} receiveShadow>
        <cylinderGeometry args={[T.r, T.r + 0.05, 0.44, 40]} />
        <meshStandardMaterial {...clayN} color="#9a5a3a" roughness={0.9} />
      </mesh>
      <mesh position={[T.x, 0.42, T.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[T.r - 0.08, 40]} />
        <meshStandardMaterial color="#3a2a1c" roughness={1} />
      </mesh>
      <CourtTree lite={lite} />
      <Instanced geometry={box} items={X.benches} castShadow={!lite}>
        <meshStandardMaterial {...timber} color="#c09068" roughness={0.75} />
      </Instanced>
      <Instanced geometry={box} items={X.benchLegs}>
        <meshStandardMaterial {...timber} color="#a07850" roughness={0.85} />
      </Instanced>
      <group position={[T.x, 0.95, T.z + T.r - 0.02]}>
        <mesh>
          <boxGeometry args={[1.2, 0.5, 0.05]} />
          <meshStandardMaterial {...timber} color="#5a3a24" roughness={0.8} />
        </mesh>
        <Text font={FONT} fontSize={0.1} position={[0, 0.12, 0.03]} color="#f1d9a0" anchorX="center">
          HALL OF MASTERS
        </Text>
        <Text
          font={FONT}
          fontSize={0.065}
          position={[0, -0.06, 0.03]}
          color="#e8d2b0"
          anchorX="center"
          maxWidth={1.1}
          textAlign="center"
        >
          Top Igisoro players are carved here each season
        </Text>
      </group>

      {/* -------- Agaseke baskets, wicker, plants -------- */}
      <Instanced geometry={box} items={X.plinths}>
        <meshStandardMaterial {...clayN} color="#c79a6a" roughness={0.9} />
      </Instanced>
      <Instanced geometry={agasekeGeo} items={X.agas} castShadow={!lite}>
        <meshStandardMaterial map={agaseke} roughness={0.85} />
      </Instanced>
      {!lite && (
        <>
          <GltfInstances
            url={model("wicker_basket_02")}
            items={[
              { p: [-11.2, 0, -7.0], s: 1.4, r: 0.6 },
              { p: [11.2, 0, -7.0], s: 1.4, r: 2.6 },
              { p: [-3.6, 0, 6.2], s: 1.2, r: 1.2 },
            ]}
          />
          <GltfInstances
            url={model("wicker_basket_01")}
            items={[
              { p: [-10.6, 0, 7.8], s: 1.6, r: 0.2 },
              { p: [10.6, 0, 7.8], s: 1.6, r: 2.2 },
            ]}
          />
        </>
      )}
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [-11.3, 0, -8.3], s: 1.5, r: 0.3 },
          { p: [11.3, 0, -8.3], s: 1.5, r: 2.0 },
          { p: [11.3, 0, 8.3], s: 1.4, r: 4.1 },
          { p: [-11.3, 0, 8.3], s: 1.4, r: 1.1 },
        ]}
      />
      <BlobShadows items={shadowBlobs} opacity={0.45} />
    </group>
  );
}
