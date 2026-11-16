import * as THREE from "three";
import { boxerAssets } from "./generation";
import { loadTextureInto } from "./v8/ktx2";

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
  /** P3-FGT-17: the v6 shading (1) or the P3-FGT-16 look (0); the anatomy detail map (body-detail-{m,f}.webp) */
  uV6: { value: number };
  uAnatMap: { value: THREE.Texture | null };
  /** P3-FGT-18: the v7 shading (baked skin AO in _ao, satin trunks, stitched headgear / gloves, sweat sheen) */
  uV7: { value: number };
  /** P3-FGT-19B: the v8 skin set (albedo in uSkinMap, normal in uAnatMap) */
  uV8: { value: number };
  uV8Rgh: { value: THREE.Texture | null };
  uV8Swt: { value: THREE.Texture | null };
  uToneRef: { value: THREE.Color };
  uSkinF0: { value: number };
  /** P3-FGT-19B cloth push (SPEC §7b): cones in the mesh's space, [0, 1] upper arms (lead, rear), [2, 3] thighs —
   * A = the proximal joint + its radius (w), B = the distal joint + its radius; the torso axis A → B */
  uCapA: { value: THREE.Vector4[] };
  uCapB: { value: THREE.Vector4[] };
  uAxisA: { value: THREE.Vector3 };
  uAxisB: { value: THREE.Vector3 };
  uPush: { value: number };
}

const c = (hex: string) => new THREE.Color(hex);
/** a darker / lighter shade of a colour (sRGB space multiply) */
const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/**
 * P3-FGT-19B (SPEC §6): the v8 albedo targets per Monk-scale tone (mean torso, sRGB). The skin texture of the nearest
 * tone is used and re-tinted to the person's own tone (ratio of the linear colours), so the in-between tones of the
 * avatar palette keep the melanin pattern of their nearest baked tone instead of a flat multiply.
 */
export const V8_TONES = ["#46302a", "#664234", "#895c42", "#a77b55"] as const;
/** the specular F0 of skin at the oil–air interface (IOR ≈ 1.4), the same for every tone (SPEC §6, checklist 20) */
export const SKIN_F0 = 0.028;
export function v8ToneOf(skin: string): { tone: 1 | 2 | 3 | 4; ref: THREE.Color } {
  const lum = (h: string) => {
    const x = new THREE.Color(h);
    return 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b;
  };
  const l = lum(skin);
  let best = 0;
  for (let k = 1; k < V8_TONES.length; k++) if (Math.abs(lum(V8_TONES[k]!) - l) < Math.abs(lum(V8_TONES[best]!) - l)) best = k;
  return { tone: (best + 1) as 1 | 2 | 3 | 4, ref: new THREE.Color(V8_TONES[best]) };
}

export function boxerPalette(col: BoxerColors, v6 = false, v7 = false, v8 = false): THREE.Color[] {
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
  // (P3-FGT-17: amateur competition gloves carry a white scoring area over the knuckles)
  p[SLOT.gloveTarget] = v6 ? c("#e9e6df") : shade(kit, 0.96);
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
  // P3-FGT-18 (round 3): under the broadcast key and ACES the corner colours lifted to a flat salmon / pale blue; dyed
  // polyester and leather are deeper — the kit takes 82 % of the corner colour (the white trim and panels unchanged)
  if (v7) for (const s of [SLOT.vest, SLOT.vestTrim, SLOT.trunks, SLOT.glove, SLOT.gloveCuff, SLOT.headgear, SLOT.headgearTrim]) p[s]!.multiplyScalar(0.82);
  if (v8) {
    // P3-FGT-19B (SPEC §7, §8): the bound arm holes and neck a shade darker than the jersey; the elastic band cream
    // with woven kit-colour stripes (the shader draws them); the glove's white scoring panel and its cream tape; the
    // trunks the same dyed polyester as the vest
    p[SLOT.vestTrim] = p[SLOT.vest]!.clone().multiplyScalar(0.78);
    p[SLOT.trunks] = p[SLOT.vest]!.clone().multiplyScalar(0.96);
    p[SLOT.belt] = c("#e8e1d0");
    p[SLOT.gloveTarget] = c("#ece9e2");
    p[SLOT.gloveCuff] = c("#e2ddd2");
    p[SLOT.headgearTrim] = c("#1c1a19");
    p[SLOT.boot] = c("#1a1918");
    p[SLOT.sole] = c("#c9c2b5");
  }
  return p;
}

