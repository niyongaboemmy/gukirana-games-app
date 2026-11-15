"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Tier } from "./materials";
import { LAMPS } from "./obstacles";
import { WALK_PROPS } from "./walk-mesh";
import { FORECOURT, GUARD_POSTS, hash01, STREET_LIGHTS } from "./campus";
import { PORTALS, portalTransform } from "./layout";
import { GATE_Z } from "./gate/Gate";
import { tod } from "./time-of-day/store";

/**
 * Artificial light at night (P2-WLD-19, docs/TIME-OF-DAY.md §6) without real lights: every lamp on the campus gets
 *  - a light pool on the ground: a flat, additive, warm (3000 K LED) disc with a bright centre and a soft falloff —
 *    one instanced draw for all of them;
 *  - a glow round its head: a camera-facing additive halo, HDR (it blooms on Standard), kept ≥ a few pixels from
 *    far away so the campus reads as lit from the aerial view — a second instanced draw (not on Lite).
 * Plaza lamps, the walk lamps, the street lights along the road / loop / car parks, every hall door and the arrival
 * gate and forecourt. They switch on with the photocell curve (tod.look.lights), each at its own threshold — a
 * staggered wave over ~1 minute of dusk, like real photocells — and off again at dawn. Zero real lights: no extra
 * per-pixel lighting cost and no shader recompiles. Hidden entirely (0 draw calls) by day; drawn on the first frames
 * after mount so their programs are compiled before any dusk.
 */

interface Pool {
  x: number;
  y: number;
  z: number;
  r: number;
  /** strength (centre brightness) */
  k: number;
  /** head position for the halo (null: no visible head) */
  head: [number, number, number] | null;
}

function pools(tier: Tier): Pool[] {
  const out: Pool[] = [];
  for (const p of LAMPS) out.push({ x: p.x, y: 0, z: p.z, r: 5.4, k: 1, head: [p.x, 4.5, p.z] });
  WALK_PROPS.filter((p) => p.kind === "lamp").forEach((p, i) => {
    if (tier === "lite" && i % 2) return;
    const hx = p.x + Math.sin(p.rotY) * 0.3;
    const hz = p.z + Math.cos(p.rotY) * 0.3;
    out.push({ x: hx, y: 0, z: hz, r: 5.4, k: 1, head: [hx, 4.5, hz] });
  });
  for (const l of STREET_LIGHTS) {
    // the lantern hangs 1.55 m out on its arm, 7.85 m up, over the road
    const hx = l.x + Math.sin(l.rotY) * 1.55;
    const hz = l.z + Math.cos(l.rotY) * 1.55;
    out.push({
      x: l.x + Math.sin(l.rotY) * 2.2,
      y: l.y,
      z: l.z + Math.cos(l.rotY) * 2.2,
      r: 8.5,
      k: 0.9,
      head: [hx, l.y + 7.82, hz],
    });
  }
  // hall doors: the canopy downlights spill onto the forecourt (the doors are findable at night)
  for (const d of PORTALS) {
    const t = portalTransform(d);
    out.push({ x: t.entryX, y: 0, z: t.entryZ, r: 4.6, k: d.kind === "soon" ? 0.45 : 1.15, head: null });
  }
  // the arrival gate (canopy lights over the lanes), its forecourt and the guard posts
  out.push({ x: 0, y: 0, z: GATE_Z - 1, r: 6, k: 1.1, head: null });
  out.push({ x: 0, y: 0, z: GATE_Z + 3.5, r: 5, k: 0.9, head: null });
  out.push({ x: 0, y: 0, z: (FORECOURT.walk.z0 + FORECOURT.walk.z1) / 2, r: 6, k: 0.8, head: null });
  for (const g of GUARD_POSTS) out.push({ x: g.x, y: 0, z: g.z + 1.2, r: 3.6, k: 0.8, head: null });
  return out;
}

