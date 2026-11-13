"use client";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AVENUE_BEDS, GATE_ARCS, LAWN_BEDS, PLAZA_ARCS, PLAZA_BEDS, RING_PLANTERS, arcPoint, type ArcBed, type RectBed } from "./beds";
import { PLAZA_RADIUS } from "./layout";
import { worldMaterials, type Tier } from "./materials";
import { rng } from "./textures";
import { addWind } from "./Vegetation";
import { sessionMemo } from "./session-cache";

/**
 * Modern compound landscaping (no trees inside the compound): raised planters and corten / concrete-edged beds with
 * massed flowers — agapanthus, lavender, roses, allium, tulips, strelitzia, canna, salvia, white gaura, coreopsis —
 * ornamental grasses, clipped box hedges, bougainvillea trellises and small warm uplights.
 *
 * Flowers are painted procedurally into one alpha-cut atlas (no download) and drawn as instanced crossed cards (a few
 * triangles each), swaying in the wind; beds are merged into a handful of draw calls.
 */

/* ---------------- procedural flower atlas (4 × 4 cells) ---------------- */
type CellId = "agapanthus" | "lavender" | "roses" | "allium" | "tulips" | "strelitzia" | "canna" | "salvia" | "grass" | "gaura" | "coreopsis" | "bougainvillea" | "foliage";
const CELLS: CellId[] = ["agapanthus", "lavender", "roses", "allium", "tulips", "strelitzia", "canna", "salvia", "grass", "gaura", "coreopsis", "bougainvillea", "foliage"];
const CELL = 256;

