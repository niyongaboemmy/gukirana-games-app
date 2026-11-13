"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Avatar } from "@/world/Avatar";
import { cameraState, WALK_SPEEDS } from "@/world/Player";
import { lookOf, useProfile } from "@/lib/profile-store";
import { selfPose, useWorld } from "@/lib/world-store";
import { sendMove, sitAt, standUp } from "@/lib/realtime";
import { useRoom } from "./room-store";
import type { HallLayout } from "./layouts";

const SIT_ANIM = 13;
const SEAT_RANGE = 1.5;
const keys = new Set<string>();

/**
 * In-room controller: camera-relative movement (same steering as the plaza), wall + table collisions,
 * sit / stand at chairs (server-claimed seats), exit through the auto door.
 */
export function RoomPlayer({ layout, onExit, tier }: { layout: HallLayout; onExit: () => void; tier: "lite" | "standard" }) {
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const pos = useRef(new THREE.Vector3(layout.spawn.x + (Math.random() - 0.5) * 1.5, 0, layout.spawn.z));
  const facing = useRef(Math.PI); // facing into the room (−z)
  const exited = useRef(false);
  const { camera, gl } = useThree();
  const profile = useProfile();
  const look = lookOf(profile);
  const { w, d } = layout.size;
  const seatedNow = useRoom((s) => s.seated);

  useEffect(() => {
    cameraState.yaw = 0;
    cameraState.pitch = 0.5;
    cameraState.distance = 7.5;
    const down = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName !== "INPUT" && keys.add(e.code);
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const el = gl.domElement;
    let drag = false;
    let lx = 0;
    let ly = 0;
    const pd = (e: PointerEvent) => {
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      cameraState.yaw -= (e.clientX - lx) * 0.006;
      cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + (e.clientY - ly) * 0.004, 0.12, 1.2);
      lx = e.clientX;
      ly = e.clientY;
    };
    const pu = () => (drag = false);
    const wheel = (e: WheelEvent) => (cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + e.deltaY * 0.006, 2.2, 12));
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", pu);
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", pu);
      el.removeEventListener("wheel", wheel);
      keys.clear();
    };
  }, [gl]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const W = useWorld.getState();
    const R = useRoom.getState();
    let ix = W.input.x;
    let iy = W.input.y;
    if (keys.has("KeyW") || keys.has("ArrowUp")) iy += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) iy -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
    const mag = Math.min(1, Math.hypot(ix, iy));

    const seat = R.seated ? layout.seats.find((s) => s.id === R.seated) : undefined;
    if (seat && mag > 0.3) {
      // moving while seated = stand up
      standUp();
      R.set({ seated: null });
    }

    if (seat) {
      // seated on the chair, facing the table
      pos.current.set(seat.x - Math.sin(seat.yaw) * 0.08, 0, seat.z - Math.cos(seat.yaw) * 0.08);
      facing.current = seat.yaw;
      anim.current = SIT_ANIM;
    } else if (mag > 0.08) {
      const run = W.input.run || keys.has("ShiftLeft") || keys.has("ShiftRight");
      const angle = Math.atan2(-ix, iy) + cameraState.yaw + Math.PI;
      const speed = (WALK_SPEEDS[W.speed] ?? WALK_SPEEDS.slow) * (run ? 1.8 : 1) * mag;
      pos.current.x += Math.sin(angle) * speed * dt;
      pos.current.z += Math.cos(angle) * speed * dt;
      let diff = angle - facing.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing.current += diff * Math.min(1, dt * 8);
      anim.current = run || speed > 2.6 ? 2 : 1;
    } else {
      const e = W.emote;
      anim.current = e && e.until > Date.now() ? e.id : 0;
    }

    if (!seat) {
      // tables (rect + body radius)
      for (const t of layout.tables) {
        const hx = t.w / 2 + 0.32;
        const hz = t.d / 2 + 0.32;
        const dx = pos.current.x - t.x;
        const dz = pos.current.z - t.z;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
          if (hx - Math.abs(dx) < hz - Math.abs(dz)) pos.current.x = t.x + Math.sign(dx || 1) * hx;
          else pos.current.z = t.z + Math.sign(dz || 1) * hz;
        }
      }
      // walls; the south wall opens where the auto door is
      const inDoor = Math.abs(pos.current.x - layout.door.x) < layout.door.w / 2 - 0.3 && R.doorOpen;
      pos.current.x = THREE.MathUtils.clamp(pos.current.x, -w / 2 + 0.4, w / 2 - 0.4);
      pos.current.z = Math.max(pos.current.z, -d / 2 + 0.5);
      if (!inDoor) pos.current.z = Math.min(pos.current.z, d / 2 - 0.4);
      if (inDoor && pos.current.z > d / 2 + 0.3 && !exited.current) {
        exited.current = true;
        onExit();
      }
    }

    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // camera: third person; when seated, over the shoulder towards the table
    const target = new THREE.Vector3(pos.current.x, seat ? 1.0 : 1.4, pos.current.z);
    let cx: number;
    let cy: number;
    let cz: number;
    if (seat) {
      cx = pos.current.x - Math.sin(seat.yaw) * 2.2;
      cz = pos.current.z - Math.cos(seat.yaw) * 2.2;
      cy = 2.2;
      target.set(seat.x + Math.sin(seat.yaw) * 0.9, 0.8, seat.z + Math.cos(seat.yaw) * 0.9);
    } else {
      const dd = cameraState.distance;
      cx = pos.current.x + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * dd;
      cz = pos.current.z + Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * dd;
      cy = 1.6 + Math.sin(cameraState.pitch) * dd;
    }
    // keep the camera inside the room
    cx = THREE.MathUtils.clamp(cx, -w / 2 + 0.3, w / 2 - 0.3);
    cz = THREE.MathUtils.clamp(cz, -d / 2 + 0.3, d / 2 - 0.35); // never behind the door header
    cy = Math.min(cy, layout.size.h - 0.3);
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 6));
    camera.lookAt(target);

    // nearest free chair / nearest signed-in player
    let nearSeat: string | null = null;
    let best = SEAT_RANGE;
    if (!seat)
      for (const s of layout.seats) {
        const holder = W.seats[s.id];
        if (holder && holder !== W.you) continue;
        const dist = Math.hypot(s.x - pos.current.x, s.z - pos.current.z);
        if (dist < best) {
          best = dist;
          nearSeat = s.id;
        }
      }
    let nearPlayer: string | null = null;
    let bp = 2.6;
    for (const op of Object.values(W.players)) {
      const dist = Math.hypot(op.x / 100 - pos.current.x, op.z / 100 - pos.current.z);
      if (op.verified && dist < bp) {
        bp = dist;
        nearPlayer = op.id;
      }
    }
    if (nearSeat !== R.nearSeat) R.set({ nearSeat });
    if (nearPlayer !== W.nearPlayer) W.set({ nearPlayer });

    sendMove(pos.current.x, pos.current.z, facing.current, anim.current);
    selfPose.x = pos.current.x;
    selfPose.z = pos.current.z;
    selfPose.yaw = facing.current;
  });

  return (
    <group ref={group}>
      <Avatar look={look} name={profile.name} level={1} animRef={anim} shadows={tier !== "lite"} showTag={!seatedNow} />
    </group>
  );
}

export function sitDown(seatId: string) {
  sitAt(seatId);
  useRoom.getState().set({ seated: seatId, nearSeat: null });
}
export function getUp() {
  standUp();
  useRoom.getState().set({ seated: null });
}
