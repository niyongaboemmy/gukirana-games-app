import * as THREE from "three";
import type { BodyType, HairStyle, HeadwearKind } from "../outfits";
import { weldGroups } from "./head-geometry";
import { EAR_LANDMARKS, SKULL_FITS, skullNormal, skullPoint, skullStandoff } from "./skull";
import { bandY, clippedLength, hatClearance, SHELL, skullAzimuth, strandRadius, swayWeight } from "./head-fit";
import { dirAt, elevationAt } from "./headwear";
import { campusHumansOn } from "./realism-flag";

/**
 * Real hair geometry for the realistic avatars (P2-AVA-10). Before this, close hair was paint on the scalp and only a
 * few styles had a (floating) volume. Now every style is geometry that sits exactly on that body's skull:
 *
 *  - close hair (short, fade, buzz, 360 waves, cornrows, and the pulled-back base under every volume) is a stack of
 *    thin shells grown out of the head mesh's own hair-region triangles (same UVs, same skin weights, offset along the
 *    welded normals): it follows the head exactly, its edge is the cleaned hair mask (hairline, sideburns, nape), and
 *    the shader cuts each layer into coil / strand clusters (a fade thins out towards the skin);
 *  - volumes (afro, high-top) inflate that same surface outwards with a taper to zero at the hairline (no helmet
 *    edge), puffs and a bun are coily balls set onto the skull surface;
 *  - braids, locs, twists and short locs are strands rooted on the scalp that drape over the head and hang (kept out
 *    of the skull, the face and the neck);
 *  - under headwear the close hair is pressed down to the hat's clearance and volumes give way.
 * Everything for one person is ONE skinned mesh (one draw call), cached per body / style / headwear class and shared
 * by everyone with that combination; beyond ~9 m a single-layer, lower-poly version is drawn.
 *
 * Frames: the "face frame" (skull.ts) is the head's bind pose in metres; geometry space is the head mesh's own
 * (bind) space. p_geometry = o + Rᵀ · p_face.
 */

/* ---------------- frames and the hair mask ---------------- */

export interface HeadFrame {
  /** origin between the eyes (geometry space) */
  o: THREE.Vector3;
  /** geometry → face frame rotation (rows = face x / y / z axes) */
  R: THREE.Matrix3;
  /** face → geometry */
  Rt: THREE.Matrix3;
  /** index of Bip01_Head in the skeleton */
  head: number;
}

const _m4 = new THREE.Matrix4();
const _bi = new THREE.Matrix4();
function bonePos(mesh: THREE.SkinnedMesh, i: number, out: THREE.Vector3) {
  _m4.copy(mesh.skeleton.boneInverses[i]!).invert().premultiply(_bi);
  return out.setFromMatrixPosition(_m4);
}

/** Face frame of a skinned head in its geometry space (same axes as face-rig.ts faceFrameOf, metres). */
export function headFrameOf(mesh: THREE.SkinnedMesh): HeadFrame | null {
  const sk = mesh.skeleton;
  const idx = (n: string) => sk.bones.findIndex((b) => b.name === n);
  const iL = idx("Bip01_LEye"),
    iR = idx("Bip01_REye"),
    iU = idx("Bip01_MUpperLip"),
    iB = idx("Bip01_MBottomLip"),
    iH = idx("Bip01_Head");
  if (iL < 0 || iR < 0 || iU < 0 || iB < 0 || iH < 0) return null;
  _bi.copy(mesh.bindMatrix).invert();
  const le = bonePos(mesh, iL, new THREE.Vector3());
  const re = bonePos(mesh, iR, new THREE.Vector3());
  const mouth = bonePos(mesh, iU, new THREE.Vector3())
    .add(bonePos(mesh, iB, new THREE.Vector3()))
    .multiplyScalar(0.5);
  const o = le.clone().add(re).multiplyScalar(0.5);
  const x = le.clone().sub(re).normalize();
  const toEyes = o.clone().sub(mouth).normalize();
  _m4.copy(sk.boneInverses[iL]!).invert().premultiply(_bi);
  const basis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  _m4.extractBasis(basis[0]!, basis[1]!, basis[2]!);
  let y = basis[0]!.normalize();
  for (const b of basis) if (Math.abs(b.normalize().dot(toEyes)) > Math.abs(y.dot(toEyes))) y = b;
  y = y.clone().multiplyScalar(Math.sign(y.dot(toEyes)) || 1);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const R = new THREE.Matrix3().set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
  return { o, R, Rt: R.clone().transpose(), head: iH };
}

export interface MaskPixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}
const maskCache = new WeakMap<THREE.Texture, MaskPixels | null>();
/** CPU copy of a recolour mask (once per base texture). */
export function maskPixels(tex: THREE.Texture | null | undefined): MaskPixels | null {
  if (!tex) return null;
  if (maskCache.has(tex)) return maskCache.get(tex)!;
  let out: MaskPixels | null = null;
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (img && typeof document !== "undefined" && img.width > 0) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (g) {
      g.drawImage(img, 0, 0);
      out = { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    }
  }
  maskCache.set(tex, out);
  return out;
}

/** Hair weight (mask G, 0..1) at a UV (glTF UVs: v = 0 is the top row). */
export function hairAt(m: MaskPixels, u: number, v: number): number {
  const x = THREE.MathUtils.clamp(u * m.w - 0.5, 0, m.w - 1);
  const y = THREE.MathUtils.clamp(v * m.h - 0.5, 0, m.h - 1);
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, m.w - 1),
    y1 = Math.min(y0 + 1, m.h - 1);
  const fx = x - x0,
    fy = y - y0;
  const g = (xx: number, yy: number) => m.data[(yy * m.w + xx) * 4 + 1]! / 255;
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
}

/* ---------------- head clean-up: the neutral body's baked cap, the feminine bob ---------------- */

/** The neutral head's baked baseball-cap brim (UV islands at the top corners of its texture). */
export const isBrimUV = (u: number, v: number) => v < 0.25 && (u < 0.3 || u > 0.7);

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Pull hair-region vertices that stand off the skull down onto it (`keep` m above the template surface), per weld
 * group so UV-seam duplicates move together. `tuck`: hair hanging below the ear tops in front of the ears' back edge
 * (a bob's sides) goes just under the skin; `inner`: UV test for inner surfaces of a hair volume (go deeper).
 * Returns the number of vertices moved. In place.
 */
export function deflateHair(
  geo: THREE.BufferGeometry,
  frame: HeadFrame,
  body: BodyType,
  mask: MaskPixels,
  opts: {
    keep: number;
    tuck?: boolean;
    inner?: (u: number, v: number) => boolean;
    force?: (u: number, v: number) => boolean;
  },
): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const weld = weldGroups(pos);
  let groups = 0;
  for (let i = 0; i < weld.length; i++) groups = Math.max(groups, weld[i]! + 1);
  const hw = new Float32Array(groups);
  const inner = new Uint8Array(groups);
  const first = new Int32Array(groups).fill(-1);
  for (let i = 0; i < pos.count; i++) {
    const g = weld[i]!;
    const h = hairAt(mask, uv.getX(i), uv.getY(i));
    if (h > hw[g]!) hw[g] = h;
    if (opts.inner?.(uv.getX(i), uv.getY(i)) && (h > 0.5 || opts.force?.(uv.getX(i), uv.getY(i))))
      inner[g] = 1;
    if (opts.force?.(uv.getX(i), uv.getY(i))) hw[g] = 1;
    if (first[g]! < 0) first[g] = i;
  }
  const ears = EAR_LANDMARKS[body];
  const c = SKULL_FITS[body].c;
  const target = new Float32Array(groups * 3);
  const move = new Uint8Array(groups);
  for (let g = 0; g < groups; g++) {
    if (hw[g]! < 0.35) continue;
    _p.fromBufferAttribute(pos, first[g]!);
    _f.copy(_p).sub(frame.o).applyMatrix3(frame.R);
    const sd = skullStandoff(body, _f, _s);
    let keep = opts.keep;
    if (opts.tuck && _f.y < ears.earTop + 0.012 && _f.z > ears.earBack - 0.012) keep = -0.004;
    if (inner[g]) keep = -0.007;
    if (sd <= keep) continue;
    _d.set(_s.x - c[0], _s.y - c[1], _s.z - c[2]);
    const r = _d.length();
    _f.set(c[0], c[1], c[2]).addScaledVector(_d, (r + keep) / r);
    _p.copy(_f).applyMatrix3(frame.Rt).add(frame.o);
    target.set([_p.x, _p.y, _p.z], g * 3);
    move[g] = 1;
  }
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const g = weld[i]!;
    if (!move[g]) continue;
    pos.setXYZ(i, target[g * 3]!, target[g * 3 + 1]!, target[g * 3 + 2]!);
    moved++;
  }
  pos.needsUpdate = true;
  return moved;
}

