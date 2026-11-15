"use client";
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOOR_RING, FOUNTAIN_RADIUS, OUTER_PROMENADE, PAVING_R, ringPoint } from "@/world/layout";
import { PROMENADE_DEG, PROMENADE_EAST_DEG } from "@/world/campus";
import { RING_PLANTERS } from "@/world/beds";
import { ARENA } from "@/world/District";
import { agasekeTexture, pavingTexture } from "@/world/textures";
import { agasekeGeometry } from "@/world/agaseke";
import { hallFrame } from "./OutdoorView";
import { impostorBlocks } from "./plaza-impostor";
import type { HallLayout } from "./layouts";

/**
 * The plaza as seen through the hall's open entrance: the real plaza layout (paving disc, fountain basin with the
 * Agaseke sculpture, ring planters, the arena drum and every other building on the campus with its real height and
 * facade material: plaza-impostor.ts) rebuilt as a low-poly impostor in the hall's own frame, so every landmark sits
 * at its true bearing and distance from this door (P2-WLD-15: also from the Administrative Block out on the
 * expansion ring, which looks back over the outer promenade towards the plaza, not onto the fountain). Everything is merged into one mesh per material (~6 draw calls), never
 * casts shadows, and is only on screen when you look back through the door.
 *
 * Lighting is baked in: outdoor surfaces carry a daylight emissive term so they read sunlit regardless of the
 * hall's moody interior lights.
 */

type Part = { geo: THREE.BufferGeometry; m: THREE.Matrix4 };

/** facade colours of the campus buildings (world/materials.ts), the roofs and the warm lit shopfronts */
const BLOCK_COLORS: Record<string, string> = {
  concreteDark: "#6f6c68",
  brick: "#9a5a42",
  limestone: "#d8d0bf",
  charcoal: "#5c5c62",
  wood: "#a07a52",
  hoarding: "#262b38",
  // lava-stone base course, and the Imigongo frieze band under the Igisoro eaves
  lava: "#3a3634",
  roof: "#9ea3a8",
  thatch: "#a08560",
  // shopfront glass: dark, with the warm interior showing through
  glass: "#5a4632",
};

