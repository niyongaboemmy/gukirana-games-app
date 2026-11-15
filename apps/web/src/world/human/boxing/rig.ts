import * as THREE from "three";
import { curl, reach, type ArmBones } from "../procedural";
import { P, type Pose } from "./pose";

/**
 * Boxing rig layer (P3-FGT-02): puts a boxing pose (pose.ts) on a Rocketbox body, after the mixer. The pose fully
 * takes over the trunk, arms and legs (the mocap underneath only keeps the fingers / clavicles alive):
 *  - hips (Bip01) moved to the pose's height / offset and turned by the pelvis yaw;
 *  - pelvis → spine → chest → neck → head set ABSOLUTELY from their bind orientation (yaw / lean / side bend spread
 *    over the spine, the head aimed on its own: the eyes stay on the opponent while the torso turns through a punch);
 *  - shoulders shrugged up to protect the chin on the punching side;
 *  - two-bone arm IK to the wrist targets with elbow poles, the wrist kept straight (knuckles along the forearm) and
 *    the fist turned to the pose's palm direction, fingers closed into a fist;
 *  - two-bone leg IK to the ankle targets (planted feet, heel raises about the ball of the foot), feet / toes
 *    oriented flat from their bind pose.
 * Positions are authored for a reference body and scaled to this body (hip height for the legs, shoulder height for
 * the arms). Bind data come from the skeleton's inverse bind matrices, so the layer can be built on a posed body.
 * `w` blends the whole layer over the clip pose (entering / leaving the ring). No allocations per frame.
 */

/** reference body the poses are authored for (masculine Rocketbox, measured in the bind pose) */
export const REF_BODY = { hipY: 0.8952, shoulderY: 1.43 };

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _one = new THREE.Vector3(1, 1, 1);
const _kv = new THREE.Vector3();
const _ks = new THREE.Vector3();
const _ke = new THREE.Vector3();
const _kh = new THREE.Vector3();
const _kn = new THREE.Vector3();
const _kp = new THREE.Vector3();
const _kd = new THREE.Vector3();
const _kel = new THREE.Vector3();
const _kq = new THREE.Quaternion();
const _kfw = new THREE.Vector3();

/**
 * The torso as horizontal slices [y, half width, front z, back z] relative to the Spine2 joint in its bind frame
 * (build.mjs `torsoSlices`). A slice is a superellipse round (0, (front + back) / 2).
 */
export type TorsoSlices = readonly (readonly [number, number, number, number])[];
/** keep-out radii (m): glove padding round the wrist target, elbow, the middle of the upper arm / forearm */
export const KEEP = { glove: 0.06, elbow: 0.05, upper: 0.045, fore: 0.045 } as const;
const SE = 2.6;
/** points along the forearm (elbow → wrist) checked against the trunk */
const FORE_SAMPLES = [0.3, 0.6, 0.85] as const;

/** the slice at height y (null above the neck base / below the lower back) */
export function torsoAt(t: TorsoSlices, y: number): { hw: number; zf: number; zb: number } | null {
  if (t.length < 2 || y < t[0]![0] || y > t[t.length - 1]![0]) return null;
  let k = 0;
  while (k < t.length - 2 && y > t[k + 1]![0]) k++;
  const a = t[k]!,
    b = t[k + 1]!;
  const f = (y - a[0]) / (b[0] - a[0] || 1);
  return { hw: a[1] + (b[1] - a[1]) * f, zf: a[2] + (b[2] - a[2]) * f, zb: a[3] + (b[3] - a[3]) * f };
}

/** > 0 when a sphere of radius r at p (chest-local) overlaps the torso (1 − its superellipse metric) */
export function depth(t: TorsoSlices, p: THREE.Vector3, r: number): number {
  const s = torsoAt(t, p.y);
  if (!s) return 0;
  const cz = (s.zf + s.zb) / 2;
  const ax = s.hw + r,
    az = (s.zf - s.zb) / 2 + r;
  const m = Math.abs(p.x / ax) ** SE + Math.abs((p.z - cz) / az) ** SE;
  return 1 - m;
}

