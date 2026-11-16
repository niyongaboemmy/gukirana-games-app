"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { worldMaterials, type Tier } from "./materials";
import { BOLLARDS, hash01, MOTO_BAYS, MOTO_STAND, PARKING_BAYS, STREET_LIGHTS, type P } from "./campus";

/**
 * Instanced road furniture and parked vehicles of the campus frontage (P2-WLD-12): one draw call per kind however
 * many stand on the campus. Low-poly, vertex-coloured models (body parts white, so the per-instance colour paints
 * the body while glass, tyres and trim stay dark); every choice is a seeded hash (deterministic, no Math.random).
 * Moto-taxi riders are adults in the green helmets of the Musanze moto co-operatives, sitting on their bikes.
 * Small things (bollards, motorbikes, riders) are hidden high above the campus, where they are below a pixel.
 */

type Part = { g: THREE.BufferGeometry; c: string };
function build(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(({ g, c }) => {
    const n = g.index ? g.toNonIndexed() : g;
    g.dispose();
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    const col = new THREE.Color(c);
    const cnt = n.getAttribute("position").count;
    const arr = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) arr.set([col.r, col.g, col.b], i * 3);
    n.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return n;
  });
  const out = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string): Part => ({ g: new THREE.BoxGeometry(w, h, d).translate(x, y, z), c });
const wheel = (r: number, w: number, x: number, y: number, z: number, c = "#151515"): Part => ({ g: new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, y, z), c });

/** A side profile (z, y points, nose +z) extruded across the car (width w, centred on x = 0), with rounded edges. */
function profile(pts: [number, number][], w: number, bevel: number, c: string): Part {
  const sh = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // shape xy = (z, y), extruded along +z → turn so the shape's x is the car's z and the extrusion runs across (x)
  g.rotateY(-Math.PI / 2).translate((w - bevel * 2) / 2, 0, 0);
  return { g, c };
}

/** Wheel: tyre with a pale hub cap (axis along x). */
const tyre = (x: number, z: number, r = 0.32): Part[] => [
  wheel(r, 0.22, x, r, z),
  { g: new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.02, 12).rotateZ(Math.PI / 2).translate(x + Math.sign(x) * 0.115, r, z), c: "#9a9ea4" },
];

/**
 * Hatchback / saloon (4.4 m, nose towards +z): an extruded side profile (bumper, bonnet, raked screen, roof, boot),
 * a glass house set into it, dark wheel arches, hub caps, lamps and plates.
 */
export function carGeometry() {
  const BODY = "#ffffff";
  const GLASS = "#20272e";
  const TRIM = "#262626";
  const body: [number, number][] = [
    [2.2, 0.3], [2.22, 0.62], [2.05, 0.78], [1.15, 0.86], [-1.7, 0.9], [-2.12, 0.82], [-2.2, 0.62], [-2.18, 0.3],
  ];
  const house: [number, number][] = [[1.05, 0.84], [0.25, 1.36], [-1.15, 1.38], [-1.72, 0.9]];
  const roof: [number, number][] = [[0.22, 1.36], [0.27, 1.43], [-1.12, 1.45], [-1.2, 1.37]];
  return build([
    profile(body, 1.8, 0.07, BODY),
    profile(house, 1.6, 0.05, GLASS),
    profile(roof, 1.52, 0.03, BODY),
    // dark sills and wheel-arch shadows along both sides
    box(1.84, 0.12, 3.0, 0, 0.32, -0.02, TRIM),
    ...[-1, 1].flatMap((sz) => [box(1.82, 0.36, 0.86, 0, 0.42, sz * 1.38, "#111111")]),
    // bumpers, lamps, plates (yellow plates on the back, Rwandan style; white front)
    box(1.82, 0.16, 0.1, 0, 0.36, 2.22, TRIM),
    box(1.82, 0.16, 0.1, 0, 0.36, -2.21, TRIM),
    box(0.4, 0.11, 0.05, -0.6, 0.7, 2.2, "#f4f0dc"),
    box(0.4, 0.11, 0.05, 0.6, 0.7, 2.2, "#f4f0dc"),
    box(0.34, 0.12, 0.05, -0.66, 0.72, -2.19, "#a3161a"),
    box(0.34, 0.12, 0.05, 0.66, 0.72, -2.19, "#a3161a"),
    box(0.5, 0.12, 0.02, 0, 0.5, 2.28, "#f2f2ee"),
    box(0.5, 0.12, 0.02, 0, 0.52, -2.27, "#e8c21e"),
    // mirrors
    ...[-1, 1].map((sx) => box(0.16, 0.1, 0.08, sx * 0.95, 0.98, 0.95, TRIM)),
    ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => tyre(sx * 0.82, sz * 1.38))),
  ]);
}

