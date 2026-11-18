"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { RingId } from "@gukirana/contracts";
import { isOnScreen, useArea } from "@/world/stage";
import { useFightBridge } from "./bridge";
import { eased, focusNow, focusTarget, FOCUS_IDLE, keepRadius, publishFocus, SPECTATOR_DIM, SPECTATOR_FOG, stepFocus, useFightFocus, type FocusState } from "./focus";
import { RING_BY_ID } from "./plan";
import { useFightUi } from "./ui-store";
import { useGymScene } from "./gym-life";
import { RingMood } from "./ring-lights";
import { BOXER_V7 } from "@/world/human/boxer/body-v6";

/**
 * Focus-mode driver (P3-FGT-05, fight/focus.ts): mounted once inside the Boxing hall scene.
 *  - darkness: a near-black fog measured from the camera that starts just past the focus ring and a background eased
 *    to the same colour, so every other ring, sign, bench and person sinks into the dark (one uniform per material:
 *    no shader rebuild, no pop);
 *  - a spot pool over the focus ring (the light is always mounted at intensity 0, so focusing never adds a light and
 *    never recompiles shaders);
 *  - culling: once fully dark, every hall object that does not reach the focus ring is hidden (fewer draw calls); they
 *    are shown again as soon as the fade turns back, while it is still dark.
 * Objects marked `userData.focusKeep` (the fighters layer, the camera) are never touched.
 */
const DARK = new THREE.Color("#0c0a09");
const _c = new THREE.Color();
const _s = new THREE.Sphere();
const _p = new THREE.Vector3();

export function FocusMode({ lite = false }: { lite?: boolean }) {
  const area = useArea();
  const scene = useThree((s) => s.scene);
  const anchor = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const state = useRef<FocusState>(FOCUS_IDLE);
  const saved = useRef<{ fog: THREE.Scene["fog"]; bg: THREE.Color | null } | null>(null);
  const fog = useMemo(() => new THREE.Fog(DARK.clone(), 1000, 2000), []);
  const culled = useRef<THREE.Object3D[]>([]);
  const decided = useRef(new WeakSet<THREE.Object3D>());
  const cullAcc = useRef(0);
  const target = useMemo(() => new THREE.Object3D(), []);

  const restoreBackground = () => {
    if (!saved.current) return;
    if (saved.current.bg && scene.background instanceof THREE.Color) scene.background.copy(saved.current.bg);
    saved.current = null;
  };
  const restoreScene = () => {
    if (!saved.current) return;
    scene.fog = saved.current.fog;
    if (saved.current.bg && scene.background instanceof THREE.Color) scene.background.copy(saved.current.bg);
    saved.current = null;
  };
  const uncull = () => {
    for (const o of culled.current) o.visible = true;
    culled.current = [];
    decided.current = new WeakSet();
  };
  useEffect(() => {
    // dev QA handle: the focus state + the world UI store (watch cameras)
    if (process.env.NODE_ENV !== "production") Object.assign(window as unknown as Record<string, unknown>, { __gkFocus: { now: focusNow, ui: useFightUi } });
  }, []);
  // installed from the start, before the area warm-up compiles the hall (see the frame loop)
  useLayoutEffect(() => {
    fog.near = 1e4;
    fog.far = 2e4;
    if (!scene.fog) scene.fog = fog;
  }, [scene, fog]);
  useEffect(
    () => () => {
      uncull();
      restoreScene();
      publishFocus(FOCUS_IDLE);
      state.current = FOCUS_IDLE;
    },
    [],
  );

  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, 0.05);
    const onScreen = isOnScreen(area);
    const b = useFightBridge.getState();
    const t = onScreen ? focusTarget({ mine: b.mine, watched: b.watched, watchCam: useFightUi.getState().watchCam }) : { ring: null, mode: null };
    const next = onScreen ? stepFocus(state.current, t, dt) : FOCUS_IDLE;
    const was = state.current;
    state.current = next;
    publishFocus(next);
    const e = focusNow.e;
    const ring = next.ring ? RING_BY_ID[next.ring as RingId] : undefined;

    // culling follows `hidden` (true only while fully dark)
    if (was.hidden && !next.hidden) uncull();
    // the gym (training zone, staff, its ambient sound) follows: hidden only while fully dark (the fog does the fade)
    const gymHidden = next.hidden && next.mode === "fighter";
    if (useGymScene.getState().hidden !== gymHidden) useGymScene.setState({ hidden: gymHidden });
    if (next.hidden && ring && anchor.current?.parent) {
      cullAcc.current -= dt;
      if (cullAcc.current <= 0) {
        cullAcc.current = 0.5; // late-mounting LODs / props are picked up on the next pass
        cullPass(anchor.current.parent, ring, keepRadius(next.mode, ring.half), culled.current, decided.current);
      }
    }

    // darkness: the fog object is installed once while the hall shows (a far-away fog = no effect) and only its
    // distances change, so focusing never recompiles a shader; it is removed when the hall goes off screen
    // P3-FGT-25: the fog stays installed while the hall is warm off screen too (a far-away fog = no effect): installing
    // it only once the hall showed changed every hall material's program (FOG define) on its first visible frame, so
    // the whole hall recompiled at the door — the area warm-up (SceneCanvas AreaWarm) had compiled it without fog
    if (!onScreen) {
      restoreBackground();
      if (scene.fog !== fog) scene.fog = fog;
      fog.near = 1e4;
      fog.far = 2e4;
      return;
    }
    if (!saved.current) saved.current = { fog: scene.fog === fog ? null : scene.fog, bg: scene.background instanceof THREE.Color ? scene.background.clone() : null };
    if (scene.fog !== fog) scene.fog = fog;
    if (e <= 0.001 || !ring) {
      fog.near = 1e4;
      fog.far = 2e4;
      if (saved.current.bg && scene.background instanceof THREE.Color) scene.background.copy(saved.current.bg);
      if (spot.current) spot.current.intensity = 0;
      return;
    }
    const d = Math.hypot(camera.position.x - ring.x, camera.position.z - ring.z);
    const spectator = next.mode === "spectator";
    // fighter: black a little past the far ropes; spectator: the neighbouring rings stay half visible
    const nearF = d + (spectator ? ring.half + SPECTATOR_FOG.near : ring.half * 0.5);
    const farF = d + (spectator ? ring.half + SPECTATOR_FOG.far : ring.half + 5.5);
    // progress of this mode's own fade (the spectator fade stops at SPECTATOR_DIM)
    const ee = Math.min(1, spectator ? e / eased(SPECTATOR_DIM) : e);
    fog.near = THREE.MathUtils.lerp(nearF + 120, nearF, ee);
    fog.far = THREE.MathUtils.lerp(farF + 240, farF, ee);
    if (saved.current.bg && scene.background instanceof THREE.Color) scene.background.copy(_c.copy(saved.current.bg).lerp(DARK, spectator ? ee * 0.8 : ee));
    // the spot pool
    if (spot.current) {
      spot.current.position.set(ring.x, ring.canvasY + 7.5, ring.z + 0.8);
      target.position.set(ring.x, ring.canvasY, ring.z);
      target.updateMatrixWorld();
      // (P3-FGT-18: under BOXER_V7 the key is the broadcast rig's, in RingMood; this pool stays dark)
      spot.current.intensity = BOXER_V7 ? 0 : (spectator ? 1.2 : 3.6) * ee;
      spot.current.angle = ring.feature ? 0.5 : 0.42;
    }
  });

  return (
    <group ref={anchor} userData={{ noMerge: true, focusKeep: true }}>
      <primitive object={target} />
      {/* fight-night mood (P3-FGT-09): room fill dimmed, rim lights behind the pair */}
      <RingMood k={() => (focusNow.mode === "fighter" ? focusNow.e : focusNow.e * 0.4)} ring={() => (focusNow.ring ? (RING_BY_ID[focusNow.ring as RingId] ?? null) : null)} lite={lite} />
      <spotLight ref={spot} target={target} intensity={0} angle={0.42} penumbra={0.7} decay={0} color="#fff3e2" position={[0, 9, 0]} />
    </group>
  );
}

