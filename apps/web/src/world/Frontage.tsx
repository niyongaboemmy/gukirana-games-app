"use client";
import { useEffect, useMemo } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { GeoBatch } from "./geo";
import { worldMaterials, type Tier } from "./materials";
import { campusMaterials, foldPaint } from "./campus-materials";
import { NearOnly } from "./static-merge";
import { SITE } from "./campus-strings";
import { CampusProps } from "./campus-props";
import {
  BUS_STOP,
  compoundR,
  COMPOUND_SOUTH_X,
  FORECOURT,
  FRONTAGE_Z,
  GUARD_POSTS,
  PARKING,
  PARKING_BAYS,
  MOTO_BAYS,
  PUBLIC_ROAD,
  roadPoint,
  roadY,
  SERVICE_GATE,
  WALL_H,
  WALL_RUNS,
  type P,
} from "./campus";

/**
 * The campus frontage (P2-WLD-12, docs/CAMPUS-MASTER-PLAN.md §3.1): the boundary wall with the arrival gate's
 * forecourt opening, the drop-off lane, guard posts and barrier arms, the car parks, the public road "Musanze Road"
 * with its footpaths, kerbs, markings, zebra crossing and bus shelter, and the compound wall round the north arc.
 * Static parts are authored as primitives in world metres (GeoBatch) and drawn under the outdoor StaticMerge, so they
 * fold into the world's existing looks (lava, limestone, steel, concrete, granite …) plus three road looks.
 */

const FONT = "/fonts/Baloo2.ttf";
/** flat parts that never cast a shadow (one more shadow-pass draw each for nothing seen) */
const FLAT = new Set(["asphaltC", "paintW", "granite", "basalt"]);

/** A flat quad (corners in order, world xz) at height y, world-metre UVs. */
function quad(b: GeoBatch, key: string, pts: P[], y: number, tile: number) {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const tri = [0, 1, 2, 0, 2, 3];
  for (const i of tri) pos.push(pts[i]!.x, y, pts[i]!.z);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
  g.computeVertexNormals();
  // make sure the face points up
  if (g.getAttribute("normal").getY(0) < 0) {
    const flip = [0, 2, 1, 0, 3, 2];
    const p2: number[] = [];
    for (const i of flip) p2.push(pts[i]!.x, y, pts[i]!.z);
    g.setAttribute("position", new THREE.Float32BufferAttribute(p2, 3));
    g.computeVertexNormals();
  }
  b.add(key, g, { tile });
}

/** A strip along the public road from x0 to x1 between z0 and z1 (as offsets across the road: the strip follows the
 *  road's bend east of the campus and its height profile). */
function roadStrip(b: GeoBatch, key: string, x0: number, x1: number, z0: number, z1: number, dy: number, tile: number) {
  const mid = PUBLIC_ROAD.mid;
  for (let x = x0; x < x1 - 1e-6; ) {
    const step = x > 140 ? 3 : 8;
    const xb = Math.min(x1, x + step);
    const a0 = roadPoint(x, z0 - mid);
    const a1 = roadPoint(x, z1 - mid);
    const b0 = roadPoint(xb, z0 - mid);
    const b1 = roadPoint(xb, z1 - mid);
    const ya = roadY(x) + dy;
    const yb = roadY(xb) + dy;
    x = xb;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([a0.x, ya, a0.z, a1.x, ya, a1.z, b1.x, yb, b1.z, a0.x, ya, a0.z, b1.x, yb, b1.z, b0.x, yb, b0.z], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
    g.computeVertexNormals();
    b.add(key, g, { tile });
  }
}

/** Segments [a, b] of [lo, hi] outside the given gaps. */
function spans(lo: number, hi: number, gaps: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [g0, g1] of gaps)
    out = out.flatMap(([a, c]): [number, number][] => (g1 <= a || g0 >= c ? [[a, c]] : [...(g0 > a ? [[a, g0] as [number, number]] : []), ...(g1 < c ? [[g1, c] as [number, number]] : [])]));
  return out.filter(([a, c]) => c - a > 0.2);
}

