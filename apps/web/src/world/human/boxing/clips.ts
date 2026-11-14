import { GUARD, KNEEL, P, pose, POSE_SIZE, SIT, STAND, newPose, type Pose, type PoseSpec, type V3 } from "./pose";

/**
 * Boxing motion library (P3-FGT-02): procedural, licence-safe, deterministic clips on the Rocketbox rig. Each clip
 * is a few key poses (pose.ts) interpolated per channel with a monotone cubic (C1, no overshoot, zero velocity at
 * the first / last key), so a clip that starts and ends in the guard blends from / into it without a pop.
 *
 * Body mechanics, not just arms: straight punches turn the hips and shoulders through and push off the rear foot
 * (heel up, weight forward), hooks load and snap the hips round with the elbow up at shoulder height, uppercuts dip
 * the knees and drive up from the legs; every punch rotates the fist on the way out (palm down at impact for
 * straights / hooks, palm in for uppercuts) and returns to the guard along the same line. The chin stays tucked
 * behind the lead shoulder; the other glove stays home.
 *
 * Timing: `impact` is the clip time (s, at speed 1) where the glove lands (straights at full extension, hooks /
 * uppercuts at the end of the arc), the moment the engine / FX sync the hit sound, the camera shake and the other
 * fighter's reaction to. `recovery` = from impact back to the guard. Defence clips use `impact` for the moment
 * they are most effective (slip / duck under the punch, glove tight on the head).
 */

export type BoxingClipName =
  // stance + footwork
  | "guard"
  | "guardIdle"
  | "stepForward"
  | "stepBack"
  | "stepLeft"
  | "stepRight"
  | "pivot"
  // punches
  | "jab"
  | "cross"
  | "leadHook"
  | "rearHook"
  | "leadUppercut"
  | "rearUppercut"
  | "leadBody"
  | "rearBody"
  // defence
  | "blockHigh"
  | "blockLow"
  | "slipLeft"
  | "slipRight"
  | "duck"
  // reactions
  | "hitHeadLight"
  | "hitHeadHeavy"
  | "hitBodyLight"
  | "hitBodyHeavy"
  | "stagger"
  | "knockdown"
  | "count"
  | "getUp"
  | "clinch"
  // ceremony
  | "touchGloves"
  | "cornerSit"
  | "cornerRest"
  | "cornerStand"
  | "victory"
  | "victoryHold"
  | "defeat"
  | "defeatHold"
  | "winnerRaised"
  // referee (staff NPC, bare hands)
  | "refIdle"
  | "refCount"
  | "refBreak"
  | "refStart"
  | "refRaise";

export type ClipKind = "stance" | "footwork" | "punch" | "defence" | "reaction" | "ceremony" | "referee";

export interface ClipEvent {
  /** clip time (s, speed 1) */
  t: number;
  kind: "impact" | "step" | "land" | "beat";
}

export interface BoxingClipInfo {
  name: BoxingClipName;
  kind: ClipKind;
  /** seconds at speed 1 (one cycle for loops) */
  duration: number;
  loop: boolean;
  /** hit / most-effective moment (s), null when the clip has none */
  impact: number | null;
  /** impact → back in the guard (s) */
  recovery: number;
  /** a [start, end] window a `hold` command can stretch (blocks, raised arms) */
  hold?: readonly [number, number];
  /** what plays after a one-shot ends (default: guardIdle) */
  then: BoxingClipName | null;
  /** punches: which glove, at what */
  hand?: "lead" | "rear";
  target?: "head" | "body";
  /** punches: reach of the glove at impact, forward of the root (m, reference body) */
  reach?: number;
  /** root travel over the clip (start frame: x, z metres, yaw rad); the engine moves the root by it */
  travel?: readonly [number, number, number];
  events: readonly ClipEvent[];
}

interface Key {
  t: number;
  p: Pose;
}

interface ClipDef extends BoxingClipInfo {
  keys: Key[];
  /** root travel keys: [t, x, z, yaw] */
  travelKeys?: readonly (readonly [number, number, number, number])[];
}

/* ---------------- authoring helpers ---------------- */

const add = (a: V3, d: V3): V3 => [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
const gL = (): V3 => [GUARD[P.lx]!, GUARD[P.ly]!, GUARD[P.lz]!];
const gR = (): V3 => [GUARD[P.rx]!, GUARD[P.ry]!, GUARD[P.rz]!];
const gLF = (): V3 => [GUARD[P.fLx]!, 0, GUARD[P.fLz]!];
const gRF = (): V3 => [GUARD[P.fRx]!, 0, GUARD[P.fRz]!];
/** both guard gloves shifted by d */
const hands = (d: V3): PoseSpec => ({ lead: add(gL(), d), rear: add(gR(), d) });

/** keys: each spec overrides the previous key (the first one overrides `base`) */
function keys(base: Pose, list: [number, PoseSpec][]): Key[] {
  const out: Key[] = [];
  let prev = base;
  for (const [t, spec] of list) {
    prev = pose(prev, spec);
    out.push({ t, p: prev });
  }
  return out;
}

type Def = Omit<ClipDef, "name" | "recovery" | "then" | "events" | "loop"> & Partial<Pick<ClipDef, "then" | "events" | "loop" | "recovery">>;

/* ---------------- the library ---------------- */

const G = GUARD;

/** the pivot, computed so the lead foot stays exactly where it is while the root turns about it */
const PIVOT: Def = (() => {
  const turn = 0.6;
  const lf = gLF();
  const at = (k: number): [number, number, number] => {
    const a = turn * k;
    const c = Math.cos(a),
      s = Math.sin(a);
    // root such that root + Ry(a)·leadFoot = leadFoot
    return [lf[0] - (lf[0] * c + lf[2] * s), lf[2] - (-lf[0] * s + lf[2] * c), a];
  };
  const ease = (x: number) => x * x * (3 - 2 * x);
  const ts = [0, 0.12, 0.3, 0.5];
  const fr = [0, 0.12, 0.72, 1];
  const travelKeys = ts.map((t, i) => [t, ...at(ease(fr[i]!))] as const);
  // where the rear foot ends (start frame): the stance rear foot carried round by the turn
  const end = at(1);
  const rf = gRF();
  const c = Math.cos(turn),
    s = Math.sin(turn);
  const rx = end[0] + rf[0] * c + rf[2] * s;
  const rz = end[1] - rf[0] * s + rf[2] * c;
  const ry = GUARD[P.fRyaw]! + turn;
  return {
    kind: "footwork",
    duration: 0.5,
    impact: null,
    travel: [end[0], end[1], end[2]],
    travelKeys,
    events: [{ t: 0.4, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.12, { leadHeel: 0.35, hips: [0, 0.85, 0] }],
      [0.3, { leadHeel: 0.3, leadFootYaw: GUARD[P.fLyaw]! + turn * 0.6, rearFoot: [(rf[0] + rx) / 2 - 0.05, 0.04, (rf[2] + rz) / 2 - 0.04], rearFootYaw: (GUARD[P.fRyaw]! + ry) / 2 }],
      [0.4, { leadHeel: 0.05, leadFootYaw: GUARD[P.fLyaw]! + turn, rearFoot: [rx, 0, rz], rearFootYaw: ry }],
      [0.5, { leadHeel: 0, hips: [0, 0.855, -0.01] }],
    ]),
  };
})();


