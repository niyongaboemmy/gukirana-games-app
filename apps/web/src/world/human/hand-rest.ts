import * as THREE from "three";
import { curl, reach, type ArmBones } from "./procedural";
import type { HandRest, SeatProfile } from "./seat-profiles";

/**
 * Seated hand rest (P2-AVA-09), run after the seat fit (seat-fit.ts) and before the seated activity layer
 * (seated-layer.ts, which takes over while a table activity needs the hands).
 *
 * The seated mocap was recorded on a slimmer actor: its hands rest where that actor's thighs were, so on our bodies
 * (thicker thighs and trousers, the hips moved onto each seat, the legs re-planted by the seat fit) they sank into the
 * thighs, 3–9 cm deep. This layer puts each hand where a seated person really rests it, measured on the actual body:
 *  - "thigh": palm down on the top of the thigh, a little inward, fingers draped along it,
 *  - "lap": both hands loosely together in the lap,
 *  - "armrest": forearm on the chair's armrest, hand over its front end (seats that have arms),
 * with two-bone arm IK (elbows out and back, never through the torso) and the hand turned palm down. Which rest a
 * person uses comes from the seat profile's options and the person's seed (deterministic, the same on every screen).
 * The thigh radius and the hand's palm depth are measured once from the bind pose. No allocations per frame.
 */

/**
 * How high a seated skirt / long wrap's lap stands over the thigh axis (m): the tube (radius 0.17 → 0.3, depth ×0.86)
 * skinned to the thighs turns its front panel into the top of the lap, about 0.19 m over the thigh axes.
 */
export const SKIRT_LAP = 0.19;

export interface RestPose {
  /** where the hand bone (wrist) goes */
  wrist: THREE.Vector3;
  /** the direction the fingers point */
  fingers: THREE.Vector3;
  /** the direction the palm faces (down onto the thigh / armrest) */
  palm: THREE.Vector3;
}

export interface RestInputs {
  /** this side's hip and knee joints (world or avatar frame, any consistent frame) */
  hip: THREE.Vector3;
  knee: THREE.Vector3;
  /** midpoint between both hips */
  mid: THREE.Vector3;
  /** the avatar frame's up and forward directions, and its +x (the person's LEFT) */
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  left: THREE.Vector3;
  /** the avatar frame's origin (armrest targets are given in the avatar frame) */
  origin: THREE.Vector3;
  /** 1 = right hand, −1 = left */
  side: 1 | -1;
  /** thigh radius on top (m) and the wrist's height over the palm (m) */
  thighR: number;
  palm: number;
  /** 0…1 per person: how far along the thigh the hand rests */
  along: number;
  /** the seat's recline (rad): leaning back brings the hands back up the thigh (they stay within reach) */
  lean: number;
}

const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _in = new THREE.Vector3();
const _t = new THREE.Vector3();

/**
 * Where a hand rests (pure, exported for tests). `out` receives the wrist position, finger and palm directions in
 * the frame of the inputs.
 */
export function restPose(kind: HandRest, inp: RestInputs, armrest: SeatProfile["armrest"], out: RestPose): RestPose {
  const { hip, knee, mid, up, fwd, left, origin, side, thighR, palm } = inp;
  if (kind === "armrest" && armrest) {
    // avatar frame: −x is the person's right
    const sx = side === 1 ? -1 : 1;
    out.wrist.copy(origin).addScaledVector(left, sx * armrest.x).addScaledVector(up, armrest.y + palm + 0.008).addScaledVector(fwd, armrest.z);
    out.fingers.copy(fwd).addScaledVector(up, -0.12).addScaledVector(left, -sx * 0.12).normalize();
    out.palm.copy(up).negate().addScaledVector(left, -sx * 0.1);
  } else {
    _u.subVectors(knee, hip);
    const len = Math.max(_u.length(), 0.2);
    _u.divideScalar(len);
    // the top of the thigh: the frame's up made perpendicular to the thigh
    _n.copy(up).addScaledVector(_u, -up.dot(_u));
    if (_n.lengthSq() < 1e-6) _n.copy(fwd);
    _n.normalize();
    // inward: towards the other leg, across the thigh
    _in.subVectors(mid, hip).addScaledVector(_u, -_t.subVectors(mid, hip).dot(_u));
    _in.addScaledVector(_n, -_in.dot(_n));
    if (_in.lengthSq() < 1e-8) _in.copy(left).multiplyScalar(side === 1 ? 1 : -1);
    _in.normalize();
    if (kind === "lap") {
      // loosely together in the lap: near the inner thighs, the right hand a touch higher (over the left)
      // (halfway down the thighs, wrists on their inner tops, fingers forward-inward over each other)
      out.wrist
        .copy(hip)
        .addScaledVector(_u, len * Math.max(0.36, 0.52 - inp.lean * 0.6))
        .addScaledVector(_n, thighR + palm + 0.006 + (side === 1 ? 0.02 : 0))
        .addScaledVector(_in, 0.05);
      out.fingers.copy(_in).addScaledVector(_u, 0.95).addScaledVector(_n, -0.15).normalize();
    } else {
      // palm down on the top of the thigh, slightly inward, fingers draped along it towards the knee
      out.wrist
        .copy(hip)
        .addScaledVector(_u, len * Math.max(0.36, inp.along - inp.lean * 0.6))
        .addScaledVector(_n, thighR + palm + 0.006)
        .addScaledVector(_in, 0.018);
      out.fingers.copy(_u).addScaledVector(_in, 0.22).addScaledVector(_n, -0.16).normalize();
    }
    out.palm.copy(_n).negate().addScaledVector(_in, 0.12);
  }
  // palm perpendicular to the fingers
  out.palm.addScaledVector(out.fingers, -out.palm.dot(out.fingers)).normalize();
  return out;
}