/**
 * Move p (chest-local) onto the inflated torso surface if it is inside; true when moved. A glove in the front part of
 * the trunk comes out FORWARD (to the chest's front at the same height and side position: a glove is never pushed out
 * sideways through the far flank), one at the back radially.
 */
export function pushOut(t: TorsoSlices, p: THREE.Vector3, r: number): boolean {
  const s = torsoAt(t, p.y);
  if (!s) return false;
  const cz = (s.zf + s.zb) / 2;
  const ax = s.hw + r,
    az = (s.zf - s.zb) / 2 + r;
  let dx = p.x,
    dz = p.z - cz;
  if (Math.abs(dx) + Math.abs(dz) < 1e-5) dz = 1e-3;
  const m = Math.abs(dx / ax) ** SE + Math.abs(dz / az) ** SE;
  if (m >= 1) return false;
  if (dz > -0.4 * az) {
    p.z = cz + az * Math.max(0, 1 - Math.abs(dx / ax) ** SE) ** (1 / SE);
    return true;
  }
  const k = m ** (-1 / SE);
  dx *= k;
  dz *= k;
  p.x = dx;
  p.z = cz + dz;
  return true;
}

/** rotation in the avatar frame: yaw about +y, then pitch about +x (+ = forward / down), then roll about +z */
function frameRot(yaw: number, pitch: number, roll: number, out: THREE.Quaternion) {
  _e.set(pitch, yaw, roll, "YXZ");
  return out.setFromEuler(_e);
}

interface Chain {
  bone: THREE.Bone;
  /** bind orientation relative to the avatar root */
  rest: THREE.Quaternion;
}

interface Leg extends ArmBones {
  toe: THREE.Bone | null;
  footRest: THREE.Quaternion;
  toeRest: THREE.Quaternion | null;
}

interface Arm extends ArmBones {
  clav: THREE.Bone | null;
  /** hand-local axes: towards the middle finger, out of the palm */
  fingerL: THREE.Vector3;
  palmL: THREE.Vector3;
}

export interface BindData {
  /** bind matrix of a bone relative to the avatar root (null when the bone has no bind data) */
  rel(bone: THREE.Object3D): THREE.Matrix4 | null;
}

/** Bind-pose matrices relative to the root, from the body's inverse bind matrices (pose-independent). */
export function bindData(root: THREE.Object3D): { body: THREE.SkinnedMesh | null; bind: BindData } {
  let body: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!body && m.isSkinnedMesh && m.parent?.name !== "lod1" && m.skeleton.bones.some((b) => b.name === "Bip01_L_Calf")) body = m;
  });
  root.updateMatrixWorld(true);
  const b = body as THREE.SkinnedMesh | null;
  const toRoot = new THREE.Matrix4();
  if (b) toRoot.copy(root.matrixWorld).invert().multiply(b.matrixWorld).multiply(new THREE.Matrix4().copy(b.bindMatrix).invert());
  return {
    body: b,
    bind: {
      rel(bone) {
        if (!b) return null;
        const i = b.skeleton.bones.indexOf(bone as THREE.Bone);
        if (i < 0) return null;
        return new THREE.Matrix4().copy(b.skeleton.boneInverses[i]!).invert().premultiply(toRoot);
      },
    },
  };
}

const relQuat = (m: THREE.Matrix4 | null, out: THREE.Quaternion) => {
  if (!m) return out.identity();
  m.decompose(_v, out, _v2);
  return out;
};

export class BoxingRig {
  private readonly chain: { hips: Chain | null; pelvis: Chain | null; spine: Chain[]; neck: Chain | null; head: Chain | null };
  private readonly arms: { L: Arm | null; R: Arm | null };
  private readonly legs: { L: Leg | null; R: Leg | null };
  private readonly hips: THREE.Bone | null;
  /** scale of the authored positions for this body: legs / hips, arms */
  readonly kLeg: number;
  readonly kArm: number;
  readonly ankleH: number;
  readonly ballDist: number;
  /** measured bind values (for the lab / tests) */
  readonly measured: { hipY: number; shoulderY: number; headY: number; armLen: number; legLen: number };

