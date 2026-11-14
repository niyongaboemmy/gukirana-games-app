"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useWorld } from "@/lib/world-store";
import { tokenCell } from "@/games/ludo-board";
import { LUDO_BAR, LUDO_PLANTERS, LUDO_POUF, type HallLayout, type Table } from "./layouts";
import { BlobShadows, GltfInstances, Instanced, LightPools, model, usePbr, type Blob, type Xform } from "./interior-kit";
import { diceAtlas } from "./room-textures";
import { calmKitenge, KITENGE_ART, KITENGE_RUG, LUDO_TABLE_COLORS, ludoMenu, ludoTableBoard, tableNumbers } from "./ludo-textures";
import { SouthWall, WindowWall } from "./shell";
import { STATUS_COLOR, tableStatuses, type TableStatus } from "./table-status";

/**
 * Ludo Lounge — a big, bright, calm Kigali café lounge (34 × 26 m, 4.6 m ceiling): sixteen oak café tables in four
 * rows, each with a Ludo board, tokens and a die, two player armchairs facing across the board and two watchers'
 * poufs; a long coffee bar on the west wall, two sofa lounges on the east wall (the giant fair-roll die floats over
 * the first), a window banquette along the full-width north glazing and a board-game library by the bar.
 *
 * Calm, premium palette: desaturated natural-oak herringbone, warm plaster, a soft clay accent wall, Kitenge used as
 * accents only (rugs, cushions, textile art) in sand / clay / teal / indigo / ochre.
 *
 * Eye comfort (no glare): every surface is matte (roughness ≥ 0.8, metalness 0, envMapIntensity ≤ 0.2, no clearcoat);
 * boards, tokens and dice are satin at most. No point lights and no sun: one soft, near-vertical overhead key (even on
 * every board) plus sky fill and the diffuse north window; opal globe pendants, recessed linear lights shielded by the
 * acoustic baffles and the bar globes all stay below the bloom threshold (tone-mapped, < 1). Glazing is unlit
 * low-reflection glass with sheer blinds in the upper bays. Boards carry a faint self-glow so they read evenly.
 *
 * Choosing a table: each table has a number block on it, a status band on its globe and a soft status ring on the
 * floor (free / waiting / playing, live from the server-claimed chairs, rooms/table-status.ts); a table in a match
 * shows its game in progress on the board.
 */
const FONT = "/fonts/Baloo2.ttf";
const PENDANT_Y = 2.0; // globe centre: its bottom hangs ≈ 1.06 m above the table top
const GLOBE_R = 0.2;
const BAFFLE_Y = 4.34; // bottom of the acoustic baffles: above the highest follow-camera point (h - 0.3), so the camera never sits among them
const BOARD = 0.72; // board size (m), 15 × 15 cells inside a 2 cm walnut frame
const FRAME = 28 / 1024; // board frame fraction (ludo-textures)
const n = (i: number) => {
  const x = Math.sin(i * 51.77 + 3.3) * 43758.5453;
  return x - Math.floor(x);
};

/** glTF props: matte, no metal, (almost) no reflections — no specular glints off chairs, poufs or pots */
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
  ].map(([x, y]) => new THREE.Vector2(x! * 1.15, y! * 1.15));
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

/** The oak number blocks of every table merged into one mesh (one draw call): the number on all four sides. */
function numberBlocksGeometry(tables: Table[]) {
  const S = 0.085;
  const parts: THREE.BufferGeometry[] = [];
  tables.forEach((t, i) => {
    const cx = (i % 4) / 4;
    const cy = 1 - (Math.floor(i / 4) + 1) / 4;
    for (let k = 0; k < 4; k++) {
      const q = new THREE.PlaneGeometry(S * 0.86, S * 0.86);
      const uv = q.getAttribute("uv") as THREE.BufferAttribute;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, cx + (0.08 + uv.getX(v) * 0.84) / 4, cy + (0.08 + uv.getY(v) * 0.84) / 4);
      const a = (k * Math.PI) / 2;
      q.translate(0, 0, S / 2 + 0.0015);
      q.rotateY(a);
      q.translate(t.x + t.w / 2 - 0.1, t.h + S / 2, t.z);
      parts.push(q);
    }
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Floor: the herringbone photo set, desaturated and lifted in the shader → calm natural oak (no orange cast). */
function useCalmOak(map: THREE.Texture | undefined, normalMap: THREE.Texture) {
  return useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, metalness: 0, envMapIntensity: 0.1 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n\tdiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, 0.45) * vec3(1.42, 1.36, 1.22);",
      );
    };
    m.customProgramCacheKey = () => "ludo-calm-oak";
    return m;
  }, [map, normalMap]);
}

/** armchair: oatmeal boucle cushions (the stock black leather read as heavy holes in a bright cafe), matte walnut frame */
const chairMat = (m: THREE.MeshStandardMaterial) => {
  matte(m);
  if (m.name.includes("pillow")) {
    m.map = null;
    m.color.set("#b7a690");
  }
};
/** watchers' pouf: warm sand wool */
const poufMat = (m: THREE.MeshStandardMaterial) => {
  matte(m);
  m.map = null;
  m.color.set("#a99a86");
};

/* ---------------- tables: oak tops, boards, tokens, dice, number blocks ---------------- */

