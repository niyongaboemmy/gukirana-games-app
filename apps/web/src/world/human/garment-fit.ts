import * as THREE from "three";
import type { BodyType, OutfitItem } from "../outfits";
import { weldGroups } from "./head-geometry";
import { FABRIC, type FabricId } from "./skin/skin-shading";

/**
 * P2-AVA-16: tops that follow the chosen item, and modelled collars.
 *
 * The Rocketbox bodies are photographed in their own clothes (feminine: a tailored blazer over a shirt; masculine: an
 * open canvas jacket over a tee; neutral: a zip fleece with a hood), and the look recolours them. On the feminine body
 * that meant every top read as the blazer (lapels, shirt V, collar flaps, pocket flaps) whatever was chosen. Here:
 *
 *  - TOP_CUTS: how each catalogue top is cut on the feminine body (neckline shape and depth, sleeve length, the fabric
 *    weave, whether the tailoring is smoothed away, which collar it has). Item ids are unchanged (saved looks work).
 *  - refitTop: a per-body, per-cut copy of the body geometry (shared by everyone wearing that cut): the front of the
 *    blazer (lapels and their edge strips, the shirt V, collar and pocket flaps, the trousers showing in its front
 *    opening) is replaced by one clean panel laid over a smoothed depth map of the front (frontPanel), the collar band
 *    and lapel roll at the neck fold down into the neck at the chosen neckline and press onto the shoulders, short
 *    sleeves are taken in to the arm below the hem (the skin is painted there by the body shader), and a modelled
 *    collar is appended.
 *  - buildCollar: a modelled shirt collar round the neck: a stand with thickness, a fall folded over it with a finished
 *    lower edge and points at the front; swept as one closed cross-section (clean edges, real thickness), skinned to
 *    the upper chest and neck so it turns and nods with the neck. ~430–650 triangles. It is part of the body mesh (no
 *    new draw call); its UVs sit on a plain back panel of the body texture, shifted by +2 in u (the texture repeats)
 *    so the shader can tell collar fragments apart; the print stays continuous (tri-planar in metres, P2-AVA-15).
 * All of it runs once per body / cut at load (no per-frame work).
 */

export type NeckShape = "crew" | "scoop" | "vee" | "open" | "blazer" | "mock";
export type SleeveCut = "long" | "short" | "elbow";
export type CollarKind = "none" | "shirt" | "stand" | "hood";

export interface TopCut {
  /** cache key */
  id: string;
  neck: NeckShape;
  /** neckline depth below the neck base at the front (m) */
  depth: number;
  sleeve: SleeveCut;
  /** relax the blazer's tailoring (lapels, shirt V, collar / pocket flaps) into a plain front */
  flatten: boolean;
  collar: CollarKind;
  fabric: FabricId;
}

const C = (
  id: string,
  neck: NeckShape,
  depth: number,
  sleeve: SleeveCut,
  collar: CollarKind,
  fabric: FabricId,
  flatten = true,
): TopCut => ({
  id,
  neck,
  depth,
  sleeve,
  flatten,
  collar,
  fabric,
});

/** The feminine cut of every top kind (feminine shapes: a scoop for tees, a softer V, cap / elbow sleeves). */
const CUT_BY_KIND: Record<string, TopCut> = {
  tee: C("tee", "scoop", 0.05, "short", "none", FABRIC.knit),
  jersey: C("jersey", "vee", 0.075, "short", "none", FABRIC.knit),
  hoodie: C("hoodie", "crew", 0.025, "long", "hood", FABRIC.fleece),
  longsleeve: C("track", "mock", 0.0, "long", "stand", FABRIC.knit),
  shirt: C("shirt", "open", 0.06, "elbow", "shirt", FABRIC.cottonTwill),
  sash: C("sash", "scoop", 0.06, "elbow", "none", FABRIC.cottonTwill),
  // the base body's own blazer: tailoring kept, a modelled shirt collar inside the lapels
  blazer: C("blazer", "blazer", 0.12, "long", "shirt", FABRIC.suiting, false),
};

/** The cut of a top on a body: the feminine body gets its own cuts; the other bodies keep their base garment. */
export function topCut(item: OutfitItem | undefined, body: BodyType): TopCut | null {
  if (!item || item.slot !== "top") return null;
  if (body === "feminine") return CUT_BY_KIND[item.kind] ?? CUT_BY_KIND.tee!;
  // masculine / neutral: their base jacket stays; collared tops get the modelled collar
  if (item.kind === "shirt" || item.kind === "blazer")
    return {
      ...CUT_BY_KIND[item.kind]!,
      id: `${item.kind}-collar`,
      flatten: false,
      neck: item.kind === "blazer" ? "blazer" : "open",
      sleeve: "long",
    };
  return null;
}

/** Shader parameters of a cut: [neck shape code, depth (m), sleeve end (m from the shoulder joint, 0 = long), on]. */
export const NECK_CODE: Record<NeckShape, number> = {
  crew: 1,
  scoop: 2,
  vee: 3,
  open: 4,
  blazer: 0,
  mock: 5,
};
export const SLEEVE_END: Record<SleeveCut, number> = { long: 0, short: 0.13, elbow: 0.24 };

/**
 * Neckline: how far below the neck base (m) the fabric edge runs at a point `x` m to the side of the centre line and
 * `front` (0 at the back … 1 at the front) round the neck. Shared by the tests and mirrored in the body / head shaders.
 */
export function necklineDrop(shape: NeckShape, depth: number, x: number, front: number): number {
  const f = THREE.MathUtils.clamp(front, 0, 1);
  const base = shape === "mock" ? -0.025 : shape === "crew" ? 0.0 : 0.006;
  const scoopW = shape === "scoop" ? 0.085 : 0.06;
  if (shape === "vee" || shape === "open")
    return base + depth * f * Math.max(0, 1 - Math.abs(x) / (shape === "open" ? 0.05 : 0.07));
  if (shape === "blazer") return base + depth * f * Math.max(0, 1 - Math.abs(x) / 0.075);
  // crew / scoop / mock: a rounded front
  const r = Math.min(1, Math.abs(x) / scoopW);
  return base + depth * f * Math.sqrt(Math.max(0, 1 - r * r));
}

/* ------------------------------------------------------------------ geometry */

const _v = new THREE.Vector3();

export interface BodyFrame {
  /** bind position of a bone by name (null if absent) */
  bone: (name: string) => THREE.Vector3 | null;
  /** skeleton index of a bone by name (-1 if absent) */
  index: (name: string) => number;
}

export function bodyFrameOf(mesh: THREE.SkinnedMesh): BodyFrame {
  const bones = mesh.skeleton.bones;
  const bi = new THREE.Matrix4().copy(mesh.bindMatrix).invert();
  return {
    index: (n) => bones.findIndex((b) => b.name === n),
    bone: (n) => {
      const i = bones.findIndex((b) => b.name === n);
      if (i < 0) return null;
      const m = new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]!).invert().premultiply(bi);
      return new THREE.Vector3().setFromMatrixPosition(m);
    },
  };
}

