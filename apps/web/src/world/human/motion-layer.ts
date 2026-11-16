import * as THREE from "three";
import { solveLeg } from "./foot-lock";
import type { ArmBones } from "./procedural";

/**
 * Campus motion layer (P2-AVA-12): what the mocap clips cannot know about the moment, added on top of them after the
 * mixer, every animation step, people up close only. Everything here is additive (rotations premultiplied in world
 * space on the clip's pose, weights eased in and out, springs instead of steps), so nothing ever snaps:
 *
 *  - **lean into turns**: the body tilts towards the centre of a curve by the centripetal angle atan(v·ω / g)
 *    (≈ 6–9° in a running curve, a degree or two walking), carried by the spine with the head kept level;
 *  - **acceleration / braking**: an underdamped spring on the torso pitch driven by the measured acceleration: the body
 *    leans into a start, rocks back and settles over the feet on a stop (the small overshoot of a real stop);
 *  - **jump** (action 32): anticipation (a 0.2 s crouch with the arms swinging back, feet planted by leg IK), take-off
 *    (legs extend, arms swing forward and up), a ballistic flight (h = 0.3 m standing, 0.36 m running: v0 = √(2gh)) with
 *    the knees tucked, and a landing that absorbs (knees and hips flex, the torso folds forward, then recovers);
 *    running, the gait phase is held in the air (the animator's `hold`), so the legs do not cycle mid-air;
 *  - **reactions**: being bumped (a damped stagger away from the contact, a glance at whoever did it), surprise
 *    (action 33: a startle: shoulders up, head and torso back, hands lift and open), disappointment (action 25: a
 *    slump: head down, shoulders forward), and the face state of every emote (joy, surprise, sadness, the jaw) for
 *    the face rig (world/human/face-rig.ts `emotion`).
 *
 * Cosmetic only: never sent, never game or money logic, no Math.random (the bump direction comes from the people
 * involved). Bones by Rocketbox Biped name (the thighs hang from Bip01_Spine, the clavicles from the neck).
 */

export const ACT_JUMP = 32;
export const ACT_SURPRISE = 33;
/** lab-only code: a bump from the front-left (the lab has no second person) */
export const ACT_BUMP_LAB = 34;
const ACT_DISAPPOINTED = 25;
const G = 9.81;

/** Timing (s) and heights (m) of a jump: exported for tests and for the controller (how long `anim` stays 32). */
export const JUMP = {
  standing: { anticipate: 0.2, push: 0.09, height: 0.3, land: 0.32 },
  running: { anticipate: 0.09, push: 0.07, height: 0.36, land: 0.26 },
};
/** Whole length of a jump (s): anticipation + take-off + flight + landing. */
export function jumpSeconds(running: boolean): number {
  const j = running ? JUMP.running : JUMP.standing;
  return j.anticipate + j.push + (2 * Math.sqrt(2 * G * j.height)) / G + j.land;
}

export interface JumpPose {
  /** hips lowered (m, + = down) by the crouch / landing */
  crouch: number;
  /** the whole body raised (m) in flight */
  lift: number;
  /** knee tuck in flight 0 … 1 */
  tuck: number;
  /** arm swing (rad about the side axis, + = back) */
  arms: number;
  /** torso pitch (rad, + = forward) */
  pitch: number;
  /** in the air (feet free, gait held) */
  air: boolean;
}

const ease = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** The jump's pose at time t (s) since it started; null once it is over. Pure (tests). */
export function jumpPose(t: number, running: boolean): JumpPose | null {
  const j = running ? JUMP.running : JUMP.standing;
  const v0 = Math.sqrt(2 * G * j.height);
  const air = (2 * v0) / G;
  const deep = running ? 0.07 : 0.11;
  if (t < 0) return null;
  // anticipation: crouch, arms back, torso forward
  if (t < j.anticipate) {
    const k = ease(t / j.anticipate);
    return { crouch: deep * k, lift: 0, tuck: 0, arms: 0.55 * k, pitch: 0.32 * k, air: false };
  }
  let u = t - j.anticipate;
  // take-off: legs extend past standing (up on the toes), arms swing through
  if (u < j.push) {
    const k = ease(u / j.push);
    return { crouch: deep * (1 - k) - 0.03 * k, lift: 0, tuck: 0, arms: 0.55 - 1.25 * k, pitch: 0.32 * (1 - k) + 0.04 * k, air: false };
  }
  u -= j.push;
  if (u < air) {
    const s = u / air;
    return { crouch: -0.03 * (1 - ease(s * 3)), lift: v0 * u - 0.5 * G * u * u, tuck: Math.sin(Math.PI * Math.min(1, s * 1.15)), arms: -0.7 + 0.45 * ease(s), pitch: 0.04 + 0.08 * s, air: true };
  }
  u -= air;
  if (u < j.land) {
    // absorb: down fast (80 ms), then back up slower
    const down = Math.min(1, u / 0.08);
    const up = ease((u - 0.08) / (j.land - 0.08));
    const d = (running ? 0.09 : 0.13) * (u < 0.08 ? ease(down) : 1 - up);
    return { crouch: d, lift: 0, tuck: 0, arms: -0.35 * (1 - ease(u / j.land)), pitch: d * 3.2, air: false };
  }
  return null;
}

