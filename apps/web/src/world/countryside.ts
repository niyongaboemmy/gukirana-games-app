import * as THREE from "three";
import { rng } from "./textures";

/**
 * Musanze countryside around the campus (P2-WLD-11): red laterite roads, a meandering river and a stream into
 * Lake Ruhondo, and roadside villages (imidugudu). Pure, seeded data plus one small mask texture the terrain shader
 * samples (world/Landscape.tsx): R = road, G = water (core) / riverbank (soft), B = swept-earth house compounds.
 *
 * Everything here starts at the campus edge (`outside`, the compound plus its frontage: world/campus.ts) and only
 * looks outwards, so it does not depend on where the campus buildings stand inside it.
 */

export interface Pt {
  x: number;
  z: number;
}

/** The mask covers ±MASK_HALF m around the campus centre (beyond it the fields simply carry on). */
export const MASK_HALF = 820;

const polar = (deg: number, r: number): Pt => ({ x: Math.sin((deg * Math.PI) / 180) * r, z: -Math.cos((deg * Math.PI) / 180) * r });

/** Chaikin corner cutting: smooth, natural curves from a coarse random walk. */
function chaikin(p: Pt[], rounds = 2): Pt[] {
  let a = p;
  for (let k = 0; k < rounds; k++) {
    const o: Pt[] = [a[0]!];
    for (let i = 0; i < a.length - 1; i++) {
      const p0 = a[i]!;
      const p1 = a[i + 1]!;
      o.push({ x: p0.x * 0.75 + p1.x * 0.25, z: p0.z * 0.75 + p1.z * 0.25 }, { x: p0.x * 0.25 + p1.x * 0.75, z: p0.z * 0.25 + p1.z * 0.75 });
    }
    o.push(a[a.length - 1]!);
    a = o;
  }
  return a;
}

