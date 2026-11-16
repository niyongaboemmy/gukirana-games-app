import * as THREE from "three";
import type { ArmBones } from "../procedural";
import { EAR_LANDMARKS } from "../skull";
import type { BodyType } from "../../outfits";
import type { LookUniforms } from "../materials";
import { bindData } from "./rig";
import { fitBodyForKit } from "./kit-fit";
import type { BoxingKit } from "./kit";

/**
 * Ring kit meshes (P3-FGT-02), built per body in its bind pose and fitted to it:
 *  - gloves: padded leather mitts (knuckle roll, attached thumb, palm grip seam), a long cuff with palm-side laces and
 *    a wrist strap in the trim colour; rigid on the hand bone (the boxing layer keeps the wrist straight);
 *  - trunks: satin, fitted from the body's own hip / thigh surface (+ ease, a flare at the hem), a wide waistband and
 *    a side stripe; skinned to the pelvis and thighs like the body, so they follow every hip turn and knee lift;
 *  - boots: the shoe region recoloured + a high-top laced shaft fitted round the ankle / lower calf, skinned to the
 *    calf / foot;
 *  - headgear (optional): the fitted beanie shell (hair already compressed under it, see kit.ts) re-skinned in padded
 *    leather, with cheek / ear pads over the ears and a chin strap; a mouthguard behind the lips;
 *  - the body material: legs below the trunks become skin, the shoes take the boot colour.
 * Matte materials (leather roughness ~0.6 with a fine grain, satin with a soft sheen, no clear-coat: no glare).
 * Deterministic: no randomness (the leather grain is a hashed pattern).
 */

type V = THREE.Vector3;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/* ---------------- shared materials / textures ---------------- */

let grainTex: THREE.DataTexture | null = null;
/** fine leather grain (bump), hashed (no Math.random): the same everywhere */
function grain(): THREE.DataTexture {
  if (grainTex) return grainTex;
  const n = 128;
  const d = new Uint8Array(n * n * 4);
  const h = (x: number, y: number) => {
    let a = (x * 374761393 + y * 668265263) >>> 0;
    a = Math.imul(a ^ (a >>> 13), 1274126177) >>> 0;
    return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // pebbled: a few octaves of hashed cells
      const v = 0.5 * h(x, y) + 0.3 * h(x >> 1, y >> 1) + 0.2 * h(x >> 2, y >> 2);
      const g = Math.round(110 + v * 110);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = g;
      d[i + 3] = 255;
    }
  grainTex = new THREE.DataTexture(d, n, n);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.needsUpdate = true;
  return grainTex;
}

function leather(color: string | null, opts: { vertexColors?: boolean; roughness?: number } = {}) {
  return new THREE.MeshStandardMaterial({ color: color ?? "#ffffff", vertexColors: !!opts.vertexColors, roughness: opts.roughness ?? 0.6, metalness: 0, bumpMap: grain(), bumpScale: 0.35, side: THREE.DoubleSide });
}

function satin(vertexColors = true) {
  return new THREE.MeshPhysicalMaterial({ color: "#ffffff", vertexColors, roughness: 0.42, metalness: 0, sheen: 0.8, sheenRoughness: 0.35, sheenColor: new THREE.Color("#ffffff"), side: THREE.DoubleSide });
}

/* ---------------- geometry helpers ---------------- */

class Builder {
  P: number[] = [];
  C: number[] = [];
  U: number[] = [];
  I: number[] = [];
  get n() {
    return this.P.length / 3;
  }
  v(p: V, c: THREE.Color, u = 0, w = 0) {
    this.P.push(p.x, p.y, p.z);
    this.C.push(c.r, c.g, c.b);
    this.U.push(u, w);
    return this.n - 1;
  }
  /** (cols+1)×(rows+1) grid starting at `base`, wrapping columns already duplicated */
  grid(base: number, cols: number, rows: number, flip = false) {
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = base + j * (cols + 1) + i;
        const b = a + 1,
          c = a + cols + 2,
          d = a + cols + 1;
        if (flip) this.I.push(a, c, b, a, d, c);
        else this.I.push(a, b, c, a, c, d);
      }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.U, 2));
    g.setIndex(this.I);
    g.computeVertexNormals();
    return g;
  }
}

const sgnPow = (x: number, p: number) => Math.sign(x) * Math.pow(Math.abs(x), p);

/**
 * Superellipsoid along an axis frame (f = length axis, u, s), centre c, radii (rf, ru, rs), exponent e (< 1 boxier);
 * `shape(v, a, p)` may push a point (v = 0 back … 1 front, a = azimuth).
 */
function blob(b: Builder, c: V, f: V, u: V, s: V, r: [number, number, number], e: number, segA: number, segV: number, col: (v: number, a: number) => THREE.Color, shape?: (v: number, a: number, p: V) => void) {
  const base = b.n;
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const th = Math.PI * (1 - v); // back (π) → front (0)
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const cf = sgnPow(Math.cos(th), e),
        sf = sgnPow(Math.sin(th), e);
      const p = c.clone()
        .addScaledVector(f, cf * r[0])
        .addScaledVector(u, sf * sgnPow(Math.cos(a), e) * r[1])
        .addScaledVector(s, sf * sgnPow(Math.sin(a), e) * r[2]);
      shape?.(v, a, p);
      b.v(p, col(v, a), i / segA, v);
    }
  }
  b.grid(base, segA, segV);
}

