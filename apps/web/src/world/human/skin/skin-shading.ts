import * as THREE from "three";

/**
 * Shared skin / fabric shading pieces for every realistic human (P2-AVA-12). Engine-neutral GLSL snippets for
 * three.js `onBeforeCompile` shaders plus the one shared detail texture, so the plaza people (world/human/materials.ts)
 * and, later, the ring people (world/human/boxer/boxer-material.ts, P3-FGT-17) can use the same skin model. See
 * docs/CAMPUS-HUMAN-REALISM.md §4 "Shared skin module" for how to adopt it in another shader.
 *
 * What is here (all cheap enough for phones: no extra passes, one 512 px texture shared by everyone):
 *  - `GK_SKIN_GLSL.detailNormal`: a tangent-space detail normal on the UV frame from screen-space derivatives (no
 *    stored tangents), for the pore / micro-wrinkle tile and the knit tile of `human-detail.webp`;
 *  - `GK_SKIN_GLSL.breakup`: band-limited value noise for roughness / specular breakup (an oily T-zone that is not
 *    a flat value, matte cheeks with variation) that fades to its mean below a pixel (no shimmer);
 *  - `GK_SKIN_GLSL.transmission`: thin-part transmission ("backlit ears"): light from behind a thin part (ears, nose
 *    wings, fingers) comes through red, the cheap stand-in for the transmitted half of subsurface scattering;
 *  - `GK_SKIN_GLSL.fabric`: fabric micro-normals by weave (jersey knit from the tile, denim twill, fleece / brushed
 *    cotton, wool suiting) and the sheen tint each fabric gets (physical sheen lobe, Estevez & Kulla 2017).
 *
 * The detail texture (`/assets/characters/human-detail.webp`, generated in-house: CC0-equivalent, see
 * docs/ASSET-LICENSES.md) packs RG = pore / micro-wrinkle normal (tile it ≈ 1 tile per 1.5–2 cm of skin) and BA = knit
 * normal (≈ 1 tile per 1 cm of jersey).
 */

export const SKIN_DETAIL_URL = "/assets/characters/human-detail.webp";

let detailTex: THREE.Texture | null = null;
/** The shared detail texture (loaded once, repeat-wrapped, linear: it holds normals). */
export function skinDetailTexture(): THREE.Texture {
  if (detailTex) return detailTex;
  // (no DOM: tests / server rendering get an empty texture, never cached)
  if (typeof document === "undefined") return new THREE.Texture();
  const t = new THREE.TextureLoader().load(SKIN_DETAIL_URL);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  detailTex = t;
  return t;
}

/** Fabric weave ids for `gkFabricN` (one per outfit kind family). */
export const FABRIC = { none: 0, knit: 1, denim: 2, fleece: 3, suiting: 4, cottonTwill: 5, leather: 6 } as const;
export type FabricId = (typeof FABRIC)[keyof typeof FABRIC];

export const GK_SKIN_GLSL = {
  detailNormal: /* glsl */ `
// tangent-space detail normal (xy in -1..1) on the frame of uv 'uvq' (derivatives: no stored tangents)
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
// how much of a tile of 'tilesPerUv' still resolves on screen (1 = sharp, 0 = below a pixel: use the mean)
float gkDetailLod(vec2 uv, float tilesPerUv, float texels) {
  vec2 d = max(abs(dFdx(uv)), abs(dFdy(uv))) * tilesPerUv * texels;
  return clamp(1.6 - max(d.x, d.y) * 0.35, 0.0, 1.0);
}
`,
  breakup: /* glsl */ `
float gkBHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gkBNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gkBHash(i), gkBHash(i + vec2(1.0, 0.0)), u.x), mix(gkBHash(i + vec2(0.0, 1.0)), gkBHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// two octaves of breakup in -0.5..0.5, each fading to 0 as it shrinks below ~2 px
float gkBreakup(vec2 uv, float f) {
  vec2 d = max(abs(dFdx(uv)), abs(dFdy(uv))) * f;
  float a = clamp(1.5 - max(d.x, d.y) * 1.5, 0.0, 1.0);
  float b = clamp(1.5 - max(d.x, d.y) * 3.3, 0.0, 1.0);
  return (gkBNoise(uv * f) - 0.5) * a * 0.65 + (gkBNoise(uv * f * 2.3 + 7.1) - 0.5) * b * 0.35;
}
`,
  transmission: /* glsl */ `
// thin-part transmission: light from behind (L against V) through a part of 'thin' (0 = thick, 1 = ear rim), red-shifted
vec3 gkTransmit(vec3 N, vec3 V, vec3 L, vec3 lightCol, float thin, vec3 albedo) {
  float back = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
  float wrap = clamp(0.35 - dot(N, L), 0.0, 1.0);
  vec3 tint = albedo * vec3(1.0, 0.36, 0.22) * 2.2;
  return lightCol * tint * back * wrap * thin;
}
`,
  fabric: /* glsl */ `
// fabric micro-normal (xy) for a weave at uv (tiles per uv unit 'f'); 'lod' fades it below a pixel
vec2 gkFabricN(int id, vec2 uv, float f, float lod, sampler2D detail) {
  if (id == 1) return (texture2D(detail, uv * f).ba * 2.0 - 1.0) * lod;
  if (id == 2) {
    // denim: 3/1 twill, diagonal wales; slubs (thicker yarn) along the warp
    vec2 p = uv * f;
    float w = sin((p.x + p.y) * 6.2832 * 3.0);
    float slub = gkBNoise(vec2(p.x * 0.6, p.y * 9.0)) - 0.5;
    return vec2(w * 0.55 + slub * 0.25, w * 0.55) * lod;
  }
  if (id == 3) {
    // fleece / brushed cotton: soft, random pile, no visible yarns
    vec2 p = uv * f * 1.7;
    return vec2(gkBNoise(p) - 0.5, gkBNoise(p + 3.7) - 0.5) * 0.9 * lod;
  }
  if (id == 4) {
    // wool suiting: a fine plain weave, very low relief
    vec2 p = uv * f * 1.4;
    return vec2(sin(p.x * 6.2832), sin(p.y * 6.2832)) * 0.1 * lod;
  }
  if (id == 5) {
    // cotton twill (chinos, caps): finer, flatter diagonal than denim
    vec2 p = uv * f * 1.3;
    float w = sin((p.x - p.y) * 6.2832 * 2.0);
    return vec2(w, w) * 0.3 * lod;
  }
  if (id == 6) {
    // leather: pebbled grain
    vec2 p = uv * f * 0.8;
    return vec2(gkBNoise(p) - 0.5, gkBNoise(p + 9.1) - 0.5) * 0.5 * lod;
  }
  return vec2(0.0);
}
// physical sheen tint (× the fabric colour) and sheen roughness per weave: velvety fleece / knit, faint on suiting
vec4 gkFabricSheen(int id, vec3 base) {
  if (id == 1) return vec4(mix(vec3(1.0), base, 0.5) * 0.35, 0.55);
  if (id == 2) return vec4(mix(vec3(0.75, 0.82, 1.0), base, 0.5) * 0.22, 0.5);
  if (id == 3) return vec4(mix(vec3(1.0), base, 0.35) * 0.55, 0.7);
  if (id == 4) return vec4(mix(vec3(1.0), base, 0.6) * 0.18, 0.4);
  if (id == 5) return vec4(mix(vec3(1.0), base, 0.5) * 0.25, 0.55);
  return vec4(0.0, 0.0, 0.0, 0.5);
}
`,
};
