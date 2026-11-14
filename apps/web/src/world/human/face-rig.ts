import * as THREE from "three";
import type { FaceLook } from "../face";

/**
 * Face layer of a realistic avatar (P2-AVA-07), built on the Rocketbox face bones (eyes, lids, brows, cheeks, nose,
 * lips, jaw). Two parts:
 *  - proportions: the player's face choices move / scale those bones once, in the bind pose (positions and scales
 *    are never keyed by the clips; only eye / jaw / lip rotations are, so the two never fight);
 *  - life: natural blinking (seeded rhythm, the odd double blink, a blink with big eye moves), small eye saccades,
 *    eyes leading the head towards the person you talk to, lids following the gaze, brows lifting a little while
 *    talking. Runs right after the mixer, near people only; no allocations per frame.
 *
 * Face frame (metres, avatar space): +x = the person's left, +y up, +z forward. The bones' own axes differ
 * (Biped: local x forward, y down, z left), so every offset is converted through the bind-pose rotations.
 */

type Side = "L" | "R";
/** offset (m, face frame) and scale (face axes x = width, y = height, z = depth) per bone */
interface Shape {
  p?: [number, number, number];
  s?: [number, number, number];
}
type ShapeMap = Partial<Record<string, Shape>>;

const mm = 0.001;

/** Mirror a left-side shape to both sides (x flips for the right). */
function both(name: string, sh: Shape, out: ShapeMap) {
  for (const side of ["L", "R"] as Side[]) {
    const k = name.replace("*", side);
    const sx = side === "L" ? 1 : -1;
    const prev = out[k] ?? {};
    const p = sh.p ? ([sh.p[0] * sx, sh.p[1], sh.p[2]] as [number, number, number]) : undefined;
    out[k] = {
      p: p ? (prev.p ? [prev.p[0] + p[0], prev.p[1] + p[1], prev.p[2] + p[2]] : p) : prev.p,
      s: sh.s ? (prev.s ? [prev.s[0] * sh.s[0], prev.s[1] * sh.s[1], prev.s[2] * sh.s[2]] : sh.s) : prev.s,
    };
  }
}
function one(name: string, sh: Shape, out: ShapeMap) {
  const prev = out[name] ?? {};
  out[name] = {
    p: sh.p ? (prev.p ? [prev.p[0] + sh.p[0], prev.p[1] + sh.p[1], prev.p[2] + sh.p[2]] : sh.p) : prev.p,
    s: sh.s ? (prev.s ? [prev.s[0] * sh.s[0], prev.s[1] * sh.s[1], prev.s[2] * sh.s[2]] : sh.s) : prev.s,
  };
}

