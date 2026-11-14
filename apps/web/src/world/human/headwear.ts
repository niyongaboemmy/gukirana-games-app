import * as THREE from "three";
import type { BodyType, HairStyle, HeadwearKind } from "../outfits";
import { fabricTexture, type PrintId } from "../textures";
import { skullNormal, skullPoint, SKULL_FITS } from "./skull";
import { bandY, HAT_CLEARANCE } from "./head-fit";
import type { HeadFrame } from "./hair";

/**
 * Headwear as real, fitted models (P2-AVA-10). The old hats were a half sphere + a flat half disc floating at a
 * fixed size; now every hat is built on the wearer's own skull (skull.ts fit, face frame) for the hairstyle under it:
 *
 *  - the band follows a real hat line: just above the brows at the front, over the ears (ears stay outside), low on
 *    the back of the head (head-fit.ts BAND);
 *  - the crown hugs the skull at the hairstyle's clearance (compressed hair under it, nothing poking through, no gap
 *    at the forehead or temples), with fabric thickness at the rim;
 *  - cap: six panels with seams, top-stitching and eyelets, a top button, a pre-curved brim with thickness, pitched a
 *    little down; beanie: rib-knit cuff folded up, stockinette crown with a soft slouch; bucket hat: flat-topped crown,
 *    stitched sloping brim all round; kufi: close round cap with an embroidered imigongo band; headwrap: printed
 *    fabric with folds, volume at the back of the crown and a twisted knot at the front.
 * Rigid on the head bone, one skinned mesh + one material per hat (one draw call).
 */

const V = () => new THREE.Vector3();
const smooth = THREE.MathUtils.smoothstep;

/** part ids in the `hwp` attribute (x) */
const PART = {
  crown: 0,
  brimTop: 1,
  brimBottom: 2,
  brimEdge: 3,
  button: 4,
  rim: 5,
  cuff: 6,
  knot: 7,
} as const;

class HatBuilder {
  P: number[] = [];
  N: number[] = [];
  A: number[] = [];
  I: number[] = [];
  get count() {
    return this.P.length / 3;
  }
  v(p: THREE.Vector3, n: THREE.Vector3, part: number, u: number, w: number) {
    this.P.push(p.x, p.y, p.z);
    this.N.push(n.x, n.y, n.z);
    this.A.push(part, u, w);
    return this.count - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.I.push(a, b, c, a, c, d);
  }
  /** grid of (cols+1)×(rows+1) vertices already pushed starting at `base` */
  grid(base: number, cols: number, rows: number, flip = false) {
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = base + j * (cols + 1) + i;
        if (flip) this.quad(a, a + 1, a + cols + 2, a + cols + 1);
        else this.quad(a, a + cols + 1, a + cols + 2, a + 1);
      }
  }
}

/** Template direction at azimuth `az` (around the skull centre) and elevation `el` (rad). */
export function dirAt(body: BodyType, az: number, el: number, out: THREE.Vector3) {
  const s = SKULL_FITS[body].s;
  // azimuth is measured in the face frame; the template is scaled per axis
  return out
    .set((Math.sin(az) * Math.cos(el)) / s[0], Math.sin(el) / s[1], (Math.cos(az) * Math.cos(el)) / s[2])
    .normalize();
}

