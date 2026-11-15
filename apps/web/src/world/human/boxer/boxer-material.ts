import * as THREE from "three";

/**
 * One material for a whole ring person (P3-FGT-13, docs/FIGHT-REALISM-V3.md §3): the body, the kit and the face are
 * one skinned mesh and one draw call; each vertex carries a material slot (`_mat`, the palette below), a cavity term
 * (`_ao`: muscle separations, creases), a hit zone (`_zone`: 1 head, 2 torso) and face paint (`_paint`: lips, brows,
 * eye sockets, beard). On top of MeshStandardMaterial:
 *  - skin: a subsurface approximation (warm wrap / back-scatter at grazing angles), sweat that makes the skin glossier
 *    as it builds, a little redness where punches land (head / torso; never blood, never injury);
 *  - musculature: the cavity field drives a soft bump (definition between muscles) and a little occlusion;
 *  - fabric: satin trunks get a sheen, the vest a fine weave, leather gloves / headgear / boots a tight highlight;
 *  - eyes: sclera, iris (the player's eye colour) and pupil from the eyeball's own bind-space position.
 */
export const SLOT = {
  skin: 0,
  vest: 1,
  vestTrim: 2,
  trunks: 3,
  trunksTrim: 4,
  boot: 5,
  sole: 6,
  lace: 7,
  glove: 8,
  gloveTarget: 9,
  gloveCuff: 10,
  headgear: 11,
  headgearTrim: 12,
  wrap: 13,
  shirt: 14,
  trousers: 15,
  shoe: 16,
  bowtie: 17,
  polo: 18,
  hair: 19,
  eye: 20,
  lash: 21,
  teeth: 22,
  sock: 23,
  belt: 24,
} as const;
export const SLOTS = 25;

/** roughness and sheen per slot (fixed); colours are uniforms */
const ROUGH: number[] = [0.52, 0.66, 0.6, 0.3, 0.32, 0.38, 0.75, 0.8, 0.34, 0.4, 0.42, 0.46, 0.5, 0.85, 0.72, 0.62, 0.3, 0.45, 0.7, 0.62, 0.08, 0.9, 0.35, 0.85, 0.35];
const SHEEN: number[] = [0, 0.05, 0.05, 0.55, 0.45, 0.12, 0, 0, 0.2, 0.15, 0.15, 0.12, 0.1, 0, 0.04, 0.05, 0.25, 0.3, 0.04, 0.15, 0, 0, 0, 0, 0.2];

export interface BoxerColors {
  skin: string;
  hair: string;
  iris: string;
  /** kit: vest / trunks / gloves / headgear in the corner colour, trim white */
  kit?: string;
  trim?: string;
  polo?: string;
}

export interface BoxerUniforms {
  uCol: { value: THREE.Color[] };
  uRough: { value: number[] };
  uSheen: { value: number[] };
  uSweat: { value: number };
  uRed: { value: THREE.Vector2 };
  uHair: { value: THREE.Color };
  uIris: { value: THREE.Color };
  uBeard: { value: number };
  uBrow: { value: number };
  uEyeL: { value: THREE.Vector3 };
  uEyeR: { value: THREE.Vector3 };
  uDetail: { value: number };
  uKit: { value: THREE.Vector4 };
}

const c = (hex: string) => new THREE.Color(hex);
/** a darker / lighter shade of a colour (sRGB space multiply) */
const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

