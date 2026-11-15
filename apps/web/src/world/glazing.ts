import * as THREE from "three";
import { HALLS } from "@/rooms/layouts";
import type { GeoBatch } from "./geo";
import { paneUV, roomBox, worldToLocal, type GlazedHall, type PaneMode } from "./glass-capture";

/**
 * Hall glazing (P2-WLD-18, P2-WLD-20): smoked glass, the same on every building and every door, like the Tournament
 * Arena's glass band. One facade material per hall (one draw call: its shopfront, returns and windows), one for its
 * door leaves (the sliding doors, double-sided) and one for the inner doors at the end of its door vestibule.
 *
 *  - the glass: near-black body (about 5 % visible transmission), a subtle Fresnel reflection of the REAL forecourt (a
 *    cube captured outside the door, people left out, sphere-projected), the sky until it is captured; a thin grid of
 *    light-grey mullions where the facade has none of its own (Pool Hall, Ludo Lounge).
 *  - never any interior content: close up only the barest constant warm glow through the smoke (the room's light),
 *    so nothing can tear, ghost, smear or pop.
 *  - glass above the room's ceiling / beyond its walls is back-painted spandrel; `blind` panes have closed blinds.
 *  - until a hall's reflection is captured (and always on Lite): the same smoked glass with the sky; it fades in.
 */

