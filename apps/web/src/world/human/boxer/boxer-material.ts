import * as THREE from "three";

/**
 * One material for a whole ring person (P3-FGT-13, docs/FIGHT-REALISM-V3.md §3; realism pass P3-FGT-15,
 * docs/HUMAN-REALISM.md): the body, the kit and the face are one skinned mesh and one draw call; each vertex carries a
 * material slot (`_mat`, the palette below), a cavity term (`_ao`), a hit zone (`_zone`: 1 head, 2 torso), face paint
 * (`_paint`: lips, brows, eye sockets, beard) and (P3-FGT-15) MakeHuman's uv layout. On top of MeshPhysicalMaterial:
 *  - skin: a photo-sourced skin texture (MakeHuman CC0 skins) stored RELATIVE to its mean colour, so the avatar's skin
 *    tone is applied here and keeps the pores, freckles, the redness of lips / cheeks / knuckles and darker creases;
 *    its fine height as bump; a tiling micro-normal (pores, micro-wrinkles) up close; two specular lobes (the skin's
 *    rough sheen + a thin, sharper "oil / sweat" lobe through the clearcoat that grows with sweat); a subsurface
 *    approximation (warm, deep-red light at the terminator and grazing angles, shadows that do not go grey);
 *    redness where punches land (head / torso; never blood, never injury);
 *  - eyes: the MakeHuman eye texture (veined sclera, photographic iris tinted with the player's eye colour, pupil)
 *    under a wet cornea (clearcoat);
 *  - fabric: knit micro-normal on jersey (vest, polo, shirt), satin sheen on the trunks (physical sheen), leather
 *    sheen on gloves / headgear / boots;
 *  - first person: `uHide` cuts away everything within a sphere around the head (bind space), so the camera can sit in
 *    the eyes and the player sees their own arms, gloves, body and legs (fight/camera.tsx).
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
const ROUGH: number[] = [0.56, 0.74, 0.7, 0.48, 0.5, 0.5, 0.75, 0.8, 0.64, 0.62, 0.66, 0.64, 0.66, 0.88, 0.74, 0.66, 0.32, 0.45, 0.74, 0.82, 0.05, 0.9, 0.3, 0.88, 0.38];
const SHEEN: number[] = [0, 0.18, 0.12, 0.55, 0.45, 0.12, 0, 0, 0.12, 0.1, 0.12, 0.12, 0.1, 0.25, 0.2, 0.15, 0.25, 0.4, 0.2, 0.3, 0, 0, 0, 0.3, 0.2];

export interface BoxerColors {
  skin: string;
  hair: string;
  iris: string;
  /** kit: vest / trunks / gloves / headgear in the corner colour, trim white */
  kit?: string;
  trim?: string;
  polo?: string;
  /** trousers colour (referee / staff black; an everyday person's own) */
  trousers?: string;
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
  /** P3-FGT-15: skin texture (relative colour + fine height), detail tile (pores / knit), iris texture */
  uSkinMap: { value: THREE.Texture | null };
  uDetailMap: { value: THREE.Texture | null };
  uIrisMap: { value: THREE.Texture | null };
  /** 1 when the textures are bound (0: the flat P3-FGT-13 look, e.g. before they load) */
  uTex: { value: number };
  /** first person: bind-space sphere (xyz centre, w radius; w = 0 off) whose fragments are not drawn */
  uHide: { value: THREE.Vector4 };
  /** first person: above this bind height (shoulders, upper chest, neck) nothing nearer the camera than y m is drawn */
  uNearCut: { value: THREE.Vector2 };
  /** flushed face 0…1 (effort, heat), separate from the hit redness */
  uFlush: { value: number };
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
  p[SLOT.vestTrim] = col.trim ? c(col.trim) : shade(kit, 0.62);
  p[SLOT.trunks] = shade(kit, 0.92);
  p[SLOT.trunksTrim] = c(trim);
  p[SLOT.boot] = c("#161616");
  p[SLOT.sole] = c("#d8d4cc");
  p[SLOT.lace] = c("#f0efea");
  p[SLOT.glove] = c(kit);
  p[SLOT.gloveTarget] = shade(kit, 0.96);
  p[SLOT.gloveCuff] = shade(kit, 0.82);
  p[SLOT.headgear] = c(kit);
  p[SLOT.headgearTrim] = shade(kit, 0.6);
  p[SLOT.wrap] = c("#ece9e2");
  p[SLOT.shirt] = c("#f4f4f2");
  p[SLOT.trousers] = c(col.trousers ?? "#151517");
  p[SLOT.shoe] = c("#0c0c0d");
  p[SLOT.bowtie] = c("#0b0b0c");
  p[SLOT.polo] = c(col.polo ?? "#5a3826");
  p[SLOT.hair] = c(col.hair);
  p[SLOT.eye] = c("#f1eee8");
  p[SLOT.lash] = c("#231a15");
  p[SLOT.teeth] = c("#e9e4d8");
  p[SLOT.sock] = c("#f2f1ec");
  p[SLOT.belt] = c("#1b1410");
  return p;
}

