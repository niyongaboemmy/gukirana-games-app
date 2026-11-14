/**
 * The game hand's skeleton and pose maths (P2-GAME-07). Pure TypeScript (no three.js), shared by the mesh builder,
 * the live overlay and the unit tests.
 *
 * Hand space (metres, a right hand at rest, palm down on the table): origin at the wrist joint, +Y towards the
 * fingertips, +Z out of the back of the hand (dorsal), −Z the palm; the thumb is on the −X side.
 * Bone layout follows the Rocketbox / Biped hands the avatars use (forearm, hand, finger 0–4 with three
 * phalanges), plus four metacarpals so the palm can cup (the palmar arch) when scooping seeds.
 */
export type V3 = [number, number, number];
/** Quaternion [x, y, z, w]. */
export type Q = [number, number, number, number];

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

export const quat = {
  id: (): Q => [0, 0, 0, 1],
  axis: (ax: V3, angle: number): Q => {
    const s = Math.sin(angle / 2);
    const n = v3.norm(ax);
    return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
  },
  mul: (a: Q, b: Q): Q => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conj: (a: Q): Q => [-a[0], -a[1], -a[2], a[3]],
  rotate: (q: Q, v: V3): V3 => {
    // v' = q v q*
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  /** Rotation whose local +Y maps to `y` and local +Z as close as possible to `zHint`. */
  basis: (y: V3, zHint: V3): Q => {
    const Y = v3.norm(y);
    const X = v3.norm(v3.cross(Y, zHint));
    const Z = v3.cross(X, Y);
    // rotation matrix columns X, Y, Z → quaternion
    const m00 = X[0], m01 = Y[0], m02 = Z[0];
    const m10 = X[1], m11 = Y[1], m12 = Z[1];
    const m20 = X[2], m21 = Y[2], m22 = Z[2];
    const tr = m00 + m11 + m22;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
    }
    if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
    }
    if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
    }
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  },
};

/* ---------- skeleton ---------- */

export const FINGERS = ["index", "middle", "ring", "pinky"] as const;
/** Bone ids, in parent-before-child order. */
export const B = {
  arm: 0,
  hand: 1,
  /** metacarpal of finger i (0 index … 3 pinky) */
  meta: (i: number) => 2 + i,
  /** phalanx k (0 proximal, 1 middle, 2 distal) of finger i */
  phal: (i: number, k: number) => 6 + 3 * i + k,
  /** thumb bone k (0 metacarpal, 1 proximal, 2 distal) */
  thumb: (k: number) => 18 + k,
};
export const BONE_COUNT = 21;

/** Knuckle (MCP joint) centres, metacarpal bases, phalanx lengths [proximal, middle, distal] and radii [mcp, pip, dip, tip]. */
export const FINGER_DIMS = [
  { knuckle: [-0.0285, 0.094, 0.0] as V3, base: [-0.0135, 0.012, 0.0] as V3, len: [0.0395, 0.0235, 0.0215], r: [0.0104, 0.0096, 0.0086, 0.0077], spread: 0.13 },
  { knuckle: [-0.0075, 0.099, 0.0008] as V3, base: [-0.004, 0.012, 0.0005] as V3, len: [0.0435, 0.027, 0.0225], r: [0.0107, 0.0099, 0.0088, 0.0079], spread: 0.03 },
  { knuckle: [0.0128, 0.0945, 0.0] as V3, base: [0.0055, 0.012, 0.0] as V3, len: [0.0405, 0.026, 0.022], r: [0.01, 0.0093, 0.0083, 0.0075], spread: -0.075 },
  { knuckle: [0.0318, 0.0845, -0.0018] as V3, base: [0.0145, 0.012, -0.001] as V3, len: [0.0325, 0.02, 0.0195], r: [0.0091, 0.0083, 0.0075, 0.0068], spread: -0.19 },
] as const;
/** Thumb: carpometacarpal joint, rest direction, nail-facing hint, lengths [metacarpal, proximal, distal], radii [cmc, mcp, ip, tip]. */
export const THUMB_DIMS = {
  cmc: [-0.0195, 0.019, -0.008] as V3,
  dir: v3.norm([-0.5, 0.83, -0.24]),
  nail: v3.norm([-0.66, 0.02, 0.75]),
  len: [0.043, 0.031, 0.0275] as [number, number, number],
  r: [0.0148, 0.0124, 0.0114, 0.0101] as [number, number, number, number],
};