/** open tube along f from x0 to x1 (elliptic section ru × rs, radius scale by `rad(t)`) */
function tube(b: Builder, c: V, f: V, u: V, s: V, x0: number, x1: number, ru: number, rs: number, segA: number, segL: number, col: (t: number, a: number) => THREE.Color, rad: (t: number, a: number) => number = () => 1, flip = false) {
  const base = b.n;
  for (let j = 0; j <= segL; j++) {
    const t = j / segL;
    const x = x0 + (x1 - x0) * t;
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const k = rad(t, a);
      const p = c.clone().addScaledVector(f, x).addScaledVector(u, Math.cos(a) * ru * k).addScaledVector(s, Math.sin(a) * rs * k);
      b.v(p, col(t, a), i / segA, t);
    }
  }
  b.grid(base, segA, segL, flip);
}

/* ---------------- gloves ---------------- */

/**
 * One glove in its own frame (x = along the fingers from the wrist, y = back of the hand, z = the little-finger side
 * of a RIGHT hand; the thumb is on −z). Lengths in metres (a 12 oz glove: ~0.29 m wrist cuff to knuckles).
 */
export function gloveGeometry(main: string, trim: string, laces: string): THREE.BufferGeometry {
  const b = new Builder();
  const cm = new THREE.Color(main),
    ct = new THREE.Color(trim),
    cl = new THREE.Color(laces);
  const cd = cm.clone().multiplyScalar(0.82);
  const X = V3(1, 0, 0),
    Yd = V3(0, 1, 0),
    Zs = V3(0, 0, 1);
  // the padded fist: thicker on the back of the hand, a knuckle roll at the front, flatter on the palm side
  blob(b, V3(0.078, 0.008, 0.003), X, Yd, Zs, [0.098, 0.06, 0.062], 0.8, 28, 18, (v, a) => (v > 0.12 && Math.cos(a) < -0.86 && Math.abs(Math.sin(a)) < 0.18 ? cd : cm), (v, a, p) => {
    // knuckle roll: the front third bulges out on the back of the hand
    const back = Math.max(0, Math.cos(a));
    p.y += 0.012 * back * Math.exp(-(((v - 0.78) / 0.14) ** 2));
    // palm side: flatter and a touch hollow
    if (Math.cos(a) < 0) p.y -= 0.006 * -Math.cos(a) * Math.sin(Math.PI * v);
  });
  // the thumb: a padded capsule on the palm side of −z, attached along its length
  blob(b, V3(0.06, -0.016, -0.05), V3(0.93, -0.12, -0.35).normalize(), V3(0, 1, 0), V3(0, 0, 1), [0.05, 0.022, 0.024], 0.9, 14, 10, () => cm);
  // the cuff round the wrist / forearm, flaring a little at the open end
  tube(b, V3(), X, Yd, Zs, -0.12, 0.02, 0.046, 0.05, 28, 8, (t) => (t < 0.08 ? ct : t > 0.28 && t < 0.56 ? ct : cm), (t) => 1.06 - 0.06 * t + (t > 0.28 && t < 0.56 ? 0.05 : 0));
  // inner lining at the opening (dark, so the cuff never looks hollow)
  tube(b, V3(), X, Yd, Zs, -0.118, -0.1, 0.044, 0.048, 28, 1, () => new THREE.Color("#141414"), () => 1.04, true);
  // laces on the palm side of the cuff: crossed strands over a tongue
  const tongueC = cm.clone().multiplyScalar(0.7);
  for (let k = 0; k < 6; k++) {
    const x = -0.095 + k * 0.016;
    for (const dir of [-1, 1]) {
      const p0 = V3(x, -0.0505, -0.012 * dir),
        p1 = V3(x + 0.016, -0.0505, 0.012 * dir);
      const d = p1.clone().sub(p0);
      const len = d.length();
      d.normalize();
      const w = V3().crossVectors(d, Yd).normalize().multiplyScalar(0.0018);
      const base = b.n;
      for (const [p, sgn] of [
        [p0, -1],
        [p0, 1],
        [p1, 1],
        [p1, -1],
      ] as const)
        b.v(p.clone().addScaledVector(w, sgn).add(V3(0, -0.0012, 0)), cl);
      b.I.push(base, base + 2, base + 1, base, base + 3, base + 2);
      void len;
    }
  }
  // the tongue under the laces
  const tb = b.n;
  for (const [x, z] of [
    [-0.1, -0.014],
    [-0.1, 0.014],
    [0.0, 0.014],
    [0.0, -0.014],
  ] as const)
    b.v(V3(x, -0.0497, z), tongueC);
  b.I.push(tb, tb + 2, tb + 1, tb, tb + 3, tb + 2);
  return b.geometry();
}

/* ---------------- body fitting ---------------- */

interface BodyPoints {
  /** vertex positions in the root frame (bind) */
  pos: Float32Array;
  /** dominant bone index per vertex */
  bone: Int16Array;
  count: number;
  /** triangle vertex indices */
  tris: Uint32Array;
}

