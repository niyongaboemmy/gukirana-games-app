"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { DOOR, type PortalDef } from "./layout";
import type { Tier } from "./materials";
import { blobTexture, doorBadgeTexture, hallGlimpseTexture, woodTexture } from "./textures";

/**
 * A real entrance vestibule behind each plaza hall door (P1-WLD-03, review P0-2): instead of a glowing poster the
 * doorway opens onto a 2.8 m lobby in the hall's own materials — floor, side walls, a ceiling with warm downlights
 * and soft light pools — ending in the open inner doorway with an out-of-focus view into the hall.
 * Local frame = the building's door frame (door centre at x = 0, plaza towards +z), `inset` = door line z.
 */
const DEPTH = 2.8;

interface Style {
  floor: string;
  floorTex?: "wood" | "herringbone" | "tile";
  wall: string;
  ceiling: string;
  lights: number;
}
const STYLES: Record<PortalDef["kind"], Style> = {
  pool: { floor: "#5a3f2c", floorTex: "wood", wall: "#4a3d33", ceiling: "#2a2622", lights: 3 },
  ludo: { floor: "#b07a4a", floorTex: "herringbone", wall: "#cdb796", ceiling: "#8a6a4a", lights: 3 },
  igisoro: { floor: "#9a5b3c", floorTex: "tile", wall: "#c9a77c", ceiling: "#7a5a36", lights: 2 },
  arena: { floor: "#8e8a84", floorTex: "tile", wall: "#d8d6d0", ceiling: "#3a3c40", lights: 3 },
  soon: { floor: "#777", wall: "#777", ceiling: "#555", lights: 0 },
};

/** Herringbone / tile floor variants of the shared wood texture (cached per kind). */
function floorMap(kind: Style["floorTex"]): THREE.Texture | null {
  if (!kind) return null;
  if (kind === "wood") {
    const t = woodTexture().clone();
    t.repeat.set(1.2, 1.2);
    t.rotation = Math.PI / 2;
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  if (kind === "tile") {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 225 + ((x * 7 + y * 13) % 5) * 6;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
      }
  } else {
    // herringbone: 45° staggered planks
    g.save();
    g.translate(64, 64);
    g.rotate(Math.PI / 4);
    for (let i = -6; i < 6; i++)
      for (let j = -6; j < 6; j++) {
        const v = 205 + ((i * 5 + j * 11 + 40) % 7) * 7;
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
        if ((i + j) % 2 === 0) g.fillRect(i * 16, j * 16, 31, 15);
        else g.fillRect(i * 16, j * 16, 15, 31);
      }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

export function Vestibule({ def, inset, tier }: { def: PortalDef; inset: number; tier: Tier }) {
  const s = STYLES[def.kind];
  const lite = tier === "lite";
  const mats = useMemo(() => {
    // the recess is shaded by the building: without real shadows (Lite) darken it by hand
    const k = lite ? 0.55 : 1;
    const col = (hex: string) => new THREE.Color(hex).multiplyScalar(k);
    const fm = floorMap(s.floorTex);
    return {
      floor: new THREE.MeshStandardMaterial({ color: col(s.floor), map: fm, roughness: 0.55, metalness: 0 }),
      wall: new THREE.MeshStandardMaterial({ color: col(s.wall), roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ color: col(s.ceiling), roughness: 0.9 }),
      light: new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffe3b8").multiplyScalar(0.8),
        toneMapped: false,
      }),
      pool: new THREE.MeshBasicMaterial({
        map: blobTexture(),
        color: "#ffd9a0",
        transparent: true,
        opacity: lite ? 0.16 : 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      glimpse: new THREE.MeshBasicMaterial({
        map: hallGlimpseTexture(def.kind),
        color: new THREE.Color("#ffffff").multiplyScalar(lite ? 0.62 : 0.78),
      }),
    };
  }, [def.kind, s, lite]);
  useEffect(
    () => () => {
      mats.floor.map?.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );
  const w = DOOR.w + 0.3;
  const h = DOOR.h + 0.25;
  const z0 = inset - 0.04;
  const zc = z0 - DEPTH / 2;
  const cast = !lite;
  return (
    <group>
      <mesh
        material={mats.floor}
        position={[0, 0.012, zc]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={cast}
      >
        <planeGeometry args={[w, DEPTH]} />
      </mesh>
      {[-1, 1].map((sd) => (
        <mesh
          key={sd}
          material={mats.wall}
          position={[sd * (w / 2 + 0.05), h / 2, zc]}
          castShadow={cast}
          receiveShadow={cast}
        >
          <boxGeometry args={[0.1, h, DEPTH]} />
        </mesh>
      ))}
      <mesh material={mats.ceiling} position={[0, h + 0.05, zc]} castShadow={cast} receiveShadow={cast}>
        <boxGeometry args={[w + 0.2, 0.1, DEPTH]} />
      </mesh>
      {Array.from({ length: s.lights }, (_, i) => {
        const z = z0 - ((i + 0.5) / s.lights) * DEPTH;
        return (
          <group key={i}>
            <mesh material={mats.light} position={[0, h - 0.002, z]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.09, 20]} />
            </mesh>
            <mesh
              material={mats.pool}
              position={[0, 0.02, z]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={1}
            >
              <planeGeometry args={[1.6, 1.6]} />
            </mesh>
          </group>
        );
      })}
      {/* inner doorway: the hall seen out of focus beyond the lobby */}
      <mesh material={mats.glimpse} position={[0, h / 2, z0 - DEPTH]}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

/** Small lit game sign (0.6 m) above a hall door, replacing the old full-height door poster. */
export function DoorBadge({ def, y, z }: { def: PortalDef; y: number; z: number }) {
  const mat = useMemo(() => {
    const tex = doorBadgeTexture(def.kind, def.color);
    return new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: "#ffffff",
      emissiveIntensity: 0.55,
      roughness: 0.4,
      transparent: true,
      alphaTest: 0.05,
    });
  }, [def.kind, def.color]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} position={[0, y, z]}>
      <planeGeometry args={[0.6, 0.6]} />
    </mesh>
  );
}
