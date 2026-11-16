// P3-FGT-19A fighter v8 prototype (dev only): garments and kit, built on the bind-pose body.
//  - vest and trunks: cut from the body surface along smooth fields (no quad staircase), shaped as cloth (bridged over
//    valleys, hanging from the chest / seat, tucked under the band, drape folds), solidified with a rolled hem;
//  - gloves, headgear, boots: signed distance modelling + surface nets at product dimensions (IBA rules, research);
//  - hand wraps: a 2.5 mm offset of the hand for the close-up sheet.
// Every piece carries skin weights (from its source body vertex, or rigid to one bone) so the page can pose it.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import {
  add, clamp, cross, dot, fbm, isoCut, len, lerp, norm, refineToSurface, scl, sdCapsule, sdEllipsoid, sdfNormals, sdRoundBox, sdRoundCone,
  smax, smin, smoothLoops, smoothstep, solidify, sub, surfaceNets, boundaryLoops, vertexNormals,
} from "./geo.mjs";

/** dimensions (metres) and rules that drive the kit — mirrored in SPEC.md */
export const KIT = {
  bandWidth: 0.075, // IBA 49.3.8: belt line 6–10 cm, contrasting colour, must not cover the navel
  vestTuck: 0.04, // vest hem tucked 4 cm under the band top
  vestThickness: 0.0018, // polyester jersey ≈ 140–160 g/m² (unverified fabric weight; visual thickness incl. binding)
  trunksThickness: 0.0016, // satin-polyester
  bandThickness: 0.0045,
  trunksHemAboveKnee: 0.1, // hem 10 cm above the knee joint: not shorter than mid-thigh, never on the knee (IBA 49.3.3)
  trunksEase: 0.022, // leg opening ease over the thigh (radius)
  strapWidth: { m: 0.058, f: 0.05 },
  glove: { oz: 10, length: 0.27, knuckleWidth: 0.118, depth: 0.116, cuffLength: 0.1, tapeWidth: 0.05, fistCentre: 0.085 },
  headgear: { crown: 0.021, brow: 0.036, cheek: 0.028, ear: 0.026, back: 0.023, gap: 0.0025 },
  boot: { shaft: 0.22, sole: 0.012 },
};

/** body helpers over a subdivided body { P, tris, skin, bones, boneIndex } */
export function bodyTools(body) {
  const { P, skin, boneIndex } = body;
  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const w = (i, names) => {
    let s = 0;
    for (const n of names) s += skin[i].get(boneIndex.get(n)) ?? 0;
    return s;
  };
  const wRe = (i, re) => {
    let s = 0;
    for (const [b, x] of skin[i]) if (re.test(body.bones[b].name)) s += x;
    return s;
  };
  const bone = (n) => body.bones[boneIndex.get(n)];
  return { V, w, wRe, bone };
}

/** horizontal hull slices of the trunk (arm / head / leg weight excluded) for cloth bridging */
function trunkSlices(body, T, y0, y1, step = 0.01, filter) {
  const slices = [];
  const n = body.P.length / 3;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const p = T.V(i);
    if (p[1] < y0 - step || p[1] > y1 + step) continue;
    if (!filter(i, p)) continue;
    const k = Math.round((p[1] - y0) / step);
    for (const kk of [k - 1, k, k + 1]) {
      if (!buckets.has(kk)) buckets.set(kk, []);
      buckets.get(kk).push([p[0], p[2]]);
    }
  }
  for (let k = 0; k <= Math.round((y1 - y0) / step); k++) {
    const pts = buckets.get(k) ?? [];
    slices.push(hull2(pts));
  }
  return { y0, step, slices, at: (y) => slices[clamp(Math.round((y - y0) / step), 0, slices.length - 1)] };
}

