"use client";
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOOR_RING, FOUNTAIN_RADIUS, PORTALS, ringPoint, SERVICE_ANGLE, type PortalDef } from "@/world/layout";
import { RING_PLANTERS } from "@/world/beds";
import { agasekeTexture, pavingTexture } from "@/world/textures";
import { hallFrame } from "./OutdoorView";
import type { HallLayout } from "./layouts";

/**
 * The plaza as seen through the hall's open entrance: the real plaza layout (paving disc, fountain basin with the
 * Agaseke sculpture, ring planters, the arena drum and the neighbouring halls) rebuilt as a low-poly impostor in
 * the hall's own frame, so every landmark sits at its true bearing and distance from this door (the halls stand
 * on the door ring facing the fountain). Everything is merged into one mesh per material (~6 draw calls), never
 * casts shadows, and is only on screen when you look back through the door.
 *
 * Lighting is baked in: outdoor surfaces carry a daylight emissive term so they read sunlit regardless of the
 * hall's moody interior lights.
 */
const ARENA = { cz: -22, rx: 21, rz: 17, wall: 18.5 }; // mirrors world/District.ts (read-only reference)

type Part = { geo: THREE.BufferGeometry; m: THREE.Matrix4 };

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
    const parts: Record<string, Part[]> = { paving: [], lawn: [], stone: [], white: [], glass: [], water: [], agaseke: [], green: [], roof: [] };
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
    add("paving", new THREE.CircleGeometry(32.5, lite ? 48 : 96).rotateX(-Math.PI / 2), 0, -0.012, 0);

    // fountain: basalt basin, white coping, water surface, plinth and the Agaseke sculpture
    add("stone", new THREE.CylinderGeometry(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.15, 0.55, seg), 0, 0.27, 0);
    add("white", new THREE.RingGeometry(FOUNTAIN_RADIUS - 0.35, FOUNTAIN_RADIUS + 0.05, seg).rotateX(-Math.PI / 2), 0, 0.56, 0);
    add("water", new THREE.CircleGeometry(FOUNTAIN_RADIUS - 0.34, seg).rotateX(-Math.PI / 2), 0, 0.49, 0);
    add("stone", new THREE.CylinderGeometry(1.0, 1.15, 0.9, 24), 0, 0.6, 0);
    const prof: [number, number][] = [
      [0.001, 0], [0.5, 0], [0.64, 0.12], [0.78, 0.5], [0.8, 0.9], [0.7, 1.22], [0.6, 1.3], [0.68, 1.34],
      [0.64, 1.5], [0.5, 1.9], [0.32, 2.35], [0.16, 2.75], [0.07, 3.0], [0.001, 3.12],
    ];
    add("agaseke", new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), lite ? 16 : 28), 0, 1.05, 0, 0, [1.25, 1.25, 1.25]);

    // raised ring planters (concrete drum + planting)
    for (const p of RING_PLANTERS) {
      add("white", new THREE.CylinderGeometry(p.r, p.r, p.h, 20), p.x, p.h / 2, p.z);
      add("green", new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), p.x, p.h, p.z, 0, [p.r * 0.92, 0.7, p.r * 0.92]);
    }

    // Tournament Arena: basalt plinth, glazed concourse, white drum and the shallow dome
    const ell = (rx: number, rz: number) => [rx, 1, rz] as [number, number, number];
    add("stone", new THREE.CylinderGeometry(1, 1, 1.2, seg, 1, true), 0, 0.6, ARENA.cz, 0, ell(ARENA.rx + 0.4, ARENA.rz + 0.4));
    add("glass", new THREE.CylinderGeometry(1, 1, 6, seg, 1, true), 0, 4.2, ARENA.cz, 0, ell(ARENA.rx - 0.3, ARENA.rz - 0.3));
    add("white", new THREE.CylinderGeometry(1, 1, ARENA.wall - 7.1, seg, 1, false), 0, 7.1 + (ARENA.wall - 7.1) / 2, ARENA.cz, 0, ell(ARENA.rx + 0.2, ARENA.rz + 0.2));
    add("roof", new THREE.SphereGeometry(1, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, ARENA.wall + 0.2, ARENA.cz, 0, [ARENA.rx + 0.45, 5.5, ARENA.rz + 0.45]);

    // neighbouring buildings on the door ring (this hall itself is where you stand)
    const building = (p: PortalDef | { angleDeg: number; kind: "service" }) => {
      const r = ringPoint(p.angleDeg, DOOR_RING);
      const back = (dist: number) => ringPoint(p.angleDeg, DOOR_RING + dist);
      if (p.kind === "igisoro") {
        const m = back(8.6);
        add("white", new THREE.CylinderGeometry(7, 7, 4.8, 28), m.x, 2.4, m.z);
        add("roof", new THREE.ConeGeometry(9.2, 6.4, 28, 1, true), m.x, 4.8 + 3.2, m.z);
        return;
      }
      const dims = p.kind === "pool" ? { w: 14, dp: 13, h: 7.5 } : p.kind === "ludo" ? { w: 14, dp: 13, h: 5.6 } : p.kind === "service" ? { w: 10, dp: 7, h: 4.4 } : { w: 10, dp: 9, h: 3.2 };
      const m = back(dims.dp / 2);
      const mat = p.kind === "soon" ? "white" : "stone";
      add(mat, new THREE.BoxGeometry(dims.w, dims.h, dims.dp), m.x, dims.h / 2, m.z, r.rotY);
      // glazed shopfront facing the fountain
      const f = back(-0.05);
      add("glass", new THREE.PlaneGeometry(dims.w - 1.2, dims.h * 0.72), f.x, dims.h * 0.38, f.z, r.rotY);
      add("roof", new THREE.BoxGeometry(dims.w + 0.6, 0.5, dims.dp + 0.6), m.x, dims.h + 0.25, m.z, r.rotY);
    };
    for (const p of PORTALS) if (p.id !== layout.game && p.kind !== "arena") building(p);
    building({ angleDeg: SERVICE_ANGLE, kind: "service" });

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
    return merged;
  }, [frame, layout.door.x, layout.game, lite, d]);

  // the plaza's real buildings are smaller outside than the halls are inside (the arena drum would cut through this
  // room): clip the impostor to the outside of the entrance wall, so only what the doorway frames is ever drawn
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  const mats = useMemo(() => {
    const clip = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -(d / 2 + 0.25))];
    const day = (color: string, k = 0.55, extra: THREE.MeshLambertMaterialParameters = {}) =>
      new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(k), clippingPlanes: clip, ...extra });
    const paving = pavingTexture().clone();
    paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
    paving.repeat.set(65 / 4, 65 / 4);
    paving.needsUpdate = true;
    const agaseke = agasekeTexture().clone();
    agaseke.wrapS = agaseke.wrapT = THREE.RepeatWrapping;
    agaseke.repeat.set(6, 1);
    agaseke.needsUpdate = true;
    return {
      paving: day("#b9b2a6", 0.62, { map: paving, emissiveMap: paving }),
      lawn: day("#6f8f4c", 0.5),
      stone: day("#5d5a55", 0.5),
      white: day("#e4dfd5", 0.55),
      glass: day("#2a3842", 0.45),
      water: day("#3c6168", 0.55),
      agaseke: day("#ffffff", 0.6, { map: agaseke, emissiveMap: agaseke }),
      green: day("#557c3a", 0.5),
      roof: day("#9ea3a8", 0.55),
    } as Record<string, THREE.MeshLambertMaterial>;
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
