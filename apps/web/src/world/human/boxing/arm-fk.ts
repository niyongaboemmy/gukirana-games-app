import * as THREE from "three";
import { ARM, ARM_SIZE } from "./pose";

/** the torso as horizontal slices [y, half width, front z, back z] in the chest frame (rig.ts TorsoSlices) */
export type TorsoSlices = readonly (readonly [number, number, number, number])[];
/** > 0 when a sphere of radius r at p (chest frame) overlaps the torso: 1 − its superellipse metric (as rig.ts depth,
 * allocation-free: the keep-out calls it often) */
export function depth(t: TorsoSlices, p: THREE.Vector3, r: number): number {
  if (t.length < 2 || p.y < t[0]![0] || p.y > t[t.length - 1]![0]) return 0;
  let k = 0;
  while (k < t.length - 2 && p.y > t[k + 1]![0]) k++;
  const a = t[k]!,
    b = t[k + 1]!;
  const f = (p.y - a[0]) / (b[0] - a[0] || 1);
  const hw = a[1] + (b[1] - a[1]) * f,
    zf = a[2] + (b[2] - a[2]) * f,
    zb = a[3] + (b[3] - a[3]) * f;
  const cz = (zf + zb) / 2;
  const m = Math.abs(p.x / (hw + r)) ** 2.6 + Math.abs((p.z - cz) / ((zf - zb) / 2 + r)) ** 2.6;
  return 1 - m;
}

/**
 * Keyed arms (P3-FGT-16, docs/FIGHT-REALISM-V5.md): a boxer's arm is posed from ANATOMICAL joint angles (forward
 * kinematics), never solved per frame from a wrist target. The clips key the angles (clips.ts, measured against CMU
 * motion capture of boxing: elbow / shoulder ranges and punch timing); between keys the angles interpolate, so every
 * in-between pose is a blend of two valid human poses. Joint limits are applied to every frame:
 *  - shoulder: flexion / abduction as a swing (a cone that never passes through the trunk: abduction below 0 — across
 *    the body — only once the arm is raised in front) and internal rotation as the twist about the humerus;
 *  - elbow: a hinge, 0 (straight) … 150°, never backwards; no sideways bend at all;
 *  - forearm: pronation / supination as a twist (the build's forearm-twist bone takes half of it: helpers.ts);
 *  - wrist: ±25° (a gloved wrist is held straight).
 * On top, two small corrections only, both in angle space and both re-clamped by the limits:
 *  - aim: the striking glove is bent onto its contact point (≤ 22° of shoulder swing, the elbow opening / closing),
 *    weighted from 0 at the guard to 1 at impact;
 *  - keep-out: elbows, forearms and gloves are kept out of the own torso and head, out of the other arm and out of the
 *    opponent's body (sphere / capsule tests), by the least change of the shoulder angles (a clinch's arms go round,
 *    never through).
 *
 * Frames: the "anatomical" frame is the chest's (Spine2's bind axes, rotated with the chest): +x the person's left,
 * +y up, +z forward. The reference pose of an arm is hanging straight down, palm towards the thigh.
 * Sides: s = +1 for the left arm, −1 for the right; angles mean the same on both sides (mirrored by s).
 */

export const DEG = Math.PI / 180;
/** joint limits (rad) */
export const LIMITS: Record<keyof typeof ARM, readonly [number, number]> = {
  flex: [-40 * DEG, 175 * DEG],
  abd: [-45 * DEG, 130 * DEG],
  rot: [-70 * DEG, 95 * DEG],
  elbow: [0, 150 * DEG],
  pron: [-30 * DEG, 115 * DEG],
  wrist: [-25 * DEG, 25 * DEG],
  elev: [-8 * DEG, 32 * DEG],
  prot: [-15 * DEG, 30 * DEG],
};
const KEYS = Object.keys(ARM) as (keyof typeof ARM)[];

