"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/**
 * Real vegetation (Poly Haven CC0 photogrammetry-based models, see docs/ASSET-LICENSES.md), instanced with
 * distance LODs:
 *   LOD0  full model (thinned leaves, simplified wood)        — near
 *   LOD1  sparser crown / coarser wood                        — mid
 *   IMP   8-view baked impostor on a camera-facing quad       — far (optional per species)
 * Instances are re-bucketed a few times per second by camera distance (cheap: a few hundred matrices).
 * Leaves sway in the wind in the vertex shader (shared time uniform, no per-instance CPU work).
 */

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotY: number;
  s: number;
  /** optional vertical stretch (e.g. taller eucalyptus) */
  sy?: number;
}

export interface SpeciesDef {
  url: string;
  /** LOD switch distances: [lod0 → lod1, lod1 → impostor/cull] (m) */
  dist: [number, number];
  impostor?: { url: string; frames: number; w: number; h: number; y0: number };
  shadows?: boolean;
  /** wind sway amplitude (m per m of height) */
  sway?: number;
}

const BASE = "/assets/env";
export const SPECIES = {
  // distant landscape only (outside the compound): trees use full / sparse / impostor LODs
  acacia: { url: `${BASE}/acacia.glb`, dist: [60, 170], impostor: { url: `${BASE}/acacia-imp.webp`, frames: 8, w: 14.4, h: 11.2, y0: -0.2 }, shadows: false, sway: 0.006 },
  eucalyptus: { url: `${BASE}/eucalyptus.glb`, dist: [50, 120], impostor: { url: `${BASE}/eucalyptus-imp.webp`, frames: 8, w: 19.6, h: 16.6, y0: -0.2 }, shadows: false, sway: 0.01 },
  bush: { url: `${BASE}/bush.glb`, dist: [60, 140], sway: 0.012 },
  rock: { url: `${BASE}/rock.glb`, dist: [60, 160], shadows: true },
  boulder: { url: `${BASE}/boulder.glb`, dist: [80, 220], shadows: true },
} satisfies Record<string, SpeciesDef>;
export type SpeciesId = keyof typeof SPECIES;

/** Shared wind clock for all foliage materials. */
const wind = { value: 0 };