/** 2D convex hull (monotone chain) with its centroid */
function hull2(pts) {
  if (pts.length < 3) return { pts: [], c: [0, 0] };
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of s) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let cx = 0, cz = 0;
  for (const p of h) {
    cx += p[0];
    cz += p[1];
  }
  return { pts: h, c: [cx / h.length, cz / h.length] };
}
/** distance from c to the hull boundary along direction d (2D) */
function hullRadius(h, c, d) {
  let best = 0;
  const n = h.pts.length;
  for (let i = 0; i < n; i++) {
    const a = h.pts[i], b = h.pts[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const den = d[0] * ez - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - c[0]) * ez - (a[1] - c[1]) * ex) / den;
    const s = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

/** cylindrical cloth uv in metres (u around the body axis, v up), for tiling fabric detail */
function clothUV(p, cx = 0, cz = 0) {
  const a = Math.atan2(p[0] - cx, p[2] - cz);
  return [(a / (2 * Math.PI) + 0.5) * 1.0, p[1]];
}

/** gather a cut surface: body triangles + field → cut piece with source skin interpolation */
function cutPiece(body, field) {
  const n = body.P.length / 3;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = field(i);
  // per-vertex skin as dense arrays over the bones used (for interpolation through isoCut)
  const used = new Set();
  for (let i = 0; i < n; i++) if (f[i] > -0.05) for (const b of body.skin[i].keys()) used.add(b);
  const ub = [...used];
  const sk = new Float64Array(n * ub.length);
  for (let i = 0; i < n; i++) ub.forEach((b, k) => (sk[i * ub.length + k] = body.skin[i].get(b) ?? 0));
  const tris = body.tris.filter(([a, b, c]) => f[a] > -0.05 || f[b] > -0.05 || f[c] > -0.05);
  const cut = isoCut({ P: body.P, tris, f, attrs: { skin: { data: sk, size: ub.length }, src: { data: Float64Array.from({ length: n }, (_, i) => i), size: 1 } } });
  // drop unreferenced vertices
  const ref = new Int32Array(cut.P.length / 3).fill(-1);
  const P = [], S = [], src = [];
  const tri2 = cut.tris.map((t) =>
    t.map((v) => {
      if (ref[v] < 0) {
        ref[v] = P.length / 3;
        P.push(cut.P[v * 3], cut.P[v * 3 + 1], cut.P[v * 3 + 2]);
        const m = new Map();
        for (let k = 0; k < ub.length; k++) {
          const x = cut.attrs.skin.data[v * ub.length + k];
          if (x > 1e-4) m.set(ub[k], x);
        }
        S.push(m);
        src.push(cut.attrs.src.data[v]);
      }
      return ref[v];
    }),
  );
  // drop small islands (cut fragments in hollows)
  {
    const parent = Int32Array.from({ length: P.length / 3 }, (_, i) => i);
    const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    for (const [a, b, c] of tri2) {
      parent[find(a)] = find(b);
      parent[find(b)] = find(c);
    }
    const size = new Map();
    for (const t of tri2) size.set(find(t[0]), (size.get(find(t[0])) ?? 0) + 1);
    const big = Math.max(...size.values());
    for (let k = tri2.length - 1; k >= 0; k--) if (size.get(find(tri2[k][0])) < big * 0.04) tri2.splice(k, 1);
  }
  const out = { P: Float64Array.from(P), tris: tri2, skin: S, src };
  // clean the cut edge
  const loops = boundaryLoops(out.tris);
  smoothLoops(out.P, loops, 24, 0.5);
  return out;
}

/* ===================================================================================== vest */
export function buildVest(body, L, sex) {
  const T = bodyTools(body);
  const n = body.P.length / 3;
  const armRe = /^(upperarm|lowerarm|wrist|finger|metacarpal)/;
  const headRe = /^(head|jaw|eye|neck03|special|tongue|oris|orbic|oculi|levator|temporalis|risorius)/;
  const legRe = /^(upperleg|lowerleg|foot|toe)/;
  const shL = L.shoulderL, shR = L.shoulderR;
  const shX = Math.abs(shL[0]);
  const strap = KIT.strapWidth[sex];
  const hemY = L.bandTop - KIT.vestTuck;
  const notchY = L.notchY;
  const field = (i) => {
    const p = T.V(i);
    // smooth exclusions (weights interpolate smoothly: the cut stays clean)
    let f = p[1] - hemY;
    f = Math.min(f, (0.6 - T.wRe(i, armRe)) * 0.15, (0.5 - T.wRe(i, headRe)) * 0.15, (0.5 - T.wRe(i, legRe)) * 0.15);
    // arm holes: deep singlet cut, ellipsoid round the armpit
    for (const sh of [shL, shR]) {
      const c = [Math.sign(sh[0]) * (shX + 0.03), sh[1] - 0.075, sh[2] - 0.008];
      const r = [0.1, 0.175, 0.094];
      const q = sub(p, c);
      const e = Math.sqrt((q[0] / r[0]) ** 2 + (q[1] / r[1]) ** 2 + (q[2] / r[2]) ** 2) - 1;
      f = smin(f, e * 0.08, 0.012);
    }
    // neckline: everything above the scoop curve goes (front deeper than the back); the straps stop on the traps
    {
      const front = p[2] > L.neckZ;
      const rx = shX - 0.045 - strap;
      const depth = front ? (sex === "f" ? 0.075 : 0.085) : 0.01;
      const cy = notchY + 0.06;
      const ux = Math.min(1, Math.abs(p[0]) / rx);
      const yCut = cy - (depth + 0.06) * Math.sqrt(Math.max(0, 1 - ux * ux));
      f = smin(f, smin(yCut - p[1], notchY + 0.085 - p[1], 0.02), 0.012);
    }
    return f;
  };
  const piece = cutPiece(body, field);
  // shape as cloth
  const chestY = L.chestY;
  const sl = trunkSlices(body, T, hemY - 0.02, L.shoulderL[1] + 0.12, 0.01, (i) => T.wRe(i, armRe) < 0.3 && T.wRe(i, headRe) < 0.3 && T.wRe(i, legRe) < 0.3);
  const hc = sl.at(chestY);
  const N = vertexNormals(piece.P, piece.tris);
  const out = Float64Array.from(piece.P);
  for (let v = 0; v < piece.P.length / 3; v++) {
    const p = [piece.P[v * 3], piece.P[v * 3 + 1], piece.P[v * 3 + 2]];
    const y = p[1];
    const h = sl.at(y);
    const c = h.c;
    const dx = p[0] - c[0], dz = p[2] - c[1];
    const r = Math.hypot(dx, dz) || 1e-6;
    const d = [dx / r, dz / r];
    // strap zone: lies flat on the trapezius
    const strapZone = smoothstep(L.shoulderL[1] - 0.09, L.shoulderL[1] - 0.02, y);
    let rr = r + 0.0025;
    if (h.pts.length) rr = Math.max(rr, hullRadius(h, c, d) + 0.003);
    // hang from the chest / shoulder blades / lats below the chest line
    if (y < chestY && hc.pts.length) {
      const rh = hullRadius(hc, hc.c, d) * (1 - 0.32 * (chestY - y)) + 0.003;
      const hang = smoothstep(hemY + 0.03, hemY + 0.12, y);
      const cxz = [lerp(c[0], hc.c[0], hang), lerp(c[1], hc.c[1], hang)];
      const rHang = Math.hypot(cxz[0] + d[0] * rh - c[0], cxz[1] + d[1] * rh - c[1]);
      rr = Math.max(rr, lerp(rr, rHang, hang));
    }
    // tuck: under the band the jersey lies on the body; a blouse of 1–1.6 cm just above it
    const tuck = 1 - smoothstep(L.bandTop - 0.005, L.bandTop + 0.015, y);
    const blouse = Math.exp(-(((y - (L.bandTop + 0.03)) / 0.022) ** 2)) * (0.0055 + 0.004 * fbm(d[0] * 3 + 7, y * 9, d[1] * 3));
    rr = lerp(rr, r + 0.0022, tuck) + blouse * (1 - tuck);
    // drape folds in the hanging zone (vertical, uneven), stronger at the sides and near the blouse
    const ang = Math.atan2(d[0], d[1]);
    const foldZone = smoothstep(chestY, chestY - 0.12, y) * (1 - tuck);
    const side = 0.5 + 0.5 * Math.abs(Math.sin(ang));
    const fold = (Math.sin(ang * 9 + 2.3 * fbm(ang * 2, y * 4, 1)) * 0.6 + (fbm(ang * 5, y * 6, 3) - 0.5) * 1.2) * 0.0032 * foldZone * side;
    rr += fold;
    const np = [c[0] + d[0] * rr, y, c[1] + d[1] * rr];
    // straps keep their body position + offset along the normal
    const sp = add(p, scl([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], 0.0025));
    const q = [lerp(np[0], sp[0], strapZone), lerp(np[1], sp[1], strapZone), lerp(np[2], sp[2], strapZone)];
    out[v * 3] = q[0];
    out[v * 3 + 1] = q[1];
    out[v * 3 + 2] = q[2];
  }
  piece.P = out;
  {
    const armB = /^(upperarm|lowerarm|wrist|finger|metacarpal)/;
    const spine1 = body.boneIndex.get("spine01");
    let sk = piece.skin.map((m) => {
      const o = new Map();
      let moved = 0;
      for (const [b, x] of m) {
        if (armB.test(body.bones[b].name)) moved += x;
        else o.set(b, x);
      }
      if (moved) o.set(spine1, (o.get(spine1) ?? 0) + moved);
      return o;
    });
    const nv = piece.P.length / 3;
    const nb = Array.from({ length: nv }, () => new Set());
    for (const [a, b, c] of piece.tris) {
      nb[a].add(b).add(c);
      nb[b].add(a).add(c);
      nb[c].add(a).add(b);
    }
    for (let it = 0; it < 6; it++) {
      sk = sk.map((m, v) => {
        const o = new Map();
        for (const [b, x] of m) o.set(b, x * 0.5);
        const k = nb[v].size || 1;
        for (const q of nb[v]) for (const [b, x] of sk[q]) o.set(b, (o.get(b) ?? 0) + (x * 0.5) / k);
        return o;
      });
    }
    piece.skin = sk;
  }
  const cloth = finishCloth(piece, KIT.vestThickness, { rimSteps: 5, bead: 0.0016, uvCentre: [0, 0] });
  cloth.field = field;
  return cloth;
}

/* ===================================================================================== trunks */
export function buildTrunks(body, L) {
  const T = bodyTools(body);
  const legSide = (p) => (p[0] >= 0 ? "L" : "R");
  const armRe = /^(upperarm|lowerarm|wrist|finger|metacarpal|clavicle|shoulder)/;
  const hemY = { L: L.kneeL[1] + KIT.trunksHemAboveKnee, R: L.kneeR[1] + KIT.trunksHemAboveKnee };
  const top = L.bandTop;
  const bandBot = top - KIT.bandWidth;
  const crotchY = L.crotchY;
  const sl = trunkSlices(body, T, crotchY - 0.01, top + 0.02, 0.01, (i) => T.wRe(i, armRe) < 0.3);
  const leg = {};
  for (const S of ["L", "R"]) {
    const hip = S === "L" ? L.hipL : L.hipR, knee = S === "L" ? L.kneeL : L.kneeR;
    leg[S] = { hip, knee, ax: norm(sub(knee, hip)) };
  }
  // the elastic band: its own piece, flat on the body with a little compression, clean top and bottom edges
  const bandPiece = cutPiece(body, (i) => {
    const p = T.V(i);
    if (T.wRe(i, armRe) > 0.4) return -1;
    return Math.min(top - p[1], p[1] - bandBot);
  });
  {
    const N = vertexNormals(bandPiece.P, bandPiece.tris);
    for (let v = 0; v < bandPiece.P.length / 3; v++) for (let k = 0; k < 3; k++) bandPiece.P[v * 3 + k] += N[v * 3 + k] * 0.0055;
  }
  // the satin: from under the band to the hem
  const piece = cutPiece(body, (i) => {
    const p = T.V(i);
    if (T.wRe(i, armRe) > 0.4) return -1;
    return Math.min(bandBot + 0.015 - p[1], p[1] - hemY[legSide(p)]);
  });
  const N = vertexNormals(piece.P, piece.tris);
  const out = Float64Array.from(piece.P);
  for (let v = 0; v < piece.P.length / 3; v++) {
    const p = [piece.P[v * 3], piece.P[v * 3 + 1], piece.P[v * 3 + 2]];
    const nrm = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    const y = p[1];
    let q;
    if (y >= crotchY) {
      // seat / hips: bridged over the cleft and the front, eased out from under the band
      const h = sl.at(y);
      const c = h.c;
      const dx = p[0] - c[0], dz = p[2] - c[1];
      const r = Math.hypot(dx, dz) || 1e-6;
      const d = [dx / r, dz / r];
      const ease = smoothstep(bandBot + 0.005, bandBot - 0.05, y);
      let rr = Math.max(r + 0.0025, lerp(r + 0.0025, (h.pts.length ? hullRadius(h, c, d) : r) + 0.009, ease));
      const ang = Math.atan2(d[0], d[1]);
      rr += Math.sin(ang * 7 + 1.7) * 0.0015 * ease;
      q = [c[0] + d[0] * rr, y, c[1] + d[1] * rr];
    } else {
      const S = legSide(p);
      const g = leg[S];
      const rel = sub(p, g.hip);
      const t = dot(rel, g.ax);
      const foot = add(g.hip, scl(g.ax, t));
      const radial = sub(p, foot);
      const r = len(radial) || 1e-6;
      const d = scl(radial, 1 / r);
      const s = clamp((crotchY - y) / (crotchY - hemY[S]), 0, 1);
      // the leg opening is wider than the thigh: radius from the seat, barely tapering, a flare at the hem
      const seatR = 0.108 * (L.stature / 1.76);
      let rr = Math.max(r + KIT.trunksEase * (0.55 + 0.45 * s), seatR * (1 - 0.04 * s) + 0.014 * s * s);
      const ang = Math.atan2(dot(d, [1, 0, 0]) * (S === "L" ? 1 : -1), dot(d, [0, 0, 1]));
      rr += (Math.sin(ang * 6 + 0.9 + 1.4 * fbm(ang, s * 2, S === "L" ? 1 : 5)) * 0.6 + (fbm(ang * 3, s * 3, 9) - 0.5)) * 0.006 * (0.25 + 0.75 * s);
      q = add(foot, scl(d, rr));
      // gravity: the hem hangs a little lower at the back and sides
      q[1] -= 0.006 * s * s * (0.6 + 0.4 * Math.abs(Math.sin(ang)));
      if (S === "L") q[0] = Math.max(q[0], 0.004);
      else q[0] = Math.min(q[0], -0.004);
      const k = smoothstep(0, 0.12, s);
      const seat = add(p, scl(nrm, 0.009));
      q = [lerp(seat[0], q[0], k), lerp(seat[1], q[1], k), lerp(seat[2], q[2], k)];
    }
    out[v * 3] = q[0];
    out[v * 3 + 1] = q[1];
    out[v * 3 + 2] = q[2];
  }
  piece.P = out;
  // the cloth lags the thigh: 18 % of the leg bones' weight moves to the pelvis (root)
  const root = body.boneIndex.get("root");
  piece.skin = piece.skin.map((m) => {
    const o = new Map();
    let moved = 0;
    for (const [b, x] of m) {
      if (/^(upperleg|lowerleg)/.test(body.bones[b].name)) {
        o.set(b, x * 0.82);
        moved += x * 0.18;
      } else o.set(b, (o.get(b) ?? 0) + x);
    }
    if (moved) o.set(root, (o.get(root) ?? 0) + moved);
    return o;
  });
  const satin = finishCloth(piece, KIT.trunksThickness, { rimSteps: 5, bead: 0.0014, uvCentre: [0, 0] });
  satin.field = (i) => {
    const p = T.V(i);
    return Math.min(top - p[1], p[1] - hemY[legSide(p)]);
  };
  const band = finishCloth(bandPiece, KIT.bandThickness, { rimSteps: 6, bead: 0.0008, uvCentre: [0, 0] });
  return { satin, band };
}

/** solidify + per-vertex attributes for a cut cloth piece */
function finishCloth(piece, thickness, { rimSteps, bead, uvCentre, smooth = 8 }) {
  const tf = typeof thickness === "function" ? thickness : () => thickness;
  // Taubin smoothing of the shaped cloth (removes slice steps; boundary kept)
  if (smooth) {
    const n = piece.P.length / 3;
    const nb = Array.from({ length: n }, () => new Set());
    for (const [a, b, c] of piece.tris) {
      nb[a].add(b).add(c);
      nb[b].add(a).add(c);
      nb[c].add(a).add(b);
    }
    const bnd = new Set(boundaryLoops(piece.tris).flat());
    let cur = Float64Array.from(piece.P);
    for (let it = 0; it < smooth * 2; it++) {
      const lam = it % 2 === 0 ? 0.5 : -0.53;
      const nx = Float64Array.from(cur);
      for (let v = 0; v < n; v++) {
        if (bnd.has(v) || !nb[v].size) continue;
        let x = 0, y = 0, z = 0;
        for (const q of nb[v]) {
          x += cur[q * 3];
          y += cur[q * 3 + 1];
          z += cur[q * 3 + 2];
        }
        const k = nb[v].size;
        nx[v * 3] = cur[v * 3] + lam * (x / k - cur[v * 3]);
        nx[v * 3 + 1] = cur[v * 3 + 1] + lam * (y / k - cur[v * 3 + 1]);
        nx[v * 3 + 2] = cur[v * 3 + 2] + lam * (z / k - cur[v * 3 + 2]);
      }
      cur = nx;
    }
    piece.P = cur;
  }
  const sol = solidify(piece.P, piece.tris, tf, { rimSteps, bead });
  const nv = sol.P.length / 3;
  const N = vertexNormals(sol.P, sol.tris, nv);
  const uv = new Float64Array(nv * 2);
  const skin = [];
  for (let i = 0; i < nv; i++) {
    const s = sol.src[i];
    const p = [piece.P[s * 3], piece.P[s * 3 + 1], piece.P[s * 3 + 2]];
    const [u, v] = clothUV(p, uvCentre[0], uvCentre[1]);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    skin.push(piece.skin[s]);
  }
  return { P: sol.P, N, tris: sol.tris, uv, skin, side: sol.side, src: sol.src.map((s) => piece.src[s]) };
}

/* ===================================================================================== SDF kit */
function bodyBVH(body, keep) {
  const tris = body.tris.filter(([a, b, c]) => keep(a) && keep(b) && keep(c));
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, k) => t.forEach((v, j) => pos.set([body.P[v * 3], body.P[v * 3 + 1], body.P[v * 3 + 2]], k * 9 + j * 3)));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const bvh = new MeshBVH(g);
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const P = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const nrm = new THREE.Vector3();
  const bary = new THREE.Vector3();
  /** signed distance (positive outside), capped at `cap` */
  const sd = (x, y, z, cap = 0.08) => {
    P.set(x, y, z);
    const hit = bvh.closestPointToPoint(P, target, 0, cap);
    if (!hit) return cap;
    // the BVH re-orders the triangles: map back through its index to our triangle list
    const f = Math.floor(g.index.array[target.faceIndex * 3] / 3);
    tri.set(new THREE.Vector3().fromArray(pos, f * 9), new THREE.Vector3().fromArray(pos, f * 9 + 3), new THREE.Vector3().fromArray(pos, f * 9 + 6));
    // sign from the interpolated vertex normals (pseudo-normal): face normals flip the sign near edges
    tri.getBarycoord(target.point, bary);
    const [ia, ib, ic] = tris[f];
    const NB = body.N;
    nrm.set(
      NB[ia * 3] * bary.x + NB[ib * 3] * bary.y + NB[ic * 3] * bary.z,
      NB[ia * 3 + 1] * bary.x + NB[ib * 3 + 1] * bary.y + NB[ic * 3 + 1] * bary.z,
      NB[ia * 3 + 2] * bary.x + NB[ib * 3 + 2] * bary.y + NB[ic * 3 + 2] * bary.z,
    );
    const s = (x - target.point.x) * nrm.x + (y - target.point.y) * nrm.y + (z - target.point.z) * nrm.z;
    return s >= 0 ? target.distance : -target.distance;
  };
  return { sd, bvh, tris };
}