/** the human textures (shared by every ring person; 1K on phones / Lite): loaded once, on first use */
const TEX: Partial<Record<string, THREE.Texture>> = {};
export const HUMAN_TEX = {
  skin: (g: "m" | "f", lite: boolean) => `/assets/characters/skin-${g}${lite ? "-1k" : ""}.webp`,
  detail: "/assets/characters/human-detail.webp",
  iris: "/assets/characters/eye-iris.webp",
  /** P3-FGT-17: baked anatomy detail (RG detail normal, B cavity), 1K, both tiers */
  anatomy: (g: "m" | "f") => `/assets/characters/body-detail-${g}.webp`,
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
  opts: { gender?: "m" | "f"; lite?: boolean; v6?: boolean; v7?: boolean; v8?: boolean } = {},
): THREE.MeshPhysicalMaterial & { userData: { u: BoxerUniforms } } {
  const u: BoxerUniforms = {
    uCol: { value: boxerPalette(col, !!opts.v6, !!opts.v7, !!opts.v8) },
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
    uV6: { value: opts.v6 ? 1 : 0 },
    uAnatMap: { value: null },
    uV7: { value: opts.v7 ? 1 : 0 },
    uV8: { value: opts.v8 ? 1 : 0 },
    uV8Rgh: { value: null },
    uV8Swt: { value: null },
    uToneRef: { value: v8ToneOf(col.skin).ref },
    uSkinF0: { value: SKIN_F0 },
    uCapA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uCapB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uAxisA: { value: new THREE.Vector3() },
    uAxisB: { value: new THREE.Vector3(0, 1, 0) },
    uPush: { value: 0 },
  };
  if (typeof window !== "undefined") {
    let n = 0;
    const done = () => {
      n++;
      if (n >= (opts.v8 ? 6 : opts.v6 ? 4 : 3)) u.uTex.value = 1;
    };
    if (opts.v8) {
      // P3-FGT-19B: the v8 skin set (KTX2: generation.ts, v8/ktx2.ts) — the albedo of the nearest tone (uSkinMap), the
      // tangent normal (uAnatMap), roughness zones and the sweat mask
      const set = boxerAssets("v8").v8maps!;
      const g = opts.gender ?? "m";
      loadTextureInto(u.uAnatMap, set.normal(g), {}, done);
      loadTextureInto(u.uSkinMap, set.albedo(g, v8ToneOf(col.skin).tone), {}, done);
      loadTextureInto(u.uV8Rgh, set.rough(g), {}, done);
      loadTextureInto(u.uV8Swt, set.sweat(g), {}, done);
    } else {
      if (opts.v6) u.uAnatMap.value = tex(HUMAN_TEX.anatomy(opts.gender ?? "m"), false, done);
      u.uSkinMap.value = tex(HUMAN_TEX.skin(opts.gender ?? "m", !!opts.lite), false, done);
    }
    u.uDetailMap.value = tex(HUMAN_TEX.detail, true, done);
    u.uIrisMap.value = tex(HUMAN_TEX.iris, false, done);
  }
  // clearcoat / sheen switched on (their per-fragment strength is set per slot below)
  // (P3-FGT-18: anisotropy on for the satin trunks' stretched highlight; it is zeroed per fragment for every other slot,
  // where three's anisotropic GGX reduces to the isotropic one)
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.3, sheen: 1, sheenRoughness: 0.5, sheenColor: 0xffffff, ...(opts.v7 ? { anisotropy: 1 } : {}) }) as THREE.MeshPhysicalMaterial & { userData: { u: BoxerUniforms } };
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
varying vec2 vGkUv;
uniform float uV8;
uniform float uPush;
uniform vec4 uCapA[4];
uniform vec4 uCapB[4];
uniform vec3 uAxisA;
uniform vec3 uAxisB;
// P3-FGT-19B: the closest point on segment ab to p, and its parameter
vec3 gkSeg(vec3 p, vec3 a, vec3 b, out float t) {
  vec3 ab = b - a;
  t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  return a + ab * t;
}`,
      )
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
// P3-FGT-19B (docs/design/fighter-v8/SPEC.md §7b): the singlet never wraps an arm — jersey that enters an upper arm's
// cone moves towards the torso axis until it is clear; the trunks never cut into a thigh — satin inside a thigh's cone
// moves out from the leg axis (the leg moves inside the loose leg)
if (uPush > 0.5) {
  int gkPm = int(_mat + 0.5);
  float t;
  if (gkPm == 1 || gkPm == 2) {
    for (int k = 0; k < 2; k++) {
      for (int it = 0; it < 3; it++) {
        vec3 c = gkSeg(transformed, uCapA[k].xyz, uCapB[k].xyz, t);
        float r = mix(uCapA[k].w, uCapB[k].w, t) + 0.006;
        float d = length(transformed - c);
        if (d >= r || t <= 0.12) break;
        float ta;
        vec3 q = gkSeg(transformed, uAxisA, uAxisB, ta);
        transformed += normalize(q - transformed + vec3(1e-6)) * (r - d);
      }
    }
  } else if (gkPm == 3) {
    for (int k = 2; k < 4; k++) {
      vec3 c = gkSeg(transformed, uCapA[k].xyz, uCapB[k].xyz, t);
      float r = mix(uCapA[k].w, uCapB[k].w, t) + mix(0.008, 0.02, t);
      vec3 dv = transformed - c;
      float d = length(dv);
      if (d < r && d > 1e-5 && t > 0.08) transformed = c + dv * (r / d);
    }
  }
}`,
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
uniform float uV6;
uniform sampler2D uAnatMap;
uniform float uV7;
uniform float uV8;
uniform sampler2D uV8Rgh;
uniform sampler2D uV8Swt;
uniform vec3 uToneRef;
uniform float uSkinF0;
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
float gkHairy;
vec4 gkAnat;
float gkSkinLit;
float gkCurv;
float gkOcc;
float gkGroove;
float gkSweatK;
// P3-FGT-18: an anti-aliased line of half-width w round 0 (fwidth-scaled), and a dashed stitch row along it
float gkLine(float d, float w) { float a = max(fwidth(d), 1e-5); return 1.0 - smoothstep(w - a, w + a, abs(d)); }
float gkStitchRow(float d, float along, float pitch, float w) { float dash = step(0.42, fract(along / pitch)); return gkLine(d, w) * dash; }
/**
 * P3-FGT-18 headgear detail on the shell's own coordinates (build.mjs headShell uv: u = azimuth / 2π, 0 = the face;
 * v = elevation 0 … 1 over −1.25 … π/2 rad): x = seam grooves (0 … 1), y = stitch rows, z = the rear lacing panel
 * (laces = 1, the dark gap between the eyelet edges = 0.5), w = the velcro / chin-strap webbing.
 */