/** Depth map of a garment's front over (side, height): front-most surface per cell, the triangle seen there. */
export interface FrontDepth {
  nx: number;
  nz: number;
  cell: number;
  /** cell coordinates of a point */
  S: (p: THREE.Vector3) => number;
  Z: (p: THREE.Vector3) => number;
  /** depth along forward of a point */
  D: (p: THREE.Vector3) => number;
  F: THREE.Vector3;
  L: THREE.Vector3;
  /** raw front depth (−∞ = nothing), holes filled, smoothed */
  raw: Float64Array;
  fill: Float64Array;
  smooth: Float64Array;
  /** triangle (index offset) and barycentrics seen in each cell (−1 = none) */
  tri: Int32Array;
  bary: Float32Array;
  sample: (m: Float64Array, sx: number, sz: number) => number;
}

const NEIGH4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Rasterise the front-facing triangles of the included region into a depth map over (side, height) — the front-most
 * surface wins — fill its holes from the neighbours and blur it (`blur` m) so steps (lapel edges, flaps, the shirt V
 * recess, buttons) melt into the broad form (bust, belly, hips).
 */
export function frontDepth(
  geo: THREE.BufferGeometry,
  o: {
    centre: THREE.Vector3;
    forward: THREE.Vector3;
    xMax: number;
    zMin: number;
    zMax: number;
    include: (i: number) => boolean;
    cell?: number;
    blur?: number;
  },
): FrontDepth | null {
  const cell = o.cell ?? 0.004,
    blur = o.blur ?? 0.018;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const F = o.forward.clone().setZ(0).normalize();
  const L = new THREE.Vector3(0, 0, 1).cross(F).normalize();
  const nx = Math.ceil((2 * o.xMax) / cell),
    nz = Math.ceil((o.zMax - o.zMin) / cell);
  if (nx < 2 || nz < 2) return null;
  const S = (p: THREE.Vector3) => (p.clone().sub(o.centre).dot(L) + o.xMax) / cell;
  const Z = (p: THREE.Vector3) => (p.z - o.zMin) / cell;
  const D = (p: THREE.Vector3) => p.clone().sub(o.centre).dot(F);
  const raw = new Float64Array(nx * nz).fill(-Infinity);
  const tri = new Int32Array(nx * nz).fill(-1);
  const bary = new Float32Array(nx * nz * 3);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t]!,
      i1 = idx[t + 1]!,
      i2 = idx[t + 2]!;
    if (!o.include(i0) || !o.include(i1) || !o.include(i2)) continue;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.dot(F) <= 0) continue;
    const P = [a, b, c].map((p) => [S(p), Z(p), D(p)] as const);
    const x0 = Math.max(0, Math.floor(Math.min(P[0]![0], P[1]![0], P[2]![0]))),
      x1 = Math.min(nx - 1, Math.ceil(Math.max(P[0]![0], P[1]![0], P[2]![0])));
    const z0 = Math.max(0, Math.floor(Math.min(P[0]![1], P[1]![1], P[2]![1]))),
      z1 = Math.min(nz - 1, Math.ceil(Math.max(P[0]![1], P[1]![1], P[2]![1])));
    const area =
      (P[1]![0] - P[0]![0]) * (P[2]![1] - P[0]![1]) - (P[1]![1] - P[0]![1]) * (P[2]![0] - P[0]![0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let zz = z0; zz <= z1; zz++)
      for (let xx = x0; xx <= x1; xx++) {
        const px = xx + 0.5,
          pz = zz + 0.5;
        const w0 = ((P[1]![0] - px) * (P[2]![1] - pz) - (P[1]![1] - pz) * (P[2]![0] - px)) / area;
        const w1 = ((P[2]![0] - px) * (P[0]![1] - pz) - (P[2]![1] - pz) * (P[0]![0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const d = w0 * P[0]![2] + w1 * P[1]![2] + w2 * P[2]![2];
        const k = zz * nx + xx;
        if (d > raw[k]!) {
          raw[k] = d;
          tri[k] = t;
          bary[k * 3] = w0;
          bary[k * 3 + 1] = w1;
          bary[k * 3 + 2] = w2;
        }
      }
  }
  // fill holes from the neighbours (the front opening, gaps between flaps)
  const fill = Float64Array.from(raw);
  const tfill = Int32Array.from(tri);
  for (let pass = 0; pass < 80; pass++) {
    let open = 0;
    const next = Float64Array.from(fill);
    for (let zz = 0; zz < nz; zz++)
      for (let xx = 0; xx < nx; xx++) {
        const k = zz * nx + xx;
        if (fill[k]! > -Infinity) continue;
        let sum = 0,
          cnt = 0;
        for (const [dx, dz] of NEIGH4) {
          const x2 = xx + dx,
            z2 = zz + dz;
          if (x2 < 0 || z2 < 0 || x2 >= nx || z2 >= nz) continue;
          const k2 = z2 * nx + x2;
          const v = fill[k2]!;
          if (v > -Infinity) {
            sum += v;
            cnt++;
            if (tfill[k] === -1) {
              tfill[k] = tfill[k2]!;
              bary.copyWithin(k * 3, k2 * 3, k2 * 3 + 3);
            }
          }
        }
        if (cnt) next[k] = sum / cnt;
        else open++;
      }
    fill.set(next);
    if (!open) break;
  }
  tri.set(tfill);
  // per row, the upper convex envelope of the raw front: cloth spans hollows (the blazer's front opening, the valley
  // between the breasts, the recess of the shirt V) instead of dipping into them
  for (let zz = 0; zz < nz; zz++) {
    const pts: [number, number][] = [];
    for (let xx = 0; xx < nx; xx++) {
      const v = raw[zz * nx + xx]!;
      if (v > -Infinity) pts.push([xx, v]);
    }
    if (pts.length < 3) continue;
    const hull: [number, number][] = [];
    for (const q of pts) {
      while (hull.length >= 2) {
        const [x1, y1] = hull[hull.length - 2]!,
          [x2, y2] = hull[hull.length - 1]!;
        if ((x2 - x1) * (q[1] - y1) - (y2 - y1) * (q[0] - x1) >= 0) hull.pop();
        else break;
      }
      hull.push(q);
    }
    let h = 0;
    for (let xx = pts[0]![0]; xx <= pts[pts.length - 1]![0]; xx++) {
      while (h < hull.length - 2 && hull[h + 1]![0] < xx) h++;
      const [x1, y1] = hull[h]!,
        [x2, y2] = hull[Math.min(h + 1, hull.length - 1)]!;
      const env = x2 === x1 ? y1 : y1 + ((y2 - y1) * (xx - x1)) / (x2 - x1);
      const k = zz * nx + xx;
      fill[k] = Math.max(fill[k]!, env);
    }
  }
  // separable gaussian
  const sig = blur / cell;
  const rad = Math.ceil(sig * 2.5);
  const kern = Array.from({ length: rad * 2 + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sig * sig)));
  const pass1 = new Float64Array(nx * nz).fill(-Infinity);
  const smooth = new Float64Array(nx * nz).fill(-Infinity);
  for (const [src, dst, horiz] of [
    [fill, pass1, true],
    [pass1, smooth, false],
  ] as const)
    for (let zz = 0; zz < nz; zz++)
      for (let xx = 0; xx < nx; xx++) {
        let sum = 0,
          ws = 0;
        for (let j = -rad; j <= rad; j++) {
          const x2 = horiz ? xx + j : xx,
            z2 = horiz ? zz : zz + j;
          if (x2 < 0 || z2 < 0 || x2 >= nx || z2 >= nz) continue;
          const v = src[z2 * nx + x2]!;
          if (v === -Infinity) continue;
          sum += v * kern[j + rad]!;
          ws += kern[j + rad]!;
        }
        if (ws > 0) dst[zz * nx + xx] = sum / ws;
      }
  const sample = (m: Float64Array, sx: number, sz: number) => {
    const x = THREE.MathUtils.clamp(sx - 0.5, 0, nx - 1),
      z = THREE.MathUtils.clamp(sz - 0.5, 0, nz - 1);
    const x0 = Math.floor(x),
      z0 = Math.floor(z),
      x1 = Math.min(x0 + 1, nx - 1),
      z1 = Math.min(z0 + 1, nz - 1);
    const fx = x - x0,
      fz = z - z0;
    const v = [m[z0 * nx + x0]!, m[z0 * nx + x1]!, m[z1 * nx + x0]!, m[z1 * nx + x1]!];
    if (v.some((q) => q === -Infinity)) return -Infinity;
    return (v[0]! * (1 - fx) + v[1]! * fx) * (1 - fz) + (v[2]! * (1 - fx) + v[3]! * fx) * fz;
  };
  return { nx, nz, cell, S, Z, D, F, L, raw, fill, smooth, tri, bary, sample };
}

/**
 * The front of the top as a new, clean panel: the original front layer of the trunk (lapels, their edge strips, the
 * shirt V, collar and pocket flaps, the trousers showing in the front opening) is removed inside a zone covering the
 * middle of the front, and replaced by a grid over the smoothed depth map, its top edge following the neckline. The
 * grid's sides and neckline turn back into the body by 1.5 cm (no gap to the kept sides / the chest skin from any
 * angle). Skin weights come from the original triangle seen in each cell (barycentric), so the panel bends exactly as
 * the body did. UVs sit on a plain back panel of the body texture. Returns the triangles added.
 */
export function frontPanel(
  geo: THREE.BufferGeometry,
  o: {
    centre: THREE.Vector3;
    forward: THREE.Vector3;
    xMax: number;
    zMin: number;
    zMax: number;
    include: (i: number) => boolean;
    /** triangles removed as well (pocket flaps, the collar band above the neckline) */
    dropAlso?: (i0: number, i1: number, i2: number) => boolean;
    /** the surface the panel follows (default `include`): the top itself, not the trousers in its front opening */
    shape?: (i: number) => boolean;
    /** neckline height (z) at side offset s across the front, or null for none */
    neckZ: (s: number) => number;
    cols?: number;
    rowH?: number;
  },
): number {
  const fd = frontDepth(geo, { ...o, include: o.shape ?? o.include, cell: 0.004, blur: 0.02 });
  if (!fd) return 0;
  const { nx, nz, cell, S, Z, D, F, L, raw, smooth, tri, bary } = fd;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const idx = geo.index!.array;
  // the front's extent per row (from the raw map), the panel covers nearly all of it; towards its sides it settles onto
  // the original surface (no step where the kept sides continue)
  const ext: [number, number][] = [];
  for (let zz = 0; zz < nz; zz++) {
    let lo = -1,
      hi = -1;
    for (let xx = 0; xx < nx; xx++)
      if (raw[zz * nx + xx]! > -Infinity) {
        if (lo < 0) lo = xx;
        hi = xx;
      }
    ext.push([lo, hi]);
  }
  // smooth the extents over height (rows without any front take their neighbours')
  const mid = (nx - 1) / 2;
  const half = ext.map(([lo, hi]) => (lo < 0 ? NaN : Math.min(mid - lo, hi - mid)));
  for (let k = 0; k < nz; k++) if (half[k] !== half[k]) half[k] = half[k - 1] ?? 0;
  const halfS = half.map((_, k) => {
    let s = 0,
      w = 0;
    for (let j = -6; j <= 6; j++) {
      const v = half[THREE.MathUtils.clamp(k + j, 0, nz - 1)]!;
      s += v;
      w++;
    }
    return ((s / w) * 0.97 * cell) as number;
  });
  const zoneHalf = (z: number) => halfS[THREE.MathUtils.clamp(Math.round((z - o.zMin) / cell), 0, nz - 1)]!;
  const sOf = (sx: number) => sx * cell - o.xMax;
  // the front's top per column (the shoulder line): the panel never rises above the body it covers
  const topRow = new Float64Array(nx).fill(0);
  for (let xx = 0; xx < nx; xx++)
    for (let zz = nz - 1; zz >= 0; zz--)
      if (raw[zz * nx + xx]! > -Infinity) {
        topRow[xx] = zz;
        break;
      }
  const topS = Array.from(topRow, (_, xx) => {
    let m2 = Infinity;
    for (let j = -3; j <= 3; j++) m2 = Math.min(m2, topRow[THREE.MathUtils.clamp(xx + j, 0, nx - 1)]!);
    return o.zMin + m2 * cell - 0.01;
  });
  const topAt = (s: number) =>
    Math.min(o.neckZ(s), o.zMax, topS[THREE.MathUtils.clamp(Math.round((s + o.xMax) / cell), 0, nx - 1)]!);
  // 1) remove the original front layer inside the zone (and above the neckline in it)
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    m = new THREE.Vector3(),
    n = new THREE.Vector3();
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t]!,
      i1 = idx[t + 1]!,
      i2 = idx[t + 2]!;
    let drop = !!o.dropAlso?.(i0, i1, i2);
    if (!drop && o.include(i0) && o.include(i1) && o.include(i2)) {
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      m.copy(a).add(b).add(c).divideScalar(3);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const s = sOf(S(m)),
        zc = m.z;
      // (below the panel's own top edge: above it, at the shoulders, the jacket stays)
      const inZone = zc > o.zMin + 0.005 && zc < topAt(s) - 0.003 && Math.abs(s) < zoneHalf(zc) - 0.006;
      const front = fd.sample(fd.fill, S(m), Z(m));
      // the front layer: near the front surface (or in front of the panel's sheet), not facing backwards much
      if (inZone && front > -Infinity && D(m) > front - 0.035) drop = true;
    }
    if (!drop) keep.push(i0, i1, i2);
  }
  // 2) the panel grid: columns across the zone, rows from the hem up to the neckline
  const cols = o.cols ?? 18;
  const rowH = o.rowH ?? 0.014;
  const P: number[] = [],
    N: number[] = [],
    UV: number[] = [],
    SI: number[] = [],
    SW: number[] = [];
  const weights = new Map<number, number>();
  const pushV = (s: number, z: number, back: number) => {
    const sx = (s + o.xMax) / cell,
      sz = (z - o.zMin) / cell;
    let d = fd.sample(smooth, sx, sz);
    if (d === -Infinity) d = fd.sample(fd.fill, sx, sz);
    if (d === -Infinity) d = 0;
    const edgeK = THREE.MathUtils.smoothstep(Math.abs(s) / Math.max(zoneHalf(z), 1e-3), 0.78, 1);
    if (edgeK > 0) {
      const dr = fd.sample(fd.fill, sx, sz);
      if (dr > -Infinity) d = THREE.MathUtils.lerp(d, dr - 0.0015, edgeK);
    }
    const p = o.centre
      .clone()
      .addScaledVector(L, s)
      .addScaledVector(F, d + 0.0015 - back)
      .setZ(z);
    const id = P.length / 3;
    P.push(p.x, p.y, p.z);
    N.push(F.x, F.y, 0);
    UV.push(
      0.38 + 0.24 * THREE.MathUtils.clamp((s / Math.max(o.xMax, 1e-3) + 1) / 2, 0, 1),
      0.03 + 0.2 * THREE.MathUtils.clamp((z - o.zMin) / Math.max(o.zMax - o.zMin, 1e-3), 0, 1),
    );
    // skin weights: barycentric over the original triangle seen in that cell
    const k =
      THREE.MathUtils.clamp(Math.floor(sz), 0, nz - 1) * nx +
      THREE.MathUtils.clamp(Math.floor(sx), 0, nx - 1);
    weights.clear();
    const t = tri[k]!;
    if (t >= 0)
      for (let v = 0; v < 3; v++) {
        const vi = idx[t + v]!;
        const bw = Math.max(0, bary[k * 3 + v]!);
        for (let q = 0; q < 4; q++) {
          const bone = si.getComponent(vi, q),
            w = sw.getComponent(vi, q) * bw;
          if (w > 0) weights.set(bone, (weights.get(bone) ?? 0) + w);
        }
      }
    const top = [...weights].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const tot = top.reduce((acc, x) => acc + x[1], 0) || 1;
    for (let q = 0; q < 4; q++) {
      SI.push(top[q]?.[0] ?? 0);
      SW.push(top[q] ? top[q]![1] / tot : 0);
    }
    return id;
  };
  const rowsOf = (s: number) => Math.max(2, Math.round((topAt(s) - o.zMin) / rowH));
  const rows = rowsOf(0);
  const grid: number[][] = [];
  for (let ci = 0; ci <= cols; ci++) {
    const col: number[] = [];
    for (let r = 0; r <= rows; r++) {
      // rows are spread from the hem to this column's own neckline height
      const fz = r / rows;
      // the zone's half-width at this height, columns spread across it
      const zEst = o.zMin + fz * (topAt(0) - o.zMin);
      const s = (ci / cols - 0.5) * 2 * zoneHalf(zEst);
      const zTop = topAt(s);
      const z = o.zMin + fz * (zTop - o.zMin);
      col.push(pushV(s, z, 0));
    }
    grid.push(col);
  }
  const I: number[] = [];
  for (let ci = 0; ci < cols; ci++)
    for (let r = 0; r < rows; r++) {
      const v00 = grid[ci]![r]!,
        v10 = grid[ci + 1]![r]!,
        v01 = grid[ci]![r + 1]!,
        v11 = grid[ci + 1]![r + 1]!;
      I.push(v00, v10, v11, v00, v11, v01);
    }
  // turned-back edges: left, right and the neckline (1.5 cm into the body)
  const edge = (list: number[]) => {
    const back = list.map((v) => {
      const p = new THREE.Vector3(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!).addScaledVector(F, -0.015);
      const id = P.length / 3;
      P.push(p.x, p.y, p.z);
      N.push(N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!);
      UV.push(UV[v * 2]!, UV[v * 2 + 1]!);
      for (let q = 0; q < 4; q++) {
        SI.push(SI[v * 4 + q]!);
        SW.push(SW[v * 4 + q]!);
      }
      return id;
    });
    for (let k = 0; k < list.length - 1; k++)
      I.push(list[k]!, back[k]!, back[k + 1]!, list[k]!, back[k + 1]!, list[k + 1]!);
  };
  edge(grid[0]!.slice().reverse());
  edge(grid[cols]!.slice());
  // the top edge turns back only along the neckline; at the shoulders it tucks under the kept jacket
  const topEdge = grid.map((col) => col[rows]!);
  const onNeck = grid.map((_, ci) => {
    const v = topEdge[ci]!;
    const p = new THREE.Vector3(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!);
    const sv = p.clone().sub(o.centre).dot(L);
    return o.neckZ(sv) < topS[THREE.MathUtils.clamp(Math.round((sv + o.xMax) / cell), 0, nx - 1)]! + 0.002;
  });
  let run: number[] = [];
  topEdge.forEach((v, ci) => {
    if (onNeck[ci]) run.push(v);
    else {
      if (run.length > 1) edge(run);
      run = [];
    }
  });
  if (run.length > 1) edge(run);
  edge(grid.map((col) => col[0]!).reverse());
  // facing: the grid quads face forward; flip the whole panel if its winding came out backwards
  {
    const p0 = new THREE.Vector3().fromArray(P, grid[0]![0]! * 3),
      p1 = new THREE.Vector3().fromArray(P, grid[1]![0]! * 3),
      p2 = new THREE.Vector3().fromArray(P, grid[1]![1]! * 3);
    if (p1.sub(p0).cross(p2.sub(p0)).dot(F) < 0)
      for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2]!, I[t + 1]!];
  }
  // smooth normals of the panel itself
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  pg.setIndex(I);
  pg.computeVertexNormals();
  const PN = pg.attributes.normal!.array;
  // append
  const base = pos.count;
  const add = P.length / 3;
  const grow = (name: string, vals: ArrayLike<number>) => {
    const at = geo.attributes[name] as THREE.BufferAttribute;
    const size = at.itemSize;
    const Arr = (at.array as unknown as { constructor: new (n: number) => THREE.TypedArray }).constructor;
    const out = new Arr((base + add) * size);
    for (let v = 0; v < base; v++) for (let q = 0; q < size; q++) out[v * size + q] = at.getComponent(v, q);
    for (let v = 0; v < add * size; v++) out[base * size + v] = vals[v]!;
    geo.setAttribute(name, new THREE.BufferAttribute(out, size, at.normalized));
  };
  grow("position", P);
  grow("normal", PN);
  grow("uv", UV);
  grow("skinIndex", SI);
  grow("skinWeight", SW);
  for (const name of Object.keys(geo.attributes))
    if (!["position", "normal", "uv", "skinIndex", "skinWeight"].includes(name)) geo.deleteAttribute(name);
  for (const i of I) keep.push(base + i);
  geo.setIndex(
    base + add > 65535 ? new THREE.Uint32BufferAttribute(keep, 1) : new THREE.Uint16BufferAttribute(keep, 1),
  );
  // the panel's surface for what is laid on it (the collar): depth along forward at (side offset, height)
  geo.userData.gkFrontSurface = (sv: number, z: number) => {
    const d = fd.sample(smooth, (sv + o.xMax) / cell, (z - o.zMin) / cell);
    return d === -Infinity ? null : d + 0.0015;
  };
  return I.length / 3;
}

