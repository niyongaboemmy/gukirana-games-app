"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Tier } from "./materials";
import { tod } from "./time-of-day/store";
import { todUniforms } from "./time-of-day/hooks";
import { buildRig } from "./night/rig";
import { FADE, SHOW_GLSL } from "./night/show";

/**
 * Artificial light at night (P2-WLD-19, P2-WLD-21: docs/NIGHT-LIGHTING.md) without real lights. The campus rig
 * (world/night/rig.ts) is drawn in three instanced draws:
 *  - pools: light on the ground — flat, additive discs with a bright centre and a soft falloff (lamps, canopies,
 *    doors, bench / planter / bollard accents, the fountain court, coloured spill at Fight Games);
 *  - halos: the visible sources — camera-facing additive HDR glows (lamp heads, festoon bulbs, fixture glints,
 *    beacons, the arena lantern), kept ≥ a few pixels from far away so the campus reads as lit from the aerial view
 *    (not on Lite);
 *  - washes: light on walls — vertical quads that MULTIPLY the colour behind them (out = dst · (1 + light)): uplight
 *    grazing, downlight scallops and even sign washes that bring out the wall's own texture (brick, lime, limestone)
 *    while glass and dark metal stay dark, as under real light.
 * Each fixture has its own photocell threshold inside its group (signs → lamps → facades → accents): the campus
 * lights up in a staggered wave at dusk and goes out in reverse at dawn. Animated fixtures (the arena lantern, the
 * Fight Games spill, beacons, festoon shimmer) follow the shared show clock (todUniforms.uGkShowT / uGkShowK: static
 * on Lite and with reduced motion). Zero real lights, no per-pixel light loops, no recompiles: hidden (0 draws) by
 * day, drawn on the first frames after mount so their programs exist before any dusk.
 */

const SHOW_UNIFORMS = "uniform float uGkShowT;\nuniform float uGkShowK;\n";