function bodyPoints(body: THREE.SkinnedMesh, root: THREE.Object3D): BodyPoints {
  const g = body.geometry;
  const pa = g.getAttribute("position");
  const si = g.getAttribute("skinIndex");
  const sw = g.getAttribute("skinWeight");
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(body.matrixWorld);
  const n = pa.count;
  const pos = new Float32Array(n * 3);
  const bone = new Int16Array(n);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pa as THREE.BufferAttribute, i).applyMatrix4(toRoot);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
    let best = 0,
      bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    bone[i] = best;
  }
  const tris = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
  return { pos, bone, count: n, tris };
}

/**
 * The body's outline at height y: the triangles (with a vertex on one of `bones`) cut by the plane y, sampled along
 * each cut segment. The Rocketbox bodies are low-poly (~900 vertices), so slicing gives a dense, faithful contour
 * where the vertices alone are far too sparse.
 */
export function slice(pts: BodyPoints, y: number, bones: Set<number>, filter?: (x: number, z: number) => boolean): number[] {
  const out: number[] = [];
  const P = pts.pos,
    T = pts.tris;
  const hit: number[] = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t]!,
      b = T[t + 1]!,
      c = T[t + 2]!;
    if (!bones.has(pts.bone[a]!) && !bones.has(pts.bone[b]!) && !bones.has(pts.bone[c]!)) continue;
    hit.length = 0;
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const yi = P[i * 3 + 1]! - y,
        yj = P[j * 3 + 1]! - y;
      if ((yi < 0) === (yj < 0) || yi === yj) continue;
      const k = yi / (yi - yj);
      hit.push(P[i * 3]! + (P[j * 3]! - P[i * 3]!) * k, P[i * 3 + 2]! + (P[j * 3 + 2]! - P[i * 3 + 2]!) * k);
    }
    if (hit.length < 4) continue;
    for (let s = 0; s <= 4; s++) {
      const x = hit[0]! + ((hit[2]! - hit[0]!) * s) / 4,
        z = hit[1]! + ((hit[3]! - hit[1]!) * s) / 4;
      if (!filter || filter(x, z)) out.push(x, z);
    }
  }
  return out;
}

/**
 * Radius profile (per azimuth bin, about cx / cz) of the body's outline at height y: the outermost cut point per
 * bin, gaps filled from the neighbours, then smoothed (a low-pass of the outline, never more than 4 mm inside it).
 */
export function ringProfile(pts: BodyPoints, y: number, bones: Set<number>, cx: number, cz: number, bins: number, filter?: (x: number, z: number) => boolean): number[] {
  const r = new Array<number>(bins).fill(0);
  const sp = slice(pts, y, bones, filter);
  for (let i = 0; i < sp.length; i += 2) {
    const dx = sp[i]! - cx,
      dz = sp[i + 1]! - cz;
    const a = Math.atan2(dx, dz);
    const k = Math.floor(((a / (Math.PI * 2) + 1) % 1) * bins) % bins;
    r[k] = Math.max(r[k]!, Math.hypot(dx, dz));
  }
  if (!r.some((x) => x > 0)) return r.fill(0.1);
  for (let k = 0; k < bins; k++) {
    if (r[k]! > 0) continue;
    let a = 1,
      b = 1;
    while (r[(k - a + bins) % bins]! <= 0) a++;
    while (r[(k + b) % bins]! <= 0) b++;
    const ra = r[(k - a + bins) % bins]!,
      rb = r[(k + b) % bins]!;
    r[k] = ra + ((rb - ra) * a) / (a + b);
  }
  // low-pass (Fourier, 4 harmonics): a garment drapes over the outline, it doesn't follow every facet
  const H = 4;
  const lp = new Array<number>(bins).fill(0);
  for (let h = 0; h <= H; h++) {
    let cs = 0,
      sn = 0;
    for (let k = 0; k < bins; k++) {
      const a = ((k + 0.5) / bins) * Math.PI * 2;
      cs += r[k]! * Math.cos(h * a);
      sn += r[k]! * Math.sin(h * a);
    }
    cs *= (h === 0 ? 1 : 2) / bins;
    sn *= (h === 0 ? 1 : 2) / bins;
    for (let k = 0; k < bins; k++) {
      const a = ((k + 0.5) / bins) * Math.PI * 2;
      lp[k]! += cs * Math.cos(h * a) + sn * Math.sin(h * a);
    }
  }
  return lp.map((x, k) => Math.max(x, r[k]! - 0.004));
}

/** centre of the outline at height y (bounding-box middle: steadier than the mean on uneven meshes) */
function bandCentre(pts: BodyPoints, y: number, bones: Set<number>, filter?: (x: number, z: number) => boolean): [number, number] {
  const sp = slice(pts, y, bones, filter);
  if (!sp.length) return [0, 0];
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < sp.length; i += 2) {
    minX = Math.min(minX, sp[i]!);
    maxX = Math.max(maxX, sp[i]!);
    minZ = Math.min(minZ, sp[i + 1]!);
    maxZ = Math.max(maxZ, sp[i + 1]!);
  }
  return [(minX + maxX) / 2, (minZ + maxZ) / 2];
}

interface SkinSpec {
  /** per vertex: up to 4 [bone index, weight] */
  w: [number, number][][];
}

