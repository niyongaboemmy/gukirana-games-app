import * as THREE from "three";
import { weldGroups } from "./head-geometry";

/**
 * P2-AVA-16: real geometry for holes a load-time clean-up leaves in a base head (the neutral body's removed baked cap
 * brim left a thin open crescent between the forehead skin and the old cap crown: the sky showed through it as a pale
 * arc across the forehead from every angle).
 *
 *  - borderLoops: the open borders of the welded surface as ordered loops (one vertex index per welded position, the
 *    index the border triangle itself uses, so its UV is the one on that side of a UV seam).
 *  - fillStripHole: bridges one thin loop with a strip of triangles. The loop is split at its two farthest-apart
 *    points into two rims and zipped together (shorter diagonal first). The strip gets its own vertices: on the skin
 *    rim they copy the skin vertices (same UV, skin weights, normal, so the strip shares their smooth normals once the
 *    head normals are rebuilt); on the other rim (old cap crown: hair) the UV continues the skin island's own 3D → UV
 *    mapping out to that rim, so the strip carries the forehead's skin texture up to the hair instead of a smear
 *    across two texture islands. Triangles face the same way as the surface around them.
 * Pure functions of the geometry (no per-frame work); the result is shared by everyone with that base head.
 */

export interface BorderLoop {
  /** vertex indices round the loop (one per welded position) */
  verts: number[];
}

/** Open border loops of the welded surface (edges used by exactly one triangle). */
export function borderLoops(geo: THREE.BufferGeometry): BorderLoop[] {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const weld = weldGroups(pos);
  let groups = 0;
  for (let i = 0; i < weld.length; i++) groups = Math.max(groups, weld[i]! + 1);
  const key = (a: number, b: number) => (a < b ? a * groups + b : b * groups + a);
  const count = new Map<number, number>();
  // directed border edge (as the triangle runs it) → the vertex indices it uses
  const dir = new Map<number, [number, number]>();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const va = idx[t + e]!,
        vb = idx[t + ((e + 1) % 3)]!;
      const a = weld[va]!,
        b = weld[vb]!;
      if (a === b) continue;
      const k = key(a, b);
      count.set(k, (count.get(k) ?? 0) + 1);
      dir.set(k, [va, vb]);
    }
  // next[groupA] = vertex index of the edge's start and the group it leads to (the triangle's winding)
  const next = new Map<number, { from: number; to: number }>();
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const [va, vb] = dir.get(k)!;
    next.set(weld[va]!, { from: va, to: weld[vb]! });
  }
  const seen = new Set<number>();
  const loops: BorderLoop[] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const verts: number[] = [];
    let g: number | undefined = start;
    while (g !== undefined && !seen.has(g)) {
      seen.add(g);
      const n = next.get(g);
      if (!n) break;
      verts.push(n.from);
      g = n.to;
    }
    if (verts.length >= 3) loops.push({ verts });
  }
  return loops;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** 3D → UV linear map (2×3, row-major) of the triangles round vertex `v`, least squares per triangle, averaged. */
function uvJacobian(geo: THREE.BufferGeometry, v: number, tris: number[]): number[] | null {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const idx = geo.index!.array;
  const J: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  let n = 0;
  for (const t of tris) {
    const i0 = idx[t]!,
      i1 = idx[t + 1]!,
      i2 = idx[t + 2]!;
    if (i0 !== v && i1 !== v && i2 !== v) continue;
    _a.fromBufferAttribute(pos, i0);
    const e1 = _b.fromBufferAttribute(pos, i1).sub(_a);
    const e2 = _c.fromBufferAttribute(pos, i2).sub(_a);
    const du1 = uv.getX(i1) - uv.getX(i0),
      dv1 = uv.getY(i1) - uv.getY(i0);
    const du2 = uv.getX(i2) - uv.getX(i0),
      dv2 = uv.getY(i2) - uv.getY(i0);
    // pinv([e1 e2]) = (EᵀE)⁻¹ Eᵀ
    const a = e1.dot(e1),
      b = e1.dot(e2),
      d = e2.dot(e2);
    const det = a * d - b * b;
    if (det < 1e-14) continue;
    // rows of the pseudo-inverse
    const r1 = e1
      .clone()
      .multiplyScalar(d / det)
      .addScaledVector(e2, -b / det);
    const r2 = e2
      .clone()
      .multiplyScalar(a / det)
      .addScaledVector(e1, -b / det);
    J[0] += du1 * r1.x + du2 * r2.x;
    J[1] += du1 * r1.y + du2 * r2.y;
    J[2] += du1 * r1.z + du2 * r2.z;
    J[3] += dv1 * r1.x + dv2 * r2.x;
    J[4] += dv1 * r1.y + dv2 * r2.y;
    J[5] += dv1 * r1.z + dv2 * r2.z;
    n++;
  }
  return n ? J.map((x) => x / n) : null;
}

