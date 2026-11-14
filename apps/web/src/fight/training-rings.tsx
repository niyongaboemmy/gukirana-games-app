"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CORNER_COLORS, type RingId, type RingStatus } from "@gukirana/contracts";
import { STATUS_LAMP } from "./assets-shim";

/**
 * Training rings (P3-FGT-01): the 48 standard rings of the Boxing hall at the plan's training-gym size (4.3 m inside
 * the ropes, 4.9 m platform, plan §4.3). The assets ring kit (rooms/fight/ring-kit, P3-FGT-02) is a mid-size pro ring
 * (5.9 m inside the ropes, a 9.8 m spectator-rail square) that has no size option: 48 of them cannot fit the 93 × 30 m
 * hall, so it is used for the two feature rings (R1 / R2) and these instanced training rings fill the blocks, in the
 * same corner convention (red at local (−x, −z), blue (+x, +z)) and the same deck height (0.8 m). Swap to the kit
 * once it takes a ring size. Seven instanced meshes for all of them.
 */

/* ------------------------------------------------------------ ring kit ------------------------------------------------------------ */

export interface RingKitRing {
  id: RingId;
  x: number;
  z: number;
  rotY: number;
  feature?: boolean;
  status: RingStatus;
}

const STD = { platform: 4.9, canvasY: 0.8, base: 0 };

/**
 * Placeholder instanced ring kit: platform + canvas, apron status band, four corner posts (red / blue / two neutral),
 * three ropes a side, two corner steps and stools. Seven instanced meshes for all rings (7 draw calls).
 */
export function TrainingRings({ rings, lite = false }: { rings: RingKitRing[]; lite?: boolean }) {
  const n = rings.length;
  const refs = {
    platform: useRef<THREE.InstancedMesh>(null),
    canvas: useRef<THREE.InstancedMesh>(null),
    band: useRef<THREE.InstancedMesh>(null),
    post: useRef<THREE.InstancedMesh>(null),
    rope: useRef<THREE.InstancedMesh>(null),
    step: useRef<THREE.InstancedMesh>(null),
    stool: useRef<THREE.InstancedMesh>(null),
  };
  const geo = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, lite ? 6 : 10),
    }),
    [lite],
  );
  const mats = useMemo(
    () => ({
      platform: new THREE.MeshStandardMaterial({ color: "#1d1d20", roughness: 0.8 }),
      canvas: new THREE.MeshStandardMaterial({ color: "#d9d6cf", roughness: 0.92 }),
      band: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      post: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }),
      rope: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }),
      step: new THREE.MeshStandardMaterial({ color: "#2b2b2e", roughness: 0.75, metalness: 0.2 }),
      stool: new THREE.MeshStandardMaterial({ color: "#3a3a3d", roughness: 0.7 }),
    }),
    [],
  );
  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose());
    Object.values(mats).forEach((m) => m.dispose());
  }, [geo, mats]);

  // static transforms (rebuilt only when the ring list changes shape)
  const layoutKey = rings.map((r) => `${r.id}:${r.x}:${r.z}:${r.rotY}:${r.feature ? 1 : 0}`).join("|");
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const put = (mesh: THREE.InstancedMesh | null, i: number, r: RingKitRing, lx: number, y: number, lz: number, sx: number, sy: number, sz: number, ry = 0) => {
      if (!mesh) return;
      const cs = Math.cos(r.rotY);
      const sn = Math.sin(r.rotY);
      v.set(r.x + lx * cs + lz * sn, y, r.z - lx * sn + lz * cs);
      q.setFromEuler(e.set(0, r.rotY + ry, 0));
      s.set(sx, sy, sz);
      mesh.setMatrixAt(i, m.compose(v, q, s));
    };
    let pi = 0;
    let ri = 0;
    rings.forEach((r, i) => {
      const d = STD;
      const h = d.platform / 2;
      put(refs.platform.current, i, r, 0, (d.canvasY - 0.04) / 2, 0, d.platform, d.canvasY - 0.04, d.platform);
      put(refs.canvas.current, i, r, 0, d.canvasY - 0.02, 0, d.platform - 0.5, 0.04, d.platform - 0.5);
      put(refs.band.current, i, r, 0, d.base + 0.14, 0, d.platform + 0.04, 0.08, d.platform + 0.04);
      const inner = h - 0.3;
      // posts: red (−x,+z), blue (+x,−z), neutral
      const corners: [number, number, string][] = [
        [-inner, -inner, CORNER_COLORS.red],
        [inner, inner, CORNER_COLORS.blue],
        [inner, -inner, "#f2f2f0"],
        [-inner, inner, "#f2f2f0"],
      ];
      for (const [lx, lz, col] of corners) {
        put(refs.post.current, pi, r, lx, d.canvasY + 0.7, lz, 0.14, 1.4, 0.14);
        refs.post.current?.setColorAt(pi, c.set(col));
        pi++;
      }
      // ropes: three heights, four sides (slight sag is the real kit's job)
      for (const y of [0.45, 0.85, 1.25])
        for (const [lx, lz, len, rot] of [
          [0, inner, inner * 2, 0],
          [0, -inner, inner * 2, 0],
          [inner, 0, inner * 2, Math.PI / 2],
          [-inner, 0, inner * 2, Math.PI / 2],
        ] as const) {
          put(refs.rope.current, ri, r, lx, d.canvasY + y, lz, len, 0.035, 0.035, rot);
          ri++;
        }
      // steps at the red and blue corners (diagonally out), stools in those corners
      for (const [k, sgn] of [
        [0, -1],
        [1, 1],
      ] as const) {
        const o = h + 0.35;
        put(refs.step.current, i * 2 + k, r, sgn * o, d.canvasY / 2 - 0.1, sgn * o, 0.9, d.canvasY - 0.2, 0.9, Math.PI / 4);
        put(refs.stool.current, i * 2 + k, r, sgn * (inner - 0.45), d.canvasY + 0.25, sgn * (inner - 0.45), 0.4, 0.5, 0.4);
      }
    });
    for (const k of Object.values(refs)) {
      const mesh = k.current;
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [layoutKey]);

  // status lamps (band colours); the result status blinks
  const statusKey = rings.map((r) => r.status).join(",");
  const blink = useRef(false);
  const paint = (on: boolean) => {
    const mesh = refs.band.current;
    if (!mesh) return;
    const c = new THREE.Color();
    rings.forEach((r, i) => mesh.setColorAt(i, c.set(r.status === "result" && !on ? "#3a1512" : STATUS_LAMP[r.status])));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  useLayoutEffect(() => paint(true), [statusKey, layoutKey]);
  useFrame(({ clock }) => {
    if (!statusKey.includes("result")) return;
    const on = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    if (on !== blink.current) {
      blink.current = on;
      paint(on);
    }
  });

  return (
    <group userData={{ noMerge: true }}>
      <instancedMesh ref={refs.platform} args={[geo.box, mats.platform, n]} castShadow={!lite} receiveShadow />
      <instancedMesh ref={refs.canvas} args={[geo.box, mats.canvas, n]} receiveShadow />
      <instancedMesh ref={refs.band} args={[geo.box, mats.band, n]} />
      <instancedMesh ref={refs.post} args={[geo.cyl, mats.post, n * 4]} />
      <instancedMesh ref={refs.rope} args={[geo.box, mats.rope, n * 12]} />
      <instancedMesh ref={refs.step} args={[geo.box, mats.step, n * 2]} />
      <instancedMesh ref={refs.stool} args={[geo.box, mats.stool, n * 2]} />
    </group>
  );
}