const smooth01 = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Clamp one arm's 8 angles (at offset o of a) to the joint limits, in place. */
export function clampArm(a: ArrayLike<number> & { [i: number]: number }, o = 0) {
  for (const k of KEYS) {
    const [lo, hi] = LIMITS[k];
    const i = o + ARM[k];
    a[i] = Math.min(hi, Math.max(lo, a[i]!));
  }
  // the shoulder cone: an arm hanging at the side cannot adduct through the trunk; across the body only once raised
  // in front (horizontal adduction), and an arm raised behind the body cannot also go far out
  const flex = a[o + ARM.flex]!;
  const abdMin = -5 * DEG + -40 * DEG * smooth01(10 * DEG, 60 * DEG, flex);
  if (a[o + ARM.abd]! < abdMin) a[o + ARM.abd] = abdMin;
  if (flex < 0) a[o + ARM.abd] = Math.min(a[o + ARM.abd]!, 60 * DEG);
  // raising the arm above the head turns it out (the humerus cannot be internally rotated much overhead)
  const elevation = Math.max(flex, a[o + ARM.abd]!);
  const rotMax = 95 * DEG - 55 * DEG * smooth01(100 * DEG, 160 * DEG, elevation);
  if (a[o + ARM.rot]! > rotMax) a[o + ARM.rot] = rotMax;
}

/* ---------------- anatomical rotations (pure) ---------------- */

const X = new THREE.Vector3(1, 0, 0);
const Yv = new THREE.Vector3(0, 1, 0);
const Zv = new THREE.Vector3(0, 0, 1);
/** reference directions: the hanging arm and its elbow hinge (flexion turns the forearm forward about −x) */
export const U_REF = new THREE.Vector3(0, -1, 0);
export const HINGE_REF = new THREE.Vector3(-1, 0, 0);

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** upper arm: swing (flexion about −x after abduction about ±z) then the humeral twist about the bone axis */
export function upperRot(a: ArrayLike<number>, o: number, s: number, out: THREE.Quaternion) {
  out.setFromAxisAngle(X, -a[o + ARM.flex]!);
  out.multiply(_qa.setFromAxisAngle(Zv, s * a[o + ARM.abd]!));
  out.multiply(_qa.setFromAxisAngle(Yv, -s * a[o + ARM.rot]!));
  return out;
}
/** forearm = upper · elbow hinge */
export function foreRot(a: ArrayLike<number>, o: number, s: number, out: THREE.Quaternion) {
  upperRot(a, o, s, out);
  return out.multiply(_qb.setFromAxisAngle(X, -a[o + ARM.elbow]!));
}
const _wax = new THREE.Vector3();
/** hand = forearm · pronation (twist about the forearm) · wrist flexion (towards the palm) */
export function handRot(a: ArrayLike<number>, o: number, s: number, out: THREE.Quaternion) {
  foreRot(a, o, s, out);
  out.multiply(_qb.setFromAxisAngle(Yv, -s * a[o + ARM.pron]!));
  _wax.set(0, 0, -s);
  return out.multiply(_qb.setFromAxisAngle(_wax, a[o + ARM.wrist]!));
}
/** clavicle: elevation (lateral end up) then protraction (lateral end forward) */
export function clavRot(a: ArrayLike<number>, o: number, s: number, out: THREE.Quaternion) {
  out.setFromAxisAngle(Yv, -s * a[o + ARM.prot]!);
  return out.multiply(_qa.setFromAxisAngle(Zv, s * a[o + ARM.elev]!));
}

/* ---------------- an arm's geometry (chest frame) ---------------- */

/** bind geometry of one arm in the chest's bind frame (origin at the Spine2 joint) */
export interface ArmDims {
  s: number;
  clav: THREE.Vector3;
  shoulder: THREE.Vector3;
  upper: number;
  fore: number;
  /** glove centre past the wrist (m, along the fingers) */
  glove: number;
}

