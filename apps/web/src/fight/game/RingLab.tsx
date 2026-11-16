"use client";
import { useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { RingId } from "@gukirana/contracts";
import { HallRingKit } from "../assets-shim";
import { FightersLayer } from "../fighters";
import { FightCamera } from "../camera";
import { useFightUi } from "../ui-store";
import { RING_BY_ID } from "../plan";
import { useFightBridge } from "../bridge";
import { RingMood } from "../ring-lights";
import { useDelayed } from "../use-delayed";
import { STOOL_PLACE_S } from "@/rooms/fight/ring-kit-core";
import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { BOXER_V7 } from "@/world/human/boxer/body-v6";
import { BOXER_GENERATION, BOXER_V8_REQUESTED } from "@/world/human/boxer/generation";

/** P3-FGT-18: the post chain on (v7; ?ao=0 turns it off for before / after frames) */
const AO = BOXER_V7 && (typeof window === "undefined" || new URLSearchParams(window.location.search).get("ao") !== "0");

/**
 * Dev-only 3D ring for the fight lab (P3-FGT-07, `/fight-lab?scene=1`): the practice ring with its fighters, referee and
 * the fight camera, without the hall, the API or a login — for quick visual / perf checks of the ring realism.
 * window.__gkRingLab: { calls, tris, fps } (draw calls / triangles of the last frame, frames per second).
 */
export function RingLab({ ring }: { ring: RingId }) {
  const place = RING_BY_ID[ring]!;
  const status = useFightBridge((s) => s.rings[ring]?.status ?? "practice");
  // the corner stools between rounds, once the seconds have carried them in (as the hall: BoxingHallScene)
  const resting = useFightBridge((s) => s.mine?.snap?.phase === "rest");
  const placed = useDelayed(resting, STOOL_PLACE_S * 1000);
  const rings = useMemo(() => [{ id: ring, x: place.x, z: place.z, rotY: place.rotY, status, number: Number(ring.slice(1)), rest: resting && placed }], [ring, place, status, resting, placed]);
  return (
    <Canvas shadows={BOXER_V7 ? "percentage" : undefined} style={{ position: "fixed", inset: 0 }} dpr={[1, 1.5]} camera={{ fov: 55, near: 0.05, far: 120, position: [place.x + 5, 3, place.z + 5] }} gl={{ antialias: true }}>
      <color attach="background" args={["#0c0a09"]} />
      <hemisphereLight args={["#fff4e6", "#2a2622", 0.9]} />
      <directionalLight position={[place.x + 3, 9, place.z + 2]} intensity={2.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[place.x, 0, place.z]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#4a4541" roughness={0.9} />
      </mesh>
      <HallRingKit rings={rings} size="training" lite={false} />
      <FightersLayer lite={false} />
      <FightCamera />
      <RingMood k={() => 1} ring={() => place} withKey />
      {/* P3-FGT-18: the hall's post chain for a fighter in focus (N8AO + ACES), as SceneCanvas Effects */}
      {AO && (
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <N8AO quality="performance" aoRadius={0.55} distanceFalloff={0.9} intensity={2.4} color="black" />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
      <Probe at={place} />
    </Canvas>
  );
}

function Probe({ at }: { at: { x: number; z: number } }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.lookAt(new THREE.Vector3(at.x, 1, at.z));
  }, [camera, at]);
  const st = useMemo(() => ({ calls: 0, tris: 0, fps: 0, frames: 0, t0: performance.now() }), []);
  useEffect(() => {
    // (P3-FGT-19B: camera / renderer / three for the fighter-v8 harness, qa/e2e/fighter-v8)
    (window as unknown as { __gkRingLab?: unknown }).__gkRingLab = Object.assign(st, { scene, camera, gl, three: THREE, generation: BOXER_GENERATION, v8Requested: BOXER_V8_REQUESTED, ui: useFightUi });
    // ?fcam=first|fight|behind|auto: the fight camera choice (P3-FGT-15 evidence)
    const fcam = new URLSearchParams(window.location.search).get("fcam");
    if (fcam === "first" || fcam === "fight" || fcam === "behind" || fcam === "auto") useFightUi.getState().set({ fightCam: fcam });
  }, [st, scene, camera, gl]);
  useEffect(() => {
    gl.info.autoReset = false;
    return () => void (gl.info.autoReset = true);
  }, [gl]);
  useFrame(() => {
    // (read before this frame renders: the counts of the last frame, then start counting the next one)
    st.calls = gl.info.render.calls;
    st.tris = gl.info.render.triangles;
    gl.info.reset();
    st.frames++;
    const now = performance.now();
    if (now - st.t0 >= 1000) {
      st.fps = Math.round((st.frames * 1000) / (now - st.t0));
      st.frames = 0;
      st.t0 = now;
    }
  });
  // ?cam=x,y,z,lx,ly,lz (m from the ring centre): a fixed close-up instead of the fight camera
  const fixed = useMemo(() => {
    const v = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
    return v && v.length === 6 && v.every(Number.isFinite) ? v : null;
  }, []);
  useFrame(() => {
    if (!fixed) return;
    camera.position.set(at.x + fixed[0]!, fixed[1]!, at.z + fixed[2]!);
    camera.lookAt(at.x + fixed[3]!, fixed[4]!, at.z + fixed[5]!);
  }, 0.9);
  // the fight camera runs at priority 0.5, which turns R3F's own render off: render here, after it
  useFrame(({ scene }) => {
    if (!AO) gl.render(scene, camera);
  }, 1);
  return null;
}