/** Minibus (the Coaster / Hiace "twegerane" of Rwandan roads, 5.4 m), nose towards +z, body white with a stripe. */
export function minibusGeometry() {
  const BODY = "#ffffff";
  const GLASS = "#20272e";
  const body: [number, number][] = [[2.7, 0.35], [2.72, 1.05], [2.45, 1.5], [2.2, 2.2], [-2.6, 2.25], [-2.7, 2.1], [-2.72, 0.35]];
  return build([
    profile(body, 1.95, 0.08, BODY),
    // side windows band and windscreen
    box(1.99, 0.62, 4.3, 0, 1.75, -0.25, GLASS),
    box(1.7, 0.6, 0.06, 0, 1.78, 2.38, GLASS),
    // the operator's livery stripe
    box(1.99, 0.14, 5.2, 0, 1.18, 0, "#c99a2e"),
    box(1.98, 0.12, 5.3, 0, 0.4, 0, "#262626"),
    box(0.4, 0.12, 0.05, -0.65, 0.85, 2.73, "#f4f0dc"),
    box(0.4, 0.12, 0.05, 0.65, 0.85, 2.73, "#f4f0dc"),
    box(0.3, 0.14, 0.05, -0.75, 0.8, -2.73, "#a3161a"),
    box(0.3, 0.14, 0.05, 0.75, 0.8, -2.73, "#a3161a"),
    ...[-1, 1].flatMap((sx) => [1.75, -1.6].flatMap((z) => tyre(sx * 0.86, z, 0.36))),
  ]);
}

/** Motorbike (moto-taxi), 2 m, nose towards +z. */
export function motoGeometry() {
  const BODY = "#ffffff";
  return build([
    wheel(0.3, 0.1, 0, 0.3, 0.68),
    wheel(0.3, 0.12, 0, 0.3, -0.66),
    box(0.22, 0.32, 1.05, 0, 0.56, 0, BODY),
    box(0.3, 0.2, 0.42, 0, 0.8, 0.22, BODY),
    box(0.3, 0.1, 0.66, 0, 0.82, -0.32, "#1a1a1a"),
    box(0.06, 0.55, 0.06, 0, 0.75, 0.62, "#3a3f47"),
    box(0.72, 0.04, 0.04, 0, 1.03, 0.58, "#3a3f47"),
    box(0.16, 0.14, 0.08, 0, 0.92, 0.72, "#f4f0dc"),
    box(0.26, 0.1, 0.5, 0, 0.42, -0.6, "#3a3f47"),
  ]);
}

