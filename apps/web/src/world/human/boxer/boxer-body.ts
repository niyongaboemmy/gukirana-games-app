import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ArmBones } from "../procedural";
import type { TorsoSlices } from "../boxing/rig";
import { boxerMaterial, type BoxerColors, type BoxerUniforms } from "./boxer-material";
import { depenetrate } from "./depenetrate";

/**
 * The ring people's body (P3-FGT-13, docs/FIGHT-REALISM-V3.md §3): one athletic, properly skinned body per gender
 * (apps/web/scripts/boxer/build.mjs, from the MakeHuman CC0 base mesh, targets, skeleton and weights) with every
 * garment pre-built on it (vest, trunks, boots, gloves, headgear, wraps; referee shirt / bow tie / trousers / shoes;
 * staff polo; a hair cap). An instance picks an outfit, bakes its body type (the heavy / slim / mature morphs and the
 * matching joint offsets), drops the body faces its garments cover, and merges everything into ONE skinned mesh with
 * ONE material: one draw call per person (plus its shadow).
 *
 * The bones carry the Bip01 names of the Rocketbox rig, so the boxing rig layer (boxing/rig.ts) and the motion
 * library drive it unchanged.
 */
export type BoxerGender = "m" | "f";
export type BoxerOutfit = "boxer" | "referee" | "staff" | "casual";
export const BOXER_URL: Record<BoxerGender, string> = { m: "/assets/characters/boxer-m.glb", f: "/assets/characters/boxer-f.glb" };

/** body cover bits (build.mjs COVER) */
const COVER = { vest: 1, trunks: 2, boots: 4, gloves: 8, headgear: 16, shirt: 32, trousers: 64, shoes: 128, hair: 256, sock: 512, vestCore: 1024 } as const;

const OUTFIT_MESHES: Record<BoxerOutfit, { meshes: string[]; cover: number; headgear: boolean }> = {
  boxer: { meshes: ["body", "kit_vest", "kit_trunks", "kit_boots", "kit_socks", "kit_gloves", "kit_headgear", "kit_wraps"], cover: COVER.vest | COVER.trunks | COVER.boots | COVER.gloves | COVER.headgear, headgear: true },
  referee: { meshes: ["body", "ref_shirt", "ref_collar", "ref_bowtie", "ref_trousers", "ref_shoes", "hair_cap"], cover: COVER.shirt | COVER.trousers | COVER.shoes | COVER.hair, headgear: false },
  staff: { meshes: ["body", "staff_polo", "staff_collar", "ref_trousers", "ref_shoes", "hair_cap"], cover: COVER.shirt | COVER.trousers | COVER.shoes | COVER.hair, headgear: false },
  // P3-FGT-15: an everyday person (the realistic human out of the ring): a draped tee in the look's top colour,
  // trousers in its bottom colour, shoes
  casual: { meshes: ["body", "staff_polo", "ref_trousers", "ref_shoes", "hair_cap"], cover: COVER.shirt | COVER.trousers | COVER.shoes | COVER.hair, headgear: false },
};

export interface BoxerSpec {
  outfit: BoxerOutfit;
  colors: BoxerColors;
  /** body type: heavy / slim / mature morph weights (0…1) */
  build: { heavy: number; slim: number; mature: number };
  /** without headgear (sparring at a bag, a fighter between fights) */
  noHeadgear?: boolean;
  /** without gloves (skipping, shadow boxing in wraps): the hands show */
  noGloves?: boolean;
  /** dithered fade in / out (staff popping in and out of the draw set): the material uses alpha hashing */
  fadeable?: boolean;
  face: { beard: number; brow: number };
  /** P3-FGT-14: the player's face shape as face targets ("shape:round", "nose:broad", …; facePickOf) */
  facePick?: string[];
  /** cast shadows */
  shadows?: boolean;
  /** the body alone, nothing covered (the lab's skinning view) */
  bare?: boolean;
  /** P3-FGT-15: which skin texture (the gender's), 1K textures on phones / Lite */
  gender?: "m" | "f";
  lite?: boolean;
}

export interface BoxerInstance {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshPhysicalMaterial & { userData: { u: BoxerUniforms } };
  uniforms: BoxerUniforms;
  arms: ArmBones[];
  /** the torso slices of this body type (rig keep-out; build.mjs torsoSlices) */
  torso: TorsoSlices | null;
  bone(name: string): THREE.Bone | null;
  dispose(): void;
}

interface Extras {
  boxerBody?: number;
  morphs: string[];
  boneMorph: Record<string, number[][]>;
  torsoMorph?: Record<string, number[][]>;
  landmarks: { headC: number[]; eyeL: number[]; eyeR: number[]; kit?: number[]; torso?: number[][] };
}

