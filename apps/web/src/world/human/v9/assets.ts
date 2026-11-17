import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadTextureInto } from "../boxer/v8/ktx2";
import { GK_SKIN_GLSL, skinDetailTexture } from "../skin/skin-shading";
import { V9_BASE } from "./flag";
import { hipScale, keepTrack, type V9Manifest, type V9Person, type V9Tier } from "./logic";

/**
 * P2-AVA-13: loading the v9 scanned people, each once per page and shared by every instance: the manifest, one GLB
 * per person (skeleton + three LOD meshes), one material per person (its KTX2 maps: 2k on desktop, 1k on phones,
 * through the v8 boxers' KTX2 loader) and the clip library, cut down per person to rotations plus a root track scaled
 * to their hip height (logic.ts keepTrack / hipScale).
 */
let manifestP: Promise<V9Manifest | null> | null = null;

/** The published manifest, or null when no v9 people are published (the folder is git-ignored). */
export function loadManifest(): Promise<V9Manifest | null> {
  manifestP ??= fetch(`${V9_BASE}manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<V9Manifest>) : null))
    .then((m) => (m && Array.isArray(m.people) && m.people.length ? m : null))
    .catch(() => null);
  return manifestP;
}

const gltfs = new Map<string, Promise<GLTF>>();
function loadGlb(url: string): Promise<GLTF> {
  let p = gltfs.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url);
    gltfs.set(url, p);
  }
  return p;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Scan shading on top of MeshStandardMaterial, with the shared skin module (world/human/skin/skin-shading.ts): the
 * skin mask from the pipeline (R = skin) gives skin a lower roughness with breakup and the pore detail normal; all
 * the rest is matte cloth (roughness 0.9) with a faint knit micro-normal, so trousers never read plastic. The
 * micro detail fades below a pixel (no shimmer at a distance).
 */
function scanShading(m: THREE.MeshStandardMaterial, mask: { value: THREE.Texture | null }) {
  const detail = { value: skinDetailTexture() };
  m.customProgramCacheKey = () => "gk-v9-scan";
  m.onBeforeCompile = (sh) => {
    sh.uniforms.gkMask = mask;
    sh.uniforms.gkDetail = detail;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D gkMask;
uniform sampler2D gkDetail;
${GK_SKIN_GLSL.detailNormal}
${GK_SKIN_GLSL.breakup}
${GK_SKIN_GLSL.fabric}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float gkSkin = 0.0;
#ifdef USE_MAP
gkSkin = texture2D(gkMask, vMapUv).r;
roughnessFactor = mix(0.9, 0.5 + gkBreakup(vMapUv, 700.0) * 0.14, gkSkin);
#endif`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef USE_MAP
{
  float lod = gkDetailLod(vMapUv, 90.0, 512.0);
  vec2 dn = (texture2D(gkDetail, vMapUv * 90.0).rg * 2.0 - 1.0);
  normal = gkDetailN(normal, -vViewPosition, vMapUv * 90.0, dn, 0.35 * gkSkin * lod);
  vec2 cn = gkFabricN(1, vMapUv, 140.0, gkDetailLod(vMapUv, 140.0, 512.0), gkDetail);
  normal = gkDetailN(normal, -vViewPosition, vMapUv * 140.0, cn, 0.22 * (1.0 - gkSkin));
}
#endif`,
      );
  };
}

/** a 1 px black mask (no skin) until the real one loads */
const NO_SKIN = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
NO_SKIN.needsUpdate = true;

/**
 * The person's material: the scan's photo colour (it carries the scan's own soft light, so no extra AO), the normal
 * map baked from the full scan for decimated scans, and the skin / cloth split from the skin mask.
 */
export function personMaterial(p: V9Person, tier: V9Tier): THREE.MeshStandardMaterial {
  const key = `${p.id}:${tier}`;
  let m = mats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.name = `v9-${p.id}`;
  const maps = tier === "lite" ? p.maps.phone : p.maps.desktop;
  const mm = m;
  const color = { value: null as THREE.Texture | null };
  loadTextureInto(color, V9_BASE + maps.color, { srgb: true, anisotropy: 4 }, () => {
    mm.map = color.value;
    mm.needsUpdate = true;
  });
  if (maps.normal) {
    const normal = { value: null as THREE.Texture | null };
    loadTextureInto(normal, V9_BASE + maps.normal, { srgb: false, anisotropy: 4 }, () => {
      mm.normalMap = normal.value;
      mm.normalScale.set(0.8, 0.8);
      mm.needsUpdate = true;
    });
  }
  const mask = { value: NO_SKIN as THREE.Texture | null };
  if (p.mask) loadTextureInto(mask, V9_BASE + p.mask, { srgb: false }, () => void 0);
  scanShading(m, mask);
  mats.set(key, m);
  return m;
}

export interface PersonAsset {
  person: V9Person;
  gltf: GLTF;
  /** the root bone's bind height (m) */
  hip: number;
}

export async function loadPerson(p: V9Person): Promise<PersonAsset> {
  const gltf = await loadGlb(V9_BASE + p.glb);
  gltf.scene.updateMatrixWorld(true);
  const root = gltf.scene.getObjectByName("Bip01");
  const hip = root ? root.getWorldPosition(new THREE.Vector3()).y : p.height * 0.53;
  return { person: p, gltf, hip };
}

const clipSets = new Map<string, Promise<Map<string, THREE.AnimationClip>>>();
/** The clip library for one body: rotations, plus the root position scaled by the hip-height ratio. */
export function clipsFor(m: V9Manifest, a: PersonAsset): Promise<Map<string, THREE.AnimationClip>> {
  let p = clipSets.get(a.person.id);
  if (!p) {
    p = loadGlb(V9_BASE + m.clips).then((lib) => {
      lib.scene.updateMatrixWorld(true);
      const r = lib.scene.getObjectByName("Bip01");
      const libHip = r ? r.getWorldPosition(new THREE.Vector3()).y : a.hip;
      const k = hipScale(a.hip, libHip);
      const out = new Map<string, THREE.AnimationClip>();
      for (const c of lib.animations) {
        const tracks: THREE.KeyframeTrack[] = [];
        for (const t of c.tracks) {
          const kind = keepTrack(t.name);
          if (!kind) continue;
          if (kind === "root") {
            const tt = t.clone();
            for (let i = 0; i < tt.values.length; i++) tt.values[i] = tt.values[i]! * k;
            tracks.push(tt);
          } else tracks.push(t);
        }
        out.set(c.name, new THREE.AnimationClip(c.name, c.duration, tracks));
      }
      return out;
    });
    clipSets.set(a.person.id, p);
  }
  return p;
}
