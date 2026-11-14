import * as THREE from "three";
import { reach, type ArmBones } from "./procedural";
import { footLift, footZ, seatLift, type SeatProfile } from "./seat-profiles";

/**
 * Seat fit layer (P2-AVA-06), run after the mixer while a person sits, sits down or stands up: fits the seated mocap
 * to the actual seat (see seat-profiles.ts). The whole body is shifted onto the seat surface / along the seat, then
 * two-bone leg IK puts the feet back where they belong (planted on the floor, never under it, inside the legroom),
 * keeping each foot's own orientation; a deep back gets a small recline of the torso (the head keeps its gaze).
 * `w` (0…1) is the seated blend from the animator, so sitting down and standing up never pop. No allocations per
 * frame; a no-op for standing people.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _fq = [new THREE.Quaternion(), new THREE.Quaternion()];
const _tgt = [new THREE.Vector3(), new THREE.Vector3()];
const _feet = [
  { ankleY: 0, toeY: 0 },
  { ankleY: 0, toeY: 0 },
];

interface Leg extends ArmBones {
  toe: THREE.Bone | null;
}

export class SeatFit {
  private readonly legs: Leg[] = [];
  /** standing heights of the ankle / ball of the foot above the sole (m), measured in the bind pose */
  private readonly ankleH: number;
  private readonly toeH: number;
  private shifted = false;

  constructor(
    private readonly root: THREE.Object3D,
    bone: (name: string) => THREE.Bone | null,
    private readonly spine: THREE.Bone | null,
    private readonly head: THREE.Bone | null,
  ) {
    for (const [k, side] of [
      ["L", -1],
      ["R", 1],
    ] as const) {
      const upper = bone(`Bip01_${k}_Thigh`);
      const fore = bone(`Bip01_${k}_Calf`);
      const hand = bone(`Bip01_${k}_Foot`);
      if (upper && fore && hand) this.legs.push({ upper, fore, hand, side, fingers: [], toe: bone(`Bip01_${k}_Toe0`) });
    }
    // bind pose: standing with the soles on the avatar's floor (y = 0)
    root.updateMatrixWorld(true);
    root.getWorldPosition(_b);
    let ankle = 0.08;
    let toe = 0.02;
    const leg = this.legs[0];
    if (leg) {
      ankle = leg.hand.getWorldPosition(_a).y - _b.y;
      if (leg.toe) toe = leg.toe.getWorldPosition(_a).y - _b.y;
    }
    this.ankleH = THREE.MathUtils.clamp(ankle, 0.05, 0.12);
    this.toeH = THREE.MathUtils.clamp(toe, 0.005, 0.05);
  }

  /** Fit the current (animated) pose to `p` with seated weight `w`; `ik` = also plant the feet (people up close). */
  apply(p: SeatProfile | null, w: number, ik = true) {
    const root = this.root;
    const parent = root.parent;
    if (!p || w < 0.002 || !parent || this.legs.length < 2) {
      if (this.shifted) {
        root.position.set(0, 0, 0);
        this.shifted = false;
      }
      return;
    }
    if (!ik) {
      // far away: only onto the seat (the feet are a few pixels)
      root.position.set(0, seatLift(p) * w, p.hipFwd * w);
      this.shifted = true;
      return;
    }
    root.updateMatrixWorld(true);
    // 1) the animated feet in the avatar frame (without last frame's shift)
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!;
      parent.worldToLocal(leg.hand.getWorldPosition(_tgt[i]!)).sub(root.position);
      _feet[i]!.ankleY = _tgt[i]!.y;
      _feet[i]!.toeY = leg.toe ? parent.worldToLocal(leg.toe.getWorldPosition(_a)).y - root.position.y : _tgt[i]!.y;
      leg.hand.getWorldQuaternion(_fq[i]!);
    }
    const hipZ = parent.worldToLocal(this.legs[0]!.upper.getWorldPosition(_a)).z - root.position.z + p.hipFwd;
    // 2) where they go: planted on the floor (shared lift), inside the legroom, forward on deep seats
    const lift = footLift(_feet, 0, this.ankleH, this.toeH);
    for (let i = 0; i < 2; i++) {
      const t = _tgt[i]!;
      const z = footZ(t.z, hipZ, p);
      t.y += lift * w;
      t.z += (z - t.z) * w;
    }
    // 3) the body onto the seat
    root.position.set(0, seatLift(p) * w, p.hipFwd * w);
    this.shifted = true;
    root.updateMatrixWorld(true);
    // 4) legs back to the planted feet (knees bend the way they were bending), feet keep their own orientation
    root.getWorldQuaternion(_q);
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!;
      leg.upper.getWorldPosition(_a);
      leg.fore.getWorldPosition(_b);
      _pole.subVectors(_b, _a).addScaledVector(_c.set(0, 0, 1).applyQuaternion(_q), 0.15);
      reach(leg, parent.localToWorld(_tgt[i]!), _pole, 1);
      leg.hand.parent!.getWorldQuaternion(_q2);
      leg.hand.quaternion.copy(_q2.invert().multiply(_fq[i]!));
      leg.hand.updateMatrixWorld(true);
    }
    // 5) recline onto a deep back; the head turns back up by most of it (eyes stay on the table / stage)
    const lean = p.lean * w;
    if (Math.abs(lean) > 0.002 && this.spine?.parent) {
      _axis.set(1, 0, 0).applyQuaternion(_q);
      this.turn(this.spine, -lean);
      if (this.head?.parent) this.turn(this.head, lean * 0.7);
    }
  }

  /** rotate a bone about the avatar's side axis (`_axis`, world) by `a` */
  private turn(b: THREE.Bone, a: number) {
    b.getWorldQuaternion(_q2);
    _q2.premultiply(_qt.setFromAxisAngle(_axis, a));
    b.parent!.getWorldQuaternion(_q);
    b.quaternion.copy(_q.invert().multiply(_q2));
    b.updateMatrixWorld(true);
  }
}