/** Build one person from the loaded GLB scene (the GLTF stays shared and untouched). */
export function makeBoxer(gltfScene: THREE.Object3D, extras: Extras, spec: BoxerSpec): BoxerInstance {
  const scene = cloneSkinned(gltfScene) as THREE.Object3D;
  const plan = OUTFIT_MESHES[spec.outfit];
  const wanted = spec.bare ? ["body"] : plan.meshes.filter((n) => !(spec.noHeadgear && n === "kit_headgear") && !(spec.noGloves && n === "kit_gloves"));
  let cover = spec.bare ? 0 : plan.cover;
  if (spec.noGloves) cover &= ~COVER.gloves;
  if (spec.noHeadgear && plan.headgear && !spec.bare) {
    // no headgear: the hair shows (the short hair cap over the scalp)
    cover = (cover & ~COVER.headgear) | COVER.hair;
    wanted.push("hair_cap");
  }
  const byName = new Map<string, THREE.SkinnedMesh>();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) byName.set(m.name, m);
  });
  const any = byName.get("body")!;
  const skeleton = any.skeleton;
  const names = extras.morphs;
  const w = names.map((n) => (n === "heavy" ? spec.build.heavy : n === "slim" ? spec.build.slim : n === "mature" ? spec.build.mature : 0));

  // 1. bake the body type into each wanted geometry, drop covered body faces, give every part the same attributes
  const geos: THREE.BufferGeometry[] = [];
  for (const name of wanted) {
    const m = byName.get(name);
    if (!m) continue;
    const g = m.geometry.clone();
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const morphs = g.morphAttributes.position ?? [];
    // targets by name (the body mesh also carries the face-shape targets after the body types)
    const dict = m.morphTargetDictionary ?? {};
    const byIndex: number[] = [];
    for (const [n, k] of Object.entries(dict)) byIndex[k] = names.includes(n) ? (w[names.indexOf(n)] ?? 0) : (spec.facePick?.includes(n) ? FACE_WEIGHT : 0);
    for (let k = 0; k < morphs.length; k++) {
      const wk = Object.keys(dict).length ? (byIndex[k] ?? 0) : (w[k] ?? 0);
      if (wk < 1e-3) continue;
      const d = morphs[k]!;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + d.getX(i) * wk, pos.getY(i) + d.getY(i) * wk, pos.getZ(i) + d.getZ(i) * wk);
    }
    g.morphAttributes = {};
    const n = pos.count;
    if (!g.getAttribute("_zone")) g.setAttribute("_zone", new THREE.BufferAttribute(new Uint8Array(n), 1));
    if (!g.getAttribute("_paint")) g.setAttribute("_paint", new THREE.BufferAttribute(new Uint8Array(n * 4), 4, true));
    const cov = g.getAttribute("_cover") as THREE.BufferAttribute | undefined;
    if (name === "body" && cov && g.index) {
      const idx = g.index.array;
      const keep: number[] = [];
      const socks = spec.outfit === "boxer";
      const mat = g.getAttribute("_mat") as THREE.BufferAttribute;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!,
          b = idx[t + 1]!,
          c = idx[t + 2]!;
        const ca = cov.getX(a),
          cb = cov.getX(b),
          cc = cov.getX(c);
        if (ca & cb & cc & cover) continue;
        // P3-FGT-16: under the vest a face with two of its three corners well inside (≥ 1 cm from the edge: the vestCore
        // bit) goes too — the narrow straps over the trapezius left slivers of skin that rose through the cloth when the
        // shoulders shrugged; the edge itself is untouched (no hole can open beside the binding)
        if (cover & COVER.vest && ((ca & cb) | (cb & cc) | (ca & cc)) & COVER.vestCore) continue;
        keep.push(a, b, c);
      }
      // the boxer's socks: the band above the boot top is painted white (sock slot)
      if (socks) for (let i = 0; i < n; i++) if (cov.getX(i) & COVER.sock && mat.getX(i) === 0) mat.setX(i, 23);
      g.setIndex(keep);
    }
    g.deleteAttribute("_cover");
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error("boxer: merge failed");
  // garments never inside the drawn skin (collars on the neck, shoes on the instep: QA-HUM-01)
  if (!spec.bare) depenetrate(merged);
  merged.computeBoundingBox();
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.7);

  // 2. the skeleton: move each joint by the body type's joint offsets, then re-bind
  const deltas = skeleton.bones.map(() => new THREE.Vector3());
  names.forEach((n, k) => {
    const wk = w[k] ?? 0;
    const d = extras.boneMorph[n];
    if (!d || wk < 1e-3) return;
    skeleton.bones.forEach((_, i) => {
      const v = d[i];
      if (v) deltas[i]!.add(new THREE.Vector3(v[0], v[1], v[2]).multiplyScalar(wk));
    });
  });
  // (bind rotations are identity: a joint's local offset is its world offset minus its parent's)
  const index = new Map(skeleton.bones.map((b, i) => [b, i]));
  for (const [i, b] of skeleton.bones.entries()) {
    const p = b.parent as THREE.Bone | null;
    const pi = p && index.has(p) ? index.get(p)! : -1;
    const dp = pi >= 0 ? deltas[pi]! : new THREE.Vector3();
    b.position.add(deltas[i]!).sub(dp);
  }
  const root = new THREE.Group();
  root.name = "boxer";
  const top = skeleton.bones[0]!;
  root.add(top);
  const material = boxerMaterial(
    spec.colors,
    { L: new THREE.Vector3().fromArray(extras.landmarks.eyeL).add(deltas[index.get(boneOf(skeleton, "Bip01_L_Eye")!) ?? 0]!), R: new THREE.Vector3().fromArray(extras.landmarks.eyeR).add(deltas[index.get(boneOf(skeleton, "Bip01_R_Eye")!) ?? 0]!) },
    spec.face,
    extras.landmarks.kit,
    { gender: spec.gender, lite: spec.lite },
  );
  if (spec.fadeable) material.alphaHash = true;
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.name = "boxer-body";
  mesh.castShadow = spec.shadows !== false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  root.add(mesh);
  root.updateMatrixWorld(true);
  skeleton.calculateInverses();
  mesh.bind(skeleton, mesh.matrixWorld);
  // (the cloned GLTF meshes are dropped: only the bones were taken)

  const bone = (n: string) => boneOf(skeleton, n);
  const arms: ArmBones[] = [];
  for (const [k, side] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    const upper = bone(`Bip01_${k}_UpperArm`),
      fore = bone(`Bip01_${k}_Forearm`),
      hand = bone(`Bip01_${k}_Hand`);
    const fingers = [0, 1, 2, 3, 4].map((f) => [`Bip01_${k}_Finger${f}`, `Bip01_${k}_Finger${f}1`, `Bip01_${k}_Finger${f}2`].map(bone).filter((b): b is THREE.Bone => !!b));
    if (upper && fore && hand) arms.push({ upper, fore, hand, side, fingers });
  }
  return {
    root,
    mesh,
    material,
    uniforms: material.userData.u,
    arms,
    torso: torsoOf(extras, names, w),
    bone,
    dispose() {
      merged.dispose();
      material.dispose();
    },
  };
}

