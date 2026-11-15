import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cornerKit, CORNERS, RING, RING_SIZES, stepZ, type CornerId, type RingDims, type RingSize } from "./ring-kit-core";

/**
 * Boxing ring geometry (P3-FGT-02), in the ring frame (ring-kit-core.ts). Every level is ONE merged geometry with
 * vertex colours, so a whole field of rings is drawn with one instanced draw call per level:
 *  - near: pleated skirt round the raised platform, apron edge, 4 posts with flanges, padded turnbuckle covers (red /
 *    blue / 2 neutral white), 4 ropes per side with a natural sag and rope covers, rope spacers, steps with hand
 *    rails at the red and blue corners, buckets + water bottles by the steps, a spectator rail with gaps at the steps,
 *    the number-board frame and the status-lamp housing;
 *  - far: the same silhouette in boxes (straight ropes, square posts, a ramp for the steps, a simple rail);
 *  - canvas (a textured quad: printed canvas, apron, corner logos); lamp, board, stool: own small instanced parts;
 *  - feature extras: judges' table + chairs, the bell, an overhead lighting truss (one mesh, the feature ring only).
 */

type C = THREE.ColorRepresentation;

/** collect parts: each is colourised (vertex colours) and transformed, then all merge into one geometry */
class Parts {
  private list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: C, m?: THREE.Matrix4) {
    const geo = g;
    if (m) geo.applyMatrix4(m);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
    const n = geo.getAttribute("position").count;
    const col = new THREE.Color(color);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    // only the attributes every part has
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) geo.deleteAttribute(k);
    this.list.push(geo.index ? geo.toNonIndexed() : geo);
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: C, rotY = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
  }
  cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, color: C, seg = 10) {
    return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), color, new THREE.Matrix4().makeTranslation(x, y, z));
  }
  /** cylinder between two points */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, color: C, seg = 8) {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    return this.add(g, color, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }
  tube(pts: THREE.Vector3[], r: number, color: C, radial = 6) {
    const curve = new THREE.CatmullRomCurve3(pts);
    return this.add(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 3), r, radial, false), color);
  }
  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    this.list.forEach((x) => x.dispose());
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

const COL = {
  skirt: "#24272d",
  skirtBand: "#1f4fb0",
  skirtTrim: "#c9ccd1",
  apron: "#30343b",
  post: "#3b3e44",
  red: "#b3242b",
  blue: "#1f4fb0",
  white: "#e6e3dc",
  ropeA: "#e8e5de",
  ropeB: "#1f4fb0",
  cover: "#2a2d33",
  spacer: "#2c2f35",
  steps: "#2b2e34",
  tread: "#9aa0a8",
  nosing: "#1b1c1f",
  stringer: "#45484f",
  rail: "#3a3d43",
  bucket: "#c9ccd1",
  bucketRim: "#9ea3aa",
  towel: "#ece8df",
  bottle: "#d8e4ef",
  board: "#1d1f24",
  lampHouse: "#2a2c31",
};
export const PAD_COLORS: Record<CornerId, string> = { red: COL.red, blue: COL.blue, neutralA: COL.white, neutralB: COL.white };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the four sides: [corner a, corner b] in ring order */
const SIDES: [CornerId, CornerId][] = [
  ["red", "neutralA"],
  ["neutralA", "blue"],
  ["blue", "neutralB"],
  ["neutralB", "red"],
];