export interface BoneRest {
  parent: number;
  /** hand-space rest position and rotation (local +Y along the bone, +Z dorsal / nail side) */
  pos: V3;
  rot: Q;
  /** bone length (to the child joint or the tip) */
  len: number;
}

function buildRest(): BoneRest[] {
  const bones: BoneRest[] = new Array(BONE_COUNT);
  bones[B.arm] = { parent: -1, pos: [0, 0, 0], rot: quat.id(), len: 0.26 };
  bones[B.hand] = { parent: B.arm, pos: [0, 0, 0], rot: quat.id(), len: 0.09 };
  FINGER_DIMS.forEach((f, i) => {
    const md = v3.sub(f.knuckle, f.base);
    bones[B.meta(i)] = { parent: B.hand, pos: f.base, rot: quat.basis(md, [0, 0, 1]), len: v3.len(md) };
    const rot = quat.axis([0, 0, 1], f.spread);
    const dir = quat.rotate(rot, [0, 1, 0]);
    let p = f.knuckle;
    for (let k = 0; k < 3; k++) {
      bones[B.phal(i, k)] = { parent: k === 0 ? B.meta(i) : B.phal(i, k - 1), pos: p, rot, len: f.len[k]! };
      p = v3.add(p, v3.scale(dir, f.len[k]!));
    }
  });
  const trot = quat.basis(THUMB_DIMS.dir, THUMB_DIMS.nail);
  let p = THUMB_DIMS.cmc;
  for (let k = 0; k < 3; k++) {
    bones[B.thumb(k)] = { parent: k === 0 ? B.hand : B.thumb(k - 1), pos: p, rot: trot, len: THUMB_DIMS.len[k]! };
    p = v3.add(p, v3.scale(THUMB_DIMS.dir, THUMB_DIMS.len[k]!));
  }
  return bones;
}
export const REST: BoneRest[] = buildRest();

/** Bone rest transform relative to its parent (what a three.js Bone stores). */
export function restLocal(i: number): { pos: V3; rot: Q } {
  const b = REST[i]!;
  if (b.parent < 0) return { pos: b.pos, rot: b.rot };
  const p = REST[b.parent]!;
  const inv = quat.conj(p.rot);
  return { pos: quat.rotate(inv, v3.sub(b.pos, p.pos)), rot: quat.mul(inv, b.rot) };
}

/* ---------- poses ---------- */

/**
 * A pose is a flat vector of joint angles (radians) so poses blend with a plain lerp:
 * [0] wrist flex (+ bends the palm down / towards −Z) · [1] wrist deviation (+ towards the thumb) · [2] palm cup (0–1)
 * [3 + 4i ..] finger i: MCP flex, PIP flex, DIP flex, spread (+ fans away from the middle finger)
 * [19..23] thumb: CMC flex (across the palm) · CMC abduction (+ away from the index) · MCP flex · IP flex · roll
 */
export const POSE_LEN = 24;
export type Pose = Float32Array;
const FI = (i: number) => 3 + 4 * i;
export const TH = 19;

const D = Math.PI / 180;
export interface PoseSpec {
  wrist?: [number, number];
  cup?: number;
  /** per finger [mcp, pip, dip] in degrees, or one triple for all four */
  fingers: [number, number, number][] | [number, number, number];
  /** extra fan (degrees at the index / pinky; the middle stays) */
  spread?: number;
  /** [cmcFlex, cmcAbd, mcp, ip, roll] degrees */
  thumb: [number, number, number, number, number?];
}
export function makePose(s: PoseSpec): Pose {
  const p = new Float32Array(POSE_LEN);
  p[0] = (s.wrist?.[0] ?? 0) * D;
  p[1] = (s.wrist?.[1] ?? 0) * D;
  p[2] = s.cup ?? 0;
  const fan = [1, 0.15, -0.45, -1];
  for (let i = 0; i < 4; i++) {
    const f = (Array.isArray(s.fingers[0]) ? (s.fingers as [number, number, number][])[i] : (s.fingers as [number, number, number]))!;
    p[FI(i)] = f[0] * D;
    p[FI(i) + 1] = f[1] * D;
    p[FI(i) + 2] = f[2] * D;
    p[FI(i) + 3] = (s.spread ?? 0) * fan[i]! * D;
  }
  for (let k = 0; k < 5; k++) p[TH + k] = (s.thumb[k] ?? 0) * D;
  return p;
}