/** mesh an SDF in a local frame → world mesh with normals, material ids by classifier */
function meshSDF(sdf, bounds, h, toWorld, classify) {
  const sn = surfaceNets(sdf, bounds, h);
  refineToSurface(sn.P, sdf, h, 2);
  const N = sdfNormals(sn.P, sdf, h);
  const nv = sn.P.length / 3;
  const P = new Float64Array(nv * 3), NW = new Float64Array(nv * 3), mat = new Uint8Array(nv), local = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const p = [sn.P[i * 3], sn.P[i * 3 + 1], sn.P[i * 3 + 2]];
    local.set(p, i * 3);
    const [wp, wn] = toWorld(p, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
    P.set(wp, i * 3);
    NW.set(wn, i * 3);
    mat[i] = classify ? classify(p) : 0;
  }
  return { P, N: NW, tris: sn.tris, mat, local };
}

/* ---------------------------------------------------------------- gloves */
/**
 * A 10 oz competition glove in the hand frame (u from the wrist towards the knuckles, v dorsal, w towards the
 * thumb). Overall ≈ 28.5 cm from the cuff end to the front of the fist, 11.8 cm across the knuckles, 10 cm deep,
 * a hook-and-loop cuff covered by a 5 cm tape (IBA 45.8.3), a white scoring area over the knuckles, the thumb fixed to
 * the body along its top (IBA 45.8.5).
 */