/** Raised footpath slab with its kerb on the carriageway side (`kerbZ`). */
function footpath(b: GeoBatch, x0: number, x1: number, z0: number, z1: number, kerbZ: number) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  b.box("granite", len, 0.16, z1 - z0, { p: [cx, 0.04, (z0 + z1) / 2], tile: 2.4 });
  b.box("concrete", len - 0.02, 0.2, 0.17, { p: [cx, 0.06, kerbZ], tile: 2 }); // 1 cm short of the slab ends, 5 mm proud of its edge
}

function guardBooth(b: GeoBatch, x: number, z: number) {
  b.frame([x, 0, z], 0, () => {
    b.box("lava", 2.6, 0.4, 2.4, { p: [0, 0.2, 0], tile: 1.2 });
    b.box("glassCool", 2.4, 2.1, 0.08, { p: [0, 1.45, 1.15], tile: 6 });
    for (const s of [-1, 1]) b.box("glassCool", 0.08, 2.1, 2.3, { p: [s * 1.2, 1.45, 0], tile: 6 });
    b.box("wood", 2.4, 2.1, 0.08, { p: [0, 1.45, -1.15], tile: 1 });
    b.box("wood", 3.2, 0.22, 3.0, { p: [0, 2.62, 0], tile: 1 });
    b.box("white", 1.8, 0.8, 0.45, { p: [0, 0.8, 0.55] });
  });
}

/** Barrier arm across a link road (post on the booth side, red-and-white boom down). */
function barrier(b: GeoBatch, x: number, z: number, dir: number) {
  b.box("steel", 0.3, 1.1, 0.3, { p: [x, 0.55, z] });
  b.box("white", 0.4, 0.3, 0.34, { p: [x, 1.05, z] });
  const len = 6.2;
  b.box("white", len, 0.09, 0.09, { p: [x + dir * (len / 2), 1.0, z] });
  for (let k = 1; k < 6; k += 2) b.box("led-red", 0.5, 0.11, 0.11, { p: [x + dir * (k + 0.3), 1.0, z] });
  b.box("steel", 0.08, 0.95, 0.08, { p: [x + dir * (len - 0.1), 0.48, z] });
}