/** The poses the game hands key between (degrees, tuned by eye against reference photos). */
export const POSES = {
  /** relaxed, natural rest curl: entering / leaving */
  relaxed: makePose({ wrist: [-6, 0], cup: 0.25, fingers: [[18, 26, 12], [20, 30, 14], [22, 32, 15], [24, 34, 16]], spread: 2, thumb: [12, 8, 10, 8] }),
  /** reaching out, fingers long and spread, ready to grab */
  open: makePose({ wrist: [-14, 0], cup: 0.1, fingers: [[4, 6, 3], [3, 6, 3], [4, 7, 4], [6, 8, 4]], spread: 8, thumb: [6, 14, 6, 4] }),
  /** cupped over the die / scooping: a bowl of fingers and palm */
  cup: makePose({ wrist: [-4, 0], cup: 1, fingers: [[34, 44, 22], [36, 46, 24], [38, 48, 24], [40, 50, 26]], spread: 3, thumb: [30, 16, 18, 14] }),
  /** loose fist round the die (the knuckles stay soft, the thumb wraps the index) */
  fist: makePose({ wrist: [4, 0], cup: 0.7, fingers: [[78, 102, 62], [82, 104, 64], [85, 106, 64], [88, 106, 66]], spread: -2, thumb: [48, -10, 34, 32, 12] }),
  /** wind-up before the throw: the fist cocks back at the wrist */
  windup: makePose({ wrist: [-34, -4], cup: 0.7, fingers: [[74, 94, 54], [78, 98, 56], [82, 100, 58], [86, 102, 60]], spread: -2, thumb: [46, -8, 34, 30, 10] }),
  /** the release: fingers fling open and long, wrist snaps down */
  flick: makePose({ wrist: [26, 4], cup: 0, fingers: [[-8, 2, 2], [-10, 2, 2], [-8, 3, 2], [-6, 4, 3]], spread: 10, thumb: [4, 16, -4, -4] }),
  /** igisoro: seeds held in the curled fingers, thumb on top */
  hold: makePose({ wrist: [6, 0], cup: 0.9, fingers: [[52, 70, 40], [54, 72, 42], [58, 74, 44], [62, 76, 46]], spread: 0, thumb: [40, 4, 24, 26, 8] }),
  /** igisoro: thumb rolls a seed off the index, the fingers part a little */
  release: makePose({ wrist: [14, 0], cup: 0.8, fingers: [[40, 56, 30], [50, 66, 38], [56, 72, 42], [60, 74, 44]], spread: 3, thumb: [22, 22, 6, 4, 4] }),
  /** igisoro: the flat sweeping hand that gathers a captured pit */
  sweep: makePose({ wrist: [-2, -6], cup: 0.4, fingers: [[18, 22, 10], [16, 22, 10], [18, 24, 12], [20, 26, 12]], spread: -4, thumb: [26, -4, 10, 8] }),
  /** pool: open bridge, fingers spread and planted on the cloth, thumb raised against the index knuckle (the V) */
  bridge: makePose({ wrist: [-24, 24], cup: 0.3, fingers: [[30, 18, 10], [26, 16, 8], [26, 18, 10], [30, 20, 12]], spread: 14, thumb: [-38, -10, -6, -6, -20] }),
  /** pool: relaxed grip round the cue butt */
  grip: makePose({ wrist: [0, 0], cup: 0.55, fingers: [[62, 78, 40], [66, 82, 44], [72, 88, 48], [78, 92, 52]], spread: -1, thumb: [44, -14, 22, 18, 14] }),
} satisfies Record<string, Pose>;
export type PoseName = keyof typeof POSES;