/** Drop the neutral head's cap brim triangles (in place). Returns the number of triangles removed. */
export function dropBrim(geo: THREE.BufferGeometry): number {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const idx = geo.index!;
  const keep: number[] = [];
  let dropped = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t),
      b = idx.getX(t + 1),
      c = idx.getX(t + 2);
    if (
      isBrimUV(uv.getX(a), uv.getY(a)) ||
      isBrimUV(uv.getX(b), uv.getY(b)) ||
      isBrimUV(uv.getX(c), uv.getY(c))
    ) {
      dropped++;
      continue;
    }
    keep.push(a, b, c);
  }
  geo.setIndex(keep);
  return dropped;
}

/* ---------------- geometry assembly ---------------- */

class Builder {
  P: number[] = [];
  N: number[] = [];
  U: number[] = [];
  H: number[] = [];
  SI: number[] = [];
  SW: number[] = [];
  I: number[] = [];
  constructor(
    private frame: HeadFrame,
    private body: BodyType,
  ) {}
  get count() {
    return this.P.length / 3;
  }
  /** vertex already in geometry space */
  raw(
    p: THREE.Vector3,
    n: THREE.Vector3,
    u: number,
    v: number,
    hk: readonly number[],
    si: readonly number[],
    sw: readonly number[],
  ) {
    this.P.push(p.x, p.y, p.z);
    this.N.push(n.x, n.y, n.z);
    this.U.push(u, v);
    this.H.push(hk[0]!, hk[1]!, hk[2]!, hk[3]!);
    this.SI.push(si[0]!, si[1]!, si[2]!, si[3]!);
    this.SW.push(sw[0]!, sw[1]!, sw[2]!, sw[3]!);
    return this.count - 1;
  }
  private _g = new THREE.Vector3();
  private _n = new THREE.Vector3();
  private headSI = [0, 0, 0, 0];
  private headSW = [1, 0, 0, 0];
  /** vertex in the face frame, rigidly on the head bone */
  face(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, hk: readonly number[]) {
    this.headSI[0] = this.frame.head;
    this._g.copy(p).applyMatrix3(this.frame.Rt).add(this.frame.o);
    this._n.copy(n).applyMatrix3(this.frame.Rt).normalize();
    return this.raw(this._g, this._n, u, v, hk, this.headSI, this.headSW);
  }
  tri(a: number, b: number, c: number) {
    this.I.push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute("huv", new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute("hk", new THREE.Float32BufferAttribute(this.H, 4));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(
      this.count > 65535
        ? new THREE.Uint32BufferAttribute(this.I, 1)
        : new THREE.Uint16BufferAttribute(this.I, 1),
    );
    g.computeBoundingSphere();
    g.userData.gkShared = true;
    void this.body;
    return g;
  }
}

/** deterministic hash noise (cosmetic only; no Math.random) */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf),
    v = s(yf),
    w = s(zf);
  const l = THREE.MathUtils.lerp;
  return l(
    l(
      l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
      l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u),
      v,
    ),
    l(
      l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
      l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

interface HeadSurface {
  /** face-frame positions per vertex */
  F: Float32Array;
  /** welded, area-weighted face-frame normals per vertex */
  NF: Float32Array;
  hw: Float32Array;
  weld: Int32Array;
  groups: number;
  /** triangles of the hair region (vertex indices) */
  tris: number[];
}

/** Hair region of a head geometry (face-frame positions, welded normals, mask weights). */
function hairSurface(
  geo: THREE.BufferGeometry,
  frame: HeadFrame,
  mask: MaskPixels,
  body: BodyType,
): HeadSurface {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const n = pos.count;
  const F = new Float32Array(n * 3);
  const hw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    _p.fromBufferAttribute(pos, i).sub(frame.o).applyMatrix3(frame.R);
    F.set([_p.x, _p.y, _p.z], i * 3);
    hw[i] = hairAt(mask, uv.getX(i), uv.getY(i));
    // P2-AVA-12: the brows are not scalp (some base masks mark the photo brows as hair: a short-hair shell grew over
    // them, a pale furry bar above each brow)
    if (BROWS_OFF && _p.y < 0.062 && _p.z > -0.004 && Math.abs(_p.x) < 0.078) hw[i] = 0;
  }
  const weld = weldGroups(pos);
  let groups = 0;
  for (let i = 0; i < n; i++) groups = Math.max(groups, weld[i]! + 1);
  const gn = new Float32Array(groups * 3);
  const idx = geo.index!;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    fn = new THREE.Vector3();
  const tris: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t),
      i1 = idx.getX(t + 1),
      i2 = idx.getX(t + 2);
    a.fromArray(F, i0 * 3);
    b.fromArray(F, i1 * 3);
    c.fromArray(F, i2 * 3);
    fn.subVectors(b, a).cross(c.clone().sub(a)); // area weighted
    for (const i of [i0, i1, i2]) {
      const g = weld[i]!;
      gn[g * 3] = gn[g * 3]! + fn.x;
      gn[g * 3 + 1] = gn[g * 3 + 1]! + fn.y;
      gn[g * 3 + 2] = gn[g * 3 + 2]! + fn.z;
    }
    const h = Math.max(hw[i0]!, hw[i1]!, hw[i2]!);
    if (h < 0.04) continue;
    // never the brows (hair-masked texels on the front of the face, below the hairline)
    const browish = (i: number) => F[i * 3 + 1]! < 0.05 && F[i * 3 + 2]! > -0.035;
    if (browish(i0) && browish(i1) && browish(i2)) continue;
    // nothing under the jaw / on the neck front
    if (Math.max(F[i0 * 3 + 1]!, F[i1 * 3 + 1]!, F[i2 * 3 + 1]!) < -0.11) continue;
    // tucked under the skin (a deflated bob's under-side): no hair grows from there
    a.add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    if (skullStandoff(body, a) < -0.0025) continue;
    tris.push(i0, i1, i2);
  }
  const NF = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = weld[i]!;
    fn.set(gn[g * 3]!, gn[g * 3 + 1]!, gn[g * 3 + 2]!).normalize();
    NF.set([fn.x, fn.y, fn.z], i * 3);
  }
  return { F, NF, hw, weld, groups, tris };
}

const smooth = THREE.MathUtils.smoothstep;
const BROWS_OFF = campusHumansOn();
const V = () => new THREE.Vector3();

/** Stacked close-hair shells from the hair-region triangles of `geo`. */
function addShells(
  B: Builder,
  geo: THREE.BufferGeometry,
  s: HeadSurface,
  frame: HeadFrame,
  style: HairStyle,
  hat: HeadwearKind,
  body: BodyType,
  layers: number,
) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const used = new Map<number, number>();
  const verts: number[] = [];
  for (const i of s.tris) {
    if (used.has(i)) continue;
    used.set(i, used.size);
    verts.push(i);
  }
  const L = new Float32Array(verts.length);
  verts.forEach(
    (i, k) => (L[k] = clippedLength(style, hat, body, s.F[i * 3]!, s.F[i * 3 + 1]!, s.F[i * 3 + 2]!)),
  );
  const p = V(),
    n = V(),
    nf = V();
  const SI = [0, 0, 0, 0],
    SW = [0, 0, 0, 0];
  for (let k = 0; k < layers; k++) {
    const lf = layers === 1 ? 0.55 : k / (layers - 1);
    const base = B.count;
    verts.forEach((i, j) => {
      nf.fromArray(s.NF, i * 3);
      const off = 0.0005 + L[j]! * lf;
      p.fromBufferAttribute(pos, i).add(n.copy(nf).multiplyScalar(off).applyMatrix3(frame.Rt));
      n.copy(nf).applyMatrix3(frame.Rt).normalize();
      for (let c = 0; c < 4; c++) {
        SI[c] = si.getComponent(i, c);
        SW[c] = sw.getComponent(i, c);
      }
      B.raw(p, n, uv.getX(i), uv.getY(i), [lf, 0, L[j]!, s.hw[i]!], SI, SW);
    });
    for (let t = 0; t < s.tris.length; t += 3)
      B.tri(base + used.get(s.tris[t]!)!, base + used.get(s.tris[t + 1]!)!, base + used.get(s.tris[t + 2]!)!);
  }
}