let atlasCache: THREE.CanvasTexture | null = null;
function flowerAtlas(): THREE.CanvasTexture {
  if (atlasCache) return atlasCache;
  const c = document.createElement("canvas");
  c.width = c.height = CELL * 4;
  const g = c.getContext("2d")!;
  const r = rng(91);
  const R = (a: number, b: number) => a + r() * (b - a);
  const leafBlade = (x0: number, y0: number, len: number, ang: number, w: number, col: string) => {
    const x1 = x0 + Math.sin(ang) * len;
    const y1 = y0 - Math.cos(ang) * len;
    const mx = (x0 + x1) / 2 + Math.cos(ang) * len * 0.12;
    const my = (y0 + y1) / 2 + Math.sin(ang) * len * 0.12;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x0 - w, y0);
    g.quadraticCurveTo(mx - w * 0.6, my, x1, y1);
    g.quadraticCurveTo(mx + w * 0.6, my, x0 + w, y0);
    g.fill();
  };
  const stem = (x0: number, y0: number, x1: number, y1: number, col = "#4f7a33", w = 2) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2 + R(-6, 6), (y0 + y1) / 2, x1, y1);
    g.stroke();
  };
  const dot = (x: number, y: number, rad: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  const greens = ["#3f6f2a", "#4d7f32", "#5b8c3a", "#355f25"];
  const G = () => greens[Math.floor(r() * greens.length)]!;
  CELLS.forEach((id, i) => {
    const ox = (i % 4) * CELL;
    const oy = Math.floor(i / 4) * CELL;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.rect(0, 0, CELL, CELL);
    g.clip();
    const base = CELL - 2;
    switch (id) {
      case "agapanthus":
        for (let k = 0; k < 14; k++) leafBlade(R(80, 176), base, R(70, 120), R(-0.9, 0.9), 5, G());
        for (let k = 0; k < 4; k++) {
          const x = R(50, 206), y = R(40, 90);
          stem(R(110, 146), base, x, y, "#5d8a3c", 3);
          for (let f = 0; f < 46; f++) {
            const a = R(0, Math.PI * 2), d = R(4, 30);
            stem(x, y, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, "#6b8f4a", 1);
            dot(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, R(3, 5), ["#4f5fd6", "#6a74e8", "#3e48b8", "#7c86f0"][f % 4]!);
          }
        }
        break;
      case "lavender":
        for (let k = 0; k < 38; k++) {
          const x0 = R(60, 196), x1 = x0 + R(-40, 40), y1 = R(20, 90);
          stem(x0, base, x1, y1, "#7f9a6a", 2);
          for (let f = 0; f < 12; f++) dot(x1 + R(-3, 3), y1 + f * 4, R(2.5, 4), ["#7a5bc0", "#8f6fd3", "#6a4bb0"][f % 3]!);
        }
        for (let k = 0; k < 24; k++) leafBlade(R(70, 186), base, R(30, 60), R(-1, 1), 3, "#8aa37a");
        break;
      case "roses":
        for (let k = 0; k < 60; k++) dot(R(40, 216), R(90, 250), R(10, 22), G());
        for (let k = 0; k < 18; k++) {
          const x = R(50, 206), y = R(80, 200), rr = R(9, 14);
          const col = ["#c8102e", "#e0245e", "#b0102a", "#f06a8a"][k % 4]!;
          dot(x, y, rr, col);
          dot(x - rr * 0.25, y - rr * 0.25, rr * 0.6, "#ffffff22");
          g.strokeStyle = "#00000040";
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, rr * 0.55, 0, 5);
          g.stroke();
        }
        break;
      case "allium":
        for (let k = 0; k < 10; k++) leafBlade(R(90, 166), base, R(30, 50), R(-1.2, 1.2), 5, G());
        for (let k = 0; k < 6; k++) {
          const x = R(40, 216), y = R(30, 110);
          stem(R(100, 156), base, x, y, "#6d8f4a", 3);
          for (let f = 0; f < 70; f++) {
            const a = R(0, Math.PI * 2), d = Math.sqrt(r()) * 20;
            dot(x + Math.cos(a) * d, y + Math.sin(a) * d, R(2, 3.5), ["#8a3fc7", "#a35ae0", "#7332b0"][f % 3]!);
          }
        }
        break;
      case "tulips":
        for (let k = 0; k < 16; k++) leafBlade(R(50, 206), base, R(50, 90), R(-0.5, 0.5), 9, "#5f8f4a");
        for (let k = 0; k < 14; k++) {
          const x = R(40, 216), y = R(60, 130);
          stem(x + R(-8, 8), base, x, y, "#5f8f4a", 3);
          const col = ["#e2231a", "#f5c400", "#ffffff", "#ef5a8a", "#ff7a00"][k % 5]!;
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x - 10, y - 10);
          g.quadraticCurveTo(x - 12, y + 14, x, y + 14);
          g.quadraticCurveTo(x + 12, y + 14, x + 10, y - 10);
          g.lineTo(x + 4, y - 3);
          g.lineTo(x, y - 12);
          g.lineTo(x - 4, y - 3);
          g.fill();
        }
        break;
      case "strelitzia":
        for (let k = 0; k < 9; k++) {
          const a = R(-0.7, 0.7), len = R(110, 170);
          stem(128, base, 128 + Math.sin(a) * len * 0.6, base - Math.cos(a) * len * 0.6, "#4f7a40", 4);
          leafBlade(128 + Math.sin(a) * len * 0.45, base - Math.cos(a) * len * 0.45, len * 0.6, a, 20, ["#3d6b4a", "#4a7a56"][k % 2]!);
        }
        for (let k = 0; k < 4; k++) {
          const x = R(60, 196), y = R(40, 100);
          stem(128, base, x, y + 10, "#4f7a40", 4);
          g.fillStyle = "#4a6a3a";
          g.beginPath();
          g.moveTo(x - 26, y + 12);
          g.lineTo(x + 18, y + 4);
          g.lineTo(x - 22, y + 20);
          g.fill();
          for (let f = 0; f < 4; f++) {
            g.fillStyle = "#ff8a00";
            g.beginPath();
            g.moveTo(x - 6 + f * 4, y + 8);
            g.lineTo(x - 2 + f * 6, y - 22 - f * 3);
            g.lineTo(x + 2 + f * 4, y + 6);
            g.fill();
          }
          g.fillStyle = "#3b4fd0";
          g.beginPath();
          g.moveTo(x, y + 6);
          g.lineTo(x + 14, y - 14);
          g.lineTo(x + 6, y + 6);
          g.fill();
        }
        break;
      case "canna":
        for (let k = 0; k < 8; k++) leafBlade(R(90, 166), base, R(80, 150), R(-0.6, 0.6), 18, ["#6b3a2a", "#5a7a2e", "#7a4a2a"][k % 3]!);
        for (let k = 0; k < 4; k++) {
          const x = R(70, 186), y = R(20, 60);
          stem(128, base, x, y + 30, "#5a6a2e", 4);
          for (let f = 0; f < 7; f++) dot(x + R(-12, 12), y + R(0, 34), R(7, 11), ["#e8301c", "#ff5a1f", "#f2a100"][f % 3]!);
        }
        break;
      case "salvia":
        for (let k = 0; k < 22; k++) leafBlade(R(70, 186), base, R(30, 60), R(-1, 1), 6, G());
        for (let k = 0; k < 28; k++) {
          const x0 = R(60, 196), x1 = x0 + R(-25, 25), y1 = R(40, 110);
          stem(x0, base, x1, y1, "#4d6b3a", 2);
          for (let f = 0; f < 14; f++) dot(x1 + R(-2, 2), y1 + f * 4, R(2.5, 3.5), ["#3b2fa8", "#4d3ec2", "#2c2290"][f % 3]!);
        }
        break;
      case "grass":
        for (let k = 0; k < 70; k++) {
          const a = R(-0.9, 0.9), len = R(100, 200);
          g.strokeStyle = ["#8f9a5a", "#a3a86a", "#7a8a4a"][k % 3]!;
          g.lineWidth = R(1.5, 3);
          g.beginPath();
          g.moveTo(128, base);
          g.quadraticCurveTo(128 + Math.sin(a) * len * 0.5, base - len * 0.7, 128 + Math.sin(a) * len * 0.9, base - Math.cos(a) * len * 0.75);
          g.stroke();
        }
        for (let k = 0; k < 16; k++) {
          const a = R(-0.7, 0.7), len = R(150, 220);
          const x = 128 + Math.sin(a) * len * 0.8, y = base - Math.cos(a) * len * 0.8;
          for (let f = 0; f < 30; f++) dot(x + R(-5, 5), y + R(-16, 16), R(1.5, 3), ["#e8d9b0", "#d9c690", "#f2e6c4"][f % 3]!);
        }
        break;
      case "gaura":
        for (let k = 0; k < 40; k++) {
          const x0 = R(80, 176), x1 = x0 + R(-80, 80), y1 = R(20, 140);
          stem(x0, base, x1, y1, "#6a7a40", 1.5);
          for (let f = 0; f < 4; f++) dot(x1 + R(-6, 6), y1 + R(-6, 12), R(3, 5), r() < 0.8 ? "#fbf7f2" : "#f4c6d6");
        }
        break;
      case "coreopsis":
        for (let k = 0; k < 60; k++) dot(R(30, 226), R(150, 252), R(8, 16), G());
        for (let k = 0; k < 40; k++) {
          const x = R(30, 226), y = R(120, 230);
          for (let p = 0; p < 8; p++) {
            const a = (p / 8) * Math.PI * 2;
            dot(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4, k % 3 ? "#ffc400" : "#ff8f1f");
          }
          dot(x, y, 3, "#7a3b10");
        }
        break;
      case "foliage":
        // low green groundcover mound that hides the mulch between the flowers
        for (let k = 0; k < 140; k++) dot(R(10, 246), R(110 + Math.abs(k % 40 - 20) * 2, 254), R(7, 15), G());
        for (let k = 0; k < 40; k++) leafBlade(R(20, 236), base, R(40, 90), R(-1.2, 1.2), 8, G());
        break;
      case "bougainvillea":
        for (let k = 0; k < 70; k++) dot(R(20, 236), R(20, 250), R(8, 16), G());
        for (let k = 0; k < 120; k++) dot(R(20, 236), R(10, 230), R(5, 9), ["#d6266f", "#e83e8c", "#b5175a", "#f05aa0"][k % 4]!);
        break;
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  atlasCache = t;
  return t;
}

/** Plant card: 2–3 crossed vertical quads with UVs into an atlas cell, base at y = 0, 1 m tall, 1 m wide. */
function plantGeometry(cell: number, cards = 3): THREE.BufferGeometry {
  const u0 = (cell % 4) / 4;
  const v1 = 1 - Math.floor(cell / 4) / 4;
  const v0 = v1 - 0.25;
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < cards; k++) {
    const q = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY((k / cards) * Math.PI);
    const uv = q.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.25 * 0.996 + 0.0005, v0 + uv.getY(i) * 0.25 * 0.996 + 0.0005);
    // normals point up-ish so cards are lit like foliage from both sides (no dark backs)
    const n = q.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.35, 0.94, n.getZ(i) * 0.35);
    parts.push(q);
  }
  return mergeGeometries(parts)!;
}