export function buildFrontage(tier: Tier): Map<string, THREE.BufferGeometry> {
  const b = new GeoBatch();
  const R = PUBLIC_ROAD;
  const L = FORECOURT.layby;
  const lite = tier === "lite";

  /* ---------- public road ---------- */
  roadStrip(b, "asphaltC", R.x0, R.x1, R.c0, R.c1, 0.012, 4);
  // gravel shoulders where the footpaths end (out in the farmland)
  for (const [a, c] of [
    [R.x0, -200],
    [200, R.x1],
  ] as const) {
    roadStrip(b, "basalt", a, c, R.z0 + 0.3, R.c0, 0.006, 2.4);
    roadStrip(b, "basalt", a, c, R.c1, R.z1 - 0.3, 0.006, 2.4);
  }
  // markings: dashed centre line (solid by the crossing and the junctions), edge lines, zebra crossing
  const cz = R.mid;
  for (let x = R.x0; x < R.x1; x += 9) {
    const solid = Math.abs(x) < 30;
    roadStrip(b, "paintW", x, x + (solid ? 9 : 3), cz - 0.06, cz + 0.06, 0.02, 4);
  }
  const zebra = FORECOURT.crossing;
  for (const [z0, z1] of [
    [R.c0 + 0.12, R.c0 + 0.24],
    [R.c1 - 0.24, R.c1 - 0.12],
  ] as const)
    for (const [a, c] of spans(-200, 200, [
      [-zebra.hw - 0.6, zebra.hw + 0.6],
      ...(z0 < cz ? ([[L.x1 + 1, L.x1 + L.taper + 4], [-L.x1 - L.taper - 4, -L.x1 - 1], [SERVICE_GATE.x - SERVICE_GATE.hw - 1, SERVICE_GATE.x + SERVICE_GATE.hw + 1]] as [number, number][]) : ([[-68.5, -59.5], [-266.5, -257.5]] as [number, number][])),
    ]))
      roadStrip(b, "paintW", a, c, z0, z1, 0.02, 4);
  for (let z = R.c0 + 0.35; z < R.c1 - 0.3; z += 1.0) b.box("paintW", zebra.hw * 2, 0.01, 0.5, { p: [zebra.x, 0.022, z + 0.25], tile: 4 });
  // the zebra continues across the drop-off lane
  for (let z = L.z0 + 0.3; z < L.z1 - 0.3; z += 1.0) b.box("paintW", zebra.hw * 2, 0.01, 0.5, { p: [zebra.x, 0.022, z + 0.25], tile: 4 });
  // manholes on the crown, gully grates at the kerbs
  for (let x = -180; x <= 180; x += 47) b.add("steel", new THREE.CircleGeometry(0.34, 14).rotateX(-Math.PI / 2), { p: [x + 11, 0.024, cz + 1.6] });
  for (let x = -195; x <= 195; x += 25) {
    if (Math.abs(x) > L.x1 + L.taper + 4 || Math.abs(x) < L.x1 - 1) b.box("steel", 0.8, 0.01, 0.35, { p: [x, 0.02, R.c0 + 0.25] });
    b.box("steel", 0.8, 0.01, 0.35, { p: [x + 12, 0.02, R.c1 - 0.25] });
  }
  // footpaths and kerbs (gaps where the drop-off lane, the service gate and the country road junctions meet the road)
  for (const [a, c] of spans(-200, 200, [
    [L.x1 + 1, L.x1 + L.taper + 4],
    [-L.x1 - L.taper - 4, -L.x1 - 1],
    [SERVICE_GATE.x - SERVICE_GATE.hw, SERVICE_GATE.x + SERVICE_GATE.hw],
  ]))
    footpath(b, a, c, R.z0, R.c0, R.c0 - 0.08);
  for (const [a, c] of spans(-200, 200, [[-68.5, -59.5]])) footpath(b, a, c, R.c1, R.z1, R.c1 + 0.08);

  /* ---------- forecourt: drop-off lane, island, guard posts, barrier arms, sign ---------- */
  b.box("asphaltC", L.x1 - L.x0, 0.02, L.z1 - L.z0, { p: [(L.x0 + L.x1) / 2, 0.006, (L.z0 + L.z1) / 2], tile: 4 });
  for (const s of [-1, 1]) {
    const t = L.taper;
    quad(b, "asphaltC", [{ x: s * L.x1, z: L.z0 }, { x: s * (L.x1 + t + 3), z: R.c0 }, { x: s * (L.x1 + 4), z: R.c0 }, { x: s * L.x1, z: L.z1 }], 0.008, 4);
  }
  // drop-off bay marks along the lane (white T-marks every 6 m), "keep clear" yellow line by the crossing
  for (let x = -36; x <= 36; x += 6) if (Math.abs(x) > 4) b.box("paintW", 0.12, 0.01, 1.4, { p: [x, 0.02, L.z1 - 0.8], tile: 4 });
  b.box("paintW", L.x1 * 2 - 6, 0.01, 0.1, { p: [0, 0.02, L.z1 - 0.2], tile: 4 });
  b.box("paintW", 8, 0.01, 0.1, { p: [0, 0.02, L.z0 + 0.25], tile: 4 });
  // kerbed island between the lane and the road's footpath, low clipped planting
  for (const [a, c] of spans(-L.x1 - 1, L.x1 + 1, [[-zebra.hw, zebra.hw]])) {
    b.box("concrete", c - a, 0.18, FORECOURT.island.z1 - FORECOURT.island.z0, { p: [(a + c) / 2, 0.05, (FORECOURT.island.z0 + FORECOURT.island.z1) / 2], tile: 2 });
    if (c - a > 3) b.box("hedge", c - a - 1.2, 0.42, 0.55, { p: [(a + c) / 2, 0.35, (FORECOURT.island.z0 + FORECOURT.island.z1) / 2] });
  }
  // the lane's north kerb along the forecourt (the wall line), drop kerb at the pedestrian gate
  for (const [a, c] of spans(-FORECOURT.openingHw, FORECOURT.openingHw, [
    [-FORECOURT.walk.hw, FORECOURT.walk.hw],
    [FORECOURT.links[0] - FORECOURT.linkHw, FORECOURT.links[0] + FORECOURT.linkHw],
    [FORECOURT.links[1] - FORECOURT.linkHw, FORECOURT.links[1] + FORECOURT.linkHw],
  ]))
    b.box("concrete", c - a, 0.2, 0.2, { p: [(a + c) / 2, 0.06, L.z0 - 0.1], tile: 2 });
  for (const g of GUARD_POSTS) guardBooth(b, g.x, g.z);
  FORECOURT.links.forEach((x) => barrier(b, x + Math.sign(x) * FORECOURT.linkHw + Math.sign(x) * 0.2, FORECOURT.barrierZ, -Math.sign(x)));
  // planted beds either side of the pedestrian gate (behind them: the gate sign on the west, a hedge bed on the east)
  for (const s of [-1, 1]) {
    b.box("lava", 12, 0.45, 2.4, { p: [s * 16.4, 0.22, 77.9], tile: 1.2 });
    b.box("hedge", 11.4, 0.7, 1.9, { p: [s * 16.4, 0.75, 77.9] });
  }
  // the lit gate sign: lava plinth, honed limestone panel, a slim warm LED line under the lettering (Text below)
  b.box("lava", 13, 0.6, 1.3, { p: [-16.4, 0.3, 79.3], tile: 1.2 });
  b.box("limestone", 12.2, 1.8, 0.5, { p: [-16.4, 1.5, 79.3], tile: 1.6 });
  b.box("led-warm", 11.6, 0.03, 0.03, { p: [-16.4, 0.72, 79.57] });
  // forecourt wall piers either side of the opening
  for (const s of [-1, 1]) {
    b.box("lava", 1.1, 2.7, 1.1, { p: [s * FORECOURT.openingHw, 1.35, FRONTAGE_Z], tile: 1.2 });
    b.box("concrete", 1.3, 0.12, 1.3, { p: [s * FORECOURT.openingHw, 2.76, FRONTAGE_Z], tile: 2 });
  }

  /* ---------- boundary wall: south line (lava base, rendered wall, steel railing) and the north arc ---------- */
  for (const run of WALL_RUNS) {
    const len = run.x1 - run.x0;
    const cx = (run.x0 + run.x1) / 2;
    b.box("lava", len, 0.6, 0.55, { p: [cx, 0.3, FRONTAGE_Z], tile: 1.2 });
    b.box("limestone", len, 0.9, 0.4, { p: [cx, 1.05, FRONTAGE_Z], tile: 1.6 });
    b.box("concrete", len, 0.08, 0.5, { p: [cx, 1.54, FRONTAGE_Z], tile: 2 });
    b.box("steel", len, 0.05, 0.05, { p: [cx, WALL_H - 0.08, FRONTAGE_Z] });
    b.box("steel", len, 0.05, 0.05, { p: [cx, 1.68, FRONTAGE_Z] });
    const step = lite ? 0.36 : 0.2;
    for (let x = run.x0 + 0.1; x < run.x1; x += step) b.box("steel", 0.025, WALL_H - 1.58, 0.025, { p: [x, (WALL_H + 1.58) / 2, FRONTAGE_Z] });
    for (let x = run.x0; x <= run.x1 + 0.01; x += len / Math.max(1, Math.round(len / 2.6))) b.box("lava", 0.5, WALL_H + 0.1, 0.55, { p: [x, (WALL_H + 0.1) / 2, FRONTAGE_Z], tile: 1.2 });
  }
  // hedged verge outside the wall where no drop-off lane runs
  for (const s of [-1, 1])
    for (let x = L.x1 + L.taper + 6; x < COMPOUND_SOUTH_X - 3; x += 7)
      if (Math.abs(x - SERVICE_GATE.x) > SERVICE_GATE.hw + 3 || s < 0) b.box("hedge", 6, 0.9, 1.1, { p: [s * (x + 3), 0.45, FRONTAGE_Z + 1.2] });
  // the service gate: a sliding steel gate half open behind the wall, its link to the road
  {
    const g = SERVICE_GATE;
    b.box("asphaltC", g.hw * 2, 0.02, R.c0 - 73, { p: [g.x, 0.006, (R.c0 + 73) / 2], tile: 4 });
    for (const s of [-1, 1]) b.box("lava", 0.84, 2.6, 0.84, { p: [g.x + s * (g.hw + 0.4), 1.3, FRONTAGE_Z], tile: 1.2 }); // the wall runs end 2 cm inside
    b.box("steel", g.hw * 2, 0.08, 0.08, { p: [g.x + g.hw * 0.9, 1.9, FRONTAGE_Z - 0.6] });
    b.box("steel", g.hw * 2, 0.08, 0.08, { p: [g.x + g.hw * 0.9, 0.25, FRONTAGE_Z - 0.6] });
    for (let x = 0; x <= g.hw * 2; x += 0.24) b.box("steel", 0.03, 1.65, 0.03, { p: [g.x - g.hw * 0.1 + x, 1.08, FRONTAGE_Z - 0.6] });
  }
  // the compound wall round the north arc (rendered, lava base, coping), chord segments ≤ 4 m
  {
    const corner = (Math.atan2(COMPOUND_SOUTH_X, -FRONTAGE_Z) * 180) / Math.PI;
    let prev: P | null = null;
    for (let deg = -corner; deg <= corner + 1e-6; deg += 0.25) {
      const r = compoundR(deg);
      const a = (deg * Math.PI) / 180;
      const q = { x: Math.sin(a) * r, z: -Math.cos(a) * r };
      if (prev) {
        const len = Math.hypot(q.x - prev.x, q.z - prev.z);
        if (len < 3.4 && deg < corner - 1e-6) continue;
        const m = { x: (q.x + prev.x) / 2, z: (q.z + prev.z) / 2 };
        const rot = -Math.atan2(q.z - prev.z, q.x - prev.x);
        b.box("lava", len + 0.05, 0.6, 0.55, { p: [m.x, 0.3, m.z], r: [0, rot, 0], tile: 1.2 });
        b.box("limestone", len + 0.05, 1.4, 0.4, { p: [m.x, 1.3, m.z], r: [0, rot, 0], tile: 1.6 });
        b.box("concrete", len + 0.1, 0.08, 0.5, { p: [m.x, 2.04, m.z], r: [0, rot, 0], tile: 2 });
      }
      prev = q;
    }
  }

  /* ---------- car parks: bay lines, planter islands, motorbike row ---------- */
  for (const bay of PARKING_BAYS) {
    const row = bay.rotY ? PARKING.rows[0] : PARKING.rows[1];
    const d = row.z1 - row.z0;
    if (bay.tree) {
      b.box("lava", PARKING.bay - 0.3, 0.4, d - 0.6, { p: [bay.x, 0.2, bay.z], tile: 1.2 });
      b.box("hedge", PARKING.bay - 0.7, 0.35, d - 1.0, { p: [bay.x, 0.5, bay.z] });
    }
    // the line on the bay's +x side (and the first bay's −x side)
    for (const sx of [-1, 1]) {
      const x = bay.x + (sx * PARKING.bay) / 2;
      b.box("paintW", 0.1, 0.01, d - 0.3, { p: [x, 0.022, bay.z + (bay.rotY ? 0.15 : -0.15)], tile: 4 });
    }
  }
  for (const bay of MOTO_BAYS) b.box("paintW", 0.08, 0.01, 2.2, { p: [bay.x + 0.55, 0.022, bay.z], tile: 4 });
  // P signs at the car park entrances
  for (const s of [-1, 1]) {
    b.cyl("steel", 0.04, 0.04, 2.6, 6, { p: [s * (PARKING.x0 - 1), 1.3, PARKING.rows[0].z0 - 0.8] });
    b.box("led-sky", 0.6, 0.6, 0.04, { p: [s * (PARKING.x0 - 1), 2.5, PARKING.rows[0].z0 - 0.78] });
  }

  /* ---------- bus shelter across the road ---------- */
  {
    const s = BUS_STOP;
    b.box("granite", s.w + 1.4, 0.16, s.d + 0.6, { p: [s.x, 0.04, s.z + 0.1], tile: 2.4 });
    for (const dx of [-s.w / 2 + 0.2, s.w / 2 - 0.2]) for (const dz of [-s.d / 2 + 0.25, s.d / 2 - 0.15]) b.box("steel", 0.08, 2.5, 0.08, { p: [s.x + dx, 1.33, s.z + dz] });
    b.box("alu", s.w + 0.3, 0.1, s.d + 0.5, { p: [s.x, 2.62, s.z], r: [0.06, 0, 0] });
    b.box("glassClear", s.w - 0.4, 1.9, 0.04, { p: [s.x, 1.13, s.z + s.d / 2 - 0.12] });
    b.box("woodDark", s.w - 1.6, 0.06, 0.42, { p: [s.x, 0.55, s.z + s.d / 2 - 0.45], tile: 1 });
    b.box("steel", 0.06, 0.45, 0.06, { p: [s.x - 2, 0.32, s.z + s.d / 2 - 0.45] });
    b.box("steel", 0.06, 0.45, 0.06, { p: [s.x + 2, 0.32, s.z + s.d / 2 - 0.45] });
    // the bus stop sign by the kerb
    b.cyl("steel", 0.045, 0.045, 2.8, 8, { p: [s.x - s.w / 2 - 1.2, 1.4 + 0.08, R.c1 + 0.5] });
    b.box("screenFrame", 0.62, 0.62, 0.05, { p: [s.x - s.w / 2 - 1.2, 2.6, R.c1 + 0.5] });
  }
  return foldPaint(b.build());
}

