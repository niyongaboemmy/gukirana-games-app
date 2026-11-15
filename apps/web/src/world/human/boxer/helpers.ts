import * as THREE from "three";

/**
 * Corrective helper bones of the boxer body (P3-FGT-14, build.mjs): posed every frame AFTER the boxing rig.
 *  - `Bip01_{L,R}_ShoulderHelper` (child of the clavicle, at the shoulder joint): half the upper arm's turn. The
 *    deltoid / armpit skin MakeHuman weights to the clavicle and chest rides on it (the build's shoulder corrective),
 *    so the shoulder rounds over the arm instead of leaving a lump and a crease behind.
 *  - `Bip01_{L,R}_ForearmTwist` (child of the forearm, on its axis): half the hand's twist about the forearm, the
 *    rest of the swing ignored: the wrist end of the forearm rolls with the fist (no candy wrapper).
 * Bind rotations of the boxer skeleton are identity, so a child's local rotation is directly comparable with its
 * sibling's (helper / upper arm under the clavicle) and the forearm axis is the hand's bind offset.
 */
export interface HelperRig {
  shoulders: { helper: THREE.Bone; upper: THREE.Bone }[];
  twists: { twist: THREE.Bone; hand: THREE.Bone; axis: THREE.Vector3 }[];
}

export const SHOULDER_FOLLOW = 0.5;
export const TWIST_FOLLOW = 0.5;

export function helperRig(bone: (name: string) => THREE.Bone | null): HelperRig {
  const shoulders: HelperRig["shoulders"] = [];
  const twists: HelperRig["twists"] = [];
  for (const S of ["L", "R"]) {
    const helper = bone(`Bip01_${S}_ShoulderHelper`);
    const upper = bone(`Bip01_${S}_UpperArm`);
    if (helper && upper) shoulders.push({ helper, upper });
    const twist = bone(`Bip01_${S}_ForearmTwist`);
    const hand = bone(`Bip01_${S}_Hand`);
    if (twist && hand && hand.position.lengthSq() > 1e-8) twists.push({ twist, hand, axis: hand.position.clone().normalize() });
  }
  return { shoulders, twists };
}

const _id = new THREE.Quaternion();
const _t = new THREE.Quaternion();

/** the twist part of q about the unit axis (swing-twist decomposition), into out */
export function twistOf(q: THREE.Quaternion, axis: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  out.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  const l = Math.hypot(out.x, out.y, out.z, out.w);
  if (l < 1e-9) return out.identity();
  return out.set(out.x / l, out.y / l, out.z / l, out.w / l);
}

/**
 * Finger signs (P3-FGT-14, the referee's count): per hand and finger the chain of bones and the flexion axis, from the
 * bind pose (identity rotations: a bone's local axes are the root's). Flexion turns a finger towards the palm about
 * (finger direction × palm normal); the thumb folds across the palm.
 */
export interface FingerRig {
  hands: Record<"L" | "R", { chains: { bones: THREE.Bone[]; axis: THREE.Vector3 }[] } | null>;
}

export function fingerRig(bone: (name: string) => THREE.Bone | null): FingerRig {
  const hand = (S: "L" | "R") => {
    const h = bone(`Bip01_${S}_Hand`);
    const mid = bone(`Bip01_${S}_Finger2`);
    const th = bone(`Bip01_${S}_Finger0`);
    if (!h || !mid || !th) return null;
    const side = S === "R" ? 1 : -1;
    // palm normal (hand-local = bind world): right hand fingers × thumb = the back of the hand (as rig.ts)
    const palm = new THREE.Vector3().crossVectors(mid.position.clone().normalize(), th.position.clone().normalize()).multiplyScalar(-side).normalize();
    const chains = [0, 1, 2, 3, 4].map((f) => {
      const bones = [`Bip01_${S}_Finger${f}`, `Bip01_${S}_Finger${f}1`, `Bip01_${S}_Finger${f}2`].map(bone).filter((b): b is THREE.Bone => !!b);
      const dir = (bones[1]?.position ?? bones[0]!.position).clone().normalize();
      const axis = new THREE.Vector3().crossVectors(dir, palm).normalize();
      return { bones, axis };
    });
    return { chains };
  };
  return { hands: { L: hand("L"), R: hand("R") } };
}

const _fq = new THREE.Quaternion();
/** set one hand's fingers to the extensions (1 straight … 0 folded), blended by w over whatever the rig left */
export function signFingers(fr: FingerRig, S: "L" | "R", ext: readonly number[], w = 1) {
  const h = fr.hands[S];
  if (!h || w < 0.002) return;
  h.chains.forEach((c, f) => {
    const fold = 1 - (ext[f] ?? 0);
    // per joint: a finger folds ~85° at each joint, the thumb less and across
    const amt = fold * (f === 0 ? 0.75 : 1.45);
    c.bones.forEach((b, j) => {
      _fq.setFromAxisAngle(c.axis, f === 0 && j === 0 ? amt * 0.6 : amt);
      b.quaternion.slerp(_fq, w);
    });
  });
}

/** pose the helpers from the arm bones' current local rotations */
export function driveHelpers(h: HelperRig) {
  for (const s of h.shoulders) s.helper.quaternion.copy(_id).slerp(s.upper.quaternion, SHOULDER_FOLLOW);
  for (const t of h.twists) t.twist.quaternion.copy(_id).slerp(twistOf(t.hand.quaternion, t.axis, _t), TWIST_FOLLOW);
}