/** Distance of p from the segment a-b and the segment parameter (0…1). */
function segParam(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): { t: number; d: number; foot: THREE.Vector3 } {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
  const foot = a.clone().addScaledVector(ab, t);
  return { t, d: p.distanceTo(foot), foot };
}

/* ------------------------------------------------------------------ collar */

export interface CollarSpec {
  kind: Exclude<CollarKind, "none">;
  /** neck centre line: base centre and the neck's up direction */
  centre: THREE.Vector3;
  /** neck radius (m) round the base, by angle θ (0 = back, ±π = front; +θ towards the person's left) */
  radius: (theta: number) => number;
  /** base height offset (m) by angle: the collar line drops towards the front */
  baseZ: (theta: number) => number;
  /** forward direction in the bind frame (unit, horizontal) */
  forward: THREE.Vector3;
  /** half the front opening (rad, measured from the front) */
  opening: number;
}

export interface CollarMesh {
  position: number[];
  normal: number[];
  uv: number[];
  /** 0 at the stand's base … 1 at the top of the stand (for skin weights) */
  height: number[];
  index: number[];
}

/** Cross-section profile of the collar at angle θ, as points (radial offset r from the neck surface, height z). */
export function collarSection(kind: CollarSpec["kind"], theta: number, opening: number): [number, number][] {
  // 0 at the back … 1 at the collar's front end
  const span = Math.PI - opening;
  const f = THREE.MathUtils.clamp(Math.abs(theta) / Math.max(span, 1e-3), 0, 1);
  const ss = THREE.MathUtils.smoothstep;
  const t = 0.0024; // cloth thickness
  if (kind === "stand" || kind === "hood") {
    // a stand (track-top zip collar) or a rolled hood lying round the neck: one thick band, a rounded top
    const h = kind === "hood" ? 0.034 - 0.012 * f : 0.042 - 0.012 * f;
    const out = kind === "hood" ? 0.02 + 0.026 * (1 - f) : 0.004;
    const th = kind === "hood" ? 0.012 + 0.012 * (1 - f) : 0.004;
    return [
      [0.0, -0.004],
      [-0.001, h * 0.55],
      [0.0005, h],
      [th * 0.6 + out * 0.4, h + 0.003],
      [th + out, h * 0.62],
      [th + out * 0.9, 0.006],
      [th + out * 0.5, -0.006],
      [th * 0.5, -0.008],
    ];
  }
  // shirt collar: stand (back 3.2 cm → front 2.4 cm) + fall folded over it (back 4.0 cm → points at the front)
  const hs = 0.032 - 0.008 * f;
  const point = ss(f, 0.62, 1);
  const hf = 0.041 + 0.03 * point;
  const spread = 0.01 + 0.008 * f + 0.012 * point;
  const fold = hs + 0.0035;
  return [
    [-t * 0.5, -0.006], // stand base, inner (against the neck)
    [-t * 0.5 - 0.002, hs * 0.7],
    [0.0, fold], // the fold, rounded
    [t + 0.0016, fold + 0.0012],
    [t + 0.004, fold - 0.003],
    [spread * 0.55 + t, fold - hf * 0.55], // fall outer face
    [spread + t, fold - hf], // finished lower edge / point
    [spread, fold - hf + t * 0.8], // the edge's thickness
    [spread * 0.55, fold - hf * 0.55 + t], // fall inner face (over the stand)
    [t * 1.6, fold - 0.004],
    [t * 0.5, hs * 0.5], // stand outer face (under the fall)
    [t * 0.5, -0.005],
  ];
}

