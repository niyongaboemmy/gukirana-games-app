import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CORNERS, RING, type CornerId } from "./ring-kit-core";

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
  tread: "#4a4e56",
  rail: "#3a3d43",
  bucket: "#c9ccd1",
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
function platform(p: Parts, near: boolean) {
  const H = RING.half,
    D = RING.deck - 0.03;
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
    const m = new THREE.Matrix4().makeRotationY(a).setPosition(0, RING.deck - 0.02, 0);
    p.add(new THREE.BoxGeometry(2 * H + 0.06, 0.06, 0.06), COL.apron, m.multiply(new THREE.Matrix4().makeTranslation(0, 0, H)));
  }
}

function postsAndPads(p: Parts, near: boolean) {
  const P = RING.post,
    top = RING.deck + RING.postH;
  for (const c of Object.keys(CORNERS) as CornerId[]) {
    const [sx, sz] = CORNERS[c];
    const x = sx * P,
      z = sz * P;
    if (near) {
      p.cyl(0.055, 0.055, RING.postH + 0.05, x, RING.deck + RING.postH / 2, z, COL.post, 12);
      p.cyl(0.1, 0.11, 0.05, x, RING.deck + 0.025, z, COL.post, 12);
      p.cyl(0.065, 0.055, 0.04, x, top + 0.02, z, COL.post, 12);
    } else p.box(0.11, RING.postH, 0.11, x, RING.deck + RING.postH / 2, z, COL.post);
    // the turnbuckle cover on the inner face of the post, square to the ring diagonal
    const inward = Math.atan2(-sx, -sz);
    const d = near ? 0.12 : 0.1;
    const cx = x - sx * d * Math.SQRT1_2,
      cz = z - sz * d * Math.SQRT1_2;
    if (near) {
      const g = new THREE.CapsuleGeometry(0.09, 1.0, 4, 10);
      g.scale(1.15, 1, 0.85);
      p.add(g, PAD_COLORS[c], new THREE.Matrix4().makeRotationY(inward).setPosition(cx, RING.deck + 0.9, cz));
    } else p.box(0.2, 1.1, 0.14, cx, RING.deck + 0.9, cz, PAD_COLORS[c], inward);
  }
}

/** rope ends sit on the pad faces; near: sagging tubes + rope covers + spacers; far: straight boxes */
function ropes(p: Parts, near: boolean) {
  const P = RING.post - 0.13;
  SIDES.forEach(([a, b], side) => {
    const [ax, az] = CORNERS[a];
    const [bx, bz] = CORNERS[b];
    const A = v(ax * P, 0, az * P),
      B = v(bx * P, 0, bz * P);
    RING.ropes.forEach((h, i) => {
      const y = RING.deck + h;
      const color = i % 2 === 0 ? COL.ropeB : COL.ropeA;
      if (near) {
        const pts: THREE.Vector3[] = [];
        const n = 12;
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          // a shallow catenary (a parabola is indistinguishable at this sag)
          pts.push(A.clone().lerp(B, t).setY(y - 4 * RING.sag[i]! * t * (1 - t)));
        }
        p.tube(pts, 0.021, color, 7);
      } else {
        const mid = A.clone().lerp(B, 0.5).setY(y - RING.sag[i]! * 0.6);
        const len = A.distanceTo(B);
        p.box(len, 0.035, 0.035, mid.x, mid.y, mid.z, color, side % 2 === 0 ? 0 : Math.PI / 2);
      }
    });
    if (near) {
      // rope spacers (vertical straps) at a third and two thirds of each side
      for (const t of [1 / 3, 2 / 3]) {
        const at = A.clone().lerp(B, t);
        const sag = 4 * t * (1 - t);
        const yTop = RING.deck + RING.ropes[3] - RING.sag[0] * sag + 0.04,
          yBot = RING.deck + RING.ropes[0] - RING.sag[3] * sag - 0.04;
        p.box(side % 2 === 0 ? 0.05 : 0.03, yTop - yBot, side % 2 === 0 ? 0.03 : 0.05, at.x, (yTop + yBot) / 2, at.z, COL.spacer);
      }
    }
  });
}

