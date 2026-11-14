"use client";
import { Suspense, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mistTexture, rng } from "./textures";
import type { Tier } from "./materials";
import { InstancedSpecies, type Placement } from "./Vegetation";
import { Flowers } from "./Flowers";
import { sessionMemo } from "./session-cache";
import { BitmapTextureLoader } from "./bitmap-texture";
import { COMPOUND_R } from "./layout";
import { campusOutside, PUBLIC_ROAD, roadY } from "./campus";
import { mistUniform } from "./activities";
import { buildCountryside, countrysideMask, polyDist, type Countryside } from "./countryside";
import { terrainMaterial } from "./terrain-shader";

/** How far the compound (and so the farmland) moved out from the first 88 m layout (P1-WLD-03). */
const GROW = COMPOUND_R - 88;

/**
 * Northern Rwanda backdrop (Musanze, at the foot of Volcanoes National Park), built procedurally:
 *  - terraced farmland hills with field patches (vertex colours, one draw call),
 *  - the Virunga chain on the northern skyline: Karisimbi, Bisoke (crater lake), Sabyinyo (jagged "teeth"),
 *    Gahinga and Muhabura (near-perfect cone), with altitude vegetation bands (farmland → bamboo → montane
 *    forest → Hagenia/heath → bare summit) and atmospheric perspective from exponential fog,
 *  - the Twin Lakes (Burera higher, Ruhondo lower) in the eastern valleys,
 *  - morning mist layers and cloud caps, eucalyptus woodlots, bamboo groves and iron-roofed farmhouses.
 * Scale: horizontal distances are compressed (~25 km → ~650 m) and heights keep a slightly exaggerated angular size
 * so the skyline reads like the real view from Musanze. See docs/WORLD-ARENA-DESIGN.md §4.
 */

/* ---------------- noise ---------------- */
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return s / (1 - Math.pow(0.5, oct));
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------------- lakes ---------------- */
interface Lake {
  name: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  level: number;
}
const az = (deg: number, d: number) => ({ x: Math.sin((deg * Math.PI) / 180) * d, z: -Math.cos((deg * Math.PI) / 180) * d });
/** Burera sits ~100 m above Ruhondo in reality; here Burera is the further, higher lake. */
export const LAKES: Lake[] = [
  { name: "Ruhondo", ...az(102, 250 + GROW), rx: 95, rz: 34, rot: 0.25, level: 1.2 },
  { name: "Burera", ...az(70, 400 + GROW), rx: 150, rz: 48, rot: -0.35, level: 7.5 },
];
function lakeDist(l: Lake, x: number, z: number): number {
  const dx = x - l.x;
  const dz = z - l.z;
  const c = Math.cos(l.rot);
  const s = Math.sin(l.rot);
  const u = (dx * c - dz * s) / l.rx;
  const v = (dx * s + dz * c) / l.rz;
  const wobble = 0.18 * (fbm(x * 0.02, z * 0.02, 2) - 0.5);
  return Math.hypot(u, v) + wobble;
}

/* ---------------- terrain ---------------- */
const TERRACE = 2.2;
/** Height of the farmland terrain (metres). Flat district up to the compound edge, hills beyond; low plain towards the volcanoes. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // flat inside the campus (compound + frontage, world/campus.ts), hills beyond; the public road keeps its own
  // gentle profile through the hills (roadCorridor)
  const ramp = smooth(0, 87, campusOutside(x, z, 1));
  const road = roadCorridor(z);
  if (ramp <= 0 && road >= 1) return -0.06;
  let h = 0;
  if (ramp > 0) {
    const north = smooth(0.15, 0.7, -z / Math.max(r, 1));
    const amp = lerp(30, 6, north);
    h = fbm(x * 0.0055 + 7, z * 0.0055 - 3) * amp + fbm(x * 0.022, z * 0.022, 2) * 5;
    h += smooth(500, 1100, r) * (1 - north) * 40; // far southern ridges close the horizon
    const t = h / TERRACE;
    const terr = (Math.floor(t) + smooth(0.72, 1, t - Math.floor(t))) * TERRACE;
    h = lerp(h, terr, 0.62 * (1 - smooth(380, 620, r))) * ramp;
  }
  h = lerp(roadY(x), h, road);
  for (const l of LAKES) {
    const d = lakeDist(l, x, z);
    if (d < 1.4) h = lerp(l.level - 5, Math.max(h, l.level + 1.5), smooth(0.92, 1.4, d));
  }
  return h - 0.06;
}

/** 0 on the public road and its cuttings (the terrain takes the road's profile), 1 from 26 m off its centre line. */
const roadCorridor = (z: number) => smooth(7, 26, Math.abs(z - PUBLIC_ROAD.mid));
/** 0 on the road's grass verges (no field colour or detail there), 1 beyond. */
const roadVerge = (z: number) => smooth(5.5, 8, Math.abs(z - PUBLIC_ROAD.mid));

const FIELD_COLORS = ["#5f9d3c", "#86ad45", "#3f7b35", "#6e9f46", "#9cb455", "#4f8a3a", "#6b4b33", "#a39a52"].map((c) => new THREE.Color(c));

const PLOT = 27; // mean plot size (m): jittered Voronoi cells give irregular 15–40 m fields
const _lawn = new THREE.Color();
const _c2 = new THREE.Color();
const HEDGE = new THREE.Color("#3e5e2c");