/** Natural hairline of a volume style (face frame y at azimuth `az`): forehead, over the ears, the nape. */
export function hairlineY(body: BodyType, az: number): number {
  const k = SKULL_FITS[body].s[1];
  const f = 0.08 * k,
    side = EAR_LANDMARKS[body].earTop + 0.006,
    back = -0.058 * k;
  const a1 = (f - back) / 2,
    a0 = (f + back) / 4 + side / 2,
    a2 = (f + back) / 4 - side / 2;
  return a0 + a1 * Math.cos(az) + a2 * Math.cos(2 * az);
}

/**
 * Afro / high-top volume: a grid over the head from the hairline up to the crown, at the skull surface plus a
 * thickness that grows from nothing at the hairline (no helmet edge, no step over the forehead). Afro: out to a round
 * silhouette (an ellipsoid round the head, centred a little up and back); high-top: short faded sides and a neat,
 * flat-topped block on the crown. Coily lumps break the surface; fuzz shells (kind 2) soften the silhouette.
 */
function addVolume(B: Builder, style: "afro" | "hightop", body: BodyType, lod: 0 | 1) {
  const cols = lod === 0 ? 72 : 32,
    rows = lod === 0 ? 22 : 9;
  const c = SKULL_FITS[body].c,
    sc = SKULL_FITS[body].s[0];
  const d = V(),
    sp = V(),
    n = V(),
    u = V();
  const P: THREE.Vector3[][] = [];
  const T: number[][] = [];
  const top = skullPoint(body, new THREE.Vector3(0, 1, 0), V()).y;
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (i / cols) * Math.PI * 2;
    const elB = elevationAt(body, az, hairlineY(body, az));
    const col: THREE.Vector3[] = [];
    const tc: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const el = THREE.MathUtils.lerp(elB, Math.PI / 2 - 0.001, Math.pow(v, 0.85));
      dirAt(body, az, el, d);
      skullPoint(body, d, sp);
      skullNormal(body, d, n);
      u.set(sp.x - c[0], sp.y - c[1], sp.z - c[2]);
      const r0 = u.length();
      u.divideScalar(r0);
      const grow = smooth(v, 0.0, 0.32);
      let t: number;
      const p = sp.clone();
      if (style === "afro") {
        const ex = 0.13 * sc,
          ey = 0.12 * sc,
          ez = 0.132 * sc;
        const oy = c[1] + 0.03 * sc,
          oz = c[2] - 0.014;
        const px = c[0] / ex,
          py = (c[1] - oy) / ey,
          pz = (c[2] - oz) / ez;
        const ux = u.x / ex,
          uy = u.y / ey,
          uz = u.z / ez;
        const A = ux * ux + uy * uy + uz * uz,
          Bq = 2 * (px * ux + py * uy + pz * uz),
          C = px * px + py * py + pz * pz - 1;
        const tE = (-Bq + Math.sqrt(Math.max(0, Bq * Bq - 4 * A * C))) / (2 * A);
        t = Math.max(0.002, (tE - r0) * grow);
        p.addScaledVector(u, t);
      } else {
        const up = smooth(v, 0.35, 0.62);
        t = 0.0035 + 0.01 * up;
        p.addScaledVector(n, t);
        p.y += Math.max(0, top + 0.026 - p.y) * up * 0.85;
        t += Math.max(0, top + 0.026 - sp.y) * up * 0.5;
      }
      // coily lumps
      const lump =
        ((vnoise(p.x * 22, p.y * 22, p.z * 22) - 0.5) * 0.026 +
          (vnoise(p.x * 55, p.y * 55, p.z * 55) - 0.5) * 0.006) *
        smooth(t, 0.004, 0.03);
      p.addScaledVector(u, lump);
      col.push(p);
      tc.push(grow);
    }
    P.push(col);
    T.push(tc);
  }
  const shells = lod === 0 ? [0, 0.0028, 0.0056] : [0];
  const t1 = V(),
    t2 = V(),
    nn = V(),
    q = V();
  shells.forEach((off, k) => {
    const base = B.count;
    for (let i = 0; i <= cols; i++)
      for (let j = 0; j <= rows; j++) {
        t1.subVectors(P[Math.min(cols, i + 1)]![j]!, P[Math.max(0, i - 1)]![j]!);
        t2.subVectors(P[i]![Math.min(rows, j + 1)]!, P[i]![Math.max(0, j - 1)]!);
        nn.crossVectors(t1, t2).normalize();
        if (j === rows) nn.set(0, 1, 0);
        q.copy(P[i]![j]!).addScaledVector(nn, off);
        B.face(q, nn, i / cols, j / rows, [
          k / Math.max(1, shells.length - 1),
          k === 0 ? 1 : 2,
          T[i]![j]!,
          1,
        ]);
      }
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const a = base + i * (rows + 1) + j;
        B.tri(a, a + rows + 1, a + rows + 2);
        B.tri(a, a + rows + 2, a + 1);
      }
  });
}

/** A coily ball (puff / bun) seated on the skull: `dir` = template-space direction, `r` radius, `sink` how deep its base sits in the hair. */
function addBall(
  B: Builder,
  body: BodyType,
  dir: THREE.Vector3,
  r: number,
  squash: THREE.Vector3,
  seed: number,
  lod: 0 | 1,
  kind = 1,
) {
  const surf = skullPoint(body, dir.clone().normalize(), V());
  const nrm = skullNormal(body, dir.clone().normalize(), V());
  const centre = surf.clone().addScaledVector(nrm, r * 0.62);
  const ws = lod === 0 ? 28 : 14,
    hs = lod === 0 ? 20 : 10;
  const shells = lod === 0 ? [0, 0.003, 0.006] : [0];
  const p = V(),
    n = V();
  shells.forEach((off, k) => {
    const base = B.count;
    for (let j = 0; j <= hs; j++) {
      const th = (j / hs) * Math.PI;
      for (let i = 0; i <= ws; i++) {
        const ph = (i / ws) * Math.PI * 2;
        n.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        const lump =
          1 +
          (vnoise(n.x * 4 + seed, n.y * 4, n.z * 4) - 0.5) * 0.16 +
          (vnoise(n.x * 11, n.y * 11 + seed, n.z * 11) - 0.5) * 0.06;
        p.set(n.x * squash.x, n.y * squash.y, n.z * squash.z)
          .multiplyScalar(r * lump + off)
          .add(centre);
        B.face(p, n, i / ws, j / hs, [
          k / Math.max(1, shells.length - 1),
          kind === 4 ? (k === 0 ? 4 : -1) : k === 0 ? 1 : 2,
          1,
          1,
        ]);
      }
    }
    for (let j = 0; j < hs; j++)
      for (let i = 0; i < ws; i++) {
        const a = base + j * (ws + 1) + i;
        // outward winding (front faces outside: the ball is lit on the side facing the light)
        B.tri(a, a + 1, a + ws + 1);
        B.tri(a + 1, a + ws + 2, a + ws + 1);
      }
  });
}

/** Elastic band round a low ponytail (dark, a little glossy: drawn as a strand with no relief). */
function addBand(B: Builder, body: BodyType, lod: 0 | 1) {
  const d = new THREE.Vector3(0, -0.28, -1).normalize();
  const at = skullPoint(body, d, V()).addScaledVector(skullNormal(body, d, V()), 0.02);
  const S = lod === 0 ? 18 : 8,
    T = lod === 0 ? 6 : 3;
  const R = 0.013,
    r = 0.0032;
  const base = B.count;
  const p = V(),
    n = V();
  for (let i = 0; i <= S; i++) {
    const a = (i / S) * Math.PI * 2;
    for (let j = 0; j <= T; j++) {
      const b = (j / T) * Math.PI * 2;
      n.set(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b));
      p.set(
        at.x + Math.cos(a) * (R + r * Math.cos(b)),
        at.y + r * Math.sin(b) - 0.004,
        at.z + Math.sin(a) * (R + r * Math.cos(b)),
      );
      B.face(p, n, j / T, i / S, [0, 5, 0, 0]);
    }
  }
  for (let i = 0; i < S; i++)
    for (let j = 0; j < T; j++) {
      const a = base + i * (T + 1) + j;
      B.tri(a, a + 1, a + T + 2);
      B.tri(a, a + T + 2, a + T + 1);
    }
}