const poolVert = /* glsl */ `
attribute vec4 aFx; // threshold, strength, anim, phase
attribute vec3 aCol;
uniform float uOn;
uniform float uFogD;
${SHOW_UNIFORMS}
${SHOW_GLSL}
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float on = smoothstep(aFx.x, aFx.x + ${FADE.toFixed(2)}, uOn);
  float d = length(mv.xyz) * uFogD;
  vC = aCol * on * aFx.y * exp(-d * d) * gkAnim(aFx.z, uGkShowT, aFx.w, uGkShowK);
}`;
const poolFrag = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
varying vec3 vC;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || dot(vC, vC) < 1e-6) discard;
  float f = (1.0 - r2) * (1.0 - r2);
  float hot = f * (0.45 + 0.55 * exp(-r2 * 5.0));
  gl_FragColor = vec4(vC * hot * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const haloVert = /* glsl */ `
attribute vec4 aFx;
attribute vec3 aCol;
attribute float aSize;
uniform float uOn;
uniform float uFogD;
${SHOW_UNIFORMS}
${SHOW_GLSL}
varying vec2 vUv;
varying vec3 vC;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec3 c = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float dist = length(mv.xyz);
  // ≥ ~3 px wide from afar (the campus reads as lit from above), ~0.8 m across close up for a lamp head
  float far = max(1.0, dist / 60.0);
  mv.xy += position.xy * 0.8 * aSize * far;
  gl_Position = projectionMatrix * mv;
  float on = smoothstep(aFx.x, aFx.x + ${FADE.toFixed(2)}, uOn);
  float d = dist * uFogD;
  vC = aCol * on * aFx.y * exp(-d * d) / far * gkAnim(aFx.z, uGkShowT, aFx.w, uGkShowK);
}`;
const haloFrag = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
varying vec3 vC;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || dot(vC, vC) < 1e-6) discard;
  float g = exp(-r2 * 14.0) * 1.4 + exp(-r2 * 3.5) * 0.12;
  gl_FragColor = vec4(vC * g * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const washVert = /* glsl */ `
attribute vec4 aFx;
attribute vec3 aCol;
attribute vec2 aShape; // mode (0 up, 1 down, 2 even), scallops
uniform float uOn;
uniform float uFogD;
${SHOW_UNIFORMS}
${SHOW_GLSL}
varying vec2 vUv;
varying vec3 vC;
varying vec2 vShape;
void main() {
  vUv = uv;
  vShape = aShape;
  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float on = smoothstep(aFx.x, aFx.x + ${FADE.toFixed(2)}, uOn);
  float d = length(mv.xyz) * uFogD;
  vC = aCol * on * aFx.y * exp(-d * d) * gkAnim(aFx.z, uGkShowT, aFx.w, uGkShowK);
}`;
const washFrag = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
varying vec3 vC;
varying vec2 vShape;
void main() {
  if (dot(vC, vC) < 1e-6) discard;
  float v = vUv.y;
  float u = vUv.x;
  float vert;
  float spread;
  if (vShape.x < 0.5) { vert = exp(-v * 1.6) * smoothstep(0.0, 0.03, v) + 0.12; spread = 0.16 + 0.34 * v; }
  else if (vShape.x < 1.5) { vert = exp(-(1.0 - v) * 1.8) * smoothstep(1.0, 0.96, v) + 0.1; spread = 0.16 + 0.34 * (1.0 - v); }
  else { vert = smoothstep(0.0, 0.2, v) * smoothstep(1.0, 0.8, v) * 0.9 + 0.1; spread = 1.0; }
  float edge = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
  float across = 1.0;
  if (vShape.y > 0.5) {
    // light cones from fixtures spaced along the wall, widening away from the fixture
    float x = fract(u * vShape.y) - 0.5;
    across = exp(-x * x / (spread * spread * 0.5));
  }
  // multiplicative pass: the blend computes dst · (1 + light); additive pass: the light a mid-dark wall sends back
  gl_FragColor = vec4(vC * vert * edge * across * uGain, 1.0);
  #ifdef GK_ADD
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #endif
}`;

function lightsMaterial(vert: string, frag: string, gain: number, mode: "add" | "mul") {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uOn: { value: 0 },
      uFogD: { value: 0.00085 },
      uGain: { value: gain },
      uGkShowT: todUniforms.uGkShowT,
      uGkShowK: todUniforms.uGkShowK,
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  if (mode === "add") m.blending = THREE.AdditiveBlending;
  else {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.OneFactor;
  }
  return m;
}

const _c = new THREE.Color();
const lin = (hex: string) => _c.set(hex); // THREE.Color converts sRGB hex to the linear working space

function attrs(list: { thr: number; k: number; anim?: number; phase?: number; col: string }[]) {
  const fx = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
  list.forEach((p, i) => {
    fx.setXYZW(i, p.thr, p.k, p.anim ?? 0, p.phase ?? 0);
    const c = lin(p.col);
    col.setXYZ(i, c.r, c.g, c.b);
  });
  return { fx, col };
}

export function NightLights({ tier, fogD }: { tier: Tier; fogD: number }) {
  const meshes = useMemo(() => {
    const rig = buildRig(tier);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();

    // pools
    const flat = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const pa = attrs(rig.pools);
    flat.setAttribute("aFx", pa.fx);
    flat.setAttribute("aCol", pa.col);
    const pool = new THREE.InstancedMesh(flat, lightsMaterial(poolVert, poolFrag, 0.16, "add"), rig.pools.length);
    rig.pools.forEach((p, i) => pool.setMatrixAt(i, m.compose(v.set(p.x, (p.y ?? 0) + 0.05, p.z), q.identity(), s.set(p.r, 1, p.r))));
    pool.renderOrder = 1;
    pool.name = "night-pools";

    // halos (not on Lite)
    let halo: THREE.InstancedMesh | null = null;
    if (tier !== "lite") {
      const quad = new THREE.PlaneGeometry(1, 1);
      const ha = attrs(rig.halos);
      quad.setAttribute("aFx", ha.fx);
      quad.setAttribute("aCol", ha.col);
      quad.setAttribute("aSize", new THREE.InstancedBufferAttribute(Float32Array.from(rig.halos.map((h) => h.size)), 1));
      halo = new THREE.InstancedMesh(quad, lightsMaterial(haloVert, haloFrag, 1.6, "add"), rig.halos.length);
      rig.halos.forEach((h, j) => halo!.setMatrixAt(j, m.makeTranslation(...h.p)));
      halo.renderOrder = 3;
      halo.name = "night-halos";
    }

    // washes
    const wq = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const wa = attrs(rig.washes);
    wq.setAttribute("aFx", wa.fx);
    wq.setAttribute("aCol", wa.col);
    wq.setAttribute("aShape", new THREE.InstancedBufferAttribute(Float32Array.from(rig.washes.flatMap((w) => [w.mode, w.scallops])), 2));
    const wash = new THREE.InstancedMesh(wq, lightsMaterial(washVert, washFrag, 1, "mul"), rig.washes.length);
    rig.washes.forEach((w, i) => wash.setMatrixAt(i, m.compose(v.set(...w.p), q.setFromAxisAngle(up, w.rotY), s.set(w.w, w.h, 1))));
    wash.renderOrder = 2;
    wash.name = "night-washes";
    // its additive twin (same instances): dark walls (board-formed concrete, charcoal) still read as lit — a
    // multiplication alone leaves a near-black surface near black
    const addMat = lightsMaterial(washVert, washFrag, 0.05, "add");
    addMat.defines = { GK_ADD: "" };
    const washAdd = new THREE.InstancedMesh(wq, addMat, rig.washes.length);
    washAdd.instanceMatrix = wash.instanceMatrix;
    washAdd.renderOrder = 2;
    washAdd.name = "night-washes-add";

    for (const im of [pool, halo, wash, washAdd]) {
      if (!im) continue;
      im.frustumCulled = false;
      im.userData.noMerge = true;
    }
    return { pool, halo, wash, washAdd };
  }, [tier]);
  useEffect(
    () => () => {
      for (const im of [meshes.pool, meshes.halo, meshes.wash, meshes.washAdd]) {
        if (!im) continue;
        im.geometry.dispose();
        (im.material as THREE.Material).dispose();
        im.dispose();
      }
    },
    [meshes],
  );
  // drawn on the first frames whatever the hour (their programs compile now, not in the middle of a dusk)
  const warm = useRef(4);
  useFrame(() => {
    const on = tod.look.lights;
    const show = on > 0.001 || warm.current > 0;
    if (warm.current > 0) warm.current--;
    for (const im of [meshes.pool, meshes.halo, meshes.wash, meshes.washAdd]) {
      if (!im) continue;
      im.visible = show;
      const u = (im.material as THREE.ShaderMaterial).uniforms;
      u.uOn!.value = on;
      u.uFogD!.value = fogD;
    }
  });
  return (
    <group name="night-lights" userData={{ noMerge: true }}>
      <primitive object={meshes.pool} />
      {meshes.halo && <primitive object={meshes.halo} />}
      <primitive object={meshes.wash} />
      <primitive object={meshes.washAdd} />
    </group>
  );
}