/**
 * Bridge a thin border loop with real triangles (in place, appended to the geometry). `skin(u, v)` says whether a UV
 * is on the side whose texture the strip continues (the forehead). Returns the number of triangles added.
 */
export function fillStripHole(
  geo: THREE.BufferGeometry,
  loop: BorderLoop,
  skin: (u: number, v: number) => boolean,
  reach = 1,
): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const L = loop.verts;
  const n = L.length;
  if (n < 4 || !geo.index || !uv) return 0;
  // the two rims: split at the farthest-apart pair
  let e1 = 0,
    e2 = 1,
    best = -1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = _a.fromBufferAttribute(pos, L[i]!).distanceToSquared(_b.fromBufferAttribute(pos, L[j]!));
      if (d > best) {
        best = d;
        e1 = i;
        e2 = j;
      }
    }
  const rimA: number[] = [];
  for (let i = e1; ; i = (i + 1) % n) {
    rimA.push(L[i]!);
    if (i === e2) break;
  }
  const rimB: number[] = [];
  for (let i = e1; ; i = (i - 1 + n) % n) {
    rimB.push(L[i]!);
    if (i === e2) break;
  }
  const skinShare = (r: number[]) => r.filter((v) => skin(uv.getX(v), uv.getY(v))).length / r.length;
  const skinRim = skinShare(rimA) >= skinShare(rimB) ? rimA : rimB;
  const otherRim = skinRim === rimA ? rimB : rimA;
  // triangles touching each skin-rim vertex, wholly on the skin side (for the local UV mapping)
  const idx = geo.index.array;
  const touching = new Map<number, number[]>();
  const skinSet = new Set(skinRim);
  for (let t = 0; t < idx.length; t += 3) {
    if (![0, 1, 2].every((k) => skin(uv.getX(idx[t + k]!), uv.getY(idx[t + k]!)))) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k]!;
      if (skinSet.has(v)) (touching.get(v) ?? touching.set(v, []).get(v)!).push(t);
    }
  }
  const jac = new Map<number, number[] | null>();
  for (const v of skinRim) jac.set(v, uvJacobian(geo, v, touching.get(v) ?? []));
  // new strip vertices: [source vertex, u, v]
  const verts: [number, number, number][] = [];
  // UV of a strip vertex at `v`: its own on the skin side, else the skin island's mapping continued out to it from the
  // nearest skin-side rim vertex
  const onSkin = skinRim.filter((c) => skin(uv.getX(c), uv.getY(c)));
  const src = onSkin.length ? onSkin : skinRim;
  const uvAt = (v: number, own: boolean): [number, number] => {
    if (own && skin(uv.getX(v), uv.getY(v))) return [uv.getX(v), uv.getY(v)];
    _a.fromBufferAttribute(pos, v);
    let s = src[0]!,
      sd = Infinity;
    for (const c of src) {
      const d = _a.distanceToSquared(_b.fromBufferAttribute(pos, c));
      if (d < sd) {
        sd = d;
        s = c;
      }
    }
    const J = jac.get(s);
    const dp = _a.clone().sub(_b.fromBufferAttribute(pos, s));
    return [
      uv.getX(s) + (J ? J[0]! * dp.x + J[1]! * dp.y + J[2]! * dp.z : 0) * reach,
      uv.getY(s) + (J ? J[3]! * dp.x + J[4]! * dp.y + J[5]! * dp.z : 0) * reach,
    ];
  };
  const skinNew = skinRim.map((v) => verts.push([v, ...uvAt(v, true)]) - 1);
  const otherNew = otherRim.map((v, i) => {
    // the rim ends are the skin rim's ends
    if (i === 0) return skinNew[0]!;
    if (i === otherRim.length - 1) return skinNew[skinNew.length - 1]!;
    return verts.push([v, ...uvAt(v, false)]) - 1;
  });
  // zip the rims (both run end 1 → end 2)
  const P = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, verts[k]![0]);
  const tris: [number, number, number][] = [];
  let i = 0,
    j = 0;
  const A = skinNew,
    B = otherNew;
  while (i < A.length - 1 || j < B.length - 1) {
    let advanceA: boolean;
    if (i === A.length - 1) advanceA = false;
    else if (j === B.length - 1) advanceA = true;
    else advanceA = P(A[i + 1]!).distanceToSquared(P(B[j]!)) <= P(A[i]!).distanceToSquared(P(B[j + 1]!));
    if (advanceA) {
      tris.push([A[i]!, B[j]!, A[i + 1]!]);
      i++;
    } else {
      tris.push([A[i]!, B[j]!, B[j + 1]!]);
      j++;
    }
  }
  // append
  const base = pos.count;
  const extra = verts.length;
  const grow = (name: string) => {
    const at = geo.attributes[name] as THREE.BufferAttribute;
    const size = at.itemSize;
    const Arr = (at.array as unknown as { constructor: new (n: number) => THREE.TypedArray }).constructor;
    const out = new Arr((base + extra) * size);
    for (let v = 0; v < base; v++) for (let c = 0; c < size; c++) out[v * size + c] = at.getComponent(v, c);
    verts.forEach(([src], k) => {
      for (let c = 0; c < size; c++) out[(base + k) * size + c] = at.getComponent(src, c);
    });
    const na = new THREE.BufferAttribute(out, size, at.normalized);
    geo.setAttribute(name, na);
    return na;
  };
  for (const name of Object.keys(geo.attributes)) grow(name);
  const uvo = geo.attributes.uv as THREE.BufferAttribute;
  verts.forEach(([, u, w], k) => uvo.setXY(base + k, u, w));
  const I = Array.from(idx);
  let added = 0;
  const fn = new THREE.Vector3();
  const vn = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    const pa = P(a),
      pb = P(b),
      pc = P(c);
    fn.crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    if (a === b || b === c || a === c || fn.lengthSq() < 1e-24) continue;
    vn.set(0, 0, 0);
    for (const k of [a, b, c]) vn.add(_a.fromBufferAttribute(nrm, verts[k]![0]));
    if (fn.dot(vn) >= 0) I.push(base + a, base + b, base + c);
    else I.push(base + a, base + c, base + b);
    added++;
  }
  geo.setIndex(
    base + extra > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1),
  );
  geo.computeBoundingSphere();
  return added;
}

