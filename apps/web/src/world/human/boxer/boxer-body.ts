import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ArmBones } from "../procedural";
import { boxerMaterial, type BoxerColors, type BoxerUniforms } from "./boxer-material";

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
export type BoxerOutfit = "boxer" | "referee" | "staff";
export const BOXER_URL: Record<BoxerGender, string> = { m: "/assets/characters/boxer-m.glb", f: "/assets/characters/boxer-f.glb" };

/** body cover bits (build.mjs COVER) */
const COVER = { vest: 1, trunks: 2, boots: 4, gloves: 8, headgear: 16, shirt: 32, trousers: 64, shoes: 128, hair: 256, sock: 512 } as const;

const OUTFIT_MESHES: Record<BoxerOutfit, { meshes: string[]; cover: number; headgear: boolean }> = {
  boxer: { meshes: ["body", "kit_vest", "kit_trunks", "kit_boots", "kit_socks", "kit_gloves", "kit_headgear", "kit_wraps"], cover: COVER.vest | COVER.trunks | COVER.boots | COVER.gloves | COVER.headgear, headgear: true },
  referee: { meshes: ["body", "ref_shirt", "ref_collar", "ref_bowtie", "ref_trousers", "ref_shoes", "hair_cap"], cover: COVER.shirt | COVER.trousers | COVER.shoes | COVER.hair, headgear: false },
  staff: { meshes: ["body", "staff_polo", "staff_collar", "ref_trousers", "ref_shoes", "hair_cap"], cover: COVER.shirt | COVER.trousers | COVER.shoes | COVER.hair, headgear: false },
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
  /** cast shadows */
  shadows?: boolean;
}

export interface BoxerInstance {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial & { userData: { u: BoxerUniforms } };
  uniforms: BoxerUniforms;
  arms: ArmBones[];
  bone(name: string): THREE.Bone | null;
  dispose(): void;
}

interface Extras {
  boxerBody?: number;
  morphs: string[];
  boneMorph: Record<string, number[][]>;
  landmarks: { headC: number[]; eyeL: number[]; eyeR: number[]; kit?: number[] };
}

/** Build one person from the loaded GLB scene (the GLTF stays shared and untouched). */
export function makeBoxer(gltfScene: THREE.Object3D, extras: Extras, spec: BoxerSpec): BoxerInstance {
  const scene = cloneSkinned(gltfScene) as THREE.Object3D;
  const plan = OUTFIT_MESHES[spec.outfit];
  const wanted = plan.meshes.filter((n) => !(spec.noHeadgear && n === "kit_headgear") && !(spec.noGloves && n === "kit_gloves"));
  let cover = plan.cover;
  if (spec.noGloves) cover &= ~COVER.gloves;
  if (spec.noHeadgear && plan.headgear) {
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
    for (let k = 0; k < morphs.length; k++) {
      const wk = w[k] ?? 0;
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
        if (cov.getX(a) & cov.getX(b) & cov.getX(c) & cover) continue;
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
    bone,
    dispose() {
      merged.dispose();
      material.dispose();
    },
  };
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
