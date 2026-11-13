"use client";
import { useMemo } from "react";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useWorld } from "@/lib/world-store";
import { POOL_BAR, type HallLayout, type Table } from "./layouts";
import { BlobShadows, GltfInstances, Instanced, LightPools, model, usePbr, type Blob, type Xform } from "./interior-kit";
import { ballAtlas, feltTexture, loungeRug } from "./room-textures";
import { SouthWall, WindowWall } from "./shell";
import { STATUS_COLOR, tableNo, tableStatuses } from "./table-status";

/**
 * Pool Hall — a big, calm, contemporary billiards lounge (36 × 28 m, 5 m ceiling): twelve 9-ft tournament tables in
 * three rows with the full 1.5 m cue clearance round every table, a long oak bar on the west wall, a lounge on the
 * east wall, spectator banquettes along the walls and a full-width north window onto the Virungas.
 *
 * Eye comfort (no glare): every surface is matte (roughness ≥ 0.8, metalness 0, envMapIntensity ≤ 0.2, no
 * clearcoat), balls are satin; there are no bare bright sources — billiard lights are deep matte housings with a
 * recessed opal diffuser, all emissives stay below the bloom threshold (tone-mapped, < 1) and the light on the tables
 * comes from one soft overhead key (even across every bed, like real tournament lighting) plus sky fill, not from
 * point lights with hot-spots. The glazing is unlit low-reflection glass with sheer blinds diffusing the upper bays.
 *
 * Choosing a table: each table has a number on its light and a status colour (free / waiting / playing) on a soft
 * floor ring and a band under the light, read live from the server-claimed seats (rooms/table-status.ts).
 */
const FONT = "/fonts/Baloo2.ttf";
const R = 0.028575; // ball radius (57.15 mm)
const LAMP_Y = 2.04; // housing centre: the opal diffuser sits ≈ 1.2 m above the bed
const SLAT_Y = 4.86; // timber slat ceiling (the black open soffit is above it at h; the follow camera stays below)
const n = (i: number) => {
  const x = Math.sin(i * 91.345 + 7.1) * 43758.5453;
  return x - Math.floor(x);
};

/** glTF props: matte, no metal, (almost) no reflections — so no specular glints off chairs, sofas or pots */
const matte = (m: THREE.MeshStandardMaterial) => {
  m.roughness = Math.max(0.85, m.roughness);
  m.roughnessMap = null;
  m.metalness = 0;
  m.metalnessMap = null;
  m.envMapIntensity = 0.15;
  const phys = m as THREE.MeshPhysicalMaterial;
  if (phys.isMeshPhysicalMaterial) {
    phys.clearcoat = 0;
    phys.sheen = 0;
    phys.specularIntensity = 0.5;
  }
  m.needsUpdate = true;
};
/** bottles: satin glass (soft sheen, never a mirror highlight) */
const satinGlass = (m: THREE.MeshStandardMaterial) => {
  matte(m);
  m.roughness = 0.6;
};

/* ---------------- shared geometry ---------------- */

