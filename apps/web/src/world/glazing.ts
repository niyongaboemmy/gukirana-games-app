import * as THREE from "three";
import { HALLS } from "@/rooms/layouts";
import type { GeoBatch } from "./geo";
import { paneUV, projectionOf, worldToLocal, type GlazedHall, type PaneMode } from "./glass-capture";

/**
 * Glass that shows what is really there (P2-WLD-18). One material per hall (one draw call each: every pane of that
 * hall, its shopfront, returns, windows and the door vestibule's inner doorway, is merged into it):
 *
 *  - behind vision glass: the hall's REAL interior, captured once per session from just inside its door into a cube map
 *    (colour + distance in alpha, world/GlassCapture). The shader marches the view ray through the room box and tests it
 *    against the captured distances, so the pool tables, pendants, the reception desk or the training ring stand at
 *    their true depth and move with true parallax as you walk past; where nothing is hit it lands on the room's walls
 *    (box projection). Lit by the hall's own lights (the capture is taken with them).
 *  - on the glass: low-iron glass tint, Fresnel reflection of the REAL forecourt (a small cube captured outside the
 *    door, sphere-projected), strong at grazing angles, faint when you look straight in.
 *  - until a hall is captured (and always on Lite): honest dark tinted glass with the reflection, no invented room.
 *    The capture fades in (`uHas` 0 → 1), never pops.
 *  - glass above the room's ceiling / beyond its walls reads as back-painted spandrel glass; `blind` panes have closed
 *    woven blinds behind them; `doorway` is the open inner doorway (no glass, no reflection).
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
uniform vec3 uTint;
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

// the real interior seen along V (room frame) from the glass point P0
vec3 interior(vec3 P0, vec3 V) {
  vec3 Vs = V + vec3(1e-5);
  vec3 t1 = (uBoxMin - P0) / Vs;
  // the march stops under the ceiling fixtures (slats, baffles, pendants seen edge-on from the capture point would
  // streak); above that the ceiling is box-projected, as the capture saw it
  vec3 t2 = (vec3(uBoxMax.x, min(uCut, uBoxMax.y), uBoxMax.z) - P0) / Vs;
  vec3 tf = max(t1, t2);
  float tExit = max(0.0, min(min(tf.x, tf.y), tf.z));
  // (start 30 cm in: the glass point itself lies on the captured south wall, within the distance precision)
  float t0 = min(0.3, tExit);
  // A sample is IN a surface when it lies just behind the captured distance (within a furniture-sized thickness); far
  // behind it, it is only hidden from the capture point (behind a table, a pillar): not a hit, the march goes on, so
  // nothing is smeared out behind what stands in the room.
  float ta = t0;
  float tb = tExit;
  bool wasFree = true;
  bool hit = false;
  for (int i = 1; i <= 40; i++) {
    float f = float(i) / 40.0;
    float t = t0 + (tExit - t0) * pow(f, 1.3);
    vec3 d = P0 + V * t - uC;
    float s = dec(textureLod(uCube, d, 0.0).a);
    float L = length(d);
    float e = L - s;
    if (e > 0.03 + 0.012 * s && e < 0.6 + 0.03 * s) {
      tb = t;
      hit = true;
      break;
    }
    wasFree = e <= 0.03 + 0.012 * s;
    ta = t;
  }
  if (hit && wasFree) {
    for (int i = 0; i < 5; i++) {
      float t = 0.5 * (ta + tb);
      vec3 d = P0 + V * t - uC;
      float s = dec(textureLod(uCube, d, 0.0).a);
      if (length(d) > s + 0.03 + 0.012 * s) tb = t; else ta = t;
    }
  }
  return textureLod(uCube, P0 + V * tb - uC, 0.0).rgb;
}

void main() {
  int mode = int(floor(vMode));
  vec3 Vw = normalize(vW - cameraPosition);
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

  float cosv = clamp(dot(-Vw, N), 0.0, 1.0);
  float F = 0.07 + 0.93 * pow(1.0 - cosv, 5.0);

  // behind the glass: a dim, even interior tone until the real room is captured (honest tinted glass)
  vec3 behind = uDark * (0.85 + 0.3 * smoothstep(0.0, 3.0, vRoom.y));
  if (mode <= 1 && uHas > 0.001) behind = mix(behind, interior(vRoom, Vr), uHas);
  if (mode == 2) {
    // closed woven blinds 6 cm behind the pane: horizontal slats, softly lit through the glass
    float slat = smoothstep(0.0, 0.18, abs(fract(vW.y / 0.05) - 0.5) * 2.0);
    behind = uBlind * (0.62 + 0.38 * slat);
  }

  vec3 col;
  if (mode == 1) col = behind; // open doorway: no glass
  else if (mode == 3) col = mix(uDark * 0.55, refl, max(F, 0.16)); // back-painted spandrel
  else col = mix(behind * uTint, refl, F);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** the interior tone of each hall's glass before (or without) its capture: dim, close to the room's own colour */
const DARK: Record<GlazedHall, string> = {
  pool: "#100d0b",
  ludo: "#1c160f",
  igisoro: "#140d08",
  arena: "#120d0a",
  admin: "#1e1c19",
  fight: "#111012",
};

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
      uRefl: { value: null },
      uHas: { value: 0 },
      uReflHas: { value: 0 },
      uMaxD: { value: pr.maxD },
      uW2L: { value: new THREE.Matrix4().fromArray(worldToLocal(game)) },
      uHalfD: { value: L.size.d / 2 },
      uDoorX: { value: L.door.x },
      uC: { value: new THREE.Vector3(...pr.at) },
      uBoxMin: { value: new THREE.Vector3(...pr.min) },
      uBoxMax: { value: new THREE.Vector3(...pr.max) },
      uCut: { value: pr.cut },
      uReflC: { value: new THREE.Vector3() },
      uReflR: { value: 30 },
      uTint: { value: new THREE.Color(0.86, 0.9, 0.88) },
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
