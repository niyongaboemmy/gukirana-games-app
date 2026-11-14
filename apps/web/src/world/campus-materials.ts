import * as THREE from "three";
import { rng } from "./textures";
import type { Tier } from "./materials";

/**
 * Road materials of the campus frontage and loop (P2-WLD-12). Detail comes from the shader, not from geometry:
 *  - asphalt: a fine aggregate texture (seeded canvas, 4 m tile) × world-space tone variation (sun-bleached and
 *    darker patches, darker wheel tracks along the lanes, a few patch repairs), so long straight roads never repeat;
 *  - road paint: matte thermoplastic, slightly worn by the same world-space noise.
 * Shared per tier (like world/materials.ts), so the outdoor StaticMerge folds every road part into one draw per look.
 */

let cache: { tier: Tier; m: Record<string, THREE.Material> } | null = null;

/** Fine asphalt aggregate (256², 1 tile = 4 m): mid grey with light chips, dark binder and hairline cracks. */
function asphaltTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = rng(3141);
  g.fillStyle = "#6e6e6c";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(20,20,22,${0.25 + r() * 0.3})` : `rgba(200,198,190,${0.12 + r() * 0.25})`;
    const s = 0.6 + r() * 1.6;
    g.fillRect(r() * S, r() * S, s, s);
  }
  // hairline cracks (wrap-safe: short polylines kept inside the tile)
  g.strokeStyle = "rgba(15,15,15,0.35)";
  g.lineWidth = 0.7;
  for (let k = 0; k < 6; k++) {
    let x = 20 + r() * (S - 40);
    let y = 20 + r() * (S - 40);
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 7; j++) {
      x = Math.min(S - 4, Math.max(4, x + (r() - 0.5) * 22));
      y = Math.min(S - 4, Math.max(4, y + (r() - 0.5) * 22));
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** GLSL value noise on world xz (shared by the asphalt and paint shaders). */
const NOISE = `
float gkH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gkN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gkH(i), gkH(i + vec2(1.0, 0.0)), u.x), mix(gkH(i + vec2(0.0, 1.0)), gkH(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

function worldNoise(m: THREE.MeshStandardMaterial, key: string, body: string) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = "varying vec2 vGkR;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vGkR = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = "varying vec2 vGkR;\n" + NOISE + "\n" + sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n${body}`);
  };
  m.customProgramCacheKey = () => key;
}

export function campusMaterials(tier: Tier): Record<string, THREE.Material> {
  if (cache && cache.tier === tier) return cache.m;
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: "#7c7d80", roughness: 0.93, metalness: 0, envMapIntensity: 0.35 });
  // UVs are world metres / 4 (GeoBatch tile 4): the texture is the aggregate; the shader adds the large-scale life
  worldNoise(
    asphalt,
    "gk-asphalt",
    `{
      float big = gkN(vGkR * 0.035) * 0.6 + gkN(vGkR * 0.11) * 0.4;      // bleached / darker stretches
      float spot = smoothstep(0.78, 0.86, gkN(vGkR * 0.06 + 17.0));        // patch repairs (darker, fresher)
      float oil = smoothstep(0.82, 0.95, gkN(vGkR * 0.45 + 3.0)) * 0.12;   // oil drips
      diffuseColor.rgb *= (0.82 + 0.3 * big) * (1.0 - 0.28 * spot) * (1.0 - oil);
    }`,
  );
  const paint = (color: string, key: string) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    worldNoise(m, key, `diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.25, 0.7, gkN(vGkR * 1.7));`);
    return m;
  };
  const m: Record<string, THREE.Material> = {
    asphaltC: asphalt,
    paintW: paint("#e9e6dc", "gk-paint-w"),
  };
  cache = { tier, m };
  return m;
}