export function gloveSDF() {
  // Built like the product: a padded fist block (wrapped fist inside), a pronounced knuckle roll, a flat striking face
  // with the white scoring panel, the thumb lying along the radial side and fixed along its top, a palm with the
  // curled-finger bulge, grip hollow and palm seam, a side seam, and a cuff that hugs the wrist: Velcro strap under
  // a 5 cm tape band, bound and stitched edge, a few creases where it meets the hand. Frame: u from the wrist joint
  // towards the knuckles, v dorsal, w towards the thumb.
  const G = KIT.glove;
  const hw = G.knuckleWidth / 2;
  const tN = norm([1, 0.55, 0]);
  const tC = [0.102, 0.0, 0];
  const f = (u, v, w) => {
    const p = [u, v, w];
    // fist block (11.8 cm wide, ~11.6 cm deep at the knuckles)
    let d = sdRoundBox(sub(p, [0.082, -0.004, 0]), [0.062, 0.058, hw], 0.034);
    // knuckle roll across the top of the striking end
    d = smin(d, sdCapsule(p, [0.116, 0.036, -hw + 0.016], [0.116, 0.036, hw - 0.016], 0.026), 0.012);
    // back-of-hand padding
    d = smin(d, sdEllipsoid(sub(p, [0.068, 0.04, 0]), [0.06, 0.024, hw - 0.006]), 0.015);
    // flat striking face
    d = smax(d, u - 0.147, 0.012);
    // palm: the curled fingers' bulge near the front, the grip hollow behind it
    d = smin(d, sdEllipsoid(sub(p, [0.108, -0.046, 0]), [0.036, 0.022, hw - 0.008]), 0.012);
    d = smax(d, -sdEllipsoid(sub(p, [0.046, -0.077, 0.004]), [0.04, 0.02, 0.04]), 0.015);
    // cuff: hugs the wrist, slightly flared at its end, a clear step into the fist
    const cu = [u, v / 0.9, w];
    d = smin(d, sdRoundCone(cu, [-0.104, 0.002, 0], [0.012, 0.0, 0], 0.045, 0.039), 0.018);
    // the opening of the cuff (the forearm enters here)
    const cyl = Math.max(Math.hypot(v / 0.9, w) - 0.034, u + 0.088);
    d = smax(d, -cyl, 0.004);
    // thumb along the side, fixed along its top; a crease under it
    const th = sdRoundCone(p, [0.026, -0.03, hw - 0.012], [0.096, -0.02, hw - 0.003], 0.019, 0.0165);
    d = smin(d, th, 0.008);
    d += 0.0016 * Math.exp(-((th / 0.0022) ** 2)) * smoothstep(0.012, -0.004, v);
    // scoring panel edge: a raised piping bead with a pressed groove behind it
    const pd = dot(sub(p, tC), tN);
    const onTop = smoothstep(-0.05, -0.03, v);
    d -= 0.0009 * Math.exp(-(((pd + 0.0012) / 0.0012) ** 2)) * onTop;
    d += 0.0008 * Math.exp(-(((pd - 0.0018) / 0.0009) ** 2)) * onTop;
    // side seam (little-finger side) and palm seam
    d += 0.0007 * Math.exp(-(((w + hw - 0.004) / 0.0013) ** 2)) * smoothstep(-0.005, 0.02, u);
    d += 0.0007 * Math.exp(-(((v + 0.061) / 0.0013) ** 2)) * smoothstep(0.015, 0.03, u) * (1 - smoothstep(0.13, 0.14, u));
    // Velcro strap under the tape: raised 2 mm over 5 cm, its edges stitched
    const tb = smoothstep(-0.074, -0.071, u) * (1 - smoothstep(-0.024, -0.021, u));
    d -= 0.002 * tb;
    // bound cuff edge (lip) and creases where the cuff meets the hand
    d -= 0.0016 * Math.exp(-(((u + 0.103) / 0.0035) ** 2));
    d += 0.0006 * Math.sin(u * 420 + Math.atan2(v, w) * 2) * Math.exp(-(((u + 0.004) / 0.012) ** 2));
    return d;
  };
  const classify = (p) => {
    const [u, v] = p;
    if (u > -0.073 && u < -0.022) return 2; // 5 cm glove tape over the Velcro (IBA 45.8.3)
    if (dot(sub(p, tC), tN) > 0 && v > -0.035) return 1; // white scoring panel: knuckle face only
    return 0;
  };
  return { f, classify, bounds: [[-0.125, -0.085, -0.085], [0.17, 0.08, 0.1]] };
}