/** hide every object under `root` that does not reach the focus ring (huge objects spanning the hall are kept) */
function cullPass(root: THREE.Object3D, ring: { x: number; z: number; half: number; canvasY: number }, keepR: number, culled: THREE.Object3D[], decided: WeakSet<THREE.Object3D>) {
  const visit = (o: THREE.Object3D) => {
    if (o.userData?.focusKeep) return;
    const m = o as THREE.Mesh;
    if ((m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) && !decided.has(o)) {
      decided.add(o);
      if (o.visible && !(o as THREE.InstancedMesh).isInstancedMesh) {
        const g = m.geometry as THREE.BufferGeometry | undefined;
        if (g) {
          if (!g.boundingSphere) g.computeBoundingSphere();
          if (g.boundingSphere) {
            _s.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
            _p.set(ring.x, _s.center.y, ring.z);
            const far = _s.center.distanceTo(_p) - _s.radius > keepR;
            if (far && _s.radius < 20) {
              o.visible = false;
              culled.push(o);
              return;
            }
          }
        }
      }
    }
    for (const c of o.children) visit(c);
  };
  for (const c of root.children) visit(c);
}

/** BoxingHallScene hook: the ring-kit fields only keep the focus ring once the hall is fully dark */
export function useFocusRings<T extends { id: RingId }>(rings: T[]): T[] {
  const hidden = useFightFocus((s) => s.hidden && s.mode === "fighter");
  const ring = useFightFocus((s) => s.ring);
  return useMemo(() => (hidden && ring ? rings.filter((r) => r.id === ring) : rings), [rings, hidden, ring]);
}
