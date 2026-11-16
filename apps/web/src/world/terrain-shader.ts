import * as THREE from "three";
import { MASK_HALF } from "./countryside";

/**
 * Farmland detail in the terrain shader (P2-WLD-11): crisp at any height, no extra geometry or draw calls.
 * The vertex colours carry the broad picture (lawn, lake shores, terrace shading); per pixel the shader adds
 *  - irregular smallholder fields (warped Voronoi cells, ~23 m) in Musanze crop colours, many with crop rows,
 *  - grass strips / hedgerows on the field boundaries,
 *  - terrace risers along the contours wherever the hillside slopes,
 *  - macro tone variation and fine soil / leaf noise,
 *  - the countryside mask (world/countryside.ts): laterite roads with dusty verges, river water and its green banks,
 *    swept-earth compounds round the village houses.
 * Every pattern is anti-aliased with fwidth() so it fades to its average instead of shimmering from the sky.
 * Pure functions of world position (no campus coordinates), so it works wherever the campus buildings stand.
 */

// potatoes, beans, maize, sorghum, pasture, fresh-tilled dark volcanic soil, wheat stubble, fallow
const FIELDS = ["#4a7a33", "#5f8a3a", "#76964a", "#4f6f30", "#6a8a42", "#4d3b2c", "#8f8a55", "#6b5a3e"];
const lin = (hex: string) => new THREE.Color(hex);