interface StrandSpec {
  count: number;
  len: [number, number];
  r0: number;
  r1: number;
  stiff: number;
  pattern: number;
  /** strands lie on the head this far before hanging */
}
const STRANDS: Partial<Record<HairStyle, StrandSpec>> = {
  braids: { count: 72, len: [0.3, 0.36], r0: 0.0043, r1: 0.0034, stiff: 0.62, pattern: 0 },
  locs: { count: 50, len: [0.25, 0.31], r0: 0.0064, r1: 0.0056, stiff: 0.58, pattern: 1 },
  // (P2-AVA-15: the campus people's locs are denser and a touch slimmer: STRANDS_V15 below)
  twists: { count: 140, len: [0.045, 0.062], r0: 0.0046, r1: 0.0034, stiff: 0.86, pattern: 2 },
  braidtail: { count: 76, len: [0.36, 0.42], r0: 0.0041, r1: 0.0032, stiff: 0.62, pattern: 0 },
  shortlocs: { count: 78, len: [0.085, 0.115], r0: 0.006, r1: 0.005, stiff: 0.74, pattern: 1 },
};

/** P2-AVA-15 overrides with the realistic campus people on: denser, slimmer locs (no gaps between sticks). */
const STRANDS_V15: Partial<Record<HairStyle, Partial<StrandSpec>>> = {
  locs: { count: 74, r0: 0.0056, r1: 0.005 },
  shortlocs: { count: 92, r0: 0.0054, r1: 0.0046 },
};

/** Fibonacci directions over the upper head whose skull point lies inside the hair region. */
function strandRoots(
  s: HeadSurface,
  body: BodyType,
  count: number,
  hat: HeadwearKind,
  style: HairStyle,
): THREE.Vector3[] {
  const hairV: number[] = [];
  for (let i = 0; i < s.hw.length; i++) if (s.hw[i]! > 0.6) hairV.push(i);
  const roots: THREE.Vector3[] = [];
  const total = Math.round(count * 2.6);
  const ga = Math.PI * (3 - Math.sqrt(5));
  const dir = V(),
    sp = V();
  for (let k = 0; k < total && roots.length < count * 1.6; k++) {
    const y = 1 - (k + 0.5) / total; // upper hemisphere and a little below
    const yy = THREE.MathUtils.lerp(1, -0.45, 1 - y);
    const r = Math.sqrt(Math.max(0, 1 - yy * yy));
    dir.set(Math.sin(ga * k) * r, yy, Math.cos(ga * k) * r);
    skullPoint(body, dir, sp);
    // inside the hair region: a hair vertex within 1.1 cm, and at least 9 mm inside the hairline
    let near = 1;
    for (const i of hairV)
      near = Math.min(
        near,
        (s.F[i * 3]! - sp.x) ** 2 + (s.F[i * 3 + 1]! - sp.y) ** 2 + (s.F[i * 3 + 2]! - sp.z) ** 2,
      );
    if (near > 0.011 ** 2) continue;
    if (
      hat !== "none" &&
      (style === "twists" || style === "shortlocs") &&
      sp.y > bandY(hat, body, skullAzimuth(body, sp.x, sp.z)) - 0.008
    )
      continue;
    roots.push(dir.clone());
  }
  // keep an even subset of `count`
  const step = roots.length / count;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count && Math.floor(i * step) < roots.length; i++)
    out.push(roots[Math.floor(i * step)]!);
  return out;
}