const DEFS: Record<BoxingClipName, Def> = {
  guard: { kind: "stance", duration: 1, loop: true, impact: null, keys: keys(G, [[0, {}], [1, {}]]) },
  // light bounce on the balls of the feet, weight rocking front ↔ back, gloves riding with the body
  guardIdle: {
    kind: "stance",
    duration: 0.9,
    loop: true,
    impact: null,
    keys: keys(G, [
      [0, {}],
      [0.225, { hips: [0.005, 0.838, 0.005], ...hands([0, -0.012, 0.004]), rearHeel: 0.3, leadHeel: 0.06, head: [0.17, 0.08, 0] }],
      [0.45, { hips: [0, 0.855, -0.01], ...hands([0, 0, 0]), rearHeel: 0.22, leadHeel: 0, head: [0.16, 0.08, 0] }],
      [0.675, { hips: [-0.006, 0.84, -0.022], ...hands([0, -0.01, -0.004]), rearHeel: 0.16, leadHeel: 0.05, head: [0.165, 0.075, 0] }],
      [0.9, { hips: [0, 0.855, -0.01], ...hands([0, 0, 0]), rearHeel: 0.22, leadHeel: 0, head: [0.16, 0.08, 0] }],
    ]),
  },

  // ---- footwork: the lead foot moves first going forward / left, the rear foot first going back / right; the
  // root travels with the hips, the feet are planted in the clip's start frame
  stepForward: {
    kind: "footwork",
    duration: 0.42,
    impact: null,
    travel: [0, 0.3, 0],
    travelKeys: [[0, 0, 0, 0], [0.1, 0, 0.06, 0], [0.24, 0, 0.22, 0], [0.42, 0, 0.3, 0]],
    events: [{ t: 0.2, kind: "step" }, { t: 0.36, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.1, { leadFoot: add(gLF(), [0, 0.035, 0.12]), rearHeel: 0.45, hips: [0, 0.85, 0] }],
      [0.2, { leadFoot: add(gLF(), [0, 0, 0.3]), rearHeel: 0.5 }],
      [0.3, { rearFoot: add(gRF(), [0, 0.03, 0.18]), rearHeel: 0.3, hips: [0, 0.85, -0.01] }],
      [0.36, { rearFoot: add(gRF(), [0, 0, 0.3]), rearHeel: 0.22 }],
      [0.42, { hips: [0, 0.855, -0.01] }],
    ]),
  },
  stepBack: {
    kind: "footwork",
    duration: 0.42,
    impact: null,
    travel: [0, -0.3, 0],
    travelKeys: [[0, 0, 0, 0], [0.1, 0, -0.06, 0], [0.24, 0, -0.22, 0], [0.42, 0, -0.3, 0]],
    events: [{ t: 0.2, kind: "step" }, { t: 0.36, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.1, { rearFoot: add(gRF(), [0, 0.03, -0.12]), hips: [0, 0.85, -0.02] }],
      [0.2, { rearFoot: add(gRF(), [0, 0, -0.3]), rearHeel: 0.3 }],
      [0.3, { leadFoot: add(gLF(), [0, 0.03, -0.18]), hips: [0, 0.85, -0.01] }],
      [0.36, { leadFoot: add(gLF(), [0, 0, -0.3]), rearHeel: 0.22 }],
      [0.42, { hips: [0, 0.855, -0.01] }],
    ]),
  },
  stepLeft: {
    kind: "footwork",
    duration: 0.4,
    impact: null,
    travel: [0.25, 0, 0],
    travelKeys: [[0, 0, 0, 0], [0.1, 0.05, 0, 0], [0.24, 0.19, 0, 0], [0.4, 0.25, 0, 0]],
    events: [{ t: 0.18, kind: "step" }, { t: 0.34, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.09, { leadFoot: add(gLF(), [0.1, 0.03, 0]), hips: [0.01, 0.85, -0.01], bend: 0.04 }],
      [0.18, { leadFoot: add(gLF(), [0.25, 0, 0]) }],
      [0.28, { rearFoot: add(gRF(), [0.15, 0.025, 0]), bend: 0 }],
      [0.34, { rearFoot: add(gRF(), [0.25, 0, 0]) }],
      [0.4, { hips: [0, 0.855, -0.01] }],
    ]),
  },
  stepRight: {
    kind: "footwork",
    duration: 0.4,
    impact: null,
    travel: [-0.25, 0, 0],
    travelKeys: [[0, 0, 0, 0], [0.1, -0.05, 0, 0], [0.24, -0.19, 0, 0], [0.4, -0.25, 0, 0]],
    events: [{ t: 0.18, kind: "step" }, { t: 0.34, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.09, { rearFoot: add(gRF(), [-0.1, 0.03, 0]), hips: [-0.01, 0.85, -0.01], bend: -0.04 }],
      [0.18, { rearFoot: add(gRF(), [-0.25, 0, 0]) }],
      [0.28, { leadFoot: add(gLF(), [-0.15, 0.025, 0]), bend: 0 }],
      [0.34, { leadFoot: add(gLF(), [-0.25, 0, 0]) }],
      [0.4, { hips: [0, 0.855, -0.01] }],
    ]),
  },
  // pivot on the lead foot, turning ~34° to the left (orthodox): the rear foot swings round to the right
  pivot: PIVOT,

  // ---- punches
  jab: {
    kind: "punch",
    duration: 0.4,
    impact: 0.14,
    hand: "lead",
    target: "head",
    reach: 0.78,
    keys: keys(G, [
      [0, {}],
      [0.05, { lead: [0.08, 1.41, 0.42], leadPalm: [-0.5, -0.5, -0.4], hips: [0.005, 0.85, 0.005], yaw: -0.5, shrugLead: 0.4 }],
      [0.14, { lead: [0.035, 1.46, 0.76], leadPalm: [0, -1, 0.05], leadPole: [0.9, -0.5, 0], hips: [0.01, 0.848, 0.03], yaw: -0.58, chest: -0.14, lean: 0.17, head: [0.2, 0.14, 0.06], rearHeel: 0.32, effort: 0.8, shrugLead: 1 }],
      [0.22, { lead: [0.08, 1.42, 0.5], leadPalm: [-0.4, -0.6, -0.5], leadPole: [0.5, -1, -0.1], hips: [0.005, 0.852, 0.01], yaw: -0.52, chest: -0.1, head: [0.17, 0.1, 0.02], effort: 0.3, shrugLead: 0.5 }],
      [0.4, { lead: gL(), leadPalm: [-0.55, -0.1, -0.83], leadPole: [0.35, -1, -0.15], hips: [0, 0.855, -0.01], yaw: -0.46, chest: -0.08, lean: 0.13, head: [0.16, 0.08, 0], rearHeel: 0.22, effort: 0, shrugLead: 0.15 }],
    ]),
  },
  cross: {
    kind: "punch",
    duration: 0.52,
    impact: 0.2,
    hand: "rear",
    target: "head",
    reach: 0.84,
    keys: keys(G, [
      [0, {}],
      [0.07, { rear: [-0.08, 1.4, 0.3], rearPalm: [0.4, -0.6, -0.4], yaw: -0.25, hips: [0.02, 0.845, 0.02], rearHeel: 0.6, rearFootYaw: -0.55, lead: [0.1, 1.4, 0.24] }],
      [0.2, { rear: [-0.005, 1.47, 0.82], rearPalm: [0, -1, 0.05], rearPole: [-0.9, -0.5, 0], yaw: 0.3, chest: 0.15, lean: 0.22, bend: 0.08, hips: [0.05, 0.84, 0.07], rearHeel: 1.0, rearFootYaw: -0.25, lead: [0.09, 1.43, 0.19], leadPalm: [-0.7, 0, -0.7], head: [0.2, 0.0, 0.05], effort: 1, shrugRear: 1 }],
      [0.3, { rear: [-0.06, 1.43, 0.5], rearPalm: [0.4, -0.6, -0.5], rearPole: [-0.5, -1, -0.1], yaw: 0.02, chest: 0.05, lean: 0.17, bend: 0.03, hips: [0.03, 0.848, 0.03], rearHeel: 0.6, rearFootYaw: -0.5, effort: 0.3, shrugRear: 0.4 }],
      [0.52, { rear: gR(), rearPalm: [0.45, -0.1, -0.88], rearPole: [-0.3, -1, -0.2], yaw: -0.46, chest: -0.08, lean: 0.13, bend: 0, hips: [0, 0.855, -0.01], rearHeel: 0.22, rearFootYaw: -0.72, lead: gL(), leadPalm: [-0.55, -0.1, -0.83], head: [0.16, 0.08, 0], effort: 0, shrugRear: 0 }],
    ]),
  },
  leadHook: {
    kind: "punch",
    duration: 0.58,
    impact: 0.24,
    hand: "lead",
    target: "head",
    reach: 0.55,
    keys: keys(G, [
      [0, {}],
      [0.09, { lead: [0.27, 1.42, 0.3], leadPole: [1, 0.15, -0.3], leadPalm: [-0.6, -0.6, -0.2], yaw: -0.22, chest: 0, hips: [0.04, 0.84, 0.01], leadHeel: 0, bend: 0.06 }],
      [0.24, { lead: [-0.06, 1.47, 0.52], leadPole: [0.6, 1, -0.2], leadPalm: [-0.15, -1, 0.1], yaw: -1.08, chest: -0.28, lean: 0.16, bend: -0.04, hips: [0.02, 0.842, 0.02], leadHeel: 0.55, leadFootYaw: -0.75, head: [0.2, -0.05, -0.04], effort: 1, shrugLead: 1 }],
      [0.34, { lead: [0.12, 1.43, 0.4], leadPole: [0.8, -0.2, -0.2], leadPalm: [-0.5, -0.5, -0.5], yaw: -0.72, chest: -0.14, bend: 0, leadHeel: 0.25, leadFootYaw: -0.4, effort: 0.3, shrugLead: 0.4 }],
      [0.58, { lead: gL(), leadPole: [0.35, -1, -0.15], leadPalm: [-0.55, -0.1, -0.83], yaw: -0.46, chest: -0.08, lean: 0.13, hips: [0, 0.855, -0.01], leadHeel: 0, leadFootYaw: -0.22, head: [0.16, 0.08, 0], effort: 0, shrugLead: 0.15 }],
    ]),
  },
  rearHook: {
    kind: "punch",
    duration: 0.64,
    impact: 0.27,
    hand: "rear",
    target: "head",
    reach: 0.58,
    keys: keys(G, [
      [0, {}],
      [0.1, { rear: [-0.27, 1.41, 0.2], rearPole: [-1, 0.15, -0.3], rearPalm: [0.6, -0.6, -0.2], yaw: -0.62, hips: [-0.02, 0.84, -0.02], bend: -0.05 }],
      [0.27, { rear: [0.08, 1.47, 0.55], rearPole: [-0.6, 1, -0.2], rearPalm: [0.15, -1, 0.1], yaw: 0.42, chest: 0.24, lean: 0.18, bend: 0.06, hips: [0.04, 0.84, 0.04], rearHeel: 1.0, rearFootYaw: -0.15, lead: [0.1, 1.43, 0.2], leadPalm: [-0.7, 0, -0.7], head: [0.2, 0.12, 0.04], effort: 1, shrugRear: 1 }],
      [0.38, { rear: [-0.12, 1.43, 0.38], rearPole: [-0.8, -0.2, -0.2], rearPalm: [0.5, -0.5, -0.5], yaw: 0.0, chest: 0.08, bend: 0.02, rearHeel: 0.55, rearFootYaw: -0.45, effort: 0.3, shrugRear: 0.4 }],
      [0.64, { rear: gR(), rearPole: [-0.3, -1, -0.2], rearPalm: [0.45, -0.1, -0.88], yaw: -0.46, chest: -0.08, lean: 0.13, bend: 0, hips: [0, 0.855, -0.01], rearHeel: 0.22, rearFootYaw: -0.72, lead: gL(), leadPalm: [-0.55, -0.1, -0.83], head: [0.16, 0.08, 0], effort: 0, shrugRear: 0 }],
    ]),
  },
  leadUppercut: {
    kind: "punch",
    duration: 0.58,
    impact: 0.25,
    hand: "lead",
    target: "head",
    reach: 0.6,
    keys: keys(G, [
      [0, {}],
      [0.1, { hips: [0.04, 0.8, 0.0], bend: 0.14, yaw: -0.3, lean: 0.18, lead: [0.16, 1.17, 0.24], leadPole: [0.6, -1, -0.3], leadPalm: [-0.3, 0.6, -0.7], head: [0.2, 0.06, 0.08] }],
      [0.25, { hips: [0.03, 0.875, 0.07], bend: -0.04, yaw: -0.78, chest: -0.18, lean: 0.12, lead: [0.0, 1.5, 0.56], leadPole: [0.4, -1, 0.1], leadPalm: [-0.2, 0, -1], leadHeel: 0.3, head: [0.18, 0.04, -0.02], effort: 1, shrugLead: 0.9 }],
      [0.35, { hips: [0.01, 0.86, 0.0], bend: 0, yaw: -0.6, chest: -0.12, lead: [0.09, 1.42, 0.36], leadPalm: [-0.5, -0.2, -0.8], leadHeel: 0.1, effort: 0.3, shrugLead: 0.4 }],
      [0.58, { hips: [0, 0.855, -0.01], yaw: -0.46, chest: -0.08, lean: 0.13, lead: gL(), leadPole: [0.35, -1, -0.15], leadPalm: [-0.55, -0.1, -0.83], leadHeel: 0, head: [0.16, 0.08, 0], effort: 0, shrugLead: 0.15 }],
    ]),
  },
  rearUppercut: {
    kind: "punch",
    duration: 0.64,
    impact: 0.28,
    hand: "rear",
    target: "head",
    reach: 0.62,
    keys: keys(G, [
      [0, {}],
      [0.11, { hips: [-0.03, 0.795, -0.02], bend: -0.14, yaw: -0.6, lean: 0.2, rear: [-0.14, 1.14, 0.18], rearPole: [-0.6, -1, -0.3], rearPalm: [0.3, 0.6, -0.7], head: [0.2, 0.1, -0.06] }],
      [0.28, { hips: [0.05, 0.875, 0.08], bend: 0.06, yaw: 0.28, chest: 0.16, lean: 0.14, rear: [0.0, 1.5, 0.58], rearPole: [-0.4, -1, 0.1], rearPalm: [0.2, 0, -1], rearHeel: 0.95, rearFootYaw: -0.3, lead: [0.1, 1.43, 0.2], leadPalm: [-0.7, 0, -0.7], head: [0.18, 0.1, 0.03], effort: 1, shrugRear: 0.9 }],
      [0.39, { hips: [0.02, 0.86, 0.01], bend: 0.02, yaw: -0.05, chest: 0.05, rear: [-0.08, 1.42, 0.34], rearPalm: [0.5, -0.2, -0.8], rearHeel: 0.55, rearFootYaw: -0.5, effort: 0.3, shrugRear: 0.4 }],
      [0.64, { hips: [0, 0.855, -0.01], bend: 0, yaw: -0.46, chest: -0.08, lean: 0.13, rear: gR(), rearPole: [-0.3, -1, -0.2], rearPalm: [0.45, -0.1, -0.88], rearHeel: 0.22, rearFootYaw: -0.72, lead: gL(), leadPalm: [-0.55, -0.1, -0.83], head: [0.16, 0.08, 0], effort: 0, shrugRear: 0 }],
    ]),
  },
  // lead hook to the body: level change (knees, not the waist), elbow in tight, the head off the centre line
  leadBody: {
    kind: "punch",
    duration: 0.6,
    impact: 0.25,
    hand: "lead",
    target: "body",
    reach: 0.55,
    keys: keys(G, [
      [0, {}],
      [0.1, { hips: [0.05, 0.76, 0.02], lean: 0.26, bend: 0.12, yaw: -0.24, lead: [0.24, 1.15, 0.24], leadPole: [1, -0.4, -0.3], leadPalm: [-0.5, -0.4, -0.5], rear: [-0.07, 1.3, 0.2], head: [0.15, 0.06, 0.1] }],
      [0.25, { hips: [0.04, 0.75, 0.03], lean: 0.3, bend: 0.02, yaw: -1.0, chest: -0.25, lead: [-0.04, 1.1, 0.52], leadPole: [1, 0.1, -0.2], leadPalm: [-0.2, -0.5, -0.2], leadHeel: 0.5, leadFootYaw: -0.7, head: [0.16, -0.02, 0.06], effort: 1, shrugLead: 0.9 }],
      [0.36, { hips: [0.02, 0.8, 0.0], lean: 0.2, yaw: -0.7, chest: -0.15, lead: [0.12, 1.25, 0.36], leadPole: [0.7, -0.6, -0.2], leadPalm: [-0.5, -0.3, -0.6], leadHeel: 0.2, leadFootYaw: -0.4, effort: 0.3, shrugLead: 0.3 }],
      [0.6, { hips: [0, 0.855, -0.01], lean: 0.13, bend: 0, yaw: -0.46, chest: -0.08, lead: gL(), leadPole: [0.35, -1, -0.15], leadPalm: [-0.55, -0.1, -0.83], rear: gR(), leadHeel: 0, leadFootYaw: -0.22, head: [0.16, 0.08, 0], effort: 0, shrugLead: 0.15 }],
    ]),
  },
  // straight rear hand to the body
  rearBody: {
    kind: "punch",
    duration: 0.56,
    impact: 0.22,
    hand: "rear",
    target: "body",
    reach: 0.8,
    keys: keys(G, [
      [0, {}],
      [0.08, { hips: [0.02, 0.78, 0.02], lean: 0.24, yaw: -0.3, rear: [-0.08, 1.25, 0.26], rearPalm: [0.4, -0.6, -0.4], lead: [0.1, 1.32, 0.22], rearHeel: 0.55, head: [0.14, 0.08, 0.04] }],
      [0.22, { hips: [0.06, 0.76, 0.07], lean: 0.32, bend: 0.1, yaw: 0.25, chest: 0.14, rear: [0.0, 1.1, 0.76], rearPalm: [0, -1, 0.05], rearPole: [-0.9, -0.5, 0], lead: [0.1, 1.33, 0.18], leadPalm: [-0.7, 0, -0.7], rearHeel: 1.0, rearFootYaw: -0.25, head: [0.14, 0.02, 0.1], effort: 1, shrugRear: 0.9 }],
      [0.32, { hips: [0.03, 0.8, 0.03], lean: 0.22, bend: 0.04, yaw: -0.05, chest: 0.04, rear: [-0.06, 1.25, 0.45], rearPalm: [0.4, -0.6, -0.5], rearPole: [-0.5, -1, -0.1], rearHeel: 0.6, rearFootYaw: -0.5, effort: 0.3, shrugRear: 0.3 }],
      [0.56, { hips: [0, 0.855, -0.01], lean: 0.13, bend: 0, yaw: -0.46, chest: -0.08, rear: gR(), rearPalm: [0.45, -0.1, -0.88], rearPole: [-0.3, -1, -0.2], lead: gL(), leadPalm: [-0.55, -0.1, -0.83], rearHeel: 0.22, rearFootYaw: -0.72, head: [0.16, 0.08, 0], effort: 0, shrugRear: 0 }],
    ]),
  },

  // ---- defence
  blockHigh: {
    kind: "defence",
    duration: 0.5,
    impact: 0.12,
    hold: [0.12, 0.36],
    keys: keys(G, [
      [0, {}],
      [0.12, { lead: [0.08, 1.55, 0.17], rear: [-0.08, 1.55, 0.15], leadPole: [0.15, -1, 0.5], rearPole: [-0.15, -1, 0.5], leadPalm: [-0.2, 0, -1], rearPalm: [0.2, 0, -1], head: [0.32, 0.04, 0], lean: 0.18, hips: [0, 0.84, -0.015], yaw: -0.35, effort: 0.6, shrugLead: 0.6, shrugRear: 0.6 }],
      [0.36, { lead: [0.08, 1.55, 0.17], rear: [-0.08, 1.55, 0.15] }],
      [0.5, { lead: gL(), rear: gR(), leadPole: [0.35, -1, -0.15], rearPole: [-0.3, -1, -0.2], leadPalm: [-0.55, -0.1, -0.83], rearPalm: [0.45, -0.1, -0.88], head: [0.16, 0.08, 0], lean: 0.13, hips: [0, 0.855, -0.01], yaw: -0.46, effort: 0, shrugLead: 0.15, shrugRear: 0 }],
    ]),
  },
  // elbows in over the ribs, forearms covering the body, a small crunch
  blockLow: {
    kind: "defence",
    duration: 0.5,
    impact: 0.12,
    hold: [0.12, 0.36],
    keys: keys(G, [
      [0, {}],
      [0.12, { lead: [0.07, 1.34, 0.17], rear: [-0.07, 1.33, 0.15], leadPole: [0.05, -1, 0.35], rearPole: [-0.05, -1, 0.35], leadPalm: [-0.3, 0, -1], rearPalm: [0.3, 0, -1], lean: 0.3, hips: [0, 0.81, -0.03], yaw: -0.3, head: [0.3, 0.05, 0], effort: 0.7, shrugLead: 0.5, shrugRear: 0.5 }],
      [0.36, { lead: [0.07, 1.34, 0.17], rear: [-0.07, 1.33, 0.15] }],
      [0.5, { lead: gL(), rear: gR(), leadPole: [0.35, -1, -0.15], rearPole: [-0.3, -1, -0.2], leadPalm: [-0.55, -0.1, -0.83], rearPalm: [0.45, -0.1, -0.88], lean: 0.13, hips: [0, 0.855, -0.01], yaw: -0.46, head: [0.16, 0.08, 0], effort: 0, shrugLead: 0.15, shrugRear: 0 }],
    ]),
  },
  // head off the line to the person's left (outside a jab), from the knees and the waist, gloves stay up
  slipLeft: {
    kind: "defence",
    duration: 0.44,
    impact: 0.16,
    keys: keys(G, [
      [0, {}],
      [0.16, { hips: [0.07, 0.82, 0.01], bend: 0.3, yaw: -0.55, lean: 0.17, head: [0.18, 0.1, 0.12], ...hands([0.12, -0.07, 0]), rearHeel: 0.3, focus: 0.9 }],
      [0.26, { hips: [0.06, 0.825, 0.0], bend: 0.24, ...hands([0.1, -0.05, 0]) }],
      [0.44, { hips: [0, 0.855, -0.01], bend: 0, yaw: -0.46, lean: 0.13, head: [0.16, 0.08, 0], ...hands([0, 0, 0]), rearHeel: 0.22, focus: 0.6 }],
    ]),
  },
  slipRight: {
    kind: "defence",
    duration: 0.44,
    impact: 0.16,
    keys: keys(G, [
      [0, {}],
      [0.16, { hips: [-0.06, 0.82, -0.02], bend: -0.3, yaw: -0.3, lean: 0.17, head: [0.18, 0.06, -0.12], ...hands([-0.12, -0.07, -0.02]), leadHeel: 0.15, focus: 0.9 }],
      [0.26, { hips: [-0.05, 0.825, -0.02], bend: -0.24, ...hands([-0.1, -0.05, -0.02]) }],
      [0.44, { hips: [0, 0.855, -0.01], bend: 0, yaw: -0.46, lean: 0.13, head: [0.16, 0.08, 0], ...hands([0, 0, 0]), leadHeel: 0, focus: 0.6 }],
    ]),
  },
  // bob and weave: down under a hook in a U from the rear side to the lead side, eyes up, gloves at the face
  duck: {
    kind: "defence",
    duration: 0.7,
    impact: 0.3,
    keys: keys(G, [
      [0, {}],
      [0.14, { hips: [-0.06, 0.74, 0.0], bend: -0.18, lean: 0.3, head: [-0.05, 0.08, -0.05], ...hands([-0.08, -0.17, 0.02]), focus: 1 }],
      [0.3, { hips: [0.01, 0.68, 0.02], bend: 0, lean: 0.36, head: [-0.12, 0.08, 0], ...hands([0, -0.25, 0.04]), rearHeel: 0.3 }],
      [0.46, { hips: [0.07, 0.75, 0.01], bend: 0.18, lean: 0.3, head: [-0.02, 0.08, 0.05], ...hands([0.08, -0.15, 0.02]) }],
      [0.7, { hips: [0, 0.855, -0.01], bend: 0, lean: 0.13, head: [0.16, 0.08, 0], ...hands([0, 0, 0]), rearHeel: 0.22, focus: 0.6 }],
    ]),
  },

  // ---- reactions (small and sporty: a snap of the head / a crunch, the guard back fast)
  hitHeadLight: {
    kind: "reaction",
    duration: 0.36,
    impact: 0,
    keys: keys(G, [
      [0, {}],
      [0.06, { head: [-0.16, 0.24, -0.1], lean: 0.05, hips: [0, 0.85, -0.035], ...hands([0, 0.02, -0.06]), wince: 1, eyes: 0.4, focus: 0 }],
      [0.16, { head: [0.05, 0.14, -0.03], lean: 0.1, hips: [0, 0.852, -0.02], ...hands([0, 0.01, -0.02]), wince: 0.6, eyes: 0.1 }],
      [0.36, { head: [0.16, 0.08, 0], lean: 0.13, hips: [0, 0.855, -0.01], ...hands([0, 0, 0]), wince: 0, eyes: 0, focus: 0.6 }],
    ]),
  },
  hitHeadHeavy: {
    kind: "reaction",
    duration: 0.8,
    impact: 0,
    travel: [0, -0.22, 0],
    travelKeys: [[0, 0, 0, 0], [0.12, 0, -0.06, 0], [0.4, 0, -0.18, 0], [0.8, 0, -0.22, 0]],
    events: [{ t: 0.3, kind: "step" }, { t: 0.52, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.07, { head: [-0.42, 0.42, -0.24], lean: -0.12, chest: 0.12, bend: -0.08, hips: [0, 0.86, -0.06], ...hands([0.03, -0.06, -0.08]), wince: 1, eyes: 0.7, jaw: 0.3, focus: 0 }],
      [0.2, { head: [-0.2, 0.3, -0.12], lean: -0.05, rearFoot: add(gRF(), [0, 0.04, -0.12]) }],
      [0.3, { rearFoot: add(gRF(), [0, 0, -0.22]), hips: [0, 0.83, -0.18], lean: 0.05 }],
      [0.44, { leadFoot: add(gLF(), [0, 0.03, -0.12]), head: [0.0, 0.18, -0.04], ...hands([0, -0.04, -0.03]), wince: 0.6, eyes: 0.2 }],
      [0.52, { leadFoot: add(gLF(), [0, 0, -0.22]), bend: 0 }],
      [0.8, { head: [0.16, 0.08, 0], lean: 0.13, chest: -0.08, hips: [0, 0.855, -0.01], ...hands([0, 0, 0]), wince: 0, eyes: 0, jaw: 0, focus: 0.6 }],
    ]),
  },
  hitBodyLight: {
    kind: "reaction",
    duration: 0.42,
    impact: 0,
    keys: keys(G, [
      [0, {}],
      [0.07, { lean: 0.34, hips: [0, 0.83, -0.04], head: [0.28, 0.06, 0], lead: [0.08, 1.26, 0.2], rear: [-0.08, 1.25, 0.15], leadPole: [0.1, -1, 0.3], rearPole: [-0.1, -1, 0.3], wince: 0.8, effort: 0.4, jaw: 0.15 }],
      [0.2, { lean: 0.22, hips: [0, 0.845, -0.02], ...hands([0, -0.04, -0.02]), wince: 0.4 }],
      [0.42, { lean: 0.13, hips: [0, 0.855, -0.01], head: [0.16, 0.08, 0], ...hands([0, 0, 0]), leadPole: [0.35, -1, -0.15], rearPole: [-0.3, -1, -0.2], wince: 0, effort: 0, jaw: 0 }],
    ]),
  },
  hitBodyHeavy: {
    kind: "reaction",
    duration: 0.9,
    impact: 0,
    travel: [0, -0.16, 0],
    travelKeys: [[0, 0, 0, 0], [0.15, 0, -0.05, 0], [0.5, 0, -0.14, 0], [0.9, 0, -0.16, 0]],
    events: [{ t: 0.34, kind: "step" }, { t: 0.58, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.08, { lean: 0.55, bend: -0.12, hips: [0, 0.77, -0.05], head: [0.42, 0.04, -0.06], lead: [0.08, 1.12, 0.22], rear: [-0.1, 1.08, 0.12], leadPole: [0.1, -1, 0.3], rearPole: [-0.1, -1, 0.35], wince: 1, effort: 0.6, jaw: 0.3, eyes: 0.3 }],
      [0.34, { rearFoot: add(gRF(), [0, 0, -0.16]), hips: [0, 0.79, -0.14], lean: 0.45 }],
      [0.48, { leadFoot: add(gLF(), [0, 0.03, -0.08]) }],
      [0.58, { leadFoot: add(gLF(), [0, 0, -0.16]) }],
      [0.64, { lean: 0.3, bend: -0.05, hips: [0, 0.83, -0.02], head: [0.28, 0.06, -0.02], ...hands([0, -0.08, -0.02]), wince: 0.5, eyes: 0.1 }],
      [0.9, { lean: 0.13, bend: 0, hips: [0, 0.855, -0.01], head: [0.16, 0.08, 0], ...hands([0, 0, 0]), leadPole: [0.35, -1, -0.15], rearPole: [-0.3, -1, -0.2], wince: 0, effort: 0, jaw: 0, eyes: 0 }],
    ]),
  },
  // rocked: two uneven steps back, gloves low, wobbling, then the guard comes back up
  stagger: {
    kind: "reaction",
    duration: 1.4,
    impact: 0,
    travel: [-0.08, -0.5, 0],
    travelKeys: [[0, 0, 0, 0], [0.3, -0.02, -0.18, 0], [0.75, -0.06, -0.4, 0], [1.4, -0.08, -0.5, 0]],
    events: [{ t: 0.32, kind: "step" }, { t: 0.66, kind: "step" }, { t: 0.95, kind: "step" }],
    keys: keys(G, [
      [0, {}],
      [0.1, { head: [-0.3, 0.3, -0.25], lean: -0.15, bend: -0.12, hips: [-0.02, 0.84, -0.08], ...hands([0, -0.22, -0.06]), wince: 0.8, eyes: 0.5, jaw: 0.35, focus: 0 }],
      [0.32, { rearFoot: add(gRF(), [-0.03, 0, -0.24]), hips: [-0.03, 0.8, -0.2], bend: 0.1, head: [0.1, 0.1, 0.18] }],
      [0.5, { leadFoot: add(gLF(), [-0.04, 0.04, -0.16]), lean: 0.25, head: [0.3, -0.05, 0.05] }],
      [0.66, { leadFoot: add(gLF(), [-0.06, 0, -0.32]), hips: [-0.05, 0.79, -0.36], bend: -0.1, head: [0.15, 0.15, -0.12], eyes: 0.35 }],
      [0.95, { rearFoot: add(gRF(), [-0.08, 0, -0.48]), hips: [-0.07, 0.82, -0.47], bend: 0.04, lean: 0.18, ...hands([0, -0.1, -0.03]) }],
      [1.4, { leadFoot: add(gLF(), [-0.08, 0, -0.5]), rearFoot: add(gRF(), [-0.08, 0, -0.5]), hips: [0, 0.855, -0.01], bend: 0, lean: 0.13, head: [0.16, 0.08, 0], ...hands([0, 0, 0]), wince: 0, eyes: 0, jaw: 0, focus: 0.6 }],
    ]),
  },
  // legs give, down onto the rear knee, a glove touches the canvas; ends kneeling (→ count)
  knockdown: {
    kind: "reaction",
    duration: 1.5,
    impact: 0,
    then: "count",
    events: [{ t: 0.72, kind: "land" }],
    keys: keys(G, [
      [0, {}],
      [0.1, { head: [-0.35, 0.35, -0.2], lean: -0.15, hips: [0, 0.84, -0.06], ...hands([0, -0.1, -0.08]), wince: 1, eyes: 0.8, jaw: 0.4, focus: 0 }],
      [0.35, { hips: [0.01, 0.72, -0.08], lean: 0.05, head: [0.1, 0.2, 0.1], lead: [0.18, 1.05, 0.25], rear: [-0.18, 1.02, 0.12], leadPole: [0.8, -0.5, -0.4], rearPole: [-0.8, -0.5, -0.4], rearFoot: [-0.14, 0.03, -0.38], rearHeel: 0.8, rearKnee: [-0.05, -0.4, 1], eyes: 0.6 }],
      [0.72, { hips: [0.02, 0.55, -0.08], lean: 0.42, head: [0.5, 0.05, 0.08], lead: [0.18, 0.64, 0.32], rear: [-0.24, 0.12, 0.12], leadPalm: [0, -1, 0.1], rearPalm: [0, -1, 0], rearPole: [-1, 0.2, -0.5], leadFoot: [0.15, 0, 0.36], leadFootYaw: -0.1, rearFoot: [-0.14, 0.04, -0.56], rearFootYaw: -0.25, rearHeel: 1.05, leadKnee: [0.2, 0.2, 1], yaw: -0.3, eyes: 0.4 }],
      [1.5, { ...specOf(KNEEL) }],
    ]),
  },
  // on one knee during the count: breathing, a shake of the head, eyes coming back
  count: {
    kind: "reaction",
    duration: 2,
    loop: true,
    impact: null,
    keys: keys(KNEEL, [
      [0, {}],
      [0.5, { hips: [0.02, 0.565, -0.08], head: [0.38, 0.12, 0.08], lean: 0.3 }],
      [1.0, { hips: [0.02, 0.555, -0.08], head: [0.4, -0.06, 0.02], lean: 0.33, eyes: 0.15 }],
      [1.5, { hips: [0.02, 0.565, -0.08], head: [0.36, 0.04, 0.05], lean: 0.3 }],
      [2.0, { ...specOf(KNEEL) }],
    ]),
  },
  getUp: {
    kind: "reaction",
    duration: 1.4,
    impact: null,
    events: [{ t: 0.85, kind: "step" }],
    keys: keys(KNEEL, [
      [0, {}],
      [0.3, { lean: 0.48, hips: [0.04, 0.6, -0.02], lead: [0.17, 0.62, 0.32], head: [0.3, 0.05, 0.03], eyes: 0.1 }],
      [0.7, { hips: [0.03, 0.75, -0.06], lean: 0.3, yaw: -0.4, rearFoot: [-0.14, 0.05, -0.38], rearHeel: 0.5, rearKnee: [-0.1, -0.2, 1], lead: [0.15, 1.1, 0.3], rear: [-0.12, 1.1, 0.16], leadPole: [0.5, -1, -0.2], rearPole: [-0.4, -1, -0.2], head: [0.2, 0.06, 0], wince: 0.2, eyes: 0 }],
      [0.85, { rearFoot: [-0.14, 0, -0.24], rearHeel: 0.3, rearKnee: [-0.1, 0, 1] }],
      [1.1, { hips: [0, 0.85, -0.01], lean: 0.15, yaw: -0.46, chest: -0.08, ...hands([0, -0.02, 0]), leadPalm: [-0.55, -0.1, -0.83], rearPalm: [0.45, -0.1, -0.88], head: [0.16, 0.08, 0], jaw: 0.1, wince: 0, focus: 0.5 }],
      [1.4, { ...specOf(GUARD) }],
    ]),
  },
  // tied up: both arms over the other's arms, head on their shoulder, leaning in (loop)
  clinch: {
    kind: "reaction",
    duration: 1.6,
    loop: true,
    impact: null,
    keys: keys(G, [
      [0, { hips: [0, 0.84, 0.02], yaw: -0.15, chest: 0, lean: 0.3, head: [0.25, -0.35, -0.15], lead: [0.25, 1.32, 0.42], rear: [-0.22, 1.28, 0.4], leadPole: [1, -0.2, -0.3], rearPole: [-1, -0.2, -0.3], leadPalm: [-0.6, -0.3, 0.2], rearPalm: [0.6, -0.3, 0.2], fist: 0.9, effort: 0.6, jaw: 0.2 }],
      [0.8, { hips: [0.01, 0.835, 0.03], lean: 0.32, head: [0.27, -0.33, -0.14] }],
      [1.6, { hips: [0, 0.84, 0.02], lean: 0.3, head: [0.25, -0.35, -0.15] }],
    ]),
  },

  // ---- ceremony
  // square up, both gloves out to meet the other fighter's (≈ 0.9 m apart), a nod, back to the guard
  touchGloves: {
    kind: "ceremony",
    duration: 1.2,
    impact: 0.5,
    keys: keys(G, [
      [0, {}],
      [0.3, { yaw: -0.1, chest: 0, hips: [0, 0.88, 0], lead: [0.07, 1.3, 0.4], rear: [-0.07, 1.3, 0.4], leadPole: [0.6, -1, -0.3], rearPole: [-0.6, -1, -0.3], leadPalm: [0, -1, 0], rearPalm: [0, -1, 0], head: [0.2, 0, 0], smile: 0.35, focus: 0.2 }],
      [0.5, { lead: [0.065, 1.3, 0.46], rear: [-0.065, 1.3, 0.46], head: [0.3, 0, 0] }],
      [0.75, { lead: [0.08, 1.32, 0.36], rear: [-0.08, 1.32, 0.36], head: [0.18, 0, 0] }],
      [1.2, { ...specOf(GUARD) }],
    ]),
  },
  // walk to the corner is the caller's; this sits down onto the stool (root = the stool centre)
  cornerSit: {
    kind: "ceremony",
    duration: 0.9,
    impact: null,
    then: "cornerRest",
    keys: keys(G, [
      [0, {}],
      [0.35, { hips: [0, 0.78, -0.04], lean: 0.3, yaw: -0.15, chest: 0, leadFoot: [0.2, 0.03, 0.32], rearFoot: [-0.2, 0.03, 0.3], leadFootYaw: 0.1, rearFootYaw: -0.3, rearHeel: 0.1, ...hands([0, -0.25, 0.05]) }],
      [0.9, { ...specOf(SIT) }],
    ]),
  },
  // seated between rounds: deep breaths (chest and shoulders), head dropping and coming up, gloves on the thighs
  cornerRest: {
    kind: "ceremony",
    duration: 3,
    loop: true,
    impact: null,
    keys: keys(SIT, [
      [0, {}],
      [0.75, { lean: 0.1, head: [0.02, 0, 0], shrugLead: 0.35, shrugRear: 0.35, jaw: 0.45 }],
      [1.5, { lean: 0.18, head: [0.18, 0.08, 0], shrugLead: 0, shrugRear: 0, jaw: 0.25 }],
      [2.25, { lean: 0.11, head: [0.04, -0.06, 0], shrugLead: 0.3, shrugRear: 0.3, jaw: 0.4 }],
      [3, { ...specOf(SIT) }],
    ]),
  },
  cornerStand: {
    kind: "ceremony",
    duration: 0.9,
    impact: null,
    keys: keys(SIT, [
      [0, {}],
      [0.4, { hips: [0, 0.75, 0.02], lean: 0.38, leadFoot: [0.18, 0, 0.3], rearFoot: [-0.18, 0, 0.26], ...hands([0, -0.15, 0.05]), leadPalm: [-0.55, -0.1, -0.83], rearPalm: [0.45, -0.1, -0.88], leadPole: [0.35, -1, -0.15], rearPole: [-0.3, -1, -0.2], jaw: 0, focus: 0.5 }],
      [0.9, { ...specOf(GUARD) }],
    ]),
  },
  // both arms up, chest open, looking up, a big smile (→ victoryHold)
  victory: {
    kind: "ceremony",
    duration: 0.9,
    impact: 0.5,
    then: "victoryHold",
    keys: keys(G, [
      [0, {}],
      [0.5, { ...VICTORY_SPEC() }],
      [0.9, { ...VICTORY_SPEC(), lead: [0.27, 2.0, 0.04], rear: [-0.27, 2.0, 0.04] }],
    ]),
  },
  victoryHold: {
    kind: "ceremony",
    duration: 1.6,
    loop: true,
    impact: null,
    keys: keys(pose(G, { ...VICTORY_SPEC(), lead: [0.27, 2.0, 0.04], rear: [-0.27, 2.0, 0.04] }), [
      [0, {}],
      [0.4, { lead: [0.26, 2.07, 0.06], rear: [-0.26, 2.07, 0.06], hips: [0, 0.915, 0] }],
      [0.8, { lead: [0.27, 2.0, 0.04], rear: [-0.27, 2.0, 0.04], hips: [0, 0.905, 0] }],
      [1.2, { lead: [0.26, 2.06, 0.06], rear: [-0.26, 2.06, 0.06], hips: [0, 0.915, 0] }],
      [1.6, { lead: [0.27, 2.0, 0.04], rear: [-0.27, 2.0, 0.04], hips: [0, 0.905, 0] }],
    ]),
  },
  // gloves down, head lowered, a respectful nod (→ defeatHold)
  defeat: {
    kind: "ceremony",
    duration: 1.2,
    impact: null,
    then: "defeatHold",
    keys: keys(G, [
      [0, {}],
      [0.6, { ...DEFEAT_SPEC(), head: [0.62, 0, 0] }],
      [1.2, { ...DEFEAT_SPEC() }],
    ]),
  },
  defeatHold: {
    kind: "ceremony",
    duration: 3,
    loop: true,
    impact: null,
    keys: keys(pose(G, DEFEAT_SPEC()), [
      [0, {}],
      [1.5, { hips: [0, 0.895, 0], lean: 0.12, head: [0.48, 0.04, 0] }],
      [3, { ...DEFEAT_SPEC() }],
    ]),
  },
  // the winner's rear hand held up by the referee (who stands at REF_RAISE.offset), the lead glove low (loop)
  winnerRaised: {
    kind: "ceremony",
    duration: 2,
    loop: true,
    impact: null,
    keys: keys(G, [
      [0, { ...WINNER_SPEC() }],
      [1, { ...WINNER_SPEC(), hips: [0, 0.915, 0], head: [-0.12, -0.12, 0] }],
      [2, { ...WINNER_SPEC() }],
    ]),
  },

  // ---- referee (staff NPC; bare hands, standing)
  refIdle: {
    kind: "referee",
    duration: 4,
    loop: true,
    impact: null,
    keys: keys(STAND, [
      [0, { ...REF_SPEC() }],
      [2, { ...REF_SPEC(), hips: [0.01, 0.898, 0], head: [0.06, 0.15, 0] }],
      [4, { ...REF_SPEC() }],
    ]),
  },
  // counting over a downed fighter: the right arm chops down once a second (beat = the count)
  refCount: {
    kind: "referee",
    duration: 1,
    loop: true,
    impact: 0.45,
    events: [{ t: 0.45, kind: "beat" }],
    keys: keys(STAND, [
      [0, { ...REF_SPEC(), lean: 0.25, head: [0.3, 0, 0], rear: [-0.2, 1.62, 0.32], rearPole: [-1, -0.3, -0.2], rearPalm: [1, 0, 0], fist: 0.1 }],
      [0.45, { rear: [-0.2, 1.08, 0.42], rearPalm: [1, -0.2, 0.2] }],
      [1, { rear: [-0.2, 1.62, 0.32], rearPalm: [1, 0, 0] }],
    ]),
  },
  // "break!": both arms out between the fighters, palms out
  refBreak: {
    kind: "referee",
    duration: 0.9,
    impact: 0.35,
    then: "refIdle",
    keys: keys(pose(STAND, REF_SPEC()), [
      [0, {}],
      [0.35, { lead: [0.42, 1.32, 0.32], rear: [-0.42, 1.32, 0.32], leadPole: [1, -1, -0.5], rearPole: [-1, -1, -0.5], leadPalm: [0.7, 0, 0.7], rearPalm: [-0.7, 0, 0.7], fist: 0, lean: 0.12, hips: [0, 0.88, 0.04], focus: 0.6 }],
      [0.6, { lead: [0.42, 1.3, 0.3], rear: [-0.42, 1.3, 0.3] }],
      [0.9, { ...REF_SPEC() }],
    ]),
  },
  // "box!": the hand drops between the fighters to start the round
  refStart: {
    kind: "referee",
    duration: 1,
    impact: 0.55,
    then: "refIdle",
    keys: keys(pose(STAND, REF_SPEC()), [
      [0, {}],
      [0.3, { rear: [-0.06, 1.52, 0.4], rearPole: [-1, -0.5, -0.3], rearPalm: [1, 0, 0], fist: 0, head: [0.1, 0, 0] }],
      [0.55, { rear: [-0.06, 0.98, 0.48], rearPalm: [1, -0.1, 0.1], lean: 0.1 }],
      [1, { ...REF_SPEC() }],
    ]),
  },
  // raising the winner's hand: the left hand holds the winner's wrist up (winner at REF_RAISE.winner)
  refRaise: {
    kind: "referee",
    duration: 2,
    loop: true,
    impact: null,
    keys: keys(pose(STAND, REF_SPEC()), [
      [0, { ...REF_RAISE_SPEC() }],
      [1, { ...REF_RAISE_SPEC(), hips: [0, 0.905, 0], lead: [0.38, 2.02, 0.06] }],
      [2, { ...REF_RAISE_SPEC() }],
    ]),
  },
};