/** the human textures (shared by every ring person; 1K on phones / Lite): loaded once, on first use */
const TEX: Partial<Record<string, THREE.Texture>> = {};
export const HUMAN_TEX = {
  skin: (g: "m" | "f", lite: boolean) => `/assets/characters/skin-${g}${lite ? "-1k" : ""}.webp`,
  detail: "/assets/characters/human-detail.webp",
  iris: "/assets/characters/eye-iris.webp",
};
function tex(url: string, repeat: boolean, onLoad: () => void): THREE.Texture {
  const hit = TEX[url];
  if (hit) {
    if (hit.image) queueMicrotask(onLoad);
    else (hit.userData.wait as (() => void)[]).push(onLoad);
    return hit;
  }
  const t = new THREE.TextureLoader().load(url, () => {
    for (const f of t.userData.wait as (() => void)[]) f();
    t.userData.wait = [];
  });
  t.userData.wait = [onLoad];
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  TEX[url] = t;
  return t;
}

export function boxerMaterial(
  col: BoxerColors,
  eyes: { L: THREE.Vector3; R: THREE.Vector3 },
  face: { beard: number; brow: number },
  kit: readonly number[] = [0.1, 0.85, 1.05, 0.62],
  opts: { gender?: "m" | "f"; lite?: boolean } = {},
): THREE.MeshPhysicalMaterial & { userData: { u: BoxerUniforms } } {
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
    uSkinMap: { value: null },
    uDetailMap: { value: null },
    uIrisMap: { value: null },
    uTex: { value: 0 },
    uHide: { value: new THREE.Vector4(0, 0, 0, 0) },
    uNearCut: { value: new THREE.Vector2(0, 0) },
    uFlush: { value: 0 },
  };
  if (typeof window !== "undefined") {
    let n = 0;
    const done = () => {
      n++;
      if (n >= 3) u.uTex.value = 1;
    };
    u.uSkinMap.value = tex(HUMAN_TEX.skin(opts.gender ?? "m", !!opts.lite), false, done);
    u.uDetailMap.value = tex(HUMAN_TEX.detail, true, done);
    u.uIrisMap.value = tex(HUMAN_TEX.iris, false, done);
  }
  // clearcoat / sheen switched on (their per-fragment strength is set per slot below)
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.3, sheen: 1, sheenRoughness: 0.5, sheenColor: 0xffffff }) as THREE.MeshPhysicalMaterial & { userData: { u: BoxerUniforms } };
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
varying vec3 vBind;
varying vec2 vGkUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vMat = _mat;
vAo = _ao;
vZone = _zone;
vPaint = _paint;
vBind = position;
vGkUv = uv;`,
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
uniform sampler2D uSkinMap;
uniform sampler2D uDetailMap;
uniform sampler2D uIrisMap;
uniform float uTex;
uniform vec4 uHide;
uniform vec2 uNearCut;
uniform float uFlush;
flat varying float vMat;
varying float vAo;
varying float vZone;
varying vec4 vPaint;
varying vec3 vBind;
varying vec2 vGkUv;
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
// a tangent-space detail normal (xy) on the uv frame (no tangents stored: derivatives, like three's normal maps)
vec3 gkDetailN(vec3 n, vec3 pos, vec2 uvq, vec2 dn, float k) {
  vec3 q0 = dFdx(pos); vec3 q1 = dFdy(pos);
  vec2 st0 = dFdx(uvq); vec2 st1 = dFdy(uvq);
  vec3 q1perp = cross(q1, n); vec3 q0perp = cross(n, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(n + (T * dn.x + B * dn.y) * sc * k);
}
int gkSlot() { return int(vMat + 0.5); }
bool gkIsLeather(int s) { return s == 5 || (s >= 8 && s <= 12) || s == 16; }
vec4 gkSkin;
float gkHairy;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (uHide.w > 0.0 && distance(vBind, uHide.xyz) < uHide.w) discard;
{
  // first person: my own headgear, hair, eyes, lashes and teeth are never drawn (they reached the lens past the hide
  // sphere in hooks and when looking down: QA-HUM-01)
  int gkF = int(vMat + 0.5);
  if (uHide.w > 0.0 && (gkF == 11 || gkF == 12 || (gkF >= 19 && gkF <= 22))) discard;
}
if (uNearCut.y > 0.0 && vBind.y > uNearCut.x && length(vViewPosition) < uNearCut.y) discard;
{
  int gkS = int(vMat + 0.5);
  // the hairline thins out strand by strand (the shell's _ao = distance from the hairline); lashes are strands too
  if (gkS == 19 && gkNoise(vBind * vec3(3200.0, 1400.0, 3200.0)) > min(0.62, vAo * vAo * 0.9)) discard;
  // lashes: the upper lid's only (the lower lash helper read as a dark comb under the eye), fine sparse strands
  if (gkS == 21 && (vBind.y < (vBind.x > 0.0 ? uEyeL.y : uEyeR.y) || gkNoise(vec3(vBind.x * 4200.0, vBind.y * 400.0, 0.0)) < 0.66)) discard;
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
int gkM = gkSlot();
vec3 gkBase = uCol[0];
for (int k = 0; k < ${SLOTS}; k++) { if (k == gkM) gkBase = uCol[k]; }
gkSkin = vec4(0.5);
gkHairy = 0.0;
if (gkM == 0) {
  // skin: the tone x the photo skin's relative variation (in sRGB: ratio^2.2 in linear), its chroma eased on darker
  // tones (a light skin's pink lips / cheeks become a deeper, browner flush on dark skin, as on real dark skin)
  float tl = dot(gkBase, vec3(0.2126, 0.7152, 0.0722));
  if (uTex > 0.5) {
    gkSkin = texture2D(uSkinMap, vGkUv);
    vec3 ratio = gkSkin.rgb * 2.0;
    float dark = clamp(1.0 - tl / 0.22, 0.0, 1.0);
    ratio = mix(ratio, vec3(dot(ratio, vec3(0.3, 0.55, 0.15))), 0.5 * dark);
    float rl = max(dot(ratio, vec3(0.3, 0.55, 0.15)), 1e-3);
    // the close-cropped hair painted on the scalp (much darker than the skin, on the head): the player's hair colour,
    // matte (no skin sheen on hair)
    gkHairy = vZone > 0.5 && vZone < 1.5 ? clamp((0.42 - rl) / 0.2, 0.0, 1.0) : 0.0;
    gkBase *= pow(rl, 2.2) * mix(vec3(1.0), ratio / rl, 0.75);
    gkBase = mix(gkBase, gkBase * vec3(0.78, 0.5, 0.48), vPaint.x * 0.35 * (1.0 - dark * 0.4));
    gkBase = mix(gkBase, uHair * (0.35 + 0.9 * rl), gkHairy * 0.85);
  } else {
    gkBase = mix(gkBase, gkBase * vec3(0.66, 0.42, 0.42) + vec3(0.05, 0.0, 0.0), vPaint.x * 0.8);
  }
  // brows, eye sockets, stubble; a flushed face with effort; redness where punches landed
  gkBase = mix(gkBase, uHair * 0.55, clamp(vPaint.y * uBrow, 0.0, 1.0) * 0.92);
  gkBase *= 1.0 - 0.18 * vPaint.z;
  float stub = vPaint.w * uBeard * (0.75 + 0.25 * gkNoise(vBind * 900.0));
  gkBase = mix(gkBase, uHair * 0.5 + gkBase * 0.35, clamp(stub, 0.0, 1.0) * 0.7);
  float red = vZone > 1.5 ? uRed.y : (vZone > 0.5 ? max(uRed.x, uFlush * 0.35) : 0.0);
  gkBase = mix(gkBase, gkBase * vec3(1.3, 0.74, 0.7), red * 0.5);
  gkBase *= mix(0.86, 1.04, vAo);
} else if (gkM == 20) {
  if (uTex > 0.5) {
    // eye texture: veined sclera; the iris (alpha) is the photo's luminance tinted with the player's eye colour
    vec4 e = texture2D(uIrisMap, vGkUv);
    vec3 sclera = pow(e.rgb, vec3(2.2)) * 0.95;
    vec3 iris = pow(e.rgb, vec3(2.2)) * uIris * 2.4;
    gkBase = mix(sclera, iris, e.a);
    vec3 eo = normalize(vBind - (vBind.x > 0.0 ? uEyeL : uEyeR));
    gkBase *= mix(1.0, 0.45, smoothstep(0.05, 0.75, eo.y)) * mix(1.0, 0.8, smoothstep(0.55, 0.95, abs(eo.x)));
  } else {
    vec3 ec = vBind.x > 0.0 ? uEyeL : uEyeR;
    vec3 d = normalize(vBind - ec);
    float a = acos(clamp(d.z, -1.0, 1.0));
    vec3 iris = uIris * (0.75 + 0.5 * gkNoise(d * 40.0));
    gkBase = a < 0.42 ? (a < 0.17 ? vec3(0.02) : mix(iris, iris * 0.5, smoothstep(0.32, 0.42, a))) : gkBase;
  }
} else if (gkM == 3) {
  // trunks: a white waistband, and a white stripe down the outside of each leg (over the hip above the crotch)
  float ax = abs(vBind.x);
  float hip = smoothstep(uKit.y - 0.04, uKit.y + 0.04, vBind.y);
  float cx = mix(uKit.x, 0.0, hip);
  float cs = (ax - cx) / max(1e-4, length(vec2(ax - cx, vBind.z * mix(1.0, 1.35, hip))));
  float aa = max(fwidth(cs), 1e-4);
  float stripe = smoothstep(0.915 - aa, 0.915 + aa, cs);
  float by = uKit.z - 0.06;
  float ab = max(fwidth(vBind.y), 1e-4);
  float band = smoothstep(by - ab, by + ab, vBind.y);
  gkBase = mix(gkBase, uCol[4], max(stripe, band));
  gkBase *= mix(0.9, 1.03, vAo);
} else if (gkM == 19) {
  // short hair: dense coils / strands (fine noise, darker roots between them)
  float s1 = gkNoise(vBind * vec3(900.0, 300.0, 900.0));
  float s2 = gkNoise(vBind * 2400.0);
  gkBase *= 0.55 + 0.45 * s1 * (0.6 + 0.4 * s2);
} else {
  gkBase *= mix(0.9, 1.03, vAo);
  // leather: tonal mottling and darker creases between the padded panels (a dyed hide is never one flat colour)
  if (gkIsLeather(gkM)) gkBase *= (0.9 + 0.14 * gkNoise(vBind * 38.0) - 0.06 * gkNoise(vBind * 160.0)) * mix(0.62, 1.0, smoothstep(0.15, 0.45, vAo));
}
diffuseColor.rgb = gkBase;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float gkR = 0.6;
float gkSh = 0.0;
for (int k = 0; k < ${SLOTS}; k++) { if (k == gkM) { gkR = uRough[k]; gkSh = uSheen[k]; } }
if (gkM == 0) {
  // pores and creases are rougher; sweat smooths the skin
  gkR = clamp(gkR + (0.5 - gkSkin.a) * 0.5, 0.5, 0.8);
  gkR = mix(gkR, 0.42, max(0.0, uSweat - 0.3) * 0.7);
  gkR = mix(gkR, 0.8, gkHairy);
}
roughnessFactor = gkR;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  bool gkLeather = gkIsLeather(gkM);
  // muscle definition from the cavity field; the skin's fine height (texture) and micro-normal up close;
  // a knit on jersey
  float h = vAo * (gkM == 0 ? 0.03 : 0.006);
  if (gkM == 0 && uTex > 0.5) h += (gkSkin.a - 0.5) * 0.0016;
  else if (gkLeather) {
    // leather: the padding's soft undulation (no perfect shell), a pebble grain (two octaves) up close
    h += gkNoise(vBind * 55.0) * 0.0018;
    // (faded out where a pixel spans more than a grain: obliquely seen strips — the headgear rim — sparkled)
    float gkGw = 1.0 - smoothstep(0.25, 0.9, length(fwidth(vBind)) * 1100.0);
    h += (gkNoise(vBind * 1100.0) * 0.6 + gkNoise(vBind * 2600.0) * 0.4 * gkGw) * 0.00032 * uDetail * gkGw;
  }
  vec2 dh = vec2(dFdx(h), dFdy(h));
  normal = gkPerturb(-vViewPosition, normal, dh, faceDirection);
  if (uTex > 0.5 && uDetail > 0.0) {
    if (gkM == 0) {
      vec2 dn = texture2D(uDetailMap, vGkUv * 56.0).rg * 2.0 - 1.0;
      normal = gkDetailN(normal, -vViewPosition, vGkUv * 56.0, dn, 0.2 * uDetail);
    } else if (gkM == 1 || gkM == 14 || gkM == 18 || gkM == 23) {
      vec2 dn = texture2D(uDetailMap, vGkUv * 70.0).ba * 2.0 - 1.0;
      normal = gkDetailN(normal, -vViewPosition, vGkUv * 70.0, dn, 0.8 * uDetail);
    }
  }
}`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
// second specular lobe: skin oil / sweat (sharper, weak, grows with sweat); the wet cornea; satin and leather a little;
// fabric sheen (physical sheen, per slot)
material.clearcoat = gkM == 0 ? (0.4 * max(0.0, uSweat - 0.35)) * (1.0 - gkHairy) : (gkM == 20 ? 1.0 : (gkM == 3 || gkM == 4 ? 0.06 : (gkIsLeather(gkM) ? 0.04 : 0.0)));
material.clearcoatRoughness = gkM == 0 ? mix(0.42, 0.18, uSweat) : (gkM == 20 ? 0.02 : (gkIsLeather(gkM) ? 0.45 : 0.25));
material.sheenColor = gkM == 0 ? gkBase * vec3(0.6, 0.35, 0.3) * 0.25 : mix(vec3(1.0), gkBase, 0.4) * gkSh;
material.sheenRoughness = gkM == 3 || gkM == 4 ? 0.3 : 0.6;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
{
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(dot(normal, V), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 3.0);
  if (gkM == 0) {
    // subsurface: light bleeding through at grazing angles and lifting the shadow side warm (blood under the skin),
    // stronger in thin parts (ears, nose: the high cavity) — never a grey, plastic shadow
    vec3 scatter = gkBase * vec3(0.62, 0.18, 0.1);
    reflectedLight.indirectDiffuse += scatter * rim * 0.35;
    reflectedLight.indirectDiffuse += scatter * 0.06;
    reflectedLight.directDiffuse *= vec3(1.05, 0.98, 0.95);
  }
}`,
      );
  };
  // P3-FGT-16: the inside of a garment shows through its openings (both sides drawn; a closed body hides its back faces)
  m.side = THREE.DoubleSide;
  m.customProgramCacheKey = () => "gk-boxer-v4";
  return m;
}