/** All balls of the room merged into one mesh (one draw call) with UVs into the numbered-ball atlas. */
function ballsGeometry(tables: Table[]) {
  const base = new THREE.SphereGeometry(R, 14, 10);
  const parts: THREE.BufferGeometry[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const m = new THREE.Matrix4();
  const ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  tables.forEach((t, ti) => {
    const y = t.h + R;
    const push = (num: number, lx: number, lz: number, seed: number) => {
      const g = base.clone();
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      const col = num % 4;
      const row = Math.floor(num / 4);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, (3 - row + uv.getY(i)) / 4);
      e.set(n(seed) * 6.28, n(seed + 1) * 6.28, n(seed + 2) * 6.28);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(t.x + lx, y, t.z + lz), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      parts.push(g);
    };
    if (ti % 3 !== 1) {
      // racked on the foot spot, cue ball behind the head string
      let k = 0;
      for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) push(ORDER[k++]!, 0.635 + row * R * 1.74, (i - row / 2) * R * 2.01, ti * 100 + k * 3);
      push(0, -0.635, 0, ti * 100 + 77);
    } else {
      // a game left in progress
      for (let b = 0; b < 16; b++) {
        if (b > 0 && n(ti * 31 + b) < 0.35) continue;
        push(b, (n(ti * 17 + b * 3) - 0.5) * 2.3, (n(ti * 23 + b * 5) - 0.5) * 1.1, ti * 100 + b * 7);
      }
    }
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  base.dispose();
  return merged;
}

/** Rounded-rectangle outline (floor status ring), lying flat, centred on the origin. */
function ringGeometry(w: number, d: number, r: number, line: number) {
  const rr = (s: THREE.Shape | THREE.Path, hw: number, hd: number, rad: number) => {
    s.moveTo(-hw + rad, -hd);
    s.lineTo(hw - rad, -hd);
    s.quadraticCurveTo(hw, -hd, hw, -hd + rad);
    s.lineTo(hw, hd - rad);
    s.quadraticCurveTo(hw, hd, hw - rad, hd);
    s.lineTo(-hw + rad, hd);
    s.quadraticCurveTo(-hw, hd, -hw, hd - rad);
    s.lineTo(-hw, -hd + rad);
    s.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
    return s;
  };
  const outer = rr(new THREE.Shape(), w / 2, d / 2, r) as THREE.Shape;
  outer.holes.push(rr(new THREE.Path(), w / 2 - line, d / 2 - line, r - line) as THREE.Path);
  return new THREE.ShapeGeometry(outer, 6).rotateX(-Math.PI / 2);
}

/* ---------------- 9-ft tables ---------------- */

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
  const oak = usePbr("oak_veneer_01", [2, 1]);
  const velour = usePbr("velour_velvet", [10, 5], { map: false });
  const felt = useMemo(() => feltTexture("#1a4e85"), []);
  const balls = useMemo(() => ballsGeometry(tables), [tables]);
  const atlas = useMemo(() => ballAtlas(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const disc = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 20), []);
  const cup = useMemo(() => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), []);
  const normalScale = useMemo(() => new THREE.Vector2(0.35, 0.35), []);

  const X = useMemo(() => {
    const per = (f: (t: Table) => Xform[]) => tables.flatMap(f);
    return {
      cabinet: per((t) => [{ p: [t.x, h - 0.17, t.z], s: [2.72, 0.26, 1.48] }]),
      // slab legs (one at each end) on a recessed plinth: a clean contemporary base
      legs: per((t) => [-1.0, 1.0].map((lx) => ({ p: [t.x + lx, (h - 0.29) / 2, t.z], s: [0.16, h - 0.29, 1.12] }) as Xform)),
      plinth: per((t) => [{ p: [t.x, 0.05, t.z], s: [2.2, 0.1, 0.9] }]),
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
      holes: per((t) => POCKETS.map(([px, pz]) => ({ p: [t.x + px, h + 0.001, t.z + pz], s: [0.062, 0.004, 0.062] }) as Xform)),
      cups: per((t) => POCKETS.map(([px, pz]) => ({ p: [t.x + px * 1.035, h - 0.04, t.z + pz * 1.09], s: [0.085, 0.11, 0.085] }) as Xform)),
      irons: per((t) => POCKETS.map(([px, pz]) => ({ p: [t.x + px * 1.035, h + 0.042, t.z + pz * 1.09], s: [0.085, 0.006, 0.085] }) as Xform)),
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
        <meshStandardMaterial color="#2c2b2b" roughness={0.88} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      <Instanced geometry={box} items={X.legs} castShadow={!lite}>
        <meshStandardMaterial color="#242323" roughness={0.88} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      <Instanced geometry={box} items={X.plinth}>
        <meshStandardMaterial color="#1c1b1b" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {/* oak rails, oiled-matte (the old lacquered walnut threw a white streak along every rail) */}
      <Instanced geometry={box} items={X.rails} castShadow={!lite}>
        <meshStandardMaterial map={oak.map} normalMap={oak.normalMap} color="#8a6a4c" roughness={0.82} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      {/* worsted cloth: fully diffuse; a faint self-glow keeps the bed evenly lit edge to edge (no centre hot-spot) */}
      <Instanced geometry={box} items={X.bed}>
        <meshStandardMaterial
          map={felt}
          normalMap={velour.normalMap}
          normalScale={normalScale}
          roughness={1}
          metalness={0}
          envMapIntensity={0.1}
          emissive="#ffffff"
          emissiveMap={felt}
          emissiveIntensity={0.12}
        />
      </Instanced>
      <Instanced geometry={box} items={X.cushions} castShadow={!lite}>
        <meshStandardMaterial map={felt} roughness={1} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={disc} items={X.holes} receiveShadow={false}>
        <meshBasicMaterial color="#050505" />
      </Instanced>
      <Instanced geometry={cup} items={X.cups}>
        <meshStandardMaterial color="#2a2420" roughness={0.9} metalness={0} envMapIntensity={0.1} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={disc} items={X.irons}>
        <meshStandardMaterial color="#1e1c1b" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.diamonds} receiveShadow={false}>
        <meshStandardMaterial color="#d9d3c6" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={disc} items={X.spots} receiveShadow={false}>
        <meshStandardMaterial color="#d8d6ce" roughness={0.9} />
      </Instanced>
      <Instanced geometry={box} items={X.chalk}>
        <meshStandardMaterial color="#2c78c8" roughness={0.95} />
      </Instanced>
      {/* satin phenolic balls: a soft broad sheen, no mirror highlight, no clearcoat */}
      <mesh geometry={balls} castShadow={!lite} receiveShadow>
        <meshStandardMaterial map={atlas} roughness={0.42} metalness={0} envMapIntensity={0.2} />
      </mesh>
    </group>
  );
}