  /** this body's torso for the arm keep-out (null: no keep-out, the reference body the poses were authored on) */
  private readonly torso: TorsoSlices | null;
  private readonly chest: Chain | null;
  private readonly frame = new THREE.Matrix4();
  private readonly frameInv = new THREE.Matrix4();

  constructor(
    private readonly root: THREE.Object3D,
    arms: ArmBones[],
    opts: { torso?: TorsoSlices | null } = {},
  ) {
    const bone = (n: string) => (root.getObjectByName(n) as THREE.Bone | undefined) ?? null;
    const { bind } = bindData(root);
    const mk = (n: string): Chain | null => {
      const b = bone(n);
      return b ? { bone: b, rest: relQuat(bind.rel(b), new THREE.Quaternion()) } : null;
    };
    const pos = (b: THREE.Object3D | null) => {
      const m = b ? bind.rel(b) : null;
      return m ? new THREE.Vector3().setFromMatrixPosition(m) : new THREE.Vector3();
    };
    this.hips = bone("Bip01");
    this.chain = {
      hips: mk("Bip01"),
      pelvis: mk("Bip01_Pelvis"),
      spine: ["Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2"].map(mk).filter((c): c is Chain => !!c),
      neck: mk("Bip01_Neck"),
      head: mk("Bip01_Head"),
    };
    this.torso = opts.torso && opts.torso.length >= 2 ? opts.torso : null;
    this.chest = this.chain.spine.find((c) => c.bone.name === "Bip01_Spine2") ?? null;
    const arm = (side: 1 | -1): Arm | null => {
      const a = arms.find((x) => x.side === side);
      if (!a) return null;
      const k = side === 1 ? "R" : "L";
      const hm = bind.rel(a.hand);
      const inv = hm ? hm.clone().invert() : new THREE.Matrix4();
      const loc = (b: THREE.Object3D | undefined, fb: THREE.Vector3) => (b && bind.rel(b) ? pos(b).applyMatrix4(inv).normalize() : fb);
      const fingerL = loc(a.fingers[2]?.[0], new THREE.Vector3(1, 0, 0));
      const thumbL = loc(a.fingers[0]?.[0], new THREE.Vector3(0, 0, 1));
      // palm normal from the thumb's side (as hand-rest.ts): right hand fingers × thumb = back of the hand
      const palmL = new THREE.Vector3().crossVectors(fingerL, thumbL).multiplyScalar(-side).normalize();
      return { ...a, clav: bone(`Bip01_${k}_Clavicle`), fingerL, palmL };
    };
    this.arms = { L: arm(-1), R: arm(1) };
    const leg = (k: "L" | "R", side: 1 | -1): Leg | null => {
      const upper = bone(`Bip01_${k}_Thigh`);
      const fore = bone(`Bip01_${k}_Calf`);
      const hand = bone(`Bip01_${k}_Foot`);
      if (!upper || !fore || !hand) return null;
      const toe = bone(`Bip01_${k}_Toe0`);
      return { upper, fore, hand, side, fingers: [], toe, footRest: relQuat(bind.rel(hand), new THREE.Quaternion()), toeRest: toe ? relQuat(bind.rel(toe), new THREE.Quaternion()) : null };
    };
    this.legs = { L: leg("L", -1), R: leg("R", 1) };
    // (Bip01 itself has no bind matrix in these skeletons: the pelvis stands for the hips)
    const hipY = pos(this.chain.pelvis?.bone ?? null).y || REF_BODY.hipY;
    const sh = this.arms.L ? pos(this.arms.L.upper) : new THREE.Vector3(0, REF_BODY.shoulderY, 0);
    const el = this.arms.L ? pos(this.arms.L.fore) : sh;
    const wr = this.arms.L ? pos(this.arms.L.hand) : sh;
    const th = this.legs.L ? pos(this.legs.L.upper) : new THREE.Vector3();
    const kn = this.legs.L ? pos(this.legs.L.fore) : th;
    const an = this.legs.L ? pos(this.legs.L.hand) : th;
    const toe = this.legs.L?.toe ? pos(this.legs.L.toe) : an;
    this.measured = { hipY, shoulderY: sh.y, headY: pos(this.chain.head?.bone ?? null).y, armLen: sh.distanceTo(el) + el.distanceTo(wr), legLen: th.distanceTo(kn) + kn.distanceTo(an) };
    this.kLeg = THREE.MathUtils.clamp(hipY / REF_BODY.hipY, 0.85, 1.15);
    this.kArm = THREE.MathUtils.clamp((sh.y || REF_BODY.shoulderY) / REF_BODY.shoulderY, 0.85, 1.15);
    this.ankleH = THREE.MathUtils.clamp(an.y || 0.08, 0.05, 0.13);
    this.ballDist = THREE.MathUtils.clamp(Math.hypot(toe.x - an.x, toe.z - an.z) || 0.13, 0.08, 0.2);
  }

