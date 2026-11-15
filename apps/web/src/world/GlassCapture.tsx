"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { getArea, useStage } from "./stage";
import { glazingMaterials } from "./glazing";
import {
  CAPTURE_RANGE,
  cubeBytes,
  doorFrame,
  GLAZED,
  INTERIOR_SIZE,
  Lru,
  maxCaptures,
  nextCapture,
  projectionOf,
  REFLECT_SIZE,
  reflectionPoint,
  type GlazedHall,
} from "./glass-capture";

/**
 * Captures what is really behind (and in front of) every hall's glass, once per session (P2-WLD-18):
 *
 *  - the INTERIOR: the hall's own area scene (exactly what you walk into, lit by its own lights, its windows showing its
 *    own captured landscape) rendered from just inside its door into a 512 px cube map, colour in RGB and the distance
 *    to the nearest surface in alpha (a second pass with an override material), for the glazing shader's ray march.
 *    A hall is captured as soon as it is warm and ready: walking up to its door warms it anyway (rooms/preload), and
 *    within CAPTURE_RANGE (40 m) of a door this asks for the warm-up itself when no other hall is warm (one at a time,
 *    released again right after the capture unless you are at its door).
 *  - the REFLECTION: the plaza itself seen from the hall's forecourt (people left out: they move), 128 px.
 *
 * One cube face per frame (colour + distance for an interior face), so a capture never stalls the walk. Captures fade
 * into the glass (the shader keeps the honest tinted look until then). GPU memory: ≤ 6 interiors × 6 MB + 6 reflections
 * × 0.4 MB (≤ 3 interiors on devices reporting ≤ 4 GB). Lite renders no captures (honest glazing only).
 */

/**
 * The material of the distance pass: distance from the capture point → alpha (√ for near precision), the colour already
 * captured kept. With `map`: cut-out leaves / fronds (alpha-tested cards) keep their holes, so a plant has the depth of
 * its leaves, not of the quads they are drawn on.
 */