export function terrainMaterial(opts: { lite: boolean; map: THREE.Texture; normalMap: THREE.Texture | null; mask: THREE.Texture }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: opts.map,
    normalMap: opts.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    color: new THREE.Color("#ffffff").multiplyScalar(1.35),
    roughness: 1,
  });
  const uniforms = {
    uGkMask: { value: opts.mask },
    uGkField: { value: FIELDS.map(lin) },
    uGkHedge: { value: lin("#34552a") },
    uGkRoad: { value: lin("#94634a") },
    uGkDust: { value: lin("#9a8566") },
    uGkEarth: { value: lin("#8a6446") },
    uGkBank: { value: lin("#2f5a26") },
    uGkWater: { value: lin("#2c4a4c") },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFarm;\nvarying vec3 vGkW;\nvarying vec3 vGkN;\nvarying float vGkFarm;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n  vGkW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vGkN = normalize(mat3(modelMatrix) * objectNormal);\n  vGkFarm = aFarm;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uGkMask;
uniform vec3 uGkField[8];
uniform vec3 uGkHedge, uGkRoad, uGkDust, uGkEarth, uGkBank, uGkWater;
varying vec3 vGkW;
varying vec3 vGkN;
varying float vGkFarm;
float gkHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 gkHash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float gkNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gkHash(i), gkHash(i + vec2(1.0, 0.0)), u.x), mix(gkHash(i + vec2(0.0, 1.0)), gkHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `vec3 gkC = vColor.rgb;
  vec2 gkP = vGkW.xz;
  if (vGkFarm > 0.002) {
    // smallholder fields: long strips (warped, anisotropic Voronoi cells), each ~200 m tract of land ploughed its own
    // way (the tracts meet along wavy lines, like ridges and old boundaries)
    vec2 gkWp = gkP + (vec2(gkNoise(gkP * 0.021), gkNoise(gkP * 0.021 + 19.7)) - 0.5) * 14.0;
    vec2 tract = floor((gkP + (vec2(gkNoise(gkP * 0.013 + 5.1), gkNoise(gkP * 0.013 + 9.3)) - 0.5) * 110.0) / 190.0);
    float fa = gkHash(tract + 0.37) * 3.14159;
    vec2 rel = gkWp - (tract + 0.5) * 190.0;
    vec2 q = vec2(dot(rel, vec2(cos(fa), sin(fa))), dot(rel, vec2(-sin(fa), cos(fa)))) + tract * 57.0;
    vec2 cell = q / vec2(12.0, 30.0);
    vec2 ci = floor(cell);
    vec2 cf = fract(cell);
    float d1 = 9.0;
    float d2 = 9.0;
    vec2 id = ci;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = g + gkHash2(ci + g) * 0.8 + 0.1 - cf;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = ci + g; } else if (d < d2) { d2 = d; }
      }
    float edge = (sqrt(d2) - sqrt(d1)) * 6.0; // ≈ metres to the field boundary (short axis)
    vec3 f = uGkField[int(gkHash(id * 1.37 + 0.5) * 7.99)];
    f *= 0.88 + 0.24 * gkHash(id + 6.6);
#ifndef GK_LITE
    // crop rows (about half the fields), each field ploughed its own way
    float ang = step(0.5, gkHash(id + 4.1)) * 1.5708; // rows along or across the strip
    float s = dot(q, vec2(cos(ang), sin(ang))) / (1.3 + gkHash(id + 8.3) * 1.2);
    float rows = mix(0.5 + 0.5 * cos(6.2832 * s), 0.5, smoothstep(0.2, 0.5, fwidth(s)));
    f *= 1.0 + step(0.45, gkHash(id + 2.9)) * 0.34 * (rows - 0.5);
    // fine soil / leaf texture (fades out where it would shimmer)
    f *= 1.0 + (gkNoise(gkP * 0.5) - 0.5) * 0.2 * (1.0 - smoothstep(0.25, 0.8, fwidth(gkP.x * 0.5)));
#endif
    // grass strips and hedgerows between the fields
    f = mix(f, uGkHedge, (1.0 - smoothstep(0.3, 1.0 + fwidth(edge), edge)) * 0.32);
    // terrace risers along the contours on sloping ground
    float t = vGkW.y / 2.2;
    float riser = smoothstep(0.76, 0.9, fract(t)) * (1.0 - smoothstep(0.25, 0.5, fwidth(t))) * smoothstep(0.02, 0.1, 1.0 - vGkN.y);
    f *= 1.0 - 0.3 * riser;
    // broad tone variation (soil moisture, crop stage)
    f *= 0.84 + 0.32 * gkNoise(gkP * 0.0045);
    gkC = mix(gkC, f, vGkFarm * 0.88);
  }
  {
    // campus lawn life (P2-WLD-22): the mown kikuyu lawn was one even, saturated green — lusher and drier patches,
    // clover-dark hollows, a slight desaturation and faint mowing stripes (anti-aliased: they fade out from the air)
    float lw = 1.0 - smoothstep(0.0, 0.3, vGkFarm);
    float m1 = gkNoise(gkP * 0.031);
    float m2 = gkNoise(gkP * 0.11 + 3.1);
    float m3 = gkNoise(gkP * 0.47 + 7.7);
    vec3 tint = mix(vec3(0.84, 1.0, 0.84), vec3(1.14, 1.04, 0.66), smoothstep(0.5, 0.82, m1 * 0.7 + m2 * 0.3));
    tint *= 0.86 + 0.2 * m2 + 0.1 * (m3 - 0.5);
#ifndef GK_LITE
    float st = vGkW.x / 3.2;
    float stripe = mix(step(0.5, fract(st)), 0.5, smoothstep(0.15, 0.45, fwidth(st)));
    tint *= 1.0 + 0.05 * (stripe - 0.5);
#endif
    vec3 lawn = gkC * tint;
    lawn = mix(lawn, vec3(dot(lawn, vec3(0.3, 0.59, 0.11))), 0.14);
    gkC = mix(gkC, lawn, lw);
  }
  diffuseColor.rgb *= gkC;
  // countryside features (absolute colours: the grass photo texture is not under the roads and water)
  vec4 gkM = texture2D(uGkMask, gkP / ${(MASK_HALF * 2).toFixed(1)} + 0.5);
  float gkN2 = 0.88 + 0.24 * gkNoise(gkP * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGkEarth * gkN2, smoothstep(0.1, 0.7, gkM.b) * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGkBank * gkN2, smoothstep(0.06, 0.4, gkM.g) * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGkDust * gkN2, smoothstep(0.08, 0.3, gkM.r) * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGkRoad * gkN2, smoothstep(0.4, 0.8, gkM.r));
  float gkWet = smoothstep(0.55, 0.85, gkM.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGkWater, gkWet);`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.12, gkWet);");
    if (opts.lite) sh.fragmentShader = "#define GK_LITE\n" + sh.fragmentShader;
  };
  m.customProgramCacheKey = () => `gk-terrain-${opts.lite ? "lite" : "std"}`;
  return m;
}