  /** the arm / leg driven as the lead (orthodox: left; mirrored: right) */
  private side(lead: boolean, mirrored: boolean): "L" | "R" {
    return lead !== mirrored ? "L" : "R";
  }

  /**
   * Apply `p` with weight `w`. `mirrored` = the pose is a southpaw pose (lead = right). `detail` = also the
   * fingers / shoulders (people up close).
   */
  apply(p: Pose, w: number, mirrored: boolean, detail = true) {
    if (w < 0.002) return;
    const root = this.root;
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(_q3);
    const rootQ = _q3.clone();
    const kL = this.kLeg,
      kA = this.kArm;

    const yaw = p[P.yaw]!,
      chest = p[P.chest]!,
      lean = p[P.lean]!,
      bend = -p[P.bend]!;
    const set = (c: Chain | null, q: THREE.Quaternion) => {
      if (!c?.bone.parent) return;
      _q.copy(rootQ).multiply(q).multiply(c.rest);
      c.bone.parent.getWorldQuaternion(_q2);
      _q2.invert().multiply(_q);
      c.bone.quaternion.slerp(_q2, w);
      c.bone.updateMatrixWorld(true);
    };
    frameRot(yaw, lean * 0.2, bend * 0.15, _qr);
    set(this.chain.pelvis, _qr);
    // ---- hips position: move the root bone so the pelvis lands on the pose's hip point
    const hips = this.hips;
    const pel = this.chain.pelvis?.bone ?? hips;
    if (hips?.parent && pel) {
      root.localToWorld(_t.set(p[P.hx]! * kL, p[P.hy]! * kL, p[P.hz]! * kL));
      pel.getWorldPosition(_v);
      _t.sub(_v).multiplyScalar(w).add(hips.getWorldPosition(_v2));
      hips.parent.worldToLocal(_t);
      hips.position.copy(_t);
      hips.updateMatrixWorld(true);
    }
    const n = this.chain.spine.length;
    this.chain.spine.forEach((c, i) => {
      const f = (i + 1) / n;
      set(c, frameRot(yaw + chest * f, lean * (0.2 + 0.8 * f), bend * (0.15 + 0.85 * f), _qr));
    });
    const chestQ = frameRot(yaw + chest, lean, bend, new THREE.Quaternion());
    const headQ = frameRot(p[P.hyaw]!, p[P.hp]!, -p[P.hroll]!, new THREE.Quaternion());
    set(this.chain.neck, _qr.copy(chestQ).slerp(headQ, 0.45));
    set(this.chain.head, headQ);

    // ---- shoulders: shrug on the punching side (about the chest's forward axis)
    const leadArm = this.arms[this.side(true, mirrored)];
    const rearArm = this.arms[this.side(false, mirrored)];
    if (detail) {
      for (const [a, s] of [
        [leadArm, p[P.shrugL]!],
        [rearArm, p[P.shrugR]!],
      ] as const) {
        if (!a?.clav?.parent || s < 0.01) continue;
        _v.copy(Z).applyQuaternion(_q.copy(rootQ).multiply(chestQ));
        a.clav.getWorldQuaternion(_q2);
        // left clavicle up = +rotation about forward, right = −
        _q2.premultiply(_qr.setFromAxisAngle(_v, (a.side === -1 ? 1 : -1) * 0.22 * s * w));
        a.clav.parent.getWorldQuaternion(_q);
        a.clav.quaternion.copy(_q.invert().multiply(_q2));
        a.clav.updateMatrixWorld(true);
      }
    }

    // ---- arms: wrists to the targets, straight wrist, fist turned to the palm direction
    const fist = p[P.fist]!;
    const keep = this.torso && this.chest ? this.chestFrame() : null;
    for (const [a, i] of [
      [leadArm, P.lx],
      [rearArm, P.rx],
    ] as const) {
      if (!a) continue;
      root.localToWorld(_t.set(p[i]! * kA, p[i + 1]! * kA, p[i + 2]! * kA));
      _pole.set(p[i + 3]!, p[i + 4]!, p[i + 5]!).applyQuaternion(rootQ);
      // this body's own shoulder rhythm and torso: the clavicle lifts / rolls forward with the arm, the glove and the
      // elbow stay outside the trunk (P3-FGT-14)
      if (keep) {
        _v3.copy(Z).applyQuaternion(_q3.copy(rootQ).multiply(chestQ));
        this.rhythm(a, _t, _pole, _v3, w);
        this.keepOut(a, _t, _pole, keep);
      }
      reach(a, _t, _pole, w);
      // hand: fingers along the forearm, palm towards the pose's palm direction
      a.fore.getWorldPosition(_v);
      a.hand.getWorldPosition(_v2);
      _f.subVectors(_v2, _v).normalize();
      _n.set(p[i + 6]!, p[i + 7]!, p[i + 8]!).applyQuaternion(rootQ);
      this.orient(a.hand, a.fingerL, a.palmL, _f, _n, w);
      if (detail && fist > 0.01) curl(a, 1.45 * fist, w, 0.55 * fist);
    }

    // ---- legs: ankles to the targets (heel raise about the ball of the foot), feet / toes flat from the bind pose
    const leadLeg = this.legs[this.side(true, mirrored)];
    const rearLeg = this.legs[this.side(false, mirrored)];
    for (const [l, i, ki] of [
      [leadLeg, P.fLx, P.kLx],
      [rearLeg, P.fRx, P.kRx],
    ] as const) {
      if (!l) continue;
      const fy = p[i + 3]!;
      const heel = Math.max(0, p[i + 4]!);
      const lift = Math.max(0, p[i + 1]!);
      // the ankle rises as the heel comes up (rotation about the ball), and moves back over it
      const rise = this.ballDist * Math.sin(heel);
      const back = this.ballDist * (1 - Math.cos(heel));
      const dx = Math.sin(fy),
        dz = Math.cos(fy);
      _t.set(p[i]! * kL - dx * back, this.ankleH + lift * kL + rise, p[i + 2]! * kL - dz * back);
      root.localToWorld(_t);
      _pole.set(p[ki]!, p[ki + 1]!, p[ki + 2]!).applyQuaternion(rootQ);
      reach(l, _t, _pole, w);
      if (l.hand.parent) {
        _q.copy(rootQ).multiply(frameRot(fy, heel, 0, _qr)).multiply(l.footRest);
        l.hand.parent.getWorldQuaternion(_q2);
        l.hand.quaternion.slerp(_q2.invert().multiply(_q), w);
        l.hand.updateMatrixWorld(true);
      }
      if (l.toe?.parent && l.toeRest) {
        _q.copy(rootQ).multiply(frameRot(fy, 0, 0, _qr)).multiply(l.toeRest);
        l.toe.parent.getWorldQuaternion(_q2);
        l.toe.quaternion.slerp(_q2.invert().multiply(_q), w);
        l.toe.updateMatrixWorld(true);
      }
    }
  }