/** Face state of an action / reaction, 0 … 1 each (the face rig turns it into brows, lids, mouth corners). */
export interface Emotion {
  joy: number;
  surprise: number;
  sad: number;
  /** jaw opening 0 … 1 (≈ 0.2 rad at 1) */
  jaw: number;
}
const FACE_OF: Record<number, Partial<Emotion>> = {
  10: { joy: 0.65 },
  11: { joy: 0.75, jaw: 0.15 },
  12: { joy: 0.7, jaw: 0.1 },
  14: { joy: 0.35 },
  16: { joy: 1, jaw: 0.4 },
  17: { joy: 0.55 },
  19: { surprise: 0.35, sad: 0.15 },
  20: { joy: 1, surprise: 0.35, jaw: 0.55 },
  21: { joy: 0.45 },
  22: { joy: 0.55 },
  23: { joy: 0.6 },
  24: { sad: 0.1 },
  25: { sad: 1 },
  29: { joy: 0.6 },
  [ACT_JUMP]: { joy: 0.3, surprise: 0.2 },
  [ACT_SURPRISE]: { surprise: 1, jaw: 0.5 },
};

export interface MotionInput {
  speed: number;
  forward: number;
  yawRate: number;
  anim: number;
  /** gait weight 0 … 1 */
  moveW: number;
  seated: boolean;
  /** wall clock (s) */
  now: number;
}

const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Rotate a bone by `angle` about a world axis, on top of its current pose. */
function rotW(bone: THREE.Object3D | null, axis: THREE.Vector3, angle: number) {
  if (!bone?.parent || Math.abs(angle) < 2e-4) return;
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q.setFromAxisAngle(axis, angle));
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
}

/** A damped spring (x'' = k(target − x) − c·x'). */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  step(target: number, dt: number) {
    // semi-implicit Euler in ≤ 1/60 s sub-steps (stable for the stiffness used here)
    let left = dt;
    while (left > 1e-5) {
      const h = Math.min(left, 1 / 60);
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }
}

interface Leg {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
}

export class MotionLayer {
  private hips: THREE.Object3D | null;
  private spine: (THREE.Object3D | null)[];
  private neck: THREE.Object3D | null;
  private head: THREE.Object3D | null;
  private clav: (THREE.Object3D | null)[];
  private legs: Leg[] = [];
  private arms: ArmBones[];
  private roll = 0;
  private pitch = new Spring(70, 10);
  private lastSpeed = 0;
  private acc = 0;
  /** jump in progress: start time (s), running or not */
  private jump: { t: number; running: boolean } | null = null;
  private prevAnim = 0;
  /** startle / slump envelopes 0 … 1 */
  private startle = 0;
  private startleT = -1;
  private slump = 0;
  /** bump: deflection spring (rad), its world axis, a glance target yaw (rad, avatar space) */
  private bumpS = new Spring(90, 9);
  private bumpAxis = new THREE.Vector3(1, 0, 0);
  private bumpAt = -9;
  private bumpYaw = 0;
  readonly emotion: Emotion = { joy: 0, surprise: 0, sad: 0, jaw: 0 };
  /** per-step outputs: the body's lift (m) for the avatar's visual root, gait held (running jump in the air) */
  readonly out = { lift: 0, roll: 0, hold: false, glance: 0, glanceW: 0 };
  private feet: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(
    private root: THREE.Object3D,
    bone: (name: string) => THREE.Object3D | null,
    arms: ArmBones[],
  ) {
    this.hips = bone("Bip01");
    this.spine = ["Bip01_Spine1", "Bip01_Spine2"].map(bone);
    this.neck = bone("Bip01_Neck");
    this.head = bone("Bip01_Head");
    this.clav = ["Bip01_R_Clavicle", "Bip01_L_Clavicle"].map(bone);
    this.arms = arms;
    for (const s of ["L", "R"]) {
      const thigh = bone(`Bip01_${s}_Thigh`),
        calf = bone(`Bip01_${s}_Calf`),
        foot = bone(`Bip01_${s}_Foot`);
      if (thigh && calf && foot) this.legs.push({ thigh, calf, foot });
    }
  }