export function addWind(mat: THREE.Material, sway: number) {
  const m = mat as THREE.MeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.uniforms.uSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind; uniform float uSway;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 gkBase = vec3(0.0);
          #ifdef USE_INSTANCING
            gkBase = instanceMatrix[3].xyz;
          #endif
          float gkH = max(position.y, 0.0);
          float gkPh = uWind * 1.3 + gkBase.x * 0.21 + gkBase.z * 0.17;
          float gkGust = 0.6 + 0.4 * sin(uWind * 0.35 + gkBase.x * 0.05);
          transformed.x += (sin(gkPh + position.y * 0.6) * 0.8 + sin(gkPh * 2.7 + position.x * 3.1) * 0.2) * uSway * gkH * gkGust;
          transformed.z += (cos(gkPh * 0.9 + position.y * 0.5) * 0.6 + cos(gkPh * 3.1 + position.z * 2.7) * 0.2) * uSway * gkH * gkGust;
        }`,
      );
  };
  m.customProgramCacheKey = () => `gk-wind-${sway}`;
}

/** Camera-facing (cylindrical) impostor quad that picks one of N baked views by viewing angle. */
function impostorMaterial(tex: THREE.Texture, frames: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, fog: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFrames = { value: frames };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uFrames;").replace(
      "#include <project_vertex>",
      `
      vec3 gkC = instanceMatrix[3].xyz;
      float gkSx = length(instanceMatrix[0].xyz);
      float gkSy = length(instanceMatrix[1].xyz);
      float gkYaw = atan(instanceMatrix[0].z, instanceMatrix[0].x);
      vec3 gkD = gkC - cameraPosition;
      vec3 gkRight = normalize(vec3(-gkD.z, 0.0, gkD.x));
      vec3 gkWorld = gkC + gkRight * position.x * gkSx + vec3(0.0, position.y * gkSy, 0.0);
      float gkA = atan(-gkD.x, -gkD.z) + gkYaw;
      float gkF = mod(floor(gkA / 6.28318 * uFrames + 0.5), uFrames);
      #ifdef USE_MAP
        vMapUv.x = (vMapUv.x + gkF) / uFrames;
      #endif
      vec4 mvPosition = viewMatrix * vec4(gkWorld, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      `,
    );
  };
  m.customProgramCacheKey = () => "gk-impostor";
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function compose(p: Placement, out: THREE.Matrix4) {
  _p.set(p.x, p.y, p.z);
  _q.setFromAxisAngle(UP, p.rotY);
  _s.set(p.s, p.s * (p.sy ?? 1), p.s);
  return out.compose(_p, _q, _s);
}

interface Bucket {
  meshes: THREE.InstancedMesh[];
}

/** One species, all its placements, LOD-bucketed by camera distance. */
export function InstancedSpecies({ id, items, lite = false, shadows = true, maxLod = 2 }: { id: SpeciesId; items: Placement[]; lite?: boolean; shadows?: boolean; maxLod?: number }) {
  const def: SpeciesDef = SPECIES[id];
  const gltf = useGLTF(def.url, false);
  const impTex = useMemo(() => {
    if (!def.impostor) return null;
    const t = new THREE.TextureLoader().load(def.impostor.url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [def.impostor]);

  const buckets = useMemo(() => {
    const out: Bucket[] = [];
    const n = Math.max(1, items.length);
    for (const name of ["lod0", "lod1"]) {
      const node = gltf.scene.getObjectByName(name);
      const meshes: THREE.InstancedMesh[] = [];
      node?.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const mat = (src.material as THREE.MeshStandardMaterial).clone();
        if (mat.name === "leaves") {
          mat.color.multiplyScalar(1.25); // scanned albedo reads a little dark under our sun
          if (def.sway) addWind(mat, def.sway);
        }
        if (mat.map) mat.map.anisotropy = 4;
        const im = new THREE.InstancedMesh(src.geometry, mat, n);
        im.count = 0;
        im.frustumCulled = false; // instances span the whole map; culling is done by our distance buckets
        im.castShadow = !!def.shadows && shadows && name === "lod0";
        im.receiveShadow = shadows && name === "lod0";
        meshes.push(im);
      });
      out.push({ meshes });
    }
    if (def.impostor && impTex) {
      const g = new THREE.PlaneGeometry(def.impostor.w, def.impostor.h).translate(0, def.impostor.h / 2 + def.impostor.y0, 0);
      const im = new THREE.InstancedMesh(g, impostorMaterial(impTex, def.impostor.frames), n);
      im.count = 0;
      im.frustumCulled = false;
      out.push({ meshes: [im] });
    } else out.push({ meshes: [] });
    return out;
  }, [gltf.scene, items.length, def, impTex, shadows]);

  useEffect(
    () => () => {
      for (const b of buckets)
        for (const m of b.meshes) {
          (m.material as THREE.Material).dispose();
          m.dispose();
        }
    },
    [buckets],
  );

  const mats = useMemo(() => items.map((p) => compose(p, new THREE.Matrix4())), [items]);
  const st = useRef({ t: 1e9, cx: 1e9, cz: 1e9 });

  useFrame(({ camera, clock }, dt) => {
    wind.value = clock.elapsedTime * 0.5;
    const s = st.current;
    s.t += dt;
    const moved = Math.hypot(camera.position.x - s.cx, camera.position.z - s.cz);
    if (s.t < 0.35 && moved < 2.5) return;
    s.t = 0;
    s.cx = camera.position.x;
    s.cz = camera.position.z;
    const k = lite ? 0.6 : 1;
    const d0 = def.dist[0] * k;
    const d1 = def.dist[1] * k;
    const counts = [0, 0, 0];
    for (let i = 0; i < items.length; i++) {
      const p = items[i]!;
      const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      let b = d < d0 ? 0 : d < d1 ? 1 : 2;
      if (lite && b === 0) b = 1;
      b = Math.min(b, maxLod);
      if (b === 2 && !def.impostor) continue;
      const bucket = buckets[b]!;
      const m = mats[i]!;
      for (const im of bucket.meshes) im.setMatrixAt(counts[b]!, m);
      counts[b]!++;
    }
    buckets.forEach((bk, b) =>
      bk.meshes.forEach((im) => {
        im.count = counts[b]!;
        im.instanceMatrix.needsUpdate = true;
      }),
    );
    void _m;
  });

  return (
    <group>
      {buckets.flatMap((b, i) => b.meshes.map((m, j) => <primitive key={`${i}-${j}`} object={m} />))}
    </group>
  );
}

/**
 * Grass / fern patches that follow the camera: a fixed grid of tufts within ~24 m, wrapped toroidally around the
 * viewer so the ground near you is always detailed while the total instance count stays constant.
 */
export function GrassField({ id = "bush", count, radius, accept, heightAt }: { id?: SpeciesId; count: number; radius: number; accept: (x: number, z: number) => boolean; heightAt: (x: number, z: number) => number }) {
  const def: SpeciesDef = SPECIES[id];
  const gltf = useGLTF(def.url, false);
  const meshes = useMemo(() => {
    const out: THREE.InstancedMesh[] = [];
    gltf.scene.getObjectByName("lod0")?.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      const mat = (src.material as THREE.MeshStandardMaterial).clone();
      addWind(mat, def.sway ?? 0.05);
      const im = new THREE.InstancedMesh(src.geometry, mat, count);
      im.count = 0;
      im.frustumCulled = false;
      out.push(im);
    });
    return out;
  }, [gltf.scene, count, def.sway]);
  const seeds = useMemo(() => {
    let s = 9;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: count }, () => ({ u: r(), v: r(), rot: r() * Math.PI * 2, sc: 0.7 + r() * 0.7 }));
  }, [count]);
  useEffect(() => () => meshes.forEach((m) => ((m.material as THREE.Material).dispose(), m.dispose())), [meshes]);
  const st = useRef({ cx: 1e9, cz: 1e9 });
  useFrame(({ camera }) => {
    const s = st.current;
    if (Math.hypot(camera.position.x - s.cx, camera.position.z - s.cz) < 1.5) return;
    s.cx = camera.position.x;
    s.cz = camera.position.z;
    const size = radius * 2;
    let n = 0;
    for (const sd of seeds) {
      // toroidal wrap of a size×size tile around the camera
      const ox = s.cx - size / 2;
      const oz = s.cz - size / 2;
      const x = ox + ((((sd.u * size - ox) % size) + size) % size);
      const z = oz + ((((sd.v * size - oz) % size) + size) % size);
      if (Math.hypot(x - s.cx, z - s.cz) > radius || !accept(x, z)) continue;
      _p.set(x, heightAt(x, z), z);
      _q.setFromAxisAngle(UP, sd.rot);
      _s.setScalar(sd.sc);
      _m.compose(_p, _q, _s);
      for (const im of meshes) im.setMatrixAt(n, _m);
      n++;
    }
    for (const im of meshes) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

export function preloadVegetation() {
  for (const s of Object.values(SPECIES)) useGLTF.preload(s.url, false);
}
