"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Text } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { selfPose, useWorld } from "@/lib/world-store";
import { sessionMemo } from "@/world/session-cache";
import { IGISORO_LOUNGE, IGISORO_TREE, IGISORO_TREE_BENCH, IGISORO_WEST_WINDOWS, type HallLayout, type Table } from "./layouts";
import { BlobShadows, GltfInstances, Instanced, LightPools, model, usePbr, type Blob, type Xform } from "./interior-kit";
import { imigongo, imigongoPanel, leafCard } from "./room-textures";
import { SouthWall, WindowWall } from "./shell";
import { STATUS_COLOR, tableAt, tableNo, tableStatuses, type TableStatus } from "./table-status";
import { pickedTable } from "./RoomPlayer";
import { useRoom } from "./room-store";

/**
 * Igisoro Court — a big, calm, contemporary Rwandan games hall (34 × 26 m, 5 m ceiling): sixteen low Igisoro tables
 * (the traditional 4 × 8-pit board, 64 seeds) in two wings round a central courtyard where the elders' tree rises
 * into a diffused skylight, ringed by a built-in timber bench. Warm natural timber (tables, stools, glulam beams,
 * battens over a woven sisal ceiling), clay-lime plaster, a burnished clay-tile floor with woven mats under each table, one
 * Imigongo feature wall (east) over a long spectator banquette, a spectator lounge in front of the full-width north
 * glazing, tall west windows with timber window seats and Agaseke baskets in the niches by the door.
 *
 * Eye comfort (no glare): every surface is matte (roughness ≥ 0.85, metalness 0, envMapIntensity ≤ 0.2, no
 * clearcoat); the boards and seeds are satin at most. No bare bright sources: the woven Agaseke pendants carry an
 * opal disc recessed 12 cm up inside the shade (seen only from below the rim), the skylight is an opal diffuser, all
 * emissives stay below the bloom threshold, and the light on the boards comes from one soft, nearly vertical key
 * (even across every board) plus sky fill — no spot or point lights, so no hot-spots and no sun streaks. Glazing is
 * unlit low-reflection glass, the upper north bays diffused by sheer blinds.
 *
 * Choosing a table: each table has its number on the timber pendant bar (both faces) with a free / waiting / playing
 * band under it and a soft status ring on its mat, read live from the server-claimed seats (rooms/table-status.ts);
 * the table under the mouse, the one you are walking to and the one you stand by get a bright outline.
 */
const FONT = "/fonts/Baloo2.ttf";
const n = (i: number) => {
  const x = Math.sin(i * 37.719 + 1.7) * 43758.5453;
  return x - Math.floor(x);
};
const BOARD = { w: 1.4, d: 0.7, pitR: 0.066, depth: 0.03, cols: 8, rows: 4 };
/** board top above the table top (base slab + carved rim) */
const BOARD_TOP = 0.061;
const BAR_Y = 2.45; // timber pendant bar (table number + status band)
const SHADE_Y = 1.86; // rim of the woven shades (1.3 m above the boards)
const pitCentre = (c: number, r: number): [number, number] => [(c - (BOARD.cols - 1) / 2) * (BOARD.w / BOARD.cols), (r - (BOARD.rows - 1) / 2) * (BOARD.d / BOARD.rows)];

/** glTF props: matte, no metal, (almost) no reflections */
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

/* ---------------- shared geometry ---------------- */

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

/** Rounded-rectangle outline lying flat (floor status ring / highlight), centred on the origin. */
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

/** Low modern stool: oiled timber frame (apron ring, four splayed legs, foot ring) merged into one geometry. */
function stoolFrameGeometry() {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.215, 0.215, 0.035, 28).translate(0, 0.318, 0), new THREE.TorusGeometry(0.17, 0.009, 6, 28).rotateX(Math.PI / 2).translate(0, 0.12, 0)];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.CylinderGeometry(0.017, 0.022, 0.33, 8).translate(0, 0.165, 0);
    leg.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), 0.13));
    leg.translate(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15);
    parts.push(leg);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}
/** the stool's upholstered cushion: a soft rounded drum (seat height 0.44 m) */
function cushionGeometry() {
  const pts = [
    [0, 0.335],
    [0.2, 0.335],
    [0.228, 0.345],
    [0.24, 0.375],
    [0.236, 0.41],
    [0.22, 0.432],
    [0.18, 0.442],
    [0, 0.444],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 28);
}

