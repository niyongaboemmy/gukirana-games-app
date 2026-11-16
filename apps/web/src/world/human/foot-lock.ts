import * as THREE from "three";

/**
 * Foot locking for walking people (QA-HUM-01): the speed-matched gait (animator.ts) gets the stride right on average,
 * but a mocap foot still drifts a few centimetres while it is on the ground (blended clips, the clip's own root drift),
 * which reads as skating. While the ball of a foot is planted its ground point is pinned and the leg is re-solved with
 * a two-bone IK (thigh → calf → ankle, the knee kept in its own bend plane, the foot's world orientation kept), then
 * eased out when the foot lifts. A few centimetres of correction at most: the clip's pose stays the pose.
 */

/** the ball of the foot counts as planted within this height (m) above its resting height */
export const PLANT_H = 0.014;
/** a lock further than this (m) from the animated foot is dropped (turns, teleports): never a long stretched leg */
export const MAX_SLIP = 0.12;

const _h = new THREE.Vector3();
const _k = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u0 = new THREE.Vector3();
const _u1 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qf = new THREE.Quaternion();

/** rotate a bone in world space by q (keeps its children's world poses consistent after updateMatrixWorld) */
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(q);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: turn `thigh` and `calf` so that `foot` (the ankle joint) reaches `target` (world), the knee staying in
 * the leg's current bend plane; the foot keeps its world orientation. Returns the remaining error (m).
 */
export function solveLeg(
  thigh: THREE.Object3D,
  calf: THREE.Object3D,
  foot: THREE.Object3D,
  target: THREE.Vector3,
  fallbackAxis?: THREE.Vector3,
): number {
  foot.getWorldQuaternion(_qf);
  thigh.getWorldPosition(_h);
  calf.getWorldPosition(_k);
  foot.getWorldPosition(_f);
  const a = _k.distanceTo(_h);
  const b = _f.distanceTo(_k);
  _t.copy(target).sub(_h);
  const c = THREE.MathUtils.clamp(_t.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  if (a < 1e-5 || b < 1e-5 || _t.lengthSq() < 1e-10) return _f.distanceTo(target);
  _t.normalize();
  // the bend plane: thigh × shin (degenerate when straight: the fallback axis, e.g. the body's side axis)
  _u0.copy(_k).sub(_h).normalize();
  _n.copy(_u0).cross(_a.copy(_f).sub(_k));
  if (_n.lengthSq() < 1e-10) {
    if (!fallbackAxis) return _f.distanceTo(target);
    _n.copy(fallbackAxis);
  }
  _n.normalize();
  // which side of the hip→ankle line the knee is on (about the bend axis)
  _a.copy(_f).sub(_h).normalize();
  const side = Math.sign(_a.clone().cross(_u0).dot(_n)) || 1;
  const alpha = Math.acos(THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1));
  _u1.copy(_t).applyAxisAngle(_n, side * alpha);
  rotateWorld(thigh, _q.setFromUnitVectors(_u0, _u1));
  // shin: from the new knee to the target
  calf.getWorldPosition(_k);
  foot.getWorldPosition(_f);
  _u0.copy(_f).sub(_k).normalize();
  _u1.copy(target).sub(_k).normalize();
  rotateWorld(calf, _q.setFromUnitVectors(_u0, _u1));
  // the foot keeps the orientation the clip gave it
  foot.parent!.getWorldQuaternion(_qp);
  foot.quaternion.copy(_qp.invert().multiply(_qf));
  foot.updateMatrixWorld(true);
  return foot.getWorldPosition(_f).distanceTo(target);
}

interface Leg {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
  toe: THREE.Object3D;
  /** the ball of the foot's ground height above the root (bind pose, then a running minimum of the plants) */
  rest: number;
  lock: THREE.Vector3 | null;
  /** 0 … 1 how much the lock holds (eases in on plant, out on lift) */
  w: number;
  /** the last applied ground offset (eased out after a lift) */
  off: THREE.Vector3;
}

export class FootLock {
  private legs: Leg[] = [];
  private side = new THREE.Vector3();

  /** bones by name (Rocketbox "Bip01_L_Thigh" … / any rig with the same names); measured in the bind pose */
  constructor(
    private root: THREE.Object3D,
    bone: (name: string) => THREE.Object3D | null | undefined,
  ) {
    root.updateMatrixWorld(true);
    const ry = root.getWorldPosition(_a).y;
    for (const s of ["L", "R"]) {
      const thigh = bone(`Bip01_${s}_Thigh`),
        calf = bone(`Bip01_${s}_Calf`),
        foot = bone(`Bip01_${s}_Foot`),
        toe = bone(`Bip01_${s}_Toe0`);
      if (!thigh || !calf || !foot || !toe) continue;
      this.legs.push({
        thigh,
        calf,
        foot,
        toe,
        rest: toe.getWorldPosition(_a).y - ry,
        lock: null,
        w: 0,
        off: new THREE.Vector3(),
      });
    }
  }

  get ready() {
    return this.legs.length === 2;
  }

  /** after the clips: `moving` 0 … 1 (the gait weight); pins planted feet, eases the correction out otherwise */
  apply(dt: number, moving: number) {
    if (!this.ready) return;
    const root = this.root;
    root.updateMatrixWorld(true);
    const ry = root.getWorldPosition(_a).y;
    this.side.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(_q));
    for (const l of this.legs) {
      const toe = l.toe.getWorldPosition(new THREE.Vector3());
      // the ground level of this foot follows the clip's actual plants (a slowly rising running minimum)
      const h = toe.y - ry;
      l.rest = Math.min(l.rest + dt * 0.03, h);
      const planted = moving > 0.3 && h < l.rest + PLANT_H;
      if (planted) {
        if (!l.lock) l.lock = toe.clone();
        l.w += (1 - l.w) * (1 - Math.exp(-dt * 40));
        const d = _t.copy(l.lock).sub(toe).setY(0);
        if (d.length() > MAX_SLIP) {
          l.lock = null;
          l.off.set(0, 0, 0);
        } else l.off.copy(d);
      } else {
        l.lock = null;
        l.w *= Math.exp(-dt * 14);
      }
      if (l.w < 1e-3 || l.off.lengthSq() < 1e-8) continue;
      const target = l.foot.getWorldPosition(new THREE.Vector3()).addScaledVector(l.off, l.w);
      solveLeg(l.thigh, l.calf, l.foot, target, this.side);
    }
  }
}