/** the pleated skirt (near) or a plain box side (far) round the platform */
function platform(p: Parts, K: RingDims, near: boolean) {
  const H = K.half,
    D = K.deck - 0.03;
  // body (inside, never seen) + apron board under the canvas
  p.box(2 * H - 0.04, D, 2 * H - 0.04, 0, D / 2, 0, COL.skirt);
  if (!near) {
    // far: the blue band as one box per side
    p.box(2 * H + 0.02, 0.12, 2 * H + 0.02, 0, D - 0.1, 0, COL.skirtBand);
    return;
  }
  const segs = 46;
  for (let s = 0; s < 4; s++) {
    const g = new THREE.PlaneGeometry(2 * H, D, segs, 1);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    // soft vertical pleats (the skirt hangs from the apron edge)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const k = Math.sin((x / (2 * H)) * Math.PI * 2 * 14);
      const fy = (pos.getY(i) + D / 2) / D; // 0 floor … 1 apron
      pos.setZ(i, 0.012 * k * (1 - 0.6 * fy) + 0.012);
    }
    g.computeVertexNormals();
    const m = new THREE.Matrix4().makeRotationY((s * Math.PI) / 2).multiply(new THREE.Matrix4().makeTranslation(0, D / 2, H));
    p.add(g, COL.skirt, m);
    // the band: a blue stripe and a light pinline under the apron edge
    p.add(new THREE.PlaneGeometry(2 * H, 0.12), COL.skirtBand, new THREE.Matrix4().makeRotationY((s * Math.PI) / 2).multiply(new THREE.Matrix4().makeTranslation(0, D - 0.1, H + 0.026)));
    p.add(new THREE.PlaneGeometry(2 * H, 0.012), COL.skirtTrim, new THREE.Matrix4().makeRotationY((s * Math.PI) / 2).multiply(new THREE.Matrix4().makeTranslation(0, D - 0.172, H + 0.027)));
  }
  // apron edge: a padded lip round the canvas
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    const m = new THREE.Matrix4().makeRotationY(a).setPosition(0, K.deck - 0.02, 0);
    p.add(new THREE.BoxGeometry(2 * H + 0.06, 0.06, 0.06), COL.apron, m.multiply(new THREE.Matrix4().makeTranslation(0, 0, H)));
  }
}

function postsAndPads(p: Parts, K: RingDims, near: boolean) {
  const P = K.post,
    top = K.deck + K.postH;
  for (const c of Object.keys(CORNERS) as CornerId[]) {
    const [sx, sz] = CORNERS[c];
    const x = sx * P,
      z = sz * P;
    if (near) {
      p.cyl(0.055, 0.055, K.postH + 0.05, x, K.deck + K.postH / 2, z, COL.post, 12);
      p.cyl(0.1, 0.11, 0.05, x, K.deck + 0.025, z, COL.post, 12);
      p.cyl(0.065, 0.055, 0.04, x, top + 0.02, z, COL.post, 12);
    } else p.box(0.11, K.postH, 0.11, x, K.deck + K.postH / 2, z, COL.post);
    // the turnbuckle cover on the inner face of the post, square to the ring diagonal
    const inward = Math.atan2(-sx, -sz);
    const d = near ? 0.12 : 0.1;
    const cx = x - sx * d * Math.SQRT1_2,
      cz = z - sz * d * Math.SQRT1_2;
    if (near) {
      const g = new THREE.CapsuleGeometry(0.09, 1.0, 4, 10);
      g.scale(1.15, 1, 0.85);
      p.add(g, PAD_COLORS[c], new THREE.Matrix4().makeRotationY(inward).setPosition(cx, K.deck + 0.9, cz));
    } else p.box(0.2, 1.1, 0.14, cx, K.deck + 0.9, cz, PAD_COLORS[c], inward);
  }
}

/** rope ends sit on the pad faces; near: sagging tubes + rope covers + spacers; far: straight boxes */
function ropes(p: Parts, K: RingDims, near: boolean) {
  const P = K.post - 0.13;
  SIDES.forEach(([a, b], side) => {
    const [ax, az] = CORNERS[a];
    const [bx, bz] = CORNERS[b];
    const A = v(ax * P, 0, az * P),
      B = v(bx * P, 0, bz * P);
    K.ropes.forEach((h, i) => {
      const y = K.deck + h;
      const color = i % 2 === 0 ? COL.ropeB : COL.ropeA;
      if (near) {
        const pts: THREE.Vector3[] = [];
        const n = 12;
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          // a shallow catenary (a parabola is indistinguishable at this sag)
          pts.push(A.clone().lerp(B, t).setY(y - 4 * K.sag[i]! * t * (1 - t)));
        }
        p.tube(pts, 0.021, color, 7);
      } else {
        const mid = A.clone().lerp(B, 0.5).setY(y - K.sag[i]! * 0.6);
        const len = A.distanceTo(B);
        p.box(len, 0.035, 0.035, mid.x, mid.y, mid.z, color, side % 2 === 0 ? 0 : Math.PI / 2);
      }
    });
    if (near) {
      // tie-ups: a dark lashing collar where each rope meets the corner pads
      for (const h of K.ropes) {
        const y = K.deck + h;
        for (const E of [A.clone().lerp(B, 0.012), B.clone().lerp(A, 0.012)]) p.cyl(0.03, 0.03, 0.05, E.x, y, E.z, COL.spacer, 6);
      }
      // rope spacers (vertical straps) at a third and two thirds of each side
      for (const t of [1 / 3, 2 / 3]) {
        const at = A.clone().lerp(B, t);
        const sag = 4 * t * (1 - t);
        const yTop = K.deck + K.ropes[3] - K.sag[0] * sag + 0.04,
          yBot = K.deck + K.ropes[0] - K.sag[3] * sag - 0.04;
        p.box(side % 2 === 0 ? 0.05 : 0.03, yTop - yBot, side % 2 === 0 ? 0.03 : 0.05, at.x, (yTop + yBot) / 2, at.z, COL.spacer);
      }
    }
  });
}