/** Bone offsets for a face (exported for tests). `model` = the base head ("masculine" starts with a furrowed brow). */
export function faceShape(face: FaceLook, model: string): ShapeMap {
  const o: ShapeMap = {};
  // relaxed resting face for everyone: lids a touch lower (no wide-eyed stare)
  both("Bip01_*EyeBlinkTop", { p: [0, -0.7 * mm, 0] }, o);
  if (model === "masculine") {
    // the masculine base head frowns: lift and part the inner brows
    both("Bip01_*InnerEyebrow", { p: [0.4 * mm, 1.3 * mm, 0] }, o);
    one("Bip01_MMiddleEyebrow", { p: [0, 1.0 * mm, 0] }, o);
  }
  switch (face.shape) {
    case "round":
      both("Bip01_*Cheek", { p: [2.4 * mm, 0, 1.2 * mm] }, o);
      one("Bip01_MJaw", { s: [1.07, 0.95, 0.98] }, o);
      break;
    case "square":
      both("Bip01_*Cheek", { p: [1 * mm, 0, 0] }, o);
      one("Bip01_MJaw", { s: [1.12, 1.0, 1.0] }, o);
      break;
    case "heart":
      both("Bip01_*Cheek", { p: [2.6 * mm, 0.8 * mm, 0.8 * mm] }, o);
      one("Bip01_MJaw", { s: [0.9, 1.04, 1.02] }, o);
      break;
    case "long":
      both("Bip01_*Cheek", { p: [-0.8 * mm, 0, 0] }, o);
      one("Bip01_MJaw", { s: [0.96, 1.1, 1.02] }, o);
      break;
    default:
      break;
  }
  switch (face.eyes) {
    case "round":
      both("Bip01_*EyeBlinkTop", { p: [0, 0.9 * mm, 0] }, o);
      both("Bip01_*EyeBlinkBottom", { p: [0, -0.5 * mm, 0] }, o);
      break;
    case "hooded":
      both("Bip01_*EyeBlinkTop", { p: [0, -1.1 * mm, 0] }, o);
      both("Bip01_*OuterEyebrow", { p: [0, -0.9 * mm, 0] }, o);
      break;
    case "narrow":
      both("Bip01_*EyeBlinkTop", { p: [0, -1.0 * mm, 0] }, o);
      both("Bip01_*EyeBlinkBottom", { p: [0, 0.7 * mm, 0] }, o);
      break;
    case "deep":
      both("Bip01_*EyeBlinkTop", { p: [0, -0.3 * mm, -1.0 * mm] }, o);
      both("Bip01_*EyeBlinkBottom", { p: [0, 0, -0.8 * mm] }, o);
      both("Bip01_*InnerEyebrow", { p: [0, 0, 0.9 * mm] }, o);
      both("Bip01_*OuterEyebrow", { p: [0, 0, 0.9 * mm] }, o);
      break;
    default:
      break;
  }
  switch (face.brows) {
    case "arched":
      both("Bip01_*OuterEyebrow", { p: [0, -0.6 * mm, 0] }, o);
      one("Bip01_MMiddleEyebrow", { p: [0, 0.3 * mm, 0] }, o);
      break;
    case "straight":
      both("Bip01_*OuterEyebrow", { p: [0, 0.6 * mm, 0] }, o);
      both("Bip01_*InnerEyebrow", { p: [0, -0.3 * mm, 0] }, o);
      break;
    case "bold":
      both("Bip01_*InnerEyebrow", { p: [0, -0.3 * mm, 0.3 * mm] }, o);
      break;
    default:
      break;
  }
  switch (face.nose) {
    case "broad":
      one("Bip01_MNose", { s: [1.14, 1.0, 0.97] }, o);
      break;
    case "rounded":
      one("Bip01_MNose", { s: [1.06, 1.0, 1.0] }, o);
      break;
    case "straight":
      one("Bip01_MNose", { s: [0.95, 1.02, 1.05] }, o);
      break;
    case "narrow":
      one("Bip01_MNose", { s: [0.87, 1.03, 1.07] }, o);
      break;
    case "wide":
      one("Bip01_MNose", { s: [1.22, 0.97, 0.92], p: [0, -0.4 * mm, -0.4 * mm] }, o);
      break;
  }
  const upper = (p: [number, number, number]) => {
    one("Bip01_MUpperLip", { p }, o);
    both("Bip01_*Upperlip", { p: [0, p[1] * 0.8, p[2] * 0.8] }, o);
  };
  const lower = (p: [number, number, number]) => {
    one("Bip01_MBottomLip", { p }, o);
    both("Bip01_*MouthBottom", { p: [0, p[1] * 0.8, p[2] * 0.8] }, o);
  };
  switch (face.lips) {
    case "full":
      upper([0, 0.9 * mm, 0.9 * mm]);
      lower([0, -1.0 * mm, 1.0 * mm]);
      break;
    case "thin":
      upper([0, -0.7 * mm, -0.5 * mm]);
      lower([0, 0.7 * mm, -0.5 * mm]);
      break;
    case "wide":
      both("Bip01_*MouthCorner", { p: [2.4 * mm, 0, -0.3 * mm] }, o);
      upper([0, 0.4 * mm, 0.4 * mm]);
      lower([0, -0.4 * mm, 0.4 * mm]);
      break;
    case "bow":
      one("Bip01_MUpperLip", { p: [0, 1.1 * mm, 0.7 * mm] }, o);
      both("Bip01_*Upperlip", { p: [0, 0.2 * mm, 0.3 * mm] }, o);
      lower([0, -0.5 * mm, 0.6 * mm]);
      break;
    default:
      break;
  }
  return o;
}