interface PlantDef {
  cell: CellId;
  h: [number, number];
  w: number;
  spacing: number;
}
const PLANTS: Record<CellId, PlantDef> = {
  agapanthus: { cell: "agapanthus", h: [0.75, 0.95], w: 0.7, spacing: 0.42 },
  lavender: { cell: "lavender", h: [0.5, 0.65], w: 0.62, spacing: 0.36 },
  roses: { cell: "roses", h: [0.6, 0.8], w: 0.7, spacing: 0.45 },
  allium: { cell: "allium", h: [0.8, 1.0], w: 0.55, spacing: 0.4 },
  tulips: { cell: "tulips", h: [0.4, 0.5], w: 0.48, spacing: 0.3 },
  strelitzia: { cell: "strelitzia", h: [1.1, 1.4], w: 1.0, spacing: 0.75 },
  canna: { cell: "canna", h: [1.1, 1.45], w: 0.8, spacing: 0.6 },
  salvia: { cell: "salvia", h: [0.5, 0.65], w: 0.55, spacing: 0.34 },
  grass: { cell: "grass", h: [0.9, 1.2], w: 0.9, spacing: 0.6 },
  gaura: { cell: "gaura", h: [0.6, 0.8], w: 0.7, spacing: 0.42 },
  coreopsis: { cell: "coreopsis", h: [0.35, 0.45], w: 0.55, spacing: 0.32 },
  bougainvillea: { cell: "bougainvillea", h: [1.8, 2.2], w: 1.4, spacing: 0.9 },
  foliage: { cell: "foliage", h: [0.28, 0.4], w: 0.75, spacing: 0.45 },
};