export function boxerPalette(col: BoxerColors): THREE.Color[] {
  const kit = col.kit ?? "#B3282D";
  const trim = col.trim ?? "#F2F2EE";
  const p: THREE.Color[] = new Array(SLOTS).fill(0).map(() => c("#888888"));
  p[SLOT.skin] = c(col.skin);
  p[SLOT.vest] = c(kit);
  p[SLOT.vestTrim] = c(trim);
  p[SLOT.trunks] = shade(kit, 0.92);
  p[SLOT.trunksTrim] = c(trim);
  p[SLOT.boot] = c("#161616");
  p[SLOT.sole] = c("#d8d4cc");
  p[SLOT.lace] = c("#f0efea");
  p[SLOT.glove] = c(kit);
  p[SLOT.gloveTarget] = c("#f4f2ec");
  p[SLOT.gloveCuff] = shade(kit, 0.82);
  p[SLOT.headgear] = c(kit);
  p[SLOT.headgearTrim] = shade(kit, 0.6);
  p[SLOT.wrap] = c("#ece9e2");
  p[SLOT.shirt] = c("#f4f4f2");
  p[SLOT.trousers] = c("#151517");
  p[SLOT.shoe] = c("#0c0c0d");
  p[SLOT.bowtie] = c("#0b0b0c");
  p[SLOT.polo] = c(col.polo ?? "#5a3826");
  p[SLOT.hair] = c(col.hair);
  p[SLOT.eye] = c("#f1eee8");
  p[SLOT.lash] = c("#0d0b0a");
  p[SLOT.teeth] = c("#e9e4d8");
  p[SLOT.sock] = c("#f2f1ec");
  p[SLOT.belt] = c("#1b1410");
  return p;
}