/** Elevation (rad) where the skull reaches face-frame height `y` at azimuth `az` (bisection). */
export function elevationAt(body: BodyType, az: number, y: number): number {
  let lo = -0.9,
    hi = 1.45;
  const d = V(),
    p = V();
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    skullPoint(body, dirAt(body, az, mid, d), p);
    if (p.y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface CrownOpts {
  kind: Exclude<HeadwearKind, "none">;
  body: BodyType;
  clearance: number;
  cols: number;
  rows: number;
  /** extra offset (m) along the skull normal at (az, v), v = 0 at the band, 1 at the top */
  extra?: (az: number, v: number) => number;
  /** clamp the crown top to a flat plane this far above the band's front (bucket hat) */
  flatTop?: number;
  rimDepth?: number;
}

/** Crown surface from the band up to the top; returns rim positions / normals per column for brims and cuffs. */
function crown(B: HatBuilder, o: CrownOpts) {
  const { body, kind, cols, rows } = o;
  const d = V(),
    p = V(),
    n = V();
  const rimP: THREE.Vector3[] = [];
  const rimN: THREE.Vector3[] = [];
  const pts: THREE.Vector3[][] = [];
  let topY = -1;
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (i / cols) * Math.PI * 2;
    const elB = elevationAt(body, az, bandY(kind, body, az));
    const col: THREE.Vector3[] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const el = THREE.MathUtils.lerp(elB, Math.PI / 2 - 0.001, Math.pow(v, 0.92));
      dirAt(body, az, el, d);
      skullPoint(body, d, p);
      skullNormal(body, d, n);
      const off = o.clearance + 0.0016 + (o.extra?.(az, v) ?? 0);
      p.addScaledVector(n, off);
      col.push(p.clone());
      topY = Math.max(topY, p.y);
    }
    pts.push(col);
  }
  if (o.flatTop !== undefined) {
    const fy = bandY(kind, body, 0) + o.flatTop;
    for (const col of pts) for (const q of col) if (q.y > fy) q.y = fy + (q.y - fy) * 0.08;
  }
  // normals from the grid
  const base = B.count;
  const t1 = V(),
    t2 = V();
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const a = pts[Math.min(cols, i + 1)]![j]!,
        b = pts[Math.max(0, i - 1)]![j]!;
      const c = pts[i]![Math.min(rows, j + 1)]!,
        e = pts[i]![Math.max(0, j - 1)]!;
      t1.subVectors(a, b);
      t2.subVectors(c, e);
      n.crossVectors(t1, t2).normalize();
      if (j === rows) n.set(0, 1, 0);
      B.v(pts[i]![j]!, n, PART.crown, i / cols, j / rows);
      if (j === 0) {
        rimP.push(pts[i]![j]!.clone());
        rimN.push(n.clone());
      }
    }
  }
  // the grid is column-major: (rows+1) per column
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = base + i * (rows + 1) + j;
      B.quad(a, a + rows + 1, a + rows + 2, a + 1);
    }
  // folded rim: the fabric turns inwards (thickness, a sweatband line from below)
  const depth = o.rimDepth ?? 0.004;
  const rb = B.count;
  for (let i = 0; i <= cols; i++) {
    const q = rimP[i]!,
      nn = rimN[i]!;
    B.v(q, n.set(0, -1, 0), PART.rim, i / cols, 0);
    B.v(
      p
        .copy(q)
        .addScaledVector(nn, -depth)
        .add(t1.set(0, 0.002, 0)),
      n.set(0, -1, 0),
      PART.rim,
      i / cols,
      1,
    );
  }
  for (let i = 0; i < cols; i++) {
    const a = rb + i * 2;
    B.quad(a, a + 1, a + 3, a + 2);
  }
  return { rimP, rimN, topY };
}

