"use client";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Shared navigation for plaza, halls and gate (DESIGN-SPEC §8, usability pass):
 * - Keyboard: W/S (↑/↓) walk forward / back along the facing; A/D (←/→) TURN the person — the camera swings
 *   with them, so no mouse is needed to steer.
 * - Joystick / touch: camera-relative walking; the camera lazily swings behind the direction of travel.
 * - Click / tap on the ground: walk there (marker shown); any key / joystick input cancels it.
 * - Drag / swipe: free look; auto-follow resumes ~1.2 s after the last manual camera move.
 */
export const nav = {
  lastManualCam: 0,
  target: null as { x: number; z: number } | null,
};

// dev-only hook for automated walk-through tests (like window.__gkCam)
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __gkNav: typeof nav }).__gkNav = nav;

const TURN_RATE = 2.4; // rad/s for keyboard turning
const ARRIVE = 0.3; // m

export const markManualCamera = () => (nav.lastManualCam = performance.now());

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface SteerInput {
  keys: Set<string>;
  joyX: number;
  joyY: number;
  camYaw: number;
  facing: number;
  x: number;
  z: number;
  walkSpeed: number;
  run: boolean;
  dt: number;
}
export interface SteerResult {
  dx: number;
  dz: number;
  facing: number;
  speed: number;
  moving: boolean;
  turning: boolean;
  mode: "keys" | "joy" | "click" | null;
}

export function steer(i: SteerInput): SteerResult {
  const k = i.keys;
  const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
  const turn = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  let facing = i.facing;
  let heading = facing;
  let mag = 0;
  let dir = 1;
  let mode: SteerResult["mode"] = null;

  if (turn) facing -= turn * TURN_RATE * i.dt; // right = clockwise seen from above
  if (fwd) {
    heading = facing;
    mag = 1;
    dir = fwd > 0 ? 1 : -1;
    mode = "keys";
  }
  const jm = Math.hypot(i.joyX, i.joyY);
  if (!fwd && jm > 0.08) {
    heading = Math.atan2(-i.joyX, i.joyY) + i.camYaw + Math.PI; // camera-relative
    mag = Math.min(1, jm);
    mode = "joy";
    facing += wrap(heading - facing) * Math.min(1, i.dt * 8);
  }
  if (mode || turn) nav.target = null; // manual input cancels click-to-walk
  if (!mode && nav.target) {
    const tx = nav.target.x - i.x;
    const tz = nav.target.z - i.z;
    const d = Math.hypot(tx, tz);
    if (d < ARRIVE) nav.target = null;
    else {
      heading = Math.atan2(tx, tz);
      mag = Math.min(1, d / 0.8 + 0.25);
      mode = "click";
      facing += wrap(heading - facing) * Math.min(1, i.dt * 8);
    }
  }
  const speed = i.walkSpeed * (i.run ? 1.8 : 1) * mag * (dir < 0 ? 0.6 : 1);
  return {
    dx: Math.sin(heading) * speed * i.dt * dir,
    dz: Math.cos(heading) * speed * i.dt * dir,
    facing,
    speed,
    moving: mag > 0,
    turning: turn !== 0,
    mode,
  };
}

/** Swings the orbit camera behind the avatar while moving (unless the player just moved the camera). */
export function autoFollow(cam: { yaw: number }, s: Pick<SteerResult, "facing" | "moving" | "turning" | "mode">, dt: number) {
  if (!s.moving && !s.turning) return;
  if (performance.now() - nav.lastManualCam < 1200) return;
  const rate = s.mode === "keys" || s.turning ? 7 : s.mode === "click" ? 2.5 : 1.4;
  cam.yaw += wrap(s.facing + Math.PI - cam.yaw) * Math.min(1, dt * rate);
}

const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

/** Ground point under a screen position (y = 0 plane). */
export function groundPoint(clientX: number, clientY: number, el: HTMLElement, camera: THREE.Camera): { x: number; z: number } | null {
  const r = el.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  return ray.ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
}

/** Pointer helper: distinguishes a click/tap (walk there) from a drag (look around). */
export function pointerNav(el: HTMLElement, camera: () => THREE.Camera, onDrag: (dx: number, dy: number) => void, clamp?: (p: { x: number; z: number }) => { x: number; z: number } | null) {
  let down: { x: number; y: number; t: number; lx: number; ly: number; moved: boolean } | null = null;
  const pd = (e: PointerEvent) => {
    if (e.button > 0 && e.pointerType === "mouse" && e.button !== 2) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), lx: e.clientX, ly: e.clientY, moved: false };
  };
  const pm = (e: PointerEvent) => {
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (down.moved) {
      onDrag(e.clientX - down.lx, e.clientY - down.ly);
      markManualCamera();
    }
    down.lx = e.clientX;
    down.ly = e.clientY;
  };
  const pu = (e: PointerEvent) => {
    if (down && !down.moved && performance.now() - down.t < 400) {
      const p = groundPoint(e.clientX, e.clientY, el, camera());
      if (p) nav.target = clamp ? clamp(p) : p;
    }
    down = null;
  };
  el.addEventListener("pointerdown", pd);
  el.addEventListener("pointermove", pm);
  window.addEventListener("pointerup", pu);
  return () => {
    el.removeEventListener("pointerdown", pd);
    el.removeEventListener("pointermove", pm);
    window.removeEventListener("pointerup", pu);
  };
}

/** Pulsing ring where the player clicked/tapped to walk. */
export function TargetMarker({ color = "#3DA9FC" }: { color?: string }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = nav.target;
    g.current.visible = !!t;
    if (t) {
      g.current.position.set(t.x, 0.03, t.z);
      const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.12;
      g.current.scale.set(s, 1, s);
    }
  });
  return (
    <group ref={g} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.42, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  );
}
