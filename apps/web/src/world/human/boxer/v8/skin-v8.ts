/**
 * P3-FGT-19B: the v8 fighters' skin shading base (docs/FIGHT-REALISM-V8.md §Skin). Builds on the shared skin
 * module (world/human/skin/skin-shading.ts: detail normals, breakup, thin-part transmission) with the three pieces
 * docs/HUMAN-REALISM-VR-RESEARCH.md ranks highest for skin that holds up under a hard broadcast key, all single-pass
 * and phone-safe (no screen-space blur, no LUT texture):
 *
 *  1. Curvature-driven, energy-conserving wrapped diffuse per colour channel — the analytic stand-in for
 *     pre-integrated skin (Penner 2011). Light wraps further round the terminator in red than in blue where the
 *     surface curves tightly (nose, ears, fingers, the deltoid's edge), so the terminator goes warm instead of grey.
 *     The wrap is normalised so a wrapped channel reflects exactly the energy Lambert does
 *     (∫ ((x + w)/(1 + w))^(1 + w) dx · (2 + w)/(2(1 + w)) = ∫ max(x, 0) dx).
 *  2. Shadow-edge scatter: the penumbra of a cast shadow tinted red (light scattered under the skin into the
 *     shadow), channel exponents < 1 for red.
 *  3. Dual-lobe specular roughness (Jimenez et al. 2016-style: a sharp 85 % lobe and a broad 15 % lobe), so the
 *     key's highlight on a sweaty shoulder has a tight core and a soft halo.
 *
 * Each GLSL function has a TypeScript twin of the same maths, unit-tested (skin-v8.test.ts), so what the shader does
 * can be checked without a GPU.
 */

/** per-channel wrap at curvature 1 (red scatters furthest) */
export const SKIN_WRAP_RGB = [0.5, 0.2, 0.12] as const;
/** shadow penumbra exponents per channel */
export const SHADOW_SCATTER_RGB = [0.62, 1.0, 1.12] as const;
/** dual-lobe specular: roughness scales and the lobe mix */
export const DUAL_LOBE = { sharp: 0.75, broad: 1.55, mix: 0.15 } as const;

/** energy-conserving wrapped diffuse for one channel: x = N·L, w ≥ 0 the wrap */
export function wrapDiffuse(x: number, w: number): number {
  const u = Math.min(1, Math.max(0, (x + w) / (1 + w)));
  return Math.pow(u, 1 + w) * ((2 + w) / (2 * (1 + w)));
}

/** the skin's diffuse response per channel at curvature k (0 = flat … 1 = tight: an ear rim) */
export function skinDiffuse(x: number, k: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, k));
  return [wrapDiffuse(x, SKIN_WRAP_RGB[0] * c), wrapDiffuse(x, SKIN_WRAP_RGB[1] * c), wrapDiffuse(x, SKIN_WRAP_RGB[2] * c)];
}

/** shadow-edge scatter: shadow factor s (0 shadowed … 1 lit) → per-channel light */
export function shadowScatter(s: number, k = 1): [number, number, number] {
  const c = Math.min(1, Math.max(0, s));
  const e = SHADOW_SCATTER_RGB.map((x) => 1 + (x - 1) * k);
  return [Math.pow(c, e[0]!), Math.pow(c, e[1]!), Math.pow(c, e[2]!)];
}

/** the two roughness lobes for a base roughness */
export function dualLobe(r: number): { sharp: number; broad: number; mix: number } {
  return { sharp: Math.min(1, Math.max(0.04, r * DUAL_LOBE.sharp)), broad: Math.min(1, r * DUAL_LOBE.broad), mix: DUAL_LOBE.mix };
}

const f = (x: number) => x.toFixed(4);

export const GK_SKIN_V8_GLSL = /* glsl */ `
// ---- P3-FGT-19B skin v8 (world/human/boxer/v8/skin-v8.ts) ----
// curvature of the surface from screen-space derivatives: |dN| / |dP|, scaled so 1 ≈ a 1.5 cm radius (an ear rim)
float gkSkinCurvature(vec3 n, vec3 pos) {
  float dn = length(fwidth(n));
  float dp = length(fwidth(pos));
  return clamp(dn / max(dp, 1e-5) * 0.015, 0.0, 1.0);
}
float gkWrapDiffuse(float x, float w) {
  float u = clamp((x + w) / (1.0 + w), 0.0, 1.0);
  return pow(u, 1.0 + w) * ((2.0 + w) / (2.0 * (1.0 + w)));
}
vec3 gkSkinDiffuse(float ndl, float k) {
  vec3 w = vec3(${f(SKIN_WRAP_RGB[0])}, ${f(SKIN_WRAP_RGB[1])}, ${f(SKIN_WRAP_RGB[2])}) * clamp(k, 0.0, 1.0);
  return vec3(gkWrapDiffuse(ndl, w.r), gkWrapDiffuse(ndl, w.g), gkWrapDiffuse(ndl, w.b));
}
vec3 gkShadowScatter(float s, float k) {
  vec3 e = 1.0 + (vec3(${f(SHADOW_SCATTER_RGB[0])}, ${f(SHADOW_SCATTER_RGB[1])}, ${f(SHADOW_SCATTER_RGB[2])}) - 1.0) * k;
  return pow(vec3(clamp(s, 0.0, 1.0)), e);
}
vec3 gkDualLobe(float r) {
  return vec3(clamp(r * ${f(DUAL_LOBE.sharp)}, 0.04, 1.0), min(1.0, r * ${f(DUAL_LOBE.broad)}), ${f(DUAL_LOBE.mix)});
}
`;