/* ---------------- low-glare billiard lights + table status ---------------- */

/**
 * One linear light per table: a deep matte housing (2.36 × 0.56 m, 16 cm skirt) with the opal diffuser recessed
 * 6 cm inside, so from anywhere in the hall you see the skirt, never the luminous face. Hung on hair-thin cables from
 * the slat ceiling (no rods through the view). The table number sits on both long faces; a slim status band runs
 * under it, and a soft status ring lies on the carpet round the table.
 */
function TableLamps({ layout, status }: { layout: HallLayout; status: string[] }) {
  const tables = layout.tables;
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cable = useMemo(() => new THREE.CylinderGeometry(0.0012, 0.0012, 1, 4), []);
  const ring = useMemo(() => ringGeometry(2.9 + 1.0, 1.65 + 1.0, 0.35, 0.06), []);
  const X = useMemo(() => {
    const housing: Xform[] = [];
    const diffuser: Xform[] = [];
    const bands: Xform[] = [];
    const cables: Xform[] = [];
    const canopies: Xform[] = [];
    const rings: Xform[] = [];
    const L = 2.36;
    const D = 0.56;
    const H = 0.16;
    for (const t of tables) {
      housing.push(
        { p: [t.x, LAMP_Y + H / 2 - 0.015, t.z], s: [L, 0.03, D] }, // top plate
        { p: [t.x, LAMP_Y, t.z - D / 2 + 0.0125], s: [L, H, 0.025] }, // long skirts
        { p: [t.x, LAMP_Y, t.z + D / 2 - 0.0125], s: [L, H, 0.025] },
        { p: [t.x - L / 2 + 0.0125, LAMP_Y, t.z], s: [0.025, H, D] }, // short skirts
        { p: [t.x + L / 2 - 0.0125, LAMP_Y, t.z], s: [0.025, H, D] },
      );
      diffuser.push({ p: [t.x, LAMP_Y - H / 2 + 0.06, t.z], s: [L - 0.06, 0.01, D - 0.06] });
      bands.push({ p: [t.x, LAMP_Y - H / 2 + 0.016, t.z - D / 2 - 0.002], s: [L - 0.16, 0.022, 0.004] }, { p: [t.x, LAMP_Y - H / 2 + 0.016, t.z + D / 2 + 0.002], s: [L - 0.16, 0.022, 0.004] });
      for (const dx of [-0.95, 0.95])
        for (const dz of [-0.2, 0.2]) {
          const top = SLAT_Y - 0.05;
          const bot = LAMP_Y + H / 2;
          cables.push({ p: [t.x + dx, (top + bot) / 2, t.z + dz], s: [1, top - bot, 1] });
        }
      for (const dx of [-0.95, 0.95]) canopies.push({ p: [t.x + dx, SLAT_Y - 0.06, t.z], s: [0.09, 0.03, 0.52] });
      rings.push({ p: [t.x, 0.014, t.z] });
    }
    return { housing, diffuser, bands, cables, canopies, rings };
  }, [tables]);
  const bandColors = useMemo(() => status.flatMap((c) => [c, c]), [status]);
  return (
    <group>
      <Instanced geometry={box} items={X.housing} receiveShadow={false}>
        <meshStandardMaterial color="#3b3c40" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {/* opal diffuser: soft, warm-neutral, tone-mapped and below the bloom threshold (no halo, no hot-spot) */}
      <Instanced geometry={box} items={X.diffuser} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#fff1df" emissiveIntensity={0.78} roughness={1} />
      </Instanced>
      <Instanced geometry={box} items={X.bands} colors={bandColors} receiveShadow={false}>
        <meshBasicMaterial color="#ffffff" />
      </Instanced>
      <Instanced geometry={cable} items={X.cables} receiveShadow={false}>
        <meshStandardMaterial color="#77736d" roughness={0.9} metalness={0} />
      </Instanced>
      <Instanced geometry={box} items={X.canopies} receiveShadow={false}>
        <meshStandardMaterial color="#26272a" roughness={0.9} metalness={0} />
      </Instanced>
      <Instanced geometry={ring} items={X.rings} colors={status} receiveShadow={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.8} depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
      </Instanced>
      {/* table numbers on both long faces of the light (readable down the aisles) */}
      {tables.flatMap((t) =>
        [-1, 1].map((side) => (
          <Text
            key={`${t.id}${side}`}
            font={FONT}
            fontSize={0.105}
            position={[t.x, LAMP_Y + 0.012, t.z + side * (0.28 + 0.004)]}
            rotation={[0, side > 0 ? 0 : Math.PI, 0]}
            anchorX="center"
            anchorY="middle"
            color="#d8d2c8"
          >
            {`TABLE ${tableNo(t.id)}`}
          </Text>
        )),
      )}
    </group>
  );
}

