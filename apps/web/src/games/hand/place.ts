import * as THREE from "three";
import type { HandFrame } from "./clips";
import { poseRig, type HandRig } from "./build";

/**
 * Turns a sampled HandFrame (local board frame) into world transforms for the overlay. World units are CSS pixels:
 * x → right, y ↑ up (= −screen y), z towards the viewer; the board lies on z = 0.
 */
export interface Placement {
  rect: { left: number; top: number; width: number; height: number };
  side: number;
  /** pixels per metre of hand */
  scale: number;
}

const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tv = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Local (u, v) → screen pixels. */
export function localToScreen(p: Placement, u: number, v: number, out: { x: number; y: number }) {
  const c = Math.cos(p.side), s = Math.sin(p.side);
  const du = u - 0.5, dv = v - 0.5;
  out.x = p.rect.left + (0.5 + du * c - dv * s) * p.rect.width;
  out.y = p.rect.top + (0.5 + du * s + dv * c) * p.rect.height;
  return out;
}

const scr = { x: 0, y: 0 };
const sh = { x: 0, y: 0 };
/** Right shoulder, in the local frame (the player sits below the board's bottom edge, slightly to the left of it). */
const SHOULDER = { u: 0.68, v: 1.8 };

/** Poses and places the rig root for a frame. Returns the anchor's screen position (for the contact shadow). */
export function placeRig(rig: HandRig, f: HandFrame, p: Placement, anchorOut: THREE.Vector3) {
  poseRig(rig, f.pose);
  localToScreen(p, f.u, f.v, scr);
  localToScreen(p, SHOULDER.u, SHOULDER.v, sh);
  // the forearm points from the shoulder to the hand (clamped around the side's own heading)
  const dx = scr.x - sh.x, dy = scr.y - sh.y;
  let phi = Math.atan2(dx, -dy) - p.side;
  phi = Math.atan2(Math.sin(phi), Math.cos(phi));
  phi = Math.max(-0.6, Math.min(0.6, phi)) + p.side;
  const yaw = -phi + f.yaw;
  // root = yaw about the view axis · forearm elevation · roll about the forearm
  rig.root.quaternion.setFromAxisAngle(Z, yaw).multiply(tq.setFromAxisAngle(X, -f.pitch)).multiply(tq2.setFromAxisAngle(Y, f.roll));
  rig.root.scale.setScalar(p.scale);
  // anchor offset: where the fist centre / pinch point sits relative to the wrist, for this pose
  const a = f.anchor === "pinch" ? rig.anchors.pinch : rig.anchors.palm;
  const handBone = rig.bones[1]!;
  tv.copy(a.position).applyQuaternion(handBone.quaternion).applyQuaternion(rig.root.quaternion).multiplyScalar(p.scale);
  rig.root.position.set(scr.x - tv.x, -scr.y - tv.y, f.h * p.scale - tv.z);
  anchorOut.set(scr.x, -scr.y, f.h * p.scale);
}