/** Strands (braids / locs / twists): drape over the skull, then hang; tubes with braid / loc / twist relief in the shader. */
function addStrands(
  B: Builder,
  s: HeadSurface,
  style: HairStyle,
  hat: HeadwearKind,
  body: BodyType,
  lod: 0 | 1,
) {
  const baseSpec = STRANDS[style];
  if (!baseSpec) return;
  const spec: StrandSpec = campusHumansOn() ? { ...baseSpec, ...STRANDS_V15[style] } : baseSpec;
  const roots = strandRoots(s, body, spec.count, hat, style);
  // P2-AVA-15: where this head's real scalp lies below the skull template (the feminine crown), strands lying on the
  // upper head came to rest on the template, a centimetre over the scalp: arcs with daylight under them. The offset
  // (m, ≤ 0) of the real hair surface from the template along a direction, from the head's own hair vertices.
  const hairDirs: number[] = [];
  if (campusHumansOn()) {
    const cc = SKULL_FITS[body].c;
    const tp = V(),
      dd = V();
    for (let i = 0; i < s.hw.length; i++) {
      if (s.hw[i]! < 0.6) continue;
      dd.set(s.F[i * 3]! - cc[0], s.F[i * 3 + 1]! - cc[1], s.F[i * 3 + 2]! - cc[2]);
      const r = dd.length();
      dd.divideScalar(r);
      skullPoint(body, dd, tp);
      const tr = Math.hypot(tp.x - cc[0], tp.y - cc[1], tp.z - cc[2]);
      hairDirs.push(dd.x, dd.y, dd.z, r - tr);
    }
  }
  const scalpOffset = (pt: THREE.Vector3): number => {
    if (!hairDirs.length) return 0;
    const cc = SKULL_FITS[body].c;
    const dx = pt.x - cc[0],
      dy = pt.y - cc[1],
      dz = pt.z - cc[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    let best = -1,
      off = 0;
    for (let i = 0; i < hairDirs.length; i += 4) {
      const d = (hairDirs[i]! * dx + hairDirs[i + 1]! * dy + hairDirs[i + 2]! * dz) / l;
      if (d > best) {
        best = d;
        off = hairDirs[i + 3]!;
      }
    }
    return best > 0.985 ? THREE.MathUtils.clamp(off, -0.02, 0) : 0;
  };
  const c = SKULL_FITS[body].c;
  const ears = EAR_LANDMARKS[body];
  const clear = hatClearance(hat, style);
  const lift = hat !== "none" ? Math.max(0.0035, clear - spec.r0 - 0.0015) : 0.0032;
  // P2-AVA-15: round tubes (8 sides up close, 5 further out: a 3-sided far tube read as a flat plank)
  const v15 = campusHumansOn();
  const radial = lod === 0 ? (v15 ? 8 : 6) : v15 ? 5 : 3;
  const profile: "loc" | "braid" | "twist" = spec.pattern === 1 ? "loc" : spec.pattern === 2 ? "twist" : "braid";
  // ponytail gathering point: low on the back of the head (nape)
  const tail = skullPoint(body, new THREE.Vector3(0, -0.28, -1).normalize(), V());
  tail.addScaledVector(skullNormal(body, new THREE.Vector3(0, -0.28, -1).normalize(), V()), 0.012);
  const p = V(),
    d = V(),
    surf = V(),
    nrm = V(),
    g = V(),
    sweep = V(),
    t = V(),
    b = V(),
    q = V(),
    ref = V(),
    nn = V(),
    dir = V();
  roots.forEach((root, ri) => {
    const h = hash3(ri, 7, 3);
    const len = THREE.MathUtils.lerp(spec.len[0], spec.len[1], h);
    const ds = style === "twists" || style === "shortlocs" ? 0.009 : 0.014;
    const segs = Math.max(3, Math.round(len / ds / (lod === 0 ? 1 : 2)));
    const step = len / segs;
    skullPoint(body, root, surf);
    skullNormal(body, root, nrm);
    p.copy(surf).addScaledVector(nrm, v15 && spec.stiff <= 0.85 ? lift * 0.5 + spec.r0 * 0.6 : lift + spec.r0);
    // front roots sweep to the sides and back (braids / locs pulled back off the face)
    const front = smooth(surf.z - c[2], 0.02, 0.08);
    const standing = spec.stiff > 0.85;
    const gather = style === "braidtail";
    const flatTop = campusHumansOn();
    sweep
      .set(Math.sign(surf.x || 1) * 0.6, 0, -1)
      .normalize()
      .multiplyScalar(front * (standing ? 0.15 : 1.1));
    // start along the scalp, downhill (long strands lie on the head before they hang); twists stand out more
    g.set(0, -1, -0.3).add(sweep);
    d.copy(g).addScaledVector(nrm, -g.dot(nrm)).normalize();
    d.multiplyScalar(standing ? 0.6 : 1)
      .addScaledVector(nrm, standing ? 0.6 : 0.12)
      .normalize();
    // low ponytail: every braid first runs over the scalp to the gathering point at the nape
    const pts: THREE.Vector3[] = [p.clone()];
    let gathered = false;
    for (let k = 1; k <= segs; k++) {
      g.set((hash3(ri, k, 1) - 0.5) * 0.12, -1, (hash3(ri, k, 2) - 0.5) * 0.12 - 0.08);
      if (gather && tail.distanceTo(p) > 0.012 && !gathered) {
        g.subVectors(tail, p).normalize();
        d.lerp(g, 0.6).normalize();
      } else {
        if (gather && !gathered) gathered = true;
        // the sideways / back sweep off the face fades along the strand, so long strands fall with gravity instead of
        // standing out from the head like spokes (QA-HUM-01)
        const fall = k / segs;
        d.multiplyScalar(spec.stiff)
          .addScaledVector(g, 1 - spec.stiff)
          .addScaledVector(sweep, gather ? 0 : 0.5 * (1 - fall) * (1 - fall))
          .normalize();
        if (gather) {
          // hang together below the band
          p.x = THREE.MathUtils.lerp(p.x, tail.x + (hash3(ri, 3, 9) - 0.5) * 0.02, 0.35);
          p.z = THREE.MathUtils.lerp(p.z, tail.z - 0.008 + (hash3(ri, 4, 9) - 0.5) * 0.016, 0.35);
        }
      }
      p.addScaledVector(d, step);
      // stay on / outside the hair surface
      const sd = skullStandoff(body, p, surf);
      // P2-AVA-15: over the upper head the strands lie flat on the scalp, a little slimmer (pulled from the parting),
      // so the crown reads as dense locs hugging the head, not sticks arching up off it
      const lie = v15 && !standing ? smooth(p.y, c[1] - 0.03, c[1] + 0.01) : 0;
      const min = lift * (1 - 0.55 * lie) + spec.r0 * (0.9 - 0.3 * lie) + (lie > 0 ? scalpOffset(p) * lie : 0);
      // P2-AVA-12: over the upper head long strands lie on the scalp (braids pulled back hug it): no strand lifts off
      // the crown in a spike before it falls
      if (flatTop && !standing && sd > min && p.y > c[1] - 0.015) {
        q.set(surf.x - c[0], surf.y - c[1], surf.z - c[2]);
        const rr = q.length();
        p.set(c[0], c[1], c[2]).addScaledVector(q, (rr + min) / rr);
      } else if (sd < min) {
        q.set(surf.x - c[0], surf.y - c[1], surf.z - c[2]);
        const rr = q.length();
        p.set(c[0], c[1], c[2]).addScaledVector(q, (rr + min) / rr);
      }
      // nothing hangs over the forehead / face or in front of the ears, nothing goes through the neck
      if (p.y < 0.072 && p.z > ears.earFront - 0.005) {
        p.z = THREE.MathUtils.lerp(p.z, ears.earFront - 0.005, 0.8);
        p.x += Math.sign(p.x || 1) * 0.003;
      }
      if (p.y < ears.earTop + 0.02 && p.z > ears.earBack + 0.01 && Math.abs(p.x) < ears.earX + 0.03) {
        p.z = THREE.MathUtils.lerp(p.z, ears.earBack + 0.01, 0.7);
        p.x += Math.sign(p.x || 1) * 0.004;
      }
      if (p.y < c[1] - 0.09) {
        const nz = c[2] + 0.01;
        const rr = Math.hypot(p.x, p.z - nz);
        const minR = 0.068 + spec.r0;
        if (rr < minR) {
          const k2 = minR / Math.max(rr, 1e-4);
          p.x *= k2;
          p.z = nz + (p.z - nz) * k2;
        }
      }
      // ... and they rest on the shoulders / upper back instead of going through them (an ellipse of the upper torso)
      if (p.y < c[1] - 0.2) {
        const nz = c[2] - 0.01;
        const ex = p.x / 0.17,
          ez = (p.z - nz) / 0.11;
        const e = Math.hypot(ex, ez);
        if (e < 1) {
          const k2 = 1 / Math.max(e, 1e-3);
          p.x *= k2;
          p.z = nz + (p.z - nz) * k2;
        }
      }
      pts.push(p.clone());
    }
    // under headwear (P2-AVA-12): the strands inside the crown are pressed flat against the scalp (thinner, inside the
    // hat's clearance), so no braid / loc ever pokes through the cap, the bucket hat or the kufi; they come out below
    // the band at full thickness (a 2 cm blend below it)
    // how much each point lies on the upper head (thinner there, P2-AVA-15)
    const lying: number[] = pts.map((pt) => (v15 && !standing ? smooth(pt.y, c[1] - 0.03, c[1] + 0.01) : 0));
    const press: number[] = pts.map(() => 0);
    if (hat !== "none" && campusHumansOn()) {
      pts.forEach((pt, k) => {
        const by = bandY(hat, body, skullAzimuth(body, pt.x, pt.z));
        const tp = smooth(pt.y, by - 0.024, by - 0.004);
        if (tp <= 0) return;
        press[k] = tp;
        const u = k / (pts.length - 1);
        const rr0 = THREE.MathUtils.lerp(spec.r0, spec.r1, u) * 0.5;
        const sd = skullStandoff(body, pt, surf);
        const maxSd = clear - rr0 - 0.001;
        const want = THREE.MathUtils.lerp(sd, Math.min(sd, maxSd), tp);
        if (want < sd) {
          q.set(surf.x - c[0], surf.y - c[1], surf.z - c[2]);
          const rr = q.length();
          pt.set(c[0], c[1], c[2]).addScaledVector(q, (rr + want) / rr);
        }
      });
    }
    // tube along the points (parallel-transported frame)
    let along = 0;
    ref.set(0, 0, 1);
    const base = B.count;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)]!,
        bb = pts[Math.min(pts.length - 1, k + 1)]!;
      t.subVectors(bb, a).normalize();
      if (k > 0) along += pts[k]!.distanceTo(pts[k - 1]!);
      b.crossVectors(t, ref);
      if (b.lengthSq() < 1e-6) b.crossVectors(t, ref.set(1, 0, 0));
      b.normalize();
      nn.crossVectors(b, t).normalize();
      ref.copy(nn);
      const u = k / (pts.length - 1);
      const r = v15
        ? // P2-AVA-15: felted, slightly irregular, tapered ropes (head-fit.ts strandRadius), pressed thinner under a hat
          THREE.MathUtils.lerp(spec.r0, spec.r1, u) * strandRadius(u, h, profile) * (1 - 0.28 * lying[k]!) * (1 - 0.55 * press[k]!) * (k === 0 ? 0.35 : 1)
        : THREE.MathUtils.lerp(spec.r0, spec.r1, u) * (style === "braids" && k === pts.length - 1 ? 0.6 : 1) * (1 - 0.5 * press[k]!) * (k === 0 && flatTop ? 0.35 : 1); // (a tapered root: no open tube end at the scalp)
      // a loc is not a perfect cylinder: a little oval, its long axis turning slowly along the strand
      const oval = v15 && profile === "loc" ? 0.12 : 0;
      const twistA = h * 6.283 + along * 9;
      // sway weight in the 3rd hk slot's fraction (the vertex shader swings the free length; 0 at the root and under a hat)
      const sw = v15 && profile !== "twist" ? swayWeight(u) * (1 - press[k]!) : 0;
      for (let j = 0; j <= radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        dir.copy(nn).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
        const ro = r * (1 + oval * Math.cos(2 * (ang - twistA)));
        q.copy(pts[k]!).addScaledVector(dir, ro);
        B.face(q, dir, j / radial, along, [u, 3, spec.pattern + Math.min(0.49, sw * 0.49), h]);
      }
    }
    for (let k = 0; k < pts.length - 1; k++)
      for (let j = 0; j < radial; j++) {
        const a = base + k * (radial + 1) + j;
        // outward winding: inside-out tubes showed their far, back-lit halves (pale braids in sunlight)
        B.tri(a, a + 1, a + radial + 1);
        B.tri(a + 1, a + radial + 2, a + radial + 1);
      }
    // cap the tip (P2-AVA-15: a rounded end, two rings of a half dome, not a flat cut)
    const tip = pts[pts.length - 1]!;
    const swTip = v15 && profile !== "twist" ? 0.49 : 0;
    let last = base + (pts.length - 1) * (radial + 1);
    if (v15) {
      const rt = spec.r1 * strandRadius(1, h, profile);
      for (const [ring, a] of [
        [1, 0.5],
        [2, 0.85],
      ] as const) {
        const rb = B.count;
        for (let j = 0; j <= radial; j++) {
          const ang = (j / radial) * Math.PI * 2;
          dir.copy(nn).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
          q.copy(tip)
            .addScaledVector(dir, rt * Math.cos(a * Math.PI * 0.5))
            .addScaledVector(t, rt * Math.sin(a * Math.PI * 0.5));
          nn.copy(dir).multiplyScalar(Math.cos(a * Math.PI * 0.5)).addScaledVector(t, Math.sin(a * Math.PI * 0.5));
          B.face(q, nn.clone(), j / radial, along + rt * ring * 0.5, [1, 3, spec.pattern + swTip, h]);
          nn.crossVectors(b, t).normalize();
        }
        for (let j = 0; j < radial; j++) {
          B.tri(last + j, last + j + 1, rb + j);
          B.tri(last + j + 1, rb + j + 1, rb + j);
        }
        last = rb;
      }
    }
    const ti = B.face(tip.clone().addScaledVector(t, (v15 ? spec.r1 * strandRadius(1, h, profile) : spec.r1 * 0.7)), t, 0.5, along + spec.r1, [
      1,
      3,
      spec.pattern + swTip,
      h,
    ]);
    for (let j = 0; j < radial; j++) B.tri(last + j, last + j + 1, ti);
  });
}