/** the torso slices for these body-type weights: base + Σ w · morph delta (null on a GLB without them) */
export function torsoOf(extras: Pick<Extras, "landmarks" | "torsoMorph">, names: string[], w: number[]): TorsoSlices | null {
  const base = extras.landmarks.torso;
  if (!base?.length) return null;
  return base.map((row, i) => {
    const r = row.slice() as [number, number, number, number];
    names.forEach((n, k) => {
      const d = extras.torsoMorph?.[n]?.[i];
      const wk = w[k] ?? 0;
      if (d && wk > 1e-3) for (let a = 0; a < 4; a++) r[a] = r[a]! + (d[a] ?? 0) * wk;
    });
    return r;
  });
}

/** how much of a face target the boxer head takes (the targets are already moderate: build.mjs FACE_MORPHS) */
const FACE_WEIGHT = 1;

/** the face-shape targets of an avatar face (world/face.ts): shape, eyes, nose, lips (the base options have none) */
export function facePickOf(face: { shape?: string; eyes?: string; nose?: string; lips?: string } | undefined): string[] {
  if (!face) return [];
  return [`shape:${face.shape}`, `eyes:${face.eyes}`, `nose:${face.nose}`, `lips:${face.lips}`];
}

function boneOf(sk: THREE.Skeleton, name: string): THREE.Bone | null {
  return sk.bones.find((b) => b.name === name) ?? null;
}

/** look → body-type weights: weight class from the ring (both fighters alike), a little personal variety, the age range */
export function buildOf(klass: number, seed: number, age: string | undefined): BoxerSpec["build"] {
  const v = ((seed % 1000) / 1000 - 0.5) * 0.24;
  const b = Math.max(-1, Math.min(1, klass + v));
  return { heavy: Math.max(0, b), slim: Math.max(0, -b), mature: age === "senior" ? 0.85 : age === "adult" ? 0.45 : 0 };
}
