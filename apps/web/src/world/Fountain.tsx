"use client";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FOUNTAIN_RADIUS } from "./layout";
import type { Tier } from "./materials";
import { rng } from "./textures";

/**
 * Agaseke fountain water (P1-WLD-03): a clear, rippling pool and ten arching jets that fall onto the sculpture base.
 *  - Water: dark-teal glossy surface with two scrolling ripple normal layers (2.5 m and 0.8 m tiles), reflecting
 *    the sky environment; the lighter basin floor shows through.
 *  - Jets (Standard): per jet a thin continuous stream (alpha streak scrolling along a tube) plus ~32 droplets
 *    stretched along their velocity, all animated on the GPU (no per-frame CPU work). Splash rings where they land
 *    and a foam ring at the sculpture base.
 *  - Lite: the streams only (one tube per jet, scrolling alpha streak) — no droplets, no splash sprites.
 */
export const WATER_Y = 0.46;
const JETS = 10;
const R_NOZZLE = FOUNTAIN_RADIUS - 0.62; // nozzles sit just inside the coping
const R_LAND = 1.22; // the water lands on the sculpture plinth
const APEX = 1.55; // apex above the water (m)
const PERIOD = 0.9; // seconds from nozzle to landing

/** Tileable ripple normal map: a sum of integer-frequency sine waves (seeded, identical on every device). */
function rippleNormalTexture(): THREE.DataTexture {
  const N = 128;
  const r = rng(91);
  const waves = Array.from({ length: 14 }, () => {
    const kx = Math.round((r() - 0.5) * 14);
    const ky = Math.round((r() - 0.5) * 14) || 1;
    return { kx, ky, a: 1 / Math.hypot(kx, ky), p: r() * Math.PI * 2 };
  });
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p);
      h[y * N + x] = v;
    }
  const data = new Uint8Array(N * N * 4);
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)]!;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / l) * 0.5 * 255 + 127.5);
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Water disc between the sculpture plinth and the coping; UVs in metres / 2.5 (first ripple layer). */
function waterGeometry(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(1.1, FOUNTAIN_RADIUS - 0.33, 72, 2).rotateX(-Math.PI / 2);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2.5, p.getZ(i) / 2.5);
  return g;
}

function Water({ uTime }: { uTime: { value: number } }) {
  const geo = useMemo(() => waterGeometry(), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: "#2a4a50",
      metalness: 0,
      roughness: 0.03,
      envMapIntensity: 1.0,
      transparent: true,
      opacity: 0.85,
      normalMap: rippleNormalTexture(),
      normalScale: new THREE.Vector2(0.35, 0.35),
      depthWrite: false,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.fragmentShader =
        "uniform float uTime;\n" +
        sh.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
        {
          // two ripple layers: 2.5 m tile drifting 0.04 m/s, 0.8 m tile drifting 0.07 m/s across it
          vec2 gkA = vNormalMapUv + vec2(0.016, 0.006) * uTime;
          vec2 gkB = vNormalMapUv * 3.125 + vec2(-0.05, 0.075) * uTime;
          vec3 gkN = normalize((texture2D(normalMap, gkA).xyz * 2.0 - 1.0) + (texture2D(normalMap, gkB).xyz * 2.0 - 1.0) * vec3(0.8, 0.8, 1.0));
          gkN.xy *= normalScale;
          normal = normalize(tbn * gkN);
        }`,
        );
    };
    m.customProgramCacheKey = () => "gk-fountain-water";
    return m;
  }, [uTime]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.normalMap?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return <mesh geometry={geo} material={mat} position={[0, WATER_Y, 0]} renderOrder={1} />;
}

/** Jet arc in the jet's local frame (x = radial distance from the centre, y = height). */
function arc(t: number, out: THREE.Vector3) {
  return out.set(THREE.MathUtils.lerp(R_NOZZLE, R_LAND, t), WATER_Y + 4 * APEX * t * (1 - t), 0);
}

/** Thin continuous streams: one tapered tube per jet with an alpha streak scrolling towards the landing point. */
function Streams({ uTime }: { uTime: { value: number } }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    class Arc extends THREE.Curve<THREE.Vector3> {
      constructor() {
        super();
      }
      override getPoint(t: number, out = new THREE.Vector3()) {
        return arc(t, out);
      }
    }
    const curve = new Arc();
    for (let j = 0; j < JETS; j++) {
      const a = (j / JETS) * Math.PI * 2;
      const tube = new THREE.TubeGeometry(curve, 40, 0.014, 5, false);
      // taper: thicker at the nozzle, breaking up towards the end
      const p = tube.getAttribute("position") as THREE.BufferAttribute;
      const uv = tube.getAttribute("uv") as THREE.BufferAttribute;
      const c = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const t = uv.getX(i);
        arc(t, c);
        const k = 1.25 - t * 0.55;
        p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, p.getZ(i) * k);
      }
      tube.rotateY(a - Math.PI / 2);
      parts.push(tube);
    }
    const merged = mergeTubes(parts);
    parts.forEach((g) => g.dispose());
    return merged;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: { ...THREE.UniformsLib.fog, uTime },
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <fog_pars_fragment>
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float s = fract(vUv.x * 7.0 - uTime / ${PERIOD.toFixed(2)});
            float streak = 0.55 + 0.45 * smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.55, 1.0, s));
            float edge = 1.0 - abs(vUv.y - 0.5) * 1.2;
            float a = streak * edge * (0.62 - vUv.x * 0.3);
            gl_FragColor = vec4(vec3(0.86, 0.93, 0.97), a);
            #include <fog_fragment>
          }`,
      }),
    [uTime],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return <mesh geometry={geo} material={mat} renderOrder={3} />;
}