/**
 * The collar mesh in the bind frame. Swept over θ from the left front end round the back to the right front end, each
 * section a closed loop (so every edge is finished and the cloth has thickness); the two ends are capped.
 */
export function buildCollar(spec: CollarSpec, segments = 26): CollarMesh {
  const up = new THREE.Vector3(0, 0, 1);
  const fwd = spec.forward.clone().setZ(0).normalize();
  const left = new THREE.Vector3().crossVectors(up, fwd).normalize(); // person's left
  // keep the person's left on +x of the bind frame
  if (left.x < 0) left.negate();
  const span = Math.PI - spec.opening;
  const P: number[] = [];
  const H: number[] = [];
  const UV: number[] = [];
  const rings: number[][] = [];
  const secLen = collarSection(spec.kind, 0, spec.opening).length;
  for (let s = 0; s <= segments; s++) {
    const theta = -span + (2 * span * s) / segments;
    // θ = 0 at the back: radial = -fwd; θ → +π turns towards the person's left and on to the front
    const radial = fwd
      .clone()
      .multiplyScalar(-Math.cos(theta))
      .addScaledVector(left, Math.sin(theta))
      .normalize();
    const r0 = spec.radius(theta);
    const z0 = spec.baseZ(theta);
    const sec = collarSection(spec.kind, theta, spec.opening);
    const ring: number[] = [];
    sec.forEach(([dr, dz], k) => {
      const p = spec.centre
        .clone()
        .addScaledVector(radial, r0 + dr)
        .addScaledVector(up, z0 + dz);
      ring.push(P.length / 3);
      P.push(p.x, p.y, p.z);
      // stand height share (0 at the base, 1 from the fold up: the fall rides with the stand's top)
      H.push(THREE.MathUtils.clamp((dz + 0.006) / 0.04, 0, 1));
      // plain back-panel texels, shifted by +2 (the texture repeats): u along the collar, v round the section
      UV.push(2 + 0.38 + (0.24 * s) / segments, 0.06 + (0.08 * k) / (secLen - 1));
    });
    rings.push(ring);
  }
  const I: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = rings[s]!,
      b = rings[s + 1]!;
    for (let k = 0; k < secLen; k++) {
      const k2 = (k + 1) % secLen;
      I.push(a[k]!, b[k]!, b[k2]!, a[k]!, b[k2]!, a[k2]!);
    }
  }
  // caps at both ends (fan from the section centroid)
  for (const [ring, flip] of [
    [rings[0]!, true],
    [rings[segments]!, false],
  ] as const) {
    const c = new THREE.Vector3();
    for (const v of ring) c.add(_v.fromArray(P, v * 3));
    c.divideScalar(ring.length);
    const ci = P.length / 3;
    P.push(c.x, c.y, c.z);
    H.push(H[ring[0]!]!);
    UV.push(UV[ring[0]! * 2]!, UV[ring[0]! * 2 + 1]! + 0.04);
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      if (flip) I.push(ci, ring[k2]!, ring[k]!);
      else I.push(ci, ring[k]!, ring[k2]!);
    }
  }
  // orient: the section loop's winding decides whether the quads face out; check one quad against the radial
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  if (!facesOutward(g, spec.centre))
    for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2]!, I[t + 1]!];
  g.setIndex(I);
  g.computeVertexNormals();
  return { position: P, normal: Array.from(g.attributes.normal!.array), uv: UV, height: H, index: I };
}