/** where the joints are for these angles (chest frame): shoulder, elbow, wrist, glove centre */
export interface ArmPoints {
  sh: THREE.Vector3;
  el: THREE.Vector3;
  wr: THREE.Vector3;
  gl: THREE.Vector3;
}
export const newPoints = (): ArmPoints => ({ sh: new THREE.Vector3(), el: new THREE.Vector3(), wr: new THREE.Vector3(), gl: new THREE.Vector3() });

const _q1 = new THREE.Quaternion();
const _d = new THREE.Vector3();
export function armPoints(d: ArmDims, a: ArrayLike<number>, o: number, out: ArmPoints): ArmPoints {
  clavRot(a, o, d.s, _q1);
  out.sh.copy(d.shoulder).sub(d.clav).applyQuaternion(_q1).add(d.clav);
  upperRot(a, o, d.s, _q1);
  out.el.copy(out.sh).add(_d.copy(U_REF).applyQuaternion(_q1).multiplyScalar(d.upper));
  foreRot(a, o, d.s, _q1);
  _d.copy(U_REF).applyQuaternion(_q1);
  out.wr.copy(out.el).addScaledVector(_d, d.fore);
  handRot(a, o, d.s, _q1);
  out.gl.copy(out.wr).add(_d.copy(U_REF).applyQuaternion(_q1).multiplyScalar(d.glove));
  return out;
}

/* ---------------- corrections ---------------- */

/** a body part to keep the arms out of (chest frame): a sphere, or a capsule from a to b */
export interface Obstacle {
  a: THREE.Vector3;
  b: THREE.Vector3 | null;
  r: number;
}

const _cp = new THREE.Vector3();
const _ab = new THREE.Vector3();
function closestOnSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3 | null, out: THREE.Vector3) {
  if (!b) return out.copy(a);
  _ab.subVectors(b, a);
  const L = _ab.lengthSq();
  const t = L < 1e-9 ? 0 : Math.min(1, Math.max(0, _cp.subVectors(p, a).dot(_ab) / L));
  return out.copy(a).addScaledVector(_ab, t);
}

/** radii of the arm parts (m): the gloved fist, the elbow, the forearm / upper arm */
export const ARM_R = { glove: 0.07, elbow: 0.05, fore: 0.048, upper: 0.055 } as const;

const _pts = newPoints();
const _s = new THREE.Vector3();
const _c = new THREE.Vector3();

/** how far the arm (these angles) is inside the obstacles / the own torso: a sum of squared overlaps (m²) */
export function penetration(d: ArmDims, a: ArrayLike<number>, o: number, obs: readonly Obstacle[], torso: TorsoSlices | null, torsoFrom = 0.25): number {
  const p = armPoints(d, a, o, _pts);
  let pen = 0;
  const test = (q: THREE.Vector3, r: number) => {
    for (const ob of obs) {
      closestOnSeg(q, ob.a, ob.b, _c);
      const ov = r + ob.r - q.distanceTo(_c);
      if (ov > 0) pen += ov * ov;
    }
    if (torso) {
      const k = depth(torso, q, r);
      // depth is 1 − a superellipse metric: about overlap / half-size; ×0.15 m → metres
      if (k > 0) pen += (k * 0.15) ** 2;
    }
  };
  test(p.gl, ARM_R.glove);
  test(_s.lerpVectors(p.el, p.wr, 0.5), ARM_R.fore);
  test(_s.lerpVectors(p.el, p.wr, 0.8), ARM_R.fore);
  test(p.el, ARM_R.elbow);
  // the upper arm only away from the shoulder (the armpit is allowed to touch the side)
  test(_s.lerpVectors(p.sh, p.el, 0.75), ARM_R.upper);
  void torsoFrom;
  return pen;
}

const _g = new Float64Array(ARM_SIZE);
const _tmp = new Float64Array(ARM_SIZE);
/** the shoulder / elbow angles a correction may change, and how much a radian of each costs */
const FREE: readonly [number, number][] = [
  [ARM.flex, 1],
  [ARM.abd, 1],
  [ARM.rot, 1.4],
  [ARM.elbow, 2],
];