function VICTORY_SPEC(): PoseSpec {
  return {
    hips: [0, 0.905, 0],
    yaw: -0.12,
    chest: 0,
    lean: -0.08,
    bend: 0,
    head: [-0.22, 0, 0],
    lead: [0.28, 1.95, 0.05],
    rear: [-0.28, 1.95, 0.05],
    leadPole: [1, -0.1, -0.3],
    rearPole: [-1, -0.1, -0.3],
    leadPalm: [0, 0, 1],
    rearPalm: [0, 0, 1],
    leadFoot: [0.15, 0, 0.14],
    rearFoot: [-0.15, 0, -0.1],
    leadFootYaw: 0,
    rearFootYaw: -0.3,
    rearHeel: 0,
    smile: 1,
    focus: 0,
    jaw: 0.25,
    shrugLead: 0.6,
    shrugRear: 0.6,
  };
}
function DEFEAT_SPEC(): PoseSpec {
  return {
    hips: [0, 0.9, 0],
    yaw: -0.1,
    chest: 0,
    lean: 0.1,
    bend: 0,
    head: [0.5, 0, 0],
    lead: [0.14, 1.0, 0.2],
    rear: [-0.14, 1.0, 0.18],
    leadPole: [0.8, -0.4, -0.6],
    rearPole: [-0.8, -0.4, -0.6],
    leadPalm: [-0.8, 0, -0.5],
    rearPalm: [0.8, 0, -0.5],
    leadFoot: [0.14, 0, 0.08],
    rearFoot: [-0.14, 0, -0.06],
    leadFootYaw: 0,
    rearFootYaw: -0.2,
    rearHeel: 0,
    focus: 0,
    smile: 0,
    shrugLead: 0,
    shrugRear: 0,
  };
}
function WINNER_SPEC(): PoseSpec {
  return {
    hips: [0, 0.905, 0],
    yaw: 0,
    chest: 0,
    lean: -0.04,
    bend: 0.04,
    head: [-0.1, -0.1, 0],
    lead: [0.2, 1.05, 0.12],
    leadPole: [0.8, -0.3, -0.5],
    leadPalm: [-0.8, 0, -0.4],
    rear: [-0.24, 2.0, 0.03],
    rearPole: [-1, 0, -0.2],
    rearPalm: [0, 0, 1],
    leadFoot: [0.14, 0, 0.05],
    rearFoot: [-0.14, 0, -0.04],
    leadFootYaw: 0.05,
    rearFootYaw: -0.15,
    rearHeel: 0,
    smile: 1,
    focus: 0,
    jaw: 0.2,
    shrugRear: 0.7,
  };
}
function REF_SPEC(): PoseSpec {
  return { hips: [0, 0.9, 0], lead: [0.08, 0.98, 0.16], rear: [-0.08, 0.98, 0.16], leadPole: [0.8, -0.3, -0.6], rearPole: [-0.8, -0.3, -0.6], leadPalm: [-0.6, 0, -0.6], rearPalm: [0.6, 0, -0.6], fist: 0.3, lean: 0.04, head: [0.05, 0, 0], focus: 0.3 };
}
function REF_RAISE_SPEC(): PoseSpec {
  return { ...REF_SPEC(), lead: [0.38, 1.97, 0.04], leadPole: [1, 0, -0.3], leadPalm: [-1, 0, 0], fist: 0.6, bend: -0.05, head: [-0.05, 0.35, 0], smile: 0.4, focus: 0 };
}