  /** Someone bumped into this person: `from` = where they came from (world), 0 … 1 how hard. */
  bump(from: THREE.Vector3, strength: number, now: number) {
    if (now - this.bumpAt < 0.6) return;
    this.root.getWorldPosition(_p);
    _v.copy(from).sub(_p).setY(0);
    if (_v.lengthSq() < 1e-6) return;
    _v.normalize();
    // deflect away from the contact: the torso turns about the horizontal axis perpendicular to the push
    this.bumpAxis.crossVectors(_v, UP).normalize();
    this.bumpS.v += 2.6 * THREE.MathUtils.clamp(strength, 0.2, 1);
    this.bumpAt = now;
    // glance at them (avatar space yaw)
    this.root.getWorldQuaternion(_qw);
    const local = _v.clone().applyQuaternion(_qw.invert());
    this.bumpYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
  }

  get jumping() {
    return this.jump !== null;
  }

  /** After the clips (and the senior stoop), before the foot lock. */
  apply(dt: number, inp: MotionInput) {
    const root = this.root;
    const k = (r: number) => 1 - Math.exp(-dt * r);
    // (no full skeleton update here: each world-space rotation below updates only its own parent chain; idle and
    // straight-walking people touch no bone at all)
    root.getWorldQuaternion(_qw);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_qw).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();

    // ---- action edges
    if (inp.anim === ACT_JUMP && this.prevAnim !== ACT_JUMP && !inp.seated && !this.jump) this.jump = { t: inp.now, running: inp.speed > 1.8 };
    if (inp.anim === ACT_BUMP_LAB && this.prevAnim !== ACT_BUMP_LAB) {
      root.getWorldPosition(_p);
      this.bump(_p.clone().addScaledVector(fwd, 0.6).addScaledVector(side, 0.35), 0.8, inp.now);
    }
    if (inp.anim === ACT_SURPRISE && this.prevAnim !== ACT_SURPRISE) this.startleT = inp.now;
    this.prevAnim = inp.anim;

    // ---- face state of the current action (eased), plus the startle / bump flashes
    const f = FACE_OF[inp.anim] ?? {};
    const st = this.startleT >= 0 ? inp.now - this.startleT : 9;
    // startle envelope: fast attack (0.12 s), hold, slow release (to ~1.6 s)
    const startleW = st < 0.12 ? st / 0.12 : st < 0.65 ? 1 : Math.max(0, 1 - (st - 0.65) / 0.9);
    this.startle += (startleW * (inp.anim === ACT_SURPRISE || st < 1.6 ? 1 : 0) - this.startle) * k(18);
    const bumpAge = inp.now - this.bumpAt;
    const bumpFace = bumpAge < 1.2 ? Math.max(0, 1 - bumpAge / 1.2) : 0;
    const want: Emotion = {
      joy: f.joy ?? 0,
      surprise: Math.max(f.surprise ?? 0, this.startle, bumpFace * 0.7),
      sad: f.sad ?? 0,
      jaw: Math.max(f.jaw ?? 0, this.startle * 0.5, bumpFace * 0.25),
    };
    for (const key of ["joy", "surprise", "sad", "jaw"] as const) this.emotion[key] += (want[key] - this.emotion[key]) * k(key === "surprise" ? 14 : 5);

