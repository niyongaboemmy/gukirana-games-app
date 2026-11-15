import * as THREE from "three";
import { HALLS } from "@/rooms/layouts";
import type { GeoBatch } from "./geo";
import { paneUV, projectionOf, worldToLocal, type GlazedHall, type PaneMode } from "./glass-capture";

/**
 * Facade glazing (P2-WLD-18): smoked glass, the same on every building, like the Tournament Arena's glass band. One
 * material per hall (one draw call each: its shopfront, returns, windows and its door vestibule's inner doorway).
 *
 *  - the glass: near-black body (about 5 % visible transmission), a subtle Fresnel reflection of the REAL forecourt (a
 *    cube captured outside the door, people left out, sphere-projected), the sky until it is captured; a thin grid of
 *    light-grey mullions where the facade has none of its own (Pool Hall, Ludo Lounge).
 *  - never readable interior content: only very close up, the barest warm glow of the room's own light (its capture,
 *    box-projected, from a high mip level), so no furniture can tear, ghost or smear.
 *  - the OPEN inner doorway of a door vestibule (no glass) shows the real hall: the capture (colour + distance, taken
 *    from the forecourt through the door line, world/GlassCapture) reprojected at true depth, filtered by distance.
 *  - glass above the room's ceiling / beyond its walls is back-painted spandrel; `blind` panes have closed blinds.
 *  - until a hall is captured (and always on Lite): the same smoked glass with the sky; captures fade in.
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
uniform samplerCube uCube;
uniform float uSize;
uniform samplerCube uRefl;
uniform float uHas;
uniform float uReflHas;
uniform float uMaxD;
uniform mat4 uW2L;
uniform vec3 uC;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uCut;
uniform vec3 uReflC;
uniform float uReflR;
uniform vec3 uSmoke;
uniform float uGrid;
uniform float uDoorHalf;
uniform vec3 uDark;
uniform vec3 uBlind;
varying vec3 vW;
varying vec3 vN;
varying vec3 vRoom;
varying float vMode;

float dec(float a) { return a * a * uMaxD; }

vec3 skyRefl(vec3 R) {
  vec3 sky = mix(vec3(0.56, 0.64, 0.7), vec3(0.24, 0.4, 0.6), smoothstep(0.05, 0.7, R.y));
  return mix(vec3(0.17, 0.16, 0.14), sky, smoothstep(-0.06, 0.12, R.y));
}

// where the view ray leaves the room box (the march stops under the ceiling fixtures)
float boxExit(vec3 P0, vec3 V) {
  vec3 Vs = V + vec3(1e-5);
  vec3 t1 = (uBoxMin - P0) / Vs;
  vec3 t2 = (vec3(uBoxMax.x, min(uCut, uBoxMax.y), uBoxMax.z) - P0) / Vs;
  vec3 tf = max(t1, t2);
  return max(0.0, min(min(tf.x, tf.y), tf.z));
}

// Through the smoked glass: the room only as a soft impression of its light and colour (the capture, box-projected,
// read from a high mip level): no furniture edges, nothing that could tear or ghost.
vec3 impression(vec3 P0, vec3 V) {
  vec3 d = P0 + V * boxExit(P0, V) - uC;
  return textureLod(uCube, d, log2(uSize / 12.0)).rgb;
}

// Through an OPEN doorway (no glass, seen down the vestibule, nearly head-on): the real room at its true depth, the ray
// reprojected against the captured distances; a ray the capture point cannot see ends on the room's wall instead of
// smearing what stands in front of it. Slightly filtered (mip >= 1), never sharper than the capture.
vec3 doorway(vec3 P0, vec3 V, float d0, float pixAng) {
  float tExit = boxExit(P0, V);
  float ta = 0.0;
  float tb = tExit;
  bool wasFree = true;
  bool hit = false;
  for (int i = 1; i <= 40; i++) {
    float f = float(i) / 40.0;
    float t = tExit * pow(f, 1.4);
    vec3 d = P0 + V * t - uC;
    float s = dec(textureLod(uCube, d, 0.0).a);
    float e = length(d) - s;
    float eps = 0.025 + 0.008 * s;
    if (e > eps && e < 0.5 + 0.025 * s) {
      tb = t;
      hit = true;
      break;
    }
    wasFree = e <= eps;
    ta = t;
  }
  if (hit && wasFree) {
    for (int i = 0; i < 6; i++) {
      float t = 0.5 * (ta + tb);
      vec3 d = P0 + V * t - uC;
      float s = dec(textureLod(uCube, d, 0.0).a);
      if (length(d) - s > 0.025 + 0.008 * s) tb = t; else ta = t;
    }
  }
  if (!hit) tb = tExit;
  vec3 dh = P0 + V * tb - uC;
  float ang = pixAng * (d0 + tb) / max(length(dh), 0.2);
  float lod = clamp(log2(max(ang * uSize / 1.5708, 2.0)), 1.0, 6.0);
  return textureLod(uCube, dh, lod).rgb;
}

void main() {
  int mode = int(floor(vMode));
  vec3 Vw = normalize(vW - cameraPosition);
  // (taken in uniform control flow: the angular size of this pixel, for the capture's mip level)
  float pixAng = length(fwidth(Vw));
  float d0 = length(vW - cameraPosition);
  vec3 N = normalize(vN);
  if (dot(N, Vw) > 0.0) N = -N;
  vec3 Vr = normalize(mat3(uW2L) * Vw);
  // vision glass above the ceiling or beyond the side walls: spandrel (the room is not behind it)
  bool inRoom = vRoom.y < uBoxMax.y - 0.02 && vRoom.x > uBoxMin.x + 0.02 && vRoom.x < uBoxMax.x - 0.02;
  if ((mode == 0 || mode == 1) && !inRoom) mode = 3;

  // reflection of the real forecourt (sphere-projected cube), or the sky until it is captured
  vec3 R = reflect(Vw, N);
  vec3 rel = vW - uReflC;
  float b = dot(rel, R);
  float c = dot(rel, rel) - uReflR * uReflR;
  float h = b * b - c;
  vec3 rd = (c < 0.0 && h > 0.0) ? rel + R * (-b + sqrt(h)) : R;
  vec3 refl = mix(skyRefl(R), textureLod(uRefl, rd, 0.0).rgb, uReflHas);

  // smoked glass, like the arena's glass band: near-black, a subtle Fresnel reflection of the real forecourt
  float cosv = clamp(dot(-Vw, N), 0.0, 1.0);
  float F = 0.06 + 0.94 * pow(1.0 - cosv, 5.0);

  vec3 behind = uDark;
  // never readable interior content: only very close up, the barest warm glow of the room's light through the smoke
  if (mode == 0 && uHas > 0.001) behind += impression(vRoom, Vr) * (uHas * (1.0 - smoothstep(2.5, 9.0, d0)));
  if (mode == 1 && uHas > 0.001) behind = mix(behind, doorway(vRoom, Vr, d0, pixAng), uHas);
  if (mode == 2) {
    // closed woven blinds behind the pane: horizontal slats
    float slat = smoothstep(0.0, 0.18, abs(fract(vW.y / 0.05) - 0.5) * 2.0);
    behind = uBlind * (0.62 + 0.38 * slat);
  }

  vec3 col;
  if (mode == 1) col = behind; // open doorway: no glass
  else if (mode == 3) col = mix(uDark * 0.4, refl, max(F, 0.14)); // back-painted spandrel
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

/** the smoked glass's body colour (and the spandrels'): the same near-black for every hall */
const DARK: Record<GlazedHall, string> = {
  // one smoked-glass body for every building (consistency over showing inside): near-black, a touch cool
  pool: "#07090b",
  ludo: "#07090b",
  igisoro: "#07090b",
  arena: "#07090b",
  admin: "#07090b",
  fight: "#07090b",
};
/** mullion module (m) drawn on glazing that has no physical mullions; 0 = the facade has its own */
const GRID: Record<GlazedHall, number> = { pool: 1.63, ludo: 1.62, igisoro: 0, arena: 0, admin: 0, fight: 0 };