/** True when most triangles' normals point away from the neck axis (signed volume of the closed sweep). */
function facesOutward(g: THREE.BufferGeometry, centre: THREE.Vector3): boolean {
  const p = g.attributes.position as THREE.BufferAttribute;
  const I = g.index!.array;
  let vol = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let t = 0; t < I.length; t += 3) {
    a.fromBufferAttribute(p, I[t]!).sub(centre);
    b.fromBufferAttribute(p, I[t + 1]!).sub(centre);
    c.fromBufferAttribute(p, I[t + 2]!).sub(centre);
    vol += a.dot(b.cross(c));
  }
  return vol > 0;
}

/**
 * Neck radius round a centre at a height, from a mesh (the head's neck skin): the cross-section of the triangles with
 * the horizontal plane z, as the distance from the centre to the farthest crossing per angle bin (smoothed, gaps
 * filled). θ as in CollarSpec (0 = back, +θ to the person's left). Returns null if the plane misses the mesh.
 */
export function neckProfile(
  geo: THREE.BufferGeometry,
  centre: THREE.Vector3,
  forward: THREE.Vector3,
  z: number,
  bins = 36,
): ((theta: number) => number) | null {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const fwd = forward.clone().setZ(0).normalize();
  const left = new THREE.Vector3(0, 0, 1).cross(fwd).normalize();
  if (left.x < 0) left.negate();
  const r = new Float64Array(bins).fill(NaN);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    q = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      a.fromBufferAttribute(pos, idx[t + e]!);
      b.fromBufferAttribute(pos, idx[t + ((e + 1) % 3)]!);
      if ((a.z - z) * (b.z - z) > 0 || a.z === b.z) continue;
      q.copy(a)
        .lerp(b, (z - a.z) / (b.z - a.z))
        .sub(centre);
      const back = -q.dot(fwd),
        side = q.dot(left);
      const d = Math.hypot(back, side);
      if (d > 0.13) continue;
      const th = Math.atan2(side, back);
      const k = Math.min(bins - 1, Math.floor(((th + Math.PI) / (2 * Math.PI)) * bins));
      if (!(r[k]! >= d)) r[k] = d;
    }
  const ok = Array.from(r).filter((x) => x === x);
  if (ok.length < bins / 3) return null;
  // fill gaps from neighbours, then smooth
  const filled = Array.from(r);
  for (let pass = 0; pass < bins; pass++)
    for (let k = 0; k < bins; k++)
      if (!(filled[k]! === filled[k]!)) {
        const l = filled[(k + bins - 1) % bins]!,
          rr = filled[(k + 1) % bins]!;
        if (l === l || rr === rr) filled[k] = l === l && rr === rr ? (l + rr) / 2 : l === l ? l : rr;
      }
  const sm = filled.map(
    (_, k) => (filled[(k + bins - 1) % bins]! + 2 * filled[k]! + filled[(k + 1) % bins]!) / 4,
  );
  return (theta: number) => {
    const x = (((((theta + Math.PI) / (2 * Math.PI)) * bins - 0.5) % bins) + bins) % bins;
    const k0 = Math.floor(x),
      k1 = (k0 + 1) % bins,
      f = x - k0;
    return sm[k0]! * (1 - f) + sm[k1]! * f;
  };
}