/** a pose as a full spec (for "end exactly in this pose" keys) */
function specOf(p: Pose): PoseSpec {
  const v = (i: number): V3 => [p[i]!, p[i + 1]!, p[i + 2]!];
  return {
    hips: v(P.hx),
    yaw: p[P.yaw]!,
    chest: p[P.chest]!,
    lean: p[P.lean]!,
    bend: p[P.bend]!,
    head: v(P.hp),
    lead: v(P.lx),
    leadPole: v(P.lpx),
    leadPalm: v(P.lnx),
    rear: v(P.rx),
    rearPole: v(P.rpx),
    rearPalm: v(P.rnx),
    leadFoot: v(P.fLx),
    leadFootYaw: p[P.fLyaw]!,
    leadHeel: p[P.fLheel]!,
    rearFoot: v(P.fRx),
    rearFootYaw: p[P.fRyaw]!,
    rearHeel: p[P.fRheel]!,
    leadKnee: v(P.kLx),
    rearKnee: v(P.kRx),
    fist: p[P.fist]!,
    focus: p[P.focus]!,
    effort: p[P.effort]!,
    wince: p[P.wince]!,
    smile: p[P.smile]!,
    jaw: p[P.jaw]!,
    eyes: p[P.eyes]!,
    shrugLead: p[P.shrugL]!,
    shrugRear: p[P.shrugR]!,
  };
}