vec4 gkHeadgearDetail(vec2 uvh) {
  float az = uvh.x * 6.2831853;
  float el = -1.25 + uvh.y * (1.5707963 + 1.25);
  float front = cos(az);
  float s = sin(az);
  vec4 r = vec4(0.0);
  // the crown's panels: seams from the top down the sides and back (4 panels), each with a stitch row either side
  float panelD = sin(2.0 * az) * cos(el);
  float crown = smoothstep(0.15, 0.3, el) * (1.0 - smoothstep(0.55, 0.75, front));
  r.x = max(r.x, gkLine(panelD, 0.012) * crown);
  r.y = max(r.y, (gkStitchRow(panelD - 0.035, el, 0.022, 0.0045) + gkStitchRow(panelD + 0.035, el, 0.022, 0.0045)) * crown);
  // the forehead bolster's top seam and its stitches (a band across the brow)
  float browTop = el - 0.62;
  float browBand = smoothstep(0.45, 0.65, front);
  r.x = max(r.x, gkLine(browTop, 0.012) * browBand);
  r.y = max(r.y, gkStitchRow(browTop - 0.03, az, 0.02, 0.0045) * browBand);
  // the cheek pad's seam (where it meets the ear piece) with stitches
  float cheekD = abs(s) - 0.52;
  float cheekBand = (1.0 - smoothstep(0.35, 0.5, el)) * smoothstep(-0.9, -0.6, el) * step(0.0, front);
  r.x = max(r.x, gkLine(cheekD, 0.012) * cheekBand);
  r.y = max(r.y, gkStitchRow(cheekD + 0.03, el, 0.02, 0.0045) * cheekBand);
  // ear piece: a ring seam round the ear and a few breathing holes
  vec2 ear = vec2(front, el + 0.12);
  float earR = length(ear) - 0.22;
  float earSide = smoothstep(0.75, 0.9, abs(s));
  r.x = max(r.x, gkLine(earR, 0.01) * earSide);
  r.y = max(r.y, gkStitchRow(earR + 0.03, atan(ear.y, ear.x), 0.16, 0.0045) * earSide);
  // the rear lacing: a vertical opening at the back of the head (a dark gap between two eyelet edges) closed by a
  // criss-cross lace; under it the velcro strap across the nape
  float back = az - 3.1415927;
  float lacing = (1.0 - smoothstep(0.08, 0.1, abs(back))) * smoothstep(-0.45, -0.35, el) * (1.0 - smoothstep(0.35, 0.45, el));
  float gap = 1.0 - smoothstep(0.018, 0.026, abs(back));
  float zig = abs(fract(el * 7.0) - 0.5) * 2.0;
  float lace = gkLine(abs(back) - zig * 0.07, 0.009) * step(abs(back), 0.075);
  r.z = lacing * max(gap * 0.5, lace);
  r.w = max(r.w, (1.0 - smoothstep(0.38, 0.45, abs(back))) * smoothstep(-0.78, -0.72, el) * (1.0 - smoothstep(-0.55, -0.5, el)));
  // the chin strap (the band under the jaw) is webbing too
  r.w = max(r.w, smoothstep(1.03, 1.08, -el) * step(0.0, front));
  return r;
}`,
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
gkAnat = vec4(0.5, 0.5, 0.5, 1.0);
gkSkinLit = 0.0;
gkCurv = 0.0;
gkOcc = 1.0;
gkGroove = 0.0;
gkSweatK = 0.0;
if (gkM == 0 && uV7 > 0.5) {
  // P3-FGT-18: the baked ambient occlusion (build.mjs vertex-ao.mjs): creases under the vest edge, the trunks' hem,
  // the chin, between the legs; and where sweat gathers (forehead, chest, shoulders, back), beads in patches
  gkOcc = clamp(vAo * 1.15, 0.0, 1.0);
  gkSweatK = smoothstep(0.35, 0.75, gkNoise(vBind * 26.0) * 0.7 + gkNoise(vBind * 90.0) * 0.3 + (vZone > 0.5 && vZone < 1.5 ? 0.12 : 0.0));
  // P3-FGT-19B: the baked sweat mask (forehead, temples, nose, upper lip, chest centre, traps, upper back, forearms)
  if (uV8 > 0.5 && uTex > 0.5) gkSweatK = clamp(texture2D(uV8Swt, vGkUv).r * (0.55 + 0.9 * gkNoise(vBind * 60.0)), 0.0, 1.0);
}
if (gkM == 0) {
  // skin: the tone x the photo skin's relative variation (in sRGB: ratio^2.2 in linear), its chroma eased on darker
  // tones (a light skin's pink lips / cheeks become a deeper, browner flush on dark skin, as on real dark skin)
  float tl = dot(gkBase, vec3(0.2126, 0.7152, 0.0722));
  if (uV8 > 0.5 && uTex > 0.5) {
    // P3-FGT-19B: the baked tone's albedo (colour zones, lips, painted crop / cornrows in it) re-tinted to this person's
    // tone; the uniform holds the linear colour of the baked tone
    vec3 alb = pow(texture2D(uSkinMap, vGkUv).rgb, vec3(2.2));
    gkBase = alb * clamp(gkBase / max(uToneRef, vec3(1e-3)), vec3(0.6), vec3(1.6));
    gkSkin = vec4(0.5);
  } else if (uTex > 0.5) {
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
  if (uV8 > 0.5 && uTex > 0.5) {
    gkAnat = texture2D(uAnatMap, vGkUv);
  } else if (uV6 > 0.5 && uTex > 0.5) {
    // P3-FGT-17: the baked anatomy map's cavity (grooves between muscles a little darker, never black) and a gentle
    // tonal breakup (real skin is never one flat colour: blotches of a few cm, a touch warmer / cooler)
    gkAnat = texture2D(uAnatMap, vGkUv);
    // (P3-FGT-18: the grooves read more under the broadcast key — deltoid / biceps / triceps borders, the sternum line)
    gkBase *= clamp(1.0 + (gkAnat.b - 0.5) * (uV7 > 0.5 ? 1.3 : 0.9), uV7 > 0.5 ? 0.72 : 0.8, 1.05);
    float bl = gkNoise(vBind * 14.0) - 0.5;
    gkBase *= vec3(1.0 + bl * 0.07, 1.0 + bl * 0.035, 1.0 + bl * 0.02);
  } else {
    gkBase *= mix(0.86, 1.04, vAo);
  }
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
  // (P3-FGT-18: the loose leg is far wider than the thigh: a narrow piping down the outer seam, not a panel)
  float stripe = smoothstep((uV7 > 0.5 ? 0.982 : 0.915) - aa, (uV7 > 0.5 ? 0.982 : 0.915) + aa, cs);
  float by = uKit.z - (uV7 > 0.5 ? 0.058 : (uV6 > 0.5 ? 0.045 : 0.06));
  float ab = max(fwidth(vBind.y), 1e-4);
  float band = smoothstep(by - ab, by + ab, vBind.y) * (1.0 - uV8);
  gkBase = mix(gkBase, uCol[4], max(stripe * (1.0 - band), band));
  if (uV7 > 0.5) {
    // the broad elastic band: knitted ribs (fine vertical lines, a touch darker in the grooves) and the top and bottom
    // stitch rows; a satin leg is never one flat colour (it darkens where it folds away from the light: the normal does
    // that, plus a slight sheen-side lift in the shading)
    float rib = 0.5 + 0.5 * sin(atan(vBind.z, vBind.x) * 260.0);
    gkBase *= mix(1.0, 0.9 + 0.1 * rib, band);
    float bt = vBind.y - by;
    gkBase *= 1.0 - 0.25 * band * (gkStitchRow(bt - 0.006, atan(vBind.z, vBind.x), 0.03, 0.0008) + gkStitchRow(bt - 0.051, atan(vBind.z, vBind.x), 0.03, 0.0008));
  } else gkBase *= mix(0.9, 1.03, vAo);
} else if (gkM == 24 && uV8 > 0.5) {
  // P3-FGT-19B: the 8.5 cm elastic band (SPEC §7): cream ribbed elastic with two woven kit-colour stripes
  float bt = uKit.z - vBind.y;
  float aa = max(fwidth(bt), 1e-4);
  float st = smoothstep(0.016 - aa, 0.016 + aa, bt) * (1.0 - smoothstep(0.024 - aa, 0.024 + aa, bt));
  st = max(st, smoothstep(0.061 - aa, 0.061 + aa, bt) * (1.0 - smoothstep(0.069 - aa, 0.069 + aa, bt)));
  gkBase = mix(gkBase, uCol[1], st);
  float rib = 0.5 + 0.5 * sin(atan(vBind.z, vBind.x) * 300.0);
  gkBase *= (0.92 + 0.08 * rib) * mix(0.9, 1.03, vAo);
} else if (gkM == 8 && uV6 > 0.5 && uV8 < 0.5) {
  // P3-FGT-17: the competition glove's white scoring panel over the knuckles and the front roll (glove coordinates in
  // the uv: x = (cos θ + 1) / 2 round the section, 0 = the back of the hand; y = (x + 0.15) / 0.35 along it)
  float gx = vGkUv.y * 0.35 - 0.15;
  float aaX = max(fwidth(gx), 1e-4);
  float aaC = max(fwidth(vGkUv.x), 1e-4);
  float panel = (1.0 - smoothstep(0.375 - aaC, 0.375 + aaC, vGkUv.x)) * smoothstep(0.08 - aaX, 0.08 + aaX, gx);
  panel = max(panel, smoothstep(0.152 - aaX, 0.152 + aaX, gx) * (1.0 - smoothstep(0.62 - aaC, 0.62 + aaC, vGkUv.x)));
  gkBase = mix(gkBase, uCol[9], panel);
  if (uV7 > 0.5) {
    // P3-FGT-18: the stitching round the scoring panel and down the glove's side seam (thread a shade off the leather)
    float st = gkStitchRow(vGkUv.x - 0.362, vGkUv.y, 0.012, 0.0035) * smoothstep(0.08, 0.1, gx) + gkStitchRow(gx - 0.093, vGkUv.x, 0.012, 0.0035) * (1.0 - smoothstep(0.36, 0.38, vGkUv.x));
    st += gkStitchRow(vGkUv.x - 0.5, vGkUv.y, 0.012, 0.004) * (1.0 - smoothstep(0.06, 0.08, gx));
    gkGroove = gkLine(vGkUv.x - 0.375, 0.006) * smoothstep(0.08, 0.1, gx);
    gkBase = mix(gkBase, mix(gkBase, vec3(0.85, 0.83, 0.8), 0.45), clamp(st, 0.0, 1.0));
  }
  gkBase *= mix(0.9, 1.03, vAo);
  gkBase *= (0.9 + 0.14 * gkNoise(vBind * 38.0) - 0.06 * gkNoise(vBind * 160.0)) * mix(0.62, 1.0, smoothstep(0.15, 0.45, vAo));
} else if (gkM == 19) {
  // short hair: dense coils / strands (fine noise, darker roots between them)
  float s1 = gkNoise(vBind * vec3(900.0, 300.0, 900.0));
  float s2 = gkNoise(vBind * 2400.0);
  gkBase *= 0.55 + 0.45 * s1 * (0.6 + 0.4 * s2);
} else if ((gkM == 11 || gkM == 12) && uV7 > 0.5 && uV8 < 0.5) {
  // P3-FGT-18: competition headgear — stitched panels, seams, the rear lacing and the velcro / chin-strap webbing on
  // the shell's own coordinates (gkHeadgearDetail); a matte, slightly worn leather / vinyl, never one flat colour
  vec4 hd = gkHeadgearDetail(vGkUv);
  gkGroove = hd.x;
  gkBase *= (0.9 + 0.14 * gkNoise(vBind * 38.0) - 0.06 * gkNoise(vBind * 160.0)) * mix(0.62, 1.0, smoothstep(0.15, 0.45, vAo));
  gkBase *= 1.0 - 0.35 * hd.x;
  gkBase = mix(gkBase, gkBase * 0.55 + vec3(0.42, 0.4, 0.38) * 0.35, clamp(hd.y, 0.0, 1.0));
  gkBase = mix(gkBase, vec3(0.025), step(0.25, hd.z) * step(hd.z, 0.75));
  gkBase = mix(gkBase, vec3(0.86, 0.85, 0.82), step(0.75, hd.z));
  gkBase = mix(gkBase, gkBase * 0.45 * (0.85 + 0.3 * gkNoise(vBind * 700.0)), hd.w);
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
  if (uV6 > 0.5) {
    // P3-FGT-17: specular breakup — oilier, smoother patches over a few cm (forehead / nose / chest), drier elsewhere;
    // grooves a little rougher (the light breaks into the skin's own pattern instead of one broad sheen)
    gkR += (gkNoise(vBind * 9.0) - 0.5) * 0.14 + (0.5 - gkAnat.b) * 0.12;
    gkR = clamp(gkR, 0.42, 0.82);
  }
  // P3-FGT-18: sweat beads in patches — wet skin is much smoother there
  if (uV7 > 0.5) gkR = mix(gkR, 0.3, gkSweatK * smoothstep(0.3, 0.9, uSweat) * 0.8);
  // P3-FGT-19B: the baked roughness zones (T-zone 0.40, lips 0.34, palms 0.62, scalp 0.70, base 0.52 ± 0.06)
  if (uV8 > 0.5 && uTex > 0.5) gkR = mix(clamp(texture2D(uV8Rgh, vGkUv).r, 0.3, 0.85), 0.3, gkSweatK * smoothstep(0.3, 0.9, uSweat) * 0.6);
}
if (uV7 > 0.5) {
  // satin trunks: smooth (the anisotropic lobe stretches it along the folds); headgear / gloves: matte worn leather
  // with the webbing rough; jersey vest dry and matte
  if (gkM == 3) gkR = 0.34;
  if (gkM == 11 || gkM == 12) gkR = mix(0.7, 0.92, gkGroove);
  if (gkM == 1) gkR = 0.82;
  // P3-FGT-19B: glove leather 0.5, the white panel a little smoother, headgear 0.66, the elastic band matte
  if (uV8 > 0.5) {
    if (gkM == 8 || gkM == 10) gkR = 0.5;
    if (gkM == 9) gkR = 0.42;
    if (gkM == 11) gkR = 0.66;
    if (gkM == 24) gkR = 0.86;
  }
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
  float h = vAo * (gkM == 0 ? (uV6 > 0.5 && uTex > 0.5 ? 0.0 : 0.03) : 0.006);
  if (uV6 > 0.5 && uV8 < 0.5) {
    // P3-FGT-17: fabric folds as a normal effect (no simulation): the vest bunches in soft horizontal ripples above
    // the trunks' waistband and wrinkles a little everywhere (jersey is never a shell); the trunks hang in vertical
    // folds that open towards the hem, and crease across the hip
    if (gkM == 1) {
      float yb = vBind.y - uKit.z;
      float tuck = (1.0 - smoothstep(0.0, 0.16, yb)) * smoothstep(-0.04, 0.01, yb);
      h += sin(vBind.y * 140.0 + vBind.x * 30.0 + gkNoise(vBind * 22.0) * 7.0) * 0.0007 * tuck * gkNoise(vBind * 31.0);
      h += (gkNoise(vBind * vec3(9.0, 4.0, 9.0)) - 0.5) * 0.003 + (gkNoise(vBind * 23.0) - 0.5) * 0.001;
    } else if (gkM == 3) {
      float leg = 1.0 - smoothstep(uKit.y - 0.02, uKit.y + 0.05, vBind.y);
      float ang = atan(vBind.z, abs(vBind.x) - uKit.x);
      float hem = 1.0 - smoothstep(uKit.w, uKit.y, vBind.y);
      // (P3-FGT-18: the v7 trunks carry their big folds in the geometry; the shader keeps the finer creases)
      h += sin(ang * 7.0 + gkNoise(vBind * 9.0) * 3.0) * 0.0035 * leg * (0.35 + 0.65 * hem) * (1.0 - 0.6 * uV7);
      h += uV7 * (gkNoise(vBind * vec3(30.0, 6.0, 30.0)) - 0.5) * 0.0025 * leg;
      h += sin(vBind.y * 70.0 + ang * 2.0) * 0.0009 * (1.0 - leg);
      h += (gkNoise(vBind * 13.0) - 0.5) * 0.003;
    }
  }
  // P3-FGT-18: seams pressed into the padding (headgear panels, the glove's panel edge)
  h -= gkGroove * 0.0011;
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
      // P3-FGT-17: the baked anatomy (muscle separations, the rib / pelvis landmarks) on the body uv
      // (P3-FGT-19B: the v8 tangent normal — pores, anatomy, veins — at full strength)
      if (uV8 > 0.5) normal = gkDetailN(normal, -vViewPosition, vGkUv, gkAnat.rg * 2.0 - 1.0, 1.0);
      else if (uV6 > 0.5) normal = gkDetailN(normal, -vViewPosition, vGkUv, gkAnat.rg * 2.0 - 1.0, uV7 > 0.5 ? 1.7 : 1.0);
      vec2 dn = texture2D(uDetailMap, vGkUv * 56.0).rg * 2.0 - 1.0;
      normal = gkDetailN(normal, -vViewPosition, vGkUv * 56.0, dn, (uV6 > 0.5 ? 0.3 : 0.2) * uDetail);
    } else if (gkM == 1 || gkM == 2 || gkM == 14 || gkM == 18 || gkM == 23) {
      vec2 dn = texture2D(uDetailMap, vGkUv * 70.0).ba * 2.0 - 1.0;
      normal = gkDetailN(normal, -vViewPosition, vGkUv * 70.0, dn, 0.8 * uDetail);
    }
  }
}`,
      )
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>
// P3-FGT-17 (docs/HUMAN-REALISM-VR-RESEARCH.md §5): skin diffuse in the spirit of Penner's pre-integrated skin
// (SIGGRAPH 2011) without the LUT: a per-channel wrap of N·L that widens with the surface's curvature, red widest —
// light scattered under the skin carries past the terminator as a warm band, the shadow side never goes grey. Specular,
// sheen and the clearcoat lobe keep the physical model; every other slot is unchanged.
void RE_Direct_Gk( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( gkSkinLit < 0.01 ) {
    RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    return;
  }
  float nl = dot( geometryNormal, directLight.direction );
  float dotNL = saturate( nl );
  vec3 irradiance = dotNL * directLight.color;
  #ifdef USE_CLEARCOAT
    float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
    clearcoatSpecularDirect += dotNLcc * directLight.color * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
  #endif
  #ifdef USE_SHEEN
    sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
  #endif
  reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
  vec3 w = gkCurv * vec3( 0.36, 0.15, 0.1 );
  vec3 wrapped = saturate( ( vec3( nl ) + w ) / ( 1.0 + w ) );
  // (a soft shoulder, energy kept near the lit side: the wrap only adds light round the terminator)
  vec3 diff = mix( vec3( dotNL ), wrapped * wrapped * ( 3.0 - 2.0 * wrapped ), gkSkinLit );
  reflectedLight.directDiffuse += directLight.color * diff * BRDF_Lambert( material.diffuseColor );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Gk`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
// second specular lobe: skin oil / sweat (sharper, weak, grows with sweat); the wet cornea; satin and leather a little;
// fabric sheen (physical sheen, per slot)
material.clearcoat = gkM == 0 ? (0.4 * max(0.0, uSweat - 0.35)) * (1.0 - gkHairy) : (gkM == 20 ? 1.0 : (gkM == 3 || gkM == 4 ? 0.06 : (gkIsLeather(gkM) ? 0.04 : 0.0)));
material.clearcoatRoughness = gkM == 0 ? mix(0.42, 0.18, uSweat) : (gkM == 20 ? 0.02 : (gkIsLeather(gkM) ? 0.45 : 0.25));
material.sheenColor = gkM == 0 ? gkBase * vec3(0.6, 0.35, 0.3) * 0.25 : mix(vec3(1.0), gkBase, 0.4) * gkSh;
material.sheenRoughness = gkM == 3 || gkM == 4 ? 0.3 : 0.6;
// P3-FGT-17: skin takes the pre-integrated-style diffuse (RE_Direct_Gk); thin parts (ears, nose: the head) scatter more
gkSkinLit = uV6 > 0.5 && gkM == 0 ? 1.0 - gkHairy : 0.0;
gkCurv = vZone > 0.5 && vZone < 1.5 ? 1.0 : 0.65;
if (uV7 > 0.5) {
  // P3-FGT-18: sweat sheen that builds over the rounds (uSweat: fighters.tsx), in patches; matte leather and webbing
  if (gkM == 0) {
    float wet = gkSweatK * smoothstep(0.25, 0.9, uSweat);
    material.clearcoat = (0.08 + 0.62 * wet) * (1.0 - gkHairy);
    material.clearcoatRoughness = mix(0.38, 0.13, wet);
  }
  if (gkM == 11 || gkM == 12) material.clearcoat = 0.02 * (1.0 - gkGroove);
}
if (uV8 > 0.5) {
  if (gkM == 0) {
    // P3-FGT-19B (SPEC §6): one dielectric specular for every tone (F0 0.028, IOR 1.4); the second lobe is the sweat
    // (roughness 0.28 → 0.12, weight sweat × mask)
    material.specularColor = vec3(uSkinF0);
    material.specularF90 = 1.0;
    float wet = gkSweatK * smoothstep(0.2, 0.9, uSweat);
    material.clearcoat = 0.75 * wet;
    material.clearcoatRoughness = mix(0.28, 0.12, wet);
  }
  if (gkM == 8 || gkM == 9 || gkM == 10) { material.clearcoat = 0.25; material.clearcoatRoughness = 0.35; }
  if (gkM == 11) { material.clearcoat = 0.1; material.clearcoatRoughness = 0.4; }
}
#ifdef USE_ANISOTROPY
// satin trunks: the highlight stretched along the vertical folds (tangent = the world's up on the surface)
if (gkM == 3 && uV7 > 0.5) {
  vec3 gkUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 gkT = gkUp - normal * dot(gkUp, normal);
  gkT = length(gkT) > 1e-4 ? normalize(gkT) : vec3(1.0, 0.0, 0.0);
  material.anisotropy = 0.7;
  material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy));
  material.anisotropyT = gkT;
  material.anisotropyB = normalize(cross(normal, gkT));
} else {
  // (isotropic: alphaT = alpha, and a well-formed frame — the uv-derived one is NaN on parts with no uv: boots, shoes)
  material.anisotropy = 0.0;
  material.alphaT = pow2(material.roughness);
  vec3 gkA = abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  material.anisotropyT = normalize(cross(gkA, normal));
  material.anisotropyB = cross(normal, material.anisotropyT);
}
#endif`,
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
    if (uV6 > 0.5) {
      // (v6: the terminator's red bleed is in the direct diffuse; only a thin translucent rim stays)
      reflectedLight.indirectDiffuse += scatter * rim * 0.16;
    } else {
      reflectedLight.indirectDiffuse += scatter * rim * 0.35;
      reflectedLight.indirectDiffuse += scatter * 0.06;
      reflectedLight.directDiffuse *= vec3(1.05, 0.98, 0.95);
    }
  }
  // P3-FGT-18: the baked occlusion darkens the ambient (sky / fill) light fully and the direct light a little (contact
  // shade in the creases — under the vest's edge, the chin, between the legs — that a shadow map at ring scale misses)
  if (uV7 > 0.5 && gkM == 0) {
    reflectedLight.indirectDiffuse *= gkOcc * gkOcc;
    reflectedLight.indirectSpecular *= gkOcc;
    reflectedLight.directDiffuse *= mix(0.55, 1.0, smoothstep(0.1, 0.8, gkOcc));
    reflectedLight.directSpecular *= mix(0.4, 1.0, smoothstep(0.1, 0.8, gkOcc));
  }
}`,
      );
  };
  // P3-FGT-16: the inside of a garment shows through its openings (both sides drawn; a closed body hides its back faces)
  m.side = THREE.DoubleSide;
  m.customProgramCacheKey = () => (opts.v8 ? "gk-boxer-v8" : opts.v7 ? "gk-boxer-v7" : "gk-boxer-v6");
  return m;
}