/** Colour of the irregular field plot at (x, z), softly blended into its neighbour over the last 3–6 m. */
function plotColor(x: number, z: number, out: THREE.Color) {
  // warp the lookup so plot edges wander like real field boundaries
  const wx = x + (fbm(x * 0.018 + 3.1, z * 0.018, 2) - 0.5) * 14;
  const wz = z + (fbm(x * 0.018, z * 0.018 + 8.7, 2) - 0.5) * 14;
  const ci = Math.floor(wx / PLOT);
  const cj = Math.floor(wz / PLOT);
  let d1 = 1e9;
  let d2 = 1e9;
  let k1 = 0;
  let k2 = 0;
  for (let j = cj - 1; j <= cj + 1; j++)
    for (let i = ci - 1; i <= ci + 1; i++) {
      const px = (i + 0.15 + hash(i, j * 3 + 1) * 0.7) * PLOT;
      const pz = (j + 0.15 + hash(i * 5 + 2, j) * 0.7) * PLOT;
      const d = Math.hypot(wx - px, wz - pz);
      const k = Math.floor(hash(i * 13 + 7, j * 17 + 3) * FIELD_COLORS.length);
      if (d < d1) {
        d2 = d1;
        k2 = k1;
        d1 = d;
        k1 = k;
      } else if (d < d2) {
        d2 = d;
        k2 = k;
      }
    }
  const edge = (d2 - d1) / 2; // distance to the plot boundary
  const soft = 3 + hash(ci, cj) * 3;
  out.copy(FIELD_COLORS[k1] ?? FIELD_COLORS[0]!);
  if (edge < soft) {
    _c2.copy(FIELD_COLORS[k2] ?? FIELD_COLORS[0]!);
    out.lerp(_c2, 0.5 * (1 - edge / soft));
    // boundary paths / grass strips between plots
    out.lerp(HEDGE, 0.35 * (1 - smooth(0, 1.6, edge)));
  }
}

function terrainColor(x: number, z: number, h: number, out: THREE.Color) {
  const r = Math.hypot(x, z);
  const edge = campusOutside(x, z);
  _lawn.set("#5b9442").lerp(_c2.set("#73a650"), fbm(x * 0.05, z * 0.05, 2));
  if (edge <= 0) {
    out.copy(_lawn);
    return;
  }
  for (const l of LAKES) {
    const d = lakeDist(l, x, z);
    if (d < 1.6) {
      // lake bed silt under the water, then a marshy papyrus fringe softly into the fields (no hard ring)
      if (h < l.level + 0.6) {
        out.set("#55695c"); // shallows: the bed seen through the feathered water edge
        return;
      }
      plotColor(x, z, out);
      out.lerp(_c2.set("#4c6a32"), 1 - smooth(1.2, 1.6, d));
      return;
    }
  }
  plotColor(x, z, out);
  const band = Math.floor((h + 0.06) / TERRACE);
  const f = (h + 0.06) / TERRACE - band;
  if (f > 0.7 && r < 600) out.multiplyScalar(lerp(0.78, 1, smooth(380, 600, r))); // terrace riser shadow line
  out.lerp(_c2.set("#3e6b30"), 0.25 * fbm(x * 0.03, z * 0.03, 2));
  // the compound lawn runs out softly into the farmland (no hard seam behind the gate)
  out.lerp(_lawn, 1 - smooth(0, 30, edge) * roadVerge(z));
}

/** How much of the shader's field / terrace detail a terrain vertex gets: 0 on the campus lawn and the lake shores,
 *  1 out in the farmland (Landscape terrain material). */
function farmWeight(x: number, z: number, h: number): number {
  let w = smooth(0, 30, campusOutside(x, z)) * roadVerge(z);
  for (const l of LAKES) {
    const d = lakeDist(l, x, z);
    if (d < 1.6) w *= h < l.level + 0.6 ? 0 : smooth(1.2, 1.6, d);
  }
  return w;
}