/**
 * Where the referee stands to raise a winner's hand: in the winner's frame (same facing, towards the audience),
 * the referee is `offset` metres to the side of the winner's raised (rear) hand. Mirrored winners: flip x.
 */
export const REF_RAISE = { offset: [-0.62, 0, 0] as V3 };
/** Fighters' distance for touching gloves (root to root, m). */
export const TOUCH_DISTANCE = 0.92;

/* ---------------- the clip table ---------------- */

const CLIPS = {} as Record<BoxingClipName, ClipDef>;
for (const [name, d] of Object.entries(DEFS) as [BoxingClipName, Def][]) {
  const loop = d.loop ?? false;
  const impactEvents: ClipEvent[] = d.impact !== null && d.impact > 0 && d.kind !== "reaction" ? [{ t: d.impact, kind: "impact" }] : [];
  CLIPS[name] = {
    ...d,
    name,
    loop,
    then: loop ? null : d.then === undefined ? (d.kind === "referee" ? "refIdle" : "guardIdle") : d.then,
    recovery: d.recovery ?? (d.impact !== null && !loop ? Math.max(0, d.duration - d.impact) : 0),
    events: [...impactEvents, ...(d.events ?? [])].sort((a, b) => a.t - b.t),
  };
}

/** Public clip table: name → duration, impact, recovery, loop, travel, events … */
export const BOXING_CLIPS: Readonly<Record<BoxingClipName, Readonly<BoxingClipInfo>>> = CLIPS;
export const BOXING_CLIP_NAMES = Object.keys(CLIPS) as BoxingClipName[];
export const PUNCHES: readonly BoxingClipName[] = BOXING_CLIP_NAMES.filter((n) => CLIPS[n].kind === "punch");

