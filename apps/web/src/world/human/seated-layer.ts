import * as THREE from "three";
import { activityPose, emptyPose, type SeatActivity } from "./activity";
import { curl, reach, type ArmBones } from "./procedural";

/**
 * Seated activity layer (P2-HAL-10), run after the seat fit (seat-fit.ts) while a person sits at a table: leans the
 * torso in, pitches the head down onto the board / keyboard, and puts the hands where the activity needs them
 * (two-bone arm IK): resting on the table edge, typing at the keyboard, writing, reaching out over the board to
 * move a counter or sow seeds pit by pit. The pose comes from the deterministic schedule in activity.ts, so it is
 * the same on every screen. Its weight follows the seated blend (no pop while sitting down / standing up) and eases
 * out while the seated mocap plays a look-around. No allocations per frame.
 *
 * Avatar frame (the floor under the seated origin, i.e. the avatar group the body hangs in): +z forward (towards
 * the table), +y up, −x is the person's RIGHT.
 */

const _p = new THREE.Vector3();
const _tR = new THREE.Vector3();
const _tL = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();

/** where the right / left hands go for each task (avatar frame, relative to the table edge `reach` / height `deskH`) */
export function handTargets(
  act: Pick<SeatActivity, "deskH" | "reach" | "kind">,
  pose: { type: number; write: number; move: number; moveX: number; dip: number; t: number },
  outR: { x: number; y: number; z: number },
  outL: { x: number; y: number; z: number },
) {
  const low = act.deskH < 0.65; // the low Igisoro table: hands by the board, lower
  // resting: forearms on the edge, hands a hand's length in
  let rx = -0.17;
  let ry = act.deskH + (low ? 0.05 : 0.035);
  let rz = act.reach + (low ? 0.04 : 0.09);
  let lx = 0.17;
  let ly = ry;
  let lz = rz;
  // typing: both hands at the keyboard (in from the edge), fingers tapping in turn
  const k = pose.type;
  if (k > 0) {
    const tapR = Math.max(0, Math.sin(pose.t * 11.3)) * 0.01;
    const tapL = Math.max(0, Math.sin(pose.t * 10.1 + 1.7)) * 0.01;
    rx += (-0.1 - rx) * k;
    lx += (0.1 - lx) * k;
    ry += (act.deskH + 0.05 + tapR - ry) * k;
    ly += (act.deskH + 0.05 + tapL - ly) * k;
    rz += (act.reach + 0.1 - rz) * k;
    lz += (act.reach + 0.1 - lz) * k;
  }
  // writing notes: the right hand on the pad, small strokes
  const wr = pose.write;
  if (wr > 0) {
    const sx = Math.sin(pose.t * 7.5) * 0.018;
    const sz = Math.sin(pose.t * 3.1) * 0.008;
    rx += (-0.16 + sx - rx) * wr;
    ry += (act.deskH + 0.03 - ry) * wr;
    rz += (act.reach + 0.17 + sz - rz) * wr;
  }
  // reaching out over the board (a counter, a pit), dipping onto it
  const mv = pose.move;
  if (mv > 0) {
    rx += (pose.moveX - 0.04 - rx) * mv;
    ry += (act.deskH + (low ? 0.1 : 0.09) - pose.dip * (low ? 0.06 : 0.05) - ry) * mv;
    rz += (act.reach + (low ? 0.13 : 0.3) - rz) * mv;
  }
  outR.x = rx;
  outR.y = ry;
  outR.z = rz;
  outL.x = lx;
  outL.y = ly;
  outL.z = lz;
}

export class SeatedLayer {
  private readonly pose = emptyPose();
  private w = 0;
  private readonly R: ArmBones | undefined;
  private readonly L: ArmBones | undefined;
  private readonly tR = { x: 0, y: 0, z: 0 };
  private readonly tL = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly root: THREE.Object3D,
    arms: ArmBones[],
    private readonly spine: THREE.Bone | null,
    private readonly head: THREE.Bone | null,
    private readonly seed: number,
  ) {
    this.R = arms.find((a) => a.side === 1);
    this.L = arms.find((a) => a.side === -1);
  }

  /** current blend (0…1), for tests / the look-at layer */
  get weight() {
    return this.w;
  }

  /**
   * `act` = the seat's activity (null = none), `sitW` = the seated blend (animator), `busy` = the seated mocap is
   * playing a look-around (the activity steps back), `attend` = someone needs the person's attention.
   */
  apply(act: SeatActivity | null, sitW: number, dt: number, now: number, busy = false, attend = 0) {
    const want = act ? sitW * (busy ? 0.25 : 1) : 0;
    this.w += (want - this.w) * (1 - Math.exp(-dt * 4));
    if (this.w < 0.003 || !act) {
      if (!act) this.w = Math.min(this.w, sitW);
      return;
    }
    const w = this.w;
    const p = activityPose(act.kind, this.seed, now, this.pose, attend);
    const frame = this.root.parent;
    if (!frame) return;
    this.root.updateMatrixWorld(true);
    frame.getWorldQuaternion(_q);
    _axis.set(1, 0, 0).applyQuaternion(_q);
    // torso in over the table, head down onto the board (and the nods)
    if (p.slide > 0) {
      // forward on the seat (the seat fit has just placed the body: add to it)
      this.root.position.z += p.slide * w;
      this.root.updateMatrixWorld(true);
    }
    if (this.spine?.parent && Math.abs(p.lean) > 0.002) this.turn(this.spine, p.lean * w);
    if (this.head?.parent && Math.abs(p.headDown + p.nod) > 0.002) this.turn(this.head, (p.headDown + p.nod) * w);
    // hands
    const R = this.R;
    const L = this.L;
    if (!R || !L) return;
    const hw = Math.max(p.hands, p.type, p.write, p.move) * w;
    if (hw < 0.003) return;
    handTargets(act, p, this.tR, this.tL);
    frame.localToWorld(_tR.set(this.tR.x, this.tR.y, this.tR.z));
    frame.localToWorld(_tL.set(this.tL.x, this.tL.y, this.tL.z));
    // elbows out to the side and down (relaxed on the table), a touch back
    reach(R, _tR, this.pole(-0.8, -1, -0.35), hw);
    reach(L, _tL, this.pole(0.8, -1, -0.35), Math.max(p.hands, p.type) * w);
    // fingers: relaxed curl on the table, lighter while typing (a small tap), a pinch while sowing / moving
    curl(R, 0.28 + 0.3 * p.move + 0.35 * p.write + Math.max(0, Math.sin(p.t * 11.3)) * 0.12 * p.type, hw, 0.15 + 0.3 * p.write);
    curl(L, 0.28 + Math.max(0, Math.sin(p.t * 10.1 + 1.7)) * 0.12 * p.type, Math.max(p.hands, p.type) * w);
  }

  private pole(x: number, y: number, z: number) {
    return _p.set(x, y, z).applyQuaternion(_q);
  }

  /** rotate a bone about the avatar's side axis (`_axis`, world) by `a` (+ = forward / down) */
  private turn(b: THREE.Bone, a: number) {
    b.getWorldQuaternion(_q2);
    _q2.premultiply(_qt.setFromAxisAngle(_axis, a));
    b.parent!.getWorldQuaternion(_q3);
    b.quaternion.copy(_q3.invert().multiply(_q2));
    b.updateMatrixWorld(true);
  }
}