export function boxerMaterial(col: BoxerColors, eyes: { L: THREE.Vector3; R: THREE.Vector3 }, face: { beard: number; brow: number }, kit: readonly number[] = [0.1, 0.85, 1.05, 0.62]): THREE.MeshStandardMaterial & { userData: { u: BoxerUniforms } } {
  const u: BoxerUniforms = {
    uCol: { value: boxerPalette(col) },
    uRough: { value: ROUGH },
    uSheen: { value: SHEEN },
    uSweat: { value: 0.3 },
    uRed: { value: new THREE.Vector2(0, 0) },
    uHair: { value: c(col.hair) },
    uIris: { value: c(col.iris) },
    uBeard: { value: face.beard },
    uBrow: { value: face.brow },
    uEyeL: { value: eyes.L.clone() },
    uEyeR: { value: eyes.R.clone() },
    uDetail: { value: 1 },
    uKit: { value: new THREE.Vector4(kit[0], kit[1], kit[2], kit[3]) },
  };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 }) as THREE.MeshStandardMaterial & { userData: { u: BoxerUniforms } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float _mat;
attribute float _ao;
attribute float _zone;
attribute vec4 _paint;
flat varying float vMat;
varying float vAo;
varying float vZone;
varying vec4 vPaint;
varying vec3 vBind;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vMat = _mat;
vAo = _ao;
vZone = _zone;
vPaint = _paint;
vBind = position;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uCol[${SLOTS}];
uniform float uRough[${SLOTS}];
uniform float uSheen[${SLOTS}];
uniform float uSweat;
uniform vec2 uRed;
uniform vec3 uHair;
uniform vec3 uIris;
uniform float uBeard;
uniform float uBrow;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform float uDetail;
uniform vec4 uKit;
flat varying float vMat;
varying float vAo;
varying float vZone;
varying vec4 vPaint;
varying vec3 vBind;
float gkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gkNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gkHash(i), gkHash(i + vec3(1,0,0)), f.x), mix(gkHash(i + vec3(0,1,0)), gkHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gkHash(i + vec3(0,0,1)), gkHash(i + vec3(1,0,1)), f.x), mix(gkHash(i + vec3(0,1,1)), gkHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 gkPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
int gkSlot() { return int(vMat + 0.5); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
int gkM = gkSlot();
vec3 gkBase = uCol[0];
for (int k = 0; k < ${SLOTS}; k++) { if (k == gkM) gkBase = uCol[k]; }
if (gkM == 0) {
  // skin: lips, brows, eye sockets, stubble; redness where punches landed
  gkBase = mix(gkBase, gkBase * vec3(0.66, 0.42, 0.42) + vec3(0.05, 0.0, 0.0), vPaint.x * 0.8);
  gkBase = mix(gkBase, uHair * 0.55, clamp(vPaint.y * uBrow, 0.0, 1.0) * 0.92);
  gkBase *= 1.0 - 0.22 * vPaint.z;
  float stub = vPaint.w * uBeard * (0.75 + 0.25 * gkNoise(vBind * 900.0));
  gkBase = mix(gkBase, uHair * 0.5 + gkBase * 0.35, clamp(stub, 0.0, 1.0) * 0.7);
  float red = vZone > 1.5 ? uRed.y : (vZone > 0.5 ? uRed.x : 0.0);
  gkBase = mix(gkBase, gkBase * vec3(1.28, 0.72, 0.7), red * 0.55);
  gkBase *= mix(0.8, 1.05, vAo);
} else if (gkM == 20) {
  // eyeball: sclera, iris, pupil from the bind-space direction off the eye's centre
  vec3 ec = vBind.x > 0.0 ? uEyeL : uEyeR;
  vec3 d = normalize(vBind - ec);
  float a = acos(clamp(d.z, -1.0, 1.0));
  vec3 iris = uIris * (0.75 + 0.5 * gkNoise(d * 40.0));
  gkBase = a < 0.42 ? (a < 0.17 ? vec3(0.02) : mix(iris, iris * 0.5, smoothstep(0.32, 0.42, a))) : gkBase;
} else if (gkM == 3) {
  // trunks: a white waistband, and a white stripe down the outside of each leg (over the hip above the crotch)
  float ax = abs(vBind.x);
  float cx = vBind.y > uKit.y ? 0.0 : uKit.x;
  float cs = (ax - cx) / max(1e-4, length(vec2(ax - cx, vBind.z * (vBind.y > uKit.y ? 1.35 : 1.0))));
  float stripe = smoothstep(0.9, 0.93, cs);
  float band = smoothstep(uKit.z - 0.062, uKit.z - 0.058, vBind.y);
  gkBase = mix(gkBase, uCol[4], max(stripe, band));
  gkBase *= mix(0.86, 1.03, vAo);
} else if (gkM == 19) {
  gkBase *= 0.8 + 0.4 * gkNoise(vBind * vec3(300.0, 60.0, 300.0));
} else {
  gkBase *= mix(0.86, 1.03, vAo);
}
diffuseColor.rgb = gkBase;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float gkR = 0.6;
float gkSh = 0.0;
for (int k = 0; k < ${SLOTS}; k++) { if (k == gkM) { gkR = uRough[k]; gkSh = uSheen[k]; } }
if (gkM == 0) gkR = mix(gkR, 0.24, uSweat);
roughnessFactor = gkR;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  // muscle definition from the cavity field, fine detail (pores / weave / grain) up close
  float h = vAo * (gkM == 0 ? 0.035 : 0.012);
  float fine = 0.0;
  if (gkM == 0) fine = gkNoise(vBind * 700.0) * 0.0012;
  else if (gkM == 1 || gkM == 14 || gkM == 18 || gkM == 15) fine = gkNoise(vBind * vec3(1400.0, 1400.0, 1400.0)) * 0.0009;
  else if (gkM == 8 || gkM == 11 || gkM == 5) fine = gkNoise(vBind * 500.0) * 0.0007;
  h += fine * uDetail;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  normal = gkPerturb(-vViewPosition, normal, dh, faceDirection);
}`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
{
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(dot(normal, V), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 3.0);
  if (gkM == 0) {
    // subsurface: light bleeding through at grazing angles, warm (blood under the skin)
    reflectedLight.indirectDiffuse += gkBase * vec3(0.55, 0.16, 0.1) * rim * 0.55;
    reflectedLight.directDiffuse *= vec3(1.04, 0.98, 0.96);
  }
  // satin / leather sheen
  reflectedLight.indirectSpecular += gkBase * gkSh * rim * 0.9;
}`,
      );
  };
  m.customProgramCacheKey = () => "gk-boxer-v1";
  return m;
}