/* ---------------- sampling ---------------- */

/** monotone cubic Hermite tangents (Fritsch–Carlson), zero at the ends of a one-shot */
function tangents(ts: number[], vs: number[], loop: boolean): number[] {
  const n = vs.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1]! - vs[i]!) / Math.max(1e-6, ts[i + 1]! - ts[i]!));
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1]!,
      b = d[i]!;
    m[i] = a * b <= 0 ? 0 : (3 * (ts[i + 1]! - ts[i - 1]!)) / ((2 * ts[i + 1]! - ts[i]! - ts[i - 1]!) / a + (ts[i + 1]! - 2 * ts[i - 1]! + ts[i]!) / b);
  }
  if (loop && n > 2) {
    // the seam (first = last key): slope from the neighbours across it
    const a = d[n - 2]!,
      b = d[0]!;
    const s = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    m[0] = s;
    m[n - 1] = s;
  }
  return m;
}

interface Track {
  ts: number[];
  /** per key: pose values */
  vs: Float32Array[];
  /** per key: tangents (channel-wise) */
  ms: Float32Array[];
  travel?: { ts: number[]; vs: number[][]; ms: number[][] };
}

const tracks = new Map<BoxingClipName, Track>();
function trackOf(name: BoxingClipName): Track {
  let tr = tracks.get(name);
  if (tr) return tr;
  const c = CLIPS[name];
  const ts = c.keys.map((k) => k.t);
  const vs = c.keys.map((k) => k.p);
  const ms = vs.map(() => new Float32Array(POSE_SIZE));
  for (let ch = 0; ch < POSE_SIZE; ch++) {
    const m = tangents(
      ts,
      vs.map((v) => v[ch]!),
      c.loop,
    );
    m.forEach((x, i) => (ms[i]![ch] = x));
  }
  tr = { ts, vs, ms };
  if (c.travelKeys) {
    const tts = c.travelKeys.map((k) => k[0]);
    const tvs = c.travelKeys.map((k) => [k[1], k[2], k[3]]);
    const tms = tvs.map(() => [0, 0, 0]);
    for (let ch = 0; ch < 3; ch++) {
      const m = tangents(
        tts,
        tvs.map((v) => v[ch]!),
        false,
      );
      m.forEach((x, i) => (tms[i]![ch] = x));
    }
    tr.travel = { ts: tts, vs: tvs, ms: tms };
  }
  tracks.set(name, tr);
  return tr;
}

