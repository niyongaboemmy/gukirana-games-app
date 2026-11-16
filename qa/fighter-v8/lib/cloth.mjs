// P3-FGT-19A fighter v8 prototype (dev only): garment patterns and an offline cloth solver.
//  - patterns: 2D panels in metres (singlet front / back, trunks legs, elastic waistband) meshed at ~1 cm;
//  - solver: position-based dynamics with small substeps (XPBD-style relaxation per constraint): stretch on every
//    edge, shear through the triangle edges, bending across every interior edge (isometric distance), seams that
//    close over the first frames, gravity, body collision against the posed body (BVH closest point with a
//    pseudo-normal sign) with friction, approximate self-collision (spatial hash), soft attachments (elastic grip).
// Deterministic (no randomness).
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

/* ---------------------------------------------------------------------------------------------- 2D helpers */
const pointInPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const closestOnPoly = (x, y, poly) => {
  let best = null, bd = Infinity, bt = 0, be = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    const px = ax + ex * t, py = ay + ey * t;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) {
      bd = d;
      best = [px, py];
      bt = t;
      be = i;
    }
  }
  return { p: best, d: Math.sqrt(bd), edge: be, t: bt };
};
/** sample a smooth curve (quadratic Bezier chain) into a polyline */
export const bez = (a, c, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n;
  return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
});

/**
 * Mesh a 2D panel outline at spacing h: grid cells whose centre is inside, boundary vertices snapped onto the
 * outline, quads split into triangles. Returns { uv: [[x, y]], tris, boundary: Set }.
 */
export function meshPanel(poly, h) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const nx = Math.ceil((maxX - minX) / h) + 1, ny = Math.ceil((maxY - minY) / h) + 1;
  const cell = (i, j) => pointInPoly(minX + (i + 0.5) * h, minY + (j + 0.5) * h, poly);
  const vid = new Map();
  const uv = [];
  const V = (i, j) => {
    const k = i * 100000 + j;
    if (!vid.has(k)) {
      vid.set(k, uv.length);
      uv.push([minX + i * h, minY + j * h]);
    }
    return vid.get(k);
  };
  const quads = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (cell(i, j)) quads.push([V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)]);
  // boundary: vertices on edges used once
  const ec = new Map();
  for (const q of quads) for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    ec.set(key, (ec.get(key) ?? 0) + 1);
  }
  const boundary = new Set();
  for (const [key, n] of ec) if (n === 1) key.split("_").forEach((v) => boundary.add(+v));
  for (const v of boundary) uv[v] = closestOnPoly(uv[v][0], uv[v][1], poly).p;
  // relax interior vertices once so the snapped border does not leave slivers
  const nb = uv.map(() => new Set());
  for (const q of quads) for (let k = 0; k < 4; k++) {
    nb[q[k]].add(q[(k + 1) % 4]);
    nb[q[k]].add(q[(k + 3) % 4]);
  }
  for (let it = 0; it < 4; it++)
    for (let v = 0; v < uv.length; v++) {
      if (boundary.has(v)) continue;
      let x = 0, y = 0;
      for (const q of nb[v]) {
        x += uv[q][0];
        y += uv[q][1];
      }
      uv[v] = [uv[v][0] * 0.5 + (x / nb[v].size) * 0.5, uv[v][1] * 0.5 + (y / nb[v].size) * 0.5];
    }
  const tris = quads.flatMap(([a, b, c, d]) => ((a + c) % 2 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]]));
  return { uv, tris, boundary };
}

/** boundary vertices of a panel lying along a polyline segment (seam edge), ordered by the parameter along it */
export function edgeVerts(panel, a, b, tol) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const L2 = ex * ex + ey * ey;
  const out = [];
  for (const v of panel.boundary) {
    const [x, y] = panel.uv[v];
    const t = ((x - a[0]) * ex + (y - a[1]) * ey) / L2;
    if (t < -0.01 || t > 1.01) continue;
    const d = Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y);
    if (d < tol) out.push([v, t]);
  }
  return out.sort((p, q) => p[1] - q[1]);
}