function buildTerrain(tier: Tier): THREE.BufferGeometry {
  // (GAP-008: 448 × ~157 rings = 140k triangles in every plaza frame; the field colours are tens of metres across and
  // the ground near you is the paved plaza, so 256 × ~118 rings (≈ 60k) keeps the look)
  const segs = tier === "lite" ? 128 : 256;
  const radii: number[] = [];
  for (let r = 30; r < 1500; r += Math.max(tier === "lite" ? 4 : 2.2, r * (tier === "lite" ? 0.06 : 0.032))) radii.push(r);
  radii.push(1500);
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const farm: number[] = [];
  const c = new THREE.Color();
  for (const r of radii)
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const h = terrainHeight(x, z);
      pos.push(x, h, z);
      terrainColor(x, z, h, c);
      col.push(c.r, c.g, c.b);
      farm.push(farmWeight(x, z, h));
      uv.push(x / 6, z / 6);
    }
  const idx: number[] = [];
  const row = segs + 1;
  for (let j = 0; j < radii.length - 1; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * row + i;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aFarm", new THREE.Float32BufferAttribute(farm, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------- volcanoes ---------------- */
interface Volcano {
  name: string;
  az: number;
  dist: number;
  h: number; // relief above the plain (scaled)
  r: number; // base radius
  p: number; // profile exponent (1 = straight cone, higher = more concave)
  crater?: number; // crater radius as a fraction of r
  teeth?: boolean;
  elong?: number;
}
/** Real summits: Karisimbi 4,507 m · Muhabura 4,127 m · Bisoke 3,711 m · Sabyinyo 3,674 m · Gahinga 3,474 m (plain ≈ 1,850 m). */
export const VOLCANOES: Volcano[] = [
  // pushed back to ~1.7–2.3 km (inside the sky dome) and kept to the real 5–8° of elevation seen from Musanze
  // azimuths frame the open sight-lines either side of the arena drum (Bisoke ≈ −22°, Muhabura ≈ +22°)
  { name: "Karisimbi", az: -46, dist: 2250, h: 420, r: 1750, p: 1.55 },
  { name: "Bisoke", az: -23, dist: 1900, h: 300, r: 1150, p: 1.35, crater: 0.05 },
  { name: "Sabyinyo", az: -6, dist: 1800, h: 275, r: 1100, p: 1.5, teeth: true, elong: 1.3 },
  { name: "Gahinga", az: 9, dist: 1700, h: 230, r: 900, p: 1.3, crater: 0.04 },
  { name: "Muhabura", az: 22, dist: 2000, h: 385, r: 1300, p: 1.12 },
];

const BAND = {
  farm: new THREE.Color("#66884a"),
  bamboo: new THREE.Color("#71874a"),
  forest: new THREE.Color("#3c4f3a"),
  heath: new THREE.Color("#5f5e4c"),
  rock: new THREE.Color("#47443f"),
};

function volcanoHeight(v: Volcano, lx: number, lz: number): number {
  const u = Math.hypot(lx / (v.elong ?? 1), lz) / v.r;
  if (u >= 1) return 0;
  const a = Math.atan2(lz, lx);
  let h = v.h * Math.pow(1 - u, v.p);
  // rounded summit
  h -= v.h * 0.06 * Math.exp(-u * u * 900);
  // erosion gullies, stronger low on the flanks
  h *= 1 - 0.045 * Math.pow(Math.abs(Math.sin(a * 11 + fbm(lx * 0.01, lz * 0.01, 2) * 6)), 3) * smooth(0.05, 0.6, u);
  h += (fbm(lx * 0.02, lz * 0.02, 3) - 0.5) * v.h * 0.05 * (1 - u);
  if (v.crater) {
    const c = v.crater;
    if (u < c * 1.6) h -= v.h * 0.085 * (1 - smooth(c * 0.5, c * 1.25, u));
  }
  if (v.teeth) {
    // Sabyinyo ("old man's teeth"): a ridge of jagged peaks along the long axis
    for (const [tx, th] of [
      [-0.32, 0.12],
      [-0.12, 0.2],
      [0.05, 0.26],
      [0.2, 0.16],
      [0.34, 0.1],
    ] as const) {
      const dx = lx / v.r - tx;
      const dz = lz / v.r;
      h += v.h * th * Math.exp(-(dx * dx) * 260 - dz * dz * 160);
    }
  }
  return h;
}

/** Ridged multi-octave noise (0..1): sharp crests like lava ridges and erosion gullies. */
function ridged(x: number, y: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    s += amp * n * n;
    f *= 2.07;
    amp *= 0.5;
  }
  return s;
}

/**
 * Smooth, high-resolution volcano meshes (indexed → smooth normals, no facets): a concave cone profile with
 * radial erosion gullies, ridged lava detail that fades towards the summit, craters (Bisoke, Gahinga) and
 * Sabyinyo's jagged ridge. Colour is blended by altitude AND slope: terraced farmland → bamboo belt → montane
 * forest → Hagenia / heath → bare rock and scree at the summits, with steep faces turning to rock at any height.
 */
