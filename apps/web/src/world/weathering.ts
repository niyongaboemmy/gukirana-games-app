import type * as THREE from "three";

/**
 * Weathering (P2-WLD-22, docs/COMPOUND-REALISM.md): the campus materials were all perfectly even and new — the same
 * value everywhere on a 40 m wall, nothing at the foot of a wall where rain splashes the soil up. This hook adds,
 * per pixel and from WORLD position only (no extra geometry, textures or draw calls; identical on every device):
 *  - macro breakup: two octaves of low-frequency value noise (≈ 11 m and 3 m) nudging the albedo ± a few percent,
 *    so big surfaces stop reading as one flat CG colour and texture tiling repeats are masked;
 *  - a splash / dirt band at the foot of vertical faces (the first ~0.5 m), tinted towards Musanze's red-brown soil —
 *    it also grounds every wall and planter like a soft contact shadow;
 *  - faint vertical rain streaks on vertical faces (long thin noise along the wall), standard tier only.
 * Pure function of position: no per-material uniforms, so materials with the same parameters still batch together
 * (StaticMerge reads `userData.gkPureHook` as part of the value signature instead of keying the material by uuid).
 */
export interface WeatherOpts {
  /** macro albedo variation amplitude (0.1 = ±5 %) */
  macro?: number;
  /** dirt band strength at the foot of vertical faces (0 … 1) */
  base?: number;
  /** dirt band height (m) */
  baseH?: number;
  /** rain-streak strength on vertical faces (0 … 1) */
  streak?: number;
  /** world y of the ground the band sits on */
  ground?: number;
  /** noise scale multiplier (smaller objects: larger value) */
  scale?: number;
  /** clipped-foliage breakup (hedges): clumps of light and shadowed leaves in world space, lighter sunlit tops */
  leaf?: boolean;
}

const NOISE = `
float gkwH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gkwN(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gkwH(i), gkwH(i + vec3(1,0,0)), f.x), mix(gkwH(i + vec3(0,1,0)), gkwH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gkwH(i + vec3(0,0,1)), gkwH(i + vec3(1,0,1)), f.x), mix(gkwH(i + vec3(0,1,1)), gkwH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

const f = (n: number) => n.toFixed(4);

/** Add the weathering hook to a standard material (chains any hook already on it). Returns the material. */
export function weather<M extends THREE.Material>(m: M, o: WeatherOpts = {}, lite = false): M {
  const macro = o.macro ?? 0.12;
  const base = o.base ?? 0.32;
  const baseH = o.baseH ?? 0.5;
  const streak = lite ? 0 : (o.streak ?? 0.08);
  const ground = o.ground ?? 0;
  const sc = o.scale ?? 1;
  const leaf = !!o.leaf;
  const key = `gkw:${f(macro)}:${f(base)}:${f(baseH)}:${f(streak)}:${f(ground)}:${f(sc)}:${leaf ? 1 : 0}`;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const pure =
    prev === (Object.getPrototypeOf(m) as THREE.Material).onBeforeCompile && !m.userData.gkPureHook;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    sh.vertexShader =
      "varying vec3 vGkwP;\nvarying vec3 vGkwN;\n" +
      sh.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
  {
    vec4 gkwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      gkwp = instanceMatrix * gkwp;
    #endif
    vGkwP = (modelMatrix * gkwp).xyz;
    vGkwN = normalize(mat3(modelMatrix) * objectNormal);
  }`,
      );
    sh.fragmentShader =
      "varying vec3 vGkwP;\nvarying vec3 vGkwN;\n" +
      NOISE +
      "\n" +
      sh.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
  {
    vec3 gkp = vGkwP * ${f(sc)};
    float gkm = gkwN(gkp * 0.09) * 0.6 + gkwN(gkp * 0.33 + 7.1) * 0.4;
    diffuseColor.rgb *= 1.0 + (gkm - 0.5) * ${f(macro * 2.0)};
    float gkv = 1.0 - smoothstep(0.35, 0.7, abs(vGkwN.y));
    ${
      leaf
        ? `{
      vec3 lp = vGkwP * 9.0;
      float ln = gkwN(lp) * 0.5 + gkwN(lp * 2.3 + 3.7) * 0.3 + gkwN(lp * 5.3 + 9.1) * 0.2;
      diffuseColor.rgb *= (0.42 + 1.15 * smoothstep(0.25, 0.8, ln)) * (1.0 + 0.06 * smoothstep(0.6, 0.95, vGkwN.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.06, 0.7), smoothstep(0.62, 0.8, gkwN(lp * 0.21)) * 0.5);
    }`
        : ""
    }
    float gkh = vGkwP.y - ${f(ground)};
    float gkb = (1.0 - smoothstep(0.0, ${f(baseH)}, gkh)) * step(-0.05, gkh) * gkv;
    gkb *= 0.75 + 0.5 * gkwN(vec3(gkp.x * 1.7, 0.0, gkp.z * 1.7));
    // red-brown laterite splash (linear): darkens and warms the foot of the wall
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.46, 0.36), clamp(gkb * ${f(base)} * 1.6, 0.0, 1.0));
    ${
      streak > 0
        ? `float gks = gkwN(vec3((gkp.x + gkp.z) * 3.1, gkp.y * 0.22, (gkp.z - gkp.x) * 3.1));
    diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.92, gks) * ${f(streak)} * gkv;`
        : ""
    }
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|${key}`;
  // a pure hook (no uniforms of its own) on an unhooked material: batching may treat it as part of the value signature
  if (pure) m.userData.gkPureHook = key;
  else delete m.userData.gkPureHook;
  return m;
}