/** Distance from a point to a polyline (m). */
export function polyDist(x: number, z: number, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

export interface Countryside {
  roads: Pt[][];
  rivers: { line: Pt[]; w: number }[];
  /** village houses: position, facing (rad) and a 0..1 hash for the variant */
  houses: { x: number; z: number; rot: number; k: number }[];
}

/** The public road along the campus frontage (world/campus.ts PUBLIC_ROAD): country roads meet it as junctions. */
export interface FrontRoad {
  /** centre line z, kerb lines */
  mid: number;
  z0: number;
  z1: number;
  x0: number;
  x1: number;
}

/**
 * Roads wander out from the campus edge (gentle seeded random walks that turn away from water), plus one long
 * country road across the southern hills; the river curls round the west and south, a stream runs into the lake.
 *
 * `outside(x, z)`: how far (m) a point lies outside the campus (≤ 0 inside; world/campus.ts campusOutside): the
 * compound with its south frontage up to the public road. Two of the roads start as junctions on the public road
 * (laterite meeting the asphalt); no road ever enters the campus or runs along the public road.
 */
export function buildCountryside(outside: (x: number, z: number) => number, isWater: (x: number, z: number) => boolean, lakeCentre: Pt, front: FrontRoad): Countryside {
  const r = rng(911);
  const roads: Pt[][] = [];
  /** where a road out of the campus starts: on the campus edge along the bearing */
  const edgeAt = (deg: number): Pt => {
    for (let rad = 60; rad < MASK_HALF; rad += 1) {
      const q = polar(deg, rad);
      if (outside(q.x, q.z) > 1) return q;
    }
    return polar(deg, MASK_HALF - 40);
  };
  const nearFront = (q: Pt) => Math.abs(q.z - front.mid) < (front.z1 - front.z0) / 2 + 14;
  for (const s of [
    // junctions on the public road (south kerb), heading off into the southern hills
    { p: { x: -64, z: front.z1 + 0.4 }, deg: 196, len: 34 },
    { p: { x: -262, z: front.z1 + 0.4 }, deg: 214, len: 30 },
    // tracks from the campus edge out to the north-east and north-west farms
    { p: edgeAt(52), deg: 52, len: 26 },
    { p: edgeAt(-62), deg: -62, len: 22 },
  ]) {
    let p = s.p;
    let head = (s.deg * Math.PI) / 180;
    const pts: Pt[] = [p];
    for (let i = 0; i < s.len; i++) {
      let ok = false;
      for (let tries = 0; tries < 6 && !ok; tries++) {
        const h = head + (r() - 0.5) * 0.5 + (tries ? (tries % 2 ? 1 : -1) * 0.45 * tries : 0);
        const q = { x: p.x + Math.sin(h) * 22, z: p.z - Math.cos(h) * 22 };
        if (isWater(q.x, q.z) || outside(q.x, q.z) < 8 * Math.min(i + 1, 3) || nearFront(q)) continue;
        // drift back towards "outwards" so a road never curls round into the campus
        const out = Math.atan2(q.x, -q.z);
        head = h + Math.atan2(Math.sin(out - h), Math.cos(out - h)) * 0.12;
        p = q;
        ok = true;
      }
      if (!ok || Math.hypot(p.x, p.z) > MASK_HALF - 30) break;
      pts.push(p);
    }
    if (pts.length > 3) roads.push(chaikin(pts));
  }
  // the country road over the southern hills (bearing 125° → 265°), radius wandering round the lakes
  {
    const pts: Pt[] = [];
    for (let deg = 125; deg <= 265; deg += 6) {
      const rad = 360 + 46 * Math.sin(deg * 0.09) + (r() - 0.5) * 20;
      const q = polar(deg, rad);
      if (!isWater(q.x, q.z)) pts.push(q);
    }
    roads.push(chaikin(pts));
  }
  // the river: a broad meander round the west and south, beyond the country road
  const rivers: { line: Pt[]; w: number }[] = [];
  {
    const pts: Pt[] = [];
    for (let deg = -40; deg >= -215; deg -= 5) pts.push(polar(deg, 560 + 55 * Math.sin(deg * 0.11) + (r() - 0.5) * 24));
    rivers.push({ line: chaikin(pts, 3), w: 9 });
  }
  // a stream from the southern hills down into the lake
  {
    const a = polar(165, 700);
    const pts: Pt[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const x = a.x + (lakeCentre.x - a.x) * t;
      const z = a.z + (lakeCentre.z - a.z) * t;
      const nx = -(lakeCentre.z - a.z);
      const nz = lakeCentre.x - a.x;
      const nl = Math.hypot(nx, nz) || 1;
      const m = Math.sin(t * Math.PI * 4.5) * 26 * (1 - t * 0.5) + (r() - 0.5) * 10;
      const q = { x: x + (nx / nl) * m, z: z + (nz / nl) * m };
      pts.push(q);
      if (isWater(q.x, q.z)) break;
    }
    rivers.push({ line: chaikin(pts, 3), w: 5 });
  }
  // roadside villages: rows of houses either side of the road, facing it (2–3 per road, 260–680 m out)
  const houses: Countryside["houses"] = [];
  const clear = (x: number, z: number) =>
    !isWater(x, z) &&
    outside(x, z) > 25 &&
    Math.abs(z - front.mid) > 12 &&
    roads.every((l) => polyDist(x, z, l) > 6.5) &&
    rivers.every((v) => polyDist(x, z, v.line) > v.w + 8) &&
    houses.every((h) => Math.hypot(h.x - x, h.z - z) > 8.5);
  for (const line of roads) {
    let last = -1e9;
    for (let i = 2; i < line.length - 2; i++) {
      const c = line[i]!;
      const rc = Math.hypot(c.x, c.z);
      if (rc < 250 || rc > 690 || i - last < 26 || r() > 0.32) continue;
      last = i;
      const n = 8 + Math.floor(r() * 9);
      for (let k = 0; k < n; k++) {
        const j = Math.min(line.length - 2, Math.max(1, i + Math.round((k - n / 2) * 1.6)));
        const a = line[j]!;
        const b = line[j + 1]!;
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const tl = Math.hypot(tx, tz) || 1;
        const side = k % 2 ? 1 : -1;
        const off = 10 + r() * 7 + (r() < 0.3 ? 14 : 0); // a second row behind the first here and there
        const x = a.x + (-tz / tl) * off * side + (r() - 0.5) * 3;
        const z = a.z + (tx / tl) * off * side + (r() - 0.5) * 3;
        if (clear(x, z)) houses.push({ x, z, rot: Math.atan2(tx, tz) + (r() - 0.5) * 0.2, k: r() });
      }
    }
  }
  // a few houses along the public road (facing it), beyond the campus and across the road from it, never in
  // front of the gate (the arrival view and the bus stop stay open)
  for (const side of [-1, 1])
    for (const dir of [-1, 1]) {
      let x = dir * (45 + r() * 20);
      while (Math.abs(x) < 470) {
        // north of the road only beyond the campus
        const z = side > 0 ? front.z1 + 10 + r() * 5 : front.z0 - 10 - r() * 5;
        if ((side > 0 || Math.abs(x) > 200) && outside(x, z) > 5 && clear(x, z)) houses.push({ x, z, rot: Math.PI / 2 + (r() - 0.5) * 0.16, k: r() });
        x += dir * (14 + r() * (Math.abs(x) < 200 ? 46 : 26));
      }
    }
  return { roads, rivers, houses };
}

/** The mask texture (linear data, no colour space): roads, water and compounds painted in world space. */
export function countrysideMask(c: Countryside, lite: boolean): THREE.CanvasTexture {
  const S = lite ? 512 : 1024;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "lighter";
  const px = (v: number) => ((v + MASK_HALF) / (2 * MASK_HALF)) * S;
  const m = S / (2 * MASK_HALF); // pixels per metre
  g.lineCap = g.lineJoin = "round";
  const stroke = (line: Pt[], w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = Math.max(1, w * m);
    g.beginPath();
    line.forEach((p, i) => (i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))));
    g.stroke();
  };
  // riverbanks (soft, wide) then the water itself
  for (const v of c.rivers) {
    stroke(v.line, v.w * 4.5, "rgba(0,255,0,0.18)");
    stroke(v.line, v.w * 2.4, "rgba(0,255,0,0.22)");
    stroke(v.line, v.w, "rgba(0,255,0,0.7)");
  }
  // roads: a dusty verge, then the laterite carriageway
  for (const l of c.roads) {
    stroke(l, 11, "rgba(255,0,0,0.28)");
    stroke(l, 5.5, "rgba(255,0,0,0.8)");
  }
  // swept-earth compounds round the houses
  for (const h of c.houses) {
    const grd = g.createRadialGradient(px(h.x), px(h.z), 0, px(h.x), px(h.z), 9 * m);
    grd.addColorStop(0, "rgba(0,0,255,0.85)");
    grd.addColorStop(0.6, "rgba(0,0,255,0.5)");
    grd.addColorStop(1, "rgba(0,0,255,0)");
    g.fillStyle = grd;
    g.fillRect(px(h.x) - 9 * m, px(h.z) - 9 * m, 18 * m, 18 * m);
  }
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false; // canvas row = world z
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = lite ? 2 : 4;
  return t;
}