/** A sloped brim (cap: front only, pre-curved; bucket: all round). */
function brim(
  B: HatBuilder,
  rimP: THREE.Vector3[],
  rimN: THREE.Vector3[],
  cols: number,
  o: {
    from: number;
    to: number;
    depth: (az: number) => number;
    pitch: number;
    curve: number;
    thick: number;
    rows: number;
    body: BodyType;
  },
) {
  const c = SKULL_FITS[o.body].c;
  const top: THREE.Vector3[][] = [];
  const outDir = V(),
    p = V(),
    n = V();
  const sel: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (i / cols) * Math.PI * 2;
    if (az >= o.from - 1e-6 && az <= o.to + 1e-6) sel.push(i);
  }
  for (const i of sel) {
    const az = -Math.PI + (i / cols) * Math.PI * 2;
    const r = rimP[i]!;
    outDir.set(r.x - c[0], 0, r.z - c[2]).normalize();
    const e = o.depth(az);
    const row: THREE.Vector3[] = [];
    for (let k = 0; k <= o.rows; k++) {
      const t = k / o.rows;
      p.copy(r)
        .addScaledVector(rimN[i]!, 0.0008)
        .addScaledVector(outDir, e * t);
      p.y -= e * t * Math.tan(o.pitch) + o.curve * Math.pow(Math.sin(az), 2) * t * t + o.curve * 0.35 * t * t;
      row.push(p.clone());
    }
    top.push(row);
  }
  const m = top.length - 1;
  const R = o.rows;
  const t1 = V(),
    t2 = V();
  const normalAt = (i: number, k: number) => {
    t1.subVectors(top[Math.min(m, i + 1)]![k]!, top[Math.max(0, i - 1)]![k]!);
    t2.subVectors(top[i]![Math.min(R, k + 1)]!, top[i]![Math.max(0, k - 1)]!);
    return n.crossVectors(t2, t1).normalize();
  };
  // top surface
  const bt = B.count;
  for (let i = 0; i <= m; i++)
    for (let k = 0; k <= R; k++)
      B.v(top[i]![k]!, normalAt(i, k).y < 0 ? n.negate() : n, PART.brimTop, i / m, k / R);
  for (let i = 0; i < m; i++)
    for (let k = 0; k < R; k++) {
      const a = bt + i * (R + 1) + k;
      B.quad(a, a + 1, a + R + 2, a + R + 1);
    }
  // bottom surface
  const bb = B.count;
  for (let i = 0; i <= m; i++)
    for (let k = 0; k <= R; k++) {
      const nn = normalAt(i, k);
      if (nn.y < 0) nn.negate();
      B.v(
        p.copy(top[i]![k]!).addScaledVector(nn, -o.thick),
        nn.clone().negate(),
        PART.brimBottom,
        i / m,
        k / R,
      );
    }
  for (let i = 0; i < m; i++)
    for (let k = 0; k < R; k++) {
      const a = bb + i * (R + 1) + k;
      B.quad(a, a + R + 1, a + R + 2, a + 1);
    }
  // rounded outer edge
  const be = B.count;
  for (let i = 0; i <= m; i++) {
    const a = top[i]![R]!,
      b = top[i]![R - 1]!;
    const out = V().subVectors(a, b).normalize();
    const nn = normalAt(i, R).clone();
    if (nn.y < 0) nn.negate();
    B.v(a, nn, PART.brimEdge, i / m, 0);
    B.v(
      p
        .copy(a)
        .addScaledVector(out, o.thick * 0.5)
        .addScaledVector(nn, -o.thick * 0.5),
      out,
      PART.brimEdge,
      i / m,
      0.5,
    );
    B.v(p.copy(a).addScaledVector(nn, -o.thick), nn.clone().negate(), PART.brimEdge, i / m, 1);
  }
  for (let i = 0; i < m; i++) {
    const a = be + i * 3;
    B.quad(a, a + 3, a + 4, a + 1);
    B.quad(a + 1, a + 4, a + 5, a + 2);
  }
}

/** Little dome (cap button / knot lobes). */
function dome(
  B: HatBuilder,
  at: THREE.Vector3,
  up: THREE.Vector3,
  r: number,
  h: number,
  part: number,
  squash = 1,
) {
  const t = V()
    .crossVectors(up, Math.abs(up.y) > 0.9 ? V().set(1, 0, 0) : V().set(0, 1, 0))
    .normalize();
  const b = V().crossVectors(up, t).normalize();
  const base = B.count;
  const S = 12,
    Rr = 5;
  const p = V(),
    n = V();
  for (let j = 0; j <= Rr; j++) {
    const th = (j / Rr) * Math.PI * 0.5;
    for (let i = 0; i <= S; i++) {
      const ph = (i / S) * Math.PI * 2;
      n.copy(t)
        .multiplyScalar(Math.cos(ph) * Math.cos(th))
        .addScaledVector(b, Math.sin(ph) * Math.cos(th) * squash)
        .addScaledVector(up, Math.sin(th))
        .normalize();
      p.copy(at)
        .addScaledVector(t, Math.cos(ph) * Math.cos(th) * r)
        .addScaledVector(b, Math.sin(ph) * Math.cos(th) * r * squash)
        .addScaledVector(up, Math.sin(th) * h);
      B.v(p, n, part, i / S, j / Rr);
    }
  }
  for (let j = 0; j < Rr; j++)
    for (let i = 0; i < S; i++) {
      const a = base + j * (S + 1) + i;
      B.quad(a, a + 1, a + S + 2, a + S + 1);
    }
}