export function LudoTables({ tables, status, lite }: { tables: Table[]; status: TableStatus[]; lite: boolean }) {
  const oak = usePbr("oak_veneer_01", [1, 1]);
  const board = useMemo(() => ludoTableBoard(), []);
  const dice = useMemo(() => diceAtlas(), []);
  const numbers = useMemo(() => tableNumbers(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 24), []);
  const top = useMemo(() => new RoundedBoxGeometry(1.1, 0.036, 1.1, 2, 0.012), []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const pawn = useMemo(() => pawnGeometry(), []);
  const die = useMemo(() => diceGeometry(0.02), []);
  const blocks = useMemo(() => numberBlocksGeometry(tables), [tables]);
  const h = tables[0]!.h;

  const X = useMemo(() => {
    const tops: Xform[] = [];
    const stems: Xform[] = [];
    const feet: Xform[] = [];
    const trays: Xform[] = [];
    const boards: Xform[] = [];
    const dices: Xform[] = [];
    const cubes: Xform[] = [];
    tables.forEach((t, ti) => {
      tops.push({ p: [t.x, h - 0.018, t.z] });
      stems.push({ p: [t.x, (h - 0.036) / 2, t.z], s: [0.05, h - 0.036, 0.05] });
      feet.push({ p: [t.x, 0.012, t.z], s: [0.3, 0.024, 0.3] });
      const rot = Math.PI / 2 + 0.03 * (n(ti) - 0.5);
      trays.push({ p: [t.x, h + 0.006, t.z], r: rot, s: [BOARD + 0.01, 0.012, BOARD + 0.01] });
      boards.push({ p: [t.x, h + 0.0125, t.z], r: rot, s: [BOARD, 1, BOARD] });
      dices.push({ p: [t.x - t.w / 2 + 0.1, h + 0.01, t.z + 0.12 * (n(ti * 7) - 0.5)], r: n(ti * 5) * 6 });
      cubes.push({ p: [t.x + t.w / 2 - 0.1, h + 0.0425, t.z], s: 0.085 });
    });
    return { tops, stems, feet, trays, boards, dices, cubes };
  }, [tables, h]);

  // tokens: a fresh set at free / waiting tables; red and yellow (the 1-v-1 seats) out on the track at tables in a
  // match, plus a few tables where a casual game was left mid-way
  const tokens = useMemo(() => {
    const items: Xform[] = [];
    const cols: string[] = [];
    const cell = BOARD * (1 - 2 * FRAME) / 15;
    tables.forEach((t, ti) => {
      const rot = Math.PI / 2 + 0.03 * (n(ti) - 0.5);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const live = status[ti] === "playing" || ti % 5 === 2;
      const used = new Map<string, number>();
      for (let seat = 0; seat < 4; seat++)
        for (let k = 0; k < 4; k++) {
          let prog = -1;
          if (live && (seat === 0 || seat === 2) && n(ti * 40 + seat * 4 + k + 1) < 0.6) prog = Math.floor(n(ti * 13 + seat * 7 + k) * 54);
          const [row, col] = tokenCell(seat, prog, k);
          const key = `${row},${col}`;
          const stack = used.get(key) ?? 0;
          used.set(key, stack + 1);
          const lx = -BOARD / 2 + BOARD * FRAME + (col + 0.5) * cell + stack * 0.008;
          const lz = -BOARD / 2 + BOARD * FRAME + (row + 0.5) * cell + stack * 0.008;
          items.push({ p: [t.x + lx * c + lz * s, h + 0.013, t.z - lx * s + lz * c] });
          cols.push(LUDO_TABLE_COLORS[seat]!);
        }
    });
    return { items, cols };
  }, [tables, status, h]);

  return (
    <group>
      {/* oiled light oak tops (matte), slim black pedestals */}
      <Instanced geometry={top} items={X.tops} castShadow={!lite}>
        <meshStandardMaterial map={oak.map} normalMap={oak.normalMap} color="#e2cfb4" roughness={0.85} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      <Instanced geometry={cyl} items={X.stems} castShadow={!lite}>
        <meshStandardMaterial color="#2a2928" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={cyl} items={X.feet}>
        <meshStandardMaterial color="#2a2928" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.trays}>
        <meshStandardMaterial color="#5a4232" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {/* printed board, satin-matte; a faint self-glow keeps it evenly lit edge to edge (no hot-spot) */}
      <Instanced geometry={plane} items={X.boards} receiveShadow>
        <meshStandardMaterial map={board} roughness={0.8} metalness={0} envMapIntensity={0.1} emissive="#ffffff" emissiveMap={board} emissiveIntensity={0.1} />
      </Instanced>
      {/* satin tokens and dice: a soft broad sheen, never a mirror highlight */}
      <Instanced geometry={pawn} items={tokens.items} colors={tokens.cols} castShadow={!lite}>
        <meshStandardMaterial roughness={0.6} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      <Instanced geometry={die} items={X.dices} castShadow={!lite}>
        <meshStandardMaterial map={dice} roughness={0.6} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      {/* oak number block on every table (numbers on its sides: one merged mesh) */}
      <Instanced geometry={box} items={X.cubes}>
        <meshStandardMaterial color="#4a3627" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <mesh geometry={blocks}>
        <meshStandardMaterial map={numbers} roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </mesh>
    </group>
  );
}

