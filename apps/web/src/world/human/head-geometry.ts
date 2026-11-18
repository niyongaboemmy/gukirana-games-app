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
export function smoothHeadNormals(
  geo: THREE.BufferGeometry,
  crease = THREE.MathUtils.degToRad(62),
  seamAgree = 0,
): number {
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
  // P2-AVA-15 (`seamAgree` > 0): duplicates of one welded position whose authored normals roughly agree (a soft split
  // the base mesh carries across the cheek / jaw, not a real fold) test their triangles against their shared mean
  // normal, so both sides of the split get the very same smooth normal (the split showed as a hard-edged light patch
  // from the nose to the temple and on the jaw). Real creases (lips into the mouth, eyelid rims) disagree by more.
  const gmean = new Float32Array(groups * 3);
  const gok = new Uint8Array(groups).fill(1);
  if (seamAgree > 0) {
    for (let i = 0; i < pos.count; i++) {
      const g = weld[i]!;
      _n.fromBufferAttribute(nrm, i).normalize();
      gmean[g * 3] = gmean[g * 3]! + _n.x;
      gmean[g * 3 + 1] = gmean[g * 3 + 1]! + _n.y;
      gmean[g * 3 + 2] = gmean[g * 3 + 2]! + _n.z;
    }
    for (let g = 0; g < groups; g++) {
      _n.set(gmean[g * 3]!, gmean[g * 3 + 1]!, gmean[g * 3 + 2]!).normalize();
      gmean.set([_n.x, _n.y, _n.z], g * 3);
    }
    const cosAgree = Math.cos(seamAgree);
    for (let i = 0; i < pos.count; i++) {
      const g = weld[i]!;
      _n.fromBufferAttribute(nrm, i).normalize();
      if (_n.x * gmean[g * 3]! + _n.y * gmean[g * 3 + 1]! + _n.z * gmean[g * 3 + 2]! < cosAgree) gok[g] = 0;
    }
  }
  const out = new Float32Array(pos.count * 3);
  let changed = 0;
  const auth = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    auth.fromBufferAttribute(nrm, i).normalize();
    const g = weld[i]!;
    const ref = seamAgree > 0 && gok[g] ? _c.set(gmean[g * 3]!, gmean[g * 3 + 1]!, gmean[g * 3 + 2]!) : auth;
    sum.set(0, 0, 0);
    if (!border[g]) {
      for (const corner of touch[g]!) {
        const t = Math.floor(corner / 3);
        const fx = fn[t * 3]!,
          fy = fn[t * 3 + 1]!,
          fz = fn[t * 3 + 2]!;
        if (fx * ref.x + fy * ref.y + fz * ref.z < cosCrease) continue;
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

/**
 * P2-AVA-15: relax (diffuse) the vertex normals over the welded surface, in place: each pass moves every normal
 * towards the mean of its edge neighbours' normals that lie within `maxAngle` of it (creases such as the lip line and
 * the eyelid rims, more than `maxAngle` apart, never blend), open-border vertices stay. On the low-poly heads the
 * lighting otherwise turned direction at every original triangle edge: large triangular light / dark patches on the
 * cheeks, beside the nose and on the jaw. Returns the mean change (rad) of the last pass.
 */
export function relaxNormals(geo: THREE.BufferGeometry, passes = 3, maxAngle = THREE.MathUtils.degToRad(40), k = 0.6): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  if (!pos || !nrm || passes <= 0) return 0;
  const idx = indexOf(geo);
  const weld = weldGroups(pos);
  let groups = 0;
  for (let i = 0; i < weld.length; i++) groups = Math.max(groups, weld[i]! + 1);
  const border = borderGroups(idx, weld, groups);
  // welded edge adjacency
  const adj: Set<number>[] = Array.from({ length: groups }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = weld[idx[t + e]!]!,
        b = weld[idx[t + ((e + 1) % 3)]!]!;
      if (a === b) continue;
      adj[a]!.add(b);
      adj[b]!.add(a);
    }
  // per vertex (not per group): seam duplicates on a real crease keep their own sides
  const byGroup: number[][] = Array.from({ length: groups }, () => []);
  for (let i = 0; i < pos.count; i++) byGroup[weld[i]!]!.push(i);
  const cosMax = Math.cos(maxAngle);
  let cur = new Float32Array(nrm.array as ArrayLike<number>);
  let change = 0;
  const own = new THREE.Vector3(),
    sum = new THREE.Vector3(),
    o = new THREE.Vector3();
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(cur);
    change = 0;
    for (let i = 0; i < pos.count; i++) {
      const g = weld[i]!;
      if (border[g]) continue;
      own.fromArray(cur, i * 3).normalize();
      sum.set(0, 0, 0);
      let n = 0;
      for (const h of adj[g]!)
        for (const j of byGroup[h]!) {
          o.fromArray(cur, j * 3).normalize();
          if (o.dot(own) < cosMax) continue;
          sum.add(o);
          n++;
        }
      if (!n) continue;
      sum.divideScalar(n).normalize();
      o.copy(own).lerp(sum, k).normalize();
      change += o.angleTo(own);
      next.set([o.x, o.y, o.z], i * 3);
    }
    cur = next;
    change /= pos.count;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(cur, 3));
  return change;
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

/**
 * Relaxed mouth for the masculine base head (P2-AVA-11): its photo-scanned lips are pushed forward in a pout that the
 * few-vertex lip bones cannot take back. Once per base geometry (bind pose, before normals / tessellation), the
 * depth of the lower lip in front of a base plane shrinks by `lower` and the upper lip by `upper` (shares), with soft
 * falloffs, so the mouth rests closed and relaxed. A pure function of each vertex position (welded seams stay
 * welded); idempotent per geometry. Returns the number of moved vertices.
 */
export function relaxMouth(
  geo: THREE.BufferGeometry,
  frame: { o: THREE.Vector3; R: THREE.Matrix3; Rt: THREE.Matrix3 },
  midY: number,
  lower = 0.55,
  upper = 0.4,
): number {
  if (geo.userData.gkMouthRelaxed) return 0;
  geo.userData.gkMouthRelaxed = true;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const f = new THREE.Vector3();
  const ss = THREE.MathUtils.smoothstep;
  // the front-most lip surface (face z) near the mouth
  let zFront = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    f.fromBufferAttribute(pos, i).sub(frame.o).applyMatrix3(frame.R);
    if (Math.abs(f.x) < 0.02 && Math.abs(f.y - midY) < 0.02) zFront = Math.max(zFront, f.z);
  }
  if (!Number.isFinite(zFront)) return 0;
  let moved = 0;
  // the lips' depth in front of a base plane ~12 mm behind the front-most point is compressed (the scan's lips stand
  // ~6–8 mm proud of the philtrum / chin line); points at or behind the plane (philtrum root, mouth corners, the
  // inside of the mouth, teeth) do not move
  const zB = zFront - 0.012;
  for (let i = 0; i < pos.count; i++) {
    f.fromBufferAttribute(pos, i).sub(frame.o).applyMatrix3(frame.R);
    if (f.z <= zB) continue;
    const wx = 1 - ss(Math.abs(f.x), 0.022, 0.034);
    const dy = f.y - midY;
    // lower lip (down to the chin crease) and upper lip (up to under the nose)
    const wl = ss(dy, -0.015, -0.009) * (1 - ss(dy, -0.001, 0.003));
    const wu = ss(dy, -0.003, 0.001) * (1 - ss(dy, 0.015, 0.022));
    const k = Math.max(wl * lower, wu * upper) * wx;
    if (k <= 1e-4) continue;
    f.z = zB + (f.z - zB) * (1 - k);
    f.applyMatrix3(frame.Rt).add(frame.o);
    pos.setXYZ(i, f.x, f.y, f.z);
    moved++;
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  return moved;
}
