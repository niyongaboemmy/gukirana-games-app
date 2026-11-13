import * as THREE from "three";
import { fabricTexture } from "../textures";
import { itemById, type AvatarLook, type OutfitItem } from "../outfits";
import type { HumanModelMeta } from "./meta";

/**
 * Look-driven recolouring of the photographic Rocketbox textures. The base albedo keeps all its detail (pores,
 * fabric folds, stitching); a per-texel mask says which region a texel belongs to:
 *   body texture: R skin · G top · B bottom · none = shoes
 *   head texture: R skin · G hair · B collar (top colour) · none = eyes/mouth (untouched)
 * Skin is re-tinted with a per-channel ratio blended into a luminance transfer for large tone changes; clothes and
 * hair use luminance transfer (target colour × local brightness / region mean) so folds and weave survive.
 */

const lin = (hex: string) => new THREE.Color(hex); // THREE.Color parses sRGB hex into linear working space
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function itemColor(item: OutfitItem | undefined, accent: string, fallback: string): string {
  const c = item?.color ?? fallback;
  return c === "accent" ? accent : c;
}

export interface LookUniforms {
  uMask: { value: THREE.Texture | null };
  uIsHead: { value: number };
  uSkin: { value: THREE.Color };
  uSkinMul: { value: THREE.Vector3 };
  uSkinMix: { value: number };
  uSkinRef: { value: number };
  uTop: { value: THREE.Color };
  uTopRef: { value: number };
  uBottom: { value: THREE.Color };
  uBottomRef: { value: number };
  uShoes: { value: THREE.Color };
  uShoesRef: { value: number };
  uHair: { value: THREE.Color };
  uHairRef: { value: number };
  uHairToSkin: { value: number };
  uLegsSkin: { value: number };
  uTopPrint: { value: THREE.Texture | null };
  uTopPrintOn: { value: number };
  uBottomPrint: { value: THREE.Texture | null };
  uBottomPrintOn: { value: number };
  uClothes: { value: number };
}

function printTex(id: OutfitItem["print"]): THREE.Texture | null {
  if (!id) return null;
  const t = fabricTexture(id);
  if (t.wrapS !== THREE.RepeatWrapping) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }
  return t;
}

export function lookUniforms(look: AvatarLook, meta: HumanModelMeta, isHead: boolean, mask: THREE.Texture | null, keepClothes = false): LookUniforms {
  const top = itemById(look.outfit.top);
  const bottom = itemById(look.outfit.bottom);
  const shoes = itemById(look.outfit.shoes);
  const skin = lin(look.skinTone);
  const ref = new THREE.Color(...meta.skinRef);
  const mul = new THREE.Vector3(skin.r / Math.max(ref.r, 0.004), skin.g / Math.max(ref.g, 0.004), skin.b / Math.max(ref.b, 0.004));
  // large tone changes amplify the dark channels' noise with a plain ratio, so fade towards luminance transfer
  // (body textures carry hands/arms whose hue drifts from the face, so the body leans on luminance transfer)
  const skinMix = Math.max(THREE.MathUtils.clamp(Math.abs(Math.log2(lum(skin) / Math.max(lum(ref), 1e-4))) / 2.2, 0, 0.85), isHead ? 0 : 0.7);
  const bottomKind = bottom?.kind;
  return {
    uMask: { value: mask },
    uIsHead: { value: isHead ? 1 : 0 },
    uSkin: { value: skin },
    uSkinMul: { value: mul },
    uSkinMix: { value: skinMix },
    uSkinRef: { value: meta.regions.skin },
    uTop: { value: lin(top?.print ? "#ffffff" : itemColor(top, look.accent, "#3a3a3a")) },
    uTopRef: { value: meta.regions.top },
    uBottom: { value: lin(bottom?.print ? "#ffffff" : itemColor(bottom, look.accent, "#2b2f45")) },
    uBottomRef: { value: meta.regions.bottom },
    uShoes: { value: lin(itemColor(shoes, look.accent, "#f4f4f4")) },
    uShoesRef: { value: meta.regions.shoes },
    uHair: { value: lin(look.hairColor) },
    uHairRef: { value: meta.regions.hair },
    uHairToSkin: { value: look.hairStyle === "bald" ? 1 : 0 },
    // skirts / long wraps: the base trousers become legs (skin) below the garment mesh
    uLegsSkin: { value: bottomKind === "skirt" || bottomKind === "longwrap" ? 1 : 0 },
    uTopPrint: { value: printTex(top?.print) },
    uTopPrintOn: { value: top?.print ? 1 : 0 },
    uBottomPrint: { value: printTex(bottom?.print) },
    uBottomPrintOn: { value: bottom?.print ? 1 : 0 },
    uClothes: { value: keepClothes ? 0 : 1 },
  };
}