export function buildGlove(body, side, h = 0.0016) {
  const T = bodyTools(body);
  const s = side === "L" ? ".L" : ".R";
  const W = T.bone(`wrist${s}`).head;
  const K = T.bone(`finger3-1${s}`).head;
  const I = T.bone(`finger2-1${s}`).head;
  const Pk = T.bone(`finger5-1${s}`).head;
  const fwd = norm(sub(K, W));
  let lat = sub(I, Pk);
  lat = norm(sub(lat, scl(fwd, dot(lat, fwd))));
  let dors = norm(cross(lat, fwd));
  // dorsal must point away from the palm: the thumb sits palm-side of the index knuckle
  const thumb = T.bone(`finger1-2${s}`).head;
  if (dot(sub(thumb, I), dors) > 0) dors = scl(dors, -1);
  lat = norm(cross(fwd, dors));
  if (dot(sub(thumb, K), lat) < 0) lat = scl(lat, -1);
  // re-orthonormalise (handedness may flip for the right hand: keep the thumb on +w)
  const { f, classify, bounds } = gloveSDF();
  const toWorld = (p, n) => [
    add(add(add(W, scl(fwd, p[0])), scl(dors, p[1])), scl(lat, p[2])),
    norm(add(add(scl(fwd, n[0]), scl(dors, n[1])), scl(lat, n[2]))),
  ];
  // the handedness of (fwd, dors, lat) may be left-handed: then the winding must flip
  const handed = dot(cross(fwd, dors), lat) > 0;
  const m = meshSDF((x, y, z) => f(x, y, z), bounds, h, toWorld, classify);
  if (!handed) m.tris = m.tris.map(([a, b, c]) => [a, c, b]);
  m.bone = `wrist${s}`;
  m.uv = new Float64Array((m.P.length / 3) * 2);
  for (let i = 0; i < m.P.length / 3; i++) {
    const [u, v, w] = [m.local[i * 3], m.local[i * 3 + 1], m.local[i * 3 + 2]];
    m.uv[i * 2] = (Math.atan2(w, v) / (2 * Math.PI) + 0.5) * 0.33;
    m.uv[i * 2 + 1] = u;
  }
  m.frame = { W, fwd, dors, lat };
  return m;
}

