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
import { BOXER_V7 } from "../boxer/body-v6";
import { BOXER_V8 } from "../boxer/generation";

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
  /**
   * P3-FGT-16 keyed arms (arm-fk.ts): 1 = the arms are driven by the joint angles below (forward kinematics from
   * anatomical angles, joint limits applied), 0 = by the wrist targets above (the older IK path: referee, ceremony).
   * Blends like every other channel, so a hand-over between the two is a cross-fade.
   */
  fk: 53,
  /** the striking glove's contact target (root frame, orthodox): weight 0…1 (0 at the guard, 1 at impact), x, y, z,
   * which hand (0 lead, 1 rear). Written by motion.ts fitAim / fitReach; arm-fk.ts bends the keyed arm onto it */
  aimK: 54,
  ax: 55,
  ay: 56,
  az: 57,
  aimRear: 58,
  /** lead arm angles (rad): shoulder flexion, abduction, internal rotation, elbow flexion, forearm pronation, wrist
   * flexion, clavicle elevation, clavicle protraction (arm-fk.ts ARM) */
  la: 59,
  /** rear arm angles (same layout) */
  ra: 67,
} as const;
export type PoseKey = keyof typeof P;
export const POSE_SIZE = 75;
/** the 8 angles of one keyed arm (offsets from P.la / P.ra) */
export const ARM = { flex: 0, abd: 1, rot: 2, elbow: 3, pron: 4, wrist: 5, elev: 6, prot: 7 } as const;
export const ARM_SIZE = 8;
/** an arm's angles for authoring, in DEGREES (any subset) */
export type ArmSpec = Partial<Record<keyof typeof ARM, number>>;
export type Pose = Float32Array;

/** channels whose sign flips when a pose is mirrored (southpaw): x positions / directions and yaw-like angles */
export const MIRROR_FLIP: readonly number[] = [P.hx, P.yaw, P.chest, P.bend, P.hyaw, P.hroll, P.lx, P.lpx, P.lnx, P.rx, P.rpx, P.rnx, P.fLx, P.fLyaw, P.fRx, P.fRyaw, P.kLx, P.kRx, P.ax];
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
  /** P3-FGT-16 keyed arms: angles in degrees (unset ones keep the previous key's) and the FK weight */
  leadArm?: ArmSpec;
  rearArm?: ArmSpec;
  fk?: number;
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
  if (spec.fk !== undefined) out[P.fk] = spec.fk;
  for (const [a, at] of [
    [spec.leadArm, P.la],
    [spec.rearArm, P.ra],
  ] as const) {
    if (!a) continue;
    for (const [name, off] of Object.entries(ARM) as [keyof typeof ARM, number][]) {
      const v = a[name];
      if (v !== undefined) out[at + off] = (v * Math.PI) / 180;
    }
  }
  return out;
}

/** an arm's angles of a pose back in degrees (authoring helpers, tests) */
export function armOf(p: Pose, rear: boolean): Required<ArmSpec> {
  const at = rear ? P.ra : P.la;
  const o = {} as Required<ArmSpec>;
  for (const [name, off] of Object.entries(ARM) as [keyof typeof ARM, number][]) o[name] = (p[at + off]! * 180) / Math.PI;
  return o;
}

/**
 * The orthodox guard: bladed ~26° (left shoulder forward), knees soft, weight centred, chin tucked; the lead glove a
 * hand's length in front of the face, the rear glove by the chin, elbows down over the ribs, palms turned in.
 * Rear heel slightly up (ready to push off).
 */
/** the keyed guard arms (degrees; arm-fk.ts conventions) */
export const GUARD_LEAD_ARM: Required<ArmSpec> = { flex: 52, abd: -19, rot: 6, elbow: 130, pron: 29, wrist: 0, elev: 4, prot: 6 };
export const GUARD_REAR_ARM: Required<ArmSpec> = { flex: 48, abd: -19, rot: 36, elbow: 125, pron: -13, wrist: 0, elev: 4, prot: 4 };