function buildVolcanoes(tier: Tier): { geo: THREE.BufferGeometry; craters: THREE.Vector3[] } {
  // (GAP-008: 5 × 120 × 360 × 2 = 432k triangles, more than the whole Standard budget, for mountains 1.7–2.3 km away.
  // Only the flank that faces the compound is ever seen (anywhere in the compound is within ~6° of the plaza as seen
  // from the volcanoes), so each cone is built over a ±115° arc towards the plaza, with the summit-dense rings kept.)
  const rings = tier === "lite" ? 32 : 48; // (P2-WLD-09: 64 → 48 rings, 180 → 150 per turn: −37% triangles, same silhouette at 2 km)
  const segsFull = tier === "lite" ? 96 : 150; // angular density, per full turn
  const ARC = (115 * Math.PI) / 180;
  const parts: THREE.BufferGeometry[] = [];
  const craters: THREE.Vector3[] = [];
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  const n = new THREE.Vector3();
  for (const v of VOLCANOES) {
    const centre = az(v.az, v.dist);
    const pos: number[] = [];
    const hn: number[] = [];
    const elong = v.elong ?? 1;
    const a0 = Math.atan2(-centre.z, -centre.x / elong); // towards the plaza
    const segs = Math.round((segsFull * 2 * ARC) / (Math.PI * 2)); // quads across the arc (segs + 1 vertices)
    const row = segs + 1;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const rr = v.r * (t * t * 0.8 + t * 0.2); // dense near the summit
      for (let i = 0; i <= segs; i++) {
        const a = a0 - ARC + (i / segs) * 2 * ARC;
        const lx = Math.cos(a) * rr * elong;
        const lz = Math.sin(a) * rr;
        let h = volcanoHeight(v, lx, lz);
        const u = Math.min(1, rr / v.r);
        // ridged lava flows and gullies: strongest on the mid flanks
        const det = ridged(lx * 0.0065 + v.az, lz * 0.0065 - v.az, tier === "lite" ? 3 : 5);
        h += (det - 0.35) * v.h * 0.045 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3);
        h *= 1 - smooth(0.92, 1, u); // feather into the plain
        pos.push(centre.x + lx, h - 7, centre.z + lz);
        hn.push(h / v.h);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < segs; i++) {
        const a = j * row + i;
        const b = a + 1;
        const c2 = a + row;
        const d = c2 + 1;
        idx.push(a, b, c2, b, d, c2);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // colours: altitude bands + slope (steep = rock) + noise
    const N = g.getAttribute("normal") as THREE.BufferAttribute;
    const col: number[] = [];
    for (let k = 0; k < hn.length; k++) {
      n.fromBufferAttribute(N, k);
      const slope = 1 - n.y; // 0 flat … 1 vertical
      const x = pos[k * 3]!;
      const z = pos[k * 3 + 2]!;
      const f = hn[k]! + (fbm(x * 0.012, z * 0.012, 3) - 0.5) * 0.09;
      if (f < 0.16) {
        // terraced fields on the lower slopes
        const band = Math.floor((pos[k * 3 + 1]! + 7) / 3.2);
        c.copy(FIELD_COLORS[Math.floor(hash(band, Math.floor((Math.atan2(z - centre.z, x - centre.x) + 4) * 14)) * 6)] ?? BAND.farm);
        c.lerp(BAND.bamboo, smooth(0.1, 0.16, f));
      } else if (f < 0.3) c.copy(BAND.bamboo).lerp(BAND.forest, smooth(0.22, 0.3, f));
      else if (f < 0.68) c.copy(BAND.forest).lerp(tmp.set("#3a5a30"), fbm(x * 0.03, z * 0.03, 2) * 0.6);
      else if (f < 0.86) c.copy(BAND.forest).lerp(BAND.heath, smooth(0.68, 0.8, f));
      else c.copy(BAND.heath).lerp(BAND.rock, smooth(0.86, 0.95, f));
      // steep faces and gully walls expose dark lava rock
      c.lerp(BAND.rock, smooth(0.32, 0.62, slope) * 0.85);
      // subtle per-vertex variation so large areas don't look flat-shaded
      c.multiplyScalar(0.9 + fbm(x * 0.08, z * 0.08, 2) * 0.2);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    parts.push(g);
    if (v.crater) craters.push(new THREE.Vector3(centre.x, v.h - 7 - v.h * 0.07, centre.z));
  }
  const geo = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return { geo, craters };
}

/** Fine tileable rock / vegetation detail for the volcano flanks (multiplied over the vertex colours). */
function mountainDetailTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      // tileable fbm (wraps at 256 by sampling on a torus-like lattice)
      const v = 0.5 * vnoise((x / 256) * 16, (y / 256) * 16) + 0.3 * vnoise((x / 256) * 48, (y / 256) * 48) + 0.2 * vnoise((x / 256) * 128, (y / 256) * 128);
      const k = Math.round(150 + v * 105);
      const o = (y * 256 + x) * 4;
      img.data[o] = k;
      img.data[o + 1] = k;
      img.data[o + 2] = k;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ---------------- vegetation & houses (instanced) ---------------- */
interface Inst {
  m: THREE.Matrix4;
  c: THREE.Color;
}

function InstancedSet({ geo, mat, items, shadow = false }: { geo: THREE.BufferGeometry; mat: THREE.Material; items: Inst[]; shadow?: boolean }) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    items.forEach((it, i) => {
      m.setMatrixAt(i, it.m);
      m.setColorAt(i, it.c);
    });
    m.count = items.length;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  }, [geo, mat, items, shadow]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const mat4 = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)).clone(), new THREE.Vector3(sx, sy, sz));

function inLake(x: number, z: number) {
  return LAKES.some((l) => lakeDist(l, x, z) < 1.5);
}

/** Roads, rivers and villages round the campus (seeded, built once per session). */
const countryside = (): Countryside =>
  sessionMemo("landscape:countryside", () => buildCountryside((x, z) => campusOutside(x, z) - 4, (x, z) => LAKES.some((l) => lakeDist(l, x, z) < 1.25), { x: LAKES[0]!.x, z: LAKES[0]!.z }, PUBLIC_ROAD));