/* ------------------------------------------------------------------ the refit */

export interface RefitInput {
  body: BodyType;
  cut: TopCut;
  frame: BodyFrame;
  /** the head mesh geometry (bind frame), for the neck */
  head: THREE.BufferGeometry | null;
  /** recolour mask sampler of the body texture: region weights at a UV */
  region?: (u: number, v: number) => { skin: number; top: number; bottom: number };
  /** include the modelled collar (near level only) */
  collar: boolean;
}

/** Neck base frame of a body: centre of the neck at its base, forward direction, base height. */
export function neckBase(
  frame: BodyFrame,
  head: THREE.BufferGeometry | null,
): { centre: THREE.Vector3; forward: THREE.Vector3; baseZ: number } | null {
  const neck = frame.bone("Bip01_Neck");
  const headB = frame.bone("Bip01_Head");
  const le = frame.bone("Bip01_LEye"),
    re = frame.bone("Bip01_REye");
  if (!neck || !headB) return null;
  // forward: from the head bone towards the eyes (horizontal)
  const forward =
    le && re
      ? le.clone().add(re).multiplyScalar(0.5).sub(headB).setZ(0).normalize()
      : new THREE.Vector3(0, -1, 0);
  // the neck's centre at its base: the neck bone sits towards the back of the neck; centre ~1.5 cm in front of it
  const centre = neck.clone().addScaledVector(forward, 0.012);
  let baseZ = neck.z - 0.012;
  if (head) {
    // the base sits a little above the lowest ring of neck skin all round (the head mesh's neck)
    const pos = head.attributes.position as THREE.BufferAttribute;
    let backLow = Infinity;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      const rel = _v.clone().sub(centre);
      if (rel.dot(forward) < -0.02 && Math.abs(rel.x) < 0.03 && rel.length() < 0.12)
        backLow = Math.min(backLow, _v.z);
    }
    if (Number.isFinite(backLow)) baseZ = Math.max(baseZ, backLow + 0.012);
  }
  centre.z = baseZ;
  return { centre, forward, baseZ };
}

/**
 * UV islands of the feminine body texture that belong to the top although its recolour mask says otherwise: the shirt's
 * collar band (marked skin) and the pocket flaps (marked trousers). Mirrored in the body shader (materials.ts).
 */
export function feminineTopIsland(u: number, v: number): boolean {
  const cuff = (u < 0.066 || u >= 0.934) && v >= 0.265 && v < 0.505;
  const pocket = ((u >= 0.31 && u < 0.415) || (u >= 0.585 && u < 0.69)) && v >= 0.685 && v < 0.76;
  return cuff || pocket;
}

