import * as THREE from "three";

/**
 * Procedural hand / arm actions layered on top of the mocap pose (after the mixer): two-bone arm IK towards
 * targets in the avatar's own frame, finger curls and small spine / head offsets. Used for the actions that have
 * no licensed mocap clip: handshake (Rwandan style: the left hand supports the right forearm), fist bump, hug,
 * thumbs-up, pointing with the open hand, chalking a pool cue. Each action has a smooth weight (in / out), so it
 * blends with whatever the body is doing.
 *
 * Avatar frame: +z forward, +y up, −x is the person's RIGHT (three.js right-handed, the model faces +z).
 */

export interface ArmBones {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  /** 1 = right, −1 = left */
  side: 1 | -1;
  fingers: THREE.Bone[][];
}

const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _h = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
const _x = new THREE.Vector3(1, 0, 0);

/** Turn `bone` (world space) so the direction to `child` points along `dir` (world), blended by `w`. */
const _as = new THREE.Vector3();
const _ah = new THREE.Vector3();
const _ad = new THREE.Vector3();
export function aimBone(bone: THREE.Bone, child: THREE.Object3D, dir: THREE.Vector3, w: number) {
  if (!bone.parent) return;
  bone.getWorldPosition(_as);
  child.getWorldPosition(_ah);
  _ad.subVectors(_ah, _as).normalize();
  _qa.setFromUnitVectors(_ad, dir);
  _qa.slerp(_qb.identity(), 1 - w);
  bone.getWorldQuaternion(_qb);
  _qb.premultiply(_qa);
  bone.parent.getWorldQuaternion(_qa);
  bone.quaternion.copy(_qa.invert().multiply(_qb));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: put the hand at `target` (world) with the elbow bending towards `pole` (world direction).
 * Blended by `w` (0 = keep the animated pose).
 */
export function reach(arm: ArmBones, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  if (w < 0.002) return;
  arm.upper.getWorldPosition(_s);
  arm.fore.getWorldPosition(_e);
  arm.hand.getWorldPosition(_h);
  const a = _s.distanceTo(_e);
  const b = _e.distanceTo(_h);
  _t.copy(target);
  _n.subVectors(_t, _s);
  const d = THREE.MathUtils.clamp(_n.length(), 0.05, a + b - 0.002);
  _n.normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, a * a - along * along));
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n));
  if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0);
  _p.normalize();
  const elbow = _e.copy(_s).addScaledVector(_n, along).addScaledVector(_p, hgt);
  aimBone(arm.upper, arm.fore, _d.subVectors(elbow, _s).normalize(), w);
  arm.fore.getWorldPosition(_e);
  aimBone(arm.fore, arm.hand, _d.subVectors(_t.copy(target), _e).normalize(), w);
}

/** Curl the four fingers (and optionally the thumb) by `k` radians per joint, blended by `w`. */
export function curl(arm: ArmBones, k: number, w: number, thumb = 0) {
  if (w < 0.002) return;
  arm.fingers.forEach((chain, i) => {
    const amt = i === 0 ? thumb : k;
    if (!amt) return;
    for (const f of chain) f.quaternion.multiply(_qr.setFromAxisAngle(_z, amt * w));
  });
}

export interface ProcBones {
  root: THREE.Object3D;
  arms: ArmBones[];
  spine: THREE.Bone | null;
  head: THREE.Bone | null;
}

