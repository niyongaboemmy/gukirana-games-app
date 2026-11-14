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
  uSpecMap: { value: number };
}

/**
 * Facial hair (P2-AVA-08): [full beard, moustache, goatee (chin + ring round the mouth), hair density, chin strap,
 * extra length]. Density < ~0.6 reads as stubble (fine speckle with skin between), higher as hair with soft,
 * noise-broken edges. All zero for "none": nothing is painted and the base heads carry no baked beard.
 */
export const FACIAL_HAIR_PARAMS: Record<FaceLook["facialHair"], [number, number, number, number, number, number]> = {
  none: [0, 0, 0, 0, 0, 0],
  stubble: [0.9, 0.85, 0.9, 0.46, 0, 0],
  moustache: [0, 1, 0, 0.92, 0, 0],
  goatee: [0, 0.95, 1, 0.9, 0, 0],
  chinstrap: [0, 0, 0, 0.88, 1, 0],
  short: [0.95, 0.95, 0.95, 0.8, 0, 0],
  full: [1, 1, 1, 1, 0, 0.16],
  shadow: [0.75, 0.9, 0.8, 0.5, 0, 0],
};
/** Brows: darken, thickness, arch, cover the base brow outside the new shape. */
const BROW_PARAMS: Record<FaceLook["brows"], [number, number, number, number]> = {
  natural: [0, 1, 0, 0],
  full: [0.5, 1.35, 0, 0],
  arched: [0.42, 0.95, 1, 0.55],
  straight: [0.4, 1.05, -0.7, 0.45],
  thin: [0.32, 0.6, 0.35, 0.85],
  bold: [0.75, 1.45, 0.15, 0],
};
/**
 * Make-up: lip tint colour, lip amount, eyeliner amount, gloss (0/1). Subtle and matte unless "gloss" is chosen;
 * "none" keeps natural lips (their colour comes from the skin tone, see FACE).
 */
export const LIP_TINTS: Record<FaceLook["makeup"], [string, number, number, number]> = {
  none: ["#000000", 0, 0, 0],
  gloss: ["#7a4a3e", 0.12, 0, 1],
  berry: ["#6b2a3c", 0.34, 0, 0],
  red: ["#862b22", 0.36, 0, 0],
  liner: ["#000000", 0, 0.7, 0],
  linerBerry: ["#6b2a3c", 0.3, 0.7, 0],
};

