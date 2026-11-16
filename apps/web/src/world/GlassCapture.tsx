"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { selfPose } from "@/lib/world-store";
import { getArea, useStage } from "./stage";
import { glazingMaterials } from "./glazing";
import { CAPTURE_RANGE, captureBudget, cubeBytes, GLAZED, isDesktopClass, nextCapture, reflectionPoint, reflectSize, type GlazedHall } from "./glass-capture";

/**
 * Captures what the hall glass reflects, once per session (P2-WLD-18): the plaza itself seen from each hall's
 * forecourt (people left out: they move), 256 px (128 on phones), one cube face per frame, faded in. That is all the
 * smoked glass shows: since P2-WLD-20 no interior is captured (the depth-reprojected rooms behind the vestibule
 * doorways smeared and tore; every door is closed smoked glass now), so no hall is warmed up for the glass either.
 * GPU memory: captureBudget() (≈ 9.4 MB desktop, ≈ 2.4 MB phone for all six halls). Lite renders no captures (smoked
 * glass with the sky reflection).
 */

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
  rt: THREE.WebGLCubeRenderTarget;
  cam: THREE.CubeCamera;
  face: number;
  /** the invalidation epoch it was started in (a capture started before an invalidation is thrown away) */
  epoch: number;
}

/** session cache (survives remounts of the canvas tree) */
const reflections = new Map<GlazedHall, THREE.WebGLCubeRenderTarget>();
const fade = new Map<GlazedHall, number>();
let epoch = 0;
/** capture state for QA (window.__gkGlass); `interiors` stays empty (P2-WLD-20) */
const stats = { interiors: [] as string[], reflections: [] as string[], bytes: 0, budget: 0 };
if (typeof window !== "undefined") {
  (window as unknown as { __gkGlass: typeof stats }).__gkGlass = stats;
  // dev: the capture targets themselves, for QA read-backs
  if (process.env.NODE_ENV !== "production") Object.assign(stats, { targets: { reflections } });
}

/**
 * Throw away the glass captures so they are taken again (e.g. when the time of day changes the light: P2-WLD-19). The
 * glass falls back to its plain smoked look with the sky and the new reflections fade in as GlassCapture retakes them
 * (halls within range first). `what`: kept for compatibility; there are only reflections since P2-WLD-20, so
 * "interiors" alone does nothing.
 */
export function invalidateCaptures(what: "all" | "reflections" | "interiors" = "all") {
  if (what === "interiors") return;
  epoch++;
  for (const g of GLAZED) {
    reflections.get(g)?.dispose();
    reflections.delete(g);
    fade.delete(g);
    for (const m of glazingMaterials(g)) {
      m.uniforms.uRefl!.value = null;
      m.uniforms.uReflHas!.value = 0;
    }
  }
  stats.reflections = [];
}

export function GlassCapture() {
  const gl = useThree((s) => s.gl);
  const desktop = useMemo(
    () => isDesktopClass((navigator as Navigator & { deviceMemory?: number }).deviceMemory, typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches),
    [],
  );
  const job = useRef<Job | null>(null);
  const acc = useRef(0);
  useEffect(() => {
    stats.budget = captureBudget(desktop);
  }, [desktop]);
  useEffect(() => () => job.current?.rt.dispose(), []);

  const bind = (game: GlazedHall) => {
    const r = reflections.get(game);
    const rp = reflectionPoint(game);
    for (const m of glazingMaterials(game)) {
      const u = m.uniforms;
      u.uRefl!.value = r?.texture ?? null;
      if (!r) u.uReflHas!.value = 0;
      (u.uReflC!.value as THREE.Vector3).set(rp[0], rp[1], rp[2]);
    }
  };

  const start = (game: GlazedHall) => {
    const rt = cubeTarget(reflectSize(desktop));
    const cam = new THREE.CubeCamera(0.3, 900, rt);
    cam.position.set(...reflectionPoint(game));
    cam.coordinateSystem = gl.coordinateSystem;
    cam.updateCoordinateSystem();
    cam.updateMatrixWorld(true);
    job.current = { game, rt, cam, face: 0, epoch };
  };

  /** render one face of the current job (returns true when the job is complete) */
  const step = (j: Job): boolean => {
    const scene = getArea("outdoor").scene;
    const cam = j.cam.children[j.face] as THREE.PerspectiveCamera;
    const prevTarget = gl.getRenderTarget();
    const prevFace = gl.getActiveCubeFace();
    const prevMip = gl.getActiveMipmapLevel();
    const xr = gl.xr.enabled;
    const ac = gl.autoClear;
    const vis = scene.visible;
    const hidden: THREE.Object3D[] = [];
    // people move: never frozen into a reflection
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
    for (const g of reflections.keys()) {
      const v = Math.min(1, (fade.get(g) ?? 0) + dt / 0.8);
      if (v === fade.get(g)) continue;
      fade.set(g, v);
      const e = v * v * (3 - 2 * v);
      for (const m of glazingMaterials(g)) m.uniforms.uReflHas!.value = e;
    }
    // a running job: one face per frame
    const j = job.current;
    if (j) {
      if (!st.ready.outdoor || j.epoch !== epoch) {
        // the plaza went away, or the capture was taken under the old light (invalidateCaptures): start over later
        j.rt.dispose();
        job.current = null;
        return;
      }
      if (!step(j)) return;
      job.current = null;
      reflections.get(j.game)?.dispose();
      reflections.set(j.game, j.rt);
      fade.set(j.game, 0);
      bind(j.game);
      stats.reflections = [...reflections.keys()];
      stats.bytes = reflections.size * cubeBytes(reflectSize(desktop), false);
      return;
    }
    // plan the next capture (twice a second): the plaza in front of the nearest uncaptured facade
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    if (st.view !== "plaza" || !st.ready.outdoor) return;
    const g = nextCapture({ x: selfPose.x, z: selfPose.z }, new Set(reflections.keys()), CAPTURE_RANGE + 20);
    if (g) start(g);
  });
  return null;
}