/** Large-format burnished clay tiles (4 × 4 tiles of 0.6 m per repeat): warm, low-contrast, matte, thin grout. */
function clayTileTexture() {
  return sessionMemo("room-tex:igisoro-clay-tiles", () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#6f5244"; // grout
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const v = n(i * 7 + j * 13) - 0.5;
        g.fillStyle = `rgb(${Math.round(166 + v * 16)},${Math.round(128 + v * 12)},${Math.round(108 + v * 10)})`;
        g.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
        // fired-clay mottling, very soft
        for (let k = 0; k < 90; k++) {
          const a = n(i * 101 + j * 37 + k) * 0.06;
          g.fillStyle = n(k * 3 + i + j) > 0.5 ? `rgba(120,70,48,${a})` : `rgba(230,190,150,${a})`;
          const r = 6 + n(k * 5 + j) * 22;
          g.beginPath();
          g.arc(i * 128 + 2 + n(k * 7 + i) * 124, j * 128 + 2 + n(k * 11 + j) * 124, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
}

/** Agaseke: woven sisal with black and red-ochre zig-zag bands (pendant shades, baskets). */
function agasekeTexture() {
  return sessionMemo("room-tex:igisoro-agaseke", () => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#c8ad7c";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      g.fillStyle = `rgba(80,52,26,${0.1 + n(y) * 0.12})`;
      g.fillRect(0, y, 256, 1);
    }
    for (let x = 0; x < 256; x += 6) {
      g.fillStyle = `rgba(255,240,210,${0.05 + n(x + 3) * 0.06})`;
      g.fillRect(x, 0, 1, 256);
    }
    for (const band of [70, 150, 210]) {
      g.fillStyle = band === 150 ? "#7e2c1c" : "#1d1a17";
      for (let x = 0; x < 256; x += 32) {
        g.beginPath();
        g.moveTo(x, band);
        g.lineTo(x + 16, band - 12);
        g.lineTo(x + 32, band);
        g.lineTo(x + 16, band + 12);
        g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  });
}
/** Agaseke basket with its tall conical lid */
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
/** Agaseke-inspired pendant shade: a woven bell, open below (rim at y = 0) */
function shadeGeometry() {
  const pts = [
    [0.3, 0],
    [0.295, 0.05],
    [0.27, 0.14],
    [0.21, 0.25],
    [0.13, 0.34],
    [0.07, 0.39],
    [0.035, 0.42],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 28);
}

/* ---------------- seeds ---------------- */

/** Seed counts per pit (row-major: rows 0–1 = north player, rows 2–3 = south player). */
function boardCounts(ti: number, inProgress: boolean): number[] {
  const counts = new Array(BOARD.cols * BOARD.rows).fill(2) as number[];
  if (!inProgress) return counts; // the opening: two seeds in every pit
  // play a few deterministic sowing moves in each player's 16-pit loop (seeds stay on their owner's side)
  const loop = (side: number) => {
    const out: number[] = [];
    const r0 = side * 2;
    for (let c = 0; c < BOARD.cols; c++) out.push((r0 + 1) * BOARD.cols + c);
    for (let c = BOARD.cols - 1; c >= 0; c--) out.push(r0 * BOARD.cols + c);
    return out;
  };
  const loops = [loop(0), loop(1)];
  const moves = 6 + Math.floor(n(ti * 13 + 5) * 10);
  for (let m = 0; m < moves; m++) {
    const L = loops[m % 2]!;
    let k = Math.floor(n(ti * 71 + m * 17) * 16);
    for (let tries = 0; tries < 16 && counts[L[k]!]! < 2; tries++) k = (k + 1) % 16;
    let hand = counts[L[k]!]!;
    counts[L[k]!] = 0;
    while (hand > 0) {
      k = (k + 1) % 16;
      counts[L[k]!]!++;
      hand--;
    }
  }
  return counts;
}

/* ---------------- tables, boards, stools ---------------- */

function IgisoroTables({ layout, status, lite }: { layout: HallLayout; status: Record<string, TableStatus>; lite: boolean }) {
  const tables = layout.tables;
  const wood = usePbr("oak_veneer_01", [1, 0.5]);
  const woodB = usePbr("oak_veneer_01", [1.4, 0.7]);
  const board = useMemo(() => boardGeometry(lite), [lite]);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const seed = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const frame = useMemo(() => stoolFrameGeometry(), []);
  const cushion = useMemo(() => cushionGeometry(), []);

  const X = useMemo(() => {
    const tops: Xform[] = [];
    const legs: Xform[] = [];
    const bodies: Xform[] = [];
    const boards: Xform[] = [];
    for (const t of tables) {
      tops.push({ p: [t.x, t.h - 0.03, t.z], s: [t.w, 0.06, t.d] });
      // two inset slab trestles joined by a low stretcher: a clean contemporary base
      for (const s of [-1, 1]) legs.push({ p: [t.x + s * (t.w / 2 - 0.22), (t.h - 0.06) / 2, t.z], s: [0.07, t.h - 0.06, t.d - 0.2] });
      legs.push({ p: [t.x, 0.14, t.z], s: [t.w - 0.5, 0.06, 0.06] });
      // board body: a base slab below the pit bottoms plus a rim flush with the carved top (a solid block would
      // fill the pits and hide the seeds)
      bodies.push({ p: [t.x, t.h + 0.015, t.z], s: [BOARD.w + 0.06, 0.03, BOARD.d + 0.06] });
      for (const s of [-1, 1]) {
        bodies.push({ p: [t.x, t.h + 0.0455, t.z + s * (BOARD.d / 2 + 0.015)], s: [BOARD.w + 0.06, 0.031, 0.03] });
        bodies.push({ p: [t.x + s * (BOARD.w / 2 + 0.015), t.h + 0.0455, t.z], s: [0.03, 0.031, BOARD.d] });
      }
      boards.push({ p: [t.x, t.h + BOARD_TOP, t.z] });
    }
    const stools: Xform[] = layout.seats.map((s) => ({ p: [s.x, 0, s.z], r: s.yaw }));
    return { tops, legs, bodies, boards, stools };
  }, [tables, layout.seats]);

  // seeds: fresh boards show the opening (2 per pit); tables in a match (and a few boards left mid-game) show play
  const seedKey = tables.map((t, i) => (status[t.id] === "playing" || i % 3 === 1 ? 1 : 0)).join("");
  const seeds = useMemo<Xform[]>(() => {
    const out: Xform[] = [];
    tables.forEach((t, ti) => {
      const counts = boardCounts(ti, seedKey[ti] === "1");
      counts.forEach((count, pit) => {
        const r = Math.floor(pit / BOARD.cols);
        const c = pit % BOARD.cols;
        const [cx, cz] = pitCentre(c, r);
        for (let k = 0; k < count; k++) {
          // a loose phyllotaxis heap: the first ring rests on the pit floor, later seeds ride on top
          const rr = count === 1 ? 0.004 : 0.015 * Math.sqrt(k + 0.6) * (k < 7 ? 1 : 0.7);
          const a = k * 2.39996 + n(ti * 31 + pit * 7) * 6.28;
          const lx = Math.cos(a) * rr;
          const lz = Math.sin(a) * rr;
          const floor = -BOARD.depth * Math.sqrt(Math.max(0, 1 - (Math.hypot(lx, lz) / BOARD.pitR) ** 2));
          out.push({
            p: [t.x + cx + lx, t.h + BOARD_TOP + floor + 0.0085 + (k >= 7 ? 0.011 : 0), t.z + cz + lz],
            r: n(ti * 5 + pit * 3 + k) * 6.28,
            rx: (n(k * 7 + pit) - 0.5) * 0.6,
            s: [0.0112, 0.0082, 0.0098],
          });
        }
      });
    });
    return out;
  }, [tables, seedKey]);

  return (
    <group>
      {/* oiled timber, matte (no lacquer streaks) */}
      <Instanced geometry={box} items={X.tops} castShadow={!lite}>
        <meshStandardMaterial map={wood.map} normalMap={wood.normalMap} color="#e8cfb0" roughness={0.88} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      <Instanced geometry={box} items={X.legs} castShadow={!lite}>
        <meshStandardMaterial map={wood.map} color="#8a6a50" roughness={0.9} metalness={0} envMapIntensity={0.12} />
      </Instanced>
      <Instanced geometry={box} items={X.bodies}>
        <meshStandardMaterial map={woodB.map} normalMap={woodB.normalMap} color="#b88e68" roughness={0.85} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      {/* the carved board: satin hand-rubbed wood (soft sheen, no mirror highlight) */}
      <Instanced geometry={board} items={X.boards} castShadow={false}>
        <meshStandardMaterial map={woodB.map} color="#c69c74" roughness={0.72} metalness={0} envMapIntensity={0.18} />
      </Instanced>
      {/* inzuzi seeds: satin grey-brown, never shiny */}
      <Instanced geometry={seed} items={seeds} colors={["#7d796f", "#615c53", "#8f897c", "#55504a", "#74634c"]} castShadow={false}>
        <meshStandardMaterial roughness={0.62} metalness={0} envMapIntensity={0.15} />
      </Instanced>
      {/* low stools: oiled oak frame + woven-cotton cushion in muted Rwandan colours */}
      <Instanced geometry={frame} items={X.stools} castShadow={!lite}>
        <meshStandardMaterial map={wood.map} color="#c8a888" roughness={0.88} metalness={0} envMapIntensity={0.12} />
      </Instanced>
      <Instanced geometry={cushion} items={X.stools} colors={["#9a5238", "#3f4b5e", "#a9823e", "#56603f"]} castShadow={!lite}>
        <meshStandardMaterial roughness={1} metalness={0} envMapIntensity={0.08} />
      </Instanced>
    </group>
  );
}

/* ---------------- woven pendants, table numbers, status ---------------- */

/**
 * Two woven Agaseke shades per table hung from a slim timber bar (table number on both faces, a status band under
 * it). The opal disc sits 12 cm up inside each shade, so from anywhere in the hall you see the weave, never the
 * luminous face; all hang on hair-thin cables from the ceiling.
 */
function TablePendants({ layout, status, lite }: { layout: HallLayout; status: string[]; lite: boolean }) {
  const tables = layout.tables;
  const h = layout.size.h;
  const agaseke = useMemo(() => agasekeTexture(), []);
  const shade = useMemo(() => shadeGeometry(), []);
  const opal = useMemo(() => new THREE.CircleGeometry(0.255, 24).rotateX(Math.PI / 2), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cable = useMemo(() => new THREE.CylinderGeometry(0.0012, 0.0012, 1, 4), []);
  const ring = useMemo(() => ringGeometry(2.6, 3.5, 0.45, 0.06), []);
  const X = useMemo(() => {
    const shades: Xform[] = [];
    const opals: Xform[] = [];
    const bars: Xform[] = [];
    const bands: Xform[] = [];
    const cables: Xform[] = [];
    const drops: Xform[] = [];
    const rings: Xform[] = [];
    for (const t of tables) {
      for (const dx of [-0.42, 0.42]) {
        shades.push({ p: [t.x + dx, SHADE_Y, t.z] });
        opals.push({ p: [t.x + dx, SHADE_Y + 0.12, t.z] });
        drops.push({ p: [t.x + dx, (SHADE_Y + 0.42 + BAR_Y - 0.08) / 2, t.z], s: [1, BAR_Y - 0.08 - SHADE_Y - 0.42, 1] });
      }
      bars.push({ p: [t.x, BAR_Y, t.z], s: [1.5, 0.16, 0.07] });
      bands.push({ p: [t.x, BAR_Y - 0.066, t.z - 0.037], s: [1.3, 0.022, 0.004] }, { p: [t.x, BAR_Y - 0.066, t.z + 0.037], s: [1.3, 0.022, 0.004] });
      for (const dx of [-0.6, 0.6]) cables.push({ p: [t.x + dx, (h + BAR_Y + 0.08) / 2, t.z], s: [1, h - BAR_Y - 0.08, 1] });
      rings.push({ p: [t.x, 0.014, t.z] });
    }
    return { shades, opals, bars, bands, cables, drops, rings };
  }, [tables, h]);
  const bandColors = useMemo(() => status.flatMap((c) => [c, c]), [status]);
  return (
    <group>
      <Instanced geometry={shade} items={X.shades} receiveShadow={false}>
        <meshStandardMaterial map={agaseke} color="#e2cfa8" roughness={0.95} metalness={0} envMapIntensity={0.1} side={THREE.DoubleSide} />
      </Instanced>
      {/* recessed opal disc: soft warm-neutral, tone-mapped and below the bloom threshold */}
      <Instanced geometry={opal} items={X.opals} receiveShadow={false}>
        <meshStandardMaterial color="#000000" emissive="#ffeedb" emissiveIntensity={0.72} roughness={1} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced geometry={box} items={X.bars} castShadow={false} receiveShadow={false}>
        <meshStandardMaterial color="#6f4f36" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.bands} colors={bandColors} receiveShadow={false}>
        <meshBasicMaterial color="#ffffff" />
      </Instanced>
      {!lite && (
        <Instanced geometry={cable} items={X.cables} receiveShadow={false}>
          <meshStandardMaterial color="#77736d" roughness={0.9} metalness={0} />
        </Instanced>
      )}
      <Instanced geometry={cable} items={X.drops} receiveShadow={false}>
        <meshStandardMaterial color="#3a2a1e" roughness={0.9} metalness={0} />
      </Instanced>
      <Instanced geometry={ring} items={X.rings} colors={status} receiveShadow={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.78} depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
      </Instanced>
      {tables.flatMap((t) =>
        [-1, 1].map((side) => (
          <Text
            key={`${t.id}${side}`}
            font={FONT}
            fontSize={0.1}
            position={[t.x, BAR_Y + 0.012, t.z + side * 0.037]}
            rotation={[0, side > 0 ? 0 : Math.PI, 0]}
            anchorX="center"
            anchorY="middle"
            color="#eadfcf"
          >
            {`TABLE ${tableNo(t.id)}`}
          </Text>
        )),
      )}
    </group>
  );
}

/**
 * Hover / tap highlight: a bright outline round the table under the mouse (desktop), else the table you are walking
 * to (picked in the HUD or tapped), else the one you stand by. The cursor turns into a pointer over a table.
 */
function TableHighlight({ layout }: { layout: HallLayout }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const geo = useMemo(() => ringGeometry(2.78, 3.68, 0.5, 0.075), []);
  const { camera, gl } = useThree();
  const hover = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return void (hover.current = null);
      const r = el.getBoundingClientRect();
      hover.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    const out = () => (hover.current = null);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", out);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", out);
      el.style.cursor = "";
    };
  }, [gl]);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(layout.tables[0]?.h ?? 0.55)), [layout]);
  useFrame((st) => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const R = useRoom.getState();
    let t: Table | null = null;
    let hovered = false;
    if (hover.current && !R.seated && !R.leaving) {
      ray.setFromCamera(ndc.set(hover.current.x, hover.current.y), camera);
      if (ray.ray.intersectPlane(plane, hit)) t = tableAt(layout, hit.x, hit.z, 0.25);
      hovered = !!t;
    }
    const picked = pickedTable();
    if (!t && picked) t = layout.tables.find((x) => x.id === picked) ?? null;
    if (!t && !R.seated) {
      const near = tableAt(layout, selfPose.x, selfPose.z, 1.35);
      if (near) t = near;
    }
    gl.domElement.style.cursor = hovered ? "pointer" : "";
    m.visible = !!t;
    if (t) {
      m.position.set(t.x, 0.016, t.z);
      mat.current.opacity = (hovered || picked ? 0.85 : 0.55) + Math.sin(st.clock.elapsedTime * 3) * 0.1;
    }
  });
  return (
    <mesh ref={ref} geometry={geo} visible={false} renderOrder={4}>
      <meshBasicMaterial ref={mat} color="#e8eef8" transparent opacity={0.7} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
  );
}