function mergeTubes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // tubes share one layout (position/normal/uv, indexed): concatenate them by hand (keeps index buffers)
  const out = new THREE.BufferGeometry();
  const names = ["position", "normal", "uv"] as const;
  let vCount = 0;
  let iCount = 0;
  for (const g of parts) {
    vCount += g.getAttribute("position").count;
    iCount += g.getIndex()!.count;
  }
  const idx = new Uint32Array(iCount);
  const arrays = names.map((n) => new Float32Array(vCount * parts[0]!.getAttribute(n).itemSize));
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    names.forEach((n, k) =>
      arrays[k]!.set(g.getAttribute(n).array as Float32Array, vo * g.getAttribute(n).itemSize),
    );
    const gi = g.getIndex()!.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i]! + vo;
    vo += g.getAttribute("position").count;
    io += gi.length;
  }
  names.forEach((n, k) =>
    out.setAttribute(n, new THREE.BufferAttribute(arrays[k]!, parts[0]!.getAttribute(n).itemSize)),
  );
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** GPU droplets: instanced quads placed on the jet parabola in the vertex shader and stretched along velocity. */
function Droplets({ uTime }: { uTime: { value: number } }) {
  const PER = 32;
  const geo = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    const n = JETS * PER;
    const jet = new Float32Array(n);
    const phase = new Float32Array(n);
    const jit = new Float32Array(n * 3);
    const r = rng(57);
    for (let j = 0; j < JETS; j++)
      for (let k = 0; k < PER; k++) {
        const i = j * PER + k;
        jet[i] = (j / JETS) * Math.PI * 2;
        phase[i] = (k + r() * 0.8) / PER;
        jit[i * 3] = (r() - 0.5) * 0.22; // range spread
        jit[i * 3 + 1] = (r() - 0.5) * 0.25; // height spread
        jit[i * 3 + 2] = (r() - 0.5) * 0.12; // sideways spread
      }
    g.setAttribute("aJet", new THREE.InstancedBufferAttribute(jet, 1));
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute("aJit", new THREE.InstancedBufferAttribute(jit, 3));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), FOUNTAIN_RADIUS + 1);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: { ...THREE.UniformsLib.fog, uTime },
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          attribute float aJet; attribute float aPhase; attribute vec3 aJit;
          uniform float uTime;
          varying vec2 vUv; varying float vA;
          void main() {
            float t = fract(uTime / ${PERIOD.toFixed(2)} + aPhase);
            vec2 dir = vec2(sin(aJet), cos(aJet));
            vec2 side = vec2(dir.y, -dir.x);
            float r0 = ${R_NOZZLE.toFixed(3)}; float r1 = ${R_LAND.toFixed(3)} + aJit.x;
            float h = ${APEX.toFixed(3)} + aJit.y;
            float r = mix(r0, r1, t);
            float y = ${WATER_Y.toFixed(3)} + 4.0 * h * t * (1.0 - t);
            vec3 p = vec3(dir * r + side * aJit.z * t, 0.0).xzy; p.y = y;
            vec3 v = vec3(dir * (r1 - r0) + side * aJit.z, 0.0).xzy; v.y = 4.0 * h * (1.0 - 2.0 * t);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vec2 vv = (modelViewMatrix * vec4(v, 0.0)).xy;
            float sp = length(vv);
            vec2 ax = sp > 1e-4 ? vv / sp : vec2(0.0, 1.0);
            vec2 px = vec2(-ax.y, ax.x);
            float len = 0.05 + sp * 0.022;
            mv.xy += px * position.x * 0.045 + ax * position.y * len;
            vUv = uv;
            vA = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.9, 1.0, t));
            gl_Position = projectionMatrix * mv;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <fog_pars_fragment>
          varying vec2 vUv; varying float vA;
          void main() {
            vec2 q = vUv * 2.0 - 1.0;
            float d = dot(q, q);
            if (d > 1.0) discard;
            gl_FragColor = vec4(vec3(0.9, 0.95, 1.0), (1.0 - d) * 0.6 * vA);
            #include <fog_fragment>
          }`,
      }),
    [uTime],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return <mesh geometry={geo} material={mat} frustumCulled renderOrder={4} />;
}

/** Ring sprite texture (soft white ring), used for splash ripples and the foam collar. */
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = rng(23);
  const grad = g.createRadialGradient(64, 64, 20, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.0)");
  grad.addColorStop(0.8, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // break the ring up into foam flecks
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.6})`;
    g.beginPath();
    g.arc(r() * 128, r() * 128, 1 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Splash ripples where each jet lands + a foam collar at the sculpture base. */
function Splashes({ uTime }: { uTime: { value: number } }) {
  const tex = useMemo(() => ringTexture(), []);
  const ripples = useMemo(
    () =>
      Array.from({ length: JETS }, (_, j) => {
        const a = (j / JETS) * Math.PI * 2;
        return new THREE.Vector3(
          Math.sin(a) * (R_LAND + 0.08),
          WATER_Y + 0.006,
          Math.cos(a) * (R_LAND + 0.08),
        );
      }),
    [],
  );
  const mats = useMemo(
    () =>
      ripples.map(
        () =>
          new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            opacity: 0.6,
            color: "#eef6f8",
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
      ),
    [ripples, tex],
  );
  const foam = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
        color: "#f4f8f8",
      }),
    [tex],
  );
  const refs = useMemo(() => ripples.map(() => ({ current: null as THREE.Mesh | null })), [ripples]);
  useFrame(() => {
    const t = uTime.value;
    refs.forEach((r, j) => {
      if (!r.current) return;
      // two overlapping ripple cycles per jet (staggered), 0.45 s each
      const k = (t / 0.45 + j * 0.37) % 1;
      r.current.scale.setScalar(0.25 + k * 0.55);
      mats[j]!.opacity = 0.65 * (1 - k);
    });
  });
  useEffect(
    () => () => {
      tex.dispose();
      mats.forEach((m) => m.dispose());
      foam.dispose();
    },
    [tex, mats, foam],
  );
  return (
    <group>
      {ripples.map((p, j) => (
        <mesh
          key={j}
          ref={(m) => {
            refs[j]!.current = m;
          }}
          position={p}
          rotation={[-Math.PI / 2, 0, 0]}
          material={mats[j]}
          renderOrder={2}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
      <mesh
        position={[0, WATER_Y + 0.008, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={foam}
        renderOrder={2}
      >
        <ringGeometry args={[1.08, 1.62, 48, 1]} />
      </mesh>
    </group>
  );
}

export function FountainWater({ tier }: { tier: Tier }) {
  const uTime = useMemo(() => ({ value: 0 }), []);
  useFrame(({ clock }) => {
    uTime.value = clock.elapsedTime;
  });
  return (
    <group>
      <Water uTime={uTime} />
      <Streams uTime={uTime} />
      {tier !== "lite" && <Droplets uTime={uTime} />}
      {tier !== "lite" && <Splashes uTime={uTime} />}
    </group>
  );
}