function distanceMaterial(maxD: number, map: THREE.Texture | null = null, alphaTest = 0) {
  return new THREE.ShaderMaterial({
    name: "glass-capture-distance",
    defines: map ? { CUT: 1 } : {},
    uniforms: { uMaxD: { value: maxD }, uMap: { value: map }, uCut: { value: Math.max(alphaTest, 0.35) } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <batching_pars_vertex>
      varying vec3 vV;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        #include <batching_vertex>
        #include <begin_vertex>
        #include <project_vertex>
        vV = mvPosition.xyz;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uMaxD;
      uniform sampler2D uMap;
      uniform float uCut;
      varying vec3 vV;
      varying vec2 vUv;
      void main() {
        #ifdef CUT
        if (texture2D(uMap, vUv).a < uCut) discard;
        #endif
        gl_FragColor = vec4(0.0, 0.0, 0.0, sqrt(clamp(length(vV) / uMaxD, 0.0, 1.0)));
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.ZeroFactor,
    side: THREE.DoubleSide,
  });
}

const cubeTarget = (size: number) =>
  new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.UnsignedByteType, // half-float cube targets render black on some GPUs
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

interface Job {
  game: GlazedHall;
  kind: "interior" | "reflection";
  rt: THREE.WebGLCubeRenderTarget;
  cam: THREE.CubeCamera;
  face: number;
}

/** session cache (survives remounts of the canvas tree) */
const interiors = new Map<GlazedHall, THREE.WebGLCubeRenderTarget>();
const reflections = new Map<GlazedHall, THREE.WebGLCubeRenderTarget>();
const fade = new Map<string, number>();
/** capture state for QA (window.__gkGlass) */
const stats = { interiors: [] as string[], reflections: [] as string[], bytes: 0, warming: null as string | null };
if (typeof window !== "undefined") {
  (window as unknown as { __gkGlass: typeof stats }).__gkGlass = stats;
  // dev: the capture targets themselves, for QA read-backs
  if (process.env.NODE_ENV !== "production") Object.assign(stats, { targets: { interiors, reflections } });
}

const publish = () => {
  stats.interiors = [...interiors.keys()];
  stats.reflections = [...reflections.keys()];
  stats.bytes = interiors.size * cubeBytes(INTERIOR_SIZE) + reflections.size * cubeBytes(REFLECT_SIZE);
};

export function GlassCapture() {
  const gl = useThree((s) => s.gl);
  const lru = useMemo(() => new Lru(maxCaptures((navigator as Navigator & { deviceMemory?: number }).deviceMemory)), []);
  const job = useRef<Job | null>(null);
  /** a hall this component asked to warm (released again after its capture) and since when it waits */
  const warming = useRef<{ game: GlazedHall; since: number } | null>(null);
  const readySince = useRef(new Map<GlazedHall, number>());
  const failed = useRef(new Set<string>());
  const acc = useRef(0);
  const dist = useRef(new Map<string, THREE.ShaderMaterial>());
  const distFor = (maxD: number, map: THREE.Texture | null, alphaTest: number) => {
    const k = `${maxD}:${map?.uuid ?? "-"}:${alphaTest}`;
    let m = dist.current.get(k);
    if (!m) dist.current.set(k, (m = distanceMaterial(maxD, map, alphaTest)));
    return m;
  };

  useEffect(() => () => job.current?.rt.dispose(), []);

  const bind = (game: GlazedHall) => {
    for (const m of glazingMaterials(game)) {
      const i = interiors.get(game);
      const r = reflections.get(game);
      m.uniforms.uCube!.value = i?.texture ?? null;
      m.uniforms.uRefl!.value = r?.texture ?? null;
      if (!i) m.uniforms.uHas!.value = 0;
      if (!r) m.uniforms.uReflHas!.value = 0;
      const rp = reflectionPoint(game);
      (m.uniforms.uReflC!.value as THREE.Vector3).set(rp[0], rp[1], rp[2]);
    }
  };

  const release = (game: GlazedHall) => {
    interiors.get(game)?.dispose();
    interiors.delete(game);
    fade.delete(`i:${game}`);
    lru.delete(game);
    bind(game);
    publish();
  };

  /** start a capture job */
  const start = (game: GlazedHall, kind: Job["kind"]) => {
    const rt = cubeTarget(kind === "interior" ? INTERIOR_SIZE : REFLECT_SIZE);
    const pr = projectionOf(game);
    const cam = new THREE.CubeCamera(kind === "interior" ? 0.05 : 0.3, kind === "interior" ? pr.maxD * 1.8 : 900, rt);
    if (kind === "interior") cam.position.set(...pr.at);
    else cam.position.set(...reflectionPoint(game));
    cam.coordinateSystem = gl.coordinateSystem;
    cam.updateCoordinateSystem();
    cam.updateMatrixWorld(true);
    job.current = { game, kind, rt, cam, face: 0 };
  };

  /** render one face of the current job (returns true when the job is complete) */
  const step = (j: Job): boolean => {
    const area = getArea(j.kind === "interior" ? `hall:${j.game}` : "outdoor");
    const scene = area.scene;
    const cam = j.cam.children[j.face] as THREE.PerspectiveCamera;
    const prevTarget = gl.getRenderTarget();
    const prevFace = gl.getActiveCubeFace();
    const prevMip = gl.getActiveMipmapLevel();
    const xr = gl.xr.enabled;
    const ac = gl.autoClear;
    const vis = scene.visible;
    const hidden: THREE.Object3D[] = [];
    // people move: never frozen into a capture
    scene.traverse((o) => {
      if (o.userData.gkPerson && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    gl.xr.enabled = false;
    scene.visible = true;
    try {
      gl.setRenderTarget(j.rt, j.face);
      gl.autoClear = true;
      gl.render(scene, cam);
      if (j.kind === "interior") {
        // distance pass: depth cleared, colour kept, alpha replaced; no background, no sprites / points / text / glass
        const pr = projectionOf(j.game);
        const plain = distFor(pr.maxD, null, 0);
        const bg = scene.background;
        const shadows = gl.shadowMap.enabled;
        const off: THREE.Object3D[] = [];
        const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
        scene.traverse((o) => {
          if (!o.visible) return;
          if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite || typeof (o as unknown as { text?: unknown }).text === "string") {
            o.visible = false;
            off.push(o);
            return;
          }
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          let std: THREE.MeshStandardMaterial | undefined;
          try {
            std = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
          } catch {
            return;
          }
          if (!std) return;
          // see-through things (window and door glass, light pools, glows) have no depth: what is behind them does
          if (std.transparent && !(std.map && std.opacity > 0.5)) {
            o.visible = false;
            off.push(o);
            return;
          }
          const cut = std.map && (std.alphaTest > 0 || std.transparent) ? distFor(pr.maxD, std.map, std.alphaTest) : plain;
          swapped.push([mesh, mesh.material]);
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => cut) : cut;
        });
        scene.background = null;
        gl.shadowMap.enabled = false;
        gl.autoClear = false;
        try {
          gl.clearDepth();
          gl.render(scene, cam);
        } finally {
          gl.shadowMap.enabled = shadows;
          for (const [mesh, mat] of swapped) mesh.material = mat;
          scene.background = bg;
          off.forEach((o) => (o.visible = true));
        }
      }
    } finally {
      gl.setRenderTarget(prevTarget, prevFace, prevMip);
      gl.autoClear = ac;
      gl.xr.enabled = xr;
      scene.visible = vis;
      hidden.forEach((o) => (o.visible = true));
    }
    j.face++;
    return j.face > 5;
  };

  useFrame((_, dt) => {
    const st = useStage.getState();
    if (st.tier === "lite" || gl.xr.isPresenting) return;
    // fades
    for (const g of GLAZED) {
      for (const [k, map, u] of [
        [`i:${g}`, interiors, "uHas"],
        [`r:${g}`, reflections, "uReflHas"],
      ] as const) {
        if (!map.has(g)) continue;
        const v = Math.min(1, (fade.get(k) ?? 0) + dt / 0.8);
        if (v === fade.get(k)) continue;
        fade.set(k, v);
        const e = v * v * (3 - 2 * v);
        for (const m of glazingMaterials(g)) m.uniforms[u]!.value = e;
      }
    }
    // a running job: one face per frame
    const j = job.current;
    if (j) {
      const areaKey = j.kind === "interior" ? (`hall:${j.game}` as const) : "outdoor";
      if (!st.ready[areaKey]) {
        // the hall was released while capturing (you walked to another door): start over later
        j.rt.dispose();
        job.current = null;
        return;
      }
      if (!step(j)) return;
      job.current = null;
      const cache = j.kind === "interior" ? interiors : reflections;
      cache.get(j.game)?.dispose();
      cache.set(j.game, j.rt);
      fade.set(`${j.kind === "interior" ? "i" : "r"}:${j.game}`, 0);
      if (j.kind === "interior") for (const g of lru.touch(j.game)) if (g !== j.game) release(g as GlazedHall);
      bind(j.game);
      publish();
      if (j.kind === "interior" && warming.current?.game === j.game) {
        // asked for by this capture only: release it again unless you are at its door (then the walk-up keeps it)
        const f = doorFrame(j.game);
        if (Math.hypot(f.x - selfPose.x, f.z - selfPose.z) > 12) st.coolHall(j.game);
        warming.current = null;
        stats.warming = null;
      }
      return;
    }
    // plan the next job (twice a second)
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const now = performance.now();
    const pos = { x: selfPose.x, z: selfPose.z };
    // 1. reflections: the plaza in front of each facade (the outdoor scene is always there while you are outside)
    if (st.view === "plaza" && st.ready.outdoor) {
      const g = nextCapture(pos, new Set([...reflections.keys(), ...[...failed.current].filter((k) => k.startsWith("r:")).map((k) => k.slice(2))]), CAPTURE_RANGE + 20);
      if (g) return start(g, "reflection");
    }
    // 2. interiors: any glazed hall that is warm and ready (after its own window capture and late parts settled)
    for (const g of GLAZED) {
      if (interiors.has(g)) continue;
      if (!st.ready[`hall:${g}`]) {
        readySince.current.delete(g);
        continue;
      }
      const t0 = readySince.current.get(g) ?? now;
      readySince.current.set(g, t0);
      const bg = getArea(`hall:${g}`).scene.background as THREE.Texture | null;
      if ((bg && (bg as THREE.Texture).isTexture) || now - t0 > 4000) {
        if (now - t0 > 1200) return start(g, "interior");
      }
      return;
    }
    // 3. nothing warm to capture: ask for the nearest uncaptured hall within range (one at a time, never over a
    //    hall that is warm for another reason)
    if (st.view !== "plaza") return;
    const w = warming.current;
    if (w) {
      // given up after 25 s (assets that never arrive, a closed hall): honest glazing stays
      if (!st.warm.includes(w.game) || now - w.since > 25000) {
        if (now - w.since > 25000) failed.current.add(`i:${w.game}`);
        warming.current = null;
        stats.warming = null;
      }
      return;
    }
    if (st.warm.length) return;
    const g = nextCapture(pos, new Set([...interiors.keys(), ...[...failed.current].filter((k) => k.startsWith("i:")).map((k) => k.slice(2))]));
    if (!g) return;
    warming.current = { game: g, since: now };
    stats.warming = g;
    st.warmHall(g);
  });
  return null;
}