export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  for (let i = 0; i < POSE_LEN; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
  return out;
}

/** Ease curves used by the clips. */
export const ease = {
  linear: (t: number) => t,
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  /** slight overshoot, settles on 1 */
  back: (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};
export type EaseName = keyof typeof ease;

/**
 * Local joint rotations for a pose (relative to each bone's rest), as quaternions written into `out`
 * (BONE_COUNT × 4 floats). Allocation-free: the overlay calls this every frame.
 */
export function poseRotations(p: Pose, out: Float32Array): Float32Array {
  const set = (i: number, q: Q) => out.set(q, i * 4);
  set(B.arm, [0, 0, 0, 1]);
  // wrist: flex about X (palm-wards = rotate +Y towards −Z = negative angle), deviation about Z
  set(B.hand, mulAxes(-p[0]!, 0, p[1]!));
  // palmar arch: the ring / pinky metacarpals roll and drop when the palm cups (index slightly the other way)
  const cup = p[2]!;
  const roll = [-0.07, 0, 0.14, 0.3];
  const drop = [0, 0, 0.05, 0.12];
  for (let i = 0; i < 4; i++) {
    set(B.meta(i), mulAxes(-drop[i]! * cup, roll[i]! * cup, 0));
    const o = FI(i);
    // spread about Z first, then flex about the (spread) X axis
    set(B.phal(i, 0), mulAxes(-p[o]!, 0, p[o + 3]!));
    set(B.phal(i, 1), mulAxes(-p[o + 1]!, 0, 0));
    set(B.phal(i, 2), mulAxes(-p[o + 2]!, 0, 0));
  }
  set(B.thumb(0), mulAxes(-p[TH]!, p[TH + 4]!, p[TH + 1]!));
  set(B.thumb(1), mulAxes(-p[TH + 2]!, 0, 0));
  set(B.thumb(2), mulAxes(-p[TH + 3]!, 0, 0));
  return out;
}

/** q = Rz(z) · Ry(y) · Rx(x) without allocating intermediates (returns a fresh tuple only for set()). */
const tmpQ: Q = [0, 0, 0, 1];
function mulAxes(x: number, y: number, z: number): Q {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  // Rz * Ry * Rx (intrinsic X then Y then Z applied to vectors in local space)
  tmpQ[0] = sx * cy * cz - cx * sy * sz;
  tmpQ[1] = cx * sy * cz + sx * cy * sz;
  tmpQ[2] = cx * cy * sz - sx * sy * cz;
  tmpQ[3] = cx * cy * cz + sx * sy * sz;
  return tmpQ;
}

/**
 * Forward kinematics in hand space (tests, sprite framing, the palm-centre offset used to place the hand): world
 * position of each bone origin plus the fingertips, for a pose.
 */
export function forward(p: Pose): { pos: V3[]; rot: Q[]; tips: V3[] } {
  const local = poseRotations(p, new Float32Array(BONE_COUNT * 4));
  const pos: V3[] = [];
  const rot: Q[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const rl = restLocal(i);
    const lq: Q = [local[i * 4]!, local[i * 4 + 1]!, local[i * 4 + 2]!, local[i * 4 + 3]!];
    const r = quat.mul(rl.rot, lq);
    const parent = REST[i]!.parent;
    if (parent < 0) {
      pos[i] = rl.pos;
      rot[i] = r;
    } else {
      pos[i] = v3.add(pos[parent]!, quat.rotate(rot[parent]!, rl.pos));
      rot[i] = quat.mul(rot[parent]!, r);
    }
  }
  const tip = (b: number) => v3.add(pos[b]!, quat.rotate(rot[b]!, [0, REST[b]!.len, 0]));
  const tips = [0, 1, 2, 3].map((i) => tip(B.phal(i, 2))).concat([tip(B.thumb(2))]);
  return { pos, rot, tips };
}