/** A small deterministic hash → 0…1 (cosmetic variety, never Math.random). */
export function seedUnit(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Which rests [right, left] this person uses on this seat (deterministic per person and seat kind). */
export function pickRest(p: SeatProfile, seed: number): readonly [HandRest, HandRest] {
  const opts = p.hands;
  return opts[Math.floor(seedUnit(seed, opts.length * 7 + (p.armrest ? 3 : 0)) * opts.length) % opts.length]!;
}

interface Side {
  arm: ArmBones;
  thigh: THREE.Bone;
  calf: THREE.Bone;
  /** hand-local finger and palm axes (bind pose) */
  fingerL: THREE.Vector3;
  palmL: THREE.Vector3;
  /** wrist height over the palm surface (m) */
  palmDepth: number;
  pose: RestPose;
  inp: RestInputs;
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _ma = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class HandRestLayer {
  private readonly sides: Side[] = [];
  /** thigh radius on top (m), measured on the body mesh */
  readonly thighR: number;
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private lastProfile: SeatProfile | null = null;
  private rest: readonly [HandRest, HandRest] = ["thigh", "thigh"];

  /** built in the bind pose (before the first mixer update), like SeatFit */
  constructor(
    private readonly root: THREE.Object3D,
    arms: ArmBones[],
    bone: (n: string) => THREE.Bone | null,
    private readonly seed: number,
    /** a skirt / long wrap drapes over the lap this high above the thigh axis (m); 0 = trousers */
    clothTop = 0,
  ) {
    root.updateMatrixWorld(true);
    let body: THREE.SkinnedMesh | undefined;
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!body && m.isSkinnedMesh && o.parent?.name !== "lod1" && m.skeleton.bones.some((b) => b.name === "Bip01_L_Calf")) body = m;
    });
    root.getWorldQuaternion(_qa);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_qa);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(_qa);
    const radii: number[] = [];
    for (const arm of arms) {
      const k = arm.side === 1 ? "R" : "L";
      const thigh = bone(`Bip01_${k}_Thigh`);
      const calf = bone(`Bip01_${k}_Calf`);
      if (!thigh || !calf) continue;
      // hand axes: towards the middle finger; the palm normal from the thumb's side (anatomy, whatever the bind
      // pose): for a right hand fingers × thumb points out of the back of the hand, for a left hand out of the palm
      const fingerBone = arm.fingers[2]?.[0] ?? arm.fingers[1]?.[0];
      const thumbBone = arm.fingers[0]?.[0];
      const fingerL = fingerBone ? arm.hand.worldToLocal(fingerBone.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(1, 0, 0);
      let palmL: THREE.Vector3;
      if (thumbBone) {
        const thumbL = arm.hand.worldToLocal(thumbBone.getWorldPosition(new THREE.Vector3())).normalize();
        palmL = new THREE.Vector3().crossVectors(fingerL, thumbL).multiplyScalar(-arm.side);
      } else {
        arm.hand.getWorldQuaternion(_qb);
        palmL = down.clone().applyQuaternion(_qb.clone().invert());
      }
      palmL.addScaledVector(fingerL, -palmL.dot(fingerL)).normalize();
      let palmDepth = 0.025;
      if (body) {
        // thigh top radius (front of the standing thigh = top of the seated one) and the palm's depth under the wrist
        const bi = body.skeleton.bones.indexOf(thigh);
        const hi = body.skeleton.bones.indexOf(arm.hand);
        const hipP = thigh.getWorldPosition(new THREE.Vector3());
        const kneeP = calf.getWorldPosition(new THREE.Vector3());
        const u = kneeP.clone().sub(hipP);
        const len = u.length();
        u.divideScalar(len || 1);
        const pos = body.geometry.attributes.position!;
        const si = body.geometry.attributes.skinIndex!;
        const sw = body.geometry.attributes.skinWeight!;
        const r: number[] = [];
        const pd: number[] = [];
        for (let i = 0; i < pos.count; i++) {
          let best = 0;
          let bj = -1;
          for (let c = 0; c < 4; c++) {
            const wt = sw.getComponent(i, c);
            if (wt > best) {
              best = wt;
              bj = si.getComponent(i, c);
            }
          }
          if (bj !== bi && bj !== hi) continue;
          body.getVertexPosition(i, _v);
          _v.applyMatrix4(body.matrixWorld);
          if (bj === bi) {
            const t = _w.subVectors(_v, hipP).dot(u) / (len || 1);
            if (t < 0.3 || t > 0.7) continue;
            _w.subVectors(_v, hipP).addScaledVector(u, -t * len);
            const d = _w.length();
            if (_w.dot(fwd) > 0.8 * d) r.push(d);
          } else {
            pd.push(arm.hand.worldToLocal(_w.copy(_v)).dot(palmL));
          }
        }
        if (r.length) radii.push(r.sort((a, b) => a - b)[Math.floor(r.length * 0.75)]!);
        if (pd.length > 4) palmDepth = THREE.MathUtils.clamp(pd.sort((a, b) => a - b)[Math.floor(pd.length * 0.9)]!, 0.012, 0.045);
      }
      const v = () => new THREE.Vector3();
      this.sides.push({
        arm,
        thigh,
        calf,
        fingerL,
        palmL,
        palmDepth,
        pose: { wrist: v(), fingers: v(), palm: v() },
        inp: { hip: v(), knee: v(), mid: this.mid, up: this.up, fwd: this.fwd, left: this.left, origin: this.origin, side: arm.side, thighR: 0.09, palm: palmDepth, along: 0.5, lean: 0 },
      });
    }
    // trousers / skirts add a little; never thinner than a slim thigh
    this.thighR = Math.max(THREE.MathUtils.clamp((radii.length ? radii.reduce((a, b) => a + b, 0) / radii.length : 0.085) + 0.008, 0.07, 0.13), clothTop);
    for (const s of this.sides) {
      s.inp.thighR = this.thighR;
      s.inp.along = 0.5 + 0.14 * seedUnit(seed, s.arm.side === 1 ? 11 : 12);
    }
  }

  /** where each hand currently rests (world), for tests / debugging */
  get poses(): readonly RestPose[] {
    return this.sides.map((s) => s.pose);
  }

  /**
   * `p` = the seat profile (null = not seated), `w` = the seated blend, `free` = per hand 0…1 how much the hand is
   * free to rest (props in the hand, a table activity …): [right, left].
   */
  apply(p: SeatProfile | null, w: number, freeR = 1, freeL = 1) {
    const frame = this.root.parent;
    if (!p || w < 0.003 || !frame || this.sides.length < 2) return;
    if (p !== this.lastProfile) {
      this.lastProfile = p;
      this.rest = pickRest(p, this.seed);
    }
    this.root.updateMatrixWorld(true);
    frame.getWorldQuaternion(_qa);
    this.up.set(0, 1, 0).applyQuaternion(_qa);
    this.fwd.set(0, 0, 1).applyQuaternion(_qa);
    this.left.set(1, 0, 0).applyQuaternion(_qa);
    frame.getWorldPosition(this.origin);
    this.sides[0]!.thigh.getWorldPosition(_v);
    this.sides[1]!.thigh.getWorldPosition(_w);
    this.mid.addVectors(_v, _w).multiplyScalar(0.5);
    for (const s of this.sides) {
      const kw = w * (s.arm.side === 1 ? freeR : freeL);
      if (kw < 0.003) continue;
      s.thigh.getWorldPosition(s.inp.hip);
      s.calf.getWorldPosition(s.inp.knee);
      s.inp.lean = p.lean;
      const kind = this.rest[s.arm.side === 1 ? 0 : 1];
      restPose(kind === "armrest" && !p.armrest ? "thigh" : kind, s.inp, p.armrest, s.pose);
      // elbows out to the side and back (resting on an armrest: back along it), never in across the body
      const out = s.arm.side === 1 ? -1 : 1;
      if (kind === "armrest" && p.armrest) _pole.copy(this.left).multiplyScalar(out * 0.25).addScaledVector(this.up, -0.35).addScaledVector(this.fwd, -1);
      else _pole.copy(this.left).multiplyScalar(out * 0.7).addScaledVector(this.up, -1).addScaledVector(this.fwd, -0.45);
      reach(s.arm, s.pose.wrist, _pole, kw);
      this.orientHand(s, kw);
      curl(s.arm, 0.1, kw, 0.05);
    }
  }

  /** turn the hand so its fingers / palm point along the rest pose's directions, blended by `w` */
  private orientHand(s: Side, w: number) {
    const h = s.arm.hand;
    if (!h.parent) return;
    // world rotation taking the hand-local (finger, palm, finger × palm) basis onto the target directions
    _x.copy(s.fingerL);
    _y.copy(s.palmL);
    _z.crossVectors(_x, _y);
    _ma.makeBasis(_x, _y, _z);
    _x.copy(s.pose.fingers);
    _y.copy(s.pose.palm);
    _z.crossVectors(_x, _y);
    _mb.makeBasis(_x, _y, _z);
    _mb.multiply(_ma.transpose());
    _qc.setFromRotationMatrix(_mb);
    h.getWorldQuaternion(_qb);
    _qb.slerp(_qc, w);
    h.parent.getWorldQuaternion(_qa);
    h.quaternion.copy(_qa.invert().multiply(_qb));
    h.updateMatrixWorld(true);
  }
}
