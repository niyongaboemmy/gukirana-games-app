"use client";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LAMPS } from "./obstacles";
import { PLANTERS, PLAZA_RADIUS } from "./layout";
import { tod } from "./time-of-day/store";
import { COMPOUND_LIFE_ON } from "./campus-life";
import { hash01 } from "./campus";
import type { Tier } from "./materials";

/**
 * Wildlife over the campus (P2-WLD-22): the sky of a Rwandan town is never empty.
 *  - Black kites (Milvus migrans, the raptor over every Rwandan town) soaring in wide thermal circles high over the
 *    campus, wings held flat with a slow flap now and then;
 *  - a small flock of weaver birds / sunbirds crossing low over the plaza every minute or so;
 *  - butterflies tumbling over the flower beds (African monarch orange, white, yellow) by day;
 *  - moths circling the plaza lamps after dark.
 * Each kind is ONE instanced draw with all motion in the vertex shader (a function of time and a per-instance seed):
 * no per-frame CPU work besides two uniforms. Hidden when it is not their time of day; Lite keeps only the kites.
 * Reduced motion: no butterflies or moths (fast small movers), the kites glide.
 */

const reduced = () => {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** shared clock (s, wraps every ~2.7 h: float precision in the shaders) */
const uT = { value: 0 };
const uDay = { value: 1 };

/** A bird in flight seen from below: body + two wings with a crooked "M" (kite) profile; aWing = 0 body, ±1 wing tip. */
function birdGeometry(span: number, len: number, forked: boolean): THREE.BufferGeometry {
  const s = span / 2;
  const pos: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], wa: number, wb: number, wc: number) => {
    pos.push(...a, ...b, ...c);
    wing.push(wa, wb, wc);
  };
  // body (a thin diamond, nose +z)
  tri([0, 0, len * 0.55], [-len * 0.08, 0, 0], [len * 0.08, 0, 0], 0, 0, 0);
  tri([-len * 0.08, 0, 0], [0, 0, -len * 0.45], [len * 0.08, 0, 0], 0, 0, 0);
  // tail (forked for the kite)
  if (forked) {
    tri([-len * 0.06, 0, -len * 0.3], [-len * 0.16, 0, -len * 0.62], [0, 0, -len * 0.5], 0, 0, 0);
    tri([len * 0.06, 0, -len * 0.3], [0, 0, -len * 0.5], [len * 0.16, 0, -len * 0.62], 0, 0, 0);
  }
  for (const sg of [-1, 1]) {
    const root0 = [sg * len * 0.07, 0, len * 0.18];
    const root1 = [sg * len * 0.07, 0, -len * 0.12];
    const elbow0 = [sg * s * 0.45, 0.0, len * 0.16];
    const elbow1 = [sg * s * 0.45, 0.0, -len * 0.16];
    const tip = [sg * s, 0, -len * 0.18];
    const w = sg as number;
    tri(root0, elbow0, root1, 0, w * 0.45, 0);
    tri(root1, elbow0, elbow1, 0, w * 0.45, w * 0.45);
    tri(elbow0, tip, elbow1, w * 0.45, w, w * 0.45);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  g.computeVertexNormals();
  return g;
}

/** per-instance seeds: (centre x, centre z, radius / spread, phase) and (height, speed, kind, spare) */
function seeds(
  n: number,
  fn: (i: number) => [number, number, number, number, number, number, number, number],
) {
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = fn(i);
    a.set(v.slice(0, 4), i * 4);
    b.set(v.slice(4, 8), i * 4);
  }
  return { a: new THREE.InstancedBufferAttribute(a, 4), b: new THREE.InstancedBufferAttribute(b, 4) };
}

const PARK = 500;
const COMMON =
  "#define PARK 500.0\nuniform float uT;\nuniform float uDay;\nattribute vec4 aS0;\nattribute vec4 aS1;\nattribute float aWing;\n";