const MATS = new Map<string, THREE.ShaderMaterial>();

/** The glazing material of one hall (shared by its facade batch and its door vestibule; GlassCapture feeds it). */
export function glazingMaterial(game: GlazedHall, tier: "lite" | "standard"): THREE.ShaderMaterial {
  const key = `${game}:${tier}`;
  const hit = MATS.get(key);
  if (hit) return hit;
  const pr = projectionOf(game);
  const L = HALLS[game];
  const m = new THREE.ShaderMaterial({
    name: `glazing:${game}`,
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uCube: { value: null },
      uSize: { value: 512 },
      uC: { value: new THREE.Vector3(...pr.at) },
      uRefl: { value: null },
      uHas: { value: 0 },
      uReflHas: { value: 0 },
      uMaxD: { value: pr.maxD },
      uW2L: { value: new THREE.Matrix4().fromArray(worldToLocal(game)) },
      uHalfD: { value: L.size.d / 2 },
      uDoorX: { value: L.door.x },
      uBoxMin: { value: new THREE.Vector3(...pr.min) },
      uBoxMax: { value: new THREE.Vector3(...pr.max) },
      uCut: { value: pr.cut },
      uReflC: { value: new THREE.Vector3() },
      uReflR: { value: 30 },
      // smoked glass: about 5 % visible transmission, faintly warm
      uSmoke: { value: new THREE.Color(0.06, 0.05, 0.045) },
      // the pane grid drawn on glazing without mullions of its own (Pool Hall, Ludo Lounge): module from the door edges
      uGrid: { value: GRID[game] },
      uDoorHalf: { value: 1.7 },
      uDark: { value: new THREE.Color(DARK[game]) },
      uBlind: { value: new THREE.Color("#b9ab92").multiplyScalar(tier === "lite" ? 0.5 : 0.6) },
    },
  });
  MATS.set(key, m);
  return m;
}

/** every glazing material created so far (GlassCapture updates all tiers of a hall) */
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
