import * as THREE from "three";
import { fabricTexture } from "../textures";
import { itemById, LEGACY_SKIN, type AvatarLook, type OutfitItem } from "../outfits";
import type { HumanModelMeta } from "./meta";
import { DEFAULT_FACE, type FaceLook } from "../face";
import type { FaceFrame } from "./face-rig";
import { ageParams } from "../age";

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
  /** P2-AVA-10: close-cut fade on the sides / back (painted scalp hair gives way to shaved skin), eye distance (m) */
  uHairFade: { value: number };
  uFaceIpd: { value: number };
  /** grey / salt-and-pepper beard and brows: share of silver hairs */
  uHairGrey: { value: number };
  /** grey share of the chosen hair colour itself (painted scalp hair and brows are drawn pepper-and-silver, P2-AVA-11) */
  uHairColGrey: { value: number };
  /**
   * P2-AVA-11: age / skin [painted lines 0…1, smoothing of the photo's baked creases 0…1, skin texture 0…1, extra
   * silver in beard and brows] (world/age.ts)
   */
  uAge: { value: THREE.Vector4 };
  /** P3-FGT-09: how much of the photo's garment texture shows through the top colour (0.85 everyday; the ring vest is smoother) */
  uTopDetail: { value: number };
  /** P3-FGT-09: sweat sheen on bare skin (0 dry … 1 soaked; the ring raises it with effort, lighting reads the form) */
  uSweat: { value: number };
}

/**
 * Facial hair (P2-AVA-08): [full beard, moustache, goatee (chin + ring round the mouth), hair density, chin strap,
 * extra length]. Density < ~0.6 reads as stubble (fine speckle with skin between), higher as hair with soft,
 * noise-broken edges. All zero for "none": nothing is painted and the base heads carry no baked beard.
 */