function steps(p: Parts, K: RingDims, near: boolean) {
  for (const c of ["red", "blue"] as const) {
    const [sx, sz] = CORNERS[c];
    const z = sz * stepZ(K);
    const x0 = sx * K.half;
    const n = 3;
    const rise = K.deck / n,
      run = K.stepRun;
    if (!near) {
      // far: the three treads and the stringers as thin boxes (still open: no solid block at a distance)
      for (let k = 0; k < n; k++) p.box(run, 0.04, 0.78, x0 + sx * (run * (n - k) - run / 2), rise * (k + 1) - 0.02, z, COL.tread);
      for (const dz of [-0.38, 0.38]) p.box(run * n, 0.04, 0.04, x0 + sx * ((run * n) / 2), K.deck / 2, z + dz, COL.stringer);
      continue;
    }
    // open steps (P3-FGT-08): two steel stringers on the slope, three aluminium treads with dark rubber nosing,
    // open risers, a back frame against the skirt — legs and feet on the treads read clearly from every side
    const xFoot = x0 + sx * run * n;
    for (const dz of [-0.38, 0.38]) {
      // the stringer: a flat bar from the floor at the foot up to the apron, under the treads' ends
      // its centre line runs through the treads' centres (treads bolted between the stringers)
      const a = v(xFoot, rise * 0.5, z + dz),
        b = v(x0 + sx * run * 0.5, K.deck, z + dz);
      const len = a.distanceTo(b);
      const ang = Math.atan2(b.y - a.y, Math.abs(b.x - a.x));
      const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sx > 0 ? -ang : ang)), new THREE.Vector3(1, 1, 1));
      p.add(new THREE.BoxGeometry(len, 0.16, 0.035), COL.stringer, m);
      // a rubber foot at the bottom, back legs down to the floor under the top tread, a cross bar between them
      p.box(0.09, 0.06, 0.05, xFoot - sx * 0.05, 0.03, z + dz, COL.nosing);
      p.box(0.04, K.deck - 0.04, 0.04, x0 + sx * 0.05, (K.deck - 0.04) / 2, z + dz, COL.stringer);
    }
    p.box(0.035, 0.035, 0.76, x0 + sx * 0.05, 0.12, z, COL.stringer);
    for (let k = 0; k < n; k++) {
      const h = rise * (k + 1);
      const xc = x0 + sx * (run * (n - k) - run / 2);
      p.box(run + 0.02, 0.035, 0.76, xc, h - 0.0175, z, COL.tread);
      // nosing strip on the leading edge (where the foot lands)
      p.box(0.05, 0.04, 0.765, xc + sx * (run / 2 - 0.015), h - 0.015, z, COL.nosing);
    }
    // hand rails both sides
    for (const dz of [-0.42, 0.42]) {
      const a = v(x0 + sx * (run * n + 0.05), 0.95, z + dz),
        b = v(x0 + sx * 0.02, K.deck + 0.95, z + dz);
      p.rod(a, b, 0.018, COL.rail);
      p.rod(v(a.x, 0, a.z), a, 0.02, COL.rail);
      p.rod(v(b.x, K.deck, b.z), b, 0.02, COL.rail);
    }
  }
}

