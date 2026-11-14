/**
 * Boxing pose vector (P3-FGT-02): one flat Float32Array per pose, authored for an ORTHODOX fighter (left foot and
 * left hand lead) in the avatar frame of a reference body (≈ 1.8 m): metres / radians, +z forward (towards the
 * opponent), +y up, +x the person's LEFT. "lead" / "rear" name the sides of the stance, not left / right: mirroring
 * (southpaw) flips x and the yaw-like angles, and the rig layer then drives the RIGHT arm / leg as the lead.
 *
 * Positions are absolute in the avatar frame of the current root (the hips / wrists / ankles), except the feet of a
 * clip with root travel (footwork), which are authored in the clip's START frame so they stay planted while the root
 * moves (see clips.ts `travel`). Pure data + maths, no three.js: unit-testable and the same on every screen.
 */

export const P = {
  /** hips (Bip01) position: x, absolute height above the floor, z */
  hx: 0,
  hy: 1,
  hz: 2,
  /** pelvis yaw (+ = turning towards the person's left) */
  yaw: 3,
  /** extra chest yaw over the pelvis */
  chest: 4,
  /** torso pitch (+ = leaning forward) */
  lean: 5,
  /** side bend (+ = towards the lead side) */
  bend: 6,
  /** head pitch (+ = chin down), yaw (+ = left), roll (+ = ear to the lead shoulder); absolute in the root frame */
  hp: 7,
  hyaw: 8,
  hroll: 9,
  /** lead wrist (x, y, z), elbow pole direction (x, y, z), palm direction (x, y, z) */
  lx: 10,
  ly: 11,
  lz: 12,
  lpx: 13,
  lpy: 14,
  lpz: 15,
  lnx: 16,
  lny: 17,
  lnz: 18,
  /** rear wrist, elbow pole, palm direction */
  rx: 19,
  ry: 20,
  rz: 21,
  rpx: 22,
  rpy: 23,
  rpz: 24,
  rnx: 25,
  rny: 26,
  rnz: 27,
  /** lead ankle: x, lift above its standing height, z; toe yaw; heel raise (rad, + = up on the ball) */
  fLx: 28,
  fLy: 29,
  fLz: 30,
  fLyaw: 31,
  fLheel: 32,
  /** rear ankle */
  fRx: 33,
  fRy: 34,
  fRz: 35,
  fRyaw: 36,
  fRheel: 37,
  /** knee pole directions (lead, rear) */
  kLx: 38,
  kLy: 39,
  kLz: 40,
  kRx: 41,
  kRy: 42,
  kRz: 43,
  /** 0 open hand … 1 closed fist */
  fist: 44,
  /** face: focus, effort, wince, smile, jaw open (0…1), eyes closed (0…1) */
  focus: 45,
  effort: 46,
  wince: 47,
  smile: 48,
  jaw: 49,
  eyes: 50,
  /** lead / rear shoulder shrug (0…1: the shoulder comes up to protect the chin) */
  shrugL: 51,
  shrugR: 52,
} as const;
export type PoseKey = keyof typeof P;
export const POSE_SIZE = 53;
export type Pose = Float32Array;

/** channels whose sign flips when a pose is mirrored (southpaw): x positions / directions and yaw-like angles */
export const MIRROR_FLIP: readonly number[] = [P.hx, P.yaw, P.chest, P.bend, P.hyaw, P.hroll, P.lx, P.lpx, P.lnx, P.rx, P.rpx, P.rnx, P.fLx, P.fLyaw, P.fRx, P.fRyaw, P.kLx, P.kRx];
const FLIP = new Set(MIRROR_FLIP);
/** channels holding foot data (the only ones travel compensation touches) */
export const FOOT_CHANNELS: readonly number[] = [P.fLx, P.fLz, P.fLyaw, P.fRx, P.fRz, P.fRyaw];

export const newPose = (): Pose => new Float32Array(POSE_SIZE);

export function copyPose(src: Pose, out: Pose = newPose()): Pose {
  out.set(src);
  return out;
}