/**
 * Fill the holes a clean-up opened (loops made mostly of vertices that were not on an open border before it), thin
 * strips only (a loop whose rims are far apart, e.g. a neck opening or an eye socket, is never touched).
 * `before` = per vertex index, 1 if it was on an open border before the clean-up. Returns triangles added.
 */
export function fillNewHoles(
  geo: THREE.BufferGeometry,
  before: Uint8Array,
  skin: (u: number, v: number) => boolean,
  maxWidth = 0.016,
  reach = 1,
): number {
  let added = 0;
  for (const loop of borderLoops(geo)) {
    const fresh = loop.verts.filter((v) => !before[v]).length / loop.verts.length;
    if (fresh < 0.5 || stripWidth(geo, loop) > maxWidth) continue;
    added += fillStripHole(geo, loop, skin, reach);
  }
  return added;
}

/** Per vertex index: 1 if on an open border of the welded surface. */
export function borderVertexFlags(geo: THREE.BufferGeometry): Uint8Array {
  const out = new Uint8Array((geo.attributes.position as THREE.BufferAttribute).count);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const weld = weldGroups(pos);
  const flagged = new Set<number>();
  for (const l of borderLoops(geo)) for (const v of l.verts) flagged.add(weld[v]!);
  for (let i = 0; i < out.length; i++) out[i] = flagged.has(weld[i]!) ? 1 : 0;
  return out;
}

/** Widest gap across a loop: the largest distance from a loop vertex to the nearest vertex of the opposite rim. */
export function stripWidth(geo: THREE.BufferGeometry, loop: BorderLoop): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const L = loop.verts;
  const n = L.length;
  let e1 = 0,
    e2 = 1,
    best = -1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = _a.fromBufferAttribute(pos, L[i]!).distanceToSquared(_b.fromBufferAttribute(pos, L[j]!));
      if (d > best) {
        best = d;
        e1 = i;
        e2 = j;
      }
    }
  const rimA: number[] = [],
    rimB: number[] = [];
  for (let i = e1; i !== e2; i = (i + 1) % n) rimA.push(L[i]!);
  for (let i = e1; i !== e2; i = (i - 1 + n) % n) rimB.push(L[i]!);
  let w = 0;
  for (const a of rimA) {
    _a.fromBufferAttribute(pos, a);
    let m = Infinity;
    for (const b of rimB) m = Math.min(m, _a.distanceTo(_b.fromBufferAttribute(pos, b)));
    if (rimB.length) w = Math.max(w, m);
  }
  return w;
}