/* ---------------- room ---------------- */

export function PoolHall({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const tables = layout.tables;
  const seatsMap = useWorld((s) => s.seats);
  const status = useMemo(() => {
    const st = tableStatuses(layout, seatsMap);
    return tables.map((t) => STATUS_COLOR[st[t.id] ?? "free"]);
  }, [layout, tables, seatsMap]);

  const plaster = usePbr("white_plaster_02", [w / 3, h / 3]);
  const floorTex = usePbr("white_plaster_02", [w / 5, d / 5]);
  const velour = usePbr("velour_velvet", [6, 2], { map: false });
  const rug = useMemo(() => loungeRug(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cue = useMemo(() => cueGeometry(), []);
  const smallN = useMemo(() => new THREE.Vector2(0.25, 0.25), []);

  const barLen = POOL_BAR.z1 - POOL_BAR.z0;
  const barZ = (POOL_BAR.z0 + POOL_BAR.z1) / 2;
  const BX = POOL_BAR.x;

  const X = useMemo(() => {
    // one instanced oak-slat mesh: slat ceiling, the acoustic slat wall either side of the entrance, the fluted bar front
    const slats: Xform[] = [];
    for (let x = -w / 2 + 0.2; x <= w / 2 - 0.2; x += 0.16) slats.push({ p: [x, SLAT_Y, 0], s: [0.045, 0.09, d - 0.6] });
    for (const sgn of [-1, 1]) for (let x = 2.6; x <= w / 2 - 1.2; x += 0.1) slats.push({ p: [sgn * x, 1.95, d / 2 - 0.045], s: [0.04, 3.2, 0.04] });
    for (let z = POOL_BAR.z0 + 0.1; z <= POOL_BAR.z1 - 0.1; z += 0.07) slats.push({ p: [BX + 0.37, 0.53, z], s: [0.035, 1.0, 0.035] });
    // felt backing behind the slat walls; fabric acoustic panels on the side walls
    const felt: Xform[] = [-1, 1].map((sgn) => ({ p: [sgn * ((2.5 + w / 2 - 1.1) / 2), 1.95, d / 2 - 0.012], s: [w / 2 - 1.1 - 2.5, 3.3, 0.02] }) as Xform);
    const panels: Xform[] = [];
    for (let z = -12; z <= 12.2; z += 2.6) panels.push({ p: [w / 2 - 0.03, 2.75, z], s: [0.05, 2.0, 2.4] });
    for (const z of [5.4, 8.0, 10.6]) panels.push({ p: [-w / 2 + 0.03, 2.75, z], s: [0.05, 2.0, 2.4] });
    // linear lights recessed in the slat ceiling over the circulation (clean lines, soft)
    const linears: Xform[] = [-11.2, -5, 1, 7.1, 10.9].map((z) => ({ p: [0, SLAT_Y - 0.055, z], s: [w - 5, 0.02, 0.07] }) as Xform);
    // spectator banquettes (upholstered seat + back) along the window wall and the side walls
    const benchSeat: Xform[] = [];
    const benchBack: Xform[] = [];
    const bench = (x: number, z: number, len: number, along: "x" | "z", back: number) => {
      if (along === "x") {
        benchSeat.push({ p: [x, 0.21, z], s: [len, 0.42, 0.62] });
        benchBack.push({ p: [x, 0.66, z + back * 0.26], s: [len, 0.5, 0.14] });
      } else {
        benchSeat.push({ p: [x, 0.21, z], s: [0.62, 0.42, len] });
        benchBack.push({ p: [x + back * 0.26, 0.66, z], s: [0.14, 0.5, len] });
      }
    };
    bench(-7.5, -13.35, 9, "x", -1);
    bench(7.5, -13.35, 9, "x", -1);
    bench(17.6, -9.5, 5, "z", 1);
    bench(17.6, 6, 6, "z", 1);
    bench(-17.6, 8.5, 6, "z", -1);
    // cue racks
    const racks = [
      { x: -w / 2 + 0.05, z: -11.6, s: 1 },
      { x: w / 2 - 0.05, z: -5.8, s: -1 },
      { x: w / 2 - 0.05, z: 1.6, s: -1 },
    ];
    const rackBoards: Xform[] = racks.flatMap((r) => [
      { p: [r.x + r.s * 0.03, 1.55, r.z], s: [0.04, 1.6, 1.0] },
      { p: [r.x + r.s * 0.1, 0.12, r.z], s: [0.14, 0.05, 1.0] },
      { p: [r.x + r.s * 0.09, 1.5, r.z], s: [0.12, 0.04, 1.0] },
    ]);
    const cues: Xform[] = racks.flatMap((r, ri) =>
      Array.from({ length: 8 }, (_, k) => ({ p: [r.x + r.s * 0.1, 0.14, r.z - 0.42 + k * 0.12] as [number, number, number], rz: -r.s * 0.035, r: n(ri * 9 + k) * 6 })),
    );
    // bar: counter, stone top, back bar, shelves, bottles, stools, pendants
    const barBody: Xform[] = [{ p: [BX, 0.53, barZ], s: [0.7, 1.06, barLen] }];
    const barTop: Xform[] = [
      { p: [BX + 0.08, 1.085, barZ], s: [0.95, 0.05, barLen + 0.1] },
      { p: [-w / 2 + 0.45, 0.93, barZ], s: [0.9, 0.04, barLen - 0.6] },
    ];
    const backCab: Xform[] = [{ p: [-w / 2 + 0.45, 0.455, barZ], s: [0.85, 0.91, barLen - 0.6] }];
    const shelves: Xform[] = [1.5, 1.9, 2.3].map((y) => ({ p: [-w / 2 + 0.17, y, barZ], s: [0.3, 0.03, barLen - 2] }));
    const bottles: Record<string, Xform[]> = { bordeaux: [], alsace: [], burgundy: [], champagne: [] };
    const kinds = Object.keys(bottles);
    [1.515, 1.915, 2.315].forEach((y, si) => {
      for (let k = 0; k < 20; k++) {
        const z = barZ - (barLen - 2.4) / 2 + k * ((barLen - 2.4) / 19) + (n(k * 3 + si) - 0.5) * 0.12;
        const kind = kinds[(k + si * 3 + Math.floor(n(k * 7 + si) * 3)) % 4]!;
        bottles[kind]!.push({ p: [-w / 2 + 0.17, y, z], r: n(k + si * 30) * 6.28 });
      }
    });
    const stools: Xform[] = [];
    for (let z = POOL_BAR.z0 + 0.6; z <= POOL_BAR.z1 - 0.5; z += 0.92) stools.push({ p: [BX + 1.0, 0, z] });
    const pendantZ = [-7.2, -4.4, -1.6, 1.2];
    return { slats, felt, panels, linears, benchSeat, benchBack, rackBoards, cues, barBody, barTop, backCab, shelves, bottles, stools, pendantZ };
  }, [w, d, BX, barLen, barZ]);

  const rugs = useMemo(() => tables.map((t) => ({ p: [t.x, 0.007, t.z] as [number, number, number], s: [5.6, 1, 5.4] as [number, number, number] })), [tables]);
  const rugGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const shadowBlobs: Blob[] = useMemo(
    () => [
      ...tables.map((t) => ({ x: t.x, z: t.z, w: 3.5, d: 2.2, o: 1 })),
      ...layout.seats.map((s) => ({ x: s.x, z: s.z, w: 1.1, d: 1.1 })),
      { x: 16.9, z: -2.2, w: 1.4, d: 2.8 },
      { x: BX, z: barZ, w: 1.3, d: barLen + 0.6 },
    ],
    [tables, layout.seats, BX, barZ, barLen],
  );

  return (
    <group>
      {/* -------- lighting: one soft overhead key (even on every bed), sky fill, diffuse window light -------- */}
      <Environment resolution={32} frames={1} environmentIntensity={0.5}>
        <Lightformer intensity={1.1} position={[0, 4.6, 0]} rotation-x={Math.PI / 2} scale={[30, 22, 1]} color="#fff3e4" />
        <Lightformer intensity={1.4} position={[0, 2.4, -13.5]} scale={[34, 3.8, 1]} color="#e3ecf4" />
        <Lightformer intensity={0.5} position={[0, 1.2, 0]} rotation-x={-Math.PI / 2} scale={[30, 22, 1]} color="#8a8379" />
      </Environment>
      <hemisphereLight args={["#fff6ea", "#6d665d", lite ? 1.25 : 1.0]} />
      {/* overhead key: nearly vertical, so it falls evenly on every table like a field of billiard lights; its
          shadows are the tables' and people's own soft contact shadows (Standard only) */}
      <directionalLight
        position={[1.2, 20, 2.0]}
        intensity={lite ? 1.35 : 1.45}
        color="#fff0dc"
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-19}
        shadow-camera-right={19}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={8}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={4}
      />
      {/* north daylight, diffused by the blinds: a gentle cool wash from the window side (no sun streaks) */}
      <directionalLight position={[0, 7, -30]} intensity={0.45} color="#e6eef6" />

      {/* -------- shell -------- */}
      {/* micro-cement floor, dead matte (the texture's own roughness map is ignored) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial normalMap={floorTex.normalMap} normalScale={smallN} color="#a29d95" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      {/* low-pile carpet under each table (and its chairs): quiet, warm underfoot, absorbs the light */}
      <Instanced geometry={rugGeo} items={rugs}>
        <meshStandardMaterial map={rug} roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      {/* black open soffit above the oak slat ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#1b1c1e" roughness={1} metalness={0} envMapIntensity={0} />
      </mesh>
      <Instanced geometry={box} items={X.slats} receiveShadow={false}>
        <meshStandardMaterial color="#9c7650" roughness={0.88} metalness={0} envMapIntensity={0.12} />
      </Instanced>
      <Instanced geometry={box} items={X.linears} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#fff4e6" emissiveIntensity={0.7} roughness={1} />
      </Instanced>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2), h / 2, 0]} rotation={[0, -s * (Math.PI / 2), 0]} receiveShadow>
          <planeGeometry args={[d, h]} />
          <meshStandardMaterial map={plaster.map} normalMap={plaster.normalMap} normalScale={smallN} color="#cdc6bb" roughness={0.95} metalness={0} envMapIntensity={0.1} />
        </mesh>
      ))}
      {/* skirting: a slim dark shadow-gap base on the long walls */}
      <Instanced
        geometry={box}
        items={[
          { p: [-w / 2 + 0.01, 0.05, 0], s: [0.02, 0.1, d] },
          { p: [w / 2 - 0.01, 0.05, 0], s: [0.02, 0.1, d] },
        ]}
      >
        <meshStandardMaterial color="#2a2a2b" roughness={0.9} />
      </Instanced>
      <WindowWall w={w} d={d} h={h} sill={0.45} head={4.55} transom={3.15} bays={9} glassTint="#9fb2bd" glassOpacity={0.05} frameColor="#232427" matte>
        <meshStandardMaterial map={plaster.map} normalMap={plaster.normalMap} normalScale={smallN} color="#cdc6bb" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </WindowWall>
      {/* sheer roller blinds lowered to the transom: the upper daylight comes in diffused, the view stays clear below */}
      <mesh position={[0, (3.18 + 4.52) / 2, -d / 2 + 0.07]} renderOrder={3}>
        <planeGeometry args={[w - 0.2, 4.52 - 3.18]} />
        <meshStandardMaterial color="#e6e2da" emissive="#fbf7ef" emissiveIntensity={0.32} roughness={1} metalness={0} transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <SouthWall layout={layout}>
        <meshStandardMaterial map={plaster.map} normalMap={plaster.normalMap} normalScale={smallN} color="#c4bdb2" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </SouthWall>
      <Instanced geometry={box} items={X.felt} receiveShadow={false}>
        <meshStandardMaterial color="#2a2c30" roughness={1} />
      </Instanced>
      <Instanced geometry={box} items={X.panels}>
        <meshStandardMaterial normalMap={velour.normalMap} color="#4a5563" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>

      {/* -------- tables, lights, player chairs -------- */}
      <PoolTables tables={tables} lite={lite} />
      <TableLamps layout={layout} status={status} />
      {/* the soft light pool each light lays on the carpet round its table (baked, additive, very low) */}
      <LightPools items={tables.map((t) => ({ x: t.x, z: t.z, w: 5.0, d: 3.8 }))} color="#ffe9cf" opacity={lite ? 0.12 : 0.08} y={0.012} />
      <GltfInstances url={model("mid_century_lounge_chair")} items={layout.seats.map((s) => ({ p: [s.x, 0, s.z], r: s.yaw, s: 0.95 }))} castShadow={!lite} matOverride={matte} />

      {/* -------- bar (west wall) -------- */}
      <Instanced geometry={box} items={X.barBody} castShadow={!lite}>
        <meshStandardMaterial color="#5b4634" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.barTop}>
        <meshStandardMaterial color="#d6d0c6" roughness={0.88} metalness={0} envMapIntensity={0.12} />
      </Instanced>
      <Instanced geometry={box} items={X.backCab}>
        <meshStandardMaterial color="#3c3029" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {/* oak back panel behind the shelving */}
      <mesh position={[-w / 2 + 0.015, 2.15, barZ]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[barLen - 0.6, 2.3]} />
        <meshStandardMaterial color="#8c6a4a" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <Instanced geometry={box} items={X.shelves}>
        <meshStandardMaterial color="#6e5440" roughness={0.88} metalness={0} />
      </Instanced>
      {!lite && Object.entries(X.bottles).map(([k, items]) => <GltfInstances key={k} url={model("wine_bottles_01")} pick={k} items={items} matOverride={satinGlass} />)}
      <BarStools items={X.stools} lite={lite} />
      <BarPendants x={BX + 0.05} zs={X.pendantZ} />
      {/* matte lettering, lit by the room (no neon) */}
      <Text font={FONT} fontSize={0.4} position={[-w / 2 + 0.03, 3.6, barZ]} rotation={[0, Math.PI / 2, 0]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
        THE BREAK BAR
        <meshStandardMaterial color="#e2dccf" roughness={0.9} metalness={0} />
      </Text>

      {/* -------- lounge (east wall) -------- */}
      <mesh position={[15.3, 0.008, -2.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4.4, 5.4]} />
        <meshStandardMaterial map={rug} color="#b8b0a4" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <GltfInstances url={model("sofa_02")} items={[{ p: [16.95, 0, -2.2], r: -Math.PI / 2, s: 1.15 }]} castShadow={!lite} matOverride={matte} />
      <GltfInstances
        url={model("mid_century_lounge_chair")}
        items={[
          { p: [13.9, 0, -4.1], r: Math.atan2(1.3, 1.9), s: 0.95 },
          { p: [13.9, 0, -0.3], r: Math.atan2(1.3, -1.9), s: 0.95 },
        ]}
        castShadow={!lite}
        matOverride={matte}
      />
      <mesh position={[15.2, 0.4, -2.2]} castShadow={!lite}>
        <boxGeometry args={[0.7, 0.05, 1.15]} />
        <meshStandardMaterial color="#7a5c40" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <mesh position={[15.2, 0.19, -2.2]}>
        <boxGeometry args={[0.55, 0.38, 1.0]} />
        <meshStandardMaterial color="#2a2a2b" roughness={0.9} metalness={0} />
      </mesh>

      {/* -------- spectator banquettes -------- */}
      <Instanced geometry={box} items={X.benchSeat}>
        <meshStandardMaterial normalMap={velour.normalMap} color="#47525f" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      <Instanced geometry={box} items={X.benchBack}>
        <meshStandardMaterial normalMap={velour.normalMap} color="#3e4854" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>

      {/* -------- cue racks -------- */}
      <Instanced geometry={box} items={X.rackBoards}>
        <meshStandardMaterial color="#7a5c40" roughness={0.88} metalness={0} />
      </Instanced>
      {!lite && (
        <Instanced geometry={cue} items={X.cues} castShadow={false}>
          <meshStandardMaterial color="#cfae7a" roughness={0.85} metalness={0} envMapIntensity={0.1} />
        </Instanced>
      )}

      {/* -------- plants, contact shadows -------- */}
      <GltfInstances
        url={model("potted_plant_02")}
        items={layout.colliders.filter((c) => c.w === 0.9 && c.d === 0.9).map((c, i) => ({ p: [c.x, 0, c.z], s: 1.5, r: i * 1.7 }) as Xform)}
        matOverride={matte}
      />
      <BlobShadows items={shadowBlobs} opacity={0.5} y={0.011} />
    </group>
  );
}

function cueGeometry() {
  // 1.47 m cue, standing on its butt: rubber bumper, butt, wrap, maple shaft, ferrule, tip
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

/** Upholstered bar stools on a powder-coated (matte black) frame (procedural, instanced). */
function BarStools({ items, lite }: { items: Xform[]; lite: boolean }) {
  const seat = useMemo(() => new THREE.CylinderGeometry(0.2, 0.18, 0.09, 24).translate(0, 0.76, 0), []);
  const stem = useMemo(() => new THREE.CylinderGeometry(0.028, 0.028, 0.72, 10).translate(0, 0.38, 0), []);
  const base = useMemo(() => new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24).translate(0, 0.015, 0), []);
  const ring = useMemo(() => new THREE.TorusGeometry(0.17, 0.01, 6, 24).rotateX(Math.PI / 2).translate(0, 0.3, 0), []);
  return (
    <>
      <Instanced geometry={seat} items={items} castShadow={!lite}>
        <meshStandardMaterial color="#5a4a3e" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {[stem, base, ring].map((g, i) => (
        <Instanced key={i} geometry={g} items={items}>
          <meshStandardMaterial color="#232324" roughness={0.85} metalness={0} envMapIntensity={0.1} />
        </Instanced>
      ))}
    </>
  );
}

/** Matte cylinder pendants over the bar with a recessed opal disc (no bare bulb), on thin cables. */
function BarPendants({ x, zs }: { x: number; zs: number[] }) {
  const Y = 2.7;
  const shade = useMemo(() => new THREE.CylinderGeometry(0.17, 0.17, 0.3, 24, 1, true), []);
  const top = useMemo(() => new THREE.CircleGeometry(0.17, 24).rotateX(-Math.PI / 2), []);
  const opal = useMemo(() => new THREE.CircleGeometry(0.15, 24).rotateX(Math.PI / 2), []);
  const cable = useMemo(() => new THREE.CylinderGeometry(0.0012, 0.0012, 1, 4), []);
  const at = (dy: number, s?: Xform["s"]) => zs.map((z) => ({ p: [x, Y + dy, z], s }) as Xform);
  return (
    <>
      <Instanced geometry={shade} items={at(0)} receiveShadow={false}>
        <meshStandardMaterial color="#26272a" roughness={0.9} metalness={0} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={top} items={at(0.15)} receiveShadow={false}>
        <meshStandardMaterial color="#26272a" roughness={0.9} metalness={0} />
      </Instanced>
      <Instanced geometry={opal} items={at(-0.08)} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#ffe9cf" emissiveIntensity={0.7} roughness={1} />
      </Instanced>
      <Instanced geometry={cable} items={at((SLAT_Y - 0.05 - Y - 0.15) / 2 + 0.15, [1, SLAT_Y - 0.05 - Y - 0.15, 1])} receiveShadow={false}>
        <meshStandardMaterial color="#3a3a3c" roughness={0.9} />
      </Instanced>
    </>
  );
}