function setDressing(p: Parts, K: RingDims) {
  for (const c of ["red", "blue"] as const) {
    const [sx, sz] = CORNERS[c];
    const tint = c === "red" ? COL.red : COL.blue;
    // the corner's floor kit beside the steps (P3-FGT-08; P3-FGT-11: from ring-kit-core cornerKit, on a training ring
    // tucked against the skirt in the rail's bay): water bucket, spit bucket with its funnel, two bottles (the stool is
    // its own instanced part)
    for (const it of cornerKit(K, c)) {
      const { lx: x, lz: z } = it;
      if (it.kind === "bucket") {
        const bucket = new THREE.CylinderGeometry(0.16, 0.13, 0.3, 14, 1, true);
        p.add(bucket, COL.bucket, new THREE.Matrix4().makeTranslation(x, 0.15, z));
        p.cyl(0.13, 0.13, 0.01, x, 0.012, z, COL.bucket, 14);
        p.cyl(0.165, 0.165, 0.018, x, 0.3, z, COL.bucketRim, 14); // rolled rim
        p.cyl(0.15, 0.15, 0.02, x, 0.22, z, "#7e9aa6", 14); // water, a little ice-grey
      } else if (it.kind === "spit") {
        p.cyl(0.12, 0.1, 0.24, x, 0.12, z, "#2a2c31", 12); // spit bucket
        p.add(new THREE.CylinderGeometry(0.12, 0.03, 0.1, 12, 1, true), "#3b3e44", new THREE.Matrix4().makeTranslation(x, 0.29, z)); // its funnel
      } else if (it.kind === "bottle") {
        p.cyl(0.035, 0.035, 0.2, x, 0.1, z, COL.bottle, 8);
        p.cyl(0.02, 0.028, 0.04, x, 0.22, z, tint, 8);
      }
    }
    // a corner towel folded over the barrier rail next to the kit (two drops and the fold on the top tube); with a bay
    // on the rail's other half (the steps' half has no rail)
    const rx = sx * K.rail,
      tz = K.bay ? -sz * 0.5 : sz * (stepZ(K) - 1.1),
      th = K.railH;
    p.box(0.05, 0.03, 0.34, rx, th + 0.02, tz, COL.towel);
    for (const s2 of [-1, 1]) p.box(0.012, 0.36, 0.34, rx + s2 * 0.035, th - 0.16, tz, COL.towel);
  }
}

/** the spectator rail (gaps at the steps); near: round tubes + posts every ~1.6 m, far: thin boxes */
function rail(p: Parts, K: RingDims, near: boolean) {
  const R = K.rail,
    h = K.railH;
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    const rot = new THREE.Matrix4().makeRotationY(a);
    // side s runs along x at z = R (rotated); the red / blue steps gaps are on the ±x sides (s = 1, 3)
    const gap = s === 1 || s === 3;
    // (the gap is 1.3 m round the steps' centre line, stepZ either side)
    const g0 = stepZ(K) - 0.65,
      g1 = stepZ(K) + 0.65;
    // bay (P3-FGT-11): no rail on the steps' half of the side (t < 0 in this frame), the corner kit stands there
    const spans: [number, number][] = gap && K.bay
      ? [[0, R]]
      : gap
      ? [
          [-R, -g1],
          [-g0, g0],
          [g1, R],
        ]
      : [[-R, R]];
    for (const [x0, x1] of spans) {
      const A = v(x0, h, R).applyMatrix4(rot),
        B = v(x1, h, R).applyMatrix4(rot);
      if (near) {
        p.rod(A, B, 0.025, COL.rail, 8);
        p.rod(A.clone().setY(h * 0.5), B.clone().setY(h * 0.5), 0.016, COL.rail, 6);
        const n = Math.max(1, Math.round((x1 - x0) / 1.6));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const q = A.clone().lerp(B, t);
          p.rod(v(q.x, 0, q.z), q, 0.022, COL.rail, 8);
        }
      } else {
        const mid = A.clone().lerp(B, 0.5);
        p.box(A.distanceTo(B), 0.05, 0.05, mid.x, h, mid.z, COL.rail, a);
        p.box(0.05, h, 0.05, A.x, h / 2, A.z, COL.rail);
        p.box(0.05, h, 0.05, B.x, h / 2, B.z, COL.rail);
      }
    }
  }
}