/* ---------------------------------------------------------------- headgear */
export function buildHeadgear(body, L, h = 0.0022) {
  const T = bodyTools(body);
  const HG = KIT.headgear;
  const headRe = /^(head|jaw|eye|neck0[23]|special|tongue|oris|orbic|oculi|levator|temporalis|risorius)/;
  const keep = (i) => body.P[i * 3 + 1] > L.chinY - 0.16;
  const B = bodyBVH(body, keep);
  const C = L.headC;
  const eyeY = L.eyeY;
  const browY = eyeY + 0.032;
  const mouthY = L.mouthY;
  const chinY = L.chinY;
  const earY = eyeY - 0.012;
  const deg = Math.PI / 180;
  const thick = (az, y) => {
    const a = Math.abs(az);
    let t = HG.crown;
    t = lerp(t, HG.back, smoothstep(100 * deg, 150 * deg, a));
    // brow bolster: the thick roll above the brows
    const brow = (1 - smoothstep(40 * deg, 70 * deg, a)) * Math.exp(-(((y - (browY + 0.022)) / 0.022) ** 2));
    t = lerp(t, HG.brow, brow);
    // cheek pads
    const cheek = smoothstep(25 * deg, 45 * deg, a) * (1 - smoothstep(75 * deg, 95 * deg, a)) * smoothstep(eyeY + 0.01, eyeY - 0.03, y);
    t = lerp(t, HG.cheek, cheek);
    // ear cups
    const ear = Math.exp(-(((a - 90 * deg) / (22 * deg)) ** 2)) * Math.exp(-(((y - earY) / 0.04) ** 2));
    t = lerp(t, HG.ear, ear);
    // velcro strap across the back of the head
    const strap = smoothstep(150 * deg, 160 * deg, a) * Math.exp(-(((y - (eyeY - 0.02)) / 0.015) ** 4));
    t += 0.004 * strap;
    return t;
  };
  const sdf = (x0, y, z) => {
    // the head is symmetric: evaluate on the athlete's left half only
    const x = C[0] + Math.abs(x0 - C[0]);
    const dx = x - C[0], dz = z - C[2];
    const az = Math.atan2(dx, dz);
    const a = Math.abs(az);
    const d = B.sd(x, y, z, 0.07);
    const t = thick(az, y);
    let s = Math.max(HG.gap - d, d - (HG.gap + t));
    // bottom edge: nape at the back, under the ear, cheek pads down to the mouth corners at the front
    const bottomY = lerp(lerp(mouthY - 0.004, chinY + 0.014, smoothstep(55 * deg, 85 * deg, a)), eyeY - 0.055, smoothstep(105 * deg, 150 * deg, a));
    s = smax(s, bottomY - y, 0.008);
    // face opening (open face): superellipse in the front view, brow to below the chin
    if (dz > -0.02) {
      const wo = lerp(0.057, 0.048, smoothstep(eyeY, mouthY - 0.01, y));
      const ex = Math.abs(dx) / wo;
      const ey = (y - (browY - 0.06)) / 0.06; // top of the opening = brow line
      const e = ey > 0 ? (ex ** 3 + ey ** 3) ** (1 / 3) : ex;
      const opening = (e - 1) * 0.05;
      s = smax(s, -opening, 0.007);
    }
    // ear hole
    const earC = [Math.sign(dx) * (Math.abs(L.earX) + 0.02), earY, L.earZ];
    if (a > 60 * deg && a < 120 * deg) {
      const r = Math.hypot(y - earC[1], z - earC[2]);
      s = smax(s, 0.009 - r, 0.003);
      // ear ring seam
      s += 0.0012 * Math.exp(-(((r - 0.032) / 0.0025) ** 2));
    }
    // chin strap: 1.6 cm webbing on the skin along ear bottom → under the chin → ear bottom (a polyline band)
    {
      const P0 = [Math.abs(L.earX) - 0.004, earY - 0.035, L.earZ + 0.005];
      const P1 = [0, chinY - 0.004, L.chinZ - 0.028];
      const segD = (a2, b2) => {
        const ab = [b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]];
        const t = clamp(((x - a2[0]) * ab[0] + (y - a2[1]) * ab[1] + (z - a2[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2), 0, 1);
        return Math.hypot(x - a2[0] - ab[0] * t, y - a2[1] - ab[1] * t, z - a2[2] - ab[2] * t);
      };
      // (x is already mirrored to the left half)
      const band = segD(P0, P1);
      const strap = Math.max(band - 0.008, Math.max(0.0012 - d, d - 0.0042));
      s = smin(s, strap, 0.002);
    }
    // quilted padding: puffed channels between stitch lines on the crown and the back
    {
      const elv = Math.atan2(y - C[1], Math.hypot(dx, dz));
      const crown = smoothstep(browY + 0.05, browY + 0.075, y);
      const ch = Math.abs(Math.sin(az * 5.5));
      s -= 0.0016 * crown * (ch ** 0.5);
      s += 0.0009 * crown * Math.exp(-((ch / 0.08) ** 2));
      // a ring seam round the crown cap
      s += 0.0008 * Math.exp(-(((elv - 0.95) / 0.02) ** 2));
    }
    // stitched seams: brow bolster top edge, cheek pad front edge, crown centre panel
    s += 0.0009 * Math.exp(-(((y - (browY + 0.046)) / 0.0018) ** 2)) * (1 - smoothstep(60 * deg, 80 * deg, a));
    s += 0.0008 * Math.exp(-(((Math.abs(dx) - 0.032) / 0.0016) ** 2)) * smoothstep(browY + 0.05, browY + 0.07, y);
    return s;
  };
  const bounds = [[C[0] - 0.14, chinY - 0.05, C[2] - 0.16], [C[0] + 0.14, L.crownY + 0.06, C[2] + 0.16]];
  const classify = (p) => {
    const dx = p[0] - C[0], dz = p[2] - C[2];
    const a = Math.abs(Math.atan2(dx, dz));
    if (p[1] < L.mouthY - 0.004 && a < 100 * deg && B.sd(p[0], p[1], p[2], 0.02) < 0.006) return 2; // chin strap
    if (a > 150 * deg && Math.abs(p[1] - (eyeY - 0.02)) < 0.018) return 3; // velcro strap
    return 0;
  };
  const m = meshSDF(sdf, bounds, h, (p, n) => [p, n], classify);
  m.bone = "head";
  m.uv = new Float64Array((m.P.length / 3) * 2);
  for (let i = 0; i < m.P.length / 3; i++) {
    const p = [m.P[i * 3] - C[0], m.P[i * 3 + 1] - C[1], m.P[i * 3 + 2] - C[2]];
    m.uv[i * 2] = Math.atan2(p[0], p[2]) / (2 * Math.PI) + 0.5;
    m.uv[i * 2 + 1] = Math.atan2(p[1], Math.hypot(p[0], p[2])) / Math.PI + 0.5;
  }
  return m;
}

/* ---------------------------------------------------------------- boots */
export function buildBoot(body, L, side, h = 0.0024) {
  const T = bodyTools(body);
  const s = side === "L" ? ".L" : ".R";
  const sgn = side === "L" ? 1 : -1;
  const ankle = T.bone(`foot${s}`).head;
  const ball = T.bone(`foot${s}`).tail;
  const knee = T.bone(`lowerleg01${s}`).head;
  const fwd = norm([ball[0] - ankle[0], 0, ball[2] - ankle[2]]);
  const lat = norm(cross([0, 1, 0], fwd));
  const top = KIT.boot.shaft;
  const sole = KIT.boot.sole;
  // the foot and shank as measured from the body: extents along the foot frame, shank radius per height
  let toeU = -1, heelU = 1, halfW = 0, footH = 0;
  const shank = new Map();
  const n = body.P.length / 3;
  const axis = norm(sub(knee, ankle));
  for (let i = 0; i < n; i++) {
    const p = T.V(i);
    if (Math.sign(p[0]) !== sgn || p[1] > top + 0.04) continue;
    if (T.wRe(i, /^(foot|toe|lowerleg)/) < 0.3) continue;
    const q = sub(p, ankle);
    if (p[1] < 0.075) {
      toeU = Math.max(toeU, dot(q, fwd));
      heelU = Math.min(heelU, dot(q, fwd));
      halfW = Math.max(halfW, Math.abs(dot(q, lat)));
    }
    if (p[1] < 0.12 && dot(q, fwd) > 0.03) footH = Math.max(footH, p[1]);
    // shank radius from the lower-leg skin only (the foot's dorsum / heel would flare the shaft into a brim)
    if (p[1] > 0.11 && T.wRe(i, /^lowerleg/) > 0.6) {
      const t = dot(q, axis);
      const r = len(sub(q, scl(axis, t)));
      const k = Math.round(p[1] / 0.01);
      shank.set(k, Math.max(shank.get(k) ?? 0, r));
    }
  }
  const shankAt = (k) => shank.get(clamp(k, 12, Math.round((top + 0.03) / 0.01))) ?? 0.045;
  // smooth (linear between the 1 cm buckets, then a 3-bucket average): no rings on the shaft
  const shankR = (y) => {
    const f = y / 0.01, k = Math.floor(f), t = f - k;
    const at = (q) => (shankAt(q - 1) + shankAt(q) * 2 + shankAt(q + 1)) / 4;
    return at(k) * (1 - t) + at(k + 1) * t;
  };
  const local = (x, y, z) => {
    const q = sub([x, y, z], ankle);
    return [dot(q, fwd), y, dot(q, lat)];
  };
  const footLen = toeU - heelU;
  const sdfNoLace = (x, y, z) => {
    const [u, v, w] = local(x, y, z);
    const q = sub([x, y, z], ankle);
    const t = dot(q, axis);
    const radial = len(sub(q, scl(axis, t)));
    // shaft: the shank's own radius + 7 mm, over the ankle up to the collar
    const yy = clamp(y, 0.07, top);
    const shaft = Math.max(radial - (shankR(yy) + 0.0055), 0.06 - y);
    // last: toe box, mid-foot and heel volumes
    let last = sdEllipsoid([u - (toeU - 0.06), v - 0.033, w], [0.078, 0.036, halfW + 0.006]);
    last = smin(last, sdEllipsoid([u - (heelU + footLen * 0.45), v - 0.045, w], [footLen * 0.4, Math.max(0.05, footH * 0.75), halfW + 0.004]), 0.03);
    last = smin(last, sdEllipsoid([u - (heelU + 0.043), v - 0.045, w * 1.05], [0.044, 0.048, 0.037]), 0.02);
    let d = smin(last, shaft, 0.02);
    // sole slab with toe spring
    const vs = v - Math.max(0, u - toeU + 0.045) * 0.3;
    const slab = Math.max(vs - (sole - 0.004), -0.004 - vs);
    const ss = Math.max(slab, Math.min(last, shaft) - 0.0035);
    d = smin(d, ss, 0.003);
    d -= 0.0028 * Math.exp(-(((v - (top - 0.012)) / 0.008) ** 2));
    d = smax(d, v - top, 0.006);
    d = smax(d, -0.004 - v, 0.002);
    return d;
  };
  const laces = [];
  const worldOf = (u, v, w) => [ankle[0] + fwd[0] * u + lat[0] * w, v, ankle[2] + fwd[2] * u + lat[2] * w];
  for (let k = 0; k < 9; k++) {
    const v = 0.06 + (k / 8) * (top - 0.08);
    let u = 0.25;
    while (u > -0.1 && sdfNoLace(...worldOf(u, v, 0)) > 0) u -= 0.0015;
    laces.push([u + 0.0012, v]);
  }
  const laceSdf = (u, v, w) => {
    let d = 1;
    for (let k = 0; k < laces.length - 1; k++) {
      const [u0, v0] = laces[k], [u1, v1] = laces[k + 1];
      const hw = 0.012;
      d = Math.min(d, sdCapsule([u, v, w], [u0, v0, -hw], [u1, v1, hw], 0.0022), sdCapsule([u, v, w], [u0, v0, hw], [u1, v1, -hw], 0.0022));
    }
    return d;
  };
  const sdf = (x, y, z) => {
    const [u, v, w] = local(x, y, z);
    let d = sdfNoLace(x, y, z);
    d += 0.0012 * Math.exp(-(((Math.abs(w) - 0.017) / 0.002) ** 2)) * smoothstep(0.05, 0.07, v) * (u > 0 ? 1 : 0);
    return Math.min(d, laceSdf(u, v, w));
  };
  const lo = worldOf(heelU - 0.03, 0, 0), hi = worldOf(toeU + 0.03, 0, 0);
  const bounds = [
    [Math.min(lo[0], hi[0]) - 0.09, -0.008, Math.min(lo[2], hi[2]) - 0.09],
    [Math.max(lo[0], hi[0]) + 0.09, top + 0.01, Math.max(lo[2], hi[2]) + 0.09],
  ];
  const classify = (p) => {
    const [u, v, w] = local(p[0], p[1], p[2]);
    if (laceSdf(u, v, w) < 0.0015) return 2;
    if (v < sole + 0.002) return 1;
    return 0;
  };
  const m = meshSDF(sdf, bounds, h, (p, nn) => [p, nn], classify);
  m.uv = new Float64Array((m.P.length / 3) * 2);
  // skin: the foot below the ankle, the shank above it (smooth blend)
  const footB = body.boneIndex.get(`foot${s}`), shinB = body.boneIndex.get(`lowerleg02${s}`), toeB = body.boneIndex.get(`toe3-1${s}`);
  m.skin = [];
  let outside = 0, tested = 0;
  for (let i = 0; i < m.P.length / 3; i++) {
    const [u, v, w] = local(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]);
    m.uv[i * 2] = Math.atan2(w, u) / (2 * Math.PI) + 0.5;
    m.uv[i * 2 + 1] = v;
    const k = smoothstep(0.07, 0.13, v);
    // the forefoot bends with the toes (the boot flexes at the ball when the heel comes up)
    const ballU = dot(sub(ball, ankle), fwd);
    const kt = smoothstep(ballU - 0.015, ballU + 0.02, u) * (1 - k);
    m.skin.push(new Map([[footB, (1 - k) * (1 - kt)], [toeB, kt], [shinB, k]].filter(([, x]) => x > 0)));
  }
  // coverage audit: body foot vertices that poke out of the boot
  for (let i = 0; i < n; i++) {
    const p = T.V(i);
    if (Math.sign(p[0]) !== sgn || p[1] > top - 0.03 || T.wRe(i, /^(foot|toe|lowerleg)/) < 0.3) continue;
    tested++;
    if (sdfNoLace(p[0], p[1], p[2]) > -0.001) outside++;
  }
  m.coverage = { tested, outside };
  return m;
}