/**
 * Headwrap (igitambaro) fabric: hugs the skull with a little volume gathered at the back of the crown, soft folds
 * radiating from the knot, a folded, thick lower edge sitting snugly on the hairline, and a neat knot at the back of
 * the crown (two short tucked ends and the twisted centre), all sized to the head.
 */
function wrapGeometry(B: HatBuilder, body: BodyType, clearance: number, lod: 0 | 1) {
  const backBulge = (az: number, v: number) => {
    const back = Math.pow(Math.max(0, -Math.cos(az)), 1.5);
    return 0.012 * back * Math.sin(Math.min(1, v * 1.2) * Math.PI * 0.9) + 0.003 * v;
  };
  const folds = (az: number, v: number) => {
    // folds fan out from the knot at the back-top: strongest on the sides and back, calm over the forehead
    const side = 0.35 + 0.65 * smooth(-Math.cos(az), -0.6, 0.6);
    const f = Math.sin(az * 11 + v * 4.5) * 0.6 + Math.sin(az * 7 - v * 6.0) * 0.4;
    return 0.0022 * f * side * smooth(v, 0.06, 0.25) * (1 - smooth(v, 0.85, 1));
  };
  const r = crown(B, {
    kind: "wrap",
    body,
    clearance: clearance + 0.0028,
    cols: lod === 0 ? 128 : 48,
    rows: lod === 0 ? 22 : 9,
    extra: (az, v) => backBulge(az, v) + folds(az, v),
    rimDepth: 0.006,
  });
  // rolled lower edge: a soft tube along the rim (fabric thickness, no paper edge)
  const p = V(),
    n = V();
  const cols = r.rimP.length - 1;
  const tb = B.count;
  const T = lod === 0 ? 6 : 3;
  for (let i = 0; i <= cols; i++) {
    const q = r.rimP[i]!,
      nn = r.rimN[i]!;
    for (let j = 0; j <= T; j++) {
      const a = (j / T) * Math.PI;
      // half tube from the crown surface, round the edge, back under it
      n.copy(nn)
        .multiplyScalar(Math.sin(a))
        .add(V().set(0, -Math.cos(a), 0))
        .normalize();
      p.copy(q)
        .addScaledVector(nn, 0.0028 * Math.sin(a) - 0.001)
        .add(V().set(0, 0.003 - 0.003 * Math.cos(a) - 0.002, 0));
      B.v(p, n, PART.cuff, i / cols, j / T);
    }
  }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < T; j++) {
      const a = tb + i * (T + 1) + j;
      B.quad(a, a + T + 1, a + T + 2, a + 1);
    }
  // knot at the back of the crown
  const d = V(),
    q = V(),
    up = V();
  dirAt(body, Math.PI, 0.78, d);
  skullPoint(body, d, q);
  skullNormal(body, d, up);
  q.addScaledVector(up, clearance + 0.017);
  dome(B, q, up, 0.016, 0.013, PART.knot, 0.85);
  for (const side of [-1, 1]) {
    dirAt(body, Math.PI + side * 0.3, 0.7, d);
    skullPoint(body, d, p);
    skullNormal(body, d, n);
    p.addScaledVector(n, clearance + 0.013);
    dome(
      B,
      p,
      n
        .clone()
        .add(V().set(side * 0.5, -0.2, 0))
        .normalize(),
      0.014,
      0.009,
      PART.knot,
      0.6,
    );
  }
  return r;
}