/** a skinned mesh built in the ROOT frame, converted to the body's mesh space and bound to its skeleton */
function skinnedLike(body: THREE.SkinnedMesh, root: THREE.Object3D, geo: THREE.BufferGeometry, skin: SkinSpec, mat: THREE.Material, name: string): THREE.SkinnedMesh {
  root.updateMatrixWorld(true);
  const toMesh = new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(root.matrixWorld);
  geo.applyMatrix4(toMesh);
  const n = geo.getAttribute("position").count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const ws = skin.w[i]!.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((t, x) => t + x[1], 0) || 1;
    ws.forEach(([b, w], k) => {
      si[i * 4 + k] = b;
      sw[i * 4 + k] = w / sum;
    });
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const m = new THREE.SkinnedMesh(geo, mat);
  m.name = name;
  m.position.copy(body.position);
  m.quaternion.copy(body.quaternion);
  m.scale.copy(body.scale);
  m.bind(body.skeleton, body.bindMatrix);
  m.frustumCulled = false;
  return m;
}

const BINS = 40;

/** trunks: hip tube (waist → crotch) + two leg tubes (crotch → mid-thigh), fitted, skinned */
function trunks(body: THREE.SkinnedMesh, root: THREE.Object3D, pts: BodyPoints, idx: (n: string) => number, bonePos: (n: string) => V, kit: BoxingKit): THREE.SkinnedMesh | null {
  const pelvis = idx("Bip01_Pelvis"),
    spine = idx("Bip01_Spine"),
    thL = idx("Bip01_L_Thigh"),
    thR = idx("Bip01_R_Thigh"),
    caL = idx("Bip01_L_Calf"),
    caR = idx("Bip01_R_Calf");
  if ([pelvis, thL, thR].some((i) => i < 0)) return null;
  const hipL = bonePos("Bip01_L_Thigh"),
    hipR = bonePos("Bip01_R_Thigh"),
    kneeL = bonePos("Bip01_L_Calf");
  const hipY = (hipL.y + hipR.y) / 2;
  const legLen = Math.max(0.3, hipY - kneeL.y);
  const midX = (hipL.x + hipR.x) / 2;
  const toLeft = Math.sign(hipL.x - hipR.x) || 1;
  const trunkBones = new Set([pelvis, spine, thL, thR].filter((i) => i >= 0));
  const b = new Builder();
  const skin: SkinSpec = { w: [] };
  const cMain = new THREE.Color(kit.colors.trunks),
    cBand = new THREE.Color(kit.colors.waistband),
    cStripe = new THREE.Color(kit.colors.stripe);
  const top = hipY + 0.15,
    crotch = hipY - 0.085,
    // long amateur trunks (P3-FGT-09): the hem just above the knee, cut loose so the satin hangs
    hem = hipY - 0.86 * legLen;
  // ---- hip tube
  const rows = 9;
  const base = b.n;
  const [cx0, cz0] = bandCentre(pts, hipY, trunkBones);
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const y = top + (crotch - top) * t;
    const prof = ringProfile(pts, y, trunkBones, cx0, cz0, BINS);
    const ease = 0.011 + 0.012 * t + (t < 0.3 ? 0.004 : 0);
    for (let i = 0; i <= BINS; i++) {
      const a = (i / BINS) * Math.PI * 2;
      const r = prof[i % BINS]! + ease;
      const p = V3(cx0 + Math.sin(a) * r, y, cz0 + Math.cos(a) * r);
      const side = Math.abs(Math.sin(a));
      const col = t < 0.3 ? (t < 0.04 || (t > 0.26 && t < 0.3) ? cStripe : cBand) : side > 0.985 ? cStripe : cMain;
      b.v(p, col, i / BINS, t);
      // waistband with the spine, the rest with the pelvis; the bottom rows hand over to the thighs a little
      const left = (p.x - midX) * toLeft > 0;
      const th = Math.max(0, (t - 0.65) / 0.35) * 0.3;
      const w: [number, number][] = [[pelvis, 1 - th - (t < 0.25 && spine >= 0 ? 0.35 * (1 - t / 0.25) : 0)], [left ? thL : thR, th]];
      if (t < 0.25 && spine >= 0) w.push([spine, 0.35 * (1 - t / 0.25)]);
      skin.w.push(w);
    }
  }
  b.grid(base, BINS, rows, true);
  // ---- leg tubes
  for (const [th, ca, sgn] of [
    [thL, caL, 1],
    [thR, caR, -1],
  ] as const) {
    const legBones = new Set([th, pelvis, ca].filter((i) => i >= 0));
    const filter = (x: number) => (x - midX) * toLeft * sgn > 0.004;
    const lrows = 10;
    const lb = b.n;
    for (let j = 0; j <= lrows; j++) {
      const t = j / lrows;
      const y = crotch + 0.05 + (hem - crotch - 0.05) * t;
      const [cx, cz] = bandCentre(pts, y, legBones, filter);
      const prof = ringProfile(pts, y, legBones, cx, cz, BINS, filter);
      const ease = 0.016 + 0.034 * t;
      for (let i = 0; i <= BINS; i++) {
        const a = (i / BINS) * Math.PI * 2;
        const r = prof[i % BINS]! + ease;
        const p = V3(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
        // the stripe on the outer side of each leg
        const outer = Math.sin(a) * sgn * toLeft;
        const col = t > 0.93 ? cBand : outer > 0.975 ? cStripe : cMain;
        b.v(p, col, i / BINS, t);
        const u = (hipY - y) / legLen;
        const wt = THREE.MathUtils.clamp(0.45 + 1.2 * u, 0, 0.95);
        skin.w.push([
          [pelvis, 1 - wt],
          [th, wt],
        ]);
      }
    }
    b.grid(lb, BINS, lrows, true);
  }
  return skinnedLike(body, root, b.geometry(), skin, satin(true), "gk-trunks");
}