/** An adult moto-taxi rider seated on the bike (same frame as the bike): green helmet, green vest, dark trousers. */
export function riderGeometry() {
  const SKIN = "#5a3826";
  const VEST = "#2e8b3e";
  const SHIRT = "#e8e4da";
  const TROUSERS = "#2b2d33";
  const HELMET = "#2f9a46";
  const legs = [-1, 1].flatMap((s) => [
    box(0.16, 0.16, 0.5, s * 0.16, 0.9, 0.0, TROUSERS),
    box(0.13, 0.5, 0.14, s * 0.2, 0.62, 0.24, TROUSERS),
    box(0.13, 0.08, 0.26, s * 0.2, 0.36, 0.3, "#151515"),
  ]);
  const arms = [-1, 1].flatMap((s) => [box(0.12, 0.12, 0.42, s * 0.27, 1.32, 0.2, SHIRT), box(0.1, 0.1, 0.12, s * 0.32, 1.12, 0.48, SKIN)]);
  return build([
    ...legs,
    box(0.42, 0.62, 0.26, 0, 1.28, -0.2, VEST),
    box(0.44, 0.1, 0.28, 0, 1.6, -0.2, SHIRT),
    ...arms,
    box(0.1, 0.1, 0.1, 0, 1.68, -0.18, SKIN),
    { g: new THREE.SphereGeometry(0.11, 10, 8).translate(0, 1.8, -0.17), c: SKIN },
    { g: new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, 1.82, -0.18), c: HELMET },
  ]);
}

/** Street light: galvanised pole and arm, LED head with its pale diffuser (one model, one draw call). */
function streetLightGeometry() {
  const POLE = "#7d838b";
  return build([
    { g: new THREE.CylinderGeometry(0.06, 0.1, 8, 8).translate(0, 4, 0), c: POLE },
    { g: new THREE.CylinderGeometry(0.18, 0.2, 0.5, 8).translate(0, 0.25, 0), c: "#5a5f66" },
    box(0.08, 0.08, 1.7, 0, 7.95, 0.8, POLE),
    box(0.34, 0.12, 0.7, 0, 7.92, 1.55, "#4a4f56"),
    box(0.28, 0.02, 0.6, 0, 7.85, 1.55, "#fff4dc"),
  ]);
}
const bollardGeometry = () => new THREE.CylinderGeometry(0.09, 0.11, 0.9, 10).translate(0, 0.45, 0);

/** Tight bounds of the two car parks and of the forecourt's small props (moto-taxi stand, moto bays, bollards). */
const PARK_BOUNDS = [-1, 1].map((s) => new THREE.Sphere(new THREE.Vector3(s * 59, 1, 70), 25));
const FRONT_BOUNDS = [new THREE.Sphere(new THREE.Vector3(0, 1, 80.4), 23.5), new THREE.Sphere(new THREE.Vector3(-34.7, 1, 83.6), 5.5), ...[-1, 1].map((s) => new THREE.Sphere(new THREE.Vector3(s * 34.3, 1, 65.8), 4.6))];

/** Body colours of the parked cars (Rwandan car parks: white, silver and grey first). */
export const CAR_COLOURS = ["#f2f2ef", "#f2f2ef", "#c9ccd0", "#c9ccd0", "#8e9297", "#2b2e33", "#7b1f1f", "#1f3b6b", "#d9cfb8", "#3d4a3a"];
export const MOTO_COLOURS = ["#b3201f", "#1f3e8a", "#151515", "#d8d8d8", "#b3201f"];

interface Inst {
  x: number;
  y?: number;
  z: number;
  rotY: number;
  s?: [number, number, number];
  c?: string;
}
function useInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[], shadow: boolean) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y ?? 0, it.z);
      o.rotation.set(0, it.rotY, 0);
      o.scale.set(...(it.s ?? [1, 1, 1]));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) m.setColorAt(i, c.set(it.c));
    });
    m.count = items.length;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.userData.noMerge = true;
    return m;
  }, [geo, mat, items, shadow]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return mesh;
}

