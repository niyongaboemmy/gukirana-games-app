import * as THREE from "three";
import { fabricTexture } from "../textures";
import { itemById, LEGACY_SKIN, type AvatarLook, type OutfitItem } from "../outfits";
import type { HumanModelMeta } from "./meta";
import { DEFAULT_FACE, type FaceLook } from "../face";
import type { FaceFrame } from "./face-rig";

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
  // ---- face (P2-AVA-07): head only; see FACE below
  uFaceOn: { value: number };
  uFaceDetail: { value: number };
  uFaceO: { value: THREE.Vector3 };
  uFaceM: { value: THREE.Matrix3 };
  uFaceL: { value: THREE.Vector4 };
  uIris: { value: THREE.Color };
  uFH: { value: THREE.Vector4 };
  uFH2: { value: THREE.Vector4 };
  uBrow: { value: THREE.Vector4 };
  uMarks: { value: THREE.Vector4 };
  uLipTint: { value: THREE.Color };
  uMakeup: { value: THREE.Vector4 };
}

/** Facial hair: full beard, moustache, goatee coverage, hair density, chin strap coverage, extra length. */
const FACIAL_HAIR_PARAMS: Record<FaceLook["facialHair"], [number, number, number, number, number, number]> = {
  none: [0, 0, 0, 0, 0, 0],
  stubble: [0.3, 0.34, 0.3, 0.5, 0, 0],
  moustache: [0, 0.9, 0, 0.9, 0, 0],
  goatee: [0, 0.88, 0.9, 0.9, 0, 0],
  chinstrap: [0, 0, 0, 0.9, 0.88, 0],
  short: [0.8, 0.84, 0.84, 0.85, 0, 0],
  full: [0.93, 0.93, 0.93, 1, 0, 0.16],
  shadow: [0.3, 0.88, 0.3, 0.6, 0, 0],
};
/** Brows: darken, thickness, arch, cover the base brow outside the new shape. */
const BROW_PARAMS: Record<FaceLook["brows"], [number, number, number, number]> = {
  natural: [0, 1, 0, 0],
  full: [0.5, 1.35, 0, 0],
  arched: [0.4, 0.95, 1, 0.55],
  straight: [0.38, 1.05, -0.7, 0.45],
  thin: [0.3, 0.6, 0.35, 0.85],
  bold: [0.75, 1.45, 0.15, 0],
};
/** Make-up: lip tint colour, lip amount, eyeliner amount. */
const LIP_TINTS: Record<FaceLook["makeup"], [string, number, number]> = {
  none: ["#000000", 0, 0],
  gloss: ["#8a4f40", 0.18, 0],
  berry: ["#6b1d38", 0.5, 0],
  red: ["#8e261f", 0.5, 0],
  liner: ["#000000", 0, 1],
  linerBerry: ["#6b1d38", 0.45, 1],
};