/** out = a + (b − a)·w (channel-wise) */
export function lerpPose(a: Pose, b: Pose, w: number, out: Pose): Pose {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i]! + (b[i]! - a[i]!) * w;
  return out;
}

/** southpaw mirror (in place when out === p) */
export function mirrorPose(p: Pose, out: Pose = p): Pose {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = FLIP.has(i) ? -p[i]! : p[i]!;
  return out;
}

export type V3 = readonly [number, number, number];

/** Named pose fields for authoring (any subset; unset fields keep their previous value). */
export interface PoseSpec {
  hips?: V3;
  yaw?: number;
  chest?: number;
  lean?: number;
  bend?: number;
  /** head pitch, yaw, roll */
  head?: V3;
  lead?: V3;
  leadPole?: V3;
  leadPalm?: V3;
  rear?: V3;
  rearPole?: V3;
  rearPalm?: V3;
  /** ankle x, lift, z */
  leadFoot?: V3;
  leadFootYaw?: number;
  leadHeel?: number;
  rearFoot?: V3;
  rearFootYaw?: number;
  rearHeel?: number;
  leadKnee?: V3;
  rearKnee?: V3;
  fist?: number;
  focus?: number;
  effort?: number;
  wince?: number;
  smile?: number;
  jaw?: number;
  eyes?: number;
  shrugLead?: number;
  shrugRear?: number;
}

const V3_FIELDS: [keyof PoseSpec, number][] = [
  ["hips", P.hx],
  ["head", P.hp],
  ["lead", P.lx],
  ["leadPole", P.lpx],
  ["leadPalm", P.lnx],
  ["rear", P.rx],
  ["rearPole", P.rpx],
  ["rearPalm", P.rnx],
  ["leadFoot", P.fLx],
  ["rearFoot", P.fRx],
  ["leadKnee", P.kLx],
  ["rearKnee", P.kRx],
];
const NUM_FIELDS: [keyof PoseSpec, number][] = [
  ["yaw", P.yaw],
  ["chest", P.chest],
  ["lean", P.lean],
  ["bend", P.bend],
  ["leadFootYaw", P.fLyaw],
  ["leadHeel", P.fLheel],
  ["rearFootYaw", P.fRyaw],
  ["rearHeel", P.fRheel],
  ["fist", P.fist],
  ["focus", P.focus],
  ["effort", P.effort],
  ["wince", P.wince],
  ["smile", P.smile],
  ["jaw", P.jaw],
  ["eyes", P.eyes],
  ["shrugLead", P.shrugL],
  ["shrugRear", P.shrugR],
];

/** Write the fields of `spec` over a copy of `base`. */
export function pose(base: Pose, spec: PoseSpec): Pose {
  const out = copyPose(base);
  for (const [k, i] of V3_FIELDS) {
    const v = spec[k] as V3 | undefined;
    if (v) {
      out[i] = v[0];
      out[i + 1] = v[1];
      out[i + 2] = v[2];
    }
  }
  for (const [k, i] of NUM_FIELDS) {
    const v = spec[k] as number | undefined;
    if (v !== undefined) out[i] = v;
  }
  return out;
}

/**
 * The orthodox guard: bladed ~26° (left shoulder forward), knees soft, weight centred, chin tucked; the lead glove a
 * hand's length in front of the face, the rear glove by the chin, elbows down over the ribs, palms turned in.
 * Rear heel slightly up (ready to push off).
 */
