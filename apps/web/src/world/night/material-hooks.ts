import * as THREE from "three";
import { todUniforms } from "../time-of-day/hooks";
import { ARENA } from "../footprints";
import { PORTALS, portalTransform } from "../layout";
import { SHOW_GLSL, SHOW_PERIODS_GLSL } from "./show";

/**
 * Night shader hooks for district materials (P2-WLD-21, docs/NIGHT-LIGHTING.md §4). Like the P2-WLD-19 hooks, every
 * changing value is a shared uniform (`todUniforms.uGkNight` photocell level, `uGkShowT` show clock, `uGkShowK`
 * motion amplitude): the programs compile once, at mount, and a hooked material is keyed by its uuid in the outdoor
 * StaticMerge, so it stays one batch while it animates. Each hook is installed once, before the first compile.
 *
 * The light is "baked into the shader": the Agaseke's basin uplights, the light behind the arena's perforated screen,
 * the breathing roof line — computed from the fragment's world position, no real lights (no per-pixel light loop, no
 * recompiles when they switch on).
 */

/** world position of a point in the arena door's local frame */
function arenaWorld(lx: number, lz: number): THREE.Vector3 {
  const a = PORTALS.find((p) => p.kind === "arena")!;
  const t = portalTransform(a);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  return new THREE.Vector3(t.x + lx * c + lz * s, 0, t.z - lx * s + lz * c);
}
const v3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

const UNIFORMS = "uniform float uGkNight;\nuniform float uGkShowT;\nuniform float uGkShowK;\n";
function bind(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.uniforms.uGkNight = todUniforms.uGkNight;
  sh.uniforms.uGkShowT = todUniforms.uGkShowT;
  sh.uniforms.uGkShowK = todUniforms.uGkShowK;
}
/** world position (and optionally world normal) varyings */
function worldVaryings(sh: THREE.WebGLProgramParametersWithUniforms, normal: boolean) {
  sh.vertexShader =
    `varying vec3 vGkW;\n${normal ? "varying vec3 vGkN;\n" : ""}` +
    sh.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n  vGkW = (modelMatrix * vec4(transformed, 1.0)).xyz;${normal ? "\n  vGkN = normalize(mat3(modelMatrix) * objectNormal);" : ""}`,
    );
  sh.fragmentShader = `varying vec3 vGkW;\n${normal ? "varying vec3 vGkN;\n" : ""}` + UNIFORMS + SHOW_GLSL + sh.fragmentShader;
}
function install<M extends THREE.Material>(m: M, key: string, fn: (sh: THREE.WebGLProgramParametersWithUniforms) => void): M {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    bind(sh);
    fn(sh);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/**
 * Tournament Arena perforated bronze screen: warm light from the lit inner drum shining through the holes — at night
 * a slow wave rising up the drum and turning round it, and the Imigongo lozenges (the hole pattern, four stacked per
 * panel) swelling one after another in three chases round the drum; the bronze itself grazed by the amber line at
 * its foot. Static warm glow when there is no motion.
 */
export function arenaScreenNight(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const c = arenaWorld(0, ARENA.cz);
  const y0 = 7.95;
  const y1 = ARENA.wall - 0.8;
  return install(m, "gk-night-arena-screen", (sh) => {
    worldVaryings(sh, false);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `#include <emissivemap_fragment>
  if (uGkNight > 0.001) {
    vec3 gkD = vGkW - ${v3(c)};
    float gkAng = atan(gkD.x, gkD.z) / GK_TAU + 0.5;
    float gkH = clamp((vGkW.y - ${y0.toFixed(2)}) / ${(y1 - y0).toFixed(2)}, 0.0, 1.0);
    float gkL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float gkHole = 1.0 - smoothstep(0.012, 0.05, gkL);
    float gkRow = floor(clamp((vMapUv.y - 0.035) / 0.93, 0.0, 0.999) * 4.0);
    float gkCell = floor(gkAng * 72.0);
    float gkSeq = gkSwell(uGkShowT / ${SHOW_PERIODS_GLSL.lozenges} - fract(gkCell / 24.0) - gkRow * 0.06);
    float gkWv = gkWave(uGkShowT, gkH * 0.85 - gkAng * 2.0, ${SHOW_PERIODS_GLSL.arenaWave});
    float gkA = mix(0.75, 0.3 + 0.6 * gkWv + 0.75 * gkSeq, uGkShowK);
    vec3 gkWarm = vec3(1.0, 0.6, 0.3);
    totalEmissiveRadiance += uGkNight * (gkWarm * gkHole * gkA * 2.4
      + (1.0 - gkHole) * diffuseColor.rgb * gkWarm * (0.12 + 1.1 * exp(-gkH * 5.0)));
  }`,
    );
  });
}

/**
 * Tournament Arena amber LED lines (led-halo): a touch brighter at night; the roof-edge line and the lantern's halo
 * breathe slowly (7 s), the lantern half a breath after the eave.
 */
export function arenaLedNight(m: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  return install(m, "gk-night-arena-led", (sh) => {
    worldVaryings(sh, false);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
  {
    float gkRoof = step(19.5, vGkW.y) * (1.0 - step(21.5, vGkW.y));
    float gkLantern = step(24.0, vGkW.y);
    float gkB = gkRoof * gkAnim(1.0, uGkShowT, 0.0, uGkShowK) + gkLantern * gkAnim(1.0, uGkShowT, 0.5, uGkShowK) + (1.0 - gkRoof - gkLantern);
    diffuseColor.rgb *= 1.0 + uGkNight * (0.45 * gkB + (gkB - 1.0) * 0.8);
  }`,
    );
  });
}