/* ---------- face frame (bind pose, mesh space) for the head shader ---------- */
export interface FaceFrame {
  /** origin: between the eyes (mesh space) */
  o: THREE.Vector3;
  /** rows = face x / y / z axes divided by the eye distance (q = m · (p − o): face units, 1 = eye distance) */
  m: THREE.Matrix3;
  /** landmarks in face units: mouth y, mouth z, brow y, nose y */
  l: THREE.Vector4;
}

const _m4 = new THREE.Matrix4();
function bindPos(mesh: THREE.SkinnedMesh, name: string, out: THREE.Vector3): boolean {
  const i = mesh.skeleton.bones.findIndex((b) => b.name === name);
  if (i < 0) return false;
  _m4.copy(mesh.skeleton.boneInverses[i]!).invert().premultiply(mesh.bindMatrixInverse);
  out.setFromMatrixPosition(_m4);
  return true;
}

/** The face frame of a skinned head (null when the rig has no eye / lip bones). */
export function faceFrameOf(mesh: THREE.SkinnedMesh): FaceFrame | null {
  const v = () => new THREE.Vector3();
  const [le, re, ul, bl, bi, bo, no] = [v(), v(), v(), v(), v(), v(), v()];
  if (!bindPos(mesh, "Bip01_LEye", le) || !bindPos(mesh, "Bip01_REye", re) || !bindPos(mesh, "Bip01_MUpperLip", ul) || !bindPos(mesh, "Bip01_MBottomLip", bl)) return null;
  const hasBrow = bindPos(mesh, "Bip01_LInnerEyebrow", bi) && bindPos(mesh, "Bip01_LOuterEyebrow", bo);
  const hasNose = bindPos(mesh, "Bip01_MNose", no);
  const o = le.clone().add(re).multiplyScalar(0.5);
  const ipd = le.distanceTo(re);
  if (ipd < 1e-5) return null;
  const x = le.clone().sub(re).normalize();
  const mouth = ul.clone().add(bl).multiplyScalar(0.5);
  // "up" = the eye bone's axis closest to eyes − mouth (the mouth sits in front of the eyeballs, so eyes − mouth
  // itself leans back ~28° and would slice the face along tilted planes)
  const toEyes = o.clone().sub(mouth).normalize();
  const i = mesh.skeleton.bones.findIndex((b) => b.name === "Bip01_LEye");
  _m4.copy(mesh.skeleton.boneInverses[i]!).invert().premultiply(mesh.bindMatrixInverse);
  const basis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  _m4.extractBasis(basis[0]!, basis[1]!, basis[2]!);
  let y = basis[0]!.normalize();
  for (const b of basis) if (Math.abs(b.normalize().dot(toEyes)) > Math.abs(y.dot(toEyes))) y = b;
  y = y.clone().multiplyScalar(Math.sign(y.dot(toEyes)) || 1);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const k = 1 / ipd;
  const m = new THREE.Matrix3().set(x.x * k, x.y * k, x.z * k, y.x * k, y.y * k, y.z * k, z.x * k, z.y * k, z.z * k);
  const q = (p: THREE.Vector3) => p.clone().sub(o).applyMatrix3(m);
  const mq = q(mouth);
  const browY = hasBrow ? (q(bi).y + q(bo).y) / 2 : 0.25;
  const noseY = hasNose ? q(no).y : -0.5;
  return { o, m, l: new THREE.Vector4(mq.y, mq.z, browY, noseY) };
}