    // ---- lean into turns (centripetal) and the acceleration / braking spring
    const moving = inp.moveW;
    const v = Math.max(0, inp.forward);
    const wantRoll = inp.seated ? 0 : THREE.MathUtils.clamp(-Math.atan((v * inp.yawRate) / G) * 0.85, -0.2, 0.2) * moving;
    this.roll += (wantRoll - this.roll) * k(6);
    const a = (inp.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = inp.speed;
    this.acc += (THREE.MathUtils.clamp(a, -8, 8) - this.acc) * k(8);
    const pitch = inp.seated ? this.pitch.step(0, dt) : this.pitch.step(THREE.MathUtils.clamp(this.acc * 0.028, -0.1, 0.12), dt);

    // ---- jump pose
    let jp: JumpPose | null = null;
    if (this.jump) {
      jp = jumpPose(inp.now - this.jump.t, this.jump.running);
      if (!jp || inp.seated) this.jump = null;
    }
    this.out.lift = jp?.lift ?? 0;
    this.out.hold = !!(jp?.air && this.jump?.running);

    // ---- disappointment slump
    this.slump += ((inp.anim === ACT_DISAPPOINTED ? 1 : 0) - this.slump) * k(3);

    // ---- bump stagger
    const bump = this.bumpS.step(0, dt);
    this.out.glanceW += ((bumpAge > 0.2 && bumpAge < 2.2 ? 1 : 0) - this.out.glanceW) * k(4);
    this.out.glance = this.bumpYaw;

    // ---- pose
    const crouch = jp?.crouch ?? 0;
    const torsoPitch = pitch + (jp?.pitch ?? 0) * 0.55 + this.slump * 0.1 - this.startle * 0.14;
    // keep the planted feet where they are while the hips go down (crouch / landing)
    const plant = Math.abs(crouch) > 1e-4 && !jp?.air;
    if (plant) this.legs.forEach((l, i) => l.foot.getWorldPosition(this.feet[i]!));
    if (this.hips?.parent && Math.abs(crouch) > 1e-4) {
      this.hips.getWorldPosition(_p);
      _p.y -= crouch;
      this.hips.position.copy(this.hips.parent.worldToLocal(_p));
      // the hips fold as the knees bend (the pelvis tips forward with the crouch)
      rotW(this.spine[0] ?? null, side, crouch * 1.6);
    }
    // the lean into a curve: most of it is the whole body tilting from the feet (the avatar's visual root, `out.roll`),
    // the rest bends the spine; the head stays level
    this.out.roll = this.roll * 0.65;
    for (const b of this.spine) {
      rotW(b, fwd, this.roll * 0.175);
      rotW(b, side, torsoPitch * 0.5);
      if (Math.abs(bump) > 1e-4) rotW(b, this.bumpAxis, bump * 0.3);
    }
    // shoulders: up in a startle, forward and down in a slump
    this.clav.forEach((c, i) => {
      if (!c) return;
      const s = i === 0 ? 1 : -1;
      rotW(c, fwd, s * this.startle * 0.16 - s * this.slump * 0.08);
      rotW(c, UP, -s * this.slump * 0.1);
    });
    // head: level against the lean, back in a startle, down in a slump, a small whip with a bump
    rotW(this.head, fwd, -this.roll * 0.6);
    rotW(this.head, side, -torsoPitch * 0.6 - this.startle * 0.1 + this.slump * 0.3 - crouch * 1.2);
    if (Math.abs(bump) > 1e-4) rotW(this.head, this.bumpAxis, -bump * 0.18);
    // arms: the jump's swing, the startle's lift (hands come up and out)
    for (const arm of this.arms) {
      if (jp) rotW(arm.upper, side, jp.arms);
      if (this.startle > 0.01) {
        rotW(arm.upper, fwd, arm.side * this.startle * 0.45);
        rotW(arm.upper, side, -this.startle * 0.5);
        rotW(arm.fore, side, -this.startle * 0.55);
      }
      if (Math.abs(bump) > 1e-4) rotW(arm.upper, this.bumpAxis, bump * 0.45);
    }
    // legs: tucked in flight, re-planted while crouching / landing
    if (jp?.air && jp.tuck > 0.01) {
      for (const l of this.legs) {
        rotW(l.thigh, side, -jp.tuck * 0.55);
        rotW(l.calf, side, jp.tuck * 1.05);
        rotW(l.foot, side, -jp.tuck * 0.25);
      }
    }
    if (plant) {
      root.updateMatrixWorld(true);
      this.legs.forEach((l, i) => solveLeg(l.thigh, l.calf, l.foot, this.feet[i]!, side));
    }
  }
}