const HEADER = /* glsl */ `
uniform sampler2D uMask;
uniform float uIsHead;
uniform vec3 uSkin; uniform vec3 uSkinMul; uniform float uSkinMix; uniform float uSkinRef;
uniform vec3 uTop; uniform float uTopRef;
uniform vec3 uBottom; uniform float uBottomRef;
uniform vec3 uShoes; uniform float uShoesRef;
uniform vec3 uHair; uniform float uHairRef; uniform float uHairToSkin;
uniform float uLegsSkin; uniform float uClothes;
uniform sampler2D uTopPrint; uniform float uTopPrintOn;
uniform sampler2D uBottomPrint; uniform float uBottomPrintOn;
float gkDetail(float l, float ref, float k) { return mix(1.0, pow(clamp(l / max(ref, 1e-4), 0.0, 3.5), 0.8), k); }
`;

const RECOLOUR = /* glsl */ `
#include <map_fragment>
{
  vec4 gkM = texture2D(uMask, vMapUv);
  vec3 gkBase = diffuseColor.rgb;
  float gkL = dot(gkBase, vec3(0.2126, 0.7152, 0.0722));
  vec3 gkSkinCol = mix(gkBase * uSkinMul, uSkin * gkDetail(gkL, uSkinRef, 0.9), uSkinMix);
  vec3 gkCol = mix(gkBase, gkSkinCol, gkM.r);
  if (uIsHead > 0.5) {
    vec3 gkHairCol = mix(uHair * gkDetail(gkL, uHairRef, 0.75), uSkin * gkDetail(gkL, uHairRef, 0.12) * 0.92, uHairToSkin);
    gkCol = mix(gkCol, gkHairCol, gkM.g);
    gkCol = mix(gkCol, uTop * gkDetail(gkL, uTopRef, 0.8), gkM.b * uClothes);
  } else {
    vec3 gkTopC = uTopPrintOn > 0.5 ? texture2D(uTopPrint, vMapUv * 7.0).rgb : uTop;
    vec3 gkBotC = uBottomPrintOn > 0.5 ? texture2D(uBottomPrint, vMapUv * 7.0).rgb : uBottom;
    gkBotC = mix(gkBotC * gkDetail(gkL, uBottomRef, 0.85), uSkin * gkDetail(gkL, uBottomRef, 0.1), uLegsSkin);
    gkCol = mix(gkCol, gkTopC * gkDetail(gkL, uTopRef, 0.85), gkM.g * uClothes);
    gkCol = mix(gkCol, gkBotC, gkM.b * uClothes);
    float gkShoe = clamp(1.0 - gkM.r - gkM.g - gkM.b, 0.0, 1.0);
    gkCol = mix(gkCol, uShoes * gkDetail(gkL, uShoesRef, 0.85), gkShoe * uClothes);
  }
  diffuseColor.rgb = gkCol;
}
`;

const ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
{
  vec4 gkM2 = texture2D(uMask, vMapUv);
  // skin has a soft sheen, fabric is matte, hair slightly glossy
  roughnessFactor = mix(roughnessFactor, 0.5, gkM2.r);
  if (uIsHead > 0.5) roughnessFactor = mix(roughnessFactor, 0.62, gkM2.g);
}
`;

/** Clone a base Rocketbox material and attach the look recolour shader. */
export function makeLookMaterial(base: THREE.MeshStandardMaterial, look: AvatarLook, meta: HumanModelMeta, isHead: boolean, keepClothes = false): THREE.MeshStandardMaterial {
  const mask = (base.userData.gkMask as THREE.Texture | undefined) ?? null;
  const m = base.clone();
  m.emissiveMap = null;
  m.emissive.set(0x000000);
  if (!mask || !m.map) return m;
  const u = lookUniforms(look, meta, isHead, mask, keepClothes);
  m.userData.gkUniforms = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = HEADER + shader.fragmentShader.replace("#include <map_fragment>", RECOLOUR).replace("#include <roughnessmap_fragment>", ROUGH);
  };
  m.customProgramCacheKey = () => "gk-human-look";
  return m;
}

/** Hair cards (alpha-tested strands) take the chosen hair colour via luminance transfer. */
export function makeHairCardMaterial(base: THREE.MeshStandardMaterial, look: AvatarLook, meta: HumanModelMeta): THREE.MeshStandardMaterial {
  const m = base.clone();
  const hair = lin(look.hairColor);
  const ref = meta.regions.hair;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHair = { value: hair };
    shader.uniforms.uHairRef = { value: ref };
    shader.fragmentShader =
      "uniform vec3 uHair; uniform float uHairRef;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        { float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = uHair * mix(1.0, pow(clamp(l / max(uHairRef, 1e-4), 0.0, 3.5), 0.8), 0.75); }`,
      );
  };
  m.customProgramCacheKey = () => "gk-human-hair";
  m.roughness = 0.6;
  return m;
}