/** high-top boot shafts round the ankles / lower calves (the shoe below is the body's, recoloured) */
function bootShafts(body: THREE.SkinnedMesh, root: THREE.Object3D, pts: BodyPoints, idx: (n: string) => number, bonePos: (n: string) => V, kit: BoxingKit): THREE.SkinnedMesh | null {
  const b = new Builder();
  const skin: SkinSpec = { w: [] };
  const cBoot = new THREE.Color(kit.colors.boots),
    cTrim = new THREE.Color(kit.colors.bootTrim),
    cLace = new THREE.Color(kit.colors.laces);
  const cTongue = cBoot.clone().multiplyScalar(0.72);
  let made = 0;
  for (const k of ["L", "R"] as const) {
    const calf = idx(`Bip01_${k}_Calf`),
      foot = idx(`Bip01_${k}_Foot`);
    if (calf < 0 || foot < 0) continue;
    const ankle = bonePos(`Bip01_${k}_Foot`);
    const toe = bonePos(`Bip01_${k}_Toe0`);
    // the foot's forward direction (bind): ankle → toe, flattened
    const fwd = Math.atan2(toe.x - ankle.x, toe.z - ankle.z);
    const calfOnly = new Set([calf]);
    const y0 = 0.028,
      y1 = ankle.y + 0.2;
    // the shaft follows the lower leg's outline from just above the shoe (below it the shoe would pull it forward)
    const yFit = ankle.y + 0.035;
    const rows = 8;
    const ring: { cx: number; cz: number; prof: number[] }[] = [];
    for (let j = 0; j <= rows; j++) {
      const y = Math.max(yFit, y0 + ((y1 - y0) * j) / rows);
      const [cx, cz] = bandCentre(pts, y, calfOnly);
      ring.push({ cx, cz, prof: ringProfile(pts, y, calfOnly, cx, cz, BINS) });
    }
    const base = b.n;
    const radius = (j: number, a: number) => {
      const t = j / rows;
      const pr = ring[j]!.prof;
      const k2 = (((a / (Math.PI * 2)) % 1) + 1) % 1;
      // a stiff leather shaft: slightly flared at the collar, snug round the ankle
      return pr[Math.floor(k2 * BINS) % BINS]! + 0.01 + (t > 0.88 ? 0.006 : 0) + 0.006 * (1 - t);
    };
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const y = y0 + (y1 - y0) * t;
      const { cx, cz } = ring[j]!;
      for (let i = 0; i <= BINS; i++) {
        const a = (i / BINS) * Math.PI * 2;
        const r = radius(j, a);
        const rel = Math.cos(a - fwd); // 1 = front
        const col = t > 0.88 ? cTrim : rel > 0.9 ? cTongue : cBoot;
        b.v(V3(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r), col, i / BINS, t);
        const wf = THREE.MathUtils.clamp(1 - (y - ankle.y + 0.01) / 0.05, 0, 1);
        skin.w.push([
          [calf, 1 - wf],
          [foot, wf],
        ]);
      }
    }
    b.grid(base, BINS, rows, true);
    // laces: crossed strands down the front, a hair outside the shaft
    for (let j = 1; j < rows - 1; j++) {
      for (const dir of [-1, 1]) {
        const strand: V[] = [];
        for (const [jj, side] of [
          [j, -dir],
          [j + 1, dir],
        ] as const) {
          const a = fwd + side * 0.32;
          const r = radius(jj, a) + 0.0025;
          const { cx, cz } = ring[jj]!;
          strand.push(V3(cx + Math.sin(a) * r, y0 + ((y1 - y0) * jj) / rows, cz + Math.cos(a) * r));
        }
        const d = strand[1]!.clone().sub(strand[0]!);
        const out = V3(Math.sin(fwd), 0, Math.cos(fwd));
        const wv = V3().crossVectors(d, out).normalize().multiplyScalar(0.0022);
        const q = b.n;
        for (const [p, sg] of [
          [strand[0]!, -1],
          [strand[0]!, 1],
          [strand[1]!, 1],
          [strand[1]!, -1],
        ] as const) {
          b.v(p.clone().addScaledVector(wv, sg), cLace);
          const y = p.y;
          const wf = THREE.MathUtils.clamp(1 - (y - ankle.y + 0.01) / 0.05, 0, 1);
          skin.w.push([
            [calf, 1 - wf],
            [foot, wf],
          ]);
        }
        b.I.push(q, q + 1, q + 2, q, q + 2, q + 3);
      }
    }
    made++;
  }
  if (!made) return null;
  return skinnedLike(body, root, b.geometry(), skin, leather(null, { vertexColors: true, roughness: 0.58 }), "gk-boots");
}