interface Plant {
  id: CellId;
  x: number;
  y: number;
  z: number;
  h: number;
  w: number;
  rot: number;
}

/** Fill a shape with plants: rows from back (tall) to front (low), species in repeating drifts along the bed. */
function fillBed(out: Plant[], inside: (x: number, z: number) => number | null, bbox: [number, number, number, number], y: number, palette: CellId[][], density: number, r: () => number, drift: (x: number, z: number) => number) {
  const [x0, z0, x1, z1] = bbox;
  const step = 0.26 / Math.sqrt(density);
  for (let x = x0; x <= x1; x += step)
    for (let z = z0; z <= z1; z += step) {
      const px = x + (r() - 0.5) * step * 0.8;
      const pz = z + (r() - 0.5) * step * 0.8;
      const depth = inside(px, pz); // 0 = back edge … 1 = front edge, null = outside
      if (depth === null) continue;
      const row = palette[Math.min(palette.length - 1, Math.floor(depth * palette.length))]!;
      const id = row[(driftCell(px + drift(px, pz) * 0.37, pz) % row.length + row.length) % row.length]!;
      const d = PLANTS[id];
      // thin out large plants so spacing roughly matches their size
      if (r() > (step / d.spacing) ** 2 * 1.4) continue;
      out.push({ id, x: px, y, z: pz, h: d.h[0] + r() * (d.h[1] - d.h[0]), w: d.w * (1.05 + r() * 0.35), rot: r() * Math.PI });
      if (r() < 0.8) out.push({ id: "foliage", x: px + (r() - 0.5) * step, y, z: pz + (r() - 0.5) * step, h: 0.3 + r() * 0.12, w: 0.8, rot: r() * Math.PI });
    }
}

/**
 * Calm, designed palettes: 2–3 colour families per bed + ONE accent (repeated entries = weights), graded from tall
 * at the back to low at the front, planted in single-species drifts.
 */
const PALETTES: CellId[][][] = [
  // back (outer) → front (inner)
  [["grass", "grass", "grass", "strelitzia"], ["agapanthus", "agapanthus", "gaura"], ["lavender"]],
  [["grass", "grass", "grass", "canna"], ["lavender", "lavender", "allium"], ["gaura", "salvia"]],
  [["grass", "grass", "agapanthus"], ["agapanthus", "roses"], ["lavender", "gaura"]],
];

