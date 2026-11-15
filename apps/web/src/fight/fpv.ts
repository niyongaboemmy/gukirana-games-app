import * as THREE from "three";
import type { BoxerProbe } from "@/world/human/boxer/BoxerAvatar";

/**
 * First-person fight view (P3-FGT-15, docs/BOXING-V5.md §5): the camera sits in my boxer's eyes. My head (and
 * headgear) is cut away by the material's hide sphere, so I see my own gloves and forearms in the guard, my punches
 * extend out of my view and land on the opponent (contact IK), my body and legs when I look down, and the view rocks
 * with my head when I am hit (the camera follows the head bone the hit reactions move). Pure maths here (tested),
 * the frame loop in camera.tsx, the probes from fighters.tsx.
 */

/** feature flag: first person available (and the default fight camera) unless NEXT_PUBLIC_FF_FIGHT_FPV=0 */
export const FPV_ON = process.env.NEXT_PUBLIC_FF_FIGHT_FPV !== "0";

/** my fighter and my opponent in my own fight (fighters.tsx writes them every frame; null when not fighting) */
export const fpvProbes: { me: BoxerProbe | null; them: BoxerProbe | null; at: number } = { me: null, them: null, at: 0 };

/** the free look (drag / right stick), radians: added to the aim, eased back to centre when released */
export const fpvLook = { yaw: 0, pitch: 0, held: false };

/** the eyes relative to the head joint (head frame: +y up the skull, +z forward): eye height, ~4 cm behind the cornea (a
 * VR rig puts the camera at the eyes' centre of rotation: the guard's gloves, 15–20 cm out, stay in view) */
export const EYE_OFFSET = new THREE.Vector3(0, 0.07, 0.05);
/** the hide sphere round the head (bind space): centre above the head joint, radius covering the headgear */
export const HIDE_UP = 0.075;
export const HIDE_R = 0.16;
/** vertical field of view in first person (wider than the broadcast lens: the gloves fill the lower frame) */
export const FPV_FOV = 76;
/** how much the head's own turn (hit reactions, slips) steers the view against the aim at the opponent */
export const HEAD_FOLLOW = 0.4;
/** with reduced motion the head's snaps barely move the view */
export const HEAD_FOLLOW_REDUCED = 0.08;
/** the resting aim: a little under the opponent's eyes (their chin, my gloves in the lower third) */
export const AIM_DROP = 0.28;
/** free-look limits */
export const LOOK_YAW = 1.0;
export const LOOK_DOWN = 1.15;
export const LOOK_UP = 0.35;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _a = new THREE.Vector3();
const _e = new THREE.Euler();

/** eye position: the head joint plus the eye offset turned with the head */
export function eyeFrom(headPos: THREE.Vector3, headQuat: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(EYE_OFFSET).applyQuaternion(headQuat).add(headPos);
}

/**
 * The view direction: towards the opponent's face (a little under it), blended with where my head points (so a snap
 * of my head turns my view), then the free look (yaw about up, pitch about the view's right axis).
 */
export function viewDir(eye: THREE.Vector3, target: THREE.Vector3, headQuat: THREE.Quaternion, follow: number, yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  _a.copy(target).sub(eye);
  _a.y -= AIM_DROP;
  if (_a.lengthSq() < 1e-6) _a.set(0, 0, 1);
  _a.normalize();
  _f.set(0, 0, 1).applyQuaternion(headQuat).normalize();
  out.copy(_a).lerp(_f, follow).normalize();
  if (yaw !== 0) out.applyAxisAngle(_v.set(0, 1, 0), yaw);
  if (pitch !== 0) {
    const right = _v.set(0, 1, 0).cross(out);
    if (right.lengthSq() > 1e-8) out.applyAxisAngle(right.normalize(), pitch);
  }
  return out.normalize();
}

/** clamp the free look and ease it back to centre when released (dt seconds) */
export function easeLook(look: { yaw: number; pitch: number; held: boolean }, dt: number): void {
  look.yaw = Math.max(-LOOK_YAW, Math.min(LOOK_YAW, look.yaw));
  look.pitch = Math.max(-LOOK_UP, Math.min(LOOK_DOWN, look.pitch));
  if (look.held) return;
  const k = Math.exp(-dt * 3.2);
  look.yaw *= k;
  look.pitch *= k;
  if (Math.abs(look.yaw) < 1e-4) look.yaw = 0;
  if (Math.abs(look.pitch) < 1e-4) look.pitch = 0;
}

/** the bind-space hide sphere for a body: centre over the head joint's bind position */
export function hideSphere(headBind: THREE.Vector3, out: THREE.Vector4): THREE.Vector4 {
  return out.set(headBind.x, headBind.y + HIDE_UP, headBind.z + 0.01, HIDE_R);
}

/** a bone's bind position in mesh space (from the skeleton's inverse bind matrix) */
export function bindPosition(mesh: THREE.SkinnedMesh, bone: THREE.Bone, out: THREE.Vector3): THREE.Vector3 {
  const i = mesh.skeleton.bones.indexOf(bone);
  if (i < 0) return out.set(0, 1.6, 0);
  const m = new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]!).invert();
  return out.setFromMatrixPosition(m);
}

/** first person is used in these phases (the corner, my knockdown and the result use the broadcast shots) */
export function fpvPhase(phase: string, meDown: boolean): boolean {
  if (meDown) return false;
  return phase === "round" || phase === "countdown" || phase === "intro" || phase === "knockdown";
}

/** world head pose of a probe's body */
export function headPose(p: BoxerProbe, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
  const h = p.inst.bone("Bip01_Head");
  if (!h) return false;
  h.getWorldPosition(pos);
  h.getWorldQuaternion(quat);
  return true;
}

/** yaw / pitch of a direction (for HUD / tests) */
export function anglesOf(d: THREE.Vector3): { yaw: number; pitch: number } {
  _e.setFromQuaternion(_q.setFromUnitVectors(_v.set(0, 0, 1), _f.copy(d).normalize()), "YXZ");
  return { yaw: _e.y, pitch: _e.x };
}

/** dev: the free look is scriptable from QA (qa/e2e/fpv-fight-lab.mjs) */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __gkFpvLook?: typeof fpvLook }).__gkFpvLook = fpvLook;
