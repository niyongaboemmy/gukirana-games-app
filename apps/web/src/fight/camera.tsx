"use client";
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { isOnScreen, useArea } from "@/world/stage";
import { useFightBridge } from "./bridge";
import { RING_BY_ID } from "./plan";
import { useFightUi } from "./ui-store";

/**
 * Fight camera + watch cameras (P3-FGT-01 §4.3 / §11.8). Runs after the hall controller's follow camera (frame priority
 * 0.5: after RoomPlayer, before the compositor draws) and takes over the area camera while:
 *  - your fight is on: a broadcast side view square to the pair (they stay left / right, the ring fills the frame),
 *    or "behind you" (over your shoulder towards the opponent);
 *  - you watch a ring with the Rail or Overhead camera.
 * Moves are damped (no cuts); letting go hands the camera back to the follow camera, which eases on from here.
 *
 * Stability (P3-FGT-04): this camera keeps its OWN eye / look state and writes the camera from it. (It used to lerp
 * the camera position the follow camera had just lerped elsewhere in the same frame: the two pulls met at a frame-rate
 * dependent spot in between that wobbled as the follow target moved.) Its targets follow the snapshots (10–15 Hz
 * steps) through the same exponential glide. On release the follow camera's position eases on from here, but its
 * lookAt turned the view round in one frame: the orientation is now slerped back over HANDOFF_S.
 */
const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const HANDOFF_S = 0.9;
export function FightCamera() {
  const area = useArea();
  const camera = useThree((s) => s.camera);
  const look = useRef(new THREE.Vector3());
  const eye = useRef(new THREE.Vector3());
  const on = useRef(false);
  const side = useRef(1);
  /** the orientation shown last frame, and how long a released camera is still being turned back */
  const lastQ = useRef(new THREE.Quaternion());
  const handoff = useRef(0);
  useFrame((_, raw) => {
    if (!isOnScreen(area)) {
      on.current = false;
      handoff.current = 0;
      return;
    }
    const dt = Math.min(raw, 0.05);
    const b = useFightBridge.getState();
    const ui = useFightUi.getState();
    const mine = b.mine?.snap && b.mine.snap.phase !== "over" ? b.mine : null;
    const ringId = mine ? mine.ring : ui.watchCam && b.watched ? b.watched.ring : null;
    if (!ringId) {
      if (on.current) {
        on.current = false;
        handoff.current = HANDOFF_S;
      }
      if (handoff.current > 0) {
        // the follow camera has set this frame's view: turn towards it from last frame's view instead of snapping
        handoff.current = Math.max(0, handoff.current - dt);
        _q.copy(camera.quaternion);
        camera.quaternion.copy(lastQ.current).slerp(_q, handoff.current > 0 ? 1 - Math.exp(-dt * 6) : 1);
      }
      lastQ.current.copy(camera.quaternion);
      return;
    }
    const r = RING_BY_ID[ringId]!;
    const snap = mine ? mine.snap! : b.watched?.snap;
    const th = snap ? ((snap.orbit / 10) * Math.PI) / 180 : 0;
    // the pair's axis (ax, az) and its perpendicular
    const ax = Math.cos(th);
    const az = Math.sin(th);
    const cy = r.canvasY;
    if (!on.current) {
      on.current = true;
      handoff.current = 0;
      // pick the side of the ring the camera already is on (no swing through the ropes)
      side.current = (camera.position.x - r.x) * -az + (camera.position.z - r.z) * ax >= 0 ? 1 : -1;
      eye.current.copy(camera.position);
      // start from where the camera already looks (4 m ahead), then glide onto the ring
      look.current.set(0, 0, -4).applyQuaternion(camera.quaternion).add(camera.position);
    }
    const mode = mine ? ui.fightCam : ui.watchCam;
    if (mode === "fight" || (mode === "rail" && !mine)) {
      const d = mode === "rail" ? r.half + 1.8 : r.half + 2.6;
      _eye.set(r.x + -az * side.current * d, cy + (mode === "rail" ? 1.2 : 1.9), r.z + ax * side.current * d);
      _look.set(r.x, cy + 1.25, r.z);
    } else if (mode === "overhead") {
      _eye.set(r.x + -az * side.current * 2.2, cy + 6.8, r.z + ax * side.current * 2.2);
      _look.set(r.x, cy + 0.6, r.z);
    } else {
      // behind you: over your shoulder towards the opponent
      const s = mine && mine.corner === "red" ? -1 : 1;
      const half = snap ? Math.min(snap.dist / 200, r.half - 0.8) : 0.75;
      const mx = r.x + s * half * ax;
      const mz = r.z + s * half * az;
      _eye.set(mx + s * ax * 2.2 + -az * 0.5, cy + 2.0, mz + s * az * 2.2 + ax * 0.5);
      _look.set(r.x - s * half * ax, cy + 1.35, r.z - s * half * az);
    }
    const k = 1 - Math.exp(-dt * 4);
    eye.current.lerp(_eye, k);
    look.current.lerp(_look, k);
    camera.position.copy(eye.current);
    camera.lookAt(look.current);
    lastQ.current.copy(camera.quaternion);
  }, 0.5);
  return null;
}