function birdMaterial(key: string, colour: string, body: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.uniforms.uDay = uDay;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${COMMON}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${body}`)
      // (instances are placed in the shader: the instance matrix is identity)
      .replace("#include <project_vertex>", "#include <project_vertex>");
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** Kites: circles of radius aS0.z round (aS0.x, aS0.y) at height aS1.x, banked into the turn, flapping now and then. */
const KITE_VS = `
  float ang = uT * aS1.y + aS0.w;
  float rr = aS0.z * (1.0 + 0.18 * sin(uT * 0.05 + aS0.w));
  vec3 c = vec3(aS0.x + cos(ang) * rr, aS1.x + 6.0 * sin(uT * 0.07 + aS0.w * 2.0), aS0.y + sin(ang) * rr);
  // flap bursts: a few beats every ~20 s, otherwise wings flat with a slight dihedral
  float burst = smoothstep(0.85, 1.0, sin(uT * 0.31 + aS0.w * 3.0));
  float flap = sin(uT * 7.0 + aS0.w) * 0.5 * burst;
  vec3 p = transformed + vec3(0.0, PARK, 0.0);
  p.y += abs(aWing) * (0.12 + flap) * abs(p.x) * 0.5;
  // heading: tangent of the circle (counter-clockwise), banked inwards
  float hd = ang + 1.5708 * sign(aS1.y);
  float bank = -0.35 * sign(aS1.y);
  float cb = cos(bank), sb = sin(bank);
  p = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
  float ch = cos(hd), shh = sin(hd);
  vec3 dir = vec3(-sin(ang), 0.0, cos(ang)) * sign(aS1.y);
  vec3 side = vec3(dir.z, 0.0, -dir.x);
  transformed = c + side * p.x + vec3(0.0, p.y, 0.0) + dir * p.z;
`;

/** Small birds: a flock crossing the plaza along a line, every period aS1.y s; each bird offset in the flock. */
const FLOCK_VS = `
  float per = 70.0;
  float u = mod(uT + aS0.w * 0.0, per) / per;            // the whole flock shares the crossing
  float on = step(u, 0.32);
  float s = u / 0.32;
  vec3 a = vec3(-120.0, 16.0, 60.0), b = vec3(140.0, 22.0, -110.0);
  vec3 c = mix(a, b, s) + vec3(aS0.x, aS1.x + sin(uT * 2.0 + aS0.w) * 0.6, aS0.y);
  vec3 dir = normalize(b - a);
  vec3 side = normalize(vec3(dir.z, 0.0, -dir.x));
  vec3 p = transformed + vec3(0.0, PARK, 0.0);
  // fast wingbeats with short glides (finch-like undulating flight)
  float beat = sin(uT * 24.0 + aS0.w * 5.0) * step(0.0, sin(uT * 3.0 + aS0.w));
  p.y += abs(aWing) * beat * 0.09;
  transformed = (c + side * p.x + vec3(0.0, p.y, 0.0) + dir * p.z) * on;
`;

/** Butterflies: erratic loops over a bed centre (aS0.xy, spread aS0.z), wings opening and closing fast. */
const FLY_VS = `
  float t = uT * aS1.y + aS0.w;
  vec3 c = vec3(aS0.x + sin(t * 0.7) * aS0.z + sin(t * 1.9) * 0.35,
                aS1.x + 0.35 * sin(t * 1.3) + 0.15 * sin(t * 4.1),
                aS0.y + cos(t * 0.53) * aS0.z + cos(t * 2.3) * 0.3);
  vec3 dir = normalize(vec3(cos(t * 0.7) * 0.7 + cos(t * 1.9) * 0.66, 0.0, -sin(t * 0.53) * 0.53 - sin(t * 2.3) * 0.69) + 1e-4);
  vec3 side = vec3(dir.z, 0.0, -dir.x);
  vec3 p = transformed + vec3(0.0, PARK, 0.0);
  float open = 0.25 + 0.75 * abs(sin(uT * 13.0 + aS0.w * 7.0));
  p.y = abs(p.x) * (1.0 - open) * 1.6 * sign(aWing * aWing);
  p.x *= open;
  transformed = (c + side * p.x + vec3(0.0, p.y, 0.0) + dir * p.z);
`;

/** Moths: orbits round a lamp head (aS0.xy, height aS1.x), shown after dark (uDay is 1 − night here). */
const MOTH_VS = `
  float t = uT * aS1.y + aS0.w;
  vec3 c = vec3(aS0.x + cos(t) * aS0.z + sin(t * 3.1) * 0.08, aS1.x + sin(t * 1.7) * 0.25, aS0.y + sin(t) * aS0.z + cos(t * 2.7) * 0.08);
  vec3 p = (transformed + vec3(0.0, PARK, 0.0)) * (0.6 + 0.4 * abs(sin(uT * 30.0 + aS0.w)));
  transformed = c + p;
`;

function useSwarm(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  n: number,
  fn: Parameters<typeof seeds>[1],
  shadow = false,
) {
  const mesh = useMemo(() => {
    const s = seeds(n, fn);
    // the template is parked 500 m underground (the shader adds it back): its raw, flat triangles never sit on a real
    // floor for tools that read geometry (qa/e2e/zscan.mjs coplanar scan)
    const g = geo.clone().translate(0, -PARK, 0);
    g.setAttribute("aS0", s.a);
    g.setAttribute("aS1", s.b);
    const m = new THREE.InstancedMesh(g, mat, n);
    m.frustumCulled = false; // positions come from the shader
    m.castShadow = shadow;
    m.userData.noMerge = true;
    return m;
  }, [geo, mat, n, fn, shadow]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      mesh.dispose();
    },
    [mesh],
  );
  return mesh;
}

const KITE = (i: number): [number, number, number, number, number, number, number, number] => [
  (hash01(i, 401) - 0.5) * 260,
  (hash01(i, 402) - 0.5) * 220 - 30,
  35 + hash01(i, 403) * 45,
  hash01(i, 404) * 6.28,
  48 + hash01(i, 405) * 40,
  (0.06 + hash01(i, 406) * 0.05) * (i % 3 ? 1 : -1),
  0,
  0,
];
const FLOCK = (i: number): [number, number, number, number, number, number, number, number] => [
  (hash01(i, 411) - 0.5) * 9,
  (hash01(i, 412) - 0.5) * 7,
  0,
  hash01(i, 413) * 6.28,
  (hash01(i, 414) - 0.5) * 3,
  0,
  0,
  0,
];

function flyCentres(): { x: number; z: number }[] {
  // the raised flower planters on the plaza ring and a few beds out on the forecourt
  return [...PLANTERS.map((p) => ({ x: p.x, z: p.z })), { x: -14, z: 66 }, { x: 14, z: 66 }].filter(
    (p) => Math.hypot(p.x, p.z) < PLAZA_RADIUS + 40,
  );
}

export function Wildlife({ tier }: { tier: Tier }) {
  if (!COMPOUND_LIFE_ON) return null;
  return <Swarms tier={tier} />;
}

function Swarms({ tier }: { tier: Tier }) {
  const lite = tier === "lite";
  const calm = useMemo(() => reduced(), []);
  const geos = useMemo(
    () => ({
      kite: birdGeometry(1.5, 0.6, true),
      small: birdGeometry(0.24, 0.13, false),
      fly: birdGeometry(0.11, 0.035, false),
      moth: new THREE.OctahedronGeometry(0.025, 0),
    }),
    [],
  );
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  const mats = useMemo(
    () => ({
      kite: birdMaterial("gk-kite", "#3a2d24", KITE_VS),
      small: birdMaterial("gk-flock", "#5a4a30", FLOCK_VS),
      fly: (() => {
        const m = birdMaterial("gk-butterfly", "#ffffff", FLY_VS);
        m.vertexColors = false;
        return m;
      })(),
      moth: (() => {
        const m = new THREE.MeshBasicMaterial({
          color: new THREE.Color("#fff2d6").multiplyScalar(1.4),
          toneMapped: false,
        });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uT = uT;
          sh.uniforms.uDay = uNight;
          sh.vertexShader = sh.vertexShader
            .replace(
              "#include <common>",
              `#include <common>\n${COMMON.replace("attribute float aWing;\n", "")}`,
            )
            .replace("#include <begin_vertex>", `#include <begin_vertex>\n${MOTH_VS}`);
        };
        m.customProgramCacheKey = () => "gk-moth";
        return m;
      })(),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const centres = useMemo(() => flyCentres(), []);
  const flyFn = useMemo(
    () =>
      (i: number): [number, number, number, number, number, number, number, number] => {
        const c = centres[i % centres.length]!;
        return [
          c.x + (hash01(i, 421) - 0.5) * 2,
          c.z + (hash01(i, 422) - 0.5) * 2,
          1.2 + hash01(i, 423) * 1.4,
          hash01(i, 424) * 6.28,
          0.9 + hash01(i, 425) * 0.6,
          0.5 + hash01(i, 426) * 0.4,
          0,
          0,
        ];
      },
    [centres],
  );
  const mothFn = useMemo(
    () =>
      (i: number): [number, number, number, number, number, number, number, number] => {
        const l = LAMPS[i % LAMPS.length]!;
        return [
          l.x,
          l.z,
          0.25 + hash01(i, 431) * 0.35,
          hash01(i, 432) * 6.28,
          3.9 + hash01(i, 433) * 0.5,
          1.6 + hash01(i, 434) * 2.2,
          0,
          0,
        ];
      },
    [],
  );
  const kites = useSwarm(geos.kite, mats.kite, lite ? 3 : 6, KITE);
  const flock = useSwarm(geos.small, mats.small, 14, FLOCK);
  const flies = useSwarm(geos.fly, mats.fly, 22, flyFn);
  const moths = useSwarm(geos.moth, mats.moth, Math.min(LAMPS.length * 3, 60), mothFn);
  // butterfly colours (instance colours: monarch orange, white, yellow)
  useEffect(() => {
    const cols = ["#e8892a", "#f4f1e8", "#f2c94c", "#e8892a", "#d9622b"].map((c) => new THREE.Color(c));
    for (let i = 0; i < flies.count; i++) flies.setColorAt(i, cols[i % cols.length]!);
    if (flies.instanceColor) flies.instanceColor.needsUpdate = true;
  }, [flies]);
  useFrame(({ clock }) => {
    uT.value = clock.elapsedTime % 9800;
    const L = tod.look;
    // birds by day (gone once the lamps are on); moths only after dark
    uDay.value = 1 - Math.min(1, Math.max(0, (L.lights - 0.2) / 0.5));
    uNight.value = Math.min(1, Math.max(0, (L.lights - 0.5) / 0.4));
    kites.visible = uDay.value > 0.5;
    flock.visible = !lite && uDay.value > 0.5;
    flies.visible = !lite && !calm && uDay.value > 0.5;
    moths.visible = !lite && !calm && uNight.value > 0.5;
  });
  return (
    <group name="wildlife" userData={{ noMerge: true }}>
      <primitive object={kites} />
      <primitive object={flock} />
      <primitive object={flies} />
      <primitive object={moths} />
    </group>
  );
}
const uNight = { value: 0 };