/* ---------------- courtyard tree ---------------- */

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

/**
 * The elders' tree: tapered trunk + limbs (bark PBR, merged), leaf-card canopy rising into the skylight. The canopy
 * fades out while the follow camera is inside it or looks at you through it (camera occlusion).
 */
function CourtTree({ lite }: { lite: boolean }) {
  const bark = usePbr("bark_brown_02", [2, 1]);
  const leaf = useMemo(() => leafCard(), []);
  const leafMat = useRef<THREE.MeshStandardMaterial>(null);
  const woodMat = useRef<THREE.MeshStandardMaterial>(null);
  const { camera } = useThree();
  const { wood, ends } = useMemo(() => {
    const parts = [
      taperedTube([new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0.08, 1.0, 0.05), new THREE.Vector3(-0.05, 2.0, -0.04), new THREE.Vector3(0.02, 2.9, 0.0)], 0.3, 0.14, 24, 14),
    ];
    const ends: THREE.Vector3[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + n(k) * 0.6;
      const y0 = 2.1 + n(k + 9) * 0.7;
      const L = 1.2 + n(k + 3) * 0.7;
      const mid = new THREE.Vector3(Math.cos(a) * L * 0.5, y0 + 0.55, Math.sin(a) * L * 0.5);
      const end = new THREE.Vector3(Math.cos(a) * L, y0 + 1.1 + n(k + 5) * 0.6, Math.sin(a) * L);
      parts.push(taperedTube([new THREE.Vector3(0, y0, 0), mid, end], 0.1, 0.03, 12, 8));
      ends.push(end, mid.clone().lerp(end, 0.4));
    }
    ends.push(new THREE.Vector3(0, 4.0, 0), new THREE.Vector3(0.4, 4.5, -0.3), new THREE.Vector3(-0.5, 4.3, 0.4));
    const wood = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return { wood, ends };
  }, []);
  const cards = useMemo<Xform[]>(() => {
    const out: Xform[] = [];
    const count = lite ? 120 : 240;
    for (let i = 0; i < count; i++) {
      const e = ends[i % ends.length]!;
      const r = 0.2 + n(i * 3) * 0.8;
      const a = n(i * 5) * Math.PI * 2;
      out.push({
        p: [e.x + Math.cos(a) * r, Math.max(2.5, e.y + (n(i * 7) - 0.4) * 0.7), e.z + Math.sin(a) * r],
        r: n(i * 11) * 6.28,
        rx: (n(i * 13) - 0.5) * 2.2,
        rz: (n(i * 17) - 0.5) * 1.2,
        s: 0.75 + n(i * 19) * 0.5,
      });
    }
    return out;
  }, [ends, lite]);
  const card = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useFrame((_, dt) => {
    // does the line from your head to the follow camera pass through the tree (trunk below 2 m, limbs and canopy
    // within 2.4 m of the trunk above)? Then the whole tree fades so it never fills the screen.
    const c = camera.position;
    let blocked = false;
    for (let k = 1; k <= 16 && !blocked; k++) {
      const f = k / 16;
      const x = selfPose.x + (c.x - selfPose.x) * f - IGISORO_TREE.x;
      const z = selfPose.z + (c.z - selfPose.z) * f - IGISORO_TREE.z;
      const y = 1.55 + (c.y - 1.55) * f;
      const r = Math.hypot(x, z);
      blocked = y > 1.9 ? r < 2.4 : r < 0.5;
    }
    const want = blocked ? 0.2 : 1;
    for (const m of [leafMat.current, woodMat.current]) {
      if (!m) continue;
      m.opacity += (want - m.opacity) * Math.min(1, dt * 6);
      const fading = m.opacity < 0.98;
      if (m.transparent !== fading) {
        m.transparent = fading;
        m.depthWrite = !fading;
        m.needsUpdate = true;
      }
    }
  });
  return (
    <group position={[IGISORO_TREE.x, 0, IGISORO_TREE.z]}>
      <mesh geometry={wood} castShadow={!lite} receiveShadow>
        <meshStandardMaterial ref={woodMat} map={bark.map} normalMap={bark.normalMap} color="#8f7a68" roughness={0.95} metalness={0} envMapIntensity={0.12} />
      </mesh>
      <Instanced geometry={card} items={cards} castShadow={!lite} colors={["#e8eedb", "#d4dfc0", "#c4d4ac", "#e2e8d0"]}>
        <meshStandardMaterial ref={leafMat} map={leaf} alphaTest={0.45} side={THREE.DoubleSide} roughness={0.9} metalness={0} envMapIntensity={0.12} />
      </Instanced>
    </group>
  );
}