export function PlazaGlimpse({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { d } = layout.size;
  const frame = useMemo(() => hallFrame(layout), [layout]);

  const built = useMemo(() => {
    const c = Math.cos(frame.yaw);
    const s = Math.sin(frame.yaw);
    // world (plaza) → hall frame: translate by the building centre, rotate by the portal bearing, then the door x offset
    const at = (wx: number, wz: number): [number, number] => {
      const dx = wx - frame.centre.x;
      const dz = wz - frame.centre.z;
      return [dx * c + dz * s + layout.door.x, -dx * s + dz * c];
    };
    const parts: Record<string, Part[]> = { paving: [], lawn: [], granite: [], stone: [], white: [], glass: [], water: [], agaseke: [], green: [], roof: [], thatch: [], concreteDark: [], brick: [], limestone: [], charcoal: [], wood: [], hoarding: [], lava: [], arenaStone: [], arenaGlass: [], arenaWhite: [], arenaRoof: [] };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const add = (mat: string, geo: THREE.BufferGeometry, wx: number, y: number, wz: number, rotY = 0, scale: [number, number, number] = [1, 1, 1]) => {
      const [x, z] = at(wx, wz);
      q.setFromAxisAngle(up, rotY + frame.yaw);
      parts[mat]!.push({ geo, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(...scale)) });
    };
    const seg = lite ? 28 : 48;

    // ground: lawn beyond the ring, the paved plaza disc (same 4 m stone module as the plaza)
    // (the lawn is a strip south of the entrance wall only: through the north windows the captured landscape shows)
    const lawn = new THREE.PlaneGeometry(200, 110).rotateX(-Math.PI / 2);
    parts.lawn!.push({ geo: lawn, m: new THREE.Matrix4().makeTranslation(0, -0.03, d / 2 + 0.3 + 55) });
    add("paving", new THREE.CircleGeometry(PAVING_R, lite ? 64 : 128).rotateX(-Math.PI / 2), 0, -0.012, 0);

    // fountain: basalt basin, white coping, water surface, plinth and the Agaseke sculpture
    add("stone", new THREE.CylinderGeometry(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.15, 0.55, seg), 0, 0.27, 0);
    add("white", new THREE.RingGeometry(FOUNTAIN_RADIUS - 0.35, FOUNTAIN_RADIUS + 0.05, seg).rotateX(-Math.PI / 2), 0, 0.56, 0);
    add("water", new THREE.CircleGeometry(FOUNTAIN_RADIUS - 0.34, seg).rotateX(-Math.PI / 2), 0, 0.49, 0);
    add("stone", new THREE.CylinderGeometry(1.0, 1.15, 0.9, 24), 0, 0.6, 0);
    add("agaseke", agasekeGeometry(3.8, lite ? 16 : 28), 0, 1.05, 0);

    // raised ring planters (concrete drum + planting)
    for (const p of RING_PLANTERS) {
      add("white", new THREE.CylinderGeometry(p.r, p.r, p.h, 20), p.x, p.h / 2, p.z);
      add("green", new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), p.x, p.h, p.z, 0, [p.r * 0.92, 0.7, p.r * 0.92]);
    }

    // Tournament Arena: basalt plinth, glazed concourse, white drum and the shallow dome (ARENA is in the arena
    // door's frame: the door stands on the ring due north, so the drum centre is DOOR_RING + |cz| north of the fountain)
    // (not from inside the arena itself: its own drum would stand over its lobby)
    const az = ringPoint(0, DOOR_RING).z + ARENA.cz;
    const ell = (rx: number, rz: number) => [rx, 1, rz] as [number, number, number];
    if (layout.game !== "arena") {
    add("arenaStone", new THREE.CylinderGeometry(1, 1, 1.2, seg, 1, true), 0, 0.6, az, 0, ell(ARENA.rx + 0.4, ARENA.rz + 0.4));
    add("arenaGlass", new THREE.CylinderGeometry(1, 1, 6, seg, 1, true), 0, 4.2, az, 0, ell(ARENA.rx - 0.3, ARENA.rz - 0.3));
    add("arenaWhite", new THREE.CylinderGeometry(1, 1, ARENA.wall - 7.1, seg, 1, false), 0, 7.1 + (ARENA.wall - 7.1) / 2, az, 0, ell(ARENA.rx + 0.2, ARENA.rz + 0.2));
    add("arenaRoof", new THREE.SphereGeometry(1, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, ARENA.wall + 0.2, az, 0, [ARENA.rx + 0.45, 5.5, ARENA.rz + 0.45]);
    }

    // every other building on the campus at its true place, height and facade material (rooms/plaza-impostor.ts: the
    // door ring and the expansion ring, the Boxing hall's long body, the reserved sites behind their hoarding); the
    // plaza side of each wing carries its lit shopfront
    for (const k of impostorBlocks(layout.game)) {
      add(k.mat, new THREE.BoxGeometry(k.w, k.h, k.d), k.x, k.h / 2, k.z, k.rotY);
      if (k.mat !== "hoarding") add("lava", new THREE.BoxGeometry(k.w + 0.12, 0.9, k.d + 0.12), k.x, 0.45, k.z, k.rotY);
      if (k.roof === "thatch") add("lava", new THREE.BoxGeometry(k.w + 0.1, 0.9, k.d + 0.1), k.x, k.h - 0.8, k.z, k.rotY);
      if (k.roof === "thatch") add("thatch", new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), k.x, k.h + 2.6, k.z, k.rotY, [k.w + 1.6, 5.2, k.d + 1.6]);
      else if (k.roof === "slab") add("roof", new THREE.BoxGeometry(k.w + 0.4, 0.4, k.d + 0.4), k.x, k.h + 0.2, k.z, k.rotY);
      if (k.glass) {
        // on the block's plaza face (+z of its frame), sill at the paving
        const c = Math.cos(k.rotY);
        const sn = Math.sin(k.rotY);
        const off = k.d / 2 + 0.03;
        add("glass", new THREE.PlaneGeometry(k.glass.w, k.glass.h), k.x + off * sn, k.glass.h / 2, k.z + off * c, k.rotY);
      }
    }
    // the outer promenade's granite arc (seen from the Administrative Block across its forecourt)
    {
      const t0 = ((90 - PROMENADE_EAST_DEG) * Math.PI) / 180;
      const tl = ((PROMENADE_DEG + PROMENADE_EAST_DEG) * Math.PI) / 180;
      add("granite", new THREE.RingGeometry(OUTER_PROMENADE.r0, OUTER_PROMENADE.r1, 96, 1, t0, tl).rotateX(-Math.PI / 2), 0, -0.006, 0);
    }

    const merged: Record<string, THREE.BufferGeometry> = {};
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const geos = list.map(({ geo, m }) => {
        const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
        for (const a of Object.keys(g.attributes)) if (a !== "position" && a !== "normal" && a !== "uv") g.deleteAttribute(a);
        return g;
      });
      merged[k] = mergeGeometries(geos)!;
      geos.forEach((g) => g.dispose());
    }
    // the buildings in ONE draw call: their facade colours (and a baked sun / sky shade per face) as vertex colours
    const sun = frame.sun.clone().normalize();
    const shaded: THREE.BufferGeometry[] = [];
    for (const [k, hex] of Object.entries(BLOCK_COLORS)) {
      const g = merged[k];
      if (!g) continue;
      delete merged[k];
      const base = new THREE.Color(hex);
      const n = g.getAttribute("normal") as THREE.BufferAttribute;
      const col = new Float32Array(n.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < n.count; i++) {
        v.fromBufferAttribute(n, i);
        const lit = k === "glass" ? 1 : 0.62 + 0.18 * Math.max(0, v.y) + 0.38 * Math.max(0, v.dot(sun));
        col[i * 3] = base.r * lit;
        col[i * 3 + 1] = base.g * lit;
        col[i * 3 + 2] = base.b * lit;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      if (g.getAttribute("uv")) g.deleteAttribute("uv");
      shaded.push(g);
    }
    if (shaded.length) {
      merged.blocks = mergeGeometries(shaded)!;
      shaded.forEach((g) => g.dispose());
    }
    return merged;
  }, [frame, layout.door.x, layout.game, lite, d]);

  // the plaza's real buildings are smaller outside than the halls are inside (the arena drum would cut through this
  // room): clip the impostor to the outside of the entrance wall, so only what the doorway frames is ever drawn
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  const mats = useMemo(() => {
    const clip = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -(d / 2 + 0.35))];
    const day = (color: string, k = 0.55, extra: THREE.MeshLambertMaterialParameters = {}) =>
      new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(k), clippingPlanes: clip, ...extra });
    const paving = pavingTexture().clone();
    paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
    paving.repeat.set((PAVING_R * 2) / 4.8, (PAVING_R * 2) / 4.8);
    paving.needsUpdate = true;
    const agaseke = agasekeTexture().clone();
    agaseke.wrapS = agaseke.wrapT = THREE.RepeatWrapping;
    agaseke.needsUpdate = true;
    const out = {
      paving: day("#b9b2a6", 0.62, { map: paving, emissiveMap: paving }),
      lawn: day("#6f8f4c", 0.5),
      stone: day("#5d5a55", 0.5),
      white: day("#e4dfd5", 0.55),
      glass: day("#2a3842", 0.45),
      granite: day("#a8a196", 0.55),
      // every building (vertex-coloured facades, baked daylight: unlit, so the hall's own lights never shade it)
      blocks: new THREE.MeshBasicMaterial({ vertexColors: true, clippingPlanes: clip }),
      water: day("#3c6168", 0.55),
      agaseke: day("#ffffff", 0.6, { map: agaseke, emissiveMap: agaseke }),
      green: day("#557c3a", 0.5),
      roof: day("#9ea3a8", 0.55),
    } as Record<string, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>;
    // the arena drum stands right beside some halls: only draw it from 8 m outside the door, so it never hangs over
    // the doorway like a canopy (the real hall exteriors are smaller than these interiors)
    const far = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -(d / 2 + 8))];
    for (const k of ["stone", "glass", "white", "roof"]) {
      const m = out[k]!.clone();
      m.clippingPlanes = far;
      out[`arena${k[0]!.toUpperCase()}${k.slice(1)}`] = m;
    }
    return out;
  }, [d]);

  useEffect(
    () => () => {
      Object.values(built).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    },
    [built, mats],
  );

  // the paving disc reaches ~3 m under the hall floor near the door; the floor (y = 0) simply covers it
  return (
    <group>
      {Object.entries(built).map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k]} />
      ))}
    </group>
  );
}