function Vegetation({ tier }: { tier: Tier }) {
  const lite = tier === "lite";
  // deterministic (seeded) placements: built once per session, shared with the halls' window views
  const data = useMemo(() => sessionMemo(`landscape:veg:${lite}`, () => {
    const r = rng(42);
    const acacia: Placement[] = [];
    const euca: Placement[] = [];
    const bushes: Placement[] = [];
    const rocks: Placement[] = [];
    const boulders: Placement[] = [];
    const bananas: Inst[] = [];
    const walls: Inst[] = [];
    const roofs: Inst[] = [];
    const leaf = (base: string, v = 0.12) => new THREE.Color(base).offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * v, (r() - 0.5) * v);
    /** the compound (plaza, lawns, avenue, gates, ring road) is a designed garden: no trees, no wild scrub */
    const outside = (x: number, z: number) => {
      if (campusOutside(x, z) < 2) return false; // the compound and its frontage (world/campus.ts)
      return !inLake(x, z);
    };
    const country = countryside();
    /** on (or within `m` m of) a road or the river water */
    const near = (x: number, z: number, m: number) =>
      Math.abs(z - PUBLIC_ROAD.mid) < 7 + m ||
      country.roads.some((l) => polyDist(x, z, l) < 3 + m) || country.rivers.some((v) => polyDist(x, z, v.line) < v.w / 2 + m);
    // scattered acacias on the farmland hills, scrub and lava boulders between the fields
    for (let i = 0; i < (lite ? 40 : 110); i++) {
      const a = r() * Math.PI * 2;
      const rad = 92 + GROW + r() * 260;
      const x = Math.sin(a) * rad;
      const z = Math.cos(a) * rad;
      if (!outside(x, z) || near(x, z, 2) || (-z / rad > 0.75 && rad > 200)) continue;
      const y = terrainHeight(x, z) - 0.05;
      const k = r();
      if (k < 0.5) acacia.push({ x, y, z, rotY: r() * Math.PI * 2, s: 0.8 + r() * 0.4 });
      else if (k < 0.8) bushes.push({ x, y, z, rotY: r() * 6, s: 0.8 + r() * 0.6 });
      else if (k < 0.9) boulders.push({ x, y: y - 0.05, z, rotY: r() * 6, s: 0.8 + r() * 1.4 });
      else rocks.push({ x, y: y - 0.05, z, rotY: r() * 6, s: 0.6 + r() * 0.8 });
    }

    // eucalyptus woodlots: dense blocks of 30–80 trees on the ridges (as on the Musanze hills)
    for (let w = 0; w < (lite ? 8 : 16); w++) {
      const a = r() * Math.PI * 2;
      const rad = 120 + GROW + r() * 300;
      const cx = Math.sin(a) * rad;
      const cz = Math.cos(a) * rad;
      if (-cz / rad > 0.75 && rad > 200) continue; // keep the volcano view open
      const rot = r() * Math.PI;
      const bw = 25 + r() * 30;
      const bd = 14 + r() * 16;
      const n = Math.round((lite ? 0.5 : 1) * (30 + r() * 50));
      for (let k = 0; k < n; k++) {
        const u = (r() - 0.5) * bw;
        const v = (r() - 0.5) * bd;
        const x = cx + u * Math.cos(rot) - v * Math.sin(rot);
        const z = cz + u * Math.sin(rot) + v * Math.cos(rot);
        if (!outside(x, z) || near(x, z, 2)) continue;
        euca.push({ x, y: terrainHeight(x, z) - 0.05, z, rotY: r() * Math.PI * 2, s: 0.7 + r() * 0.35, sy: 1 + r() * 0.3 });
      }
    }
    // houses (P2-WLD-11): roadside villages (imidugudu, rows facing the road) plus scattered farmsteads on the hills;
    // ochre / whitewashed walls, roofs of silver or weathered corrugated iron, some rusty, some red clay tiles
    const WALLS = ["#b9874f", "#c99a62", "#a8723f", "#d1b48c", "#e0d8c8"];
    const ROOFS = ["#a3a9ac", "#a3a9ac", "#8c9296", "#7f8589", "#7a4630", "#a4553b", "#9a4b34"];
    const house = (x: number, z: number, rot: number, bananaClumps: number) => {
      const y = terrainHeight(x, z);
      const w = 5 + r() * 3.5;
      const d = 3.8 + r() * 1.2;
      walls.push({ m: mat4(x, y + 0.9, z, w, 2.8, d, rot), c: new THREE.Color(WALLS[Math.floor(r() * WALLS.length)]!) });
      roofs.push({ m: mat4(x, y + 2.7, z, w + 0.6, 1.0, d * 1.25, rot), c: new THREE.Color(ROOFS[Math.floor(r() * ROOFS.length)]!).multiplyScalar(0.92 + r() * 0.16) });
      // banana clumps round the homestead
      for (let c = 0; c < bananaClumps; c++) {
        const ba = r() * Math.PI * 2;
        const bx = x + Math.cos(ba) * (6 + r() * 4);
        const bz = z + Math.sin(ba) * (6 + r() * 4);
        if (near(bx, bz, 3)) continue;
        for (let k = 0; k < 3 + Math.floor(r() * 3); k++) {
          const px = bx + (r() - 0.5) * 2.4;
          const pz = bz + (r() - 0.5) * 2.4;
          const hh = 2.6 + r() * 1.6;
          bananas.push({ m: mat4(px, terrainHeight(px, pz) - 0.1, pz, hh / 3.2, hh / 3.2, hh / 3.2, r() * 6), c: leaf("#6f9a3a", 0.1) });
        }
      }
    };
    for (const h of country.houses) house(h.x, h.z, h.rot, lite ? 1 : 2);
    for (let i = 0; i < (lite ? 30 : 80); i++) {
      const a = r() * Math.PI * 2;
      const rad = 120 + GROW + r() * 330;
      const x = Math.sin(a) * rad;
      const z = Math.cos(a) * rad;
      if (!outside(x, z) || near(x, z, 8) || (-z / rad > 0.8 && rad > 260)) continue;
      house(x, z, r() * Math.PI, lite ? 1 : 2);
    }
    // eucalyptus lining stretches of the roads, scrub and trees along the river banks
    for (const line of country.roads)
      for (let i = 1; i < line.length - 1; i += lite ? 4 : 2) {
        if (r() > 0.45) continue;
        const a = line[i]!;
        const b = line[i + 1]!;
        const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const side = r() < 0.5 ? -1 : 1;
        const x = a.x + (-(b.z - a.z) / tl) * 7 * side;
        const z = a.z + ((b.x - a.x) / tl) * 7 * side;
        if (outside(x, z) && !near(x, z, 4.5)) euca.push({ x, y: terrainHeight(x, z) - 0.05, z, rotY: r() * 6, s: 0.7 + r() * 0.3, sy: 1 + r() * 0.3 });
      }
    for (const v of country.rivers)
      for (let i = 0; i < v.line.length - 1; i += lite ? 3 : 1) {
        const a = v.line[i]!;
        const b = v.line[i + 1]!;
        const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        for (const side of [-1, 1]) {
          if (r() > 0.55) continue;
          const off = v.w * 0.6 + 2 + r() * 6;
          const x = a.x + (-(b.z - a.z) / tl) * off * side;
          const z = a.z + ((b.x - a.x) / tl) * off * side;
          if (!outside(x, z) || near(x, z, 2.5)) continue;
          const y = terrainHeight(x, z) - 0.05;
          if (r() < 0.6) bushes.push({ x, y, z, rotY: r() * 6, s: 0.9 + r() * 0.7 });
          else acacia.push({ x, y, z, rotY: r() * 6, s: 0.7 + r() * 0.4 });
        }
      }
    return { acacia, euca, bushes, rocks, boulders, bananas, walls, roofs };
  }), [lite]);

  const geos = useMemo(
    () =>
      sessionMemo("landscape:veg-geos", () => ({
        banana: bananaGeometry(),
        box: new THREE.BoxGeometry(1, 1, 1),
        // gabled roof: a triangular prism along x, ridge up, eaves at y = −0.5 (P2-WLD-11: was lying on its side)
        roof: new THREE.CylinderGeometry(0.5, 0.5, 1, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 4 / 3, 1 / 0.866).translate(0, -1 / 6, 0),
      })),
    [],
  );
  const mats = useMemo(
    () =>
      sessionMemo("landscape:veg-mats", () => ({
        banana: new THREE.MeshStandardMaterial({ map: bananaLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
        wall: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
        roof: new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.55 }),
      })),
    [],
  );
  const shadows = !lite;
  return (
    <group>
      <Suspense fallback={null}>
        <InstancedSpecies id="acacia" items={data.acacia} lite={lite} shadows={false} />
        <InstancedSpecies id="eucalyptus" items={data.euca} lite={lite} shadows={false} />
        <InstancedSpecies id="bush" items={data.bushes} lite={lite} shadows={false} />
        <InstancedSpecies id="rock" items={data.rocks} lite={lite} shadows={shadows} />
        <InstancedSpecies id="boulder" items={data.boulders} lite={lite} shadows={shadows} />
      </Suspense>
      <Flowers tier={tier} />
      <InstancedSet geo={geos.banana} mat={mats.banana} items={data.bananas} />
      <InstancedSet geo={geos.box} mat={mats.wall} items={data.walls} />
      <InstancedSet geo={geos.roof} mat={mats.roof} items={data.roofs} />
    </group>
  );
}