  /** the chest frame now: world → Spine2-local (bind axes, origin at the joint), for the torso keep-out */
  private chestFrame(): THREE.Matrix4 {
    const c = this.chest!;
    c.bone.getWorldPosition(_v);
    c.bone.getWorldQuaternion(_q).multiply(_q2.copy(c.rest).invert());
    return this.frame.compose(_v, _q, _one).invert();
  }

  /**
   * Shoulder rhythm (P3-FGT-14): on the reference body the mocap moved the clavicles; on this one nothing did, so a
   * raised arm folded the deltoid over the top of the shoulder. Like a real shoulder girdle, the clavicle now lifts
   * by ⅓ of the upper arm's elevation above 55° (≤ 0.3 rad) and rolls forward as the elbow comes forward / across (≤ 0.22 rad: the
   * shoulder goes into a straight punch). From the two-bone elbow for the current target / pole.
   */
  private rhythm(a: Arm, target: THREE.Vector3, pole: THREE.Vector3, fwd: THREE.Vector3, w: number) {
    if (!a.clav?.parent) return;
    if (!this.elbowFor(a, target, pole, _kel)) return;
    _kd.subVectors(_kel, _ks).normalize();
    // elevation from hanging (chest down = −up of the chest frame ≈ world down for the small leans of the poses)
    const elev = Math.acos(THREE.MathUtils.clamp(-_kd.y, -1, 1));
    const lift = THREE.MathUtils.clamp((elev - 0.96) / 3, 0, 0.3);
    // roll forward (protraction) as the elbow comes forward / across: a straight punch, a hook, the rear arm across
    const roll = 0.22 * THREE.MathUtils.clamp(_kd.dot(fwd) * 1.4 - 0.2, 0, 1);
    if (lift < 0.005 && roll < 0.005) return;
    a.clav.getWorldQuaternion(_q2);
    // lift: about the chest's forward axis (left clavicle up = +); roll forward: about the vertical (left: −)
    _q2.premultiply(_kq.setFromAxisAngle(fwd, (a.side === -1 ? 1 : -1) * lift * w));
    _q2.premultiply(_kq.setFromAxisAngle(Y, (a.side === -1 ? -1 : 1) * roll * w));
    a.clav.parent.getWorldQuaternion(_q);
    a.clav.quaternion.copy(_q.invert().multiply(_q2));
    a.clav.updateMatrixWorld(true);
  }