function steps(p: Parts, near: boolean) {
  for (const c of ["red", "blue"] as const) {
    const [sx, sz] = CORNERS[c];
    const z = sz * (RING.post - 0.7);
    const x0 = sx * RING.half;
    if (!near) {
      // a ramp-ish block
      const g = new THREE.BoxGeometry(0.85, RING.deck * 0.55, 0.8);
      p.add(g, COL.steps, new THREE.Matrix4().makeTranslation(x0 + sx * 0.42, RING.deck * 0.275, z));
      continue;
    }
    const n = 3;
    const rise = RING.deck / n,
      run = 0.3;
    for (let k = 0; k < n; k++) {
      const h = rise * (k + 1);
      const xc = x0 + sx * (run * (n - k) - run / 2);
      p.box(run, h, 0.8, xc, h / 2, z, COL.steps);
      p.box(run - 0.02, 0.012, 0.76, xc, h + 0.006, z, COL.tread);
    }
    // hand rails both sides
    for (const dz of [-0.42, 0.42]) {
      const a = v(x0 + sx * (run * n + 0.05), 0.95, z + dz),
        b = v(x0 + sx * 0.02, RING.deck + 0.95, z + dz);
      p.rod(a, b, 0.018, COL.rail);
      p.rod(v(a.x, 0, a.z), a, 0.02, COL.rail);
      p.rod(v(b.x, RING.deck, b.z), b, 0.02, COL.rail);
    }
  }
}

function setDressing(p: Parts) {
  for (const c of ["red", "blue"] as const) {
    const [sx, sz] = CORNERS[c];
    // bucket + water bottle on the floor beside the steps
    const x = sx * (RING.half + 0.35),
      z = sz * (RING.post - 1.55);
    const bucket = new THREE.CylinderGeometry(0.16, 0.13, 0.3, 14, 1, true);
    p.add(bucket, COL.bucket, new THREE.Matrix4().makeTranslation(x, 0.15, z));
    p.cyl(0.13, 0.13, 0.01, x, 0.012, z, COL.bucket, 14);
    p.cyl(0.15, 0.15, 0.02, x, 0.22, z, c === "red" ? COL.red : COL.blue, 14); // water inside, tinted
    p.cyl(0.035, 0.035, 0.2, x + sx * 0.28, 0.1, z + 0.05, COL.bottle, 8);
    p.cyl(0.02, 0.028, 0.04, x + sx * 0.28, 0.22, z + 0.05, c === "red" ? COL.red : COL.blue, 8);
  }
}

/** the spectator rail (gaps at the steps); near: round tubes + posts every ~1.6 m, far: thin boxes */
function rail(p: Parts, near: boolean) {
  const R = RING.rail,
    h = RING.railH;
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    const rot = new THREE.Matrix4().makeRotationY(a);
    // side s runs along x at z = R (rotated); the red / blue steps gaps are on the ±x sides (s = 1, 3)
    const gap = s === 1 || s === 3;
    const spans: [number, number][] = gap
      ? [
          [-R, -RING.post + 0.05],
          [-RING.post + 1.35, RING.post - 1.35],
          [RING.post - 0.05, R],
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
export const BOARD = { x: 0, y: RING.railH + 0.34, z: -RING.rail, w: 0.62, h: 0.42 };
export const LAMP = { x: CORNERS.neutralA[0] * RING.post, y: RING.deck + RING.postH + 0.1, z: CORNERS.neutralA[1] * RING.post };
function fixtures(p: Parts, near: boolean) {
  p.box(BOARD.w + 0.05, BOARD.h + 0.05, 0.04, BOARD.x, BOARD.y, BOARD.z, COL.board);
  p.box(0.05, BOARD.y - BOARD.h / 2, 0.05, BOARD.x, (BOARD.y - BOARD.h / 2) / 2, BOARD.z, COL.rail);
  if (near) p.cyl(0.055, 0.07, 0.06, LAMP.x, LAMP.y - 0.06, LAMP.z, COL.lampHouse, 12);
}

export function nearRingGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  platform(p, true);
  postsAndPads(p, true);
  ropes(p, true);
  steps(p, true);
  setDressing(p);
  rail(p, true);
  fixtures(p, true);
  return p.geometry();
}

export function farRingGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  platform(p, false);
  postsAndPads(p, false);
  ropes(p, false);
  steps(p, false);
  rail(p, false);
  fixtures(p, false);
  return p.geometry();
}

