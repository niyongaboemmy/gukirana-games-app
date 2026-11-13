"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { ContactShadows, useGLTF } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { BitmapTextureLoader } from "@/world/bitmap-texture";
import * as THREE from "three";
import { blobTexture } from "./room-textures";

/**
 * Shared building blocks for the hall interiors: CC0 PBR texture sets and glTF props from
 * /public/assets/interiors (see docs/ASSET-LICENSES.md, "Interiors"), drawn with instancing so each prop
 * type costs one draw call per material no matter how many copies stand in the room.
 */
export const INTERIOR_BASE = "/assets/interiors";
export const model = (name: string) => `${INTERIOR_BASE}/models/${name}.glb`;

export type PbrName =
  | "herringbone_parquet"
  | "white_plaster_02"
  | "oak_veneer_01"
  | "rough_wood"
  | "clay_plaster"
  | "tatami_mat"
  | "bark_brown_02"
  | "velour_velvet";

export interface Pbr {
  map?: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/** Loads a texture set (diffuse / normal / roughness, webp) and returns clones tiled `repeat` times. */
export function usePbr(
  name: PbrName,
  repeat: [number, number] = [1, 1],
  opts: { map?: boolean; rotate?: boolean } = {},
): Pbr {
  const withMap = opts.map !== false;
  const urls = [
    `${INTERIOR_BASE}/tex/${name}_nor.webp`,
    `${INTERIOR_BASE}/tex/${name}_rough.webp`,
    ...(withMap ? [`${INTERIOR_BASE}/tex/${name}_diff.webp`] : []),
  ];
  // decoded off the main thread (createImageBitmap): no decode stall in the first upload while the hall pre-warms
  const loaded = useLoader(BitmapTextureLoader, urls);
  return useMemo(() => {
    const prep = (t: THREE.Texture, srgb: boolean) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      if (opts.rotate) {
        c.center.set(0.5, 0.5);
        c.rotation = Math.PI / 2;
      }
      c.anisotropy = 8;
      c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      c.needsUpdate = true;
      return c;
    };
    return {
      normalMap: prep(loaded[0]!, false),
      roughnessMap: prep(loaded[1]!, false),
      map: withMap ? prep(loaded[2]!, true) : undefined,
    };
  }, [loaded, repeat[0], repeat[1], withMap, opts.rotate]);
}

/* ---------------- instancing ---------------- */

export interface Xform {
  p: [number, number, number];
  /** yaw (rotation about y) */
  r?: number;
  s?: number | [number, number, number];
  /** extra rotation about x / z (tilted props) */
  rx?: number;
  rz?: number;
}
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function xformMatrix(x: Xform, out = new THREE.Matrix4()) {
  _e.set(x.rx ?? 0, x.r ?? 0, x.rz ?? 0, "YXZ");
  _q.setFromEuler(_e);
  const s = x.s ?? 1;
  if (typeof s === "number") _s.setScalar(s);
  else _s.set(s[0], s[1], s[2]);
  return out.compose(_p.set(...x.p), _q, _s);
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  local: THREE.Matrix4;
}

/** Every mesh of a glTF (optionally only nodes whose name contains `pick`) with its transform relative to the file root. */
function useParts(
  url: string,
  pick?: string,
  tint?: string,
  matOverride?: (m: THREE.MeshStandardMaterial) => void,
): Part[] {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    scene.updateMatrixWorld(true);
    const parts: Part[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (pick) {
        let n: THREE.Object3D | null = mesh;
        let hit = false;
        while (n) {
          if (n.name.includes(pick)) hit = true;
          n = n.parent;
        }
        if (!hit) return;
      }
      let material = mesh.material as THREE.Material;
      if (tint || matOverride) {
        const m = (material as THREE.MeshStandardMaterial).clone();
        if (tint) m.color.set(tint);
        matOverride?.(m);
        material = m;
      }
      parts.push({ geometry: mesh.geometry, material, local: mesh.matrixWorld.clone() });
    });
    if (pick && parts.length) {
      // a picked sub-object (e.g. one bottle of a set) is re-centred: base on y = 0, centred on x / z
      const box = new THREE.Box3();
      const b = new THREE.Box3();
      for (const p of parts) {
        p.geometry.computeBoundingBox();
        box.union(b.copy(p.geometry.boundingBox!).applyMatrix4(p.local));
      }
      const shift = new THREE.Matrix4().makeTranslation(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      );
      for (const p of parts) p.local.premultiply(shift);
    }
    return parts;
  }, [scene, pick, tint, matOverride]);
}