export interface HeadwearBuild {
  geo: THREE.BufferGeometry;
  kind: Exclude<HeadwearKind, "none">;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Headwear geometry for (body, kind, hairstyle) in the head's geometry space, cached and shared. */
export function headwearGeometry(
  frame: HeadFrame,
  body: BodyType,
  kind: Exclude<HeadwearKind, "none">,
  style: HairStyle,
  lod: 0 | 1 = 0,
  cacheKey = "",
): THREE.BufferGeometry {
  const key = `${cacheKey}|${body}|${kind}|${style}|${lod}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const B = new HatBuilder();
  const clearance = HAT_CLEARANCE[style] ?? 0.002;
  const cols = lod === 0 ? 96 : 36;
  if (kind === "cap") {
    // a structured front: the two front panels stand a little proud
    const r = crown(B, {
      kind,
      body,
      clearance,
      cols,
      rows: lod === 0 ? 16 : 7,
      extra: (az, v) => 0.002 * Math.pow(Math.max(0, Math.cos(az)), 2) * Math.sin(v * Math.PI),
    });
    const span = 1.16;
    brim(B, r.rimP, r.rimN, cols, {
      from: -span,
      to: span,
      depth: (az) => 0.066 * Math.pow(Math.max(0, 1 - (az / span) ** 2), 0.6) + 0.002,
      pitch: 0.3,
      curve: 0.02,
      thick: 0.0036,
      rows: lod === 0 ? 8 : 3,
      body,
    });
    const top = V(),
      up = V(),
      d = V();
    dirAt(body, 0, Math.PI / 2 - 0.001, d);
    skullPoint(body, d, top);
    skullNormal(body, d, up);
    top.addScaledVector(up, clearance + 0.0016);
    dome(B, top, up, 0.0068, 0.0032, PART.button);
  } else if (kind === "beanie") {
    const slouch = (az: number, v: number) => 0.003 + 0.007 * v * v + 0.006 * Math.max(0, -Math.cos(az)) * v;
    const r = crown(B, {
      kind,
      body,
      clearance,
      cols,
      rows: lod === 0 ? 18 : 7,
      extra: slouch,
      rimDepth: 0.006,
    });
    // folded cuff: a thicker band from the rim up ~3.4 cm
    const cb = B.count;
    const rows = lod === 0 ? 6 : 2;
    const p = V(),
      n = V();
    for (let i = 0; i <= cols; i++) {
      const q = r.rimP[i]!,
        nn = r.rimN[i]!;
      for (let k = 0; k <= rows; k++) {
        const t = k / rows;
        const roll = Math.sin(t * Math.PI) * 0.0022 + 0.0042;
        p.copy(q)
          .addScaledVector(nn, roll)
          .add(n.set(0, 0.034 * t, 0));
        B.v(p, nn, PART.cuff, i / cols, t);
      }
    }
    for (let i = 0; i < cols; i++)
      for (let k = 0; k < rows; k++) {
        const a = cb + i * (rows + 1) + k;
        B.quad(a, a + rows + 1, a + rows + 2, a + 1);
      }
  } else if (kind === "bucket") {
    const r = crown(B, {
      kind,
      body,
      clearance: clearance + 0.002,
      cols,
      rows: lod === 0 ? 14 : 6,
      flatTop: 0.068,
      extra: (_az, v) => 0.004 * (1 - v),
    });
    brim(B, r.rimP, r.rimN, cols, {
      from: -Math.PI,
      to: Math.PI,
      depth: () => 0.046,
      pitch: 0.55,
      curve: 0.0,
      thick: 0.003,
      rows: lod === 0 ? 6 : 2,
      body,
    });
  } else if (kind === "kufi") {
    crown(B, {
      kind,
      body,
      clearance,
      cols,
      rows: lod === 0 ? 12 : 5,
      extra: (_az, v) => 0.0015 * (1 - v),
      rimDepth: 0.0022,
    });
  } else {
    wrapGeometry(B, body, clearance, lod);
  }
  const g = new THREE.BufferGeometry();
  // face frame → geometry space, rigid on the head bone
  const P = new Float32Array(B.P.length);
  const N = new Float32Array(B.N.length);
  const p = V();
  for (let i = 0; i < B.count; i++) {
    p.fromArray(B.P, i * 3)
      .applyMatrix3(frame.Rt)
      .add(frame.o);
    P.set([p.x, p.y, p.z], i * 3);
    p.fromArray(B.N, i * 3)
      .applyMatrix3(frame.Rt)
      .normalize();
    N.set([p.x, p.y, p.z], i * 3);
  }
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("hwp", new THREE.Float32BufferAttribute(B.A, 3));
  const si = new Uint16Array(B.count * 4);
  const sw = new Float32Array(B.count * 4);
  for (let i = 0; i < B.count; i++) {
    si[i * 4] = frame.head;
    sw[i * 4] = 1;
  }
  g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  g.setIndex(
    B.count > 65535 ? new THREE.Uint32BufferAttribute(B.I, 1) : new THREE.Uint16BufferAttribute(B.I, 1),
  );
  g.computeBoundingSphere();
  g.userData.gkShared = true;
  cache.set(key, g);
  return g;
}

/* ---------------- fabric material ---------------- */

const HW_VERT_HEAD = /* glsl */ `
attribute vec3 hwp;
varying vec3 vHw; varying vec3 vHwP;
`;
const HW_VERT = /* glsl */ `
#include <begin_vertex>
vHw = hwp; vHwP = position;
`;
const HW_FRAG_HEAD = /* glsl */ `
uniform vec3 uHwC; uniform vec3 uHwC2; uniform float uHwKind; uniform sampler2D uHwPrint; uniform float uHwPrintOn;
varying vec3 vHw; varying vec3 vHwP;
float hwH = 0.0;
float hwHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hwRidge(float x) { return 1.0 - abs(fract(x) - 0.5) * 2.0; }
float hwLine(float x, float w, float fwx) { float d = abs(fract(x + 0.5) - 0.5); return 1.0 - smoothstep(w, w + fwx * 1.5, d); }
`;
/** kinds: 0 cap, 1 beanie, 2 bucket, 3 kufi, 4 wrap */
const HW_FRAG = /* glsl */ `
#include <map_fragment>
{
  float part = vHw.x; float u = vHw.y; float v = vHw.z;
  vec3 col = uHwC;
  float shade = 1.0;
  float fwu = fwidth(u) + 1e-5; float fwv = fwidth(v) + 1e-5;
  float az = u * 6.2831853 - 3.1415927;
  if (uHwKind < 0.5) {
    // ---- cap: cotton twill, six panels (seams every 60°), top-stitching, eyelets, stitched brim
    float tw = hwRidge((u * 260.0 + v * 70.0));
    shade *= 0.93 + 0.07 * tw;
    hwH += tw * 0.25;
    if (part < 0.5) {
      float sp = u * 6.0;
      float dSeam = abs(fract(sp + 0.5) - 0.5) / 6.0;
      float groove = 1.0 - smoothstep(0.0, 0.0035, dSeam);
      shade *= 1.0 - 0.28 * groove;
      hwH -= groove * 1.2;
      // twin top-stitch lines either side of each seam, and one round the band
      float st = hwLine((dSeam - 0.0055) / 0.0016 * 0.5, 0.12, fwu * 300.0) * step(v, 0.96);
      float dash = step(0.45, fract(v * 90.0));
      shade *= 1.0 - 0.22 * st * dash;
      float band = hwLine((v - 0.06) * 60.0, 0.08, fwv * 60.0) * step(0.5, fract(u * 300.0));
      shade *= 1.0 - 0.2 * band;
      // eyelets near the top of every panel
      vec2 e = vec2((fract(sp) - 0.5) * 0.52, (v - 0.72) * 0.42);
      float ey = length(e);
      float ring = 1.0 - smoothstep(0.004, 0.0075, abs(ey - 0.0085));
      float hole = 1.0 - smoothstep(0.0, 0.0055, ey);
      shade *= 1.0 - 0.35 * ring - 0.55 * hole;
    } else if (part < 3.5) {
      // brim: concentric stitch rows on top, plain underside
      if (part < 1.5) {
        float rows = 0.0;
        for (int k = 1; k <= 6; k++) rows = max(rows, hwLine((v - float(k) * 0.14) * 22.0, 0.05, fwv * 22.0));
        shade *= 1.0 - 0.18 * rows * step(0.4, fract(u * 160.0));
      } else if (part < 2.5) {
        shade *= 0.82;
      }
    } else if (part < 4.5) {
      shade *= 0.95;
    } else {
      shade *= 0.55;
    }
  } else if (uHwKind < 1.5) {
    // ---- beanie: stockinette knit (rows of little Vs), a rib-knit cuff
    if (part > 5.5) {
      float rib = hwRidge(u * 150.0);
      shade *= 0.72 + 0.32 * rib;
      hwH += rib * 1.6;
    } else {
      float colk = fract(u * 210.0);
      float rowk = v * 60.0 + abs(colk - 0.5) * 0.9;
      float k = hwRidge(rowk) * (0.6 + 0.4 * hwRidge(u * 210.0));
      shade *= 0.74 + 0.3 * k;
      hwH += k * 1.3;
      if (part > 4.5) shade *= 0.6;
    }
  } else if (uHwKind < 2.5) {
    // ---- bucket hat: canvas weave, stitched rings on the brim and the crown band
    float wv = hwRidge(u * 320.0) * hwRidge(v * 80.0);
    shade *= 0.92 + 0.08 * wv;
    if (part > 0.5 && part < 3.5) {
      float rows = 0.0;
      for (int k = 1; k <= 7; k++) rows = max(rows, hwLine((v - float(k) * 0.125) * 18.0, 0.05, fwv * 18.0));
      shade *= 1.0 - 0.2 * rows * step(0.4, fract(u * 300.0));
      if (part > 1.5 && part < 2.5) shade *= 0.85;
    } else if (part < 0.5) {
      float rows = max(hwLine((v - 0.05) * 30.0, 0.06, fwv * 30.0), hwLine((v - 0.12) * 30.0, 0.06, fwv * 30.0));
      shade *= 1.0 - 0.2 * rows * step(0.4, fract(u * 300.0));
    } else shade *= 0.55;
  } else if (uHwKind < 3.5) {
    // ---- kufi: knit base, an embroidered imigongo zigzag band round the lower half, a little rosette on top
    float k = hwRidge(u * 240.0) * hwRidge(v * 70.0);
    shade *= 0.9 + 0.1 * k;
    float zz = abs(fract(u * 24.0) - 0.5) * 2.0;
    float band1 = 1.0 - smoothstep(0.03, 0.06, abs(v - 0.12 - zz * 0.16));
    float band2 = 1.0 - smoothstep(0.03, 0.06, abs(v - 0.22 - zz * 0.16));
    float dia = 1.0 - smoothstep(0.08, 0.12, abs(fract(u * 24.0) - 0.5) + abs(v - 0.36) * 2.2);
    float emb = max(max(band1, band2), dia) * step(v, 0.5);
    float ros = (1.0 - smoothstep(0.0, 0.02, abs(fract(u * 16.0) - 0.5) * 0.25 + abs(v - 0.86))) * step(0.75, v);
    col = mix(col, uHwC2, max(emb, ros));
    hwH += max(emb, ros) * 1.4;
    if (part > 4.5) shade *= 0.6;
  } else {
    // ---- headwrap: printed cotton, fine weave, folds shaded by the geometry
    vec3 pr = uHwPrintOn > 0.5 ? texture2D(uHwPrint, vec2(u * 3.0, v * 1.6)).rgb : uHwC;
    col = pr;
    float wv = hwRidge(u * 420.0) * hwRidge(v * 140.0);
    shade *= 0.93 + 0.07 * wv;
    if (part > 4.5 && part < 5.5) shade *= 0.7;
  }
  diffuseColor.rgb = col * shade;
}
`;
const HW_BUMP = /* glsl */ `
#include <normal_fragment_maps>
{
  vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  vec2 dh = vec2(dFdx(hwH), dFdy(hwH)) * 0.0006;
  normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
}
`;

const KIND_ID: Record<Exclude<HeadwearKind, "none">, number> = {
  cap: 0,
  beanie: 1,
  bucket: 2,
  kufi: 3,
  wrap: 4,
};

export function makeHeadwearMaterial(
  kind: Exclude<HeadwearKind, "none">,
  color: string,
  color2: string | undefined,
  print: PrintId | undefined,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: kind === "wrap" ? 0.86 : kind === "beanie" ? 0.95 : 0.84,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  m.name = "gk-headwear";
  let tex: THREE.Texture | null = null;
  if (print) {
    tex = fabricTexture(print);
    if (tex.wrapS !== THREE.RepeatWrapping) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    }
  }
  const u = {
    uHwC: { value: new THREE.Color(color) },
    uHwC2: { value: new THREE.Color(color2 ?? "#8a5a2b") },
    uHwKind: { value: KIND_ID[kind] },
    uHwPrint: { value: tex },
    uHwPrintOn: { value: tex ? 1 : 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = HW_VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", HW_VERT);
    shader.fragmentShader =
      HW_FRAG_HEAD +
      shader.fragmentShader
        .replace("#include <map_fragment>", HW_FRAG)
        .replace("#include <normal_fragment_maps>", HW_BUMP);
  };
  m.customProgramCacheKey = () => "gk-headwear-1";
  return m;
}