function hermite(p0: number, m0: number, p1: number, m1: number, h: number, s: number) {
  const s2 = s * s,
    s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1;
}

function segment(ts: number[], t: number): number {
  let i = 0;
  while (i < ts.length - 2 && t > ts[i + 1]!) i++;
  return i;
}

/** clip-local time → time inside the clip's keys (loops wrap, one-shots clamp; `hold` stretches the hold window) */
export function clipTime(name: BoxingClipName, local: number, hold = 0): number {
  const c = CLIPS[name];
  if (c.loop) return ((local % c.duration) + c.duration) % c.duration;
  let t = Math.max(0, local);
  // a hold stretches the clip at the start of its hold window: the pose stays there `hold` s longer, then runs on
  if (c.hold && hold > 0 && t > c.hold[0]) t = t < c.hold[0] + hold ? c.hold[0] : t - hold;
  return Math.min(t, c.duration);
}

/** Pose of a clip at clip time `t` (s), orthodox, into `out`. */
export function sampleClip(name: BoxingClipName, t: number, out: Pose = newPose()): Pose {
  const tr = trackOf(name);
  const { ts, vs, ms } = tr;
  if (ts.length === 1 || t <= ts[0]!) {
    out.set(vs[0]!);
    return out;
  }
  if (t >= ts[ts.length - 1]!) {
    out.set(vs[vs.length - 1]!);
    return out;
  }
  const i = segment(ts, t);
  const h = ts[i + 1]! - ts[i]!;
  const s = (t - ts[i]!) / Math.max(1e-6, h);
  const a = vs[i]!,
    b = vs[i + 1]!,
    ma = ms[i]!,
    mb = ms[i + 1]!;
  for (let ch = 0; ch < POSE_SIZE; ch++) out[ch] = hermite(a[ch]!, ma[ch]!, b[ch]!, mb[ch]!, h, s);
  return out;
}

