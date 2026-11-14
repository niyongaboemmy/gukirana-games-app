import * as THREE from "three";
import { bindData } from "./rig";

/**
 * Boxing face layer (P3-FGT-02), run right after the face rig (face-rig.ts: blinks, gaze, idle micro-expressions):
 * the expressions a fight needs, as offsets of the Rocketbox face bones (mm, face frame: +x the person's left, +y up,
 * +z forward; left side, mirrored to the right):
 *  - focus: brows down and drawn in, eyes narrowed a little (the default in the guard);
 *  - effort: lips pressed on the mouthguard, mouth corners pulled back, cheeks tight (throwing a punch);
 *  - wince: eyes squeezed, brows knitted, the mouth corners pulled out and down (taking a hit; small, no gore);
 *  - smile: a full open smile with smiling eyes (winning);
 *  - eyes: lids closing (dazed after a knockdown), jaw: mouth open (breathing hard in the corner).
 * The face rig resets lids / brows / mouth corners / cheeks every update, so those take the offsets on top; the lips
 * and the nose (never moved by the face rig or the clips) are set from their own rest position. No allocations per
 * frame.
 */

export interface FaceWeights {
  focus: number;
  effort: number;
  wince: number;
  smile: number;
  jaw: number;
  eyes: number;
}

type Off = [number, number, number];
const SHAPES: Record<Exclude<keyof FaceWeights, "jaw">, [string, Off][]> = {
  focus: [
    ["Bip01_*InnerEyebrow", [-0.5, -1.6, 0.3]],
    ["Bip01_*OuterEyebrow", [0, -0.7, 0]],
    ["Bip01_MMiddleEyebrow", [0, -1.1, 0.2]],
    ["Bip01_*EyeBlinkTop", [0, -1.0, 0]],
    ["Bip01_*EyeBlinkBottom", [0, 0.5, 0]],
  ],
  effort: [
    ["Bip01_MUpperLip", [0, -0.5, -0.4]],
    ["Bip01_MBottomLip", [0, 0.6, -0.3]],
    ["Bip01_*MouthCorner", [0.9, -0.3, -0.8]],
    ["Bip01_*Cheek", [0.2, 0.7, 0.2]],
    ["Bip01_*InnerEyebrow", [-0.4, -0.8, 0.2]],
  ],
  wince: [
    ["Bip01_*EyeBlinkTop", [0, -4.2, 0]],
    ["Bip01_*EyeBlinkBottom", [0, 1.6, 0]],
    ["Bip01_*InnerEyebrow", [-0.9, -1.0, 0.5]],
    ["Bip01_*OuterEyebrow", [0, -1.2, 0]],
    ["Bip01_MMiddleEyebrow", [0, -1.4, 0.4]],
    ["Bip01_*MouthCorner", [2.2, -1.6, -1.2]],
    ["Bip01_*Cheek", [0.5, 2.0, 0.6]],
    ["Bip01_MNose", [0, 0.7, 0]],
    ["Bip01_MUpperLip", [0, 0.6, -0.2]],
  ],
  smile: [
    ["Bip01_*MouthCorner", [2.8, 4.0, -1.8]],
    ["Bip01_*Cheek", [0.6, 2.4, 1.0]],
    ["Bip01_*EyeBlinkBottom", [0, 1.4, 0]],
    ["Bip01_MUpperLip", [0, 1.3, 0]],
    ["Bip01_*Upperlip", [0.6, 1.6, -0.4]],
    ["Bip01_MBottomLip", [0, -2.2, -0.4]],
    ["Bip01_*MouthBottom", [0.8, -1.2, -0.4]],
    ["Bip01_*OuterEyebrow", [0, 0.4, 0]],
  ],
  eyes: [
    ["Bip01_*EyeBlinkTop", [0, -7.0, 0]],
    ["Bip01_*EyeBlinkBottom", [0, 1.3, 0]],
  ],
};
/**
 * Gains tuned on the Rocketbox heads in the lab (their scanned resting mouths are full / slightly pouting, so a
 * smile needs a bigger move to read at play distance: the skin weights on the mouth bones are light).
 */
const GAIN: Record<keyof typeof SHAPES, number> = { focus: 1.6, effort: 1.8, wince: 2.2, smile: 3.6, eyes: 1 };
/** bones the face rig resets every update (offsets go on top of it) */
const LIVE = /EyeBlink|Eyebrow|MouthCorner|Cheek/;