/* ---------- the live face rig ---------- */
interface LiveBone {
  bone: THREE.Bone;
  /** bind-pose position + the face-shape offset (parent space) */
  base: THREE.Vector3;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function mulberry(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FaceInput {
  /** seconds since the last update */
  dt: number;
  talking: boolean;
  /** where the eyes should look relative to where the head points (rad, + = the person's left / up) */
  gazeYaw: number;
  gazePitch: number;
  /** someone is being looked at (smaller, face-to-face saccades) */
  engaged: boolean;
}

/** Blink / eye amplitudes (m, rad); exported for the preview hook and tests. */
export const BLINK_TOP = 7.5 * mm;
export const BLINK_BOTTOM = 1.4 * mm;

export class FaceRig {
  private lids: { top: LiveBone[]; bottom: LiveBone[] } = { top: [], bottom: [] };
  private brows: LiveBone[] = [];
  private eyes: THREE.Bone[] = [];
  /** parent-space directions of face-frame down (lids) / up (brows) per live bone */
  private down = new Map<THREE.Bone, THREE.Vector3>();
  /** eye-local axes of the face frame's up (yaw axis) and left (pitch axis) */
  private eyeAxes = new Map<THREE.Bone, { up: THREE.Vector3; left: THREE.Vector3; rest: THREE.Quaternion }>();
  private rnd: () => number;
  private t = 0;
  private nextBlink = 1.5;
  private blinkT = -1;
  private doubleBlink = false;
  private nextSacc = 0.8;
  private sacc = { y: 0, p: 0 };
  private eye = { y: 0, p: 0 };
  private brow = 0;
  /** forced lid closure for previews / screenshots (0..1), null = automatic */
  force: number | null = null;

  constructor(root: THREE.Object3D, face: FaceLook, model: string, seed: number) {
    this.rnd = mulberry(seed ^ 0x5eed);
    this.nextBlink = 0.6 + this.rnd() * 3;
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion();
    root.getWorldQuaternion(rootInv).invert();
    /** rotation of `o` relative to the avatar root (bind pose) */
    const relQ = (o: THREE.Object3D, out: THREE.Quaternion) => o.getWorldQuaternion(out).premultiply(rootInv);
    const shape = faceShape(face, model);
    const get = (n: string) => (root.getObjectByName(n) as THREE.Bone | undefined) ?? null;
    const pq = new THREE.Quaternion();
    const bq = new THREE.Quaternion();
    for (const [name, sh] of Object.entries(shape)) {
      const b = get(name);
      if (!b || !sh || !b.parent) continue;
      // always from the bind pose (StrictMode builds the rig twice on the same bones)
      const r = (b.userData.gkFaceRest ??= { p: b.position.clone(), s: b.scale.clone() }) as { p: THREE.Vector3; s: THREE.Vector3 };
      b.position.copy(r.p);
      b.scale.copy(r.s);
      if (sh.p) {
        relQ(b.parent, pq).invert();
        const ps = b.parent.getWorldScale(_v).x / Math.max(1e-6, root.getWorldScale(new THREE.Vector3()).x);
        b.position.add(new THREE.Vector3(...sh.p).applyQuaternion(pq).divideScalar(ps || 1));
      }
      if (sh.s) {
        // face axis → the bone's local axis it lines up with
        relQ(b, bq);
        const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(bq));
        const sc = [1, 1, 1];
        [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].forEach((f, fi) => {
          let best = 0;
          for (let i = 1; i < 3; i++) if (Math.abs(axes[i]!.dot(f)) > Math.abs(axes[best]!.dot(f))) best = i;
          sc[best] = sh.s![fi]!;
        });
        b.scale.multiply(new THREE.Vector3(sc[0], sc[1], sc[2]));
      }
    }
    const live = (n: string): LiveBone | null => {
      const b = get(n);
      if (!b || !b.parent) return null;
      relQ(b.parent, pq).invert();
      this.down.set(b, new THREE.Vector3(0, -1, 0).applyQuaternion(pq));
      return { bone: b, base: b.position.clone() };
    };
    for (const s of ["L", "R"] as Side[]) {
      const t = live(`Bip01_${s}EyeBlinkTop`);
      const btm = live(`Bip01_${s}EyeBlinkBottom`);
      if (t) this.lids.top.push(t);
      if (btm) this.lids.bottom.push(btm);
      for (const n of [`Bip01_${s}InnerEyebrow`, `Bip01_${s}OuterEyebrow`]) {
        const x = live(n);
        if (x) this.brows.push(x);
      }
      const e = get(`Bip01_${s}Eye`);
      if (e) {
        relQ(e, bq).invert();
        this.eyes.push(e);
        this.eyeAxes.set(e, { up: new THREE.Vector3(0, 1, 0).applyQuaternion(bq), left: new THREE.Vector3(1, 0, 0).applyQuaternion(bq), rest: ((e.userData.gkEyeRest as THREE.Quaternion | undefined) ??= e.quaternion.clone()) });
      }
    }
    const mid = live("Bip01_MMiddleEyebrow");
    if (mid) this.brows.push(mid);
  }

  /** Lid closure 0 (open) … 1 (closed) from the blink clock. */
  private blinkAmount(): number {
    if (this.blinkT < 0) return 0;
    const t = this.blinkT;
    // fast close (70 ms), short hold (40 ms), slower open (130 ms)
    if (t < 0.07) return t / 0.07;
    if (t < 0.11) return 1;
    if (t < 0.24) return 1 - (t - 0.11) / 0.13;
    return 0;
  }

  update(inp: FaceInput) {
    const dt = Math.min(inp.dt, 0.1);
    this.t += dt;
    // ---- blink rhythm: every 2–6 s (more often while talking), sometimes twice
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > 0.24) {
        this.blinkT = this.doubleBlink ? 0 : -1;
        this.doubleBlink = false;
      }
    } else if (this.t >= this.nextBlink) {
      this.blinkT = 0;
      this.doubleBlink = this.rnd() < 0.14;
      this.nextBlink = this.t + (inp.talking ? 1.6 : 2.2) + this.rnd() * (inp.talking ? 2.6 : 4.0);
    }
    // ---- saccades: a new small fixation every 0.5–2.8 s (face to face: between the other person's eyes and mouth)
    if (this.t >= this.nextSacc) {
      const amp = inp.engaged ? 0.05 : 0.14;
      const ny = (this.rnd() - 0.5) * 2 * amp;
      const np = (this.rnd() - 0.5) * amp * 0.7 - (inp.engaged ? 0.01 : 0.02);
      // a big eye move often comes with a blink
      if (Math.abs(ny - this.sacc.y) > 0.16 && this.blinkT < 0 && this.rnd() < 0.35) this.blinkT = 0;
      this.sacc.y = ny;
      this.sacc.p = np;
      this.nextSacc = this.t + 0.5 + this.rnd() * (inp.engaged ? 1.4 : 2.3);
    }
    const ty = THREE.MathUtils.clamp(inp.gazeYaw + this.sacc.y, -0.42, 0.42);
    const tp = THREE.MathUtils.clamp(inp.gazePitch + this.sacc.p, -0.25, 0.2);
    // saccades are fast (~40 ms)
    const ke = 1 - Math.exp(-dt * 28);
    this.eye.y += (ty - this.eye.y) * ke;
    this.eye.p += (tp - this.eye.p) * ke;
    for (const e of this.eyes) {
      const ax = this.eyeAxes.get(e)!;
      // from the rest pose (the clips key the eyes at rest; never accumulate on frames the mixer skipped)
      e.quaternion.copy(ax.rest);
      e.quaternion.multiply(_q.setFromAxisAngle(ax.up, this.eye.y));
      e.quaternion.multiply(_q.setFromAxisAngle(ax.left, -this.eye.p));
    }
    // ---- lids: blink + follow the gaze (looking down lowers the upper lid)
    const close = this.force ?? this.blinkAmount();
    const follow = THREE.MathUtils.clamp(-this.eye.p, -0.2, 0.25) * 4 * mm;
    for (const l of this.lids.top) l.bone.position.copy(l.base).addScaledVector(this.down.get(l.bone)!, close * BLINK_TOP + follow);
    for (const l of this.lids.bottom) l.bone.position.copy(l.base).addScaledVector(this.down.get(l.bone)!, -close * BLINK_BOTTOM + follow * 0.3);
    // ---- brows: a small lift now and then while talking
    const want = inp.talking ? Math.max(0, Math.sin(this.t * 2.3) * Math.sin(this.t * 0.9)) * 1.1 * mm : 0;
    this.brow += (want - this.brow) * (1 - Math.exp(-dt * 6));
    for (const b of this.brows) b.bone.position.copy(b.base).addScaledVector(this.down.get(b.bone)!, -this.brow);
  }
}
