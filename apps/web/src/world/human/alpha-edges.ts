import * as THREE from "three";

/**
 * P2-AVA-18 (realism-v2.ts "hairEdge"): soft hair edges without speckle.
 *
 * Every avatar material keeps three.js hashed alpha compiled in, so fades (doors, joining, leaving) only change the
 * opacity (Avatar.tsx). On hair that hash also dithers the shader's own soft alpha (fuzz shells, the hairline blend,
 * strand tips, lashes) into per-pixel noise: a sprinkle of dark dots on the forehead and a sparkling fringe round the
 * silhouette, at every distance. Here, while the person is fully opaque, those fragments go through alpha-to-coverage
 * instead (the MSAA samples carry the average density; near the camera it is drawn as small, stable clumps instead of
 * random dots); the hash returns only while fading. Without multisampling (the lite tier) coverage does nothing, so the
 * edge is a plain 0.5 alpha test.
 *
 * HELD (P2-AVA-18 review, docs/QA/human-realism-v2): the speckle goes, but the fuzz shells' light grazing colour shows
 * as a pale ring round afros and short hair, and the braid / bun scalp layer reads as blotches. Off until the shells'
 * colour is fixed.
 *
 * The canvas is created with an alpha channel: coverage writes the fragment's alpha into the samples it covers, which
 * would make the canvas see-through at hair edges. The blend keeps the destination alpha (colour replaced as usual).
 */
const CHUNK = "#include <alphahash_fragment>";
/** value noise, roughly uniform on 0…1 (two octaves), for the clump threshold */
const NOISE = /* glsl */ `
float gkEdgeH(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float gkEdgeV(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gkEdgeH(i), gkEdgeH(i + vec3(1, 0, 0)), f.x), mix(gkEdgeH(i + vec3(0, 1, 0)), gkEdgeH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(gkEdgeH(i + vec3(0, 0, 1)), gkEdgeH(i + vec3(1, 0, 1)), f.x), mix(gkEdgeH(i + vec3(0, 1, 1)), gkEdgeH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float gkEdgeNoise(vec3 p) {
  float n = gkEdgeV(p) * 0.65 + gkEdgeV(p * 2.3 + 7.1) * 0.35;
  // stretch towards a uniform spread (value noise bunches round 0.5)
  return clamp((n - 0.5) * 1.9 + 0.5, 0.0, 1.0);
}
`;

export function softAlphaEdges(m: THREE.Material): void {
  if ((m.userData as { gkSoftEdge?: boolean }).gkSoftEdge) return;
  (m.userData as { gkSoftEdge?: boolean }).gkSoftEdge = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  let msaa = true;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    msaa = renderer.getContext().getContextAttributes()?.antialias !== false;
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${NOISE}\nvoid main() {`).replace(
      CHUNK,
      /* glsl */ `
#ifdef USE_ALPHAHASH
  if (opacity < 0.999) {
    if (diffuseColor.a < getAlphaHashThreshold(vPosition)) discard;
  } else {
${
  msaa
    ? // coverage keeps the average density of the shader's soft alpha (no grey under-layer laid bare, no hard helmet
      // edge); near the camera that density is drawn as small hair clumps (a stable ~2 mm noise in the bind pose,
      // thresholded with a one-pixel ramp) instead of random per-pixel dots; once those clumps get smaller than about
      // two pixels the coverage alone carries it (a soft edge, as a photo of hair at that distance shows)
      "    float gkN = gkEdgeNoise(vPosition * 480.0);\n" +
      "    float gkCell = max(max(fwidth(vPosition.x), fwidth(vPosition.y)), fwidth(vPosition.z)) * 480.0;\n" +
      "    float gkNear = 1.0 - smoothstep(0.5, 0.9, gkCell);\n" +
      "    float gkT = diffuseColor.a - gkN;\n" +
      "    float gkA = clamp(gkT / max(fwidth(gkT), 1e-4) + 0.5, 0.0, 1.0);\n" +
      "    diffuseColor.a = mix(diffuseColor.a, gkA, gkNear * step(diffuseColor.a, 0.985));\n" +
      "    if (diffuseColor.a < 0.02) discard;"
    : "    if (diffuseColor.a < 0.5) discard;\n    diffuseColor.a = 1.0;"
}
  }
#endif
`,
    );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|gk-soft-edge`;
  m.alphaToCoverage = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.ZeroFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.needsUpdate = true;
}

/** Hair-like avatar materials: the strand / shell hair, the base models' hair cards and lashes. */
export const isHairMaterial = (m: THREE.Material): boolean => m.name === "gk-hair" || m.name === "lashes" || m.name === "haircards";