/* ---------------- opal globe pendants + table status ---------------- */

/**
 * One opal globe per table on a thin cord from the acoustic ceiling: a soft, even, warm-neutral glow (tone-mapped,
 * below the bloom threshold — no bare bulb, no halo) under a matte ceramic cap. A slim status band rings the cap,
 * and a soft status ring lies on the floor round the table (free / waiting / playing).
 */
function Pendants({ tables, status, ceiling }: { tables: Table[]; status: string[]; ceiling: number }) {
  const globe = useMemo(() => new THREE.SphereGeometry(GLOBE_R, 28, 18), []);
  const cap = useMemo(() => new THREE.CylinderGeometry(0.06, 0.1, 0.08, 24), []);
  const band = useMemo(() => new THREE.CylinderGeometry(0.101, 0.101, 0.022, 28, 1, true), []);
  const cord = useMemo(() => new THREE.CylinderGeometry(0.003, 0.003, 1, 4), []);
  const ring = useMemo(() => ringGeometry(3.95, 3.25, 0.5, 0.06), []);
  const X = useMemo(() => {
    const capTop = PENDANT_Y + GLOBE_R + 0.06;
    return {
      globes: tables.map((t) => ({ p: [t.x, PENDANT_Y, t.z] }) as Xform),
      caps: tables.map((t) => ({ p: [t.x, PENDANT_Y + GLOBE_R + 0.02, t.z] }) as Xform),
      bands: tables.map((t) => ({ p: [t.x, PENDANT_Y + GLOBE_R - 0.01, t.z] }) as Xform),
      cords: tables.map((t) => ({ p: [t.x, (capTop + ceiling) / 2, t.z], s: [1, ceiling - capTop, 1] }) as Xform),
      rings: tables.map((t) => ({ p: [t.x, 0.012, t.z] }) as Xform),
    };
  }, [tables, ceiling]);
  return (
    <group>
      <Instanced geometry={globe} items={X.globes} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#fff0dc" emissiveIntensity={0.74} roughness={1} />
      </Instanced>
      <Instanced geometry={cap} items={X.caps} receiveShadow={false}>
        <meshStandardMaterial color="#e6e0d6" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={band} items={X.bands} colors={status} receiveShadow={false}>
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={cord} items={X.cords} receiveShadow={false}>
        <meshStandardMaterial color="#5d5953" roughness={0.9} metalness={0} />
      </Instanced>
      <Instanced geometry={ring} items={X.rings} colors={status} receiveShadow={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.75} depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
      </Instanced>
    </group>
  );
}

/* ---------------- sofas (procedural, instanced: one draw call per part for every sofa) ---------------- */

interface SofaDef {
  x: number;
  z: number;
  yaw: number;
  color: string;
}
function Sofas({ sofas, velour, lite }: { sofas: SofaDef[]; velour: THREE.Texture; lite: boolean }) {
  const parts = useMemo(
    () => ({
      base: { g: new RoundedBoxGeometry(2.1, 0.26, 0.9, 2, 0.05), at: [[0, 0.23, 0]] },
      seat: { g: new RoundedBoxGeometry(0.92, 0.14, 0.7, 2, 0.06), at: [[-0.47, 0.42, 0.06], [0.47, 0.42, 0.06]] },
      back: { g: new RoundedBoxGeometry(2.1, 0.5, 0.22, 2, 0.08), at: [[0, 0.6, -0.34]] },
      arm: { g: new RoundedBoxGeometry(0.18, 0.56, 0.9, 2, 0.07), at: [[-1.0, 0.4, 0], [1.0, 0.4, 0]] },
    }),
    [],
  );
  const plinth = useMemo(() => new THREE.BoxGeometry(2.0, 0.08, 0.85), []);
  const place = (lx: number, ly: number, lz: number, s: SofaDef): Xform => ({
    p: [s.x + lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw), ly, s.z - lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw)],
    r: s.yaw,
  });
  const normalScale = useMemo(() => new THREE.Vector2(0.4, 0.4), []);
  return (
    <group>
      {Object.entries(parts).map(([k, part]) => {
        const items = sofas.flatMap((s) => part.at.map(([x, y, z]) => place(x!, y!, z!, s)));
        const colors = sofas.flatMap((s) => part.at.map(() => s.color));
        return (
          <Instanced key={k} geometry={part.g} items={items} colors={colors} castShadow={!lite}>
            <meshStandardMaterial normalMap={velour} normalScale={normalScale} roughness={1} metalness={0} envMapIntensity={0.05} />
          </Instanced>
        );
      })}
      <Instanced geometry={plinth} items={sofas.map((s) => place(0, 0.06, 0, s))}>
        <meshStandardMaterial color="#2f2a25" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
    </group>
  );
}