/* ---------------- room ---------------- */

export function IgisoroCourt({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { w, d, h } = layout.size;
  const tables = layout.tables;
  const seatsMap = useWorld((s) => s.seats);
  const st = useMemo(() => tableStatuses(layout, seatsMap), [layout, seatsMap]);
  const status = useMemo(() => tables.map((t) => STATUS_COLOR[st[t.id] ?? "free"]), [tables, st]);

  const floor = useMemo(() => {
    const t = clayTileTexture().clone();
    t.repeat.set(w / 2.4, d / 2.4);
    t.needsUpdate = true;
    return t;
  }, [w, d]);
  const clay = usePbr("clay_plaster", [d / 3, h / 3]);
  const clayN = usePbr("clay_plaster", [w / 3, 0.5]);
  const timber = usePbr("rough_wood", [1, 3]);
  const weave = usePbr("tatami_mat", [w / 1.6, d / 1.6]);
  const mat = usePbr("tatami_mat", [1.6, 2]);
  const panels = useMemo(() => [imigongoPanel(0), imigongoPanel(1)], []);
  const frieze = useMemo(() => imigongo([24, 1]), []);
  const agaseke = useMemo(() => agasekeTexture(), []);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const agasekeGeo = useMemo(() => agasekeGeometry(), []);
  const matGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const smallN = useMemo(() => new THREE.Vector2(0.3, 0.3), []);
  const T = IGISORO_TREE;
  const SKY = { x: T.x, z: T.z, s: 6.2 };
  const LG = IGISORO_LOUNGE;

  const X = useMemo(() => {
    // glulam beams north–south over the aisles + fine battens east–west under the woven ceiling (skylight left open)
    const beams: Xform[] = [-14.6, -9.8, -4.6, 4.6, 9.8, 14.6].map((x) => ({ p: [x, h - 0.22, 0], s: [0.22, 0.44, d] }) as Xform);
    const battens: Xform[] = [];
    for (let z = -d / 2 + 0.6; z <= d / 2 - 0.4; z += 0.6) {
      if (Math.abs(z - SKY.z) < SKY.s / 2 + 0.05) {
        battens.push({ p: [(-w / 2 + SKY.x - SKY.s / 2) / 2, h - 0.04, z], s: [SKY.x - SKY.s / 2 + w / 2, 0.06, 0.05] });
        battens.push({ p: [(w / 2 + SKY.x + SKY.s / 2) / 2, h - 0.04, z], s: [w / 2 - SKY.x - SKY.s / 2, 0.06, 0.05] });
      } else battens.push({ p: [0, h - 0.04, z], s: [w, 0.06, 0.05] });
    }
    // skylight light-well (timber) and the grid over its opal diffuser
    const well: Xform[] = [
      { p: [SKY.x, h + 0.5, SKY.z - SKY.s / 2], s: [SKY.s, 1.0, 0.12] },
      { p: [SKY.x, h + 0.5, SKY.z + SKY.s / 2], s: [SKY.s, 1.0, 0.12] },
      { p: [SKY.x - SKY.s / 2, h + 0.5, SKY.z], s: [0.12, 1.0, SKY.s] },
      { p: [SKY.x + SKY.s / 2, h + 0.5, SKY.z], s: [0.12, 1.0, SKY.s] },
    ];
    const skyBars: Xform[] = [-1.55, 0, 1.55].flatMap((o) => [
      { p: [SKY.x + o, h + 0.96, SKY.z], s: [0.07, 0.08, SKY.s] } as Xform,
      { p: [SKY.x, h + 0.96, SKY.z + o], s: [SKY.s, 0.08, 0.07] } as Xform,
    ]);
    // woven mats under each table cluster
    const mats: Xform[] = tables.map((t) => ({ p: [t.x, 0.006, t.z], s: [2.9, 1, 3.8] }));
    // east: Imigongo feature wall (8 panels between timber fins) over the spectator banquette
    const imA: Xform[] = [];
    const imB: Xform[] = [];
    const fins: Xform[] = [];
    const PW = 2.2;
    const z0 = -0.6 - 4 * (PW + 0.2) + (PW + 0.2) / 2;
    for (let i = 0; i < 8; i++) {
      const z = z0 + i * (PW + 0.2);
      (i % 2 ? imB : imA).push({ p: [w / 2 - 0.03, 2.75, z], r: -Math.PI / 2, s: [PW, 3.1, 0.03] });
      fins.push({ p: [w / 2 - 0.06, 2.75, z - (PW + 0.2) / 2], s: [0.12, 3.3, 0.2] });
    }
    fins.push({ p: [w / 2 - 0.06, 2.75, z0 + 7.5 * (PW + 0.2)], s: [0.12, 3.3, 0.2] });
    fins.push({ p: [w / 2 - 0.08, 4.45, -0.6], s: [0.16, 0.1, 8 * (PW + 0.2) + 0.2] }); // cornice
    // spectator banquette (east) and the west window seats: timber plinth + upholstered seat (+ back cushions east)
    const benchBase: Xform[] = [{ p: [16.45, 0.16, -0.6], s: [0.62, 0.32, 19] }, ...IGISORO_WEST_WINDOWS.map((z) => ({ p: [-16.55, 0.16, z], s: [0.55, 0.32, 2.2] }) as Xform)];
    const benchSeat: Xform[] = [{ p: [16.43, 0.38, -0.6], s: [0.64, 0.12, 19] }, ...IGISORO_WEST_WINDOWS.map((z) => ({ p: [-16.55, 0.38, z], s: [0.58, 0.12, 2.1] }) as Xform)];
    const benchBack: Xform[] = [];
    for (let i = 0; i < 8; i++) benchBack.push({ p: [16.86, 0.68, z0 + i * (PW + 0.2)], rz: 0.12, s: [0.16, 0.48, PW + 0.12] });
    // west wall: five tall windows (sill 0.55, head 3.7) between plaster piers
    const SILL = 0.55;
    const HEAD = 3.7;
    const WW = 2.4;
    const wallX = -w / 2 - 0.125;
    const westWall: Xform[] = [
      { p: [wallX, SILL / 2, 0], s: [0.25, SILL, d] },
      { p: [wallX, (HEAD + h) / 2, 0], s: [0.25, h - HEAD, d] },
    ];
    const edges = [-d / 2, ...IGISORO_WEST_WINDOWS.flatMap((z) => [z - WW / 2, z + WW / 2]), d / 2];
    for (let i = 0; i < edges.length; i += 2) westWall.push({ p: [wallX, (SILL + HEAD) / 2, (edges[i]! + edges[i + 1]!) / 2], s: [0.25, HEAD - SILL, edges[i + 1]! - edges[i]!] });
    const westFrames: Xform[] = IGISORO_WEST_WINDOWS.flatMap((z) => [
      { p: [-w / 2 - 0.02, SILL + 0.03, z], s: [0.12, 0.06, WW] } as Xform,
      { p: [-w / 2 - 0.02, HEAD - 0.03, z], s: [0.12, 0.06, WW] } as Xform,
      { p: [-w / 2 - 0.02, (SILL + HEAD) / 2, z - WW / 2 + 0.03], s: [0.12, HEAD - SILL, 0.06] } as Xform,
      { p: [-w / 2 - 0.02, (SILL + HEAD) / 2, z + WW / 2 - 0.03], s: [0.12, HEAD - SILL, 0.06] } as Xform,
      { p: [-w / 2 - 0.02, (SILL + HEAD) / 2, z], s: [0.08, HEAD - SILL, 0.05] } as Xform,
      { p: [-w / 2 - 0.02, 2.85, z], s: [0.08, 0.05, WW] } as Xform,
    ]);
    // Agaseke niches either side of the entrance: oak shelves on the south wall with baskets
    const shelves: Xform[] = [];
    const agas: Xform[] = [];
    for (const sx of [-1, 1])
      for (const cx of [6.5, 10.5])
        for (const y of [1.15, 1.85]) {
          const x = sx * cx;
          shelves.push({ p: [x, y, d / 2 - 0.13], s: [2.4, 0.05, 0.26] });
          for (let k = 0; k < 3; k++) agas.push({ p: [x - 0.75 + k * 0.75, y + 0.025, d / 2 - 0.13], r: n(k + cx + y) * 6, s: 0.62 + n(k * 3 + cx + y * 7) * 0.3 });
        }
    // lounge: low timber coffee table with a basket
    agas.push({ p: [LG.x - 0.3, 0.41, LG.z - 0.1], s: 0.85 }, { p: [LG.x + 0.25, 0.41, LG.z - 0.05], s: 0.6 });
    const lounge: Xform[] = [
      { p: [LG.x, 0.385, LG.z - 0.1], s: [1.25, 0.05, 0.66] },
      { p: [LG.x - 0.5, 0.18, LG.z - 0.1], s: [0.08, 0.36, 0.5] },
      { p: [LG.x + 0.5, 0.18, LG.z - 0.1], s: [0.08, 0.36, 0.5] },
    ];
    return { beams, battens, well, skyBars, mats, imA, imB, fins, benchBase, benchSeat, benchBack, westWall, westFrames, shelves, agas, lounge };
  }, [tables, w, d, h, SKY.s, SKY.x, SKY.z, LG.x, LG.z]);

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
      ...tables.map((t) => ({ x: t.x, z: t.z, w: 2.3, d: 1.3, o: 1 })),
      ...layout.seats.map((s) => ({ x: s.x, z: s.z, w: 0.75, d: 0.75 })),
      { x: T.x, z: T.z, w: 4.6, d: 4.6 },
      { x: LG.x, z: LG.z - 1.45, w: 2.8, d: 1.3 },
      { x: 16.45, z: -0.6, w: 1.0, d: 19.4 },
    ],
    [tables, layout.seats, T.x, T.z, LG.x, LG.z],
  );

  const plaster = <meshStandardMaterial map={clayN.map} normalMap={clayN.normalMap} normalScale={smallN} color="#cdb99a" roughness={0.95} metalness={0} envMapIntensity={0.1} />;

  return (
    <group>
      {/* -------- lighting: one soft, nearly vertical key (even on every board), warm sky fill, diffuse daylight -------- */}
      <Environment resolution={32} frames={1} environmentIntensity={0.5}>
        <Lightformer intensity={1.1} position={[0, 4.6, 0]} rotation-x={Math.PI / 2} scale={[28, 20, 1]} color="#fff1dc" />
        <Lightformer intensity={1.3} position={[0, 2.4, -12.5]} scale={[32, 3.8, 1]} color="#e6edf2" />
        <Lightformer intensity={0.5} position={[0, 1.2, 0]} rotation-x={-Math.PI / 2} scale={[28, 20, 1]} color="#8a7560" />
      </Environment>
      <hemisphereLight args={["#fff3e2", "#6e5a46", lite ? 1.25 : 1.0]} />
      <directionalLight
        position={[1.4, 20, 2.4]}
        intensity={lite ? 1.3 : 1.4}
        color="#fff0da"
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
      {/* daylight from the north glazing and the west windows, diffused (no sun streaks) */}
      <directionalLight position={[0, 7, -30]} intensity={0.4} color="#e6eef6" />
      <directionalLight position={[-30, 6, 0]} intensity={0.22} color="#eef0ee" />

      {/* -------- shell -------- */}
      {/* large-format burnished clay tiles (terracotta relief, even warm tone), dead matte */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={floor} color="#c9b2a2" roughness={1} metalness={0} envMapIntensity={0.08} />
      </mesh>
      <Instanced geometry={matGeo} items={X.mats}>
        <meshStandardMaterial map={mat.map} normalMap={mat.normalMap} color="#b7a27a" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      {/* woven sisal ceiling between glulam beams and fine battens */}
      {ceil.map((c, i) => (
        <mesh key={i} position={[c.x, h, c.z]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[c.w, c.d]} />
          <meshStandardMaterial map={weave.map} color="#d6bf98" roughness={1} metalness={0} envMapIntensity={0.05} />
        </mesh>
      ))}
      <Instanced geometry={box} items={X.beams} receiveShadow={false}>
        <meshStandardMaterial map={timber.map} color="#a47b56" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.battens} receiveShadow={false}>
        <meshStandardMaterial color="#8d6845" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.well} receiveShadow={false}>
        <meshStandardMaterial map={timber.map} color="#9a7452" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      {/* skylight: opal diffuser (soft daylight, never the sun's disc), below the bloom threshold */}
      <mesh position={[SKY.x, h + 1.0, SKY.z]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SKY.s, SKY.s]} />
        <meshStandardMaterial color="#000000" emissive="#f4efe4" emissiveIntensity={0.7} roughness={1} />
      </mesh>
      <Instanced geometry={box} items={X.skyBars} receiveShadow={false}>
        <meshStandardMaterial color="#5a4330" roughness={0.9} metalness={0} />
      </Instanced>
      {/* east wall (plaster behind the feature wall) */}
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[d, h]} />
        <meshStandardMaterial map={clay.map} normalMap={clay.normalMap} normalScale={smallN} color="#cdb99a" roughness={0.95} metalness={0} envMapIntensity={0.1} />
      </mesh>
      <Instanced geometry={box} items={X.westWall}>
        {plaster}
      </Instanced>
      {/* west glazing: unlit low-reflection glass, oiled timber frames */}
      {IGISORO_WEST_WINDOWS.map((z) => (
        <mesh key={z} position={[-w / 2 - 0.06, 2.125, z]} rotation={[0, Math.PI / 2, 0]} renderOrder={2}>
          <planeGeometry args={[2.4, 3.15]} />
          <meshBasicMaterial color="#c9d6dc" transparent opacity={0.05} depthWrite={false} />
        </mesh>
      ))}
      <Instanced geometry={box} items={X.westFrames}>
        <meshStandardMaterial color="#5c4430" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <WindowWall w={w} d={d} h={h} sill={0.45} head={4.4} transom={3.1} bays={10} glassTint="#a9b8c0" glassOpacity={0.05} frameColor="#4a3828" matte>
        {plaster}
      </WindowWall>
      {/* sheer blinds lowered to the transom: the upper daylight comes in diffused, the view stays clear below */}
      <mesh position={[0, (3.13 + 4.37) / 2, -d / 2 + 0.07]} renderOrder={3}>
        <planeGeometry args={[w - 0.2, 4.37 - 3.13]} />
        <meshStandardMaterial color="#e2dbd0" emissive="#f6f0e6" emissiveIntensity={0.3} roughness={1} metalness={0} transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <SouthWall layout={layout}>{plaster}</SouthWall>
      {/* Imigongo frieze above the entrance */}
      <mesh position={[0, 3.6, d / 2 - 0.015]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w, 0.42]} />
        <meshStandardMaterial map={frieze} color="#d8cfc2" roughness={0.92} metalness={0} envMapIntensity={0.08} />
      </mesh>
      {/* matte lettering over the door, lit by the room (no neon) */}
      <Text font={FONT} fontSize={0.34} position={[0, 4.25, d / 2 - 0.02]} rotation={[0, Math.PI, 0]} anchorX="center" anchorY="middle" letterSpacing={0.14}>
        IGISORO COURT
        <meshStandardMaterial color="#3a2a1e" roughness={0.9} metalness={0} />
      </Text>

      {/* -------- Imigongo feature wall + spectator banquette (east) -------- */}
      <Instanced geometry={box} items={X.imA}>
        <meshStandardMaterial map={panels[0]} color="#d6cdc0" roughness={0.92} metalness={0} envMapIntensity={0.08} />
      </Instanced>
      <Instanced geometry={box} items={X.imB}>
        <meshStandardMaterial map={panels[1]} color="#d6cdc0" roughness={0.92} metalness={0} envMapIntensity={0.08} />
      </Instanced>
      <Instanced geometry={box} items={X.fins} castShadow={false}>
        <meshStandardMaterial map={timber.map} color="#8a6444" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.benchBase}>
        <meshStandardMaterial map={timber.map} color="#7a5a3e" roughness={0.9} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={box} items={X.benchSeat} castShadow={!lite}>
        <meshStandardMaterial color="#4a5361" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>
      <Instanced geometry={box} items={X.benchBack}>
        <meshStandardMaterial color="#8a4a34" roughness={1} metalness={0} envMapIntensity={0.05} />
      </Instanced>

      {/* -------- tables, pendants, status, highlight -------- */}
      <IgisoroTables layout={layout} status={st} lite={lite} />
      <TablePendants layout={layout} status={status} lite={lite} />
      <TableHighlight layout={layout} />
      {/* the soft, even pool each pair of shades lays on its table and mat (baked, additive, very low) */}
      <LightPools items={tables.map((t) => ({ x: t.x, z: t.z, w: 3.4, d: 3.0 }))} color="#ffe7c8" opacity={lite ? 0.12 : 0.08} y={0.012} />

      {/* -------- courtyard: planter, ring bench, tree, Hall of Masters -------- */}
      <mesh position={[T.x, 0.36, T.z]} castShadow={!lite} receiveShadow>
        <cylinderGeometry args={[T.r, T.r + 0.03, 0.72, 48]} />
        {plaster}
      </mesh>
      <mesh position={[T.x, 0.7, T.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[T.r - 0.06, 40]} />
        <meshStandardMaterial color="#3a2a1c" roughness={1} metalness={0} />
      </mesh>
      {/* built-in timber ring bench: spectators sit facing out to the tables */}
      <mesh position={[T.x, 0.42, T.z]} castShadow={!lite} receiveShadow>
        <cylinderGeometry args={[IGISORO_TREE_BENCH, IGISORO_TREE_BENCH, 0.06, 56, 1]} />
        <meshStandardMaterial map={timber.map} color="#b08660" roughness={0.88} metalness={0} envMapIntensity={0.12} />
      </mesh>
      <mesh position={[T.x, 0.2, T.z]}>
        <cylinderGeometry args={[IGISORO_TREE_BENCH - 0.12, IGISORO_TREE_BENCH - 0.12, 0.4, 56, 1, true]} />
        <meshStandardMaterial color="#5c4432" roughness={0.95} metalness={0} />
      </mesh>
      <CourtTree lite={lite} />
      <group position={[T.x, 1.12, T.z + T.r - 0.12]}>
        <mesh>
          <boxGeometry args={[1.2, 0.5, 0.05]} />
          <meshStandardMaterial map={timber.map} color="#5a3a24" roughness={0.9} metalness={0} />
        </mesh>
        <Text font={FONT} fontSize={0.1} position={[0, 0.12, 0.03]} color="#e8d3a2" anchorX="center">
          HALL OF MASTERS
        </Text>
        <Text font={FONT} fontSize={0.065} position={[0, -0.06, 0.03]} color="#e2d0b2" anchorX="center" maxWidth={1.1} textAlign="center">
          Top Igisoro players are carved here each season
        </Text>
      </group>

      {/* -------- spectator lounge (north glazing) -------- */}
      <mesh position={[LG.x, 0.008, LG.z - 0.6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.6, 3.6]} />
        <meshStandardMaterial map={mat.map} color="#8d6e52" roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      <GltfInstances url={model("sofa_02")} items={[{ p: [LG.x, 0, LG.z - 1.45], r: 0, s: 1.15 }]} castShadow={!lite} matOverride={matte} />
      <GltfInstances
        url={model("mid_century_lounge_chair")}
        items={[
          { p: [LG.x - 2.3, 0, LG.z], r: Math.PI / 2, s: 0.95 },
          { p: [LG.x + 2.3, 0, LG.z], r: -Math.PI / 2, s: 0.95 },
        ]}
        castShadow={!lite}
        matOverride={matte}
      />
      <Instanced geometry={box} items={X.lounge} castShadow={!lite}>
        <meshStandardMaterial map={timber.map} color="#8a6646" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>

      {/* -------- Agaseke niches by the door, plants -------- */}
      <Instanced geometry={box} items={X.shelves}>
        <meshStandardMaterial map={timber.map} color="#9a7452" roughness={0.88} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <Instanced geometry={agasekeGeo} items={X.agas} castShadow={!lite}>
        <meshStandardMaterial map={agaseke} roughness={0.92} metalness={0} envMapIntensity={0.1} />
      </Instanced>
      <GltfInstances
        url={model("potted_plant_02")}
        items={[
          { p: [-16.3, 0, -12.3], s: 1.6, r: 0.3 },
          { p: [16.3, 0, -12.3], s: 1.6, r: 2.0 },
          { p: [16.3, 0, 12.3], s: 1.5, r: 4.1 },
          { p: [-16.3, 0, 12.3], s: 1.5, r: 1.1 },
        ]}
        matOverride={matte}
      />
      {!lite && (
        <GltfInstances
          url={model("wicker_basket_01")}
          items={[
            { p: [LG.x - 1.7, 0, LG.z - 1.6], s: 1.4, r: 0.2 },
            { p: [LG.x + 1.7, 0, LG.z - 1.6], s: 1.4, r: 2.2 },
          ]}
          matOverride={matte}
        />
      )}
      <BlobShadows items={shadowBlobs} opacity={0.45} y={0.011} />
    </group>
  );
}
