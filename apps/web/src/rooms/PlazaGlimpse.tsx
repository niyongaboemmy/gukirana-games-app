"use client";
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOOR_RING, FOUNTAIN_RADIUS, PAVING_R, ringPoint } from "@/world/layout";
import { RING_PLANTERS } from "@/world/beds";
import { ARENA } from "@/world/District";
import { PLOTS, type Plot } from "@/world/footprints";
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
    const parts: Record<string, Part[]> = { paving: [], lawn: [], stone: [], white: [], glass: [], water: [], agaseke: [], green: [], roof: [], thatch: [], arenaStone: [], arenaGlass: [], arenaWhite: [], arenaRoof: [] };
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

    // neighbouring buildings on the door ring, from the plaza's own footprints (local frame: door at the origin,
    // facade towards the fountain = +z, volume towards -z); this hall itself is where you stand
    const HEIGHT: Record<string, number> = { pool: 7.5, ludo: 5.6, igisoro: 4.8, soon: 3.2, site: 2.6, service: 4.4 };
    const building = (p: Plot) => {
      const r = ringPoint(p.angleDeg, DOOR_RING);
      const cr = Math.cos(r.rotY);
      const sr = Math.sin(r.rotY);
      const h = HEIGHT[p.type] ?? 4;
      for (const f of p.rects) {
        const lx = (f.x0 + f.x1) / 2;
        const lz = (f.z0 + f.z1) / 2;
        const fw = Math.abs(f.x1 - f.x0);
        const fd = Math.abs(f.z0 - f.z1);
        const wx = r.x + lx * cr + lz * sr;
        const wz = r.z - lx * sr + lz * cr;
        add(p.type === "soon" || p.type === "site" ? "white" : "stone", new THREE.BoxGeometry(fw, h, fd), wx, h / 2, wz, r.rotY);
        if (p.type === "site") continue;
        if (p.type === "igisoro") {
          // hipped thatch: a four-sided pyramid stretched over the rectangle
          add("thatch", new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), wx, h + 2.6, wz, r.rotY, [fw + 1.6, 5.2, fd + 1.6]);
        } else add("roof", new THREE.BoxGeometry(fw + 0.6, 0.5, fd + 0.6), wx, h + 0.25, wz, r.rotY);
      }
      // glazed shopfront facing the fountain (on the front footprint)
      if (p.type === "site") return;
      const front = p.rects[0]!;
      const fx = (front.x0 + front.x1) / 2;
      const gx = r.x + fx * cr + (front.z0 + 0.05) * sr;
      const gz = r.z - fx * sr + (front.z0 + 0.05) * cr;
      add("glass", new THREE.PlaneGeometry(Math.abs(front.x1 - front.x0) - 1.2, h * 0.72), gx, h * 0.38, gz, r.rotY);
    };
    for (const p of PLOTS) if (p.ring === DOOR_RING && p.id !== layout.game && p.type !== "arena") building(p);

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
    const clip = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -(d / 2 + 0.35))];
    const day = (color: string, k = 0.55, extra: THREE.MeshLambertMaterialParameters = {}) =>
      new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(k), clippingPlanes: clip, ...extra });
    const paving = pavingTexture().clone();
    paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
    paving.repeat.set((PAVING_R * 2) / 4.8, (PAVING_R * 2) / 4.8);
    paving.needsUpdate = true;
    const agaseke = agasekeTexture().clone();
    agaseke.wrapS = agaseke.wrapT = THREE.RepeatWrapping;
    agaseke.repeat.set(6, 1);
    agaseke.needsUpdate = true;
    const out = {
      paving: day("#b9b2a6", 0.62, { map: paving, emissiveMap: paving }),
      lawn: day("#6f8f4c", 0.5),
      stone: day("#5d5a55", 0.5),
      white: day("#e4dfd5", 0.55),
      glass: day("#2a3842", 0.45),
      water: day("#3c6168", 0.55),
      agaseke: day("#ffffff", 0.6, { map: agaseke, emissiveMap: agaseke }),
      green: day("#557c3a", 0.5),
      roof: day("#9ea3a8", 0.55),
      thatch: day("#a08560", 0.5),
    } as Record<string, THREE.MeshLambertMaterial>;
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