/* ---------------------------------------------------------------------------------------------- solver */
export class Cloth {
  constructor() {
    this.x = []; // positions (flat)
    this.p = []; // previous positions
    this.w = []; // inverse mass
    this.uv = []; // pattern coordinates (m)
    this.panel = []; // panel id per particle
    this.tris = [];
    this.dist = []; // [a, b, rest, softness]
    this.seams = []; // [a, b, softness]
    this.attach = []; // [a, target[3], softness]
    this.panels = [];
  }
  addPanel(name, mesh, place, { density, stretch, bend }) {
    const base = this.x.length / 3;
    const id = this.panels.length;
    this.panels.push({ name, base, count: mesh.uv.length, mesh });
    const area = new Float64Array(mesh.uv.length);
    for (const [a, b, c] of mesh.tris) {
      const [ax, ay] = mesh.uv[a], [bx, by] = mesh.uv[b], [cx, cy] = mesh.uv[c];
      const A = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      area[a] += A / 3;
      area[b] += A / 3;
      area[c] += A / 3;
    }
    mesh.uv.forEach((u, i) => {
      const P = place(u[0], u[1]);
      this.x.push(...P);
      this.p.push(...P);
      this.w.push(1 / Math.max(1e-7, area[i] * density));
      this.uv.push(u[0], u[1]);
      this.panel.push(id);
    });
    for (const t of mesh.tris) this.tris.push(t.map((v) => v + base));
    // stretch / shear (every triangle edge) and bending (across each interior edge)
    const edges = new Map();
    for (const [a, b, c] of mesh.tris)
      for (const [i, j, k] of [[a, b, c], [b, c, a], [c, a, b]]) {
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        if (!edges.has(key)) edges.set(key, { i, j, opp: [] });
        edges.get(key).opp.push(k);
      }
    const L = (i, j) => Math.hypot(mesh.uv[i][0] - mesh.uv[j][0], mesh.uv[i][1] - mesh.uv[j][1]);
    for (const e of edges.values()) {
      this.dist.push([e.i + base, e.j + base, L(e.i, e.j), stretch]);
      if (e.opp.length === 2) this.dist.push([e.opp[0] + base, e.opp[1] + base, L(e.opp[0], e.opp[1]), bend]);
    }
    return { base, id };
  }
  sew(pairsA, pairsB, baseA, baseB, softness = 0) {
    // pair each A vertex with the B vertex nearest in parameter
    if (!pairsA.length || !pairsB.length) return 0;
    let n = 0;
    for (const [va, ta] of pairsA) {
      let best = pairsB[0];
      for (const q of pairsB) if (Math.abs(q[1] - ta) < Math.abs(best[1] - ta)) best = q;
      this.seams.push([va + baseA, best[0] + baseB, softness]);
      n++;
    }
    return n;
  }
  /**
   * geometry: posed body BufferGeometry (indexed; pseudo-normals from its vertex normals). Optional `torso`: the same
   * body without the arms, the collider for the singlet panels (ids ≤ vestMax), whose arm rule is separate: the arms
   * are capsules [{ a, b, r }] and singlet cloth that meets one is pushed towards the torso, so it always stays
   * between the arm and the ribs (a singlet has no sleeves: the arm passes through the arm hole, never into it).
   */
  setBody(geometry, { torso = null, arms = [], vestMax = -1, torsoCentre = null } = {}) {
    this.bodyGeo = geometry;
    this.bvh = new MeshBVH(geometry);
    this.torsoGeo = torso;
    this.torsoBvh = torso ? new MeshBVH(torso) : null;
    this.arms = arms;
    this.vestMax = vestMax;
    this.torsoCentre = torsoCentre;
  }
  /**
   * Run `frames` frames. opts: gravity ramp, seam closing over `sewFrames`, collision thickness, friction,
   * self-collision distance, callback per frame.
   */
  run(frames, { substeps = 8, gravity = 9.81, sewFrames = 0, thickness = 0.003, friction = 0.4, selfDist = 0.0035, damping = 0.996, onFrame = null } = {}) {
    const n = this.x.length / 3;
    const x = Float64Array.from(this.x), pr = Float64Array.from(this.p), w = Float64Array.from(this.w);
    const dt = 1 / 60 / substeps;
    const g = this.bodyGeo;
    const bpos = g.attributes.position, bnor = g.attributes.normal, bidx = g.index.array;
    const tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const P = new THREE.Vector3(), tri = new THREE.Triangle(), bary = new THREE.Vector3();
    const A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3();
    const near = new Float32Array(n).fill(0); // frames to skip the collision test (far particles)
    const seamRest = this.seams.map(([a, b]) => Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]));
    const contact = new Uint8Array(n);
    const uvp = this.uv, pid = this.panel;
    for (let f = 0; f < frames; f++) {
      const sewK = sewFrames ? Math.min(1, (f + 1) / sewFrames) : 1;
      // no gravity while the seams close (the panels would slide off before they are joined), then ramp it in
      const gk = gravity * Math.min(1, Math.max(0, (f + 1 - sewFrames) / 30));
      for (let s = 0; s < substeps; s++) {
        // integrate
        for (let i = 0; i < n; i++) {
          if (!w[i]) continue;
          const vx = (x[i * 3] - pr[i * 3]) * damping, vy = (x[i * 3 + 1] - pr[i * 3 + 1]) * damping, vz = (x[i * 3 + 2] - pr[i * 3 + 2]) * damping;
          pr[i * 3] = x[i * 3];
          pr[i * 3 + 1] = x[i * 3 + 1];
          pr[i * 3 + 2] = x[i * 3 + 2];
          x[i * 3] += vx;
          x[i * 3 + 1] += vy - gk * dt * dt;
          x[i * 3 + 2] += vz;
        }
        // distance constraints (stretch, shear, bend)
        for (const [a, b, rest, soft] of this.dist) {
          const dx = x[b * 3] - x[a * 3], dy = x[b * 3 + 1] - x[a * 3 + 1], dz = x[b * 3 + 2] - x[a * 3 + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const wa = w[a], wb = w[b];
          const ws = wa + wb;
          if (!ws) continue;
          const c = (l - rest) / (ws * (1 + soft) * l);
          x[a * 3] += wa * c * dx;
          x[a * 3 + 1] += wa * c * dy;
          x[a * 3 + 2] += wa * c * dz;
          x[b * 3] -= wb * c * dx;
          x[b * 3 + 1] -= wb * c * dy;
          x[b * 3 + 2] -= wb * c * dz;
        }
        // seams close progressively
        this.seams.forEach(([a, b, soft], k) => {
          const rest = seamRest[k] * (1 - sewK);
          const dx = x[b * 3] - x[a * 3], dy = x[b * 3 + 1] - x[a * 3 + 1], dz = x[b * 3 + 2] - x[a * 3 + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const ws = w[a] + w[b];
          if (!ws || l <= rest) return;
          const c = (l - rest) / (ws * (1 + soft) * l);
          x[a * 3] += w[a] * c * dx;
          x[a * 3 + 1] += w[a] * c * dy;
          x[a * 3 + 2] += w[a] * c * dz;
          x[b * 3] -= w[b] * c * dx;
          x[b * 3 + 1] -= w[b] * c * dy;
          x[b * 3 + 2] -= w[b] * c * dz;
        });
        // soft attachments (elastic grip of the band, the tucked hem)
        for (const [a, t, soft] of this.attach) {
          const k = 1 / (1 + soft);
          x[a * 3] += (t[0] - x[a * 3]) * k;
          x[a * 3 + 1] += (t[1] - x[a * 3 + 1]) * k;
          x[a * 3 + 2] += (t[2] - x[a * 3 + 2]) * k;
        }
        // body collision with friction (singlet panels: the torso only, the arms by the rule below)
        for (let i = 0; i < n; i++) {
          contact[i] = 0;
          const vest = this.torsoBvh && pid[i] <= this.vestMax;
          if (vest && this.arms.length) {
            // arm rule: inside an arm capsule (+ thickness) → move towards the torso axis until clear of the arm
            for (const { a, b, r } of this.arms) {
              const px = x[i * 3], py = x[i * 3 + 1], pz = x[i * 3 + 2];
              const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
              const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / (abx * abx + aby * aby + abz * abz)));
              const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
              const d = Math.hypot(px - cx, py - cy, pz - cz);
              const rr = r + thickness;
              if (d >= rr) continue;
              let dx = this.torsoCentre[0] - px, dz = this.torsoCentre[2] - pz;
              const dl = Math.hypot(dx, dz) || 1;
              dx /= dl;
              dz /= dl;
              // step along the torso direction until outside the capsule (solve |q - c| = rr on that line)
              const ox = px - cx, oy = py - cy, oz = pz - cz;
              const bq = ox * dx + oz * dz;
              const cq = ox * ox + oy * oy + oz * oz - rr * rr;
              const disc = bq * bq - cq;
              const tt = disc > 0 ? -bq + Math.sqrt(disc) : rr - d;
              x[i * 3] += dx * tt;
              x[i * 3 + 2] += dz * tt;
              pr[i * 3] += (x[i * 3] - pr[i * 3]) * friction;
              pr[i * 3 + 2] += (x[i * 3 + 2] - pr[i * 3 + 2]) * friction;
              near[i] = 0;
            }
          }
          if (near[i] > 0) {
            near[i]--;
            continue;
          }
          const bvh = vest ? this.torsoBvh : this.bvh;
          const gg = vest ? this.torsoGeo : g;
          const bpos2 = gg.attributes.position, bnor2 = gg.attributes.normal, bidx2 = gg.index.array;
          P.set(x[i * 3], x[i * 3 + 1], x[i * 3 + 2]);
          if (!bvh.closestPointToPoint(P, tgt, 0, 0.04)) {
            near[i] = 6;
            continue;
          }
          const fi = tgt.faceIndex;
          const ia = bidx2[fi * 3], ib = bidx2[fi * 3 + 1], ic = bidx2[fi * 3 + 2];
          A.fromBufferAttribute(bpos2, ia);
          Bv.fromBufferAttribute(bpos2, ib);
          Cv.fromBufferAttribute(bpos2, ic);
          tri.set(A, Bv, Cv);
          tri.getBarycoord(tgt.point, bary);
          const nx = bnor2.getX(ia) * bary.x + bnor2.getX(ib) * bary.y + bnor2.getX(ic) * bary.z;
          const ny = bnor2.getY(ia) * bary.x + bnor2.getY(ib) * bary.y + bnor2.getY(ic) * bary.z;
          const nz = bnor2.getZ(ia) * bary.x + bnor2.getZ(ib) * bary.y + bnor2.getZ(ic) * bary.z;
          const nl = Math.hypot(nx, ny, nz) || 1;
          const sd = ((P.x - tgt.point.x) * nx + (P.y - tgt.point.y) * ny + (P.z - tgt.point.z) * nz) / nl;
          if (sd < thickness) {
            const push = thickness - sd;
            x[i * 3] += (nx / nl) * push;
            x[i * 3 + 1] += (ny / nl) * push;
            x[i * 3 + 2] += (nz / nl) * push;
            contact[i] = 1;
            // friction: damp the tangential motion
            pr[i * 3] += (x[i * 3] - pr[i * 3]) * friction;
            pr[i * 3 + 1] += (x[i * 3 + 1] - pr[i * 3 + 1]) * friction;
            pr[i * 3 + 2] += (x[i * 3 + 2] - pr[i * 3 + 2]) * friction;
          } else if (sd > 0.025) near[i] = 3;
        }
      }
      // approximate self-collision once per frame (spatial hash), pattern neighbours excluded
      if (selfDist > 0) {
        const cs = selfDist * 2;
        const grid = new Map();
        const key = (ix, iy, iz) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
        for (let i = 0; i < n; i++) {
          const k = key(Math.floor(x[i * 3] / cs), Math.floor(x[i * 3 + 1] / cs), Math.floor(x[i * 3 + 2] / cs));
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
        for (let i = 0; i < n; i++) {
          const ix = Math.floor(x[i * 3] / cs), iy = Math.floor(x[i * 3 + 1] / cs), iz = Math.floor(x[i * 3 + 2] / cs);
          for (let a = -1; a <= 1; a++)
            for (let b = -1; b <= 1; b++)
              for (let c = -1; c <= 1; c++) {
                const list = grid.get(key(ix + a, iy + b, iz + c));
                if (!list) continue;
                for (const j of list) {
                  if (j <= i) continue;
                  if (pid[i] === pid[j] && Math.hypot(uvp[i * 2] - uvp[j * 2], uvp[i * 2 + 1] - uvp[j * 2 + 1]) < selfDist * 5) continue;
                  const dx = x[j * 3] - x[i * 3], dy = x[j * 3 + 1] - x[i * 3 + 1], dz = x[j * 3 + 2] - x[i * 3 + 2];
                  const d2 = dx * dx + dy * dy + dz * dz;
                  if (d2 >= selfDist * selfDist || d2 < 1e-14) continue;
                  const d = Math.sqrt(d2);
                  const c2 = ((selfDist - d) / d) * 0.5;
                  x[i * 3] -= dx * c2;
                  x[i * 3 + 1] -= dy * c2;
                  x[i * 3 + 2] -= dz * c2;
                  x[j * 3] += dx * c2;
                  x[j * 3 + 1] += dy * c2;
                  x[j * 3 + 2] += dz * c2;
                }
              }
        }
      }
      if (onFrame) onFrame(f, x);
    }
    this.x = Array.from(x);
    this.p = Array.from(x);
    return this;
  }
}
