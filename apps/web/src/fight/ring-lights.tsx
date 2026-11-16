"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOXER_V7 } from "@/world/human/boxer/body-v6";

/**
 * Fight-night ring lighting (P3-FGT-09). Reference boxing broadcasts and games read as real because the ring is a pool
 * of hard light in a dark room: a strong overhead key, rim / back lights that outline shoulders and arms against the
 * dark, and almost no fill. While a ring is in focus this layer:
 *  - dims the room's flat fill (hemisphere / ambient / sun) towards `fill`;
 *  - drives two rim spots placed BEHIND the pair as seen from the camera (left and right of the camera's line), aimed at
 *    the boxers' shoulders, so their silhouettes pop whatever the camera angle;
 *  - optionally its own overhead key (the dev ring lab; the hall's key is FocusMode's spot pool).
 * Lights are always mounted (intensity 0 when idle): focusing never changes the light count, so no shader rebuild.
 *
 * P3-FGT-18 (docs/FIGHT-REALISM-V7.md §6, flag BOXER_V7): the broadcast rig. A televised amateur bout is lit by a
 * square truss over the ring with fixtures angled in from all four sides at ≈ 50–60°: a hard overhead key (the one
 * shadow in the frame: arms on the trunk, the vest on the body, the fighters on the canvas), the camera-side fixtures
 * that fill the faces under the brow, back fixtures that rim the shoulders, and a dark room (deep falloff). So: the key
 * always comes from here (the hall passes withKey) and casts the ring's ONLY shadow map (fitted to the ring: near /
 * far / angle tight round the pair), two camera-side fill spots without shadows, the rims a touch brighter, the room
 * fill lower. Nothing flashes or pulses (docs/NIGHT-LIGHTING.md photosensitivity: static levels, eased in over the
 * focus fade).
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
export const FOCUS_FILL = BOXER_V7 ? 0.2 : 0.32;
/** rim spot intensity at full focus (decay 0, so metres do not matter) */
export const RIM_INTENSITY = BOXER_V7 ? 4.2 : 3.4;
/** P3-FGT-18 broadcast rig: the overhead key and the two camera-side face fills at full focus */
export const KEY_INTENSITY = BOXER_V7 ? 3.6 : 3.2;
export const FACE_FILL = 0.6;
/** the key's shadow map (px): desktop / phone-class (the renderer's shadow map is off on Lite: no cost there) */
export const KEY_SHADOW = { standard: 2048, coarse: 1024 } as const;

export function RingMood({ k, ring, withKey = false, lite = false }: { k: () => number; ring: () => RingMoodTarget | null; withKey?: boolean; lite?: boolean }) {
  const scene = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);
  const rimA = useRef<THREE.SpotLight>(null);
  const rimB = useRef<THREE.SpotLight>(null);
  const key = useRef<THREE.SpotLight>(null);
  const fillA = useRef<THREE.SpotLight>(null);
  const fillB = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const keyTarget = useMemo(() => new THREE.Object3D(), []);
  const fills = useRef<{ l: THREE.Light; base: number }[] | null>(null);
  const scan = useRef(0);
  const v7 = BOXER_V7;
  const keyOn = withKey || v7;
  const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  useEffect(
    () => () => {
      for (const f of fills.current ?? []) f.l.intensity = f.base;
      fills.current = null;
    },
    [],
  );
  // the key's shadow: a tight frustum over one ring (the pair, the referee, the canvas round them), soft PCF edges,
  // biased for skinned bodies (no acne on the shoulders, no peter-panning at the feet)
  useEffect(() => {
    const l = key.current;
    if (!l || !v7) return;
    l.castShadow = !lite;
    const sz = coarse ? KEY_SHADOW.coarse : KEY_SHADOW.standard;
    l.shadow.mapSize.set(sz, sz);
    l.shadow.camera.near = 3;
    l.shadow.camera.far = 11;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.025;
    l.shadow.radius = 3;
    l.shadow.camera.updateProjectionMatrix();
  }, [v7, lite, coarse]);
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
      for (const l of [rimA.current, rimB.current, key.current, fillA.current, fillB.current]) if (l) l.intensity = 0;
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
      if (v7) {
        // (straight over the ring, a little towards the camera: the faces catch it under the brow; the shadow falls
        // short and dense under the pair, as under a broadcast truss)
        key.current.position.set(r.x - _dir.x * 0.9, y + 6.2, r.z - _dir.z * 0.9);
        keyTarget.position.set(r.x, y, r.z);
        keyTarget.updateMatrixWorld();
      } else key.current.position.set(r.x, y + 7.5, r.z + 0.6);
      key.current.intensity = KEY_INTENSITY * e;
    }
    // the camera-side truss fixtures: up and to each side of the camera line, aimed at the chests (no shadows)
    const fill = (l: THREE.SpotLight | null, s: number) => {
      if (!l) return;
      l.position.set(r.x - _dir.x * 4.2 + _side.x * s * 2.6, y + 4.4, r.z - _dir.z * 4.2 + _side.z * s * 2.6);
      l.intensity = FACE_FILL * e;
    };
    fill(fillA.current, 1);
    fill(fillB.current, -1);
  });
  return (
    <group ref={group} userData={{ noMerge: true, focusKeep: true }}>
      <primitive object={target} />
      <primitive object={keyTarget} />
      <spotLight ref={rimA} target={target} intensity={0} angle={0.42} penumbra={0.6} decay={0} color="#fff4e8" />
      <spotLight ref={rimB} target={target} intensity={0} angle={0.42} penumbra={0.6} decay={0} color="#ffe7cf" />
      {keyOn && <spotLight ref={key} target={v7 ? keyTarget : target} intensity={0} angle={v7 ? 0.62 : 0.5} penumbra={v7 ? 0.55 : 0.75} decay={0} color="#fff5ea" />}
      {v7 && !lite && <spotLight ref={fillA} target={target} intensity={0} angle={0.5} penumbra={0.8} decay={0} color="#fff1e2" />}
      {v7 && !lite && <spotLight ref={fillB} target={target} intensity={0} angle={0.5} penumbra={0.8} decay={0} color="#fff1e2" />}
    </group>
  );
}