/** Parked cars in the bays (about two in three taken), motorbikes in their row and at the moto-taxi stand. */
export function CampusProps({ tier }: { tier: Tier }) {
  const lite = tier === "lite";
  const geos = useMemo(() => ({ car: carGeometry(), moto: motoGeometry(), rider: riderGeometry(), light: streetLightGeometry(), bollard: bollardGeometry() }), []);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  const mats = useMemo(() => {
    const w = worldMaterials(tier);
    return {
      car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35, envMapIntensity: 0.9 }),
      moto: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }),
      rider: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      light: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }),
      steel: w.steel!,
    };
  }, [tier]);
  useEffect(() => () => void [mats.car, mats.moto, mats.rider, mats.light].forEach((m) => m.dispose()), [mats]);
  const data = useMemo(() => {
    const cars: Inst[] = [];
    for (const b of PARKING_BAYS) {
      if (b.tree || hash01(b.i, 1) > 0.66) continue;
      const suv = hash01(b.i, 2) < 0.3;
      cars.push({
        x: b.x + (hash01(b.i, 3) - 0.5) * 0.25,
        z: b.z + (b.rotY ? -1 : 1) * (hash01(b.i, 4) - 0.5) * 0.4,
        rotY: b.rotY + (hash01(b.i, 5) - 0.5) * 0.06 + (hash01(b.i, 6) < 0.15 ? Math.PI : 0),
        s: suv ? [1.05, 1.15, 1.04] : [1, 1, 0.96 + hash01(b.i, 7) * 0.06],
        c: CAR_COLOURS[Math.floor(hash01(b.i, 8) * CAR_COLOURS.length)],
      });
    }
    const motos: Inst[] = [];
    for (const b of MOTO_BAYS) if (hash01(b.i, 11) < 0.7) motos.push({ x: b.x, z: b.z, rotY: b.rotY + (hash01(b.i, 12) - 0.5) * 0.2, c: MOTO_COLOURS[Math.floor(hash01(b.i, 13) * MOTO_COLOURS.length)] });
    // the moto-taxi stand: bikes angled towards the road, ready to leave; a rider waits on most of them
    const riders: Inst[] = [];
    let k = 0;
    for (let x = MOTO_STAND.x0; x <= MOTO_STAND.x1; x += 1.25, k++) {
      const m = { x, z: MOTO_STAND.z, rotY: Math.PI * 0.62 + (hash01(k, 21) - 0.5) * 0.15, c: MOTO_COLOURS[k % MOTO_COLOURS.length] };
      motos.push(m);
      if (hash01(k, 22) < 0.7) riders.push({ ...m, c: hash01(k, 23) < 0.5 ? "#ffffff" : "#e6d9cf" });
    }
    const lights: Inst[] = STREET_LIGHTS.map((l) => ({ x: l.x, y: l.y, z: l.z, rotY: l.rotY }));
    const bollards: Inst[] = BOLLARDS.map((p: P) => ({ x: p.x, z: p.z, rotY: 0 }));
    return { cars, motos, riders, lights, bollards };
  }, []);
  const cars = useInstanced(geos.car, mats.car, data.cars, !lite);
  const motos = useInstanced(geos.moto, mats.moto, data.motos, false);
  const riders = useInstanced(geos.rider, mats.rider, data.riders, false);
  const lights = useInstanced(geos.light, mats.light, data.lights, false);
  const bollards = useInstanced(geos.bollard, mats.steel, data.bollards, false);
  // things too small to see from high above are hidden there; the car parks and the forecourt props are drawn only
  // when their (tight) bounds are in view: one instanced mesh spans both car parks, so its own bounds would contain a
  // camera on the plaza and never be culled (fewer draws in the plaza ground view and the campus aerial view)
  const small = useRef<THREE.Group>(null);
  const parks = useRef<THREE.Group>(null);
  const cull = useMemo(() => ({ f: new THREE.Frustum(), m: new THREE.Matrix4(), parks: PARK_BOUNDS, front: FRONT_BOUNDS }), []);
  useFrame(({ camera }) => {
    cull.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cull.f.setFromProjectionMatrix(cull.m);
    if (parks.current) parks.current.visible = cull.parks.some((s) => cull.f.intersectsSphere(s));
    if (small.current) small.current.visible = camera.position.y < 140 && cull.front.some((s) => cull.f.intersectsSphere(s));
  });
  return (
    <group name="campus-props" userData={{ noMerge: true }}>
      <group ref={parks}>
        <primitive object={cars} />
      </group>
      <primitive object={lights} />
      <group ref={small}>
        <primitive object={motos} />
        <primitive object={riders} />
        <primitive object={bollards} />
      </group>
    </group>
  );
}