export const GUARD: Pose = pose(newPose(), {
  hips: [0, 0.855, -0.01],
  yaw: -0.46,
  chest: -0.08,
  lean: 0.13,
  bend: 0,
  head: [0.16, 0.08, 0],
  lead: [0.1, 1.38, 0.3],
  leadPole: [0.35, -1, -0.15],
  leadPalm: [-0.55, -0.1, -0.83],
  rear: [-0.08, 1.37, 0.17],
  rearPole: [-0.3, -1, -0.2],
  rearPalm: [0.45, -0.1, -0.88],
  leadFoot: [0.13, 0, 0.23],
  leadFootYaw: -0.22,
  leadHeel: 0,
  rearFoot: [-0.14, 0, -0.22],
  rearFootYaw: -0.72,
  rearHeel: 0.22,
  leadKnee: [0.25, 0, 1],
  rearKnee: [-0.1, 0, 1],
  fist: 1,
  focus: 0.6,
  effort: 0,
  wince: 0,
  smile: 0,
  jaw: 0,
  eyes: 0,
  shrugLead: 0.15,
  shrugRear: 0,
});

/** Standing relaxed (referee, a boxer out of the ring stance): feet under the hips, hands loose. */
export const STAND: Pose = pose(GUARD, {
  hips: [0, 0.9, 0],
  yaw: 0,
  chest: 0,
  lean: 0.02,
  head: [0.02, 0, 0],
  lead: [0.2, 0.93, 0.08],
  leadPole: [0.6, -0.2, -1],
  leadPalm: [-1, 0, 0],
  rear: [-0.2, 0.93, 0.08],
  rearPole: [-0.6, -0.2, -1],
  rearPalm: [1, 0, 0],
  leadFoot: [0.12, 0, 0.01],
  leadFootYaw: 0.1,
  rearFoot: [-0.12, 0, -0.01],
  rearFootYaw: -0.1,
  rearHeel: 0,
  leadKnee: [0.1, 0, 1],
  rearKnee: [-0.1, 0, 1],
  fist: 0.25,
  focus: 0,
  shrugLead: 0,
});

/** Down on one knee after a knockdown (rear knee on the canvas, lead foot planted, lead glove on the lead knee). */
export const KNEEL: Pose = pose(GUARD, {
  hips: [0.02, 0.56, -0.08],
  yaw: -0.3,
  chest: -0.05,
  lean: 0.32,
  bend: 0.04,
  head: [0.42, 0.05, 0.05],
  lead: [0.18, 0.66, 0.3],
  leadPole: [0.8, 0.2, -0.4],
  leadPalm: [0, -1, 0.1],
  rear: [-0.2, 0.62, 0.05],
  rearPole: [-1, 0, -0.3],
  rearPalm: [0.4, -0.2, 0.2],
  leadFoot: [0.15, 0, 0.36],
  leadFootYaw: -0.1,
  leadHeel: 0,
  rearFoot: [-0.14, 0.04, -0.56],
  rearFootYaw: -0.25,
  rearHeel: 1.05,
  leadKnee: [0.2, 0.2, 1],
  rearKnee: [-0.05, -0.6, 1],
  focus: 0,
  wince: 0.35,
  eyes: 0.25,
  jaw: 0.25,
  shrugLead: 0,
});

/**
 * Sitting on the corner stool between rounds (root = the stool centre on the canvas, facing the ring centre):
 * hips on a 0.55 m stool, feet wide and forward, gloves resting on the thighs, leaning in a little, breathing hard.
 */
export const STOOL_HEIGHT = 0.55;
export const SIT: Pose = pose(GUARD, {
  hips: [0, STOOL_HEIGHT + 0.1, -0.06],
  yaw: 0,
  chest: 0,
  lean: 0.16,
  bend: 0,
  head: [0.12, 0, 0],
  lead: [0.21, 0.73, 0.32],
  leadPole: [1, 0.1, -0.4],
  leadPalm: [-0.3, -1, 0],
  rear: [-0.21, 0.73, 0.32],
  rearPole: [-1, 0.1, -0.4],
  rearPalm: [0.3, -1, 0],
  leadFoot: [0.26, 0, 0.45],
  leadFootYaw: 0.3,
  leadHeel: 0,
  rearFoot: [-0.26, 0, 0.45],
  rearFootYaw: -0.3,
  rearHeel: 0,
  leadKnee: [0.4, 0.3, 1],
  rearKnee: [-0.4, 0.3, 1],
  focus: 0.2,
  jaw: 0.3,
  shrugLead: 0,
});