  /** the two-bone elbow position for target / pole (world) into out; fills _ks (shoulder) / _kn (shoulder → target) */
  private elbowFor(a: Arm, target: THREE.Vector3, pole: THREE.Vector3, out: THREE.Vector3): boolean {
    a.upper.getWorldPosition(_ks);
    a.fore.getWorldPosition(_ke);
    a.hand.getWorldPosition(_kh);
    const la = _ks.distanceTo(_ke);
    const lb = _ke.distanceTo(_kh);
    _kn.subVectors(target, _ks);
    const d = THREE.MathUtils.clamp(_kn.length(), 0.05, la + lb - 0.002);
    _kn.normalize();
    const along = (la * la - lb * lb + d * d) / (2 * d);
    const hgt = Math.sqrt(Math.max(0, la * la - along * along));
    _kp.copy(pole).addScaledVector(_kn, -pole.dot(_kn));
    if (_kp.lengthSq() < 1e-6) return false;
    _kp.normalize();
    out.copy(_ks).addScaledVector(_kn, along).addScaledVector(_kp, hgt);
    return true;
  }

  /**
   * Arm keep-out (P3-FGT-14): the authored wrist targets and elbow poles come from a slimmer reference body. On this
   * body's own torso (rig option `torso`, slices from the build) the glove is pushed out of the chest (its padding
   * radius); then the elbow pole swings round the shoulder → wrist line, at most ±90° and never over the shoulder, the least it takes and
   * preferring the lower elbow, until the elbow and both arm segments are outside the trunk; if no swing clears it the
   * wrist target steps forward off the chest (2.5 cm at a time, ≤ 15 cm) and the swing is tried again. Changes
   * `target` / `pole` in place (world).
   */
  private keepOut(a: Arm, target: THREE.Vector3, pole: THREE.Vector3, toLocal: THREE.Matrix4) {
    const toWorld = this.frameInv.copy(toLocal).invert();
    const T = this.torso!;
    // 1. the glove (centred a little past the wrist) out of the chest
    _kv.copy(target).applyMatrix4(toLocal);
    if (pushOut(T, _kv, KEEP.glove)) target.copy(_kv).applyMatrix4(toWorld);
    // chest forward in world (for the target steps)
    _kfw.set(0, 0, 1).transformDirection(toWorld);
    for (let push = 0; push <= 6; push++) {
      if (push > 0) target.addScaledVector(_kfw, 0.025);
      // 2. the elbow: the two-bone solution for this pole; if it (or points along the arm) is inside, swing the pole
      if (!this.elbowFor(a, target, pole, _kel)) return;
      // the elbow circle: centre c, radius h, in the plane ⟂ shoulder → target (_kn); _kp = the pole's in-plane direction
      const c = _kh.copy(_ks).addScaledVector(_kn, _ke.subVectors(_kel, _ks).dot(_kn));
      const hgt = _kel.distanceTo(c);
      const inside = (ang: number) => {
        _kq.setFromAxisAngle(_kn, ang);
        _kd.copy(_kp).applyQuaternion(_kq);
        _kel.copy(c).addScaledVector(_kd, hgt);
        if (depth(T, _kv.copy(_kel).applyMatrix4(toLocal), KEEP.elbow) > 0) return true;
        if (depth(T, _kv.lerpVectors(_ks, _kel, 0.6).applyMatrix4(toLocal), KEEP.upper) > 0) return true;
        for (const f of FORE_SAMPLES) if (depth(T, _kv.lerpVectors(_kel, target, f).applyMatrix4(toLocal), KEEP.fore) > 0) return true;
        return false;
      };
      if (!inside(0)) return;
      let best = NaN,
        bestCost = Infinity;
      for (let k = 1; k <= 16; k++)
        for (const sgn of [1, -1]) {
          const ang = sgn * k * 0.1;
          if (inside(ang) || _kel.y > _ks.y - 0.03) continue;
          // the least swing, and an elbow that rises is worse than one that goes out / down (never over the shoulder)
          const cost = k * 0.1 + Math.max(0, _kel.y - c.y) * 4;
          if (cost < bestCost) {
            bestCost = cost;
            best = ang;
          }
        }
      if (!Number.isNaN(best)) {
        pole.copy(_kd.copy(_kp).applyQuaternion(_kq.setFromAxisAngle(_kn, best)));
        return;
      }
    }
  }