/* ---------------------------------------------------------------- hand wraps (close-up sheet) */
export function buildWraps(body, side) {
  const T = bodyTools(body);
  const s = side === "L" ? ".L" : ".R";
  const W = T.bone(`wrist${s}`).head;
  const E = T.bone(`lowerarm01${s}`).head;
  const ax = norm(sub(W, E));
  const field = (i) => {
    const p = T.V(i);
    const hand = T.wRe(i, new RegExp(`^(wrist|metacarpal|finger[1-5]-1)\\${s}$`));
    const dist = T.wRe(i, new RegExp(`^finger[1-5]-[23]\\${s}$`));
    const fore = dot(sub(p, W), ax); // < 0 up the forearm
    if (Math.sign(p[0]) !== (side === "L" ? 1 : -1)) return -1;
    return Math.min(hand + Math.max(0, 1 - Math.abs(fore + 0.025) / 0.04) - 0.45, 0.4 - dist);
  };
  const piece = cutPiece(body, field);
  const N = vertexNormals(piece.P, piece.tris);
  for (let v = 0; v < piece.P.length / 3; v++) for (let k = 0; k < 3; k++) piece.P[v * 3 + k] += N[v * 3 + k] * 0.0028;
  const sol = solidify(piece.P, piece.tris, 0.0015, { rimSteps: 3, bead: 0.0008 });
  const nv = sol.P.length / 3;
  const uv = new Float64Array(nv * 2);
  const u0 = norm(cross(ax, [0, 1, 0]));
  const v0 = cross(ax, u0);
  for (let i = 0; i < nv; i++) {
    const p = sub([sol.P[i * 3], sol.P[i * 3 + 1], sol.P[i * 3 + 2]], W);
    uv[i * 2] = Math.atan2(dot(p, v0), dot(p, u0)) / (2 * Math.PI) + 0.5;
    uv[i * 2 + 1] = dot(p, ax);
  }
  return { P: sol.P, N: vertexNormals(sol.P, sol.tris, nv), tris: sol.tris, uv, skin: Array.from(sol.src, (k) => piece.skin[k]) };
}