export const GUARD_AUTHOR: Pose = pose(newPose(), {
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
  // P3-FGT-16 keyed arms: the guard measured as joint angles (elbows in front of the lower ribs, forearms rising to the
  // gloves at the cheekbones, palms turned in; arm-fit.dev.test.ts fitted to chest-frame glove / elbow positions)
  fk: 1,
  leadArm: GUARD_LEAD_ARM,
  rearArm: GUARD_REAR_ARM,
});

const GUARD_V6: Pose = pose(GUARD_AUTHOR, {
  // P3-FGT-09: a deeper athletic stance — knees bent (hips ~4 cm lower), the feet where they were (travel / pivots are
  // authored round them), weight forward
  // on the balls of the feet, torso leaning in and bladed, chin tucked behind the lead shoulder, both gloves up at the
  // cheekbones with the elbows in over the ribs
  hips: [0, 0.815, -0.02],
  yaw: -0.5,
  chest: -0.08,
  lean: 0.21,
  bend: 0,
  head: [0.27, 0.1, 0],
  lead: [0.11, 1.445, 0.27],
  leadPole: [0.3, -1, -0.12],
  leadPalm: [-0.55, -0.1, -0.83],
  rear: [-0.07, 1.435, 0.15],
  rearPole: [-0.25, -1, -0.15],
  rearPalm: [0.45, -0.1, -0.88],
  leadHeel: 0.08,
  rearHeel: 0.32,
  leadKnee: [0.3, 0, 1],
  rearKnee: [-0.15, 0, 1],
  fist: 1,
  focus: 0.6,
  effort: 0,
  wince: 0,
  smile: 0,
  jaw: 0,
  eyes: 0,
  shrugLead: 0.3,
  shrugRear: 0.12,
});

/**
 * P3-FGT-18 (docs/FIGHT-REALISM-V7.md §7, flag BOXER_V7): the guard re-keyed on boxing fundamentals and the reference
 * board — the user read v6 as "stiff, no weight". Sat down into the knees (hips 2 cm lower), bladed ~33° (was 29°),
 * leaning in over the lead knee, the chin tucked down behind a raised lead shoulder (the shoulder comes up to the jaw,
 * the rear one a little), up on the ball of the rear foot. The feet stay where every clip's travel / pivot is authored;
 * the keyed arms (and their joint limits) are unchanged.
 */
const GUARD_V7: Pose = pose(GUARD_V6, {
  hips: [0, 0.795, -0.03],
  yaw: -0.58,
  lean: 0.25,
  head: [0.35, 0.12, 0.03],
  leadHeel: 0.1,
  rearHeel: 0.4,
  leadKnee: [0.36, 0, 1],
  rearKnee: [-0.08, 0, 1],
  shrugLead: 0.48,
  shrugRear: 0.16,
});
/**
 * P3-FGT-19B (docs/design/fighter-v8/SPEC.md §9, flag BOXER_V8): the v8 guard — sat 2 cm deeper than v7, bladed 36°
 * with the chest turned a further 6°, the shoulders raised and rolled forward (clavicles: lead up 11° / forward 13°,
 * rear up 7° / forward 10°), the rear heel well up and the rear foot turned out 58°. The arms are the keyed-arm angles
 * fitted on the real rig and body (qa/e2e/fighter-v8/fit-pose.mjs; first pass arm-fit-v8.dev.test.ts) to the spec's glove and elbow targets: the rear glove on the cheekbone beside the face,
 * the lead fist in front between eye and chin height, both elbows down and in over the ribs, the forearms rising at
 * 55–75°, the wrists straight (wrist 0: the glove continues the forearm), the eyes clear over the gloves.
 */