/** Banana plant (3.2 m): pseudo-stem + 8 arching, torn leaf blades (alpha-cut), merged into one geometry. */
function bananaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // (seen from 120 m and more: an open stem and 3-segment blades, 62 triangles instead of 124 × ~800 plants)
  const stemG = new THREE.CylinderGeometry(0.1, 0.16, 2.0, 7, 1, true).translate(0, 1.0, 0);
  // stem uses the dark bottom strip of the leaf texture
  const suv = stemG.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, 0.02 + suv.getX(i) * 0.06, 0.02 + suv.getY(i) * 0.05);
  parts.push(stemG.toNonIndexed());
  for (let k = 0; k < 8; k++) {
    const blade = new THREE.PlaneGeometry(0.62, 2.1, 1, 3);
    const p = blade.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 1.05; // 0 … 2.1 along the blade
      const t = y / 2.1;
      p.setXYZ(i, p.getX(i), Math.sin(t * 1.9) * 1.25, -Math.cos(t * 1.9) * 1.25 + 1.25 - t * 0.6);
    }
    blade.rotateX(-0.25 - (k % 3) * 0.12).rotateY((k / 8) * Math.PI * 2 + (k % 2) * 0.3).translate(0, 1.85 + (k % 3) * 0.12, 0);
    blade.computeVertexNormals();
    parts.push(blade.toNonIndexed());
  }
  const g = mergeGeometries(parts, false)!;
  parts.forEach((x) => x.dispose());
  return g;
}

function bananaLeafTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  const r = rng(77);
  // blade: midrib + parallel veins, ragged wind-torn edges
  g.fillStyle = "#5f8d34";
  g.beginPath();
  g.moveTo(64, 254);
  for (let y = 250; y >= 6; y -= 6) g.lineTo(64 - (56 - (254 - y) * 0.05) * (0.85 + r() * 0.15) * (y % 30 < 4 ? 0.55 : 1), y);
  g.lineTo(64, 2);
  for (let y = 6; y <= 250; y += 6) g.lineTo(64 + (56 - (254 - y) * 0.05) * (0.85 + r() * 0.15) * (y % 36 < 5 ? 0.5 : 1), y);
  g.closePath();
  g.fill();
  g.strokeStyle = "#86ad55";
  g.lineWidth = 1;
  for (let y = 10; y < 250; y += 5) {
    g.beginPath();
    g.moveTo(64, y);
    g.lineTo(8, y - 10);
    g.moveTo(64, y);
    g.lineTo(120, y - 10);
    g.stroke();
  }
  g.strokeStyle = "#c9d78a";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(64, 254);
  g.lineTo(64, 2);
  g.stroke();
  // pseudo-stem strip (bottom-left corner)
  g.fillStyle = "#6b6a3a";
  g.fillRect(0, 240, 12, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- mist ---------------- */
interface MistDef {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  o: number;
  flat?: boolean;
}
function Mist({ tier }: { tier: Tier }) {
  const tex = useMemo(() => sessionMemo("landscape:mist", () => mistTexture()), []);
  const defs = useMemo<MistDef[]>(() => {
    const list: MistDef[] = [];
    for (const v of VOLCANOES) {
      const c = az(v.az, v.dist - v.r * 0.45);
      list.push({ x: c.x, y: v.h * 0.3, z: c.z, w: v.r * 1.6, h: v.h * 0.4, o: 0.42 });
      if (v.name === "Karisimbi" || v.name === "Muhabura" || v.name === "Bisoke") {
        // cloud caps clinging to the summits (Karisimbi is usually in cloud)
        for (const [off, k, o] of [
          [-0.04, 1, 0.92],
          [0.05, 0.8, 0.75],
        ] as const) {
          const s = az(v.az + off * 20, v.dist - v.r * 0.04);
          list.push({ x: s.x, y: v.h * (0.9 - off), z: s.z, w: v.r * 0.55 * k, h: v.h * 0.26 * k, o: v.name === "Bisoke" ? o * 0.6 : o });
        }
      }
    }
    if (tier === "lite") return list.slice(0, 4);
    // valley mist banks between the hills and over the lakes
    for (const [deg, d, w] of [
      [102, 240, 260],
      [70, 380, 320],
      [150, 230, 240],
      [-150, 260, 260],
      [-110, 220, 220],
      [200, 330, 300],
      [-20, 330, 420],
      [30, 300, 380],
    ] as const) {
      const p = az(deg, d);
      list.push({ x: p.x, y: 7, z: p.z, w, h: 26, o: 0.7 });
    }
    return list;
  }, [tier]);
  // every bank in one mesh (one draw call, GAP-008): the slow drift and the breathing opacity of each bank run in
  // the vertex shader from its own phase / amplitude attributes (same motion as the separate meshes had)
  const mist = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    defs.forEach((d, i) => {
      const g = new THREE.PlaneGeometry(d.w, d.h).rotateY(Math.atan2(-d.x, -d.z)).translate(d.x, d.y, d.z); // face the plaza
      const n = g.attributes.position!.count;
      g.setAttribute("aMist", new THREE.BufferAttribute(new Float32Array(Array.from({ length: n }, () => [i, d.w * 0.04, d.o]).flat()), 3));
      parts.push(g);
    });
    const geo = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    const uTime = { value: 0 };
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: "#f4f7fa", fog: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.uniforms.uMorning = mistUniform; // P2-WLD-09: the banks thicken with the Musanze morning mist
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uMorning;\nattribute vec3 aMist;\nvarying float vMist;")
        .replace(
          "#include <begin_vertex>",
          // (P2-WLD-11: a bank seen edge-on or from high above — the campus aerial view — fades out instead of showing as a
          // white streak across the fields)
          "#include <begin_vertex>\ntransformed.x += sin(uTime * 0.03 + aMist.x) * aMist.y;\nvMist = min(1.0, aMist.z * (0.85 + 0.15 * sin(uTime * 0.1 + aMist.x * 1.7)) * (1.0 + 1.3 * uMorning));\nvec3 gkV = normalize(cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz);\nvMist *= smoothstep(0.15, 0.5, abs(dot(normalize(normal), gkV))) * (1.0 - smoothstep(0.22, 0.45, gkV.y));",
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vMist;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vMist;");
    };
    mat.customProgramCacheKey = () => "gk-mist";
    return { geo, mat, uTime };
  }, [defs, tex]);
  useEffect(
    () => () => {
      mist.geo.dispose();
      mist.mat.dispose();
    },
    [mist],
  );
  useFrame(({ clock }) => {
    mist.uTime.value = clock.elapsedTime;
  });
  return <mesh geometry={mist.geo} material={mist.mat} renderOrder={-1} />;
}

/** Both lakes in one mesh; `aLake` keeps each disc's own unit-radius coordinates (the shore fade needs them, and they
 *  survive the outdoor static batching, which bakes transforms into the vertices). */