/** A per-cut copy of a base body geometry (bind frame). Shared: callers cache it per base geometry and cut. */
export function refitTop(src: THREE.BufferGeometry, input: RefitInput): THREE.BufferGeometry {
  const geo = src.clone();
  const base = input.region;
  const inp: RefitInput =
    input.body === "feminine" && base
      ? {
          ...input,
          region: (u, v) => (feminineTopIsland(u, v) ? { skin: 0, top: 1, bottom: 0 } : base(u, v)),
        }
      : input;
  const { cut, frame } = inp;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const nb = neckBase(frame, inp.head);
  // the top's own surface (the trousers' waist and the lining sit just inside it); the trousers' texels in the blazer's
  // front opening above the hem are the top too (the body shader paints them so)
  let included: ((i: number) => boolean) | null = null;
  let shaped: ((i: number) => boolean) | null = null;
  let hemZ = 0;
  let shoulderX = 0.14;
  if (cut.flatten && nb) {
    const fwd = nb.forward;
    const shL = frame.bone("Bip01_L_UpperArm");
    shoulderX = shL ? Math.abs(shL.x) - 0.03 : 0.14;
    const weld = weldGroups(pos);
    const inc = new Uint8Array(pos.count);
    hemZ = (shL?.z ?? 1.38) - 0.54;
    for (let i = 0; i < pos.count; i++) {
      const r = inp.region ? inp.region(uv.getX(i), uv.getY(i)) : { skin: 0, top: 1, bottom: 0 };
      _v.fromBufferAttribute(pos, i);
      const rel = _v.clone().sub(nb.centre);
      const cutaway = r.bottom > 0.5 && _v.z > hemZ && Math.abs(rel.x) < 0.075 && rel.dot(fwd) > 0.04;
      if (r.top > 0.5) inc[weld[i]!] = 2;
      else if (cutaway && !inc[weld[i]!]) inc[weld[i]!] = 1;
    }
    included = (i: number) => inc[weld[i]!]! > 0;
    shaped = (i: number) => inc[weld[i]!] === 2;
  }
  // short / elbow sleeves: take the jacket sleeve in to the arm below the hem (skin is painted there)
  const end = SLEEVE_END[cut.sleeve];
  if (end > 0)
    for (const side of ["L", "R"]) {
      const sh = frame.bone(`Bip01_${side}_UpperArm`),
        el = frame.bone(`Bip01_${side}_Forearm`),
        ha = frame.bone(`Bip01_${side}_Hand`);
      const iu = frame.index(`Bip01_${side}_UpperArm`),
        ifo = frame.index(`Bip01_${side}_Forearm`);
      if (!sh || !el || !ha) continue;
      const upperLen = sh.distanceTo(el);
      for (let i = 0; i < pos.count; i++) {
        let armW = 0;
        for (let k = 0; k < 4; k++) {
          const b = si.getComponent(i, k);
          if (b === iu || b === ifo) armW += sw.getComponent(i, k);
        }
        if (armW < 0.5) continue;
        // skin texels (hands) keep their shape
        if (inp.region && inp.region(uv.getX(i), uv.getY(i)).skin > 0.5) continue;
        _v.fromBufferAttribute(pos, i);
        const u = segParam(_v, sh, el);
        const f = segParam(_v, el, ha);
        const along = u.t < 1 ? u.t * upperLen : upperLen + f.t * el.distanceTo(ha);
        const near = u.t < 1 ? u : f;
        const k = THREE.MathUtils.smoothstep(along, end + 0.004, end + 0.02);
        if (k <= 0) continue;
        // an arm, not a sleeve: ~4.2 cm round the upper arm, tapering to ~3 cm at the wrist
        const target = THREE.MathUtils.lerp(
          0.043,
          0.029,
          THREE.MathUtils.clamp((along - upperLen * 0.4) / (upperLen * 1.4), 0, 1),
        );
        const r = near.d;
        if (r <= target) continue;
        const nr = THREE.MathUtils.lerp(r, target, k * 0.92);
        _v.sub(near.foot)
          .multiplyScalar(nr / r)
          .add(near.foot);
        pos.setXYZ(i, _v.x, _v.y, _v.z);
      }
    }
  if (shaped && nb && inp.head) settleShoulders(geo, nb, shaped, inp.head);
  pos.needsUpdate = true;
  refreshNormals(geo, src.attributes.position as THREE.BufferAttribute);
  if (included && nb) {
    // the front as a new clean panel (lapels, shirt V, flaps and the front opening replaced), its top on the neckline
    const fwd = nb.forward;
    frontPanel(geo, {
      centre: nb.centre,
      forward: fwd,
      xMax: shoulderX + 0.04,
      zMin: hemZ - 0.006,
      zMax: nb.baseZ + 0.02,
      include: included,
      shape: shaped ?? undefined,
      neckZ: (s) => nb.baseZ - necklineDrop(cut.neck, cut.depth, s, 1) - 0.004,
    });
  }
  if (cut.flatten && nb && inp.head) tuckNeckline(geo, cut, nb, inp.head);
  if (inp.collar && cut.collar !== "none" && nb && inp.head) appendCollar(geo, cut, nb, inp, frame);
  geo.computeBoundingSphere();
  geo.userData.gkShared = true;
  geo.userData.gkCut = cut.id;
  return geo;
}

/**
 * The blazer's collar roll and lapel notches over the shoulders and round the back of the neck, pressed down onto the
 * shoulders: round the neck the shoulders form a cone sloping away from the neck base; garment vertices standing above
 * it (by more than 4 mm) come down onto it, in a soft band from the neck out to ~17 cm. Positions only (seams stay
 * welded).
 */
function settleShoulders(
  geo: THREE.BufferGeometry,
  nb: NonNullable<ReturnType<typeof neckBase>>,
  shaped: (i: number) => boolean,
  head: THREE.BufferGeometry,
) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const fwd = nb.forward.clone().setZ(0).normalize();
  const left = new THREE.Vector3(0, 0, 1).cross(fwd).normalize();
  const r0 = neckProfile(head, nb.centre, fwd, nb.baseZ) ?? (() => 0.055);
  const rel = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (!shaped(i)) continue;
    _v.fromBufferAttribute(pos, i);
    rel.copy(_v).sub(nb.centre);
    const back = -rel.dot(fwd),
      side = rel.dot(left);
    const h = Math.hypot(back, side);
    if (h > 0.2 || rel.z < -0.12 || rel.z > 0.09) continue;
    const th = Math.atan2(side, back);
    const rn = r0(th);
    if (h < rn - 0.004) continue;
    // the cone: 4 mm under the neck base at the neck, sloping ~22° outwards (steeper at the back, flatter in front
    // where the collar bones are)
    const front = THREE.MathUtils.clamp(0.5 - (0.5 * back) / Math.max(h, 1e-4), 0, 1);
    const slope = THREE.MathUtils.lerp(0.46, 0.34, front);
    const cone = nb.baseZ - 0.004 - Math.max(0, h - rn) * slope;
    const k = 1 - THREE.MathUtils.smoothstep(h, 0.15, 0.2);
    if (_v.z <= cone + 0.004 || k <= 0) continue;
    pos.setZ(i, THREE.MathUtils.lerp(_v.z, cone, k));
  }
}

/**
 * The neckline as geometry: body (garment) vertices above the cut's neckline near the neck go just inside the neck /
 * chest skin of the head mesh, so the head's skin shows there and the garment edge folds in against the neck (the
 * blazer's shirt collar band and flaps were standing there). Pure function of each position (seams stay welded).
 */
function tuckNeckline(
  geo: THREE.BufferGeometry,
  cut: TopCut,
  nb: NonNullable<ReturnType<typeof neckBase>>,
  head: THREE.BufferGeometry,
) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const fwd = nb.forward.clone().setZ(0).normalize();
  const left = new THREE.Vector3(0, 0, 1).cross(fwd).normalize();
  if (left.x < 0) left.negate();
  // neck / chest skin profiles every 8 mm from 9 cm below the base to 8 cm above it
  const levels: { z: number; r: ((t: number) => number) | null }[] = [];
  for (let dz = -0.09; dz <= 0.08 + 1e-6; dz += 0.008)
    levels.push({ z: nb.baseZ + dz, r: neckProfile(head, nb.centre, fwd, nb.baseZ + dz) });
  const radiusAt = (z: number, th: number): number | null => {
    let best: number | null = null,
      bd = Infinity;
    for (const l of levels) {
      if (!l.r) continue;
      const d = Math.abs(l.z - z);
      if (d < bd) {
        bd = d;
        best = l.r(th);
      }
    }
    return bd < 0.012 ? best : null;
  };
  const rel = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    rel.copy(_v).sub(nb.centre);
    const up = rel.z;
    const back = -rel.dot(fwd),
      side = rel.dot(left);
    const h = Math.hypot(back, side);
    if (h > 0.13 || up < -0.1 || up > 0.09) continue;
    const front = THREE.MathUtils.clamp(0.5 - (0.5 * back) / Math.max(h, 1e-4), 0, 1);
    const drop = necklineDrop(cut.neck, cut.depth, side, front);
    if (up < -drop + 0.004) continue;
    const th = Math.atan2(side, back);
    // folded down to the neckline and just inside the neck there (pulling it in at its own height left long slanted
    // strips from the shoulders up into the neck)
    const z = Math.min(_v.z, nb.baseZ - drop - 0.003);
    const r = radiusAt(z, th);
    if (r === null) continue;
    const nr = Math.max(0.01, Math.min(h, r - 0.004));
    const k = nr / Math.max(h, 1e-6);
    pos.setXYZ(i, nb.centre.x + rel.x * k, nb.centre.y + rel.y * k, z);
  }
}

