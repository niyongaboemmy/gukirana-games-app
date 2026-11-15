"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seededLook } from "@/world/outfits";
import { BoxerAvatar } from "@/world/human/boxer/BoxerAvatar";
import { BoxingMotion } from "@/world/human/boxing/motion";
import { RING, toHall } from "@/rooms/fight/ring-kit-core";
import { ringNow } from "./ring-clock";
import { FEATURE_RING, RINGS } from "./plan";
import { BOXER_BODY } from "./fighter-avatar";

/**
 * The judges at the feature rings (P3-FGT-14): three officials seated at the three judges' tables of each feature ring
 * (rooms/fight/ring-kit-geometry featureExtrasGeometry: −z, +x, −x sides of the ring frame, the chair 0.52 m behind
 * the table, facing the ring), white shirt and bow tie, watching the ring and writing on their scoresheets (the
 * judgeSit clip, each on its own phase). Only on the feature rings, only within JUDGES_NEAR m of the camera (kept
 * mounted and paused / hidden beyond: no build hitch), three draw calls per ring when shown.
 */
export const JUDGES_NEAR = 26;
/** the chair centre behind each table (ring frame, pro ring), and the table's turn */
const TABLE_OFF = RING.half + 0.45;
const SEATS = [0, Math.PI / 2, -Math.PI / 2].map((rot) => {
  // the judgeSit pose has the hips 4 cm behind the root: the root stands 4 cm towards the ring from the chair centre
  const lz = -TABLE_OFF - 0.52 + 0.04;
  return { lx: Math.sin(rot) * lz, lz: Math.cos(rot) * lz, yaw: rot };
});

/** the judges' seats of a feature ring in hall coordinates (the R1 ringside is turned π to face the stage front) */
export function judgeSeats(r: { id: string; x: number; z: number; rotY: number }) {
  const yaw = r.rotY + (r.id === "R1" ? Math.PI : 0);
  return SEATS.map((s) => toHall({ x: r.x, z: r.z, rotY: yaw }, s.lx, FEATURE_RING.stage, s.lz, s.yaw));
}

export function Judges({ lite = false }: { lite?: boolean }) {
  const rings = useMemo(() => RINGS.filter((r) => r.feature), []);
  if (!BOXER_BODY || lite) return null;
  return (
    <group>
      {rings.map((r) => (
        <RingJudges key={r.id} ring={r} />
      ))}
    </group>
  );
}

function RingJudges({ ring }: { ring: { id: string; x: number; z: number; rotY: number } }) {
  const seats = useMemo(() => judgeSeats(ring), [ring]);
  const looks = useMemo(() => seats.map((_, k) => seededLook(`judge-${ring.id}-${k}`, "#7a7a7a")), [seats, ring.id]);
  const motions = useMemo(() => seats.map(() => new BoxingMotion({ base: "judgeSit" })), [seats]);
  // each judge on their own phase of the watch / write loop
  const clocks = useMemo(() => seats.map((_, k) => () => ringNow() + k * 1.9), [seats]);
  const paused = useMemo(() => ({ current: true }), []);
  const grp = useRef<THREE.Group>(null);
  const centre = useMemo(() => new THREE.Vector3(ring.x, FEATURE_RING.stage + 1, ring.z), [ring]);
  useFrame(({ camera }) => {
    const near = camera.position.distanceTo(centre) < JUDGES_NEAR;
    paused.current = !near;
    if (grp.current) grp.current.visible = near;
  });
  return (
    <group ref={grp} visible={false}>
      {seats.map((s, k) => (
        <group key={k} position={[s.x, s.y, s.z]} rotation={[0, s.yaw, 0]}>
          <BoxerAvatar look={looks[k]!} outfit="referee" motion={motions[k]!} clock={clocks[k]!} seed={k * 7919 + ring.id.charCodeAt(1)} paused={paused} lite />
        </group>
      ))}
    </group>
  );
}
