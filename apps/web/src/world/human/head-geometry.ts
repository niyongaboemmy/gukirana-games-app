import * as THREE from "three";

/**
 * Load-time clean-up of the low-poly Rocketbox heads (P2-AVA-08): ~1.4k triangles per head, with split vertices at
 * UV seams and a few hard normal splits that showed as facets on cheeks, jaw and nose.
 *
 *  - smoothHeadNormals: angle-weighted vertex normals over the welded surface (seam duplicates share one normal, so
 *    no seam lines), creases kept where the authored normals disagree by more than `crease` (eyelid rims, lips folding
 *    into the mouth, nostrils), open borders (the neck seam to the body mesh) keep their authored normal.
 *  - tessellateHead: one level of Phong tessellation (each triangle → 4; original vertices stay exactly where they
 *    were, edge midpoints bulge onto the surface the normals describe), so the silhouette of cheeks, jaw, eyeballs and
 *    nose is round instead of polygonal. Skin weights of the new vertices are the mean of the two edge ends (top four
 *    bones), UVs the midpoint, so the head still follows every bone (blinks, jaw, face shape).
 * Both run once per base model (results are shared by every person with that body); no per-frame work.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Weld key per vertex: indices of vertices sharing a position (UV seams split them). Returns the group id per vertex. */