export function Frontage({ tier }: { tier: Tier }) {
  const geos = useMemo(() => buildFrontage(tier), [tier]);
  const mats = useMemo(() => ({ ...worldMaterials(tier), ...campusMaterials(tier) }), [tier]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  const busSign = { x: BUS_STOP.x - BUS_STOP.w / 2 - 1.2, z: PUBLIC_ROAD.c1 + 0.5 };
  return (
    <group name="frontage">
      {[...geos.entries()].map(([key, g]) => {
        const m = mats[key];
        if (!m) return null;
        const unlit = m instanceof THREE.MeshBasicMaterial;
        return <mesh key={key} geometry={g} material={m} castShadow={!unlit && !m.transparent && !FLAT.has(key) && tier !== "lite"} receiveShadow={!unlit && tier !== "lite"} />;
      })}
      {/* lit lettering on the gate sign, readable from the road and the forecourt (drawn within 30 m) */}
      <NearOnly max={30} position={[-16.4, 0, 79.56]}>
        <Text font={FONT} fontSize={0.62} position={[0, 1.72, 0]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
          {SITE.gateSign}
          <meshBasicMaterial color={new THREE.Color("#fff6e2").multiplyScalar(1.15)} toneMapped={false} />
        </Text>
        <Text font={FONT} fontSize={0.3} position={[0, 1.0, 0]} anchorX="center" anchorY="middle" letterSpacing={0.3} color="#3a3530">
          {SITE.gateSub}
        </Text>
      </NearOnly>
      <NearOnly max={45} position={[busSign.x, 0, busSign.z - 0.03]} rotation={[0, Math.PI, 0]}>
        <Text font={FONT} fontSize={0.3} position={[0, 2.6, 0]} anchorX="center" anchorY="middle" color="#ffffff">
          {SITE.busStop}
        </Text>
      </NearOnly>
      <CampusProps tier={tier} />
    </group>
  );
}