/** number-board frame (front side of the rail) + the status-lamp housing on the neutral corner post */
export const boardAt = (K: RingDims = RING) => ({ x: 0, y: K.railH + 0.34, z: -K.rail, w: 0.62, h: 0.42 });
export const lampAt = (K: RingDims = RING) => ({ x: CORNERS.neutralA[0] * K.post, y: K.deck + K.postH + 0.1, z: CORNERS.neutralA[1] * K.post });
export const BOARD = boardAt();
export const LAMP = lampAt();
function fixtures(p: Parts, K: RingDims, near: boolean, boards: boolean) {
  const BOARD = boardAt(K),
    LAMP = lampAt(K);
  if (near) p.cyl(0.055, 0.07, 0.06, LAMP.x, LAMP.y - 0.06, LAMP.z, COL.lampHouse, 12);
  if (!boards) return;
  p.box(BOARD.w + 0.05, BOARD.h + 0.05, 0.04, BOARD.x, BOARD.y, BOARD.z, COL.board);
  p.box(0.05, BOARD.y - BOARD.h / 2, 0.05, BOARD.x, (BOARD.y - BOARD.h / 2) / 2, BOARD.z, COL.rail);
}

/** geometry options: the ring size, and whether the number-board frame is built (off when the hall hangs its own signs) */
export interface RingGeoOptions {
  size?: RingSize;
  boards?: boolean;
}
const dimsFor = (o: RingGeoOptions) => RING_SIZES[o.size ?? "pro"];

export function nearRingGeometry(o: RingGeoOptions = {}): THREE.BufferGeometry {
  const K = dimsFor(o);
  const p = new Parts();
  platform(p, K, true);
  postsAndPads(p, K, true);
  ropes(p, K, true);
  steps(p, K, true);
  setDressing(p, K);
  rail(p, K, true);
  fixtures(p, K, true, o.boards !== false);
  return p.geometry();
}

export function farRingGeometry(o: RingGeoOptions = {}): THREE.BufferGeometry {
  const K = dimsFor(o);
  const p = new Parts();
  platform(p, K, false);
  postsAndPads(p, K, false);
  ropes(p, K, false);
  steps(p, K, false);
  rail(p, K, false);
  fixtures(p, K, false, o.boards !== false);
  return p.geometry();
}

/** the canvas top (uv 0…1 over the whole platform top, for the printed canvas texture) */
export function canvasGeometry(size: RingSize = "pro"): THREE.BufferGeometry {
  const K = RING_SIZES[size];
  const g = new THREE.PlaneGeometry(2 * K.half, 2 * K.half, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, K.deck + 0.002, 0);
  return g;
}

/** a lamp: a small dome on top of the neutral post + a light strip along the apron edge on that side */
export function lampGeometry(size: RingSize = "pro"): THREE.BufferGeometry {
  const K = RING_SIZES[size];
  const LAMP = lampAt(K);
  const p = new Parts();
  const dome = new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  p.add(dome, "#ffffff", new THREE.Matrix4().makeTranslation(LAMP.x, LAMP.y - 0.03, LAMP.z));
  // the strip on the front skirt (side towards −z, the board side)
  p.add(new THREE.PlaneGeometry(2 * K.half - 0.4, 0.03), "#ffffff", new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, K.deck - 0.235, -K.half - 0.028));
  return p.geometry();
}

/** a number board face pair (front + back, each reading the right way) */
export function boardGeometry(size: RingSize = "pro"): THREE.BufferGeometry {
  const BOARD = boardAt(RING_SIZES[size]);
  const front = new THREE.PlaneGeometry(BOARD.w, BOARD.h);
  front.rotateY(Math.PI);
  front.translate(BOARD.x, BOARD.y, BOARD.z - 0.022);
  const back = new THREE.PlaneGeometry(BOARD.w, BOARD.h);
  back.translate(BOARD.x, BOARD.y, BOARD.z + 0.022);
  return mergeGeometries([front, back], false)!;
}

/** the corner stool (seat tinted by the instance colour, legs darker) */
export function stoolGeometry(): THREE.BufferGeometry {
  const K = RING;
  const p = new Parts();
  p.cyl(0.19, 0.18, 0.05, 0, K.stoolH - 0.025, 0, "#ffffff", 18);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    p.rod(v(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17), v(Math.cos(a) * 0.12, K.stoolH - 0.05, Math.sin(a) * 0.12), 0.014, "#3a3a3a", 6);
  }
  p.add(new THREE.TorusGeometry(0.145, 0.01, 6, 18).rotateX(Math.PI / 2), "#3a3a3a", new THREE.Matrix4().makeTranslation(0, 0.2, 0));
  return p.geometry();
}