/** Single-species drifts: jittered 1.6 m Voronoi-like cells, one species per cell. */
function driftCell(x: number, z: number): number {
  const s = 1.6;
  const wx = x + Math.sin(z * 0.7) * 0.5;
  const wz = z + Math.sin(x * 0.6) * 0.5;
  let h = Math.imul(Math.floor(wx / s) | 0, 374761393) + Math.imul(Math.floor(wz / s) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 1000;
}

function arcInside(b: ArcBed, edgePad = 0.12) {
  return (x: number, z: number) => {
    const dx = x - b.cx;
    const dz = z - b.cz;
    const rad = Math.hypot(dx, dz);
    if (rad < b.r0 + edgePad || rad > b.r1 - edgePad) return null;
    let deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
    if (b.a0 > 0 && deg < 0) deg += 360;
    if (deg < b.a0 + 0.6 || deg > b.a1 - 0.6) return null;
    return 1 - (rad - b.r0) / (b.r1 - b.r0); // outer edge = back row
  };
}
function arcBox(b: ArcBed): [number, number, number, number] {
  const pts = [0, 0.25, 0.5, 0.75, 1].flatMap((t) => [arcPoint(b, b.a0 + (b.a1 - b.a0) * t, b.r0), arcPoint(b, b.a0 + (b.a1 - b.a0) * t, b.r1)]);
  return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.z)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.z))];
}
function rectLocal(b: RectBed) {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return (x: number, z: number) => {
    const dx = x - b.x;
    const dz = z - b.z;
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  };
}
const toWorld = (b: RectBed, lx: number, lz: number) => {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
};

