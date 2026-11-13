"use client";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mistTexture, rng } from "./textures";
import type { Tier } from "./materials";
import { InstancedSpecies, type Placement } from "./Vegetation";
import { Flowers } from "./Flowers";

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
  { name: "Ruhondo", ...az(102, 250), rx: 95, rz: 34, rot: 0.25, level: 1.2 },
  { name: "Burera", ...az(70, 400), rx: 150, rz: 48, rot: -0.35, level: 7.5 },
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
/** Height of the farmland terrain (metres). Flat district up to ~85 m, hills beyond; low plain towards the volcanoes. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // keep the arrival gate forecourt (south, on the avenue axis) flat
  const gateZone = 1 - smooth(22, 46, Math.hypot(x * 1.4, z - 100));
  const ramp = smooth(88, 175, r) * (1 - gateZone);
  if (ramp <= 0) return -0.06;
  const north = smooth(0.15, 0.7, -z / Math.max(r, 1));
  const amp = lerp(30, 6, north);
  let h = fbm(x * 0.0055 + 7, z * 0.0055 - 3) * amp + fbm(x * 0.022, z * 0.022, 2) * 5;
  h += smooth(500, 1100, r) * (1 - north) * 40; // far southern ridges close the horizon
  const t = h / TERRACE;
  const terr = (Math.floor(t) + smooth(0.72, 1, t - Math.floor(t))) * TERRACE;
  h = lerp(h, terr, 0.62) * ramp;
  for (const l of LAKES) {
    const d = lakeDist(l, x, z);
    if (d < 1.4) h = lerp(l.level - 5, Math.max(h, l.level + 1.5), smooth(0.92, 1.4, d));
  }
  return h - 0.06;
}

const FIELD_COLORS = ["#5f9d3c", "#86ad45", "#3f7b35", "#6e9f46", "#9cb455", "#4f8a3a", "#6b4b33", "#a39a52"].map((c) => new THREE.Color(c));

function terrainColor(x: number, z: number, h: number, out: THREE.Color) {
  const r = Math.hypot(x, z);
  if (r < 92) {
    out.set("#5b9442").lerp(new THREE.Color("#73a650"), fbm(x * 0.05, z * 0.05, 2));
    return;
  }
  for (const l of LAKES)
    if (h < l.level + 0.6 && lakeDist(l, x, z) < 1.45) {
      out.set("#4a4031");
      return;
    }
  const band = Math.floor((h + 0.06) / TERRACE);
  const f = (h + 0.06) / TERRACE - band;
  const idx = Math.floor(hash(Math.floor(x / 26) + band * 7, Math.floor(z / 19) - band * 3) * FIELD_COLORS.length);
  out.copy(FIELD_COLORS[idx] ?? FIELD_COLORS[0]!);
  if (f > 0.7) out.multiplyScalar(0.72); // terrace riser shadow line
  out.lerp(new THREE.Color("#3e6b30"), 0.25 * fbm(x * 0.03, z * 0.03, 2));
}

function buildTerrain(tier: Tier): THREE.BufferGeometry {
  const segs = tier === "lite" ? 160 : 448;
  const radii: number[] = [];
  for (let r = 30; r < 1500; r += Math.max(tier === "lite" ? 4 : 2.2, r * (tier === "lite" ? 0.055 : 0.022))) radii.push(r);
  radii.push(1500);
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
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
  { name: "Karisimbi", az: -58, dist: 1050, h: 360, r: 900, p: 1.55 },
  { name: "Bisoke", az: -36, dist: 860, h: 245, r: 560, p: 1.35, crater: 0.05 },
  { name: "Sabyinyo", az: -8, dist: 800, h: 235, r: 540, p: 1.5, teeth: true, elong: 1.3 },
  { name: "Gahinga", az: 13, dist: 760, h: 190, r: 420, p: 1.3, crater: 0.04 },
  { name: "Muhabura", az: 27, dist: 900, h: 310, r: 600, p: 1.12 },
];

const BAND = {
  farm: new THREE.Color("#5f8f3f"),
  bamboo: new THREE.Color("#7f9a43"),
  forest: new THREE.Color("#2f4f2c"),
  heath: new THREE.Color("#5d5c3c"),
  rock: new THREE.Color("#3b3733"),
};

function volcanoHeight(v: Volcano, lx: number, lz: number): number {
  const u = Math.hypot(lx / (v.elong ?? 1), lz) / v.r;
  if (u >= 1) return 0;
  const a = Math.atan2(lz, lx);
  let h = v.h * Math.pow(1 - u, v.p);
  // rounded summit
  h -= v.h * 0.06 * Math.exp(-u * u * 900);
  // erosion gullies, stronger low on the flanks
  h *= 1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 11 + fbm(lx * 0.01, lz * 0.01, 2) * 6)), 3) * smooth(0.05, 0.6, u);
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
  const rings = tier === "lite" ? 48 : 120;
  const segs = tier === "lite" ? 128 : 360;
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
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const rr = v.r * (t * t * 0.8 + t * 0.2); // dense near the summit
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const lx = Math.cos(a) * rr * elong;
        const lz = Math.sin(a) * rr;
        let h = volcanoHeight(v, lx, lz);
        const u = Math.min(1, rr / v.r);
        // ridged lava flows and gullies: strongest on the mid flanks
        const det = ridged(lx * 0.0065 + v.az, lz * 0.0065 - v.az, tier === "lite" ? 3 : 5);
        h += (det - 0.35) * v.h * 0.07 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3);
        h *= 1 - smooth(0.92, 1, u); // feather into the plain
        pos.push(centre.x + lx, h - 7, centre.z + lz);
        hn.push(h / v.h);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < segs; i++) {
        const a = j * segs + i;
        const b = j * segs + ((i + 1) % segs);
        const c2 = (j + 1) * segs + i;
        const d = (j + 1) * segs + ((i + 1) % segs);
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
function canopyGeo(seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const r = rng(seed);
  const jit = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = jit.get(key);
    if (k === undefined) {
      k = 0.82 + r() * 0.36;
      jit.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
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

function Vegetation({ tier }: { tier: Tier }) {
  const lite = tier === "lite";
  const data = useMemo(() => {
    const r = rng(42);
    const acacia: Placement[] = [];
    const euca: Placement[] = [];
    const bushes: Placement[] = [];
    const rocks: Placement[] = [];
    const boulders: Placement[] = [];
    const culms: Inst[] = [];
    const culmLeaves: Inst[] = [];
    const walls: Inst[] = [];
    const roofs: Inst[] = [];
    const leaf = (base: string, v = 0.12) => new THREE.Color(base).offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * v, (r() - 0.5) * v);
    /** the compound (plaza, lawns, avenue, gates, ring road) is a designed garden: no trees, no wild scrub */
    const outside = (x: number, z: number) => {
      const r0 = Math.hypot(x, z);
      if (r0 < 90) return false;
      if (Math.abs(x) < 26 && z > 60 && z < 125) return false; // avenue, arrival gate and its forecourt
      return !inLake(x, z);
    };
    // scattered acacias on the farmland hills, scrub and lava boulders between the fields
    for (let i = 0; i < (lite ? 40 : 110); i++) {
      const a = r() * Math.PI * 2;
      const rad = 92 + r() * 260;
      const x = Math.sin(a) * rad;
      const z = Math.cos(a) * rad;
      if (!outside(x, z) || (-z / rad > 0.75 && rad > 200)) continue;
      const y = terrainHeight(x, z) - 0.05;
      const k = r();
      if (k < 0.5) acacia.push({ x, y, z, rotY: r() * Math.PI * 2, s: 0.8 + r() * 0.4 });
      else if (k < 0.8) bushes.push({ x, y, z, rotY: r() * 6, s: 0.8 + r() * 0.6 });
      else if (k < 0.9) boulders.push({ x, y: y - 0.05, z, rotY: r() * 6, s: 0.8 + r() * 1.4 });
      else rocks.push({ x, y: y - 0.05, z, rotY: r() * 6, s: 0.6 + r() * 0.8 });
    }

    // eucalyptus woodlots on the hills
    for (let w = 0; w < (lite ? 14 : 30); w++) {
      const a = r() * Math.PI * 2;
      const rad = 110 + r() * 260;
      const cx = Math.sin(a) * rad;
      const cz = Math.cos(a) * rad;
      if (-cz / rad > 0.75 && rad > 200) continue; // keep the volcano view open
      const n = 5 + Math.floor(r() * 9);
      for (let k = 0; k < n; k++) {
        const x = cx + (r() - 0.5) * 30;
        const z = cz + (r() - 0.5) * 30;
        if (!outside(x, z)) continue;
        euca.push({ x, y: terrainHeight(x, z) - 0.05, z, rotY: r() * Math.PI * 2, s: 0.75 + r() * 0.35, sy: 1 + r() * 0.25 });
      }
    }
    // bamboo groves near the district edge and in the foreground hills
    for (let g = 0; g < (lite ? 12 : 28); g++) {
      const a = r() * Math.PI * 2;
      const rad = 86 + r() * 70;
      const cx = Math.sin(a) * rad;
      const cz = Math.cos(a) * rad;
      if (!outside(cx, cz)) continue; // compound / avenue / gate
      const y0 = terrainHeight(cx, cz);
      for (let k = 0; k < 9; k++) {
        const x = cx + (r() - 0.5) * 3.5;
        const z = cz + (r() - 0.5) * 3.5;
        const h = 7 + r() * 4;
        const lean = (r() - 0.5) * 0.25;
        const tilt = (r() - 0.5) * 0.25;
        culms.push({ m: mat4(x, y0 + h / 2, z, 0.06, h, 0.06, 0, lean, tilt), c: leaf("#9aa94e", 0.1) });
        for (const [f, s] of [
          [0.62, 0.55],
          [0.76, 0.7],
          [0.9, 0.5],
        ] as const)
          culmLeaves.push({
            m: mat4(x - tilt * h * f * 0.5 + (r() - 0.5) * 0.6, y0 + h * f, z + lean * h * f * 0.5 + (r() - 0.5) * 0.6, s, s * 1.6, s, r() * 6, (r() - 0.5) * 0.6),
            c: leaf("#5f8a35", 0.12),
          });
      }
    }
    // farmhouses with iron-sheet roofs on the hills
    for (let i = 0; i < (lite ? 50 : 130); i++) {
      const a = r() * Math.PI * 2;
      const rad = 120 + r() * 330;
      const x = Math.sin(a) * rad;
      const z = Math.cos(a) * rad;
      if (!outside(x, z) || (-z / rad > 0.8 && rad > 260)) continue;
      const y = terrainHeight(x, z);
      const rot = r() * Math.PI;
      const w = 5 + r() * 3;
      walls.push({ m: mat4(x, y + 1.4, z, w, 2.8, 4, rot), c: new THREE.Color(r() > 0.5 ? "#c9a27a" : "#e6dccb") });
      roofs.push({ m: mat4(x, y + 3.4, z, w + 0.6, 1.4, 4.8, rot), c: new THREE.Color(r() > 0.35 ? "#a9b0b5" : "#8a4b2f") });
    }
    return { acacia, euca, bushes, rocks, boulders, culms, culmLeaves, walls, roofs };
  }, [lite]);

  const geos = useMemo(
    () => ({
      eu: canopyGeo(7, 0),
      culm: new THREE.CylinderGeometry(0.7, 1, 1, 5),
      box: new THREE.BoxGeometry(1, 1, 1),
      roof: new THREE.CylinderGeometry(0.5, 0.5, 1, 3).rotateZ(Math.PI / 2).rotateX(0).scale(1, 1, 1),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      bark: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      leaf: new THREE.MeshStandardMaterial({ roughness: 0.85 }),
      wall: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
      roof: new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.55 }),
    }),
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
      <InstancedSet geo={geos.culm} mat={mats.bark} items={data.culms} />
      <InstancedSet geo={geos.eu} mat={mats.leaf} items={data.culmLeaves} />
      <InstancedSet geo={geos.box} mat={mats.wall} items={data.walls} />
      <InstancedSet geo={geos.roof} mat={mats.roof} items={data.roofs} />
    </group>
  );
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
  const tex = useMemo(() => mistTexture(), []);
  const defs = useMemo<MistDef[]>(() => {
    const list: MistDef[] = [];
    for (const v of VOLCANOES) {
      const c = az(v.az, v.dist - v.r * 0.45);
      list.push({ x: c.x, y: v.h * 0.32, z: c.z, w: v.r * 1.8, h: v.h * 0.45, o: 0.75 });
      if (v.name === "Karisimbi" || v.name === "Muhabura") {
        const s = az(v.az, v.dist - v.r * 0.06);
        list.push({ x: s.x, y: v.h * 0.82, z: s.z, w: v.r * 0.75, h: v.h * 0.32, o: 0.95 });
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
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const d = defs[i]!;
      m.position.x = d.x + Math.sin(t * 0.03 + i) * d.w * 0.04;
      (m.material as THREE.MeshBasicMaterial).opacity = d.o * (0.85 + 0.15 * Math.sin(t * 0.1 + i * 1.7));
    });
  });
  return (
    <group>
      {defs.map((d, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
          position={[d.x, d.y, d.z]}
          rotation={[0, Math.atan2(-d.x, -d.z) + Math.PI, 0]}
          renderOrder={-1}
        >
          <planeGeometry args={[d.w, d.h]} />
          <meshBasicMaterial map={tex} transparent opacity={d.o} depthWrite={false} color="#f4f7fa" />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- composition ---------------- */
export function Landscape({ tier }: { tier: Tier }) {
  const terrain = useMemo(() => buildTerrain(tier), [tier]);
  const volcanoes = useMemo(() => {
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
  }, [tier]);
  const detail = useMemo(() => mountainDetailTexture(), []);
  // CC0 photographic lawn texture (Poly Haven "leafy_grass"), tinted per field by the vertex colours
  const ground = useMemo(() => {
    const load = (url: string, srgb: boolean) => {
      const t = new THREE.TextureLoader().load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = tier === "lite" ? 2 : 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return { map: load("/assets/env/ground-grass.webp", true), normal: tier === "lite" ? null : load("/assets/env/ground-grass-n.webp", false) };
  }, [tier]);
  const tint = useMemo(() => new THREE.Color("#ffffff").multiplyScalar(1.9), []);
  useEffect(
    () => () => {
      terrain.dispose();
      volcanoes.geo.dispose();
    },
    [terrain, volcanoes],
  );
  return (
    <group>
      <mesh geometry={terrain} receiveShadow>
        <meshStandardMaterial vertexColors map={ground.map} normalMap={ground.normal} normalScale={new THREE.Vector2(0.8, 0.8)} color={tint} roughness={1} />
      </mesh>
      <mesh geometry={volcanoes.geo}>
        <meshStandardMaterial vertexColors roughness={1} map={detail} />
      </mesh>
      {LAKES.map((l) => (
        <mesh key={l.name} position={[l.x, l.level, l.z]} rotation={[-Math.PI / 2, 0, l.rot]} scale={[l.rx * 1.35, l.rz * 1.35, 1]}>
          <circleGeometry args={[1, 48]} />
          <meshStandardMaterial color="#3d6a80" metalness={0.6} roughness={0.08} envMapIntensity={1.4} />
        </mesh>
      ))}
      {volcanoes.craters.map((c, i) => (
        <mesh key={i} position={c} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[22, 24]} />
          <meshStandardMaterial color="#3f6f73" metalness={0.5} roughness={0.1} />
        </mesh>
      ))}
      <Vegetation tier={tier} />
      <Mist tier={tier} />
    </group>
  );
}