/**
 * The feature rings' ringside (P3-FGT-08), in the pro ring frame: three judges' tables on the stage just outside the
 * apron (local −z, +x and −x sides), each with a chair facing the ring, a scoresheet and a pen; the timekeeper's bell
 * on the −z table; an overhead lighting truss with its lamp housings. Instanced over both feature rings (the hall turns
 * one of them so its −z side faces the stage front).
 */
export function featureExtrasGeometry(): THREE.BufferGeometry {
  const K = RING;
  const p = new Parts();
  const off = K.half + 0.45; // table centre line, 0.15 m off the skirt
  const table = (rot: number, bell: boolean) => {
    const m = (x: number, y: number, z: number) => new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    const add = (g: THREE.BufferGeometry, col: C, x: number, y: number, z: number) => p.add(g, col, m(x, y, z));
    // the table: top, a modesty panel in the venue's dark red cloth, two trestle legs
    add(new THREE.BoxGeometry(1.8, 0.04, 0.55), "#2b2e34", 0, 0.76, -off);
    add(new THREE.BoxGeometry(1.8, 0.62, 0.02), "#5e1a1c", 0, 0.42, -off - 0.26);
    for (const x of [-0.8, 0.8]) add(new THREE.BoxGeometry(0.05, 0.74, 0.5), "#1d1f24", x, 0.37, -off);
    // scoresheet + pen in front of the judge's seat (light paper on the dark top), a water glass
    add(new THREE.BoxGeometry(0.21, 0.004, 0.3), "#efece4", 0, 0.782, -off + 0.02);
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 5).rotateZ(Math.PI / 2), "#1b1c1f", 0.16, 0.786, -off + 0.02);
    add(new THREE.CylinderGeometry(0.03, 0.026, 0.1, 8), "#c9d6de", -0.5, 0.83, -off);
    // the judge's chair behind the table, facing the ring
    add(new THREE.BoxGeometry(0.44, 0.05, 0.42), "#3a3d43", 0, 0.46, -off - 0.52);
    add(new THREE.BoxGeometry(0.44, 0.46, 0.05), "#3a3d43", 0, 0.72, -off - 0.73);
    for (const [dx, dz] of [
      [-0.19, -0.19],
      [0.19, -0.19],
      [-0.19, 0.19],
      [0.19, 0.19],
    ] as const)
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 6), "#2a2a2a", dx, 0.23, -off - 0.52 + dz);
    if (bell) {
      // the timekeeper's bell on a wooden block
      add(new THREE.BoxGeometry(0.2, 0.06, 0.14), "#6b4a2e", 0.62, 0.81, -off);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), "#4a4e56", 0.62, 0.87, -off);
      p.add(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), "#b08d55", m(0.62, 0.99, -off).multiply(new THREE.Matrix4().makeRotationX(Math.PI)));
    }
  };
  table(0, true);
  table(Math.PI / 2, false);
  table(-Math.PI / 2, false);
  // overhead truss: a square frame of box trusses over the ring
  const T = K.half + 0.4,
    y = 5.4;
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    for (const [dy, dz] of [
      [0, 0],
      [0.3, 0],
      [0, 0.3],
      [0.3, 0.3],
    ] as const) {
      const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(0, y + dy, T + dz));
      p.add(new THREE.CylinderGeometry(0.022, 0.022, 2 * T + 0.3, 6).rotateZ(Math.PI / 2), "#2c2f35", m);
    }
    // the hanging lights (dark housings with a warm lens; the hall does the lighting)
    for (const x of [-1.6, 0, 1.6]) {
      const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(x, y - 0.2, T + 0.15));
      p.add(new THREE.CylinderGeometry(0.1, 0.13, 0.25, 10), "#1d1f24", m);
      p.add(new THREE.CircleGeometry(0.1, 10).rotateX(Math.PI / 2), "#f4e6c8", new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(x, y - 0.326, T + 0.15)));
    }
    // drop cables from the hall trusses
    p.add(new THREE.CylinderGeometry(0.008, 0.008, 3.2, 4), "#1b1c1f", new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(T, y + 1.9, T)));
  }
  return p.geometry();
}

/** triangle count of a geometry (indexed or not) */
export function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute("position").count) / 3;
}