/**
 * Keep-out: move the arm out of the obstacles by the least change of the shoulder angles (then the elbow), at most
 * `maxStep` rad per angle in total; projected gradient descent in angle space, re-clamped each step.
 */
export function keepOut(d: ArmDims, a: Float32Array, o: number, obs: readonly Obstacle[], torso: TorsoSlices | null, iters = 6, maxStep = 0.6) {
  let pen = penetration(d, a, o, obs, torso);
  if (pen < 1e-7) return 0;
  for (let k = 0; k < ARM_SIZE; k++) _tmp[k] = a[o + k]!;
  for (let it = 0; it < iters && pen > 1e-7; it++) {
    const h = 0.02;
    let gl = 0;
    for (const [i, cost] of FREE) {
      const v = a[o + i]!;
      a[o + i] = v + h;
      clampArm(a, o);
      const p1 = penetration(d, a, o, obs, torso);
      a[o + i] = v;
      _g[i] = (p1 - pen) / h / cost;
      gl += _g[i]! * _g[i]!;
    }
    if (gl < 1e-14) break;
    gl = Math.sqrt(gl);
    // a step that would clear the overlap linearly, ≤ 0.15 rad
    const step = Math.min(0.15, (pen / gl) * 1.5);
    for (const [i] of FREE) {
      const nv = a[o + i]! - (_g[i]! / gl) * step;
      a[o + i] = Math.min(_tmp[i]! + maxStep, Math.max(_tmp[i]! - maxStep, nv));
    }
    clampArm(a, o);
    pen = penetration(d, a, o, obs, torso);
  }
  return pen;
}

const _gl = new THREE.Vector3();
const _err = new THREE.Vector3();
const _J = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const AIM_FREE = [ARM.flex, ARM.abd, ARM.elbow] as const;
/**
 * Aim: bend the keyed arm so the glove centre comes to `target` (chest frame), weighted by k (0…1). Damped least
 * squares on shoulder flexion, abduction and the elbow; the change is capped (22° of swing, the elbow ±60°) and the
 * result re-clamped: a target out of reach is reached as far as a real arm can, never by bending a joint the wrong way.
 */
export function aimArm(d: ArmDims, a: Float32Array, o: number, target: THREE.Vector3, k: number, iters = 4) {
  if (k < 0.002) return;
  for (let q = 0; q < ARM_SIZE; q++) _tmp[q] = a[o + q]!;
  for (let it = 0; it < iters; it++) {
    armPoints(d, a, o, _pts);
    _gl.copy(_pts.gl);
    _err.subVectors(target, _gl);
    if (_err.lengthSq() < 1e-6) break;
    const h = 0.01;
    AIM_FREE.forEach((i, j) => {
      const v = a[o + i]!;
      a[o + i] = v + h;
      armPoints(d, a, o, _pts);
      a[o + i] = v;
      _J[j]!.subVectors(_pts.gl, _gl).divideScalar(h);
    });
    // (JᵀJ + λI) Δ = Jᵀ e  (3×3, solved directly)
    const lam = 0.02;
    const A = [0, 1, 2].map((r) => [0, 1, 2].map((c) => _J[r]!.dot(_J[c]!) + (r === c ? lam : 0)));
    const b = [0, 1, 2].map((r) => _J[r]!.dot(_err));
    const det = (m: number[][]) => m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
    const D = det(A);
    if (Math.abs(D) < 1e-12) break;
    for (let j = 0; j < 3; j++) {
      const M = A.map((row, r) => row.map((x, c) => (c === j ? b[r]! : x)));
      const delta = det(M) / D;
      const i = AIM_FREE[j]!;
      const cap = i === ARM.elbow ? 60 * DEG : 22 * DEG;
      a[o + i] = Math.min(_tmp[i]! + cap, Math.max(_tmp[i]! - cap, a[o + i]! + delta));
    }
    clampArm(a, o);
  }
  // weight: the correction grows from the guard to the impact
  if (k < 0.999) for (let q = 0; q < ARM_SIZE; q++) a[o + q] = _tmp[q]! + (a[o + q]! - _tmp[q]!) * k;
}