export const GUARD_V8_LEAD_ARM: Required<ArmSpec> = { flex: 58, abd: 8, rot: -36, elbow: 132, pron: 49, wrist: 0, elev: 11, prot: 13 };
export const GUARD_V8_REAR_ARM: Required<ArmSpec> = { flex: 36, abd: -17, rot: 55, elbow: 133, pron: -16, wrist: 0, elev: 7, prot: 30 };
/**
 * P3-FGT-19B: the female body's guard correction (degrees, added by the rig near the guard: rig.ts ArmBias). One set of
 * clip angles serves every body, but the lighter, shorter female fighter (1.65 m, narrower shoulders) put the lead glove
 * 3 cm lower against her eyes and the elbows less far down; fitted on her own body (fit-pose.mjs --genders f): the lead
 * clavicle raised and drawn back, the elbow a little more open; the rear arm a touch higher and closer.
 */
export const V8_GUARD_BIAS_F = {
  lead: { flex: -8, abd: 10, rot: 0, elbow: -13, pron: 0, wrist: 0, elev: 16, prot: -25 },
  rear: { flex: 7, abd: -12, rot: -3, elbow: -9, pron: 0, wrist: 0, elev: 0, prot: 0 },
} as const;
/** an arm spec (degrees) as radians in the ARM layout */
export function armRad(a: ArmSpec): Float32Array {
  const out = new Float32Array(ARM_SIZE);
  for (const [k, i] of Object.entries(ARM) as [keyof typeof ARM, number][]) out[i] = ((a[k] ?? 0) * Math.PI) / 180;
  return out;
}
const GUARD_V8: Pose = pose(GUARD_V7, {
  hips: [0.01, 0.775, -0.03],
  yaw: -0.63,
  chest: -0.105,
  lean: 0.22,
  bend: 0.03,
  head: [0.26, 0.12, 0.02],
  // (the feet keep the v7 positions every footwork / pivot clip is authored round — 1–2 cm from the spec's — with the
  // spec's toe angles and heel lifts)
  leadFootYaw: -0.31,
  leadHeel: 0.07,
  rearFootYaw: -1.01,
  rearHeel: 0.45,
  leadKnee: [0.4, 0, 1],
  rearKnee: [-0.05, 0, 1],
  shrugLead: 0.5,
  shrugRear: 0.25,
  leadArm: GUARD_V8_LEAD_ARM,
  rearArm: GUARD_V8_REAR_ARM,
});
export const GUARD: Pose = BOXER_V8 ? GUARD_V8 : BOXER_V7 ? GUARD_V7 : GUARD_V6;

/**
 * The clips are authored round GUARD_AUTHOR (the P3-FGT-02 stance); P3-FGT-09 deepened the stance. clips.ts moves an
 * authored key by (GUARD − GUARD_AUTHOR), weighted by how close its body (hips height, feet) is to the guard: punches,
 * defence, footwork and reactions take the full deep stance; kneeling, sitting and standing poses none; keys in
 * between (getting up, sitting down) blend, so every hand-over stays continuous.
 */
const BODY_CH = [P.hy, P.fLx, P.fLz, P.fRx, P.fRz] as const;
export function stanceWeight(p: Pose): number {
  let d = 0;
  for (const i of BODY_CH) d = Math.max(d, Math.abs(p[i]! - GUARD_AUTHOR[i]!));
  const x = Math.min(1, Math.max(0, 1 - d / 0.16));
  return x * x * (3 - 2 * x);
}

/** Standing relaxed (referee, a boxer out of the ring stance): feet under the hips, hands loose. */
export const STAND: Pose = pose(GUARD_AUTHOR, {
  fk: 0,
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
export const KNEEL: Pose = pose(GUARD_AUTHOR, {
  // P3-FGT-16: keyed arms — the lead forearm resting across the lead knee, the rear arm hanging loose by the rear thigh
  // (rig.ts keeps every glove above the canvas)
  fk: 1,
  leadArm: { flex: 26, abd: 8, rot: 18, elbow: 58, pron: 60, wrist: 0, elev: 2, prot: 6 },
  rearArm: { flex: 12, abd: 12, rot: 10, elbow: 38, pron: 30, wrist: 0, elev: 0, prot: 2 },
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
export const SIT: Pose = pose(GUARD_AUTHOR, {
  fk: 0,
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