interface FBone {
  bone: THREE.Bone;
  live: boolean;
  /** rest position (parent space) for the non-live bones */
  rest: THREE.Vector3;
  /** face axes in parent space, per metre */
  ax: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** offsets (mm, face frame) per expression */
  off: Partial<Record<keyof typeof SHAPES, Off>>;
}

const mm = 0.001;
const _d = new THREE.Vector3();

export class BoxingFace {
  private bones: FBone[] = [];
  private jaw: THREE.Bone | null;
  /** smoothed weights (expressions ease in / out, ~60 ms) */
  private w: FaceWeights = { focus: 0, effort: 0, wince: 0, smile: 0, jaw: 0, eyes: 0 };

  constructor(root: THREE.Object3D) {
    const { bind } = bindData(root);
    const rootInv = new THREE.Quaternion();
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(rootInv).invert();
    const byName = new Map<string, FBone>();
    for (const [expr, list] of Object.entries(SHAPES) as [keyof typeof SHAPES, [string, Off][]][]) {
      for (const [pattern, off] of list) {
        for (const side of pattern.includes("*") ? (["L", "R"] as const) : ([""] as const)) {
          const name = pattern.replace("*", side);
          const b = root.getObjectByName(name) as THREE.Bone | undefined;
          if (!b?.parent) continue;
          let fb = byName.get(name);
          if (!fb) {
            // parent orientation relative to the root (bind), to turn face-frame offsets into parent space
            const pm = bind.rel(b.parent);
            const pq = new THREE.Quaternion();
            const ps = new THREE.Vector3(1, 1, 1);
            if (pm) pm.decompose(new THREE.Vector3(), pq, ps);
            else b.parent.getWorldQuaternion(pq).premultiply(rootInv);
            pq.invert();
            const s = 1 / Math.max(1e-6, ps.x);
            const ax: FBone["ax"] = [new THREE.Vector3(1, 0, 0).applyQuaternion(pq).multiplyScalar(s), new THREE.Vector3(0, 1, 0).applyQuaternion(pq).multiplyScalar(s), new THREE.Vector3(0, 0, 1).applyQuaternion(pq).multiplyScalar(s)];
            fb = { bone: b, live: LIVE.test(name), rest: b.position.clone(), ax, off: {} };
            byName.set(name, fb);
            this.bones.push(fb);
          }
          fb.off[expr] = side === "R" ? [-off[0], off[1], off[2]] : off;
        }
      }
    }
    this.jaw = (root.getObjectByName("Bip01_MJaw") as THREE.Bone | undefined) ?? null;
  }

  /** ease towards `target` and put the expression on the face (after the face rig's update) */
  apply(target: FaceWeights, dt: number, wt = 1) {
    const k = 1 - Math.exp(-dt * 16);
    const w = this.w;
    for (const key of Object.keys(w) as (keyof FaceWeights)[]) w[key] += (Math.max(0, Math.min(1, target[key] * wt)) - w[key]) * k;
    for (const fb of this.bones) {
      let x = 0,
        y = 0,
        z = 0;
      for (const [expr, o] of Object.entries(fb.off) as [keyof typeof SHAPES, Off][]) {
        const ew = w[expr] * GAIN[expr];
        if (ew < 0.001) continue;
        x += o[0] * ew;
        y += o[1] * ew;
        z += o[2] * ew;
      }
      if (!fb.live) fb.bone.position.copy(fb.rest);
      if (x === 0 && y === 0 && z === 0) continue;
      _d.set(0, 0, 0)
        .addScaledVector(fb.ax[0], x * mm)
        .addScaledVector(fb.ax[1], y * mm)
        .addScaledVector(fb.ax[2], z * mm);
      fb.bone.position.add(_d);
    }
    // jaw: open for breathing / wince / a big smile, clenched (closed) under effort; the Avatar resets it every step
    const open = Math.max(w.jaw * 0.16, w.wince * 0.05, w.smile * 0.06) * (1 - 0.8 * w.effort);
    if (this.jaw && open > 0.002) this.jaw.rotateZ(-open);
  }

  /** current (smoothed) weights, for tests / the lab */
  get weights(): Readonly<FaceWeights> {
    return this.w;
  }
}