/* ---------------- the bones ---------------- */

interface ArmBonesFk {
  s: number;
  clav: THREE.Bone | null;
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  /** bind rotations relative to the root */
  rest: { clav: THREE.Quaternion; upper: THREE.Quaternion; fore: THREE.Quaternion; hand: THREE.Quaternion };
  /** bind → reference (hanging arm) for each segment */
  B: { upper: THREE.Quaternion; fore: THREE.Quaternion; hand: THREE.Quaternion };
  dims: ArmDims;
}

/** rotation taking the orthonormal frame (a, b, a×b) onto (A, B, A×B) */
function frameToFrame(a: THREE.Vector3, b: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3): THREE.Quaternion {
  const m1 = new THREE.Matrix4().makeBasis(a, b, new THREE.Vector3().crossVectors(a, b));
  const m2 = new THREE.Matrix4().makeBasis(A, B, new THREE.Vector3().crossVectors(A, B));
  return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
}

export interface FkBind {
  rel(bone: THREE.Object3D): THREE.Matrix4 | null;
}

const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qr = new THREE.Quaternion();

/**
 * The keyed-arm driver for one body: maps the anatomical angles onto its bones (each segment's bind direction, elbow
 * hinge and palm measured from the skeleton), and gives the arm geometry in the chest frame for the corrections.
 */
export class ArmFk {
  readonly arms: { L: ArmBonesFk | null; R: ArmBonesFk | null };
  private readonly chest: THREE.Bone;
  private readonly chestRest: THREE.Quaternion;
  readonly chestBindPos: THREE.Vector3;

  constructor(
    root: THREE.Object3D,
    bind: FkBind,
    chest: THREE.Bone,
    bones: (name: string) => THREE.Bone | null,
  ) {
    const pos = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(bind.rel(b) ?? new THREE.Matrix4());
    const rot = (b: THREE.Object3D) => {
      const m = bind.rel(b);
      const q = new THREE.Quaternion();
      if (m) m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      return q;
    };
    void root;
    this.chest = chest;
    this.chestRest = rot(chest);
    this.chestBindPos = pos(chest);
    const mk = (S: "L" | "R"): ArmBonesFk | null => {
      const s = S === "L" ? 1 : -1;
      const upper = bones(`Bip01_${S}_UpperArm`);
      const fore = bones(`Bip01_${S}_Forearm`);
      const hand = bones(`Bip01_${S}_Hand`);
      if (!upper || !fore || !hand) return null;
      const clav = bones(`Bip01_${S}_Clavicle`);
      const fing = bones(`Bip01_${S}_Finger2`);
      const thumb = bones(`Bip01_${S}_Finger0`);
      const P = { sh: pos(upper), el: pos(fore), wr: pos(hand), f2: fing ? pos(fing) : null, th: thumb ? pos(thumb) : null, cl: clav ? pos(clav) : pos(upper) };
      const u = new THREE.Vector3().subVectors(P.el, P.sh).normalize();
      const f = new THREE.Vector3().subVectors(P.wr, P.el).normalize();
      const h = new THREE.Vector3().crossVectors(u, f);
      if (h.lengthSq() < 1e-6) h.copy(HINGE_REF);
      h.normalize();
      // the hinge must be the one that bends the forearm forward (−x for both sides in the reference)
      if (h.x > 0) h.negate();
      const hu = h.clone().addScaledVector(u, -h.dot(u)).normalize();
      const hf = h.clone().addScaledVector(f, -h.dot(f)).normalize();
      const fd = P.f2 ? new THREE.Vector3().subVectors(P.f2, P.wr).normalize() : f.clone();
      // palm normal: fingers × thumb, signed per side (as rig.ts), made ⟂ the fingers
      const td = P.th ? new THREE.Vector3().subVectors(P.th, P.wr).normalize() : new THREE.Vector3(0, 0, 1);
      const palm = new THREE.Vector3().crossVectors(fd, td).multiplyScalar(s);
      palm.addScaledVector(fd, -palm.dot(fd));
      if (palm.lengthSq() < 1e-6) palm.set(-s, 0, 0);
      palm.normalize();
      const palmRef = new THREE.Vector3(-s, 0, 0);
      return {
        s,
        clav,
        upper,
        fore,
        hand,
        rest: { clav: clav ? rot(clav) : new THREE.Quaternion(), upper: rot(upper), fore: rot(fore), hand: rot(hand) },
        B: { upper: frameToFrame(u, hu, U_REF, HINGE_REF), fore: frameToFrame(f, hf, U_REF, HINGE_REF), hand: frameToFrame(fd, palm, U_REF, palmRef) },
        dims: {
          s,
          clav: P.cl.clone().sub(this.chestBindPos),
          shoulder: P.sh.clone().sub(this.chestBindPos),
          upper: P.sh.distanceTo(P.el),
          fore: P.el.distanceTo(P.wr),
          glove: 0.085,
        },
      };
    };
    this.arms = { L: mk("L"), R: mk("R") };
  }