export function weldGroups(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, eps = 1e-5): Int32Array {
  const map = new Map<string, number>();
  const out = new Int32Array(pos.count);
  const inv = 1 / eps;
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * inv)},${Math.round(pos.getY(i) * inv)},${Math.round(pos.getZ(i) * inv)}`;
    let g = map.get(k);
    if (g === undefined) {
      g = map.size;
      map.set(k, g);
    }
    out[i] = g;
  }
  return out;
}

function indexOf(geo: THREE.BufferGeometry): ArrayLike<number> {
  if (geo.index) return geo.index.array;
  const a = new Uint32Array(geo.attributes.position!.count);
  for (let i = 0; i < a.length; i++) a[i] = i;
  return a;
}

/** Edges used by exactly one triangle (welded topology): the open border of the mesh. Returns a flag per weld group. */
function borderGroups(idx: ArrayLike<number>, weld: Int32Array, groups: number): Uint8Array {
  const count = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * groups + b : b * groups + a);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = weld[idx[t + e]!]!;
      const b = weld[idx[t + ((e + 1) % 3)]!]!;
      if (a === b) continue;
      const k = key(a, b);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const border = new Uint8Array(groups);
  for (const [k, c] of count) {
    if (c !== 1) continue;
    border[Math.floor(k / groups)] = 1;
    border[k % groups] = 1;
  }
  return border;
}

/**
 * Angle-weighted smooth normals over the welded surface, in place. A triangle contributes to a vertex only if its face
 * normal is within `crease` (rad) of that vertex's authored normal, so authored hard creases survive; border vertices
 * keep their authored normal (no seam against the body mesh). Returns how many vertex normals changed by > 5°.
 */
export function smoothHeadNormals(geo: THREE.BufferGeometry, crease = THREE.MathUtils.degToRad(62)): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  if (!pos || !nrm) return 0;
  const idx = indexOf(geo);
  const weld = weldGroups(pos);
  let groups = 0;
  for (let i = 0; i < weld.length; i++) groups = Math.max(groups, weld[i]! + 1);
  const border = borderGroups(idx, weld, groups);
  // per triangle: unit face normal and corner angles
  const tris = idx.length / 3;
  const fn = new Float32Array(tris * 3);
  const ang = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const ia = idx[t * 3]!,
      ib = idx[t * 3 + 1]!,
      ic = idx[t * 3 + 2]!;
    _a.fromBufferAttribute(pos, ia);
    _b.fromBufferAttribute(pos, ib);
    _c.fromBufferAttribute(pos, ic);
    const ab = _b.clone().sub(_a),
      ac = _c.clone().sub(_a),
      bc = _c.clone().sub(_b);
    _n.crossVectors(ab, ac);
    const len = _n.length();
    if (len < 1e-12) continue;
    _n.divideScalar(len);
    fn.set([_n.x, _n.y, _n.z], t * 3);
    ang[t * 3] = ab.angleTo(ac);
    ang[t * 3 + 1] = ab.clone().negate().angleTo(bc);
    ang[t * 3 + 2] = Math.max(0, Math.PI - ang[t * 3]! - ang[t * 3 + 1]!);
  }
  // triangles touching each weld group (with the corner they touch it at)
  const touch: number[][] = Array.from({ length: groups }, () => []);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) touch[weld[idx[t * 3 + k]!]!]!.push(t * 3 + k);
  const cosCrease = Math.cos(crease);
  const out = new Float32Array(pos.count * 3);
  let changed = 0;
  const auth = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    auth.fromBufferAttribute(nrm, i).normalize();
    const g = weld[i]!;
    sum.set(0, 0, 0);
    if (!border[g]) {
      for (const corner of touch[g]!) {
        const t = Math.floor(corner / 3);
        const fx = fn[t * 3]!,
          fy = fn[t * 3 + 1]!,
          fz = fn[t * 3 + 2]!;
        if (fx * auth.x + fy * auth.y + fz * auth.z < cosCrease) continue;
        const w = ang[corner]!;
        sum.x += fx * w;
        sum.y += fy * w;
        sum.z += fz * w;
      }
    }
    if (sum.lengthSq() < 1e-12) sum.copy(auth);
    else sum.normalize();
    if (sum.dot(auth) < Math.cos(THREE.MathUtils.degToRad(5))) changed++;
    out[i * 3] = sum.x;
    out[i * 3 + 1] = sum.y;
    out[i * 3 + 2] = sum.z;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  return changed;
}

/** Top-4 bone weights of the mean of two vertices' skin weights. */
function mixSkin(si: THREE.BufferAttribute, sw: THREE.BufferAttribute, a: number, b: number, outI: number[], outW: number[]) {
  const acc = new Map<number, number>();
  for (const v of [a, b])
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w <= 0) continue;
      const j = si.getComponent(v, k);
      acc.set(j, (acc.get(j) ?? 0) + w * 0.5);
    }
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const total = top.reduce((s, [, w]) => s + w, 0) || 1;
  for (let k = 0; k < 4; k++) {
    outI[k] = top[k]?.[0] ?? 0;
    outW[k] = (top[k]?.[1] ?? 0) / total;
  }
}

/**
 * One level of Phong tessellation of an indexed, skinned head geometry (returns a new geometry; the input is not
 * changed). `alpha` = how far edge midpoints move onto the tangent planes of their ends (0 = flat split, 0.75 = full
 * Phong). Midpoint positions use welded positions and the mean normal of the weld group, so the two sides of a UV
 * seam get the same new position (no cracks); edges whose ends' normals differ by more than ~60° stay straight
 * (creases: lip line, eyelid rims).
 */
export function tessellateHead(src: THREE.BufferGeometry, alpha = 0.6): THREE.BufferGeometry {
  const pos = src.attributes.position as THREE.BufferAttribute;
  const nrm = src.attributes.normal as THREE.BufferAttribute;
  const uv = src.attributes.uv as THREE.BufferAttribute | undefined;
  const si = src.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const sw = src.attributes.skinWeight as THREE.BufferAttribute | undefined;
  const idx = indexOf(src);
  const weld = weldGroups(pos);
  let groups = 0;
  for (let i = 0; i < weld.length; i++) groups = Math.max(groups, weld[i]! + 1);
  // mean normal per weld group (position displacement only; shading keeps each vertex's own normal)
  const gn = new Float32Array(groups * 3);
  for (let i = 0; i < pos.count; i++) {
    const g = weld[i]!;
    gn[g * 3] = gn[g * 3]! + nrm.getX(i);
    gn[g * 3 + 1] = gn[g * 3 + 1]! + nrm.getY(i);
    gn[g * 3 + 2] = gn[g * 3 + 2]! + nrm.getZ(i);
  }
  for (let g = 0; g < groups; g++) {
    _n.set(gn[g * 3]!, gn[g * 3 + 1]!, gn[g * 3 + 2]!).normalize();
    gn.set([_n.x, _n.y, _n.z], g * 3);
  }
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const SI: number[] = [];
  const SW: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    N.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (uv) U.push(uv.getX(i), uv.getY(i));
    if (si && sw)
      for (let k = 0; k < 4; k++) {
        SI.push(si.getComponent(i, k));
        SW.push(sw.getComponent(i, k));
      }
  }
  const mid = new Map<number, number>();
  const pa = new THREE.Vector3(),
    pb = new THREE.Vector3(),
    na = new THREE.Vector3(),
    nb = new THREE.Vector3(),
    m = new THREE.Vector3(),
    qa = new THREE.Vector3(),
    qb = new THREE.Vector3();
  const tmpI = [0, 0, 0, 0],
    tmpW = [0, 0, 0, 0];
  const midpoint = (a: number, b: number): number => {
    const k = a < b ? a * pos.count + b : b * pos.count + a;
    const hit = mid.get(k);
    if (hit !== undefined) return hit;
    pa.fromBufferAttribute(pos, a);
    pb.fromBufferAttribute(pos, b);
    const ga = weld[a]!,
      gb = weld[b]!;
    na.set(gn[ga * 3]!, gn[ga * 3 + 1]!, gn[ga * 3 + 2]!);
    nb.set(gn[gb * 3]!, gn[gb * 3 + 1]!, gn[gb * 3 + 2]!);
    m.copy(pa).add(pb).multiplyScalar(0.5);
    if (na.dot(nb) > 0.5) {
      // Phong: project the midpoint onto both ends' tangent planes and blend
      qa.copy(m).addScaledVector(na, -m.clone().sub(pa).dot(na));
      qb.copy(m).addScaledVector(nb, -m.clone().sub(pb).dot(nb));
      m.multiplyScalar(1 - alpha).addScaledVector(qa.add(qb), alpha * 0.5);
    }
    const id = P.length / 3;
    P.push(m.x, m.y, m.z);
    _n.set(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    N.push(_n.x, _n.y, _n.z);
    if (uv) U.push((uv.getX(a) + uv.getX(b)) / 2, (uv.getY(a) + uv.getY(b)) / 2);
    if (si && sw) {
      mixSkin(si, sw, a, b, tmpI, tmpW);
      for (let k = 0; k < 4; k++) {
        SI.push(tmpI[k]!);
        SW.push(tmpW[k]!);
      }
    }
    mid.set(k, id);
    return id;
  };
  const I: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!,
      b = idx[t + 1]!,
      c = idx[t + 2]!;
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      ca = midpoint(c, a);
    I.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  if (uv) out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  if (si && sw) {
    out.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(SI, 4));
    out.setAttribute("skinWeight", new THREE.Float32BufferAttribute(SW, 4));
  }
  out.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  out.name = `${src.name || "head"}-tess`;
  return out;
}