function lakeGeometry(): THREE.BufferGeometry {
  const parts = LAKES.map((l) => {
    const g = new THREE.CircleGeometry(1, 64);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const local = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      local[i * 2] = p.getX(i);
      local[i * 2 + 1] = p.getY(i);
    }
    g.setAttribute("aLake", new THREE.BufferAttribute(local, 2));
    g.deleteAttribute("uv");
    g.scale(l.rx * 1.35, l.rz * 1.35, 1).rotateZ(l.rot).rotateX(-Math.PI / 2).translate(l.x, l.level, l.z);
    return g;
  });
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return geo;
}

/**
 * Lake water (P2-WLD-11): deep blue-green in the middle, shallow olive-brown towards the shore, and an irregular,
 * feathered edge that dissolves into the marsh fringe (no hard ellipse). The disc is unit radius in its own coordinates (aLake).
 */
function lakeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: "#2c5562", metalness: 0, roughness: 0.08, envMapIntensity: 0.9, transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aLake;\nvarying vec2 vGkL;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vGkL = aLake;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vGkL;
float gkLh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gkLn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gkLh(i), gkLh(i + vec2(1.0, 0.0)), u.x), mix(gkLh(i + vec2(0.0, 1.0)), gkLh(i + vec2(1.0, 1.0)), u.x), u.y); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float gkD = length(vGkL) + (gkLn(vGkL * 7.0) - 0.5) * 0.14 + (gkLn(vGkL * 23.0) - 0.5) * 0.04;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.17, 0.14), smoothstep(0.55, 0.85, gkD));
  diffuseColor.a *= 1.0 - smoothstep(0.7, 0.92, gkD);`,
      );
  };
  m.customProgramCacheKey = () => "gk-lake";
  return m;
}

/* ---------------- composition ---------------- */
export function Landscape({ tier }: { tier: Tier }) {
  // the procedural meshes are pure functions of the tier: built once per session (the plaza and the halls' window
  // views share them, already on the GPU), never disposed
  const terrain = useMemo(() => sessionMemo(`landscape:terrain:${tier}`, () => buildTerrain(tier)), [tier]);
  const volcanoes = useMemo(() => sessionMemo(`landscape:volcanoes:${tier}`, () => {
    const v = buildVolcanoes(tier);
    // planar UVs (world xz / 60 m) for the detail texture
    const P = v.geo.getAttribute("position") as THREE.BufferAttribute;
    const uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      uv[i * 2] = P.getX(i) / 60;
      uv[i * 2 + 1] = P.getZ(i) / 60 + P.getY(i) / 90;
    }
    v.geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return v;
  }), [tier]);
  const detail = useMemo(() => sessionMemo("landscape:detail", () => mountainDetailTexture()), []);
  const volcanoMat = useMemo(() => sessionMemo("landscape:volcano-mat", () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detail, fog: false });
    m.onBeforeCompile = (sh) => {
      // aerial perspective: blue-grey haze and loss of saturation with distance (km-scale), output (sRGB) space;
      // thicker while the Musanze morning mist lies in the valleys (P2-WLD-09)
      sh.uniforms.uMorning = mistUniform;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uMorning;")
        .replace(
          "#include <fog_fragment>",
          `#include <fog_fragment>
        {
          float gkD = length(vViewPosition);
          float gkK = 1.0 - exp(-gkD * 0.00046 * (1.0 + 1.6 * uMorning));
          vec3 gkG = vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11)));
          gl_FragColor.rgb = mix(mix(gl_FragColor.rgb, gkG, 0.45 * gkK), vec3(0.706, 0.765, 0.812), gkK);
        }`,
        );
    };
    m.customProgramCacheKey = () => "gk-volcano-haze";
    return m;
  }), [detail]);
  // CC0 photographic lawn texture (Poly Haven "leafy_grass"), tinted per field by the vertex colours
  const ground = useMemo(() => sessionMemo(`landscape:ground:${tier}`, () => {
    const load = (url: string, srgb: boolean) => {
      const t = new BitmapTextureLoader().load(url); // decoded off the main thread
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = tier === "lite" ? 2 : 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return { map: load("/assets/env/ground-grass.webp", true), normal: tier === "lite" ? null : load("/assets/env/ground-grass-n.webp", false) };
  }), [tier]);
  const terrainMat = useMemo(
    () =>
      sessionMemo(`landscape:terrain-mat:${tier}`, () =>
        terrainMaterial({ lite: tier === "lite", map: ground.map, normalMap: ground.normal, mask: countrysideMask(countryside(), tier === "lite") }),
      ),
    [tier, ground],
  );
  const lakeMat = useMemo(() => sessionMemo("landscape:lake-mat", () => lakeMaterial()), []);
  const lakeGeo = useMemo(() => sessionMemo("landscape:lake-geo", () => lakeGeometry()), []);
  return (
    <group>
      <mesh geometry={terrain} material={terrainMat} receiveShadow />
      <mesh geometry={volcanoes.geo} material={volcanoMat} />
      <mesh geometry={lakeGeo} material={lakeMat} />
      {volcanoes.craters.map((c, i) => (
        <mesh key={i} position={c} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[22, 24]} />
          <meshStandardMaterial color="#3c6468" metalness={0} roughness={0.08} />
        </mesh>
      ))}
      <Vegetation tier={tier} />
      <Mist tier={tier} />
    </group>
  );
}