export const FACIAL_HAIR_PARAMS: Record<FaceLook["facialHair"], [number, number, number, number, number, number]> = {
  none: [0, 0, 0, 0, 0, 0],
  stubble: [0.9, 0.7, 0.72, 0.46, 0, 0],
  moustache: [0, 1, 0, 0.92, 0, 0],
  goatee: [0, 0.8, 0.9, 0.8, 0, 0],
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

/**
 * Render albedo of a skin swatch (linear), P2-AVA-11: medium and deep browns are pulled gently into the hue /
 * saturation band of the reference palette (AVATAR-REFERENCE-RWANDA §1: hue ≈ 19–26°, saturation ≤ 0.47), so no
 * swatch renders orange or yellow; lightness (the tone itself) is never changed, light tones are left alone.
 */
export function skinAlbedo(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const k = 1 - THREE.MathUtils.smoothstep(hsl.l, 0.56, 0.7);
  const h = THREE.MathUtils.lerp(hsl.h, THREE.MathUtils.clamp(hsl.h, 19 / 360, 26 / 360), k);
  const s = THREE.MathUtils.lerp(hsl.s, Math.min(hsl.s, 0.47), k);
  return c.setHSL(h, s, hsl.l, THREE.SRGBColorSpace);
}

/** Share of silver hairs for a hair colour (same rule as hair.ts greyAmount). */
function greyOf(hex: string): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return hsl.s > 0.18 ? 0 : THREE.MathUtils.clamp((hsl.l - 0.3) / 0.5, 0, 1);
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
  const skin = skinAlbedo(LEGACY_SKIN[look.skinTone.toUpperCase()] ?? look.skinTone);
  const ref = new THREE.Color(...meta.skinRef);
  const mul = new THREE.Vector3(skin.r / Math.max(ref.r, 0.004), skin.g / Math.max(ref.g, 0.004), skin.b / Math.max(ref.b, 0.004));
  // large tone changes amplify the dark channels' noise with a plain ratio, so fade towards luminance transfer
  // (body textures carry hands/arms whose hue drifts from the face, so the body leans on luminance transfer)
  const skinMix = Math.max(THREE.MathUtils.clamp(Math.abs(Math.log2(lum(skin) / Math.max(lum(ref), 1e-4))) / 2.2, 0, 0.85), isHead ? 0 : 0.7);
  const bottomKind = bottom?.kind;
  const ag = ageParams(look.age, look.bodyType);
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
    uHairFade: { value: look.hairStyle === "fade" || look.hairStyle === "lowfade" || look.hairStyle === "waves" || look.hairStyle === "hightop" ? 1 : 0 },
    uHairGrey: { value: Math.max(greyOf(look.hairColor), ag.beardGrey) },
    uHairColGrey: { value: greyOf(look.hairColor) },
    uAge: { value: new THREE.Vector4(ag.lines, ag.smooth, ag.texture, ag.beardGrey) },
    uFaceIpd: { value: frame ? 1 / Math.max(1e-6, Math.hypot(frame.m.elements[0]!, frame.m.elements[3]!, frame.m.elements[6]!)) : 0.0638 },
    // skirts / long wraps: the base trousers become legs (skin) below the garment mesh
    uLegsSkin: { value: bottomKind === "skirt" || bottomKind === "longwrap" ? 1 : 0 },
    uTopPrint: { value: printTex(top?.print) },
    uTopPrintOn: { value: top?.print ? 1 : 0 },
    uBottomPrint: { value: printTex(bottom?.print) },
    uBottomPrintOn: { value: bottom?.print ? 1 : 0 },
    uClothes: { value: keepClothes ? 0 : 1 },
    uTopDetail: { value: 0.85 },
    uSweat: { value: 0 },
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
uniform float uLegsSkin; uniform float uClothes; uniform float uTopDetail; uniform float uSweat;
uniform sampler2D uTopPrint; uniform float uTopPrintOn;
uniform sampler2D uBottomPrint; uniform float uBottomPrintOn;
float gkDetail(float l, float ref, float k) { return mix(1.0, pow(clamp(l / max(ref, 1e-4), 0.0, 3.5), 0.8), k); }
uniform float uFaceOn; uniform float uFaceDetail; uniform vec4 uFaceL; uniform vec3 uIris;
uniform vec4 uFH; uniform vec4 uFH2; uniform vec4 uBrow; uniform vec4 uMarks; uniform vec3 uLipTint; uniform vec4 uMakeup;
uniform float uSpecMap; uniform float uHairFade; uniform float uFaceIpd; uniform float uHairGrey; uniform vec4 uAge; uniform float uHairColGrey;
varying vec3 vGkF;
// per-fragment results shared with the roughness / normal / lighting chunks
float gkSkinW = 0.0; float gkEyeW = 0.0; float gkIrisW = 0.0; float gkBeardW = 0.0; float gkLipW = 0.0; float gkHairW = 0.0;
float gkSpec = 0.25; float gkH = 0.0; float gkAO = 1.0;
// P2-AVA-11: broad soft sheen zones (forehead, nose bridge, cheekbones) and how much of the normal map's crease band
// to remove (young, even skin)
float gkSheen = 0.0; float gkSmoothN = 0.0;
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
  gkCol = mix(gkCol, gkCol * vec3(1.02, 0.95, 0.88) * (1.0 - 0.24 * corner), sclera);
  // a deeper iris: darker towards the limbus, a faint warm ring round the pupil
  gkCol *= mix(1.0, mix(0.82, 1.1, smoothstep(0.03, 0.09, gkL) * (1.0 - smoothstep(0.1, 0.16, gkL))), iris);
  gkEyeW = eyeR;
  gkIrisW = iris;
  // ---- skin zones (AVATAR-REFERENCE-RWANDA §1): warmer / redder on the cheeks, nose and ears; a touch darker round
  // the eyes, on the upper lip and along the jaw; a touch lighter on the forehead and cheekbones (where the soft sheen
  // sits too). Broad, soft fields: they shape the face without ever reading as paint.
  {
    float nY = uFaceL.w;
    float cheekZ = 1.0 - smoothstep(0.2, 0.55, length(vec2(ax - 0.62, (q.y + 0.66) * 1.1)));
    float noseZ = 1.0 - smoothstep(0.08, 0.3, length(vec2(q.x * 1.5, (q.y - nY + 0.08) * 0.8)));
    float foreZ = smoothstep(uFaceL.z + 0.12, uFaceL.z + 0.42, q.y) * (1.0 - smoothstep(0.45, 0.9, ax));
    float boneZ = 1.0 - smoothstep(0.1, 0.3, length(vec2(ax - 0.78, (q.y + 0.36) * 1.4)));
    float bridgeZ = (1.0 - smoothstep(0.05, 0.14, ax)) * smoothstep(nY - 0.05, nY + 0.15, q.y) * (1.0 - smoothstep(0.05, 0.25, q.y));
    float eyeZ = 1.0 - smoothstep(0.16, 0.36, length(vec2((ax - 0.5) * 0.9, (q.y + 0.05) * 1.25)));
    float ulipZ = (1.0 - smoothstep(0.22, 0.45, ax)) * smoothstep(mY + 0.06, mY + 0.14, q.y) * (1.0 - smoothstep(nY - 0.12, nY - 0.02, q.y));
    float jawZ = smoothstep(0.62, 0.95, ax) * (1.0 - smoothstep(mY - 0.2, mY + 0.25, q.y));
    float earZ = smoothstep(1.05, 1.3, ax) * (1.0 - front);
    vec3 zt = mix(vec3(1.0), vec3(1.07, 0.97, 0.92), clamp(max(cheekZ * 0.9, noseZ * 0.8) + earZ * 0.7, 0.0, 1.0));
    zt *= 1.0 + 0.06 * max(foreZ, boneZ);
    zt *= 1.0 - 0.1 * eyeZ * (1.0 - eyeR) - 0.07 * ulipZ - 0.06 * jawZ;
    gkCol *= mix(vec3(1.0), zt, gkM.r);
    gkSheen = clamp(max(max(foreZ * 0.8, boneZ), max(bridgeZ, noseZ * 0.7)), 0.0, 1.0) * front * gkM.r;
  }
  // ---- age lines (P2-AVA-11, uAge.x): forehead lines, laugh lines (nose to mouth), slight under-eye creases, crow's
  // feet and, at 50+, short lines down from the mouth corners. Each is a soft groove (darker, a height dip for the
  // bump) broken by noise, widened to at least ~1.5 px (fading in strength instead) so it never shimmers.
  if (uAge.x > 0.001 && det > 0.01) {
    float lw = max(0.018, fw * 1.6);
    float la = 0.018 / lw;
    float brk = 0.55 + 0.45 * gkNoise(q.xy * 9.0 + 2.0);
    float nY = uFaceL.w;
    float g = 0.0;
    // forehead: three gently curved lines
    for (int i = 0; i < 3; i++) {
      float y0 = uFaceL.z + 0.36 + float(i) * 0.19 + 0.12 * ax * ax;
      g += exp(-pow((q.y - y0) / lw, 2.0)) * (1.0 - smoothstep(0.45, 0.85, ax)) * mix(1.0, 0.6, float(i) * 0.5);
    }
    // laugh lines: from beside the nose wing down and out to beside the mouth corner
    float t = clamp((nY - 0.08 - q.y) / max(0.2, nY - 0.08 - (mY - 0.14)), 0.0, 1.0);
    float xL = 0.3 + 0.27 * pow(t, 0.75);
    g += exp(-pow((ax - xL) / (lw * 1.4), 2.0)) * smoothstep(-0.05, 0.1, t) * (1.0 - smoothstep(0.9, 1.05, t)) * step(q.y, nY - 0.04) * 1.2;
    // under-eye crease
    float ue = q.y - (-0.27 - 0.05 + 0.5 * (ax - 0.5) * (ax - 0.5));
    g += exp(-pow(ue / lw, 2.0)) * (1.0 - smoothstep(0.14, 0.26, abs(ax - 0.52))) * 0.7;
    // crow's feet: three short rays out from the outer eye corner
    vec2 cf = vec2(ax - 0.8, q.y + 0.03);
    float ca = atan(cf.y, cf.x);
    float ray = 1.0 - smoothstep(0.1, 0.3, abs(fract(ca / 0.38 + 0.5) - 0.5) * 2.0);
    g += ray * smoothstep(0.03, 0.08, length(cf)) * (1.0 - smoothstep(0.14, 0.24, length(cf))) * step(0.0, cf.x) * 0.6;
    // 50+: lines from the mouth corners down
    float mc = ax - (0.52 + 0.08 * clamp((mY - q.y) / 0.4, 0.0, 1.0));
    g += exp(-pow(mc / lw, 2.0)) * smoothstep(mY - 0.42, mY - 0.32, q.y) * (1.0 - smoothstep(mY - 0.08, mY + 0.02, q.y)) * smoothstep(0.6, 1.0, uAge.x) * 0.8;
    float lines = clamp(g, 0.0, 1.3) * uAge.x * brk * la * det * front * gkM.r;
    gkCol *= 1.0 - 0.2 * lines;
    gkH -= lines * 1.6;
  }
  // ---- facial hair: where it may grow
  float lipE = length(vec2(q.x / 0.47, (q.y - mY) / 0.155));
  float notLips = smoothstep(0.95, 1.18, lipE + eN2 * 0.12);
  float topY = mix(mY + 0.42, -0.16, smoothstep(0.48, 1.0, ax));
  float region = (1.0 - smoothstep(topY - 0.24, topY + 0.03, q.y + jit))
    * smoothstep(mY - 1.07 - uFH2.z, mY - 0.83 - uFH2.z, q.y - jit * 0.7)
    * smoothstep(-0.62, -0.28, q.z + jit * 0.4) * (1.0 - smoothstep(1.0, 1.18, ax + jit * 0.3)) * notLips;
  // moustache: the upper lip between the mouth and the nose, drooping a little towards the corners
  float mustY = mix(mY, uFaceL.w, 0.42) - 0.26 * q.x * q.x;
  float mustH = max(0.05, (uFaceL.w - mY) * 0.19);
  float must = (1.0 - smoothstep(0.72, 1.06, length(vec2(q.x / 0.6, (q.y - mustY) / mustH)) + jit * 0.9)) * notLips;
  // goatee: chin patch + a thin ring round the mouth corners joining it to the moustache, soul patch under the lip
  // short goatee: a chin patch narrower than the mouth, a little soul patch under the lip
  float chin = 1.0 - smoothstep(0.72, 1.12, length(vec2(q.x / 0.27, (q.y - (mY - 0.44)) / 0.27)) + jit * 0.6);
  float ringD = abs(length(vec2(q.x / 0.52, (q.y - (mY - 0.12)) / 0.45)) - 1.0);
  float ring = (1.0 - smoothstep(0.05, 0.24, ringD + jit * 0.35)) * (1.0 - smoothstep(mY - 0.06, mY + 0.1, q.y));
  float goat = max(chin, ring * 0.5) * notLips;
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
  // patchy growth for stubble; full beards / goatees grow dense with only a soft variation (P2-AVA-10)
  float patchy = mix(0.62 + 0.38 * gkNoise(q.xy * 5.0 + 4.2), 0.86 + 0.14 * gkNoise(q.xy * 5.0 + 4.2), smoothstep(0.7, 0.95, uFH.w));
  float dens = cover * uFH.w * patchy;
  // near: strands pass a density threshold (sparse speckle for stubble, dense for beards); far: the mean coverage
  float fine = clamp(1.4 - fw * 34.0 * 1.6, 0.0, 1.0) * det;
  float aNear = clamp((sv - (1.0 - dens) * 0.9) * 3.0, 0.0, 1.0) * smoothstep(0.0, 0.3, dens);
  float aFar = smoothstep(0.0, 0.85, dens) * 0.74;
  float beardA = mix(aFar, aNear * 0.9, fine) * (0.85 + 0.15 * clump);
  // the skin under a beard / stubble is darker (follicles, shadow between hairs): stubble reads mostly as this
  // (stubble: a slight shadow of the hair under the skin)
  float shade = smoothstep(0.0, 0.75, cover) * patchy * mix(0.22, 0.2, smoothstep(0.45, 0.9, uFH.w)) * step(0.001, uFH.w);
  gkCol = mix(gkCol, gkCol * vec3(0.93, 0.94, 0.96), shade * (1.0 - smoothstep(0.6, 0.9, uFH.w)));
  gkCol *= 1.0 - shade * (0.75 + 0.25 * clump);
  vec3 hairC = max(uHair * 1.6, vec3(0.016, 0.012, 0.0105)) * (0.7 + 0.6 * clump) * (0.75 + 0.5 * sv);
  if (uHairGrey > 0.001) {
    // salt-and-pepper: dark hairs with silver ones among them (per hair, not a flat grey)
    float gsel = step(gkHash(floor(gp * vec2(60.0, 16.0)) + 2.3), uHairGrey);
    hairC = mix(vec3(0.02, 0.017, 0.015) * (0.7 + 0.6 * clump), vec3(0.22, 0.215, 0.21) * (0.8 + 0.4 * sv), gsel);
  }
  gkCol = mix(gkCol, hairC, clamp(beardA, 0.0, 0.9));
  // stubble: short hairs growing out of follicles (a jittered ~1.5 mm grid along the growth direction), each a
  // short dark dash; below a pixel they fade into their mean darkening
  float stub = (1.0 - smoothstep(0.55, 0.75, uFH.w)) * step(0.001, uFH.w);
  if (stub > 0.0) {
    vec2 fc = gp * 44.0;
    vec2 fid = floor(fc);
    vec2 fo = vec2(gkHash(fid + 1.3), gkHash(fid + 7.9)) - 0.5;
    vec2 fr = fract(fc) - 0.5 - fo * 0.55;
    float hairDot = (1.0 - smoothstep(0.1, 0.24, length(vec2(fr.x, fr.y * 0.5)))) * step(gkHash(fid + 3.1), 0.45 + 0.5 * cover * patchy);
    float fAA = clamp(1.4 - fw * 44.0 * 1.6, 0.0, 1.0) * det;
    float stubA = mix(0.1 * cover * patchy, hairDot * 0.8 * smoothstep(0.05, 0.4, cover), fAA) * stub;
    gkCol = mix(gkCol, hairC * 0.9, stubA);
    gkH += hairDot * fAA * stub * cover * 0.5;
  }
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
  // grey hair colours: dark brow hairs with silver ones among them (never a flat white brow); with age some brow
  // hairs turn silver too
  vec3 browC = (uHairColGrey > 0.001 ? vec3(0.018, 0.015, 0.013) : max(uHair * 1.3, vec3(0.012, 0.009, 0.008))) * (0.8 + 0.4 * bs);
  browC = mix(browC, vec3(0.26, 0.25, 0.24) * (0.8 + 0.4 * bs), step(gkHash(floor(bp * vec2(105.0, 26.0)) + 5.5), max(uAge.w * 0.5, uHairColGrey * 0.55)));
  gkCol = mix(gkCol, browC, clamp(browA, 0.0, 1.0) * front * skinish);
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
    vec3 nat = uSkin * mix(vec3(1.0, 0.79, 0.74), vec3(0.88, 0.68, 0.7), dark);
    // keep the photo's lip shading but squeeze it round the skin's own brightness (a touch darker on dark skin)
    float lt = ls * mix(0.98, 0.84, dark) * pow(clamp(l0 / max(ls, 1e-4), 0.2, 4.0), 0.45);
    nat *= lt / max(dot(nat, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    gkCol = mix(gkCol, nat, 0.72 * gkLipW);
    l0 = mix(l0, lt, 0.72 * gkLipW);
    // the upper lip sits in its own shade and is naturally a little darker than the lower one
    float up = smoothstep(mY - 0.015, mY + 0.035, q.y) * gkLipW;
    gkCol *= 1.0 - 0.16 * up;
    l0 *= 1.0 - 0.16 * up;
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
  if (uIsHead > 0.5 && uFaceOn > 0.5 && uAge.y + uAge.z > 0.001) {
    // even skin (P2-AVA-11): the base photos carry their models' own creases, frown lines and blotches (the masculine
    // one frowns). Split the skin's brightness into bands with the texture's mip chain: pores (finer than ~2 texels)
    // stay, the crease / blotch band (~2–24 texels) is mostly removed (uAge.y; less with age), the broad form (eye
    // sockets, cheek planes) is softened a little. Only well inside the skin (the mask's blurred skin share) and away
    // from the lips, so no halos at the hairline, brows, eyes or mouth.
    float gkL1 = dot(textureLod(map, vMapUv, 1.2).rgb, vec3(0.2126, 0.7152, 0.0722));
    float gkL4 = dot(textureLod(map, vMapUv, 4.6).rgb, vec3(0.2126, 0.7152, 0.0722));
    vec4 gkMm = textureLod(uMask, vMapUv, 3.6);
    vec3 gkQ = vGkF;
    float gkLipX = length(vec2(gkQ.x / 0.5, (gkQ.y - uFaceL.x) / 0.2));
    float gkCov = smoothstep(0.8, 0.97, gkMm.r) * (1.0 - smoothstep(0.04, 0.2, gkMm.g)) * smoothstep(1.0, 1.35, gkLipX) * gkM.r;
    // strongest where the base photos carry expression creases (forehead, between the brows, nose-to-mouth folds),
    // lighter elsewhere so the face keeps its natural unevenness
    float gkAx = abs(gkQ.x);
    float gkCrease = max(smoothstep(uFaceL.z - 0.1, uFaceL.z + 0.15, gkQ.y) * (1.0 - smoothstep(0.55, 0.9, gkAx)),
      (1.0 - smoothstep(0.15, 0.3, abs(gkAx - 0.42))) * smoothstep(uFaceL.x - 0.25, uFaceL.x - 0.05, gkQ.y) * (1.0 - smoothstep(uFaceL.w - 0.1, uFaceL.w + 0.05, gkQ.y)));
    float gkK = uAge.y * gkCov * mix(0.62, 1.0, gkCrease);
    float gkBand = clamp(gkL1 / max(gkL4, 1e-4), 0.3, 3.0);
    float gkPore = clamp(gkL / max(gkL1, 1e-4), 0.3, 3.0);
    float gkLn = max(gkL4, 1e-5) * pow(gkBand, 1.0 - 0.82 * gkK) * pow(gkPore, 1.0 + 0.35 * uAge.z * gkCov);
    // keep the low band's level but damp its contrast around the skin reference (soft, even planes)
    gkLn *= pow(max(gkL4, 1e-5) / max(uSkinRef, 1e-4), -0.14 * gkK);
    gkSmoothN = gkK;
    gkBase *= gkLn / max(gkL, 1e-5);
    gkL = gkLn;
  }
  vec3 gkSkinCol = mix(gkBase * uSkinMul, uSkin * gkDetail(gkL, uSkinRef, 0.9), uSkinMix);
  vec3 gkCol = mix(gkBase, gkSkinCol, gkM.r);
  if (uSpecMap > 0.5) gkSpec = gkM.a;
  if (uIsHead > 0.5) {
    // scalp hair: a noise-broken hairline (no painted edge), more depth in the photo's own strands / curls
    float gkHn = gkNoise(vMapUv * 900.0) - 0.5;
    float gkHair = clamp(gkM.g + gkHn * 1.2 * gkM.g * (1.0 - gkM.g) * 4.0, 0.0, 1.0);
    // grey colours: pepper-and-silver per strand (a flat light grey showed as white patches at the nape / temples)
    vec3 gkHairBase = uHairColGrey > 0.001 ? mix(vec3(0.016, 0.014, 0.012), vec3(0.28, 0.27, 0.26), step(gkHash(floor(vMapUv * 760.0) + 1.7), uHairColGrey * (uFaceOn > 0.5 && vGkF.y < uFaceL.z + 0.4 && vGkF.z > -0.3 ? 0.4 : 1.0))) : max(uHair, vec3(0.011, 0.0095, 0.0085));
    vec3 gkHairCol = mix(gkHairBase * gkDetail(gkL, uHairRef, 0.95), mix(uSkin, vec3(dot(uSkin, vec3(0.2126, 0.7152, 0.0722))), 0.3) * gkDetail(gkL, uHairRef, 0.1) * 0.66, uHairToSkin);
    gkCol = mix(gkCol, gkHairCol, gkHair);
    // baby hairs: just outside the hairline the skin carries a faint, fine darkening
    float gkNearHair = texture2D(uMask, vMapUv, 2.5).g;
    float gkBaby = clamp(gkNearHair - gkM.g, 0.0, 1.0) * gkM.r * (1.0 - uHairToSkin);
    gkCol = mix(gkCol, gkHairCol, gkBaby * 0.45 * step(0.55, gkNoise(vMapUv * 1400.0)));
    if (uHairFade > 0.5 && uFaceOn > 0.5) {
      vec3 gkFm = vGkF * uFaceIpd;
      float gkSide = smoothstep(0.035, 0.07, -gkFm.z);
      float gkBack = smoothstep(0.1, 0.17, -gkFm.z);
      float gkY0 = mix(0.014, -0.034, gkBack);
      float gkFade = gkSide * (1.0 - smoothstep(gkY0, gkY0 + 0.056, gkFm.y));
      // shaved: the skin with a faint shadow of the hair under it
      vec3 gkShave = mix(uSkin, vec3(dot(uSkin, vec3(0.2126, 0.7152, 0.0722))), 0.25) * 0.7 * (0.92 + 0.16 * gkNoise(vMapUv * 700.0));
      gkCol = mix(gkCol, gkShave, gkFade * gkHair * 0.95);
      gkHair *= 1.0 - gkFade * 0.95;
    }
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
    gkCol = mix(gkCol, gkTopC * gkDetail(gkL, uTopRef, uTopDetail), gkM.g * uClothes);
    gkCol = mix(gkCol, gkBotC, gkM.b * uClothes);
    float gkShoe = clamp(1.0 - gkM.r - gkM.g - gkM.b, 0.0, 1.0);
    gkCol = mix(gkCol, min(uShoes * gkDetail(gkL, uShoesRef, 0.85), vec3(0.7)), gkShoe * uClothes);
  }
  gkSkinW = clamp(gkM.r * (1.0 - gkM.g) + gkM.g * uHairToSkin, 0.0, 1.0) * (1.0 - gkBeardW * 0.7);
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
  roughnessFactor = mix(roughnessFactor, uSpecMap > 0.5 ? mix(0.78, 0.6, gkGloss) : 0.68, clamp(gkM2.r + gkM2.g * uHairToSkin, 0.0, 1.0));
  if (uIsHead < 0.5) roughnessFactor = mix(roughnessFactor, 0.75, clamp(1.0 - gkM2.r - gkM2.g - gkM2.b, 0.0, 1.0));
  // ring sweat (P3-FGT-09): bare skin turns satin, so the key / rim light catches the shoulders, arms and back
  roughnessFactor -= uSweat * 0.34 * gkM2.r * (1.0 - gkM2.g);
  if (uIsHead > 0.5) {
    // soft, broad sheen on the forehead, nose bridge and cheekbones (a little more on deep skin, which needs it to
    // read its form); still matte overall, never glare (P2-AVA-11)
    float gkDeep = clamp(1.0 - dot(uSkin, vec3(0.2126, 0.7152, 0.0722)) * 6.0, 0.0, 1.0);
    roughnessFactor -= gkSheen * mix(0.06, 0.1, gkDeep) * (1.0 - gkBeardW);
    roughnessFactor = mix(roughnessFactor, 0.66, gkHairW);
    roughnessFactor = mix(roughnessFactor, 0.82, gkBeardW);
    roughnessFactor = mix(roughnessFactor, uMakeup.z > 0.5 ? 0.36 : 0.7, gkLipW);
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

/**
 * Normal map: the same crease band the albedo loses (RECOLOUR, gkSmoothN) is taken out of the photo normal map too,
 * so a young face has no baked frown / laugh-line relief left; pores and the broad form stay.
 */
const NRM_FROM = "mapN.xy *= normalScale;";
const NRM_TO = /* glsl */ `
mapN.xy *= normalScale;
if (gkSmoothN > 0.001) {
  vec2 gkN1 = textureLod(normalMap, vNormalMapUv, 1.2).xy * 2.0 - 1.0;
  vec2 gkN4 = textureLod(normalMap, vNormalMapUv, 4.6).xy * 2.0 - 1.0;
  mapN.xy -= (gkN1 - gkN4) * normalScale * 0.8 * gkSmoothN;
}
`;

/** Specular strength: skin F0 ≈ 0.028 (not the plastic 0.04), less on matte areas; hair ≈ 0.046. */
const SPEC = /* glsl */ `
#include <lights_physical_fragment>
{
  float gkF = mix(1.0, mix(0.55, 0.85, max(smoothstep(0.04, 0.42, gkSpec), gkSheen * 0.8)), gkSkinW);
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
        .replace("#include <normal_fragment_maps>", BUMP.replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace(NRM_FROM, NRM_TO)))
        .replace("#include <lights_physical_fragment>", SPEC)
        .replace("#include <lights_fragment_end>", WARM);
  };
  m.customProgramCacheKey = () => "gk-human-look-4";
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
