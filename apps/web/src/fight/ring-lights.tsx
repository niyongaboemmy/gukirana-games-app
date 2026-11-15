"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Fight-night ring lighting (P3-FGT-09). Reference boxing broadcasts and games read as real because the ring is a pool
 * of hard light in a dark room: a strong overhead key, rim / back lights that outline shoulders and arms against the
 * dark, and almost no fill. While a ring is in focus this layer:
 *  - dims the room's flat fill (hemisphere / ambient / sun) towards `fill`;
 *  - drives two rim spots placed BEHIND the pair as seen from the camera (left and right of the camera's line), aimed at
 *    the boxers' shoulders, so their silhouettes pop whatever the camera angle;
 *  - optionally its own overhead key (the dev ring lab; the hall's key is FocusMode's spot pool).
 * Lights are always mounted (intensity 0 when idle): focusing never changes the light count, so no shader rebuild.
 * No extra shadow maps (perf budget: the room already has one shadow light at most).
 */
export interface RingMoodTarget {
  x: number;
  z: number;
  canvasY: number;
}
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** fill the room keeps at full focus (share of its normal intensity) */
export const FOCUS_FILL = 0.32;
/** rim spot intensity at full focus (decay 0, so metres do not matter) */
export const RIM_INTENSITY = 3.4;

export function RingMood({ k, ring, withKey = false }: { k: () => number; ring: () => RingMoodTarget | null; withKey?: boolean }) {
  const scene = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);
  const rimA = useRef<THREE.SpotLight>(null);
  const rimB = useRef<THREE.SpotLight>(null);
  const key = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const fills = useRef<{ l: THREE.Light; base: number }[] | null>(null);
  const scan = useRef(0);
  useEffect(
    () => () => {
      for (const f of fills.current ?? []) f.l.intensity = f.base;
      fills.current = null;
    },
    [],
  );
  useFrame(({ camera }, dt) => {
    const e = Math.max(0, Math.min(1, k()));
    const r = ring();
    // the room's fill lights (found once, re-scanned now and then for late mounts), restored when the focus lifts
    scan.current -= dt;
    if (!fills.current || scan.current <= 0) {
      scan.current = 2;
      const known = new Set((fills.current ?? []).map((f) => f.l));
      const list = fills.current ?? [];
      scene.traverse((o) => {
        const l = o as THREE.Light;
        if (!l.isLight || known.has(l)) return;
        let p: THREE.Object3D | null = o;
        while (p && p !== group.current) p = p.parent;
        if (p) return; // our own lights
        if ((l as THREE.HemisphereLight).isHemisphereLight || (l as THREE.AmbientLight).isAmbientLight || (l as THREE.DirectionalLight).isDirectionalLight) list.push({ l, base: l.intensity });
      });
      fills.current = list;
    }
    for (const f of fills.current) f.l.intensity = f.base * (1 - (1 - FOCUS_FILL) * e);
    if (!r || e <= 0.001) {
      for (const l of [rimA.current, rimB.current, key.current]) if (l) l.intensity = 0;
      return;
    }
    // behind the pair as the camera sees it: along the camera → ring line, past the ring centre
    _dir.set(r.x - camera.position.x, 0, r.z - camera.position.z);
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
    _dir.normalize();
    _side.crossVectors(_dir, UP).normalize();
    const y = r.canvasY;
    target.position.set(r.x, y + 1.35, r.z);
    target.updateMatrixWorld();
    const put = (l: THREE.SpotLight | null, s: number) => {
      if (!l) return;
      l.position.set(r.x + _dir.x * 3.2 + _side.x * s * 2.4, y + 3.6, r.z + _dir.z * 3.2 + _side.z * s * 2.4);
      l.intensity = RIM_INTENSITY * e;
    };
    put(rimA.current, 1);
    put(rimB.current, -1);
    if (key.current) {
      key.current.position.set(r.x, y + 7.5, r.z + 0.6);
      key.current.intensity = 3.2 * e;
    }
  });
  return (
    <group ref={group} userData={{ noMerge: true, focusKeep: true }}>
      <primitive object={target} />
      <spotLight ref={rimA} target={target} intensity={0} angle={0.42} penumbra={0.6} decay={0} color="#fff4e8" />
      <spotLight ref={rimB} target={target} intensity={0} angle={0.42} penumbra={0.6} decay={0} color="#ffe7cf" />
      {withKey && <spotLight ref={key} target={target} intensity={0} angle={0.5} penumbra={0.75} decay={0} color="#fff3e2" />}
    </group>
  );
}