/* ---------------- the dressing ---------------- */

export interface Dressing {
  objects: THREE.Object3D[];
  /** skin sheen 0…1 (P3-FGT-09: builds with the work done) */
  setSweat?(v: number): void;
  dispose(): void;
}

/**
 * Dress a body (its rig) in the kit. `materials` = the person's own look materials (their uniforms are changed for
 * this body only). Returns the added objects and an undo.
 */
export function dressBody(root: THREE.Object3D, arms: ArmBones[], materials: THREE.Material[], modelId: string, kit: BoxingKit, shadows: boolean): Dressing {
  const objects: THREE.Object3D[] = [];
  const own: THREE.Material[] = [];
  const undo: (() => void)[] = [];
  // the everyday clothes are modelled into the body: refit it to an athlete's legs, bare arms and a fitted vest first
  // (P3-FGT-07), so the trunks and boot shafts below are fitted to the legs, not to baggy trousers
  undo.push(fitBodyForKit(root, "boxer", modelId === "feminine" || modelId === "neutral" ? modelId : "masculine"));
  const { body, bind } = bindData(root);
  const bone = (n: string) => (root.getObjectByName(n) as THREE.Bone | undefined) ?? null;
  const bonePos = (n: string) => {
    const b = bone(n);
    const m = b ? bind.rel(b) : null;
    return m ? V3().setFromMatrixPosition(m) : V3();
  };

  // ---- the body's own shader: bare legs below the trunks, shoes in the boot colour
  for (const m of materials) {
    const u = m.userData.gkUniforms as LookUniforms | undefined;
    // (P3-FGT-18: a material without the look uniforms — the campus shader no longer carries uLegsSkin — is left as is;
    // the boxing lab's Rocketbox duel threw here)
    if (!u || !u.uLegsSkin || !u.uShoes || !u.uBottom) continue;
    const prev = { legs: u.uLegsSkin.value, shoes: u.uShoes.value.clone(), bottom: u.uBottom.value.clone(), detail: u.uTopDetail?.value ?? 0.85, sweat: u.uSweat?.value ?? 0 };
    u.uLegsSkin.value = 1;
    // the vest is smooth jersey (the everyday garment's folds / prints barely show) and the skin carries a light sheen
    if (u.uTopDetail) u.uTopDetail.value = 0.3;
    if (u.uSweat) u.uSweat.value = 0.35;
    u.uShoes.value.set(kit.colors.boots);
    u.uBottom.value.set(kit.colors.trunks);
    undo.push(() => {
      u.uLegsSkin.value = prev.legs;
      u.uShoes.value.copy(prev.shoes);
      u.uBottom.value.copy(prev.bottom);
      if (u.uTopDetail) u.uTopDetail.value = prev.detail;
      if (u.uSweat) u.uSweat.value = prev.sweat;
    });
  }

  // ---- gloves (rigid on the hand bones, in the hand's finger / palm frame)
  const gloveGeo = gloveGeometry(kit.colors.gloves, kit.colors.gloveTrim, kit.colors.laces);
  const gloveMat = leather(null, { vertexColors: true });
  own.push(gloveMat);
  root.updateMatrixWorld(true);
  for (const a of arms) {
    const hm = bind.rel(a.hand);
    if (!hm) continue;
    const inv = hm.clone().invert();
    const loc = (b: THREE.Object3D | undefined, fb: V) => {
      const m = b ? bind.rel(b) : null;
      return m ? V3().setFromMatrixPosition(m).applyMatrix4(inv).normalize() : fb;
    };
    const f = loc(a.fingers[2]?.[0], V3(1, 0, 0));
    const th = loc(a.fingers[0]?.[0], V3(0, 0, 1));
    // palm normal (out of the palm), as the boxing rig: right hand fingers × thumb = back of the hand
    const palm = V3().crossVectors(f, th).multiplyScalar(-a.side).normalize();
    const back = palm.clone().negate();
    back.addScaledVector(f, -back.dot(f)).normalize();
    // glove frame: x = fingers, y = back of the hand, z = x × y (the little-finger side of a right hand)
    const z = V3().crossVectors(f, back).normalize();
    const g = new THREE.Mesh(gloveGeo, gloveMat);
    g.name = "gk-glove";
    const basis = new THREE.Matrix4().makeBasis(f, back, z);
    g.quaternion.setFromRotationMatrix(basis);
    // a left glove is the right one mirrored (thumb on the other side)
    const s = 1 / Math.max(1e-6, V3().setFromMatrixScale(hm).x);
    g.scale.set(s, s, s * (a.side === 1 ? 1 : -1));
    // the hand's centre: a little palm-side of the bone line
    g.position.copy(f).multiplyScalar(0.012 * s).addScaledVector(back, -0.004 * s);
    g.castShadow = shadows;
    g.frustumCulled = false;
    a.hand.add(g);
    objects.push(g);
    // the hand itself is inside the glove: never poke through (fingers stay curled by the boxing layer)
  }

  // ---- trunks + boot shafts (fitted to this body, skinned)
  if (body) {
    const sk = body as THREE.SkinnedMesh;
    const pts = bodyPoints(sk, root);
    const idx = (n: string) => sk.skeleton.bones.findIndex((b) => b.name === n);
    for (const make of [trunks, bootShafts]) {
      const m = make(sk, root, pts, idx, bonePos, kit);
      if (!m) continue;
      m.castShadow = shadows;
      sk.parent!.add(m);
      objects.push(m);
      own.push(m.material as THREE.Material);
    }
  }

  // ---- headgear: the fitted beanie shell (hair compressed under it) in padded leather + cheek / ear pads + strap
  const headBone = bone("Bip01_Head");
  let headMesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!headMesh && m.isSkinnedMesh && (m.material as THREE.Material).name === "head" && m.skeleton.bones.some((b) => b.name === "Bip01_LEye")) headMesh = m;
  });
  const hmesh = headMesh as THREE.SkinnedMesh | null;
  // face frame in the root frame of the bind pose (all from the skeleton's bind matrices, like everything else here):
  // origin between the eyes, x = the person's left, y up, z forward
  const eyeL = bone("Bip01_LEye"),
    eyeR = bone("Bip01_REye");
  const frame = hmesh && eyeL && eyeR && bind.rel(eyeL) && bind.rel(eyeR) ? { o: bonePos("Bip01_LEye").add(bonePos("Bip01_REye")).multiplyScalar(0.5), x: bonePos("Bip01_LEye").sub(bonePos("Bip01_REye")).normalize() } : null;
  /** face-frame metres → head-bone local matrix (position + the face axes) */
  let faceToHead: ((x: number, y: number, z: number) => THREE.Matrix4) | null = null;
  if (frame && headBone) {
    const ax = [frame.x, V3(0, 1, 0).addScaledVector(frame.x, -frame.x.y).normalize(), V3()];
    ax[2]!.crossVectors(ax[0]!, ax[1]!).normalize();
    const headInv = bind.rel(headBone)?.clone().invert() ?? new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeBasis(ax[0]!, ax[1]!, ax[2]!);
    faceToHead = (x, y, z) => {
      const p = frame.o.clone().addScaledVector(ax[0]!, x).addScaledVector(ax[1]!, y).addScaledVector(ax[2]!, z);
      return new THREE.Matrix4().copy(rot).setPosition(p).premultiply(headInv);
    };
  }
  if (kit.headgear) {
    const hg = root.getObjectByName("gk-headwear") as THREE.Mesh | undefined;
    const hgMat = leather(kit.colors.headgear, { roughness: 0.6 });
    own.push(hgMat);
    if (hg) {
      const prev = hg.material;
      hg.material = hgMat;
      undo.push(() => (hg.material = prev));
    }
    if (faceToHead && headBone) {
      const ears = EAR_LANDMARKS[(modelId in EAR_LANDMARKS ? modelId : "neutral") as BodyType];
      const pb = new Builder();
      const cm = new THREE.Color(kit.colors.headgear),
        ct = new THREE.Color(kit.colors.gloveTrim);
      const X = V3(1, 0, 0),
        Yv = V3(0, 1, 0),
        Zv = V3(0, 0, 1);
      for (const s of [-1, 1]) {
        // ear pad (covers the ear, a breathing hole ring in the trim colour) + cheek pad along the cheekbone
        const ez = (ears.earFront + ears.earBack) / 2;
        blob(pb, V3(s * (ears.earX + 0.008), ears.earTop - 0.034, ez + 0.004), X.clone().multiplyScalar(s), Yv, Zv.clone().multiplyScalar(s), [0.016, 0.044, 0.038], 0.75, 18, 8, (v) => (v > 0.93 ? ct : cm));
        blob(pb, V3(s * (ears.earX - 0.012), ears.earTop - 0.064, ears.earFront + 0.028), X.clone().multiplyScalar(s), Yv, Zv.clone().multiplyScalar(s), [0.016, 0.036, 0.03], 0.75, 14, 6, () => cm);
      }
      // chin strap: under the jaw from pad to pad
      const strap = new Builder();
      const sb = strap.n;
      const segs = 16;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const a = Math.PI * (t - 0.5); // −90° … 90°
        const p = V3(Math.sin(a) * (ears.earX - 0.006), ears.earTop - 0.098 - 0.03 * Math.cos(a), ears.earFront - 0.006 + 0.064 * Math.cos(a));
        for (const dy of [-0.009, 0.009]) strap.v(p.clone().add(V3(0, dy, 0)), new THREE.Color("#18181a"));
      }
      for (let i = 0; i < segs; i++) {
        const a = sb + i * 2;
        strap.I.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
      const padGeo = pb.geometry();
      const pads = new THREE.Mesh(padGeo, leather(null, { vertexColors: true }));
      const strapM = new THREE.Mesh(strap.geometry(), new THREE.MeshStandardMaterial({ color: "#1a1a1c", roughness: 0.85, side: THREE.DoubleSide }));
      own.push(pads.material as THREE.Material, strapM.material as THREE.Material);
      for (const m of [pads, strapM]) {
        m.matrixAutoUpdate = true;
        faceToHead(0, 0, 0).decompose(m.position, m.quaternion, m.scale);
        m.castShadow = shadows;
        m.frustumCulled = false;
        m.name = "gk-headgear";
        headBone.add(m);
        objects.push(m);
      }
    }
  }
  // ---- mouthguard: behind the lips at the teeth (seen when the mouth opens)
  if (kit.mouthguard && faceToHead && headBone && frame && bone("Bip01_MUpperLip") && bone("Bip01_MBottomLip")) {
    // the mouth (between the lips, bind pose) in face-frame metres
    const mouth = bonePos("Bip01_MUpperLip").add(bonePos("Bip01_MBottomLip")).multiplyScalar(0.5).sub(frame.o);
    const my = mouth.y,
      mz = mouth.z;
    const g = new THREE.TorusGeometry(0.024, 0.0055, 6, 16, Math.PI * 0.9);
    g.rotateX(Math.PI / 2);
    g.rotateY(-Math.PI * 0.05 + Math.PI);
    g.scale(1, 1, 0.75);
    const mg = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: kit.colors.mouthguard, roughness: 0.5 }));
    own.push(mg.material as THREE.Material);
    faceToHead(0, my + 0.004, mz - 0.024).decompose(mg.position, mg.quaternion, mg.scale);
    mg.name = "gk-mouthguard";
    mg.frustumCulled = false;
    headBone.add(mg);
    objects.push(mg);
  }

  return {
    objects,
    setSweat(v: number) {
      for (const m of materials) {
        const u = m.userData.gkUniforms as LookUniforms | undefined;
        if (u?.uSweat) u.uSweat.value = v;
      }
    },
    dispose() {
      for (const o of objects) o.removeFromParent();
      for (const o of objects)
        o.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh && m.geometry !== gloveGeo) m.geometry.dispose();
        });
      gloveGeo.dispose();
      own.forEach((m) => m.dispose());
      undo.forEach((f) => f());
    },
  };
}