function faceUniforms(face: FaceLook, frame: FaceFrame | null, meta: HumanModelMeta) {
  const fh = FACIAL_HAIR_PARAMS[face.facialHair] ?? FACIAL_HAIR_PARAMS.none;
  const br = BROW_PARAMS[face.brows] ?? BROW_PARAMS.natural;
  const lip = LIP_TINTS[face.makeup] ?? LIP_TINTS.none;
  const mouthY = frame?.l.x ?? -1.14;
  // beauty mark spots (face units; +x = the person's left)
  const mark = face.marks === "markCheek" ? [0.66, -0.66] : face.marks === "markLip" ? [-0.36, mouthY + 0.25] : face.marks === "markChin" ? [0.2, mouthY - 0.5] : null;
  const freckles = face.marks === "freckles" ? 0.42 : face.marks === "lightFreckles" ? 0.2 : 0;
  return {
    uFaceOn: { value: frame ? 1 : 0 },
    uFaceDetail: { value: 1 },
    uFaceO: { value: frame?.o.clone() ?? new THREE.Vector3() },
    uFaceM: { value: frame?.m.clone() ?? new THREE.Matrix3() },
    uFaceL: { value: frame?.l.clone() ?? new THREE.Vector4(-1.14, 0.6, 0.27, -0.5) },
    uIris: { value: lin(face.eyeColor) },
    uFH: { value: new THREE.Vector4(fh[0], fh[1], fh[2], fh[3]) },
    // y: the base head has a painted goatee to shave off where the chosen style leaves skin
    uFH2: { value: new THREE.Vector4(fh[4], meta.beard ? 1 : 0, fh[5], 0) },
    uBrow: { value: new THREE.Vector4(br[0], br[1], br[2], br[3]) },
    uMarks: { value: new THREE.Vector4(freckles, mark?.[0] ?? 0, mark?.[1] ?? 0, mark ? 1 : 0) },
    uLipTint: { value: lin(lip[0]) },
    uMakeup: { value: new THREE.Vector4(lip[1], lip[2], face.makeup === "gloss" || face.makeup === "berry" || face.makeup === "linerBerry" ? 1 : 0, 0) },
  };
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

export function lookUniforms(look: AvatarLook, meta: HumanModelMeta, isHead: boolean, mask: THREE.Texture | null, keepClothes = false, frame: FaceFrame | null = null): LookUniforms {
  const top = itemById(look.outfit.top);
  const bottom = itemById(look.outfit.bottom);
  const shoes = itemById(look.outfit.shoes);
  const skin = lin(LEGACY_SKIN[look.skinTone.toUpperCase()] ?? look.skinTone);
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
    uTop: { value: lin(top?.print ? "#ffffff" : itemColor(top, look.topColor ?? look.accent, "#3a3a3a")) },
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
    ...faceUniforms(look.face ?? DEFAULT_FACE, isHead ? frame : null, meta),
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
uniform float uFaceOn; uniform float uFaceDetail; uniform vec4 uFaceL; uniform vec3 uIris;
uniform vec4 uFH; uniform vec4 uFH2; uniform vec4 uBrow; uniform vec4 uMarks; uniform vec3 uLipTint; uniform vec4 uMakeup;
varying vec3 vGkF;
// per-fragment results shared with the roughness / lighting chunks
float gkSkinW = 0.0; float gkEyeW = 0.0; float gkBeardW = 0.0; float gkLipW = 0.0;
float gkHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

/** Vertex side: the bind-pose face position (moves with the skin, so painted details follow lids, lips and jaw). */
const VERT_HEADER = /* glsl */ `
uniform vec3 uFaceO; uniform mat3 uFaceM;
varying vec3 vGkF;
`;
const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
vGkF = uFaceM * (position - uFaceO);
`;

/**
 * Face details painted on the head from the bind-pose face position q (face units: 1 = eye distance, origin between
 * the eyes, +x the person's left, +y up, +z forward): iris colour + a softer sclera, facial hair coloured from the
 * hair colour (hair-fine stipple near, its mean further away), shaving the base head's painted goatee, brows,
 * freckles / a beauty mark, lip tint and eyeliner. All tints of the photographic texture, never decals.
 */
const FACE = /* glsl */ `
if (uFaceOn > 0.5) {
  vec3 q = vGkF;
  float ax = abs(q.x);
  float mY = uFaceL.x;
  float front = smoothstep(-0.2, 0.3, q.z);
  float skinish = clamp(gkM.r + gkM.g, 0.0, 1.0);
  float aa = uFaceDetail * clamp(1.0 - fwidth(q.x) * 30.0, 0.0, 1.0);
  vec3 gkShaved = uSkin * gkDetail(min(gkL, uSkinRef * 1.05), uSkinRef, 0.35);
  // ---- eyes: iris tint (unmasked texels round the eye bones) and a slightly dimmer, warmer sclera
  float eyeD = length(vec3(ax - 0.5, q.y, q.z * 0.7));
  float eyeR = (1.0 - smoothstep(0.3, 0.38, eyeD)) * (1.0 - skinish);
  float iris = eyeR * (1.0 - smoothstep(0.1, 0.22, gkL));
  gkCol = mix(gkCol, uIris * gkDetail(gkL, 0.06, 0.6), iris * 0.72);
  gkCol = mix(gkCol, gkCol * vec3(0.9, 0.86, 0.82), eyeR * smoothstep(0.15, 0.35, gkL));
  gkEyeW = eyeR;
  // ---- facial hair regions
  float lipE = length(vec2(q.x / 0.5, (q.y - mY) / 0.16));
  float notLips = smoothstep(0.9, 1.15, lipE);
  float topY = mix(mY + 0.42, -0.14, smoothstep(0.5, 1.0, ax));
  float region = (1.0 - smoothstep(topY - 0.2, topY + 0.06, q.y))
    * smoothstep(mY - 1.05 - uFH2.z, mY - 0.85 - uFH2.z, q.y)
    * smoothstep(-0.6, -0.3, q.z) * (1.0 - smoothstep(1.02, 1.2, ax)) * notLips;
  // moustache: the upper lip between the mouth and the nose, drooping a little towards the corners
  float mustY = mix(mY, uFaceL.w, 0.42) - 0.28 * q.x * q.x;
  float mustH = max(0.06, (uFaceL.w - mY) * 0.24);
  float must = (1.0 - smoothstep(0.75, 1.05, length(vec2(q.x / 0.6, (q.y - mustY) / mustH)))) * smoothstep(0.85, 1.05, length(vec2(q.x / 0.46, (q.y - mY) / 0.12)));
  float goat = (1.0 - smoothstep(0.8, 1.05, length(vec2(q.x / 0.36, (q.y - (mY - 0.42)) / 0.34)))) * notLips;
  float strap = region * max(smoothstep(0.76, 0.94, ax), 1.0 - smoothstep(mY - 0.6, mY - 0.4, q.y));
  float cover = max(max(region * uFH.x, must * uFH.y), max(goat * uFH.z, strap * uFH2.x));
  // shave the base head's own beard wherever the chosen style leaves skin
  float shave = uFH2.y * region * (1.0 - smoothstep(0.0, 0.5, cover / 0.9)) * front;
  gkCol = mix(gkCol, gkShaved, shave * skinish);
  if (cover > 0.001) {
    float n = gkHash(floor(vec2(q.x, q.y + q.z * 0.6) * 75.0));
    // sparse dots for stubble, dense strands with variation for beards; their mean further away
    float dots = mix(1.0, step(0.5, n) * 2.0, aa);
    float strands = mix(1.0, 0.55 + 0.9 * n, aa);
    float amt = cover * mix(dots, strands, smoothstep(0.45, 0.65, cover)) * mix(0.75, 1.0, uFH.w);
    gkCol = mix(gkCol, uHair * 1.15 + vec3(0.002), clamp(amt, 0.0, 1.0) * front * skinish);
    gkBeardW = clamp(cover, 0.0, 1.0) * front;
  }
  // ---- brows: optionally clear the base brow, then paint the chosen shape in the hair colour
  float bx = ax - 0.6;
  float baseB = 1.0 - smoothstep(0.8, 1.1, length(vec2(bx / 0.4, (q.y - uFaceL.z - 0.02) / 0.11)));
  float archY = uFaceL.z + 0.02 - uBrow.z * 0.55 * bx * bx + uBrow.z * 0.03;
  float styleB = 1.0 - smoothstep(0.75, 1.05, length(vec2(bx / 0.37, (q.y - archY) / (0.07 * uBrow.y))));
  styleB *= smoothstep(0.08, 0.2, ax);
  gkCol = mix(gkCol, gkShaved, baseB * (1.0 - styleB) * uBrow.w * front * skinish);
  float bn = mix(1.0, 0.6 + 0.8 * gkHash(floor(q.xy * vec2(40.0, 90.0))), aa);
  gkCol = mix(gkCol, uHair * 1.2 + vec3(0.002), clamp(styleB * uBrow.x * bn, 0.0, 1.0) * front * skinish);
  // ---- freckles (cheeks and the bridge of the nose) and a beauty mark
  if (uMarks.x > 0.0 && uFaceDetail > 0.01) {
    float area = max(1.0 - smoothstep(0.3, 0.6, length(vec2(ax - 0.5, q.y + 0.45))), 1.0 - smoothstep(0.12, 0.28, length(vec2(q.x, q.y + 0.28))));
    vec2 c = q.xy * 24.0;
    vec2 id = floor(c);
    vec2 off = vec2(gkHash(id + 7.1), gkHash(id + 3.7)) - 0.5;
    float spot = step(gkHash(id), uMarks.x) * (1.0 - smoothstep(0.12, 0.27, length(fract(c) - 0.5 - off * 0.5)));
    gkCol *= mix(1.0, 0.6, spot * area * front * gkM.r * uFaceDetail);
  }
  if (uMarks.w > 0.5) {
    float d = length(vec2(q.x - uMarks.y, q.y - uMarks.z));
    gkCol = mix(gkCol, gkCol * 0.32, (1.0 - smoothstep(0.03, 0.046, d)) * front * gkM.r);
  }
  // ---- make-up: lip tint (keeps the lip texture) and a thin upper-lid liner
  float lips = (1.0 - smoothstep(0.8, 1.0, length(vec2(q.x / 0.42, (q.y - mY) / 0.15)))) * front;
  gkLipW = lips * gkM.r;
  if (uMakeup.x > 0.0) {
    float l0 = dot(gkCol, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = uLipTint * (l0 / max(dot(uLipTint, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
    gkCol = mix(gkCol, tint, uMakeup.x * gkLipW);
  }
  if (uMakeup.y > 0.0) {
    float ld = length(vec2((ax - 0.5) / 0.3, (q.y - 0.03) / 0.16));
    float liner = (1.0 - smoothstep(0.06, 0.14, abs(ld - 1.0))) * step(0.02, q.y) * smoothstep(0.25, 0.4, ax);
    gkCol = mix(gkCol, vec3(0.008, 0.006, 0.005), liner * (1.0 - eyeR) * front * 0.85);
  }
}
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
    vec3 gkHairCol = mix(max(uHair, vec3(0.011, 0.0095, 0.0085)) * gkDetail(gkL, uHairRef, 0.75), uSkin * gkDetail(gkL, uHairRef, 0.12) * 0.92, uHairToSkin);
    gkCol = mix(gkCol, gkHairCol, gkM.g);
    // collar region: hard threshold so the soft mask edge never tints the throat
    // (only at the neck base: stray mask texels on the throat used to show as top-coloured specks)
    float gkNeck = uFaceOn > 0.5 ? 1.0 - smoothstep(-3.1, -2.7, vGkF.y) : 1.0;
    gkCol = mix(gkCol, uTop * gkDetail(gkL, uTopRef, 0.8), smoothstep(0.6, 0.85, gkM.b) * uClothes * gkNeck);
    ${FACE}
  } else {
    vec3 gkTopC = uTopPrintOn > 0.5 ? texture2D(uTopPrint, vMapUv * 7.0).rgb : uTop;
    vec3 gkBotC = uBottomPrintOn > 0.5 ? texture2D(uBottomPrint, vMapUv * 7.0).rgb : uBottom;
    gkBotC = mix(gkBotC * gkDetail(gkL, uBottomRef, 0.85), uSkin * gkDetail(gkL, uBottomRef, 0.1), uLegsSkin);
    gkCol = mix(gkCol, gkTopC * gkDetail(gkL, uTopRef, 0.85), gkM.g * uClothes);
    gkCol = mix(gkCol, gkBotC, gkM.b * uClothes);
    float gkShoe = clamp(1.0 - gkM.r - gkM.g - gkM.b, 0.0, 1.0);
    gkCol = mix(gkCol, min(uShoes * gkDetail(gkL, uShoesRef, 0.85), vec3(0.7)), gkShoe * uClothes);
  }
  gkSkinW = gkM.r * (1.0 - gkM.g);
  diffuseColor.rgb = gkCol;
}
`;

const ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
{
  vec4 gkM2 = texture2D(uMask, vMapUv);
  // skin has a soft sheen, fabric is matte, hair slightly glossy
  // skin: slightly glossier in the T-zone / darker creases, matte elsewhere (not plastic)
  float gkLr = dot(texture2D(map, vMapUv).rgb, vec3(0.3, 0.59, 0.11));
  // matte skin (no glare): a faint sheen on the brighter T-zone only
  roughnessFactor = mix(roughnessFactor, mix(0.66, 0.57, smoothstep(0.05, 0.4, gkLr)), gkM2.r);
  if (uIsHead < 0.5) roughnessFactor = mix(roughnessFactor, 0.75, clamp(1.0 - gkM2.r - gkM2.g - gkM2.b, 0.0, 1.0));
  if (uIsHead > 0.5) {
    roughnessFactor = mix(roughnessFactor, 0.66, gkM2.g);
    // facial hair matte; lips a soft sheen (more with gloss); eyes wet: a soft catchlight
    roughnessFactor = mix(roughnessFactor, 0.8, gkBeardW);
    roughnessFactor = mix(roughnessFactor, uMakeup.z > 0.5 ? 0.38 : 0.5, gkLipW * (1.0 - gkBeardW));
    roughnessFactor = mix(roughnessFactor, 0.3, gkEyeW);
  }
}
`;

const WARM = /* glsl */ `
#include <lights_fragment_end>
// skin: light scattered under the surface warms the shadow side a little (cheap subsurface stand-in, no glare)
reflectedLight.indirectDiffuse += gkSkinW * diffuseColor.rgb * vec3(0.07, 0.028, 0.014);
reflectedLight.directDiffuse *= mix(vec3(1.0), vec3(1.03, 0.985, 0.96), gkSkinW);
`;

const RIM = /* glsl */ `
#include <emissivemap_fragment>
{
  // skin: faint warm sheen at grazing angles (subsurface / peach-fuzz rim), so skin never reads as matte plastic
  float gkSk = texture2D(uMask, vMapUv).r;
  float gkRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uSkin * vec3(1.0, 0.82, 0.72) * gkRim * gkSk * 0.12;
}
`;

/** Clone a base Rocketbox material and attach the look recolour shader. */
export function makeLookMaterial(base: THREE.MeshStandardMaterial, look: AvatarLook, meta: HumanModelMeta, isHead: boolean, keepClothes = false, frame: FaceFrame | null = null): THREE.MeshStandardMaterial {
  const mask = (base.userData.gkMask as THREE.Texture | undefined) ?? null;
  const m = base.clone();
  m.emissiveMap = null;
  m.emissive.set(0x000000);
  if (!mask || !m.map) return m;
  const u = lookUniforms(look, meta, isHead, mask, keepClothes, frame);
  m.userData.gkUniforms = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = VERT_HEADER + shader.vertexShader.replace("#include <begin_vertex>", VERT_BEGIN);
    shader.fragmentShader =
      HEADER +
      shader.fragmentShader
        .replace("#include <map_fragment>", RECOLOUR)
        .replace("#include <roughnessmap_fragment>", ROUGH)
        .replace("#include <emissivemap_fragment>", RIM)
        .replace("#include <lights_fragment_end>", WARM);
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
        { float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = max(uHair, vec3(0.011, 0.0095, 0.0085)) * mix(1.0, pow(clamp(l / max(uHairRef, 1e-4), 0.0, 3.5), 0.8), 0.75); }`,
      );
  };
  m.customProgramCacheKey = () => "gk-human-hair";
  m.roughness = 0.6;
  return m;
}