/** Root travel of a clip at clip time `t`: [x, z, yaw] in the clip's start frame (orthodox; mirror flips x / yaw). */
export function clipTravel(name: BoxingClipName, t: number, mirrored = false, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const tr = trackOf(name).travel;
  if (!tr) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const { ts, vs, ms } = tr;
  if (t <= ts[0]!) out.splice(0, 3, ...(vs[0] as [number, number, number]));
  else if (t >= ts[ts.length - 1]!) out.splice(0, 3, ...(vs[vs.length - 1] as [number, number, number]));
  else {
    const i = segment(ts, t);
    const h = ts[i + 1]! - ts[i]!;
    const s = (t - ts[i]!) / Math.max(1e-6, h);
    for (let ch = 0; ch < 3; ch++) out[ch] = hermite(vs[i]![ch]!, ms[i]![ch]!, vs[i + 1]![ch]!, ms[i + 1]![ch]!, h, s);
  }
  if (mirrored) {
    out[0] = -out[0];
    out[2] = -out[2];
  }
  return out;
}

/**
 * Plant the feet of a travelling clip: the feet were authored in the clip's start frame; express them in the frame of
 * the root that has travelled by `tr` (orthodox values, before mirroring).
 */
export function compensateTravel(p: Pose, tr: readonly [number, number, number]): Pose {
  const [tx, tz, ty] = tr;
  if (tx === 0 && tz === 0 && ty === 0) return p;
  const c = Math.cos(-ty),
    s = Math.sin(-ty);
  for (const [ix, iz, iyaw] of [
    [P.fLx, P.fLz, P.fLyaw],
    [P.fRx, P.fRz, P.fRyaw],
  ] as const) {
    const x = p[ix]! - tx,
      z = p[iz]! - tz;
    // rotation about +y by −yaw: x' = x cos + z sin, z' = −x sin + z cos
    p[ix] = x * c + z * s;
    p[iz] = -x * s + z * c;
    p[iyaw] = p[iyaw]! - ty;
  }
  return p;
}