/**
 * The referee's dress (P3-FGT-07): white shirt, black trousers and shoes on the staff body (its uniform recoloured),
 * and a black bow tie at the collar. Returns the undo.
 */
export function dressReferee(root: THREE.Object3D, materials: THREE.Material[], shadows: boolean): Dressing {
  // the hood of the modelled hoodie folds away: a plain shirt
  const undo: (() => void)[] = [fitBodyForKit(root, "official")];
  for (const m of materials) {
    const u = m.userData.gkUniforms as LookUniforms | undefined;
    if (!u) continue;
    const prev = { top: u.uTop.value.clone(), bottom: u.uBottom.value.clone(), shoes: u.uShoes.value.clone() };
    u.uTop.value.set("#f2f1ec");
    u.uBottom.value.set("#1a1a1d");
    u.uShoes.value.set("#0f0f10");
    undo.push(() => {
      u.uTop.value.copy(prev.top);
      u.uBottom.value.copy(prev.bottom);
      u.uShoes.value.copy(prev.shoes);
    });
  }
  const objects: THREE.Object3D[] = [];
  const { body, bind } = bindData(root);
  const neck = root.getObjectByName("Bip01_Neck") as THREE.Bone | undefined;
  const head = root.getObjectByName("Bip01_Head") as THREE.Bone | undefined;
  const mat = new THREE.MeshStandardMaterial({ color: "#111113", roughness: 0.55 });
  if (body && neck && head) {
    const nm = bind.rel(neck);
    const hm = bind.rel(head);
    if (nm && hm) {
      // the collar front: a little below the neck bone, forward by the neck's radius (root frame, bind pose)
      const np = V3().setFromMatrixPosition(nm);
      const hp = V3().setFromMatrixPosition(hm);
      const at = np.clone().lerp(hp, -0.15).add(V3(0, -0.01, 0.075));
      const b = new Builder();
      const col = new THREE.Color("#111113");
      const X = V3(1, 0, 0),
        Y = V3(0, 1, 0),
        Z = V3(0, 0, 1);
      // two wings and the knot
      blob(b, V3(0.026, 0, 0), X, Y, Z, [0.026, 0.018, 0.008], 0.8, 10, 5, () => col, (_v, _a, p) => void (p.y *= 1 + Math.abs(p.x) * 14));
      blob(b, V3(-0.026, 0, 0), X, Y, Z, [0.026, 0.018, 0.008], 0.8, 10, 5, () => col, (_v, _a, p) => void (p.y *= 1 + Math.abs(p.x) * 14));
      blob(b, V3(0, 0, 0.004), X, Y, Z, [0.009, 0.011, 0.008], 0.9, 8, 4, () => col);
      const g = b.geometry();
      const tie = new THREE.Mesh(g, mat);
      tie.name = "gk-bowtie";
      tie.castShadow = shadows;
      tie.frustumCulled = false;
      // into the neck bone's frame
      const inv = nm.clone().invert();
      const m = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).premultiply(inv);
      m.decompose(tie.position, tie.quaternion, tie.scale);
      neck.add(tie);
      objects.push(tie);
    }
  }
  return {
    objects,
    dispose() {
      for (const o of objects) {
        o.removeFromParent();
        (o as THREE.Mesh).geometry?.dispose();
      }
      mat.dispose();
      undo.forEach((f) => f());
    },
  };
}