/** Instanced copies of a glTF prop. One InstancedMesh per primitive; transforms are static. */
export function GltfInstances({
  url,
  items,
  pick,
  tint,
  castShadow = false,
  receiveShadow = true,
  matOverride,
}: {
  url: string;
  items: Xform[];
  pick?: string;
  tint?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  matOverride?: (m: THREE.MeshStandardMaterial) => void;
}) {
  const parts = useParts(url, pick, tint, matOverride);
  return (
    <>
      {parts.map((part, i) => (
        <PartInstances
          key={i}
          part={part}
          items={items}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      ))}
    </>
  );
}

function PartInstances({
  part,
  items,
  castShadow,
  receiveShadow,
}: {
  part: Part;
  items: Xform[];
  castShadow: boolean;
  receiveShadow: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    items.forEach((x, i) => im.setMatrixAt(i, xformMatrix(x, _m).multiply(part.local)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [items, part]);
  if (!items.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, part.material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

/** Instanced procedural geometry with static transforms (+ optional per-instance colours). */
export function Instanced({
  geometry,
  items,
  colors,
  castShadow = false,
  receiveShadow = true,
  children,
}: {
  geometry: THREE.BufferGeometry;
  items: Xform[];
  colors?: string[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const c = new THREE.Color();
    items.forEach((x, i) => {
      im.setMatrixAt(i, xformMatrix(x, _m));
      if (colors) im.setColorAt(i, c.set(colors[i % colors.length]!));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [items, colors]);
  if (!items.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      {children}
    </instancedMesh>
  );
}

/* ---------------- baked contact shadows (soft blobs under furniture, zero runtime cost) ---------------- */

export interface Blob {
  x: number;
  z: number;
  w: number;
  d: number;
  r?: number;
  o?: number;
}
/**
 * Real contact shadows under each table cluster (table + chairs + board pieces), baked once when the room mounts
 * (frames = 1, so they cost one small depth render each, then a single textured plane). Standard tier only; Lite
 * keeps the blob decals. Sits just above the floor rugs / mats (y = 0.012) so those are not captured as occluders.
 */
export function TableContactShadows({ tables, size = 3.4, lite }: { tables: { x: number; z: number }[]; size?: number; lite: boolean }) {
  if (lite) return null;
  return (
    <>
      {tables.map((t, i) => (
        <ContactShadows key={i} position={[t.x, 0.012, t.z]} scale={size} far={1.4} opacity={0.45} blur={2.5} resolution={256} frames={1} color="#1a120c" />
      ))}
    </>
  );
}

export function BlobShadows({
  items,
  opacity = 0.55,
  y = 0.004,
}: {
  items: Blob[];
  opacity?: number;
  y?: number;
}) {
  const tex = useMemo(() => blobTexture(), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const xf = useMemo<Xform[]>(
    () => items.map((b) => ({ p: [b.x, y, b.z], r: b.r ?? 0, s: [b.w, 1, b.d] })),
    [items, y],
  );
  return (
    <Instanced geometry={geo} items={xf} receiveShadow={false}>
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
        color="#000000"
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </Instanced>
  );
}

/** Additive light pool on the floor / wall (fakes bounce under pendant lamps without another light). */
export function LightPools({
  items,
  color,
  opacity = 0.35,
  y = 0.006,
}: {
  items: Blob[];
  color: string;
  opacity?: number;
  y?: number;
}) {
  const tex = useMemo(() => blobTexture(), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const xf = useMemo<Xform[]>(
    () => items.map((b) => ({ p: [b.x, y, b.z], r: b.r ?? 0, s: [b.w, 1, b.d] })),
    [items, y],
  );
  return (
    <Instanced geometry={geo} items={xf} receiveShadow={false}>
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
        color={color}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </Instanced>
  );
}

/** Spot light aimed straight down at (x, 0, z); the target object is kept in sync without being in the scene graph. */
export function DownSpot({
  x,
  y,
  z,
  angle,
  penumbra = 0.5,
  intensity,
  distance,
  decay = 1.6,
  color,
  shadow = false,
  tx,
  tz,
}: {
  x: number;
  y: number;
  z: number;
  angle: number;
  penumbra?: number;
  intensity: number;
  distance: number;
  decay?: number;
  color: string;
  shadow?: boolean;
  tx?: number;
  tz?: number;
}) {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(tx ?? x, 0, tz ?? z);
    o.updateMatrixWorld();
    return o;
  }, [x, z, tx, tz]);
  return (
    <spotLight
      position={[x, y, z]}
      target={target}
      angle={angle}
      penumbra={penumbra}
      intensity={intensity}
      distance={distance}
      decay={decay}
      color={color}
      castShadow={shadow}
      shadow-mapSize={[512, 512]}
      shadow-bias={-0.0005}
      shadow-normalBias={0.02}
    />
  );
}