/* ---------------- public: per-person hair ---------------- */

export interface HairGeometry {
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  /** shader params: pattern id, fade */
  pattern: number;
  fade: boolean;
}

/** Headwear class that changes the hair: any hat presses the close hair down; `none` keeps it. */
export function hairHatClass(hat: HeadwearKind | undefined, style: HairStyle): HeadwearKind {
  if (!hat || hat === "none" || style === "headwrap") return "none";
  return hat;
}

const hairCache = new WeakMap<THREE.BufferGeometry, Map<string, HairGeometry | null>>();

/**
 * Hair geometry for a style on a base head (`lo` = the original head, `hi` = its tessellated version; both already
 * deflated / cleaned for this style). Cached per (base head, style, headwear class).
 */
export function hairGeometry(
  lo: THREE.BufferGeometry,
  hi: THREE.BufferGeometry,
  frame: HeadFrame,
  mask: MaskPixels,
  body: BodyType,
  style: HairStyle,
  hat: HeadwearKind,
): HairGeometry | null {
  const spec = SHELL[style];
  if (!spec) return null;
  let per = hairCache.get(lo);
  if (!per) hairCache.set(lo, (per = new Map()));
  const key = `${body}|${style}|${hat}`;
  if (per.has(key)) return per.get(key)!;
  const build = (geo: THREE.BufferGeometry, lod: 0 | 1) => {
    const B = new Builder(frame, body);
    const s = hairSurface(geo, frame, mask, body);
    addShells(B, geo, s, frame, style, hat, body, lod === 0 ? spec.layers : 1);
    const bare = hat === "none";
    if (bare && (style === "afro" || style === "hightop")) addVolume(B, style, body, lod);
    if (bare && style === "puffs") {
      const sc = SKULL_FITS[body].s[0];
      for (const side of [-1, 1])
        addBall(
          B,
          body,
          new THREE.Vector3(side * 0.62, 0.7, -0.32),
          0.056 * sc,
          new THREE.Vector3(1, 0.92, 1),
          side * 3.1,
          lod,
        );
    }
    if (bare && style === "bun")
      addBall(
        B,
        body,
        new THREE.Vector3(0, 0.62, -0.78),
        0.047 * SKULL_FITS[body].s[0],
        new THREE.Vector3(1, 0.82, 0.92),
        5.3,
        lod,
      );
    // straight-back cornrows gathered into a low bun at the nape (stays under most hats: it sits below the band)
    if (style === "cornrowbun")
      addBall(
        B,
        body,
        new THREE.Vector3(0, -0.12, -1),
        0.043 * SKULL_FITS[body].s[0],
        new THREE.Vector3(1, 0.8, 0.85),
        2.2,
        lod,
        4,
      );
    if (style === "braidtail") addBand(B, body, lod);
    addStrands(B, s, style, hat, body, lod);
    return B.build();
  };
  const out: HairGeometry = { near: build(hi, 0), far: build(lo, 1), pattern: spec.pattern, fade: spec.fade };
  per.set(key, out);
  return out;
}

/* ---------------- hair material ---------------- */

export interface HairUniforms {
  uHMask: { value: THREE.Texture | null };
  uHair: { value: THREE.Color };
  uHSkin: { value: THREE.Color };
  uHStyle: { value: THREE.Vector4 };
  uHO: { value: THREE.Vector3 };
  uHR: { value: THREE.Matrix3 };
  /** seconds, shared by every hair material (strand sway, P2-AVA-15) */
  uHTime: { value: number };
}

/** One clock for every person's hair sway (P2-AVA-15), advanced when a hair mesh is drawn (no per-person updates). */
export const HAIR_TIME = { value: 0 };

const HAIR_VERT_HEAD = /* glsl */ `
attribute vec4 hk;
attribute vec2 huv;
uniform vec3 uHO; uniform mat3 uHR; uniform float uHTime;
varying vec4 vHk; varying vec3 vHF; varying vec2 vHUv;
`;
const HAIR_VERT = /* glsl */ `
#include <begin_vertex>
vHk = hk; vHUv = huv; vHF = uHR * (position - uHO);
#ifdef GK_HAIR_SWAY
// P2-AVA-15: hanging locs / braids sway a little (secondary motion): the free length swings with the strand's own
// phase over a slow shared breeze, weight 0 at the root (fract(hk.z), built in hair.ts addStrands)
if (hk.y > 2.5 && hk.y < 3.5) {
  float sw = fract(hk.z) * 2.04;
  if (sw > 0.001) {
    float ph = hk.w * 6.2831;
    float br = sin(uHTime * 0.7) * 0.5 + 0.5;
    vec3 off = vec3(sin(uHTime * 1.3 + ph) * 0.6 + sin(uHTime * 2.3 + ph * 1.7) * 0.25,
                    0.0,
                    sin(uHTime * 1.05 + ph * 0.8) * 0.45 - 0.25 * br) * (0.0065 * sw);
    transformed += transpose(uHR) * off;
  }
}
#endif
`;

const HAIR_FRAG_HEAD = /* glsl */ `
uniform sampler2D uHMask; uniform vec3 uHair; uniform vec3 uHSkin; uniform vec4 uHStyle;
varying vec4 vHk; varying vec3 vHF; varying vec2 vHUv;
float hH = 0.0; float hRough = 0.8; float hBumpK = 1.0; float hSpecK = 0.4; float hRimK = 0.0;
float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hHash(i), hHash(i + vec3(1,0,0)), f.x), mix(hHash(i + vec3(0,1,0)), hHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hHash(i + vec3(0,0,1)), hHash(i + vec3(1,0,1)), f.x), mix(hHash(i + vec3(0,1,1)), hHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// coil cluster: a ring round a jittered point per cell (tight curls read as little rings / spirals)
float hCoil(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p) - 0.5;
  vec3 o = vec3(hHash(i + 1.7), hHash(i + 9.2), hHash(i + 4.4)) - 0.5;
  float d = length(f - o * 0.5);
  float ring = 1.0 - smoothstep(0.06, 0.16, abs(d - 0.24 - 0.08 * hHash(i + 2.3)));
  return clamp(ring * 0.7 + (1.0 - smoothstep(0.0, 0.42, d)) * 0.5, 0.0, 1.0);
}
float hRidge(float x) { return 1.0 - abs(fract(x) - 0.5) * 2.0; }
`;