const WARM = new THREE.Color("#ffc985");

const poolVert = /* glsl */ `
attribute vec3 aPool; // stagger threshold, strength, -
uniform float uOn;
uniform float uFogD;
varying vec2 vUv;
varying float vK;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float on = smoothstep(aPool.x, aPool.x + 0.22, uOn);
  float d = length(mv.xyz) * uFogD;
  vK = on * aPool.y * exp(-d * d);
}`;
const poolFrag = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vK;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vK < 0.002) discard;
  float f = (1.0 - r2) * (1.0 - r2);
  float hot = f * (0.45 + 0.55 * exp(-r2 * 5.0));
  gl_FragColor = vec4(uColor * hot * vK, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const haloVert = /* glsl */ `
attribute vec3 aPool;
uniform float uOn;
uniform float uFogD;
varying vec2 vUv;
varying float vK;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec3 c = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float dist = length(mv.xyz);
  // ≥ ~3 px wide from afar (the campus reads as lit from above), ~0.8 m across close up
  float size = 0.4 * max(1.0, dist / 60.0);
  mv.xy += position.xy * size * 2.0;
  gl_Position = projectionMatrix * mv;
  float on = smoothstep(aPool.x, aPool.x + 0.22, uOn);
  float d = dist * uFogD;
  vK = on * exp(-d * d) / max(1.0, dist / 60.0);
}`;
const haloFrag = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vK;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vK < 0.002) discard;
  float g = exp(-r2 * 14.0) * 1.4 + exp(-r2 * 3.5) * 0.12;
  gl_FragColor = vec4(uColor * g * vK, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function lightsMaterial(vert: string, frag: string, k: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uOn: { value: 0 },
      uFogD: { value: 0.00085 },
      uColor: { value: WARM.clone().multiplyScalar(k) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

export function NightLights({ tier, fogD }: { tier: Tier; fogD: number }) {
  const list = useMemo(() => pools(tier), [tier]);
  const meshes = useMemo(() => {
    const stagger = (i: number) => 0.04 + hash01(i, 19) * 0.34;
    const flat = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const pa = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    list.forEach((p, i) => pa.setXYZ(i, stagger(i), p.k, 0));
    flat.setAttribute("aPool", pa);
    const poolMat = lightsMaterial(poolVert, poolFrag, 0.16);
    const pool = new THREE.InstancedMesh(flat, poolMat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, i) =>
      pool.setMatrixAt(
        i,
        m.compose(
          new THREE.Vector3(p.x, p.y + 0.05, p.z),
          new THREE.Quaternion(),
          new THREE.Vector3(p.r, 1, p.r),
        ),
      ),
    );
    pool.frustumCulled = false;
    pool.renderOrder = 1;
    pool.name = "night-pools";
    pool.userData.noMerge = true;
    let halo: THREE.InstancedMesh | null = null;
    if (tier !== "lite") {
      const heads = list.map((p, i) => ({ h: p.head, i })).filter((q) => q.h);
      const quad = new THREE.PlaneGeometry(1, 1);
      const ha = new THREE.InstancedBufferAttribute(new Float32Array(heads.length * 3), 3);
      heads.forEach((q, j) => ha.setXYZ(j, stagger(q.i), 1, 0));
      quad.setAttribute("aPool", ha);
      halo = new THREE.InstancedMesh(quad, lightsMaterial(haloVert, haloFrag, 1.6), heads.length);
      heads.forEach((q, j) => halo!.setMatrixAt(j, m.makeTranslation(...q.h!)));
      halo.frustumCulled = false;
      halo.renderOrder = 3;
      halo.name = "night-halos";
      halo.userData.noMerge = true;
    }
    return { pool, halo };
  }, [list, tier]);
  useEffect(
    () => () => {
      for (const im of [meshes.pool, meshes.halo]) {
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
    for (const im of [meshes.pool, meshes.halo]) {
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
    </group>
  );
}