/** Which procedural action an anim code drives (contracts ACT). */
export const PROC_ACTIONS: Record<number, "thumbs" | "point" | "handshake" | "fistbump" | "hug" | "chalk"> = {
  17: "thumbs",
  18: "point",
  21: "handshake",
  22: "fistbump",
  23: "hug",
  26: "chalk",
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** Per-avatar procedural layer state. */
export class ProceduralLayer {
  private w: Record<string, number> = {};
  private t = 0;
  private cur = "";
  private readonly P = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  /** a point (world) the right hand is at / near, for props (chalk, cue tip) */
  readonly cueTip = new THREE.Vector3();
  readonly cueGrip = new THREE.Vector3();
  active = 0;

  constructor(private b: ProcBones) {}

  /** avatar-frame point → world */
  private local(x: number, y: number, z: number, out = this.P) {
    return this.b.root.localToWorld(out.set(x, y, z));
  }
  private poleL(x: number, y: number, z: number) {
    // a direction in the avatar frame → world direction
    this.b.root.getWorldQuaternion(_qa);
    return this.pole.set(x, y, z).applyQuaternion(_qa);
  }

  update(dt: number, anim: number) {
    const want = PROC_ACTIONS[anim] ?? "";
    if (want !== this.cur) {
      if (want) this.t = 0;
      this.cur = want || this.cur;
    }
    this.t += dt;
    let any = 0;
    for (const k of ["thumbs", "point", "handshake", "fistbump", "hug", "chalk"]) {
      const target = k === want ? 1 : 0;
      const rate = k === "fistbump" ? 9 : 5;
      const w = (this.w[k] ?? 0) + (target - (this.w[k] ?? 0)) * (1 - Math.exp(-dt * rate));
      this.w[k] = w < 0.002 && !target ? 0 : w;
      any = Math.max(any, this.w[k]!);
    }
    this.active = any;
    if (any < 0.002) return;
    this.b.root.updateMatrixWorld(true);
    const R = this.b.arms.find((a) => a.side === 1);
    const L = this.b.arms.find((a) => a.side === -1);
    if (!R || !L) return;
    const t = this.t;

    // thumbs-up: right forearm up in front of the chest, fist with the thumb up
    const wT = ease(this.w.thumbs ?? 0);
    if (wT > 0) {
      reach(R, this.local(-0.2, 1.3, 0.24), this.poleL(-1, -1, -0.3), wT);
      // roll the fist so the thumb points up (hand bone x runs along the fingers)
      R.hand.quaternion.multiply(_qr.setFromAxisAngle(_x, 1.3 * wT));
      curl(R, 1.3, wT, -0.25);
    }
    // pointing: the open hand / arm towards the front (in Rwanda one points with the whole hand, not a finger)
    const wP = ease(this.w.point ?? 0);
    if (wP > 0) {
      const lift = Math.min(1, t / 0.5);
      reach(R, this.local(-0.32, 1.25 + 0.15 * lift, 0.55), this.poleL(-1, -0.6, 0), wP);
      R.hand.quaternion.multiply(_qr.setFromAxisAngle(_x, 0.6 * wP));
      curl(R, -0.12, wP);
    }
    // handshake at arm's length (pair distance 0.95 m: hands meet half way), pumped twice; left hand under the
    // right forearm; a small respectful bow of the head
    const wH = ease(this.w.handshake ?? 0);
    if (wH > 0) {
      const pump = t > 0.6 && t < 2.0 ? Math.sin((t - 0.6) * Math.PI * 2 * 1.6) * 0.035 : 0;
      reach(R, this.local(-0.04, 1.0 + pump, 0.44), this.poleL(-1, -0.8, -0.3), wH);
      // hand upright (thumb up), fingers wrapping the other hand
      R.hand.quaternion.multiply(_qr.setFromAxisAngle(_x, 1.0 * wH));
      curl(R, 0.55, wH, 0.25);
      R.fore.getWorldPosition(_e);
      R.hand.getWorldPosition(_h);
      _t.lerpVectors(_e, _h, 0.4);
      this.b.root.worldToLocal(_t);
      reach(L, this.local(_t.x + 0.02, _t.y - 0.045, _t.z), this.poleL(1, -1, -0.4), wH);
      curl(L, 0.25, wH);
      if (this.b.head) this.b.head.quaternion.multiply(_qr.setFromAxisAngle(_z, 0.12 * wH * ease(Math.min(1, t / 0.6)) * ease(Math.max(0, Math.min(1, (2.2 - t) / 0.5)))));
    }
    // fist bump: quick reach out, touch, back
    const wF = ease(this.w.fistbump ?? 0);
    if (wF > 0) {
      const out = t < 0.35 ? ease(t / 0.35) : t < 0.75 ? 1 : 1 - ease((t - 0.75) / 0.4);
      reach(R, this.local(-0.06, 1.1, 0.2 + 0.28 * out), this.poleL(-1, -0.7, -0.2), wF);
      curl(R, 1.35, wF, 0.6);
    }
    // embrace (close friends): right hand over the other's left shoulder, left hand on their right side / hip,
    // chest leaning in, head to one side
    const wE = ease(this.w.hug ?? 0);
    if (wE > 0) {
      const sway = Math.sin(t * 1.4) * 0.015;
      reach(R, this.local(-0.05, 1.33 + sway, 0.5), this.poleL(-1, 0.2, 0), wE);
      reach(L, this.local(0.12, 1.02, 0.47), this.poleL(1, -0.4, 0), wE);
      curl(R, 0.35, wE);
      curl(L, 0.35, wE);
      if (this.b.spine) this.b.spine.quaternion.multiply(_qr.setFromAxisAngle(_z, 0.08 * wE));
      if (this.b.head) this.b.head.quaternion.multiply(_qr.setFromAxisAngle(_x, 0.3 * wE));
    }
    // chalking a cue: left hand holds the cue upright at the side, the right hand twists the chalk on the tip
    const wC = ease(this.w.chalk ?? 0);
    if (wC > 0) {
      reach(L, this.local(0.2, 1.02, 0.28), this.poleL(1, -1, -0.3), wC);
      curl(L, 1.0, wC, 0.4);
      L.hand.getWorldPosition(this.cueGrip);
      const tw = Math.sin(t * 9) * 0.012;
      const tip = this.local(0.17 + tw, 1.43, 0.33 + tw, _t);
      this.cueTip.copy(tip);
      reach(R, this.local(0.15 + tw, 1.42, 0.31 - tw), this.poleL(-0.4, -1, 0), wC);
      curl(R, 0.7, wC, 0.5);
    }
  }

  get chalkWeight() {
    return this.w.chalk ?? 0;
  }
}