const HAIR_FRAG = /* glsl */ `
#include <map_fragment>
{
  float kind = vHk.y;
  float lf = vHk.x;
  vec3 F = vHF;
  // screen footprint (m per pixel): detail octaves fade to their mean below a pixel (no shimmer at a distance)
  float fw = max(length(dFdx(F)), length(dFdy(F))) + 1e-6;
  float nearK = clamp(1.6 - fw / 0.0011, 0.0, 1.0);
  float c1 = hCoil(F * 560.0);
  float c2 = hNoise(F * 1400.0);
  float clump = hNoise(F * 140.0);
  float detail = mix(0.5, c1 * 0.65 + c2 * 0.35, nearK);
#ifdef GK_HAIR_V15
  // P2-AVA-15: each octave fades to its mean once its cells shrink towards a pixel (the 1400 / m octave sparkled as
  // grey speckle up close: noisy, pixelated hair at the hairline and under a cap)
  float k1 = clamp(1.5 - fw * 560.0 * 2.2, 0.0, 1.0);
  float k2 = clamp(1.5 - fw * 1400.0 * 2.6, 0.0, 1.0);
  detail = mix(0.5, c1, k1) * 0.65 + mix(0.5, c2, k2) * 0.35;
#endif
  float alpha = 1.0;
  float ao = 1.0;
  vec3 col = max(uHair, vec3(0.013, 0.0105, 0.0088));
  // scalp in partings: the skin in the shade of the hair (darker, less saturated: never orange lines)
  vec3 scalp = mix(uHSkin, vec3(dot(uHSkin, vec3(0.2126, 0.7152, 0.0722))), 0.35) * 0.46 + col * 0.12;
  // grey / salt-and-pepper: individual strands turn silver (never a flat grey tint)
  // (ageing: more silver at the temples and sides above the ears and at the nape, the crown greys last)
  float gTemple = smoothstep(0.042, 0.068, abs(F.x)) * (1.0 - smoothstep(0.02, 0.075, F.y)) + smoothstep(0.07, 0.11, -F.z) * (1.0 - smoothstep(-0.02, 0.03, F.y)) * 0.6;
  float gAmt = max(uHStyle.y, min(1.0, uHStyle.y + uHStyle.w * clamp(gTemple, 0.0, 1.0)));
  if (gAmt > 0.001) {
    float sel = step(hHash(floor(F * 700.0) + 3.7), gAmt);
    col = mix(col, vec3(0.28, 0.275, 0.27) * (0.75 + 0.5 * hHash(floor(F * 700.0) + 1.1)), sel * mix(0.5, 1.0, nearK));
  }
  float pat = uHStyle.x;
  if (kind < 0.5) {
    // ---- close-hair shell: hairline from the mask, strands thin out layer by layer
    float m = texture2D(uHMask, vHUv).g;
#ifdef GK_HAIR_V15
    // P2-AVA-15: the hairline from a 4-tap filtered mask, broken by a soft 3–5 mm noise (no texel stair-steps, no
    // hard painted edge), so it blends into the skin
    {
      vec2 tx = 0.85 / vec2(textureSize(uHMask, 0));
      m = (texture2D(uHMask, vHUv + vec2(tx.x, tx.y)).g + texture2D(uHMask, vHUv + vec2(-tx.x, tx.y)).g
         + texture2D(uHMask, vHUv + vec2(tx.x, -tx.y)).g + texture2D(uHMask, vHUv + vec2(-tx.x, -tx.y)).g) * 0.25;
      m = clamp(m + (hNoise(F * 260.0) - 0.5) * 0.22 * m * (1.0 - m) * 4.0, 0.0, 1.0);
    }
#endif
    float L = vHk.z;
    float edge = smoothstep(0.04, 0.5, m);
    float dens = edge * mix(1.0, 0.42, lf) * smoothstep(0.0006, 0.0045, L);
    float scalpShow = 0.0;
    // cornrows: rows from the forehead to the nape, skin partings between, a braided chevron along each row
    if (abs(pat - 1.0) < 0.5) {
      float a = atan(F.x, F.y + 0.02) * 4.2;
      float f = fract(a);
      float rowP = 1.0 - pow(abs(f - 0.5) * 2.0, 2.2);
      float part = 1.0 - smoothstep(0.035, 0.09, min(f, 1.0 - f));
      float chev = hRidge(F.z * 150.0 + abs(f - 0.5) * 3.0);
      dens *= smoothstep(lf - 0.15, lf + 0.05, rowP);
      scalpShow = part;
      hH += rowP * 1.2 + chev * 0.5 * rowP;
      detail = mix(detail, chev, 0.55 * nearK);
    }
    // 360 waves: ripples circling the crown
    if (abs(pat - 2.0) < 0.5) {
      vec2 cw = vec2(0.0, -0.085);
      float r = length(vec2(F.x, F.z) - cw) + max(0.0, 0.1 - F.y) * 0.6;
      float sp = atan(F.x, F.z - cw.y) * 0.004;
      float w = hRidge((r + sp) / 0.0085);
      dens *= mix(0.55, 1.0, w);
      hH += w * 1.4;
      ao *= mix(0.72, 1.08, w);
    }
    // centre parting (puffs)
    if (abs(pat - 3.0) < 0.5) {
      float part = 1.0 - smoothstep(0.0012, 0.003, abs(F.x));
      scalpShow = part * step(-0.11, F.z);
    }
    // box partings under braids / locs / twists
    if (abs(pat - 5.0) < 0.5) {
      float az = atan(F.x, F.z + 0.075);
      float el = F.y;
      vec2 g = vec2(az * 4.5, el / 0.024 + floor(az * 4.5) * 0.5);
      vec2 fg = abs(fract(g) - 0.5);
      scalpShow = smoothstep(0.455, 0.495, max(fg.x, fg.y)) * 0.8;
    }
    if (lf < 0.02) {
      // base layer: covers the scalp inside the hairline (dark roots / skin in partings, a fade's shaved skin)
      alpha = smoothstep(0.03, 0.42, m);
#ifdef GK_HAIR_V15
      // a wider, softer edge: the hairline thins out over a few millimetres into the skin
      alpha = smoothstep(0.02, 0.6, m);
      col = mix(scalp * 1.15, col, smoothstep(0.1, 0.55, m));
#endif
      float shaved = 1.0 - smoothstep(0.0005, 0.0062, L);
      col = mix(col, scalp, clamp(scalpShow * 0.9, 0.0, 1.0));
      // a skin fade shows the head's own (shaved, skin-shaded) scalp through: same skin as the face
      alpha *= 1.0 - smoothstep(0.15, 0.95, shaved);
      ao *= mix(0.55, 1.0, shaved);
    } else {
      float sharp = mix(1.0, 7.0, nearK);
#ifdef GK_HAIR_V15
      sharp = mix(1.0, 4.0, nearK);
#endif
      alpha = clamp((detail - (1.0 - dens)) * sharp + 0.5, 0.0, 1.0) * step(0.02, dens) * (1.0 - scalpShow);
      ao *= mix(0.5, 1.0, pow(lf, 0.8));
    }
    hH += detail * 1.6;
  } else if (kind < 2.5) {
    // ---- volume (afro / high-top / puffs / bun): coily surface; fuzz shells (kind 2) break up the silhouette
    float taper = vHk.z;
    float big = hNoise(F * 70.0);
    if (kind > 1.5) {
      float dens = mix(0.55, 0.28, lf) * smoothstep(0.1, 0.6, taper);
      alpha = clamp((detail * 0.8 + big * 0.35 - (1.0 - dens)) * mix(1.5, 6.0, nearK) + 0.4, 0.0, 1.0);
      ao *= mix(0.8, 1.05, lf);
    } else {
      ao *= mix(0.62, 1.0, detail) * mix(0.85, 1.05, big);
    }
    hH += detail * 2.2 + big * 1.2;
  } else {
    // ---- strands: box braid plait / loc felting / two-strand twist
    float s = vHUv.x; float t = vHUv.y;
    float h;
    if (vHk.z < 0.5) h = max(hRidge(t * 95.0 + s * 2.0), hRidge(t * 95.0 - s * 2.0 + 0.5));
    else if (vHk.z < 1.5) h = hNoise(F * 420.0) * 0.6 + hCoil(F * 700.0) * 0.4;
    else h = hRidge(t * 60.0 + s * 2.0);
#ifdef GK_HAIR_V15
    if (vHk.z >= 0.5 && vHk.z < 1.5) {
      // locs (P2-AVA-15): a felted rope: strand bundles spiralling round it, matted fuzz along them, soft lumps, all
      // in the strand's own (around, along) frame so the texture wraps the tube instead of swimming in world space
      float sk = clamp(1.5 - fw * 160.0 * 2.0, 0.0, 1.0);
      float spiral = hRidge(s * 4.0 + t * 38.0 + vHk.w * 3.0);
      float fuzz = hNoise(vec3(s * 14.0, t * 240.0, vHk.w * 20.0));
      float mat = hNoise(vec3(s * 4.0, t * 60.0, vHk.w * 9.0));
      h = mix(0.5, spiral * 0.45 + fuzz * 0.35 + mat * 0.2, sk);
      // per-loc tone, a little sun-faded towards the tips (never one flat black)
      col = max(col, vec3(0.024, 0.019, 0.016)) * (0.8 + 0.45 * vHk.w) * mix(1.0, 1.9, smoothstep(0.55, 1.0, lf) * 0.5);
      hRimK = 1.0;
    } else if (vHk.z < 0.5) {
      hRimK = 0.8;
    }
    hSpecK = 0.7;
#endif
    h = mix(0.5, h, nearK * 0.85 + 0.15);
    ao *= mix(0.55, 1.05, h) * mix(0.8, 1.0, lf);
    hH += h * 2.4 + detail * 0.6;
  }
  // receding temples (an option for close styles, e.g. older men): the front corners of the hairline move back
  if (uHStyle.z > 0.001 && kind < 0.5) {
    float corner = smoothstep(0.012, 0.045, abs(F.x)) * smoothstep(-0.055, -0.01, F.z) * step(0.045, F.y);
    float lineY = 0.072 + uHStyle.z * 0.032;
    alpha *= 1.0 - corner * (1.0 - smoothstep(lineY - 0.003, lineY + 0.004, F.y));
  }
  if (kind > 3.5 && kind < 4.5) {
    // braided bun: coiled plait rows round the bun
    float h2 = hRidge(vHUv.y * 9.0 + abs(fract(vHUv.x * 14.0) - 0.5) * 1.2);
    col = max(uHair, vec3(0.013, 0.0105, 0.0088)) * mix(0.5, 1.05, h2) * (0.86 + 0.28 * clump);
    hH += h2 * 2.0;
    alpha = 1.0;
    ao = 1.0;
  }
  if (kind > 4.5) {
    col = vec3(0.012, 0.011, 0.012);
    alpha = 1.0;
    ao = 1.0;
  }
  if (kind < -0.5) alpha = 0.0;
  if (alpha < 0.02) discard;
  // per-clump tone variation, never flat; textured hair is matte with a soft satin lift (no plastic sheen)
  col *= ao * (0.86 + 0.28 * clump) * (0.9 + 0.2 * detail);
  hRough = 0.8 + 0.14 * (1.0 - detail);
  hBumpK = nearK * (kind > 2.5 ? 0.5 : 1.0);
#ifdef GK_HAIR_V15
  // strands: a soft satin highlight runs along each rope (reads round), still no plastic glare
  if (kind > 2.5 && kind < 3.5) hRough = 0.62 + 0.12 * (1.0 - detail);
#endif
  diffuseColor.rgb = col;
  diffuseColor.a *= alpha;
}
`;