/** Signature element (DESIGN-SPEC §6.3): the giant fair-roll die floating over the lounge, turning slowly (matte). */
function GiantDie({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Group>(null);
  const dice = useMemo(() => diceAtlas(), []);
  const geo = useMemo(() => new RoundedBoxGeometry(0.8, 0.8, 0.8, 3, 0.08), []);
  const uvGeo = useMemo(() => {
    // map each face of the rounded cube onto its atlas cell (same face order as diceGeometry)
    const g = geo.clone();
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const faces = [2, 3, 0, 5, 1, 4];
    for (let i = 0; i < pos.count; i++) {
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const az = Math.abs(nz);
      let f: number;
      let u: number;
      let v: number;
      const px = pos.getX(i) / 0.8 + 0.5;
      const py = pos.getY(i) / 0.8 + 0.5;
      const pz = pos.getZ(i) / 0.8 + 0.5;
      if (ax >= ay && ax >= az) [f, u, v] = nx > 0 ? [0, 1 - pz, py] : [1, pz, py];
      else if (ay >= az) [f, u, v] = ny > 0 ? [2, px, 1 - pz] : [3, px, pz];
      else [f, u, v] = nz > 0 ? [4, px, py] : [5, 1 - px, py];
      const cell = faces[f]!;
      uv.setXY(i, ((cell % 3) + THREE.MathUtils.clamp(u, 0, 1)) / 3, (1 - Math.floor(cell / 3)) * 0.5 + THREE.MathUtils.clamp(v, 0, 1) * 0.5);
    }
    return g;
  }, [geo]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.set(0.6 + Math.sin(t * 0.15) * 0.15, t * 0.16, 0.5);
    g.position.y = Math.sin(t * 0.5) * 0.05;
  });
  return (
    <group position={[x, 3.05, z]}>
      <group ref={ref}>
        <mesh geometry={uvGeo}>
          <meshStandardMaterial map={dice} roughness={0.85} metalness={0} envMapIntensity={0.1} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------- room ---------------- */

export function LudoLounge({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const tables = layout.tables;
  const seatsMap = useWorld((s) => s.seats);
  const st = useMemo(() => {
    const m = tableStatuses(layout, seatsMap);
    return tables.map((t) => m[t.id] ?? "free");
  }, [layout, tables, seatsMap]);
  const status = useMemo(() => st.map((s) => STATUS_COLOR[s]), [st]);

  const floor = usePbr("herringbone_parquet", [w / 3.4, d / 3.4]);
  const floorMat = useCalmOak(floor.map, floor.normalMap);
  const plaster = usePbr("white_plaster_02", [d / 3, h / 3], { map: false });
  const oak = usePbr("oak_veneer_01", [2, 1]);
  const velour = usePbr("velour_velvet", [3, 2], { map: false });
  const rug = useMemo(() => calmKitenge(KITENGE_RUG), []);
  const art = useMemo(() => calmKitenge(KITENGE_ART, [1, 1]), []);
  const artWall = useMemo(() => calmKitenge(KITENGE_RUG, [1, 1]), []);
  const menu = useMemo(() => ludoMenu(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 20), []);
  const ball = useMemo(() => new THREE.SphereGeometry(1, 16, 10), []);
  const cushion = useMemo(() => new RoundedBoxGeometry(0.44, 0.4, 0.13, 2, 0.05), []);
  const smallN = useMemo(() => new THREE.Vector2(0.25, 0.25), []);

  const BX = LUDO_BAR.x;
  const barLen = LUDO_BAR.z1 - LUDO_BAR.z0;
  const barZ = (LUDO_BAR.z0 + LUDO_BAR.z1) / 2;

  const sofas: SofaDef[] = useMemo(
    () => [
      { x: 16.3, z: -3.6, yaw: -Math.PI / 2, color: "#3f5d5a" }, // lounge A, against the east wall
      { x: 14.6, z: 3.9, yaw: 0, color: "#a8875a" }, // lounge B, facing each other
      { x: 14.6, z: 8.1, yaw: Math.PI, color: "#4a5363" },
    ],
    [],
  );

  const X = useMemo(() => {
    // acoustic ceiling: felt baffles north–south (every 4th one oak), recessed linear lights over the aisles
    const baffles: Xform[] = [];
    const baffleCols: string[] = [];
    let k = 0;
    for (let x = -w / 2 + 0.6; x <= w / 2 - 0.6; x += 0.8, k++) {
      baffles.push({ p: [x, BAFFLE_Y + 0.12, -0.3], s: [0.05, 0.24, d - 1.8] });
      baffleCols.push(k % 4 === 0 ? "#c4a582" : "#ebe5db");
    }
    const linears: Xform[] = layout.aisles.map((x) => ({ p: [x, h - 0.02, -0.3], s: [0.09, 0.02, d - 3] }));
    // oak slat acoustic wall either side of the entrance, felt behind
    const slats: Xform[] = [];
    for (const sgn of [-1, 1]) for (let x = 2.4; x <= 9.0; x += 0.1) slats.push({ p: [sgn * x, 1.9, d / 2 - 0.045], s: [0.04, 3.0, 0.04] });
    const felt: Xform[] = [-1, 1].map((sgn) => ({ p: [sgn * 5.7, 1.9, d / 2 - 0.012], s: [6.8, 3.1, 0.02] }) as Xform);
    // Kitenge textile art: framed panels on the south wall (beyond the slats) and the east wall between the lounges
    const artPanels: Xform[] = [
      { p: [-12.6, 2.2, d / 2 - 0.03], s: [2.4, 1.6, 0.03] },
      { p: [12.6, 2.2, d / 2 - 0.03], s: [2.4, 1.6, 0.03] },
      { p: [w / 2 - 0.03, 2.2, 0.6], r: Math.PI / 2, s: [2.6, 1.7, 0.03] },
    ];
    const artFrames: Xform[] = artPanels.map((a) => ({ p: [a.p[0] + (a.r ? 0.012 : 0), a.p[1], a.p[2] + (a.r ? 0 : 0.012)], r: a.r, s: [(a.s as number[])[0]! + 0.08, (a.s as number[])[1]! + 0.08, 0.02] }));
    // window banquette: upholstered seat + back, Kitenge cushions
    const benchSeat: Xform[] = [-6, 6].map((x) => ({ p: [x, 0.22, -12.3], s: [10.4, 0.44, 0.62] }) as Xform);
    const benchBack: Xform[] = [-6, 6].map((x) => ({ p: [x, 0.66, -12.6], s: [10.4, 0.46, 0.14] }) as Xform);
    const cushions: Xform[] = [];
    for (const x0 of [-6, 6]) for (let i = 0; i < 6; i++) cushions.push({ p: [x0 - 4.4 + i * 1.75, 0.62, -12.44], r: 0, rx: -0.25, rz: (n(i + x0) - 0.5) * 0.2 });
    // sofa cushions (Kitenge accents): two per sofa, against the back
    for (const s of sofas)
      for (const lx of [-0.62, 0.62]) {
        const lz = -0.18;
        cushions.push({ p: [s.x + lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw), 0.62, s.z - lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw)], r: s.yaw, rx: -0.25 });
      }
    // coffee bar: counter body, fluted oak front, stone top, back counter, open shelves, ceramics
    const barBody: Xform[] = [{ p: [BX - 0.05, 0.52, barZ], s: [0.7, 1.04, barLen] }];
    const flutes: Xform[] = [];
    for (let z = LUDO_BAR.z0 + 0.06; z <= LUDO_BAR.z1 - 0.06; z += 0.07) flutes.push({ p: [BX + 0.32, 0.52, z], s: [0.035, 0.98, 0.035] });
    const barTop: Xform[] = [
      { p: [BX + 0.05, 1.065, barZ], s: [1.0, 0.05, barLen + 0.08] },
      { p: [-16.55, 0.93, barZ], s: [0.92, 0.04, barLen] },
    ];
    const backCab: Xform[] = [{ p: [-16.55, 0.455, barZ], s: [0.86, 0.91, barLen] }];
    const shelves: Xform[] = [1.55, 2.0].flatMap((y) => [-4.6, 1.6].map((z) => ({ p: [-w / 2 + 0.16, y, z], s: [0.28, 0.035, 2.6] }) as Xform));
    const jars: Xform[] = [];
    const jarCols: string[] = [];
    [1.57, 2.02].forEach((y, si) =>
      [-4.6, 1.6].forEach((z0, bi) => {
        for (let i = 0; i < 9; i++) {
          jars.push({ p: [-w / 2 + 0.16, y + 0.08, z0 - 1.15 + i * 0.29], s: [0.055, 0.16, 0.055] });
          jarCols.push(["#e8e2d6", "#c9b69a", "#7d6a58", "#b7a089", "#d9d2c4"][(i + si * 2 + bi) % 5]!);
        }
      }),
    );
    const cups: Xform[] = [];
    for (let i = 0; i < 10; i++) cups.push({ p: [-16.3, 0.99, -1.2 + (i % 5) * 0.11 + Math.floor(i / 5) * 0.02], s: [0.04, 0.08, 0.04] });
    const stools: Xform[] = [];
    for (let z = LUDO_BAR.z0 + 0.6; z <= LUDO_BAR.z1 - 0.5; z += 0.9) stools.push({ p: [BX + 1.0, 0, z] });
    const barGlobes: Xform[] = [-4.6, -2.2, 0.2, 2.6].map((z) => ({ p: [BX + 0.05, 2.65, z], s: 0.75 }) as Xform);
    // board-game library (west wall, south of the bar): frame, shelves, boxed games
    const libFrame: Xform[] = [
      { p: [-16.75, 1.1, 8.0], s: [0.45, 2.2, 0.04] },
      { p: [-16.97, 1.1, 8.0], s: [0.04, 2.2, 3.4] },
      { p: [-16.75, 1.1, 6.32], s: [0.45, 2.2, 0.04] },
      { p: [-16.75, 1.1, 9.68], s: [0.45, 2.2, 0.04] },
      ...[0.05, 0.6, 1.15, 1.7, 2.2].map((y) => ({ p: [-16.75, y, 8.0], s: [0.45, 0.035, 3.4] }) as Xform),
    ];
    const games: Xform[] = [];
    const gameCols: string[] = [];
    [0.07, 0.62, 1.17, 1.72].forEach((y, si) => {
      let z = 6.42;
      let j = 0;
      while (z < 9.5) {
        const flat = (si + j) % 3 === 0;
        const th = flat ? 0.06 : 0.05 + n(si * 31 + j) * 0.03;
        if (flat) {
          games.push({ p: [-16.75, y + 0.035 + 0.03, z + 0.18], s: [0.38, 0.06, 0.36] });
          z += 0.4;
        } else {
          games.push({ p: [-16.75, y + 0.035 + 0.2, z + th / 2], s: [0.36, 0.4, th] });
          z += th + 0.01;
        }
        gameCols.push(["#a4543f", "#3f6f69", "#c99b4f", "#3b4160", "#d9d0c0", "#6b5a7a", "#7a8a5c"][(si * 3 + j) % 7]!);
        j++;
      }
    });
    // lounge coffee tables (round oak), lounge rugs
    const coffee: Xform[] = [
      { p: [14.6, 0.21, -3.6], s: [0.62, 0.42, 0.62] },
      { p: [14.6, 0.19, 6.0], s: [0.6, 0.38, 0.6] },
    ];
    return { baffles, baffleCols, linears, slats, felt, artPanels, artFrames, benchSeat, benchBack, cushions, barBody, flutes, barTop, backCab, shelves, jars, jarCols, cups, stools, barGlobes, libFrame, games, gameCols, coffee };
  }, [w, d, h, layout.aisles, BX, barLen, barZ, sofas]);

  const poufs = useMemo(
    () => layout.colliders.filter((c) => c.w === LUDO_POUF.s && c.d === LUDO_POUF.s).map((c, i) => ({ p: [c.x, 0, c.z], r: i * 0.9, s: 0.62 }) as Xform),
    [layout.colliders],
  );
  const shadowBlobs: Blob[] = useMemo(
    () => [
      ...tables.map((t) => ({ x: t.x, z: t.z, w: 1.9, d: 1.9, o: 1 })),
      ...layout.seats.map((s) => ({ x: s.x, z: s.z, w: 1.05, d: 1.05, r: s.yaw })),
      ...poufs.map((p) => ({ x: p.p[0], z: p.p[2], w: 0.85, d: 0.85 })),
      ...sofas.map((s) => ({ x: s.x, z: s.z, w: 2.6, d: 1.4, r: s.yaw })),
      { x: BX, z: barZ, w: 1.3, d: barLen + 0.6 },
      { x: 0, z: -12.35, w: 23, d: 1.1 },
    ],
    [tables, layout.seats, poufs, sofas, BX, barZ, barLen],
  );

  return (
    <group>
      {/* -------- lighting: soft overhead key (even on every board), sky fill, diffuse north window; no sun, no point lights -------- */}
      <Environment resolution={32} frames={1} environmentIntensity={0.5}>
        <Lightformer intensity={1.2} position={[0, 4.4, 0]} rotation-x={Math.PI / 2} scale={[28, 20, 1]} color="#fff4e6" />
        <Lightformer intensity={1.4} position={[0, 2.3, -12.5]} scale={[32, 3.6, 1]} color="#e4edf4" />
        <Lightformer intensity={0.5} position={[0, 1.2, 0]} rotation-x={-Math.PI / 2} scale={[28, 20, 1]} color="#9a8f80" />
      </Environment>
      <hemisphereLight args={["#fff6ea", "#7a7064", lite ? 1.35 : 1.1]} />
      <directionalLight
        position={[1.2, 20, 2.0]}
        intensity={lite ? 1.35 : 1.45}
        color="#fff1df"
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={8}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={4}
      />
      {/* north daylight, diffused by the blinds: a gentle cool wash from the window side (no sun streaks) */}
      <directionalLight position={[0, 7, -30]} intensity={0.5} color="#e6eef6" />
      {/* soft low fill from the entrance side: lifts the walls and faces a little (no shadow, no streaks) */}
      <directionalLight position={[-6, 6, 30]} intensity={0.35} color="#fff3e4" />

      {/* -------- shell -------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={floorMat}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, h, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#e4ded4" emissive="#efe8dc" emissiveIntensity={0.3} roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <Instanced geometry={box} items={X.baffles} colors={X.baffleCols} receiveShadow={false}>
        <meshStandardMaterial roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      {/* linear lights flush in the ceiling over the aisles: seen only between the baffles (shielded), soft */}
      <Instanced geometry={box} items={X.linears} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#fff4e6" emissiveIntensity={0.68} roughness={1} />
      </Instanced>
      {/* west: warm plaster (bar); east: soft clay accent wall (lounges) */}
      <mesh position={[-w / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial normalMap={plaster.normalMap} normalScale={smallN} color="#f1ebe1" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial normalMap={plaster.normalMap} normalScale={smallN} color="#d9bfa8" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <Instanced
        geometry={box}
        items={[
          { p: [-w / 2 + 0.01, 0.05, 0], s: [0.02, 0.1, d] },
          { p: [w / 2 - 0.01, 0.05, 0], s: [0.02, 0.1, d] },
        ]}
      >
        <meshStandardMaterial color="#5e5146" roughness={0.9} metalness={0} />
      </Instanced>
      <WindowWall w={w} d={d} h={h} sill={0.45} head={4.2} transom={3.05} bays={10} glassTint="#a9bcc6" glassOpacity={0.05} frameColor="#2b2c2e" matte>
        <meshStandardMaterial normalMap={plaster.normalMap} normalScale={smallN} color="#f1ebe1" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </WindowWall>
      {/* sheer blinds lowered to the transom: the upper daylight comes in diffused, the view stays clear below */}
      <mesh position={[0, (3.08 + 4.17) / 2, -d / 2 + 0.07]} renderOrder={3}>
        <planeGeometry args={[w - 0.2, 4.17 - 3.08]} />
        <meshStandardMaterial color="#e8e4dc" emissive="#fbf7ef" emissiveIntensity={0.3} roughness={1} metalness={0} transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <SouthWall layout={layout}>
        <meshStandardMaterial normalMap={plaster.normalMap} normalScale={smallN} color="#ebe4d8" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </SouthWall>
      <Instanced geometry={box} items={X.felt} receiveShadow={false}>
        <meshStandardMaterial color="#3a3836" roughness={1} metalness={0} />
      </Instanced>
      <Instanced geometry={box} items={X.slats} receiveShadow={false}>
        <meshStandardMaterial color="#b08d68" roughness={0.88} metalness={0} envMapIntensity={0.12} />
      </Instanced>
      <Instanced geometry={box} items={X.artFrames}>
        <meshStandardMaterial color="#4a3a2e" roughness={0.9} metalness={0} />
      </Instanced>
      <Instanced geometry={box} items={X.artPanels}>
        <meshStandardMaterial map={artWall} roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>

      {/* -------- tables, armchairs, poufs, pendants -------- */}
      <LudoTables tables={tables} status={st} lite={lite} />
      <Pendants tables={tables} status={status} ceiling={h} />
      <LightPools items={tables.map((t) => ({ x: t.x, z: t.z, w: 3.4, d: 3.4 }))} color="#ffe9cf" opacity={lite ? 0.1 : 0.07} y={0.011} />
      <GltfInstances url={model("modern_arm_chair_01")} items={layout.seats.map((s) => ({ p: [s.x, 0, s.z], r: s.yaw, s: 0.9 }))} castShadow={!lite} matOverride={chairMat} />
      <GltfInstances url={model("Ottoman_01")} items={poufs} matOverride={poufMat} />

      {/* -------- coffee bar (west wall) -------- */}
      <Instanced geometry={box} items={X.barBody} castShadow={!lite}>
        <meshStandardMaterial color="#3f4644" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.flutes}>
        <meshStandardMaterial map={oak.map} color="#d9bf9c" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.barTop}>
        <meshStandardMaterial color="#dcd5c9" roughness={0.88} metalness={0} envMapIntensity={0.12} />
      </Instanced>
      <Instanced geometry={box} items={X.backCab}>
        <meshStandardMaterial map={oak.map} color="#c9ab86" roughness={0.86} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.shelves}>
        <meshStandardMaterial map={oak.map} color="#c9ab86" roughness={0.86} metalness={0} />
      </Instanced>
      {!lite && (
        <Instanced geometry={cyl} items={X.jars} colors={X.jarCols}>
          <meshStandardMaterial roughness={0.85} metalness={0} envMapIntensity={0.1} />
        </Instanced>
      )}
      <Instanced geometry={cyl} items={X.cups}>
        <meshStandardMaterial color="#efebe3" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <EspressoCorner lite={lite} />
      <BarStools items={X.stools} lite={lite} />
      <Instanced geometry={ball} items={X.barGlobes.map((g) => ({ ...g, s: 0.15 }))} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#ffeedd" emissiveIntensity={0.7} roughness={1} />
      </Instanced>
      <Instanced geometry={cyl} items={X.barGlobes.map((g) => ({ p: [g.p[0], (g.p[1] + 0.15 + h) / 2, g.p[2]], s: [0.003, h - g.p[1] - 0.15, 0.003] }) as Xform)} receiveShadow={false}>
        <meshStandardMaterial color="#5d5953" roughness={0.9} />
      </Instanced>
      {[-4.6, 1.6].map((z) => (
        <mesh key={z} position={[-w / 2 + 0.03, 3.0, z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[2.1, 1.3]} />
          <meshStandardMaterial map={menu} roughness={0.95} metalness={0} envMapIntensity={0.05} />
        </mesh>
      ))}
      <Text font={FONT} fontSize={0.36} position={[-w / 2 + 0.03, 3.95, barZ]} rotation={[0, Math.PI / 2, 0]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
        IKAWA · COFFEE BAR
        <meshStandardMaterial color="#4a3a2e" roughness={0.9} metalness={0} />
      </Text>

      {/* -------- board-game library -------- */}
      <Instanced geometry={box} items={X.libFrame}>
        <meshStandardMaterial map={oak.map} color="#c9ab86" roughness={0.86} metalness={0} />
      </Instanced>
      <Instanced geometry={box} items={X.games} colors={X.gameCols}>
        <meshStandardMaterial roughness={0.9} metalness={0} envMapIntensity={0.08} />
      </Instanced>

      {/* -------- lounges (east wall): Kitenge rugs, sofas, armchairs, oak coffee tables, the giant die -------- */}
      {[
        [14.4, -3.6, 4.6, 5.0],
        [14.6, 6.0, 4.2, 5.4],
      ].map(([x, z, rw, rd]) => (
        <mesh key={z} position={[x!, 0.008, z!]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[rw!, rd!]} />
          <meshStandardMaterial map={rug} roughness={1} metalness={0} envMapIntensity={0.05} />
        </mesh>
      ))}
      <Sofas sofas={sofas} velour={velour.normalMap} lite={lite} />
      <GltfInstances
        url={model("modern_arm_chair_01")}
        items={[
          { p: [13.0, 0, -5.0], r: Math.PI / 2 + 0.35, s: 0.9 },
          { p: [13.0, 0, -2.2], r: Math.PI / 2 - 0.35, s: 0.9 },
        ]}
        castShadow={!lite}
        matOverride={chairMat}
      />
      <Instanced geometry={cyl} items={X.coffee} castShadow={!lite}>
        <meshStandardMaterial map={oak.map} color="#c4a27c" roughness={0.85} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <GiantDie x={14.6} z={-3.6} />
      <Text font={FONT} fontSize={0.5} position={[w / 2 - 0.03, 3.55, -3.6]} rotation={[0, -Math.PI / 2, 0]} anchorX="center" anchorY="middle" letterSpacing={0.1}>
        LUDO LOUNGE
        <meshStandardMaterial color="#4a3a2e" roughness={0.9} metalness={0} />
      </Text>
      <Text font={FONT} fontSize={0.17} position={[w / 2 - 0.03, 3.08, -3.6]} rotation={[0, -Math.PI / 2, 0]} anchorX="center" anchorY="middle" letterSpacing={0.06}>
        Every roll verified fair · Gukirana
        <meshStandardMaterial color="#5a4a3e" roughness={0.9} metalness={0} />
      </Text>

      {/* -------- window banquette, cushions -------- */}
      <Instanced geometry={box} items={X.benchSeat}>
        <meshStandardMaterial normalMap={velour.normalMap} color="#8f8273" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      <Instanced geometry={box} items={X.benchBack}>
        <meshStandardMaterial normalMap={velour.normalMap} color="#827567" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      {!lite && (
        <Instanced geometry={cushion} items={X.cushions}>
          <meshStandardMaterial map={art} roughness={1} metalness={0} envMapIntensity={0.05} />
        </Instanced>
      )}

      {/* -------- plants, contact shadows -------- */}
      <GltfInstances url={model("potted_plant_02")} items={LUDO_PLANTERS.map(([x, z], i) => ({ p: [x, 0, z], s: 1.5, r: i * 1.7 }) as Xform)} matOverride={matte} />
      {!lite && (
        <GltfInstances
          url={model("potted_plant_04")}
          items={[
            { p: [-w / 2 + 0.16, 2.035, -6.2], s: 0.9 },
            { p: [-w / 2 + 0.16, 1.585, 3.1], s: 0.9, r: 1 },
            { p: [BX + 0.1, 1.09, LUDO_BAR.z1 - 0.3], s: 0.8, r: 2 },
          ]}
          matOverride={matte}
        />
      )}
      <BlobShadows items={shadowBlobs} opacity={0.45} y={0.01} />
    </group>
  );
}

/** Espresso machine, grinder and pastry case on the bar: powder-coated (matte), low-reflection glass. */
function EspressoCorner({ lite }: { lite: boolean }) {
  const pastry = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  return (
    <group>
      <group position={[-16.55, 0.95, -1.9]}>
        <mesh position={[0, 0.22, 0]} castShadow={!lite}>
          <boxGeometry args={[0.5, 0.44, 0.8]} />
          <meshStandardMaterial color="#e3ddd2" roughness={0.8} metalness={0} envMapIntensity={0.12} />
        </mesh>
        <mesh position={[0.2, 0.3, 0]}>
          <boxGeometry args={[0.12, 0.06, 0.7]} />
          <meshStandardMaterial color="#3f4644" roughness={0.85} metalness={0} />
        </mesh>
        {[-0.2, 0.2].map((gz) => (
          <mesh key={gz} position={[0.28, 0.12, gz]}>
            <cylinderGeometry args={[0.035, 0.03, 0.08, 16]} />
            <meshStandardMaterial color="#2a2928" roughness={0.85} metalness={0} />
          </mesh>
        ))}
      </group>
      <group position={[-16.55, 0.95, -0.8]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.09, 0.11, 0.4, 16]} />
          <meshStandardMaterial color="#2a2928" roughness={0.85} metalness={0} />
        </mesh>
        <mesh position={[0, 0.48, 0]}>
          <coneGeometry args={[0.11, 0.18, 16, 1, true]} />
          <meshStandardMaterial color="#5b4636" roughness={0.85} metalness={0} />
        </mesh>
      </group>
      {/* pastry case: unlit low-reflection glass, warm pastries */}
      <mesh position={[LUDO_BAR.x + 0.05, 1.25, 2.3]} renderOrder={2}>
        <boxGeometry args={[0.55, 0.32, 1.3]} />
        <meshBasicMaterial color="#cfdde2" transparent opacity={0.06} depthWrite={false} />
      </mesh>
      <Instanced
        geometry={pastry}
        items={Array.from({ length: 8 }, (_, k) => ({ p: [LUDO_BAR.x - 0.03 + (k % 2) * 0.16, 1.12, 1.85 + Math.floor(k / 2) * 0.3], s: [0.07, 0.035, 0.05] }) as Xform)}
        colors={["#b98a50", "#a06c3a", "#cfa76c"]}
      >
        <meshStandardMaterial roughness={0.85} metalness={0} />
      </Instanced>
    </group>
  );
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
        <meshStandardMaterial color="#8a6e55" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {[stem, base, ring].map((g, i) => (
        <Instanced key={i} geometry={g} items={items}>
          <meshStandardMaterial color="#2a2928" roughness={0.85} metalness={0} envMapIntensity={0.1} />
        </Instanced>
      ))}
    </>
  );
}
