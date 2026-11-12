"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import { FOUNTAIN_RADIUS, INTERACT_RADIUS, PLAZA_RADIUS, PORTALS, portalTransform, SPAWN } from "./layout";
import { useWorld } from "@/lib/world-store";
import { sendMove } from "@/lib/realtime";

const WALK = 3.0; // m/s (DESIGN-SPEC §6.1)
const RUN = 5.5;
const keys = new Set<string>();

/** Camera orbit state shared between the camera rig and the movement code. */
export const cameraState = { yaw: 0, pitch: 0.3, distance: 5.6 };

export function LocalPlayer({ color, name, level }: { color: string; name: string; level: number }) {
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const pos = useRef(new THREE.Vector3(SPAWN.x, 0, SPAWN.z));
  const facing = useRef(Math.PI);
  const { camera, gl } = useThree();
  const inXR = useXR((s) => s.session != null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    // camera orbit by dragging the canvas (mouse or touch), zoom with the wheel
    const el = gl.domElement;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const pd = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      cameraState.yaw -= (e.clientX - lx) * 0.006;
      cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + (e.clientY - ly) * 0.004, 0.08, 1.1);
      lx = e.clientX;
      ly = e.clientY;
    };
    const pu = () => (dragging = false);
    const wheel = (e: WheelEvent) => {
      cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + e.deltaY * 0.004, 2.5, 10);
    };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("pointercancel", pu);
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("pointercancel", pu);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const w = useWorld.getState();
    // input: keyboard + on-screen joystick
    let ix = w.input.x;
    let iy = w.input.y;
    if (keys.has("KeyW") || keys.has("ArrowUp")) iy += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) iy -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
    const mag = Math.min(1, Math.hypot(ix, iy));
    const run = w.input.run || keys.has("ShiftLeft") || keys.has("ShiftRight") || mag > 0.95;

    if (mag > 0.08 && !inXR) {
      // movement relative to the camera
      const angle = Math.atan2(ix, iy) + cameraState.yaw + Math.PI;
      const speed = (run ? RUN : WALK) * mag;
      pos.current.x += Math.sin(angle) * speed * dt;
      pos.current.z += Math.cos(angle) * speed * dt;
      const target = angle;
      let diff = target - facing.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing.current += diff * Math.min(1, dt * 12);
      anim.current = run ? 2 : 1;
    } else {
      const e = w.emote;
      anim.current = e && e.until > Date.now() ? e.id : 0;
    }

    // collisions: plaza edge, fountain
    const r = Math.hypot(pos.current.x, pos.current.z);
    if (r > PLAZA_RADIUS - 1) pos.current.multiplyScalar((PLAZA_RADIUS - 1) / r);
    if (r < FOUNTAIN_RADIUS + 0.5 && r > 0.001) pos.current.multiplyScalar((FOUNTAIN_RADIUS + 0.5) / r);

    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // third-person camera (DESIGN-SPEC §8.1)
    if (!inXR) {
      const d = cameraState.distance;
      const cx = pos.current.x + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * d;
      const cz = pos.current.z + Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * d;
      const cy = 1.6 + Math.sin(cameraState.pitch) * d;
      camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 8));
      camera.lookAt(pos.current.x, 1.5, pos.current.z);
    }

    // proximity: portals and players
    let nearPortal: (typeof PORTALS)[number]["id"] | null = null;
    for (const p of PORTALS) {
      const t = portalTransform(p);
      if (Math.hypot(t.entryX - pos.current.x, t.entryZ - pos.current.z) < INTERACT_RADIUS) nearPortal = p.id;
    }
    let nearPlayer: string | null = null;
    for (const op of Object.values(w.players)) {
      if (Math.hypot(op.x / 100 - pos.current.x, op.z / 100 - pos.current.z) < 2.6) nearPlayer = op.id;
    }
    if (nearPortal !== w.nearPortal || nearPlayer !== w.nearPlayer) w.set({ nearPortal, nearPlayer });

    sendMove(pos.current.x, pos.current.z, facing.current, anim.current);
  });

  return (
    <group ref={group}>
      <Avatar color={color} name={name} level={level} animRef={anim} />
    </group>
  );
}

function RemoteAvatar({ id }: { id: string }) {
  const p = useWorld((s) => s.players[id]);
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  useFrame((_, dt) => {
    const cur = useWorld.getState().players[id];
    if (!cur || !group.current) return;
    const k = Math.min(1, dt * 10); // interpolation
    group.current.position.x += (cur.x / 100 - group.current.position.x) * k;
    group.current.position.z += (cur.z / 100 - group.current.position.z) * k;
    const yaw = (cur.yaw / 65535) * Math.PI * 2;
    let diff = yaw - group.current.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    group.current.rotation.y += diff * k;
    anim.current = cur.emoteUntil && cur.emoteUntil > Date.now() ? cur.anim : cur.anim >= 10 ? 0 : cur.anim;
  });
  if (!p) return null;
  return (
    <group ref={group} position={[p.x / 100, 0, p.z / 100]}>
      <Avatar color={p.color} name={p.name} level={p.level} animRef={anim} />
    </group>
  );
}

export function RemotePlayers() {
  const ids = useWorld((s) => Object.keys(s.players).join(","));
  return (
    <>
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <RemoteAvatar key={id} id={id} />
        ))}
    </>
  );
}