/* ---------------- bed structures (merged per material) ---------------- */
function bedStructures(tier: Tier) {
  const seg = tier === "lite" ? 20 : 40;
  const edge: THREE.BufferGeometry[] = []; // light concrete / corten edges
  const corten: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  const soil: THREE.BufferGeometry[] = [];
  const hedge: THREE.BufferGeometry[] = [];
  const trellis: THREE.BufferGeometry[] = [];
  const lights: { x: number; y: number; z: number }[] = [];
  const flatRing = (r0: number, r1: number, t0: number, tl: number, y: number) => new THREE.RingGeometry(r0, r1, Math.max(8, Math.round(seg * (tl / (Math.PI * 2)) * 2)), 1, t0, tl).rotateX(-Math.PI / 2).translate(0, y, 0);
  // round planters: concrete wall, black steel rim, mulch
  for (const p of RING_PLANTERS) {
    edge.push(new THREE.CylinderGeometry(p.r, p.r, p.h, seg, 1, true).translate(p.x, p.h / 2, p.z));
    steel.push(flatRing(p.r - 0.12, p.r + 0.01, 0, Math.PI * 2, p.h + 0.005).translate(p.x, 0, p.z));
    soil.push(new THREE.CircleGeometry(p.r - 0.1, seg).rotateX(-Math.PI / 2).translate(p.x, p.h - 0.04, p.z));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      lights.push({ x: p.x + Math.cos(a) * (p.r - 0.35), y: p.h - 0.04, z: p.z + Math.sin(a) * (p.r - 0.35) });
    }
  }
  // arc beds with corten steel walls
  for (const b of [...PLAZA_ARCS, ...GATE_ARCS]) {
    const t0 = Math.PI - (b.a1 * Math.PI) / 180;
    const tl = ((b.a1 - b.a0) * Math.PI) / 180;
    for (const rr of [b.r0, b.r1]) corten.push(new THREE.CylinderGeometry(rr, rr, b.h, Math.max(6, Math.round(seg * tl)), 1, true, t0, tl).translate(b.cx, b.h / 2, b.cz));
    for (const a of [b.a0, b.a1]) {
      const p = arcPoint(b, a, (b.r0 + b.r1) / 2);
      corten.push(new THREE.BoxGeometry(b.r1 - b.r0, b.h, 0.03).rotateY(-(a * Math.PI) / 180 + Math.PI / 2).translate(p.x, b.h / 2, p.z));
    }
    const ringT0 = Math.PI / 2 - (b.a1 * Math.PI) / 180;
    soil.push(flatRing(b.r0, b.r1, ringT0, tl, b.h - 0.05).translate(b.cx, 0, b.cz));
    const n = Math.max(2, Math.floor((tl * b.r1) / 4));
    for (let k = 0; k < n; k++) {
      const p = arcPoint(b, b.a0 + ((k + 0.5) / n) * (b.a1 - b.a0), b.r0 + 0.25);
      lights.push({ x: p.x, y: b.h - 0.05, z: p.z });
    }
  }
  // rectangular beds (avenue + lawns): concrete kerb, mulch, optional clipped hedge and bougainvillea trellis
  for (const b of [...AVENUE_BEDS, ...LAWN_BEDS, ...PLAZA_BEDS]) {
    const frame = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
      g.rotateY(b.rot).translate(b.x, 0, b.z);
      return g;
    };
    edge.push(box(b.hw * 2 + 0.16, b.h, 0.08, 0, b.h / 2, b.hd + 0.04), box(b.hw * 2 + 0.16, b.h, 0.08, 0, b.h / 2, -b.hd - 0.04));
    edge.push(box(0.08, b.h, b.hd * 2, b.hw + 0.04, b.h / 2, 0), box(0.08, b.h, b.hd * 2, -b.hw - 0.04, b.h / 2, 0));
    soil.push(box(b.hw * 2, 0.02, b.hd * 2, 0, b.h - 0.05, 0));
    if (b.hedge) {
      // walkway side: towards the avenue centre / towards the plaza
      const side = Math.abs(b.rot) < 1e-3 ? (b.x > 0 ? -1 : 1) : 1;
      const hx = Math.abs(b.rot) < 1e-3 ? side * (b.hw - 0.3) : 0;
      const hz = Math.abs(b.rot) < 1e-3 ? 0 : b.hd - 0.3;
      hedge.push(Math.abs(b.rot) < 1e-3 ? box(0.5, 0.55, b.hd * 2 - 0.2, hx, b.h + 0.22, hz) : box(b.hw * 2 - 0.2, 0.55, 0.5, hx, b.h + 0.22, hz));
    }
    if (b.trellis) {
      const l = toWorld(b, 0, -b.hd + 0.15);
      for (let k = -2; k <= 2; k++) {
        const p = toWorld(b, (k / 2) * (b.hw - 0.2), -b.hd + 0.15);
        trellis.push(new THREE.BoxGeometry(0.06, 2.4, 0.06).translate(p.x, b.h + 1.2, p.z));
      }
      for (const y of [0.9, 1.6, 2.3]) trellis.push(new THREE.BoxGeometry(b.hw * 2 - 0.3, 0.04, 0.04).rotateY(b.rot).translate(l.x, b.h + y, l.z));
    }
    for (const k of [-0.6, 0, 0.6]) {
      const p = toWorld(b, k * b.hw, 0.0);
      lights.push({ x: p.x, y: b.h - 0.05, z: p.z });
    }
    void frame;
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
    flat.forEach((g) => {
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute("position") as THREE.BufferAttribute).count * 2), 2));
    });
    const m = flat.length ? mergeGeometries(flat, false) : null;
    list.forEach((g) => g.dispose());
    return m;
  };
  return { edge: merge(edge), corten: merge(corten), steel: merge(steel), soil: merge(soil), hedge: merge(hedge), trellis: merge(trellis), lights };
}

function noiseTex(base: string, spots: string[], scale = 1, seed = 3): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600 * scale; i++) {
    g.fillStyle = spots[i % spots.length]!;
    g.globalAlpha = 0.35 + r() * 0.5;
    g.beginPath();
    g.arc(r() * 256, r() * 256, 1 + r() * 3.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Distance LOD for the flower drifts (no extra draw calls): beyond ~30 m a stable, hash-chosen share of the plants
 * collapses to a point in the vertex shader (degenerate triangles cost no fill), thinning to ~25 % at 100 m and
 * nothing past ~160 m. Up close every plant is drawn; far away the beds still read as colour, at a fraction of the
 * alpha-tested overdraw (the expensive part on phones). Lite thins sooner.
 */
function addDistanceThinning(mat: THREE.Material, lite: boolean) {
  const [near, far, cull] = lite ? [22, 80, 120] : [30, 100, 160];
  const prev = mat.onBeforeCompile.bind(mat);
  const key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#ifdef USE_INSTANCING
      {
        vec3 gkP = instanceMatrix[3].xyz;
        float gkD = distance(gkP.xz, cameraPosition.xz);
        float gkKeep = gkD > ${cull.toFixed(1)} ? 0.0 : 1.0 - smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, gkD) * 0.75;
        float gkR = fract(sin(dot(gkP.xz, vec2(12.9898, 78.233))) * 43758.5453);
        if (gkR > gkKeep) transformed = vec3(0.0);
      }
      #endif
      #include <project_vertex>`,
    );
  };
  mat.customProgramCacheKey = () => `${key()}-thin${lite ? "L" : "S"}`;
}

