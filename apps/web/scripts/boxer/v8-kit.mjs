// P3-FGT-19B: the v8 garments and kit for build.mjs (V8=1). The sources are the design prototype's outputs
// (docs/design/fighter-v8/SPEC.md §7, §13), rebuilt with `node qa/fighter-v8/build.mjs mW,fL` and
// `node qa/fighter-v8/cloth-sim.mjs <mW|fL> rest`:
//  - qa/fighter-v8/out/cloth/<fighter>-rest.json: the pattern-cut singlet, trunks and band, sewn and draped by the
//    cloth solver on the bind-pose body (single layer, seams welded), with their skin weights (the singlet carries no
//    arm bone; each trunks leg follows its own leg);
//  - qa/fighter-v8/out/<fighter>.glb: the SDF-modelled gloves, headgear, boots and hand wraps in the bind pose, skinned
//    to the MakeHuman skeleton.
// This module reads them, decimates every piece to the game budget (meshoptimizer, MIT) keeping the source vertices'
// positions, normals, uvs and weights, and measures what the build needs (distance to a garment's cut edge).
import { readFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";
import { parseGlb } from "./glb-read.mjs";

await MeshoptSimplifier.ready;

/** a MakeHuman bone name as three's loader / the prototype wrote it ("upperarm01.L" → "upperarm01L") → the original */
export function mhNameMap(names) {
  const m = new Map();
  for (const n of names) {
    m.set(n, n);
    m.set(n.replace(/\./g, ""), n);
  }
  return m;
}

/** the prototype's kit GLB → Map(name → { P, N, UV, tris, skin: [Map(MakeHuman bone → w)] }) */
export function readProtoKit(path) {
  const { json, accessor } = parseGlb(readFileSync(path));
  const joints = json.skins[0].joints.map((n) => json.nodes[n].name);
  const out = new Map();
  for (const m of json.meshes) {
    const p = m.primitives[0];
    const P = accessor(p.attributes.POSITION);
    const N = accessor(p.attributes.NORMAL);
    const UV = p.attributes.TEXCOORD_0 !== undefined ? accessor(p.attributes.TEXCOORD_0) : new Float32Array((P.length / 3) * 2);
    const J = accessor(p.attributes.JOINTS_0, { float: false });
    const W = accessor(p.attributes.WEIGHTS_0);
    const idx = accessor(p.indices, { float: false });
    const n = P.length / 3;
    const skin = Array.from({ length: n }, (_, i) => {
      const s = new Map();
      for (let q = 0; q < 4; q++) if (W[i * 4 + q] > 1e-4) s.set(joints[J[i * 4 + q]], (s.get(joints[J[i * 4 + q]]) ?? 0) + W[i * 4 + q]);
      return s;
    });
    out.set(m.name, { P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), tris: Uint32Array.from(idx), skin });
  }
  return out;
}

/** the cloth solver's rest drape → Map(name → { P, N: null, UV, tris, skin, panel }) */
export function readProtoCloth(path, boneNames) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const names = mhNameMap(boneNames);
  const out = new Map();
  for (const m of j.meshes) {
    if (!m.P) throw new Error(`v8-kit: ${path} has no single-layer rest export (run cloth-sim.mjs <fighter> rest)`);
    out.set(m.name, {
      P: Float32Array.from(m.P),
      N: null,
      UV: Float32Array.from(m.UV),
      tris: Uint32Array.from(m.tris.flat()),
      panel: m.panel,
      skin: m.skin.map((o) => new Map(Object.entries(o).map(([b, w]) => [names.get(b) ?? b, w]))),
    });
  }
  return { meshes: out, pattern: j.pattern };
}

/**
 * Decimate a mesh to about `targetTris` (edge collapses onto existing vertices: every kept vertex is a source vertex,
 * so its attributes carry over). Borders are locked (hems, arm holes, panel edges between pieces stay matched).
 * → { tris: Uint32Array (new indices), src: Int32Array (new vertex → source vertex), error }
 */
export function decimate(mesh, targetTris, { lockBorder = true, error = 0.02 } = {}) {
  const n = mesh.P.length / 3;
  const cur = mesh.tris.length / 3;
  let idx = mesh.tris;
  let err = 0;
  if (targetTris < cur) {
    const [r, e] = MeshoptSimplifier.simplify(mesh.tris, mesh.P, 3, Math.max(3, Math.floor(targetTris) * 3), error, lockBorder ? ["LockBorder"] : []);
    idx = r;
    err = e;
  }
  const remap = new Int32Array(n).fill(-1);
  const src = [];
  const tris = new Uint32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k];
    if (remap[v] < 0) {
      remap[v] = src.length;
      src.push(v);
    }
    tris[k] = remap[v];
  }
  return { tris, src: Int32Array.from(src), error: err };
}

/** area-weighted vertex normals (flat arrays) */
export function normalsOf(P, tris) {
  const N = new Float64Array(P.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3,
      b = tris[t + 1] * 3,
      c = tris[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1],
      ny = e1[2] * e2[0] - e1[0] * e2[2],
      nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const v of [a, b, c]) {
      N[v] += nx;
      N[v + 1] += ny;
      N[v + 2] += nz;
    }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l;
    N[i + 1] /= l;
    N[i + 2] /= l;
  }
  return N;
}

/** the boundary vertices of a triangle mesh (on an edge used by one triangle) */
export function boundaryVerts(tris, n) {
  const count = new Map();
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k],
        b = tris[t + ((k + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  const out = new Uint8Array(n);
  for (const [key, c] of count)
    if (c === 1) {
      out[Math.floor(key / n)] = 1;
      out[key % n] = 1;
    }
  return out;
}

/** geodesic (edge-path) distance of every vertex to the nearest boundary vertex (Dijkstra; m) */
export function edgeDistance(P, tris, seeds) {
  const n = P.length / 3;
  const nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k],
        b = tris[t + ((k + 1) % 3)];
      const d = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      nb[a].push([b, d]);
      nb[b].push([a, d]);
    }
  const dist = new Float64Array(n).fill(Infinity);
  // a binary heap of [d, v]
  const heap = [];
  const push = (d, v) => {
    heap.push([d, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (let v = 0; v < n; v++)
    if (seeds[v]) {
      dist[v] = 0;
      push(0, v);
    }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const [u, w] of nb[v])
      if (d + w < dist[u]) {
        dist[u] = d + w;
        push(dist[u], u);
      }
  }
  return dist;
}