/**
 * New smooth normals for the vertices that moved and their neighbours (everything else keeps its authored normal):
 * area-weighted over the welded surface, so UV-seam duplicates agree, but crease-aware: a vertex only takes faces
 * within ~70° of its own authored normal, so a hem where the outside folds into the lining (shared positions, opposite
 * faces) keeps both sides lit correctly. In place.
 */
function refreshNormals(geo: THREE.BufferGeometry, before: THREE.BufferAttribute) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const weld = weldGroups(before);
  let G = 0;
  for (let i = 0; i < weld.length; i++) G = Math.max(G, weld[i]! + 1);
  const moved = new Uint8Array(G);
  for (let i = 0; i < pos.count; i++)
    if (
      Math.abs(pos.getX(i) - before.getX(i)) +
        Math.abs(pos.getY(i) - before.getY(i)) +
        Math.abs(pos.getZ(i) - before.getZ(i)) >
      1e-5
    )
      moved[weld[i]!] = 1;
  const idx = geo.index!.array;
  const tris = idx.length / 3;
  const fn = new Float64Array(tris * 3);
  const touch: number[][] = Array.from({ length: G }, () => []);
  const touched = new Uint8Array(G);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    const g0 = weld[idx[t * 3]!]!,
      g1 = weld[idx[t * 3 + 1]!]!,
      g2 = weld[idx[t * 3 + 2]!]!;
    a.fromBufferAttribute(pos, idx[t * 3]!);
    b.fromBufferAttribute(pos, idx[t * 3 + 1]!).sub(a);
    c.fromBufferAttribute(pos, idx[t * 3 + 2]!).sub(a);
    b.cross(c);
    fn[t * 3] = b.x;
    fn[t * 3 + 1] = b.y;
    fn[t * 3 + 2] = b.z;
    const any = moved[g0]! | moved[g1]! | moved[g2]!;
    for (const g of [g0, g1, g2]) {
      touch[g]!.push(t);
      if (any) touched[g] = 1;
    }
  }
  const cos = Math.cos(THREE.MathUtils.degToRad(70));
  const auth = new THREE.Vector3();
  const f = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const g = weld[i]!;
    if (!touched[g]) continue;
    auth.fromBufferAttribute(nrm, i).normalize();
    _v.set(0, 0, 0);
    for (const t of touch[g]!) {
      f.set(fn[t * 3]!, fn[t * 3 + 1]!, fn[t * 3 + 2]!);
      const l = f.length();
      if (l < 1e-14 || f.dot(auth) < cos * l) continue;
      _v.add(f);
    }
    if (_v.lengthSq() < 1e-20) continue;
    _v.normalize();
    nrm.setXYZ(i, _v.x, _v.y, _v.z);
  }
  nrm.needsUpdate = true;
}

function appendCollar(
  geo: THREE.BufferGeometry,
  cut: TopCut,
  nb: NonNullable<ReturnType<typeof neckBase>>,
  inp: RefitInput,
  frame: BodyFrame,
) {
  const head = inp.head!;
  // the collar sits on the garment's neck opening: round the back just under the neck skin's lower edge, dropping
  // towards the front (an open collar meets lower on the chest); its radius follows the neck / chest skin at its own
  // height all round (a few mm of room)
  const kind = cut.collar as Exclude<CollarKind, "none">;
  const opening =
    cut.neck === "open"
      ? 0.42
      : cut.neck === "blazer"
        ? 0.5
        : kind === "stand"
          ? 0.08
          : kind === "hood"
            ? 0.55
            : 0.4;
  const drop = kind === "stand" ? 0.012 : kind === "hood" ? 0.03 : 0.034;
  const zc = nb.baseZ - 0.012;
  const centre = nb.centre.clone().setZ(zc);
  const dz = (th: number) => -drop * (1 - Math.cos(th)) * 0.5;
  const levels: { z: number; r: ((t: number) => number) | null }[] = [];
  for (let k = 0; k <= 8; k++) {
    const z = zc + 0.01 - drop - 0.01 + (k * (drop + 0.02)) / 8;
    levels.push({ z, r: neckProfile(head, centre, nb.forward, z) });
  }
  const radius = (th: number) => {
    const z = zc + dz(th) + 0.008;
    let best = 0.058,
      bd = Infinity;
    for (const l of levels) {
      if (!l.r) continue;
      const d = Math.abs(l.z - z);
      if (d < bd) {
        bd = d;
        best = l.r(th);
      }
    }
    // in front, the collar stands on the top's own front panel (the chest is well in front of the neck there)
    const surf = geo.userData.gkFrontSurface as ((sv: number, z: number) => number | null) | undefined;
    let r = best + 0.004;
    if (surf) {
      const radial = nb.forward
        .clone()
        .multiplyScalar(-Math.cos(th))
        .addScaledVector(new THREE.Vector3(1, 0, 0), Math.sin(th));
      const toF = radial.dot(nb.forward);
      if (toF > 0.2) {
        const z = zc + dz(th) + 0.004;
        let rp = r;
        for (let it = 0; it < 4; it++) {
          const p = centre.clone().addScaledVector(radial, rp);
          const d = surf(p.x - centre.x, z);
          if (d === null) break;
          const pc = p.clone().sub(nb.centre).setZ(0);
          rp += (d + 0.002 - pc.dot(nb.forward)) / toF;
        }
        r = Math.max(r, rp);
      }
    }
    return r;
  };
  const spec: CollarSpec = { kind, centre, forward: nb.forward, opening, radius, baseZ: dz };
  const m = buildCollar(spec);
  const iSpine = frame.index("Bip01_Spine2");
  const iNeck = frame.index("Bip01_Neck");
  const base = (geo.attributes.position as THREE.BufferAttribute).count;
  const n = m.position.length / 3;
  const grow = (name: string, values: (k: number, c: number) => number) => {
    const at = geo.attributes[name] as THREE.BufferAttribute;
    const size = at.itemSize;
    const Arr = (at.array as unknown as { constructor: new (n: number) => THREE.TypedArray }).constructor;
    const out = new Arr((base + n) * size);
    out.set(at.array as THREE.TypedArray);
    for (let k = 0; k < n; k++) for (let c = 0; c < size; c++) out[(base + k) * size + c] = values(k, c);
    geo.setAttribute(name, new THREE.BufferAttribute(out, size, at.normalized));
  };
  grow("position", (k, c) => m.position[k * 3 + c]!);
  grow("normal", (k, c) => m.normal[k * 3 + c]!);
  grow("uv", (k, c) => m.uv[k * 2 + c]!);
  // the stand's base rides with the chest, its top (and the fall) half with the neck: it follows turns and nods
  grow("skinIndex", (_k, c) => (c === 0 ? Math.max(iSpine, 0) : c === 1 ? Math.max(iNeck, 0) : 0));
  grow("skinWeight", (k, c) => {
    const wn = 0.15 + 0.4 * m.height[k]!;
    return c === 0 ? 1 - wn : c === 1 ? wn : 0;
  });
  for (const name of Object.keys(geo.attributes))
    if (!["position", "normal", "uv", "skinIndex", "skinWeight"].includes(name)) geo.deleteAttribute(name);
  const I = Array.from(geo.index!.array);
  for (const i of m.index) I.push(base + i);
  geo.setIndex(
    base + n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1),
  );
}