/* ---------------- component ---------------- */
export function Flowers({ tier }: { tier: Tier }) {
  const lite = tier === "lite";
  // seeded placements, bed meshes and the flower cards are built once per session and shared by every mount (the
  // plaza and the halls' window views); only the instanced meshes themselves are per mount
  const plants = useMemo(() => sessionMemo(`flowers:plants:${lite}`, () => {
    const r = rng(2024);
    const out: Plant[] = [];
    const density = lite ? 0.45 : 1;
    const drift = (x: number, z: number) => Math.floor((Math.atan2(x, z) * 9 + Math.hypot(x, z) * 0.15 + 50) * 1.3);
    RING_PLANTERS.forEach((p, i) => {
      const pal = PALETTES[i % PALETTES.length]!;
      fillBed(
        out,
        (x, z) => {
          const d = Math.hypot(x - p.x, z - p.z);
          return d > p.r - 0.18 ? null : d / (p.r - 0.18); // centre = tall back row, rim = low front
        },
        [p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r],
        p.h - 0.04,
        pal,
        density,
        r,
        (x, z) => Math.floor(Math.atan2(x - p.x, z - p.z) * 1.6 + 8),
      );
    });
    PLAZA_ARCS.forEach((b, i) => fillBed(out, arcInside(b), arcBox(b), b.h - 0.05, PALETTES[(i + 1) % PALETTES.length]!, density, r, drift));
    GATE_ARCS.forEach((b, i) => fillBed(out, arcInside(b), arcBox(b), b.h - 0.05, PALETTES[i % PALETTES.length]!, density, r, drift));
    [...AVENUE_BEDS, ...LAWN_BEDS, ...PLAZA_BEDS].forEach((b, i) => {
      const local = rectLocal(b);
      const pal = PALETTES[i % PALETTES.length]!;
      const ext = Math.hypot(b.hw, b.hd);
      fillBed(
        out,
        (x, z) => {
          const { lx, lz } = local(x, z);
          if (Math.abs(lx) > b.hw - 0.12 || Math.abs(lz) > b.hd - 0.12) return null;
          if (b.hedge && Math.abs(b.rot) < 1e-3 && (b.x > 0 ? lx < -b.hw + 0.65 : lx > b.hw - 0.65)) return null;
          if (b.hedge && Math.abs(b.rot) >= 1e-3 && lz > b.hd - 0.65) return null;
          if (b.trellis && lz < -b.hd + 0.6) return null;
          return Math.abs(b.rot) < 1e-3 ? (b.x > 0 ? 1 - (lx + b.hw) / (2 * b.hw) : (lx + b.hw) / (2 * b.hw)) : (lz + b.hd) / (2 * b.hd);
        },
        [b.x - ext, b.z - ext, b.x + ext, b.z + ext],
        b.h - 0.05,
        pal,
        density * (Math.hypot(b.x, b.z) > PLAZA_RADIUS + 22 ? 0.6 : 1),
        r,
        (x, z) => Math.floor((local(x, z).lx + 20) / 1.8),
      );
      if (b.trellis)
        for (let k = -2; k <= 2; k++) {
          const p = toWorld(b, (k / 2) * (b.hw - 0.4), -b.hd + 0.32);
          out.push({ id: "bougainvillea", x: p.x, y: b.h - 0.05, z: p.z, h: 2.3, w: 1.6, rot: b.rot + (k % 2) * 0.3 });
        }
    });
    return out;
  }), [lite]);

  const structures = useMemo(() => sessionMemo(`flowers:beds:${tier}`, () => bedStructures(tier)), [tier]);
  const mats = useMemo(() => sessionMemo(`flowers:mats:${tier}`, () => {
    const w = worldMaterials(tier);
    return {
      edge: (w["concrete"] as THREE.MeshStandardMaterial | undefined) ?? new THREE.MeshStandardMaterial({ color: "#e4e0d8", roughness: 0.85 }),
      corten: new THREE.MeshStandardMaterial({ map: noiseTex("#7a3d1c", ["#5a2a12", "#9a5228", "#6b3418", "#b0642e"], 1, 5), roughness: 0.78, metalness: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ color: "#1b1c1f", roughness: 0.35, metalness: 0.8 }),
      soil: new THREE.MeshStandardMaterial({ map: noiseTex("#2b2017", ["#3d2c1e", "#1d150f", "#4a3624"], 1.4, 9), roughness: 1 }),
      hedge: new THREE.MeshStandardMaterial({ map: noiseTex("#2f5a24", ["#3d7230", "#24481b", "#4f8a3a", "#1d3a16"], 2.2, 13), roughness: 0.9 }),
      trellis: new THREE.MeshStandardMaterial({ color: "#222326", roughness: 0.5, metalness: 0.6 }),
      light: new THREE.MeshStandardMaterial({ color: "#2a2a2a", emissive: new THREE.Color("#ffd9a0"), emissiveIntensity: 1.4, roughness: 0.4 }),
    };
  }), [tier]);

  const cards = useMemo(() => sessionMemo(`flowers:cards:${lite}`, () => {
    const atlas = flowerAtlas();
    const byId = new Map<CellId, Plant[]>();
    for (const p of plants) {
      const l = byId.get(p.id) ?? [];
      l.push(p);
      byId.set(p.id, l);
    }
    const out: { geo: THREE.BufferGeometry; mat: THREE.Material; matrices: Float32Array; colors: Float32Array; count: number }[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const [id, list] of byId) {
      const geo = plantGeometry(CELLS.indexOf(id), id === "grass" || id === "strelitzia" || id === "bougainvillea" ? 3 : 2);
      const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
      addWind(mat, id === "grass" ? 0.08 : id === "bougainvillea" ? 0.02 : 0.05);
      addDistanceThinning(mat, lite);
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 3);
      list.forEach((p, i) => {
        m4.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rot), new THREE.Vector3(p.w, p.h, p.w));
        m4.toArray(matrices, i * 16);
        col.setHSL(0, 0, 0.88 + ((i * 7919) % 100) / 800).toArray(colors, i * 3);
      });
      out.push({ geo, mat, matrices, colors, count: list.length });
    }
    return out;
  }), [plants, lite]);
  const flowerMeshes = useMemo(
    () =>
      cards.map((c) => {
        const im = new THREE.InstancedMesh(c.geo, c.mat, c.count);
        im.instanceMatrix.array.set(c.matrices);
        im.instanceColor = new THREE.InstancedBufferAttribute(c.colors.slice(), 3);
        im.castShadow = false;
        im.receiveShadow = !lite;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        return im;
      }),
    [cards, lite],
  );
  useEffect(() => () => flowerMeshes.forEach((m) => m.dispose()), [flowerMeshes]);

  const lights = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.045, 0.06, 0.1, 10).translate(0, 0.05, 0);
    const im = new THREE.InstancedMesh(g, mats.light, Math.max(1, structures.lights.length));
    const m4 = new THREE.Matrix4();
    structures.lights.forEach((l, i) => im.setMatrixAt(i, m4.makeTranslation(l.x, l.y, l.z)));
    im.count = structures.lights.length;
    return im;
  }, [structures, mats.light]);

  // uplights brighten as the sky darkens later (cosmetic, cheap): gentle breathing glow for now
  useFrame(({ clock }) => {
    mats.light.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 0.8) * 0.1;
  });

  const shadow = !lite;
  return (
    <group>
      {structures.edge && <mesh geometry={structures.edge} material={mats.edge} receiveShadow={shadow} castShadow={shadow} />}
      {structures.corten && <mesh geometry={structures.corten} material={mats.corten} receiveShadow={shadow} castShadow={shadow} />}
      {structures.steel && <mesh geometry={structures.steel} material={mats.steel} />}
      {structures.soil && <mesh geometry={structures.soil} material={mats.soil} receiveShadow={shadow} />}
      {structures.hedge && <mesh geometry={structures.hedge} material={mats.hedge} receiveShadow={shadow} castShadow={shadow} />}
      {structures.trellis && <mesh geometry={structures.trellis} material={mats.trellis} castShadow={shadow} />}
      <primitive object={lights} />
      {flowerMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