  /** set a bone's world orientation so its local axes (a, b) point along world (A, B) (B made ⟂ A), blended by w */
  private orient(bone: THREE.Bone, a: THREE.Vector3, b: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3, w: number) {
    if (!bone.parent) return;
    // world basis
    _b.copy(B).addScaledVector(A, -B.dot(A));
    if (_b.lengthSq() < 1e-6) return;
    _b.normalize();
    _v3.crossVectors(A, _b);
    _m.makeBasis(A, _b, _v3);
    // local basis
    _v.copy(a).normalize();
    _v2.copy(b).addScaledVector(_v, -b.dot(_v)).normalize();
    _t.crossVectors(_v, _v2);
    _m2.makeBasis(_v, _v2, _t).transpose();
    _m.multiply(_m2);
    _q.setFromRotationMatrix(_m);
    bone.parent.getWorldQuaternion(_q2);
    // the bone may carry a scale: the rotation part only
    bone.quaternion.slerp(_q2.invert().multiply(_q), w);
    bone.updateMatrixWorld(true);
  }

  /** world position of the glove centre (a little ahead of the wrist along the fingers), for FX / hit tests */
  gloveCentre(lead: boolean, mirrored: boolean, out: THREE.Vector3): THREE.Vector3 {
    const a = this.arms[this.side(lead, mirrored)];
    if (!a) return out.set(0, 0, 0);
    a.hand.getWorldPosition(out);
    a.fore.getWorldPosition(_v);
    return out.addScaledVector(_v2.subVectors(out, _v).normalize(), 0.08);
  }

  /** for the lab: the up axis check (unused at runtime) */
  static readonly UP = Y;
}