/**
 * Fight Games light lines (led-fight red, led-corner-blue): at night they pulse slowly (8 s), red and blue half a
 * period apart — the corners of a ring trading the light. Never below 35 % (a breath, not a blink).
 */
export function fightLedNight(m: THREE.MeshBasicMaterial, phase: number): THREE.MeshBasicMaterial {
  return install(m, `gk-night-fight-led-${phase}`, (sh) => {
    worldVaryings(sh, false);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
  diffuseColor.rgb *= 1.0 + uGkNight * (0.35 + (gkAnim(3.0, uGkShowT, ${phase.toFixed(2)}, uGkShowK) - 1.0));`,
    );
  });
}

/**
 * The Agaseke sculpture at the fountain: six grazing uplights on the plinth top (their beams run up the woven body:
 * the coils catch the light, the black motifs stay black), the light fading up the lid, a soft glint at the knot, and
 * a faint cool fill from the lit water below. Light = albedo × irradiance, so the weave reads as weave.
 */
export function agasekeNight(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return install(m, "gk-night-agaseke", (sh) => {
    worldVaryings(sh, true);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `#include <emissivemap_fragment>
  if (uGkNight > 0.001) {
    float gkH = vGkW.y - 1.05;
    vec3 gkAcc = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472 + 0.26;
      vec3 f = vec3(sin(a) * 0.98, 1.08, cos(a) * 0.98);
      vec3 L = f - vGkW;
      float d = length(L);
      L /= d;
      // beam: aimed up, a 35° cone round the vertical (the light runs up the body above the fixture)
      float cone = smoothstep(0.55, 0.92, dot(-L, vec3(0.0, 1.0, 0.0)) + 0.18) ;
      vec3 Lv = normalize((viewMatrix * vec4(L, 0.0)).xyz);
      float lam = clamp(dot(normal, Lv) * 0.6 + 0.4, 0.0, 1.0);
      gkAcc += vec3(1.0, 0.7, 0.42) * cone * lam * lam / (1.0 + 0.3 * d * d);
    }
    // the lid: the beams reach it softly; a warm glint round the knot (the halo above it is NightLights)
    float gkLid = smoothstep(2.0, 2.4, gkH);
    gkAcc += vec3(1.0, 0.8, 0.58) * gkLid * 0.25 + vec3(1.0, 0.85, 0.6) * smoothstep(3.3, 3.75, gkH) * 0.6;
    // the lit water's cool bounce on the lower body
    gkAcc += vec3(0.35, 0.55, 0.6) * (1.0 - smoothstep(0.0, 1.2, gkH)) * 0.35;
    totalEmissiveRadiance += diffuseColor.rgb * gkAcc * uGkNight * 0.95;
  }`,
    );
  });
}

/** Dim a self-lit screen at night (the arena's big screen: day brightness glares against a dark sky). */
export function screenNight(m: THREE.MeshBasicMaterial, night = 0.62): THREE.MeshBasicMaterial {
  return install(m, `gk-night-screen-${night}`, (sh) => {
    sh.fragmentShader =
      UNIFORMS +
      sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0, ${night.toFixed(2)}, uGkNight);`);
  });
}