  /** the chest's rotation since the bind pose, relative to the root (call after the spine is posed) */
  chestDelta(rootQ: THREE.Quaternion, out: THREE.Quaternion) {
    this.chest.getWorldQuaternion(out);
    return out.premultiply(_qr.copy(rootQ).invert()).multiply(_qd.copy(this.chestRest).invert());
  }

  /** chest frame → world (for the corrections' obstacles and the glove position) */
  toWorld(p: THREE.Vector3, rootQ: THREE.Quaternion, chestDelta: THREE.Quaternion, out: THREE.Vector3) {
    this.chest.getWorldPosition(_v0);
    return out.copy(p).applyQuaternion(chestDelta).applyQuaternion(rootQ).add(_v0);
  }
  toChest(p: THREE.Vector3, rootQ: THREE.Quaternion, chestDelta: THREE.Quaternion, out: THREE.Vector3) {
    this.chest.getWorldPosition(_v0);
    return out.copy(p).sub(_v0).applyQuaternion(_qr.copy(rootQ).invert()).applyQuaternion(_qd.copy(chestDelta).invert());
  }

  /**
   * Pose one arm from its angles (a[o…o+7]) with weight w over what the bones hold now (w = 1: fully keyed).
   * `rootQ` = the avatar root's world rotation, `delta` = chestDelta().
   */
  apply(arm: ArmBonesFk, a: ArrayLike<number>, o: number, rootQ: THREE.Quaternion, delta: THREE.Quaternion, w: number) {
    const s = arm.s;
    const set = (bone: THREE.Bone | null, anat: THREE.Quaternion, B: THREE.Quaternion | null, rest: THREE.Quaternion) => {
      if (!bone?.parent) return;
      _qw.copy(rootQ).multiply(delta).multiply(anat);
      if (B) _qw.multiply(B);
      _qw.multiply(rest);
      bone.parent.getWorldQuaternion(_qp);
      _qp.invert().multiply(_qw);
      if (w >= 0.999) bone.quaternion.copy(_qp);
      else bone.quaternion.slerp(_qp, w);
      bone.updateMatrixWorld(true);
    };
    set(arm.clav, clavRot(a, o, s, _q1), null, arm.rest.clav);
    set(arm.upper, upperRot(a, o, s, _q1), arm.B.upper, arm.rest.upper);
    set(arm.fore, foreRot(a, o, s, _q1), arm.B.fore, arm.rest.fore);
    set(arm.hand, handRot(a, o, s, _q1), arm.B.hand, arm.rest.hand);
  }
}
const _v0 = new THREE.Vector3();