const HAIR_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = hRough;
`;
const HAIR_BUMP = /* glsl */ `
vec3 hN0 = normal;
#include <normal_fragment_maps>
{
  vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  // relief only where it is resolved: on thin, distant strands the derivatives explode and flipped normals caught
  // the sky at grazing angles (braids turned pale / blond in the plaza)
  vec2 dh = vec2(dFdx(hH), dFdy(hH)) * 0.0011 * hBumpK;
  vec3 gk = sign(det) * (dh.x * r1 + dh.y * r2);
  float gl = length(gk); float lim = abs(det) * 0.6;
  if (gl > lim) gk *= lim / gl;
  normal = normalize(abs(det) * normal - gk);
#ifdef GK_HAIR_V15
  // round tubes (P2-AVA-15): the silhouette edges of a loc / braid sit in the shade of its own curvature and the
  // neighbouring strands, so each rope reads as a cylinder, not a flat card
  if (hRimK > 0.0) {
    float facing = abs(dot(normalize(hN0), normalize(vViewPosition)));
    diffuseColor.rgb *= mix(1.0, mix(0.42, 1.0, pow(facing, 0.6)), hRimK);
  }
#endif
}
`;
/** hair F0 ≈ 0.022 instead of 0.04: matte, no plastic glare */
const HAIR_SPEC = /* glsl */ `
#include <lights_physical_fragment>
material.specularColor *= hSpecK;
material.specularColorBlended *= hSpecK;
`;

/**
 * How grey a hair colour is (0 = none … 1 = white): light, unsaturated colours. Grey hair is drawn as a mix of dark and
 * silver strands (salt-and-pepper) rather than a flat tint.
 */
export function greyAmount(hex: string): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.s > 0.18) return 0;
  return THREE.MathUtils.clamp((hsl.l - 0.3) / 0.5, 0, 1);
}

/** Base (pepper) colour under grey strands. */
const PEPPER = "#1c1815";

export function makeHairMaterial(
  hairColor: string,
  skinTone: string,
  mask: THREE.Texture | null,
  frame: HeadFrame,
  g: HairGeometry,
  recede = 0,
  age: { temple: number; scalp: number } = { temple: 0, scalp: 0 },
): THREE.MeshStandardMaterial {
  const colourGrey = greyAmount(hairColor);
  // ageing (P2-AVA-11) adds silver strands over any colour: all over (scalp) and more at the temples / sides (.w)
  const grey = Math.max(colourGrey, age.scalp);
  // low environment reflection: bright skies otherwise wash dark textured hair out to grey / blond at grazing angles
  const m = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.22,
  });
  m.name = "gk-hair";
  const u: HairUniforms = {
    uHMask: { value: mask },
    uHair: { value: new THREE.Color(colourGrey > 0 ? PEPPER : hairColor) },
    uHSkin: { value: new THREE.Color(skinTone) },
    uHStyle: { value: new THREE.Vector4(g.pattern, grey, recede, age.temple) },
    uHO: { value: frame.o.clone() },
    uHR: { value: frame.R.clone() },
    uHTime: HAIR_TIME,
  };
  m.userData.gkHair = u;
  const v15 = campusHumansOn();
  if (v15) m.defines = { ...(m.defines ?? {}), GK_HAIR_V15: "", GK_HAIR_SWAY: "" };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = HAIR_VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", HAIR_VERT);
    shader.fragmentShader =
      HAIR_FRAG_HEAD +
      shader.fragmentShader
        .replace("#include <map_fragment>", HAIR_FRAG)
        .replace("#include <roughnessmap_fragment>", HAIR_ROUGH)
        .replace("#include <normal_fragment_maps>", HAIR_BUMP)
        .replace("#include <lights_physical_fragment>", HAIR_SPEC)
        .replace(
          "#include <lights_fragment_end>",
          "#include <lights_fragment_end>\n reflectedLight.indirectSpecular *= 0.08; reflectedLight.directSpecular *= 0.6;",
        );
  };
  m.customProgramCacheKey = () => (v15 ? "gk-hair-5" : "gk-hair-4");
  return m;
}

/** Skinned mesh for a person's hair: shares the head's skeleton and bind matrix. */
export function hairMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  head: THREE.SkinnedMesh,
): THREE.SkinnedMesh {
  const m = new THREE.SkinnedMesh(geo, mat);
  m.name = "gk-hair";
  m.position.copy(head.position);
  m.quaternion.copy(head.quaternion);
  m.scale.copy(head.scale);
  m.bind(head.skeleton, head.bindMatrix);
  m.frustumCulled = false;
  // (the eyes reuse this helper with their own material: the clock tick is harmless there)
  m.onBeforeRender = tickHairTime;
  return m;
}

function tickHairTime() {
  HAIR_TIME.value = (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
}