function faceUniforms(face: FaceLook, frame: FaceFrame | null) {
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
    uFH2: { value: new THREE.Vector4(fh[4], 0, fh[5], 0) },
    uBrow: { value: new THREE.Vector4(br[0], br[1], br[2], br[3]) },
    uMarks: { value: new THREE.Vector4(freckles, mark?.[0] ?? 0, mark?.[1] ?? 0, mark ? 1 : 0) },
    uLipTint: { value: lin(lip[0]) },
    uMakeup: { value: new THREE.Vector4(lip[1], lip[2], lip[3], 0) },
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
    uSpecMap: { value: meta.specInMask && isHead ? 1 : 0 },
    ...faceUniforms(look.face ?? DEFAULT_FACE, isHead ? frame : null),
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
uniform float uSpecMap;
varying vec3 vGkF;
// per-fragment results shared with the roughness / normal / lighting chunks
float gkSkinW = 0.0; float gkEyeW = 0.0; float gkIrisW = 0.0; float gkBeardW = 0.0; float gkLipW = 0.0; float gkHairW = 0.0;
float gkSpec = 0.25; float gkH = 0.0; float gkAO = 1.0;
float gkHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gkNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gkHash(i), gkHash(i + vec2(1.0, 0.0)), u.x), mix(gkHash(i + vec2(0.0, 1.0)), gkHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// band-limited octave: fades to its mean (0.5) as its cells approach the pixel size (no shimmer at a distance)
float gkOct(vec2 p, float cellsPerPx) { return mix(0.5, gkNoise(p), clamp(1.4 - cellsPerPx * 1.6, 0.0, 1.0)); }
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
 * Face details on the head, from the bind-pose face position q (face units: 1 = eye distance, origin between the eyes,
 * +x the person's left, +y up, +z forward). Everything is a tint of the photographic texture, never a decal:
 *  - eyes: chosen iris colour over the photo iris, a soft dark limbal ring, a warm off-white sclera that darkens
 *    towards the corners (a wet, low-roughness cornea gives the catchlight in the lighting);
 *  - facial hair: density fields with organic, noise-broken edges that follow the lip line and the jaw, hair strands
 *    as anisotropic noise along the growth direction (down on the chin, down-and-out on the moustache), skin showing
 *    between them, stubble as fine speckle; colour from the hair colour, slightly lifted and varied per clump. Strand
 *    octaves fade to their mean as they shrink below a pixel (the shader's own distance LOD);
 *  - brows: hair-like strands (inner hairs up, the rest outwards), feathered top edge, tapered tail;
 *  - natural lips coloured from the skin tone (no pink default), optional matte make-up, freckles, beauty marks;
 *  - a soft cavity occlusion at the inner eye corners and the mouth corners (indirect light only).
 * gkH (a height for the strand / curl bump in the normal chunk) and the weights feed the later chunks.
 */
const FACE = /* glsl */ `
if (uFaceOn > 0.5) {
  vec3 q = vGkF;
  float ax = abs(q.x);
  float mY = uFaceL.x;
  float front = smoothstep(-0.2, 0.3, q.z);
  float skinish = clamp(gkM.r + gkM.g, 0.0, 1.0);
  // face units per pixel (screen footprint) and the detail LOD from the CPU (distance)
  float fw = max(length(dFdx(q.xy)), length(dFdy(q.xy))) + 1e-5;
  float det = uFaceDetail;
  // organic edge noise (low frequency, no aliasing concerns)
  float eN = gkNoise(q.xy * 7.0 + 11.0) - 0.5;
  float eN2 = gkOct(q.xy * 19.0 + 3.1, fw * 19.0) - 0.5;
  float jit = eN * 0.12 + eN2 * 0.045;
  // ---- eyes: iris tint over the photo iris, a soft limbal ring, a warm sclera darker towards the corners
  float eyeD = length(vec3(ax - 0.5, q.y, q.z * 0.7));
  float eyeR = (1.0 - smoothstep(0.3, 0.38, eyeD)) * (1.0 - skinish);
  float iris = eyeR * (1.0 - smoothstep(0.1, 0.22, gkL));
  float limbal = eyeR * smoothstep(0.07, 0.15, gkL) * (1.0 - smoothstep(0.17, 0.3, gkL));
  vec3 irisCol = uIris * gkDetail(gkL, 0.06, 0.75);
  gkCol = mix(gkCol, irisCol, iris * 0.75);
  gkCol *= 1.0 - 0.4 * limbal;
  float sclera = eyeR * smoothstep(0.15, 0.35, gkL);
  float corner = smoothstep(0.08, 0.26, abs(ax - 0.5));
  gkCol = mix(gkCol, gkCol * vec3(0.86, 0.81, 0.77) * (1.0 - 0.22 * corner), sclera);
  gkEyeW = eyeR;
  gkIrisW = iris;
  // ---- facial hair: where it may grow
  float lipE = length(vec2(q.x / 0.47, (q.y - mY) / 0.155));
  float notLips = smoothstep(0.95, 1.18, lipE + eN2 * 0.12);
  float topY = mix(mY + 0.42, -0.16, smoothstep(0.48, 1.0, ax));
  float region = (1.0 - smoothstep(topY - 0.24, topY + 0.03, q.y + jit))
    * smoothstep(mY - 1.07 - uFH2.z, mY - 0.83 - uFH2.z, q.y - jit * 0.7)
    * smoothstep(-0.62, -0.28, q.z + jit * 0.4) * (1.0 - smoothstep(1.0, 1.18, ax + jit * 0.3)) * notLips;
  // moustache: the upper lip between the mouth and the nose, drooping a little towards the corners
  float mustY = mix(mY, uFaceL.w, 0.42) - 0.26 * q.x * q.x;
  float mustH = max(0.06, (uFaceL.w - mY) * 0.25);
  float must = (1.0 - smoothstep(0.72, 1.06, length(vec2(q.x / 0.6, (q.y - mustY) / mustH)) + jit * 1.6)) * notLips;
  // goatee: chin patch + a thin ring round the mouth corners joining it to the moustache, soul patch under the lip
  float chin = 1.0 - smoothstep(0.78, 1.06, length(vec2(q.x / 0.37, (q.y - (mY - 0.43)) / 0.33)) + jit * 1.4);
  float ringD = abs(length(vec2(q.x / 0.52, (q.y - (mY - 0.12)) / 0.45)) - 1.0);
  float ring = (1.0 - smoothstep(0.06, 0.2, ringD + jit * 0.6)) * (1.0 - smoothstep(mY - 0.06, mY + 0.1, q.y));
  float goat = max(chin, ring * 0.75) * notLips;
  float strap = region * max(smoothstep(0.76, 0.94, ax + jit * 0.3), 1.0 - smoothstep(mY - 0.62, mY - 0.42, q.y + jit));
  float cover = max(max(region * uFH.x, must * uFH.y), max(goat * uFH.z, strap * uFH2.x)) * front * skinish;
  // hair strands: anisotropic noise along the growth direction (down on chin and jaw, down-and-out on the moustache)
  vec2 gdir = normalize(vec2(sign(q.x) * mix(0.18, 0.65, clamp(must * 2.0, 0.0, 1.0)), -1.0));
  vec2 gp = vec2(dot(q.xy, vec2(-gdir.y, gdir.x)), dot(q.xy, gdir));
  float s1 = gkOct(gp * vec2(34.0, 9.0), fw * 34.0);
  float s2 = gkOct(gp * vec2(80.0, 22.0) + 7.3, fw * 80.0);
  float sv = s1 * 0.6 + s2 * 0.4;
  float clump = gkNoise(q.xy * 11.0 + 1.7);
  // patchy growth: density varies over the face (never a uniform painted shape)
  float patchy = 0.62 + 0.38 * gkNoise(q.xy * 5.0 + 4.2);
  float dens = cover * uFH.w * patchy;
  // near: strands pass a density threshold (sparse speckle for stubble, dense for beards); far: the mean coverage
  float fine = clamp(1.4 - fw * 34.0 * 1.6, 0.0, 1.0) * det;
  float aNear = clamp((sv - (1.0 - dens) * 0.9) * 3.0, 0.0, 1.0) * smoothstep(0.0, 0.3, dens);
  float aFar = smoothstep(0.0, 0.85, dens) * 0.74;
  float beardA = mix(aFar, aNear * 0.9, fine) * (0.85 + 0.15 * clump);
  // the skin under a beard / stubble is darker (follicles, shadow between hairs): stubble reads mostly as this
  // (stubble: a cool shadow of the hair under the skin, strongest on light skin)
  float shade = smoothstep(0.0, 0.75, cover) * patchy * mix(0.4, 0.2, smoothstep(0.45, 0.9, uFH.w)) * step(0.001, uFH.w);
  gkCol = mix(gkCol, gkCol * mix(vec3(0.8, 0.82, 0.86), vec3(1.0), smoothstep(0.6, 0.9, uFH.w)), shade * 1.6);
  gkCol *= 1.0 - shade * (0.75 + 0.25 * clump);
  vec3 hairC = max(uHair * 1.6, vec3(0.016, 0.012, 0.0105)) * (0.7 + 0.6 * clump) * (0.75 + 0.5 * sv);
  gkCol = mix(gkCol, hairC, clamp(beardA, 0.0, 0.9));
  gkBeardW = clamp(dens * 1.4, 0.0, 1.0);
  gkH += gkBeardW * (sv - 0.5) * 1.8 * fine;
  // ---- brows: optionally clear the base brow, then paint the chosen shape as strands in the hair colour
  float bx = ax - 0.6;
  float baseB = 1.0 - smoothstep(0.8, 1.1, length(vec2(bx / 0.4, (q.y - uFaceL.z - 0.02) / 0.11)));
  float archY = uFaceL.z + 0.02 - uBrow.z * 0.55 * bx * bx + uBrow.z * 0.03;
  vec2 bq = vec2(bx / 0.37, (q.y - archY) / (0.07 * uBrow.y));
  // feathered top edge, crisper lower edge, tapered tail
  float bD = length(vec2(bq.x, bq.y * (bq.y > 0.0 ? 0.85 : 1.1))) + eN2 * 0.35 + max(bq.x, 0.0) * 0.25;
  float styleB = (1.0 - smoothstep(0.62, 1.05, bD)) * smoothstep(0.08, 0.22, ax);
  gkCol = mix(gkCol, gkShaved, baseB * (1.0 - styleB) * uBrow.w * front * skinish);
  vec2 bd = normalize(vec2(sign(q.x), mix(1.9, 0.18, smoothstep(-0.34, 0.02, bx))));
  vec2 bp = vec2(dot(q.xy, vec2(-bd.y, bd.x)), dot(q.xy, bd));
  float bs = gkOct(bp * vec2(105.0, 26.0), fw * 105.0) * 0.6 + gkOct(bp * vec2(48.0, 12.0) + 5.0, fw * 48.0) * 0.4;
  float bFine = clamp(1.4 - fw * 105.0 * 1.6, 0.0, 1.0) * det;
  float browA = styleB * uBrow.x * mix(1.0, smoothstep(0.25, 0.75, bs + (styleB - 0.5) * 0.6), bFine);
  // the photo brow (hair-masked texels) breaks into strands with skin between them; a shade lighter overall
  float natB = baseB * gkM.g * (1.0 - styleB * uBrow.x) * front;
  gkCol = mix(gkCol, gkShaved * 0.85, natB * mix(0.22, (1.0 - smoothstep(0.3, 0.62, bs)) * 0.75, bFine));
  gkCol = mix(gkCol, max(uHair * 1.3, vec3(0.012, 0.009, 0.008)) * (0.8 + 0.4 * bs), clamp(browA, 0.0, 1.0) * front * skinish);
  gkH += (browA + natB) * (bs - 0.5) * bFine;
  // ---- freckles (cheeks and the bridge of the nose) and a beauty mark
  if (uMarks.x > 0.0 && det > 0.01) {
    float area = max(1.0 - smoothstep(0.3, 0.6, length(vec2(ax - 0.5, q.y + 0.45))), 1.0 - smoothstep(0.12, 0.28, length(vec2(q.x, q.y + 0.28))));
    vec2 c = q.xy * 24.0;
    vec2 id = floor(c);
    vec2 off = vec2(gkHash(id + 7.1), gkHash(id + 3.7)) - 0.5;
    float spot = step(gkHash(id), uMarks.x) * (1.0 - smoothstep(0.12, 0.27, length(fract(c) - 0.5 - off * 0.5)));
    gkCol *= mix(1.0, 0.6, spot * area * front * gkM.r * det);
  }
  if (uMarks.w > 0.5) {
    float d = length(vec2(q.x - uMarks.y, q.y - uMarks.z));
    gkCol = mix(gkCol, gkCol * 0.32, (1.0 - smoothstep(0.03, 0.046, d)) * front * gkM.r);
  }
  // ---- lips: natural colour from the skin tone (deeper and cooler on dark skin, rosier on light skin), the
  // photo's lip shading kept; optional matte tint; a thin upper-lid liner
  float lips = (1.0 - smoothstep(0.78, 1.04, length(vec2(q.x / 0.43, (q.y - mY) / 0.15)))) * front;
  gkLipW = lips * gkM.r * (1.0 - gkBeardW * 0.8);
  {
    float l0 = dot(gkCol, vec3(0.2126, 0.7152, 0.0722));
    float ls = dot(uSkin, vec3(0.2126, 0.7152, 0.0722));
    float dark = clamp(1.0 - ls * 5.0, 0.0, 1.0);
    vec3 nat = uSkin * mix(vec3(1.0, 0.72, 0.7), vec3(0.86, 0.64, 0.7), dark);
    // keep the photo's lip shading but squeeze it round the skin's own brightness (a touch darker on dark skin)
    float lt = ls * mix(0.98, 0.84, dark) * pow(clamp(l0 / max(ls, 1e-4), 0.2, 4.0), 0.45);
    nat *= lt / max(dot(nat, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    gkCol = mix(gkCol, nat, 0.72 * gkLipW);
    l0 = mix(l0, lt, 0.72 * gkLipW);
    if (uMakeup.x > 0.0) {
      vec3 tint = uLipTint * (l0 / max(dot(uLipTint, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
      gkCol = mix(gkCol, tint, uMakeup.x * gkLipW);
    }
  }
  if (uMakeup.y > 0.0) {
    float ld = length(vec2((ax - 0.5) / 0.3, (q.y - 0.03) / 0.16));
    float liner = (1.0 - smoothstep(0.05, 0.13, abs(ld - 1.0))) * step(0.02, q.y) * smoothstep(0.25, 0.42, ax);
    gkCol = mix(gkCol, gkCol * 0.25, liner * (1.0 - eyeR) * front * 0.8 * uMakeup.y);
  }
  // ---- soft cavity occlusion: inner eye corners, mouth corners (indirect light only, see WARM)
  float aoE = 1.0 - smoothstep(0.0, 0.14, length(vec2(ax - 0.26, (q.y + 0.02) * 1.3)));
  float aoM = 1.0 - smoothstep(0.0, 0.1, length(vec2(ax - 0.45, (q.y - mY) * 1.4)));
  gkAO = 1.0 - (0.3 * aoE + 0.32 * aoM) * front;
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
  if (uSpecMap > 0.5) gkSpec = gkM.a;
  if (uIsHead > 0.5) {
    // scalp hair: a noise-broken hairline (no painted edge), more depth in the photo's own strands / curls
    float gkHn = gkNoise(vMapUv * 900.0) - 0.5;
    float gkHair = clamp(gkM.g + gkHn * 1.2 * gkM.g * (1.0 - gkM.g) * 4.0, 0.0, 1.0);
    vec3 gkHairCol = mix(max(uHair, vec3(0.011, 0.0095, 0.0085)) * gkDetail(gkL, uHairRef, 0.95), uSkin * gkDetail(gkL, uHairRef, 0.12) * 0.92, uHairToSkin);
    gkCol = mix(gkCol, gkHairCol, gkHair);
    // baby hairs: just outside the hairline the skin carries a faint, fine darkening
    float gkNearHair = texture2D(uMask, vMapUv, 2.5).g;
    float gkBaby = clamp(gkNearHair - gkM.g, 0.0, 1.0) * gkM.r * (1.0 - uHairToSkin);
    gkCol = mix(gkCol, gkHairCol, gkBaby * 0.45 * step(0.55, gkNoise(vMapUv * 1400.0)));
    gkHairW = gkHair * (1.0 - uHairToSkin);
    gkH += gkHairW * (gkDetail(gkL, uHairRef, 1.0) - 1.0) * 0.6;
    // collar region: hard threshold so the soft mask edge never tints the throat
    // (only at the neck base: stray mask texels on the throat used to show as top-coloured specks)
    float gkNeck = uFaceOn > 0.5 ? 1.0 - smoothstep(-3.1, -2.7, vGkF.y) : 1.0;
    gkCol = mix(gkCol, uTop * gkDetail(gkL, uTopRef, 0.8), smoothstep(0.6, 0.85, gkM.b) * uClothes * gkNeck);
    vec3 gkShaved = uSkin * gkDetail(min(gkL, uSkinRef * 1.05), uSkinRef, 0.35);
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
  gkSkinW = gkM.r * (1.0 - gkM.g) * (1.0 - gkBeardW * 0.7);
  diffuseColor.rgb = gkCol;
}
`;

/**
 * Roughness: matte skin (no glare). With the specular map (heads of the player bodies) the photo's own oil
 * distribution drives it: a soft sheen on the forehead / nose (T-zone), matte cheeks; without it, one matte value.
 * Facial hair and scalp hair matte-to-satin, natural lips a soft sheen (gloss only with the gloss make-up), eyes wet.
 */
const ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
{
  vec4 gkM2 = texture2D(uMask, vMapUv);
  float gkGloss = smoothstep(0.04, 0.42, gkSpec);
  roughnessFactor = mix(roughnessFactor, uSpecMap > 0.5 ? mix(0.78, 0.6, gkGloss) : 0.68, gkM2.r);
  if (uIsHead < 0.5) roughnessFactor = mix(roughnessFactor, 0.75, clamp(1.0 - gkM2.r - gkM2.g - gkM2.b, 0.0, 1.0));
  if (uIsHead > 0.5) {
    roughnessFactor = mix(roughnessFactor, 0.66, gkHairW);
    roughnessFactor = mix(roughnessFactor, 0.82, gkBeardW);
    roughnessFactor = mix(roughnessFactor, uMakeup.z > 0.5 ? 0.36 : 0.6, gkLipW);
    roughnessFactor = mix(roughnessFactor, mix(0.24, 0.12, gkIrisW), gkEyeW);
  }
}
`;

/** Strand / curl relief (beard, brows, scalp hair) as a bump from gkH: screen-space derivatives, no tangents. */
const BUMP = /* glsl */ `
#include <normal_fragment_maps>
if (uIsHead > 0.5) {
  vec3 gkSx = dFdx(-vViewPosition);
  vec3 gkSy = dFdy(-vViewPosition);
  vec3 gkR1 = cross(gkSy, normal);
  vec3 gkR2 = cross(normal, gkSx);
  float gkDet = dot(gkSx, gkR1) * faceDirection;
  vec2 gkDh = vec2(dFdx(gkH), dFdy(gkH)) * 0.0006;
  vec3 gkGrad = sign(gkDet) * (gkDh.x * gkR1 + gkDh.y * gkR2);
  normal = normalize(abs(gkDet) * normal - gkGrad);
}
`;

/** Specular strength: skin F0 ≈ 0.028 (not the plastic 0.04), less on matte areas; hair ≈ 0.046. */
const SPEC = /* glsl */ `
#include <lights_physical_fragment>
{
  float gkF = mix(1.0, mix(0.55, 0.85, smoothstep(0.04, 0.42, gkSpec)), gkSkinW);
  gkF = mix(gkF, 0.9, gkHairW);
  gkF = mix(gkF, 0.7, gkBeardW);
  material.specularColor *= gkF;
  material.specularColorBlended *= gkF;
}
`;

/**
 * Skin diffuse: wrapped lighting per colour channel (light bleeds further round the terminator in red than in blue),
 * a cheap stand-in for subsurface scattering: soft, warm shadow edges instead of the hard Lambert line.
 */
const WRAP_FROM = "reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );";
const WRAP_TO = /* glsl */ `
vec3 gkDI = irradiance;
if (gkSkinW > 0.001) {
  vec3 gkW = vec3(0.46, 0.22, 0.13);
  vec3 gkNL = clamp((vec3(dot(geometryNormal, directLight.direction)) + gkW) / (1.0 + gkW), 0.0, 1.0);
  gkDI = mix(irradiance, gkNL * directLight.color, gkSkinW);
}
reflectedLight.directDiffuse += gkDI * diffuseBRDF * ( 1.0 - F );
`;

const WARM = /* glsl */ `
#include <lights_fragment_end>
// skin: light scattered under the surface warms the shadow side a little; cavities (eye / mouth corners) get less
// ambient light
reflectedLight.indirectDiffuse *= mix(1.0, gkAO, uIsHead);
reflectedLight.indirectDiffuse += gkSkinW * diffuseColor.rgb * vec3(0.05, 0.02, 0.01);
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
        .replace("#include <lights_physical_pars_fragment>", THREE.ShaderChunk.lights_physical_pars_fragment.replace(WRAP_FROM, WRAP_TO))
        .replace("#include <map_fragment>", RECOLOUR)
        .replace("#include <roughnessmap_fragment>", ROUGH)
        .replace("#include <normal_fragment_maps>", BUMP)
        .replace("#include <lights_physical_fragment>", SPEC)
        .replace("#include <lights_fragment_end>", WARM);
  };
  m.customProgramCacheKey = () => "gk-human-look-2";
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