const VERT = /* glsl */ `
#include <fog_pars_vertex>
uniform mat4 uW2L;
uniform float uHalfD;
uniform float uDoorX;
varying vec3 vW;
varying vec3 vN;
varying vec3 vRoom;
varying float vMode;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec3 l = (uW2L * w).xyz;
  vRoom = l + vec3(uDoorX, 0.0, uHalfD - uv.y);
  vMode = uv.x;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform samplerCube uRefl;
uniform float uReflHas;
uniform float uReflK;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uReflC;
uniform float uReflR;
uniform vec3 uSmoke;
uniform vec3 uGlow;
uniform float uGrid;
uniform float uDoorHalf;
uniform vec3 uDark;
uniform vec3 uBlind;
varying vec3 vW;
varying vec3 vN;
varying vec3 vRoom;
varying float vMode;

vec3 skyRefl(vec3 R) {
  vec3 sky = mix(vec3(0.56, 0.64, 0.7), vec3(0.24, 0.4, 0.6), smoothstep(0.05, 0.7, R.y));
  return mix(vec3(0.17, 0.16, 0.14), sky, smoothstep(-0.06, 0.12, R.y));
}

void main() {
  int mode = int(floor(vMode));
  vec3 Vw = normalize(vW - cameraPosition);
  float d0 = length(vW - cameraPosition);
  vec3 N = normalize(vN);
  if (dot(N, Vw) > 0.0) N = -N;
  // vision glass above the ceiling or beyond the side walls: spandrel (the room is not behind it); door leaves move,
  // they are never tested against the room
  bool inRoom = vRoom.y < uBoxMax.y - 0.02 && vRoom.x > uBoxMin.x + 0.02 && vRoom.x < uBoxMax.x - 0.02;
  if (mode == 0 && !inRoom) mode = 3;

  // reflection of the real forecourt (sphere-projected cube), or the sky until it is captured
  vec3 R = reflect(Vw, N);
  vec3 rel = vW - uReflC;
  float b = dot(rel, R);
  float c = dot(rel, rel) - uReflR * uReflR;
  float h = b * b - c;
  vec3 rd = (c < 0.0 && h > 0.0) ? rel + R * (-b + sqrt(h)) : R;
  vec3 refl = mix(skyRefl(R), textureLod(uRefl, rd, 0.0).rgb, uReflHas) * uReflK;

  // smoked glass, like the arena's glass band: near-black, a subtle Fresnel reflection of the real forecourt
  float cosv = clamp(dot(-Vw, N), 0.0, 1.0);
  float F = 0.06 + 0.94 * pow(1.0 - cosv, 5.0);

  // never readable content behind it: close up only the barest constant warm glow of the room's light
  vec3 behind = uDark + uGlow * (1.0 - smoothstep(2.5, 9.0, d0));
  if (mode == 2) {
    // closed woven blinds behind the pane: horizontal slats
    float slat = smoothstep(0.0, 0.18, abs(fract(vW.y / 0.05) - 0.5) * 2.0);
    behind = uBlind * (0.62 + 0.38 * slat);
  }

  vec3 col;
  if (mode == 3) col = mix(uDark * 0.4, refl, max(F, 0.14)); // back-painted spandrel
  else col = behind * uSmoke * (1.0 - F) + refl * F;
  // thin light-grey mullions in a grid where the facade has none of its own (the arena band's module)
  if (uGrid > 0.0 && mode == 0) {
    float u = abs(vRoom.x - uDoorHalf);
    float gx = abs(fract(u / uGrid + 0.5) - 0.5) * uGrid;
    float gy = min(abs(vRoom.y - 4.2), abs(vRoom.y - 0.06));
    float line = (1.0 - smoothstep(0.02, 0.032, gx)) * step(uDoorHalf, abs(vRoom.x)) + (1.0 - smoothstep(0.02, 0.032, gy));
    col = mix(col, vec3(0.34, 0.36, 0.38), clamp(line, 0.0, 1.0) * (1.0 - smoothstep(30.0, 70.0, d0)));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** the smoked glass's body colour (and the spandrels'): one near-black, a touch cool, for every building */
const DARK = "#07090b";
/** mullion module (m) drawn on glazing that has no physical mullions; 0 = the facade has its own */
const GRID: Record<GlazedHall, number> = { pool: 1.63, ludo: 1.62, igisoro: 0, arena: 0, admin: 0, fight: 0 };

/** which glass of a hall: its facade, its sliding door leaves, the inner doors at the end of its vestibule */
export type GlassPart = "facade" | "door" | "inner";
const MATS = new Map<string, THREE.ShaderMaterial>();

function make(game: GlazedHall, tier: "lite" | "standard", part: GlassPart): THREE.ShaderMaterial {
  const box = roomBox(game);
  const L = HALLS[game];
  return new THREE.ShaderMaterial({
    name: `glazing:${game}:${part}`,
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    // door leaves are seen from both sides (from the vestibule on the way in)
    side: part === "facade" ? THREE.FrontSide : THREE.DoubleSide,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uRefl: { value: null },
      uReflHas: { value: 0 },
      // the inner doors stand in the dim vestibule: the forecourt reflects on them at about half strength
      uReflK: { value: part === "inner" ? 0.5 : 1 },
      uW2L: { value: new THREE.Matrix4().fromArray(worldToLocal(game)) },
      uHalfD: { value: L.size.d / 2 },
      uDoorX: { value: L.door.x },
      uBoxMin: { value: new THREE.Vector3(...box.min) },
      uBoxMax: { value: new THREE.Vector3(...box.max) },
      uReflC: { value: new THREE.Vector3() },
      uReflR: { value: 30 },
      // smoked glass: about 5 % visible transmission, faintly warm
      uSmoke: { value: new THREE.Color(0.06, 0.05, 0.045) },
      uGlow: { value: new THREE.Color(tier === "lite" ? 0 : 0.5, tier === "lite" ? 0 : 0.38, tier === "lite" ? 0 : 0.26) },
      // the pane grid drawn on glazing without mullions of its own (Pool Hall, Ludo Lounge): module from the door edges
      uGrid: { value: GRID[game] },
      uDoorHalf: { value: 1.7 },
      uDark: { value: new THREE.Color(DARK) },
      uBlind: { value: new THREE.Color("#b9ab92").multiplyScalar(tier === "lite" ? 0.5 : 0.6) },
    },
  });
}

/** The smoked glass of one hall (shared, never disposed: GlassCapture feeds every part of every tier). */
export function glazingMaterial(game: GlazedHall, tier: "lite" | "standard", part: GlassPart = "facade"): THREE.ShaderMaterial {
  const key = `${game}:${tier}:${part}`;
  let m = MATS.get(key);
  if (!m) MATS.set(key, (m = make(game, tier, part)));
  return m;
}

/** every glazing material of a hall created so far (GlassCapture updates all tiers and parts of a hall) */
export const glazingMaterials = (game: GlazedHall) => [...MATS.entries()].filter(([k]) => k.startsWith(`${game}:`)).map(([, m]) => m);

/** A pane (facing +z of the current frame) carrying its mode and the plane that maps to the room's south wall. */
export function paneGeometry(mode: PaneMode, zRef: number, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const [u, v] = paneUV(mode, zRef);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}

/**
 * Add a pane to a district batch (material key `glazing-<hall>`). `zRef`: the local z (door frame of the building,
 * NOT the current sub-frame) of the plane that maps to the room's south wall, normally the glass line itself.
 */
export function glazingPane(b: GeoBatch, game: GlazedHall, mode: PaneMode, zRef: number, w: number, h: number, p: [number, number, number], rotY = 0) {
  b.add(`glazing-${game}`, paneGeometry(mode, zRef, w, h), { p, r: [0, rotY, 0] });
}
