import * as THREE from "three";
import { CORR_MAX, CORR_W, type BoxerUniforms } from "./boxer-material";

/**
 * P3-FGT-19B: the v8 garments' pose correctives (docs/FIGHT-REALISM-V8.md §garments in poses).
 *
 * Linear skinning cannot keep cloth out of a closing crease: as the arm comes up into a guard or swings through a hook
 * the deltoid and the armpit fold slide under the arm hole, and the thigh's crease rises into the trunks. The
 * correctives are baked on this rig, in the browser, from sampled frames of the boxing clips
 * (qa/e2e/fighter-v8/bake-correctives.mjs): at each frame every singlet / trunks vertex is pushed clear of the drawn
 * skin, the push smoothed over the cloth (no shards), and carried back to bind space. At run time each region (the
 * singlet's left / right half on that arm, the trunks' legs on that leg) blends its library's three nearest states by
 * inverse distance in that limb's joint rotations, fading to none far from every baked state.
 *
 * The data (build.mjs extras.corr, from apps/web/scripts/boxer/corr-v8/boxer-{m,f}.json):
 *   parts   {kit_vest: n, kit_trunks: n}: the garment meshes' vertex counts it was baked for
 *   rows    [part, local vertex, side share (0 right … 255 left), arm mask (0 … 255: held off the front / back panels
 *           beside the arm hole, where a push stood the cloth over the upper arm)] per corrected vertex
 *   armStates / legStates  [{id, f: {armL, armR, legL, legR}}]: the two libraries (farthest-point samples over the
 *           arms, over the legs) with each limb's joint quaternions (x, y, z, w per bone); column s of a singlet row is
 *           arm state s, of a trunks row leg state s
 *   n       columns per row (the larger library)
 *   scale   metres per unit of `delta`
 *   delta   base64 Int16, rows × n × xyz
 */
export interface CorrData {
  version: number;
  parts: Record<string, number>;
  bones: { arm: string[]; leg: string[] };
  rows: [string, number, number, number?][];
  armStates: { id: string; f: Record<Limb, number[]> }[];
  legStates: { id: string; f: Record<Limb, number[]> }[];
  n: number;
  scale: number;
  delta: string;
}
type Limb = "armL" | "armR" | "legL" | "legR";
const LIMBS: Limb[] = ["armL", "armR", "legL", "legR"];

export interface CorrRig {
  n: number;
  /** each limb's bones (the bones' names with the side filled in) */
  bones: Record<Limb, (THREE.Bone | null)[]>;
  /** state features per limb from its library, flat (states × bones × 4) */
  feats: Record<Limb, Float32Array>;
  texture: THREE.DataTexture;
}

function b64(s: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}

/** the row attribute on the merged geometry and the delta texture; null when the data does not fit these meshes */
export function corrSetup(geo: THREE.BufferGeometry, offsets: Map<string, [number, number]>, data: CorrData | undefined, bone: (n: string) => THREE.Bone | null): CorrRig | null {
  if (!data || data.version !== 2 || !data.n || data.n > CORR_MAX) return null;
  for (const [name, count] of Object.entries(data.parts)) if (offsets.get(name)?.[1] !== count) return null;
  const S = data.n,
    R = data.rows.length;
  const n = geo.getAttribute("position")!.count;
  const row = new Float32Array(n).fill(-1);
  const texels = R * (S + 1);
  const H = Math.ceil(texels / CORR_W);
  const tex = new Float32Array(CORR_W * H * 4);
  const raw = b64(data.delta);
  const d16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  data.rows.forEach(([part, local, side, mask = 255], r) => {
    const off = offsets.get(part)![0];
    row[off + local] = r;
    const base = r * (S + 1);
    tex[base * 4] = side / 255;
    tex[base * 4 + 1] = part === "kit_trunks" ? 1 : 0;
    tex[base * 4 + 2] = mask / 255;
    for (let s = 0; s < S; s++) for (let a = 0; a < 3; a++) tex[(base + 1 + s) * 4 + a] = d16[(r * S + s) * 3 + a]! * data.scale;
  });
  geo.setAttribute("_crow", new THREE.BufferAttribute(row, 1));
  const texture = new THREE.DataTexture(tex, CORR_W, H, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  const names: Record<Limb, string[]> = {
    armL: data.bones.arm.map((b) => b.replace("{S}", "L")),
    armR: data.bones.arm.map((b) => b.replace("{S}", "R")),
    legL: data.bones.leg.map((b) => b.replace("{S}", "L")),
    legR: data.bones.leg.map((b) => b.replace("{S}", "R")),
  };
  const bones = Object.fromEntries(LIMBS.map((l) => [l, names[l].map(bone)])) as Record<Limb, (THREE.Bone | null)[]>;
  const feats = Object.fromEntries(LIMBS.map((l) => [l, Float32Array.from((l.startsWith("arm") ? data.armStates : data.legStates).flatMap((s) => s.f[l]))])) as Record<Limb, Float32Array>;
  return { n: S, bones, feats, texture };
}

/** this frame's state weights per region, from the limbs' current joint rotations (call after the pose is set) */
export function driveCorrectives(rig: CorrRig | null, u: BoxerUniforms, on = true): void {
  if (!rig || !on) {
    u.uCorrN.value = 0;
    return;
  }
  u.uCorrN.value = rig.n;
  for (let li = 0; li < 4; li++) {
    const limb = LIMBS[li]!;
    const bs = rig.bones[limb];
    const F = rig.feats[limb];
    const nb = bs.length;
    // (the rest pose — every joint at bind — is a state with no correction: index −1)
    let d0 = 0;
    for (const b of bs) if (b) d0 += angSq(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, 0, 0, 0, 1);
    near.length = 0;
    near.push([-1, d0]);
    const count = F.length / (nb * 4);
    for (let s = 0; s < rig.n; s++) {
      u.uCw.value[s]!.setComponent(li, 0);
      if (s >= count) continue;
      let d = 0;
      for (let k = 0; k < nb; k++) {
        const b = bs[k];
        if (!b) continue;
        const o = (s * nb + k) * 4;
        d += angSq(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, F[o]!, F[o + 1]!, F[o + 2]!, F[o + 3]!);
      }
      near.push([s, d]);
    }
    // inverse-distance blend of the K nearest states (a frame between two baked frames of a clip takes both), fading
    // out only far from every state
    near.sort((a, b) => a[1] - b[1]);
    const dmin = Math.sqrt(near[0]![1]);
    const fade = 1 - smooth(FAR * 0.5, FAR, dmin);
    let sum = 0;
    for (let k = 0; k < K && k < near.length; k++) sum += 1 / (near[k]![1] + EPS);
    for (let k = 0; k < K && k < near.length; k++) {
      const [s, d] = near[k]!;
      if (s >= 0) u.uCw.value[s]!.setComponent(li, (fade / (d + EPS)) / sum);
    }
  }
}
const K = 3;
/** squared radians: an exact match takes (almost) all the weight */
const EPS = 1e-4;
/** no correction from states this far (radians, the limb's joints in quadrature) */
const FAR = 0.7;
const near: [number, number][] = [];
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** squared angle between two rotations */
function angSq(ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number): number {
  const d = Math.min(1, Math.abs(ax * bx + ay * by + az * bz + aw * bw));
  const a = 2 * Math.acos(d);
  return a * a;
}
