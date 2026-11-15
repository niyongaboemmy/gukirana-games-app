"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { tod } from "./store";
import { followCamera, skyGeometry, skyMaterial, updateSky } from "./sky";

/**
 * The image-based lighting of a scene (PBR reflections, the soft sky fill) from the time-of-day sky: a small
 * offscreen scene — the sky dome, the sun as a bright disc (like drei's Lightformer), a sky panel and the dark-green
 * ground — rendered into a cube target that is `scene.environment` (three PMREM-filters it).
 *
 * Replaces drei <Environment frames={1}> (rendered once: a fixed morning). It is re-rendered only when the light
 * really changed: the sun moved ≥ 0.5°, the moon came up, … (in "Now" mode every few minutes), every 6th frame during
 * a transition, and once when it ends. The cube is pre-filtered here (PMREMGenerator.fromCubemap into ONE persistent
 * target), not by three's automatic per-texture PMREM cache (which kept a stale filtered copy of a re-rendered cube:
 * black reflections); the environment texture object never changes, so no material recompiles. A re-render costs 6
 * small faces (3 draws each) + the PMREM pass.
 */
const pmrems = new WeakMap<THREE.WebGLRenderer, THREE.PMREMGenerator>();
const pmremOf = (gl: THREE.WebGLRenderer) => {
  let g = pmrems.get(gl);
  if (!g) pmrems.set(gl, (g = new THREE.PMREMGenerator(gl)));
  return g;
};
export function TodEnvironment({
  resolution,
  intensity = 1,
  yaw = 0,
  scene: target,
  once = false,
}: {
  resolution: number;
  intensity?: number;
  yaw?: number;
  scene?: THREE.Scene;
  once?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const own = useThree((s) => s.scene);
  const scene = target ?? own;
  const env = useMemo(() => {
    const fbo = new THREE.WebGLCubeRenderTarget(resolution);
    fbo.texture.type = THREE.HalfFloatType;
    const cam = new THREE.CubeCamera(1, 3000, fbo);
    const s = new THREE.Scene();
    const skyMat = skyMaterial({ lite: true });
    const sky = new THREE.Mesh(skyGeometry(), skyMat);
    followCamera(sky);
    s.add(sky);
    // the sun: a bright disc 50 m out, facing the centre (drei Lightformer "circle", scale 10, intensity 6 by day)
    const sunMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(),
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const sun = new THREE.Mesh(new THREE.CircleGeometry(5, 24), sunMat);
    s.add(sun);
    // a broad sky panel high in the north (the cool fill the hand-tuned morning had)
    const panelMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(),
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(120, 30), panelMat);
    panel.position.set(0, 40, -60);
    panel.lookAt(0, 0, 0);
    s.add(panel);
    const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#3e4a33") });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 32).rotateX(-Math.PI / 2), groundMat);
    ground.position.y = -2;
    s.add(ground);
    s.add(cam);
    return {
      fbo,
      cam,
      s,
      skyMat,
      sun,
      sunMat,
      panelMat,
      groundMat,
      pmrem: null as THREE.WebGLCubeRenderTarget | null,
    };
  }, [resolution]);
  useEffect(
    () => () => {
      env.fbo.dispose();
      env.pmrem?.dispose();
      env.skyMat.dispose();
      env.sunMat.dispose();
      env.panelMat.dispose();
      env.groundMat.dispose();
      env.sun.geometry.dispose();
    },
    [env],
  );
  // (the filtered target exists after the first render; attached then, and detached on unmount)
  useEffect(
    () => () => {
      if (env.pmrem && scene.environment === env.pmrem.texture) scene.environment = null;
    },
    [scene, env],
  );

  const last = useRef({ el: -999, moon: -999, frame: 0, done: false, wasRunning: false });
  const render = () => {
    const L = tod.look;
    updateSky(env.skyMat, { yaw, night: false });
    const sd = env.skyMat.uniforms.uSunDir!.value as THREE.Vector3;
    env.sun.position.copy(sd).multiplyScalar(50);
    env.sun.lookAt(0, 0, 0);
    const k = L.sunI / 2.6;
    env.sunMat.color.setRGB(L.sunCol[0] * 6 * k, L.sunCol[1] * 6 * k, L.sunCol[2] * 6 * k);
    const sky = L.hemiI / 0.45;
    env.panelMat.color.setRGB(
      L.hemiSky[0] * 1.2 * sky * 0.62,
      L.hemiSky[1] * 1.2 * sky * 0.62,
      L.hemiSky[2] * 1.2 * sky * 0.62,
    );
    env.groundMat.color.setRGB(0.047 * L.unlit[0], 0.066 * L.unlit[1], 0.034 * L.unlit[2]);
    const autoClear = gl.autoClear;
    const xr = gl.xr.enabled;
    gl.autoClear = true;
    gl.xr.enabled = false;
    env.cam.update(gl, env.s);
    env.pmrem = pmremOf(gl).fromCubemap(env.fbo.texture, env.pmrem);
    gl.xr.enabled = xr;
    gl.autoClear = autoClear;
    if (scene.environment !== env.pmrem.texture) scene.environment = env.pmrem.texture;
  };
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && !target)
    (window as unknown as Record<string, unknown>).__gkTodEnv = { env, render, gl };
  useFrame(() => {
    scene.environmentIntensity = tod.look.envI * intensity;
    const st = last.current;
    if (once && st.done) return;
    const running = tod.transitioning;
    st.frame++;
    const due =
      !st.done ||
      (running && st.frame % 6 === 0) ||
      (!running && st.wasRunning) ||
      (!running && (Math.abs(tod.sun.el - st.el) > 0.5 || Math.abs(Math.max(-5, tod.moon.el) - st.moon) > 2));
    st.wasRunning = running;
    if (!due) return;
    st.done = true;
    st.el = tod.sun.el;
    st.moon = Math.max(-5, tod.moon.el);
    render();
  });
  return null;
}