/** the canvas top (uv 0…1 over the whole platform top, for the printed canvas texture) */
export function canvasGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2 * RING.half, 2 * RING.half, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, RING.deck + 0.002, 0);
  return g;
}

/** a lamp: a small dome on top of the neutral post + a light strip along the apron edge on that side */
export function lampGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  const dome = new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  p.add(dome, "#ffffff", new THREE.Matrix4().makeTranslation(LAMP.x, LAMP.y - 0.03, LAMP.z));
  // the strip on the front skirt (side towards −z, the board side)
  p.add(new THREE.PlaneGeometry(2 * RING.half - 0.4, 0.03), "#ffffff", new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, RING.deck - 0.235, -RING.half - 0.028));
  return p.geometry();
}

/** a number board face pair (front + back, each reading the right way) */
export function boardGeometry(): THREE.BufferGeometry {
  const front = new THREE.PlaneGeometry(BOARD.w, BOARD.h);
  front.rotateY(Math.PI);
  front.translate(BOARD.x, BOARD.y, BOARD.z - 0.022);
  const back = new THREE.PlaneGeometry(BOARD.w, BOARD.h);
  back.translate(BOARD.x, BOARD.y, BOARD.z + 0.022);
  return mergeGeometries([front, back], false)!;
}

/** the corner stool (seat tinted by the instance colour, legs darker) */
export function stoolGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  p.cyl(0.19, 0.18, 0.05, 0, RING.stoolH - 0.025, 0, "#ffffff", 18);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    p.rod(v(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17), v(Math.cos(a) * 0.12, RING.stoolH - 0.05, Math.sin(a) * 0.12), 0.014, "#3a3a3a", 6);
  }
  p.add(new THREE.TorusGeometry(0.145, 0.01, 6, 18).rotateX(Math.PI / 2), "#3a3a3a", new THREE.Matrix4().makeTranslation(0, 0.2, 0));
  return p.geometry();
}

/** the feature ring's extras: judges' table + chairs on one side, the bell, an overhead lighting truss */
export function featureExtrasGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  const z = -(RING.rail + 1.4);
  p.box(3.2, 0.06, 0.7, 0, 0.76, z, "#2b2e34");
  p.box(3.2, 0.7, 0.04, 0, 0.38, z - 0.33, "#1f4fb0");
  for (const x of [-1.3, 1.3]) p.box(0.06, 0.74, 0.6, x, 0.37, z, "#2b2e34");
  for (const x of [-1, 0, 1]) {
    p.box(0.45, 0.05, 0.45, x, 0.46, z - 0.7, "#3a3d43");
    p.box(0.45, 0.5, 0.05, x, 0.72, z - 0.92, "#3a3d43");
    for (const [dx, dz] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [-0.2, 0.2],
      [0.2, 0.2],
    ] as const)
      p.cyl(0.015, 0.015, 0.46, x + dx, 0.23, z - 0.7 + dz, "#2a2a2a", 6);
  }
  // the bell on the table
  p.cyl(0.02, 0.02, 0.08, 1.05, 0.83, z, "#4a4e56", 8);
  p.add(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), "#a0845a", new THREE.Matrix4().makeRotationX(Math.PI).setPosition(1.05, 0.98, z));
  // overhead truss: a square frame of box trusses over the ring
  const T = RING.half + 0.4,
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
    // the hanging lights (dark housings; the hall does the lighting)
    for (const x of [-1.6, 0, 1.6]) {
      const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(x, y - 0.2, T + 0.15));
      p.add(new THREE.CylinderGeometry(0.1, 0.13, 0.25, 10), "#1d1f24", m);
    }
  }
  return p.geometry();
}

/** triangle count of a geometry (indexed or not) */
export function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute("position").count) / 3;
}
