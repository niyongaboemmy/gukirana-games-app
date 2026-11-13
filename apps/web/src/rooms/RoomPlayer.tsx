"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Avatar } from "@/world/Avatar";
import { cameraState, WALK_SPEEDS } from "@/world/Player";
import { lookOf, useProfile } from "@/lib/profile-store";
import { selfPose, useWorld } from "@/lib/world-store";
import { sendMove, sitAt, standUp } from "@/lib/realtime";
import { useRoom } from "./room-store";
import { takeReturnFor } from "@/lib/return-point";
import { autoFollow, nav, pointerNav, steer, TargetMarker } from "@/world/navigation";
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
  // back from a game → same spot / same chair; otherwise appear in the open doorway and walk in automatically
  const back = useRef(typeof window !== "undefined" ? takeReturnFor(`/room/${layout.game}`) : null);
  const pos = useRef(back.current ? new THREE.Vector3(back.current.x, 0, back.current.z) : new THREE.Vector3(layout.door.x, 0, layout.size.d / 2 - 0.2));
  const insideOnce = useRef(!!back.current);
  /** scripted entry: a few natural steps into the hall (any input takes over immediately) */
  const intro = useRef(back.current ? 0 : 1.9);
  const facing = useRef(back.current?.yaw ?? Math.PI); // facing into the room (−z)
  const exited = useRef(false);
  const { camera, gl } = useThree();
  const profile = useProfile();
  const look = lookOf(profile);
  const { w, d } = layout.size;
  const solids = useMemo(() => [...layout.tables, ...layout.colliders], [layout]);
  /** chairs / stools are solid too (round footprint at the seat, sized per hall's furniture) */
  const chairR = layout.game === "pool" ? 0.42 : layout.game === "ludo" ? 0.38 : 0.26;

  // re-take the same chair once the hall connection is up (server confirms the seat)
  useEffect(() => {
    const seat = back.current?.seat;
    if (!seat) return;
    let tries = 0;
    const id = setInterval(() => {
      if (useWorld.getState().you || ++tries > 20) {
        clearInterval(id);
        if (useWorld.getState().you) sitDown(seat);
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    cameraState.yaw = 0; // behind the player, looking into the hall
    cameraState.pitch = 0.2; // eye-level-ish: you see the hall, not the floor
    cameraState.distance = 5.8;
    const down = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName !== "INPUT" && keys.add(e.code);
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const el = gl.domElement;
    const stopPointer = pointerNav(
      el,
      () => camera,
      (dx, dy) => {
        cameraState.yaw -= dx * 0.006;
        cameraState.pitch = THREE.MathUtils.clamp(cameraState.pitch + dy * 0.004, 0.12, 1.2);
      },
      (p) => ({ x: THREE.MathUtils.clamp(p.x, -w / 2 + 0.5, w / 2 - 0.5), z: THREE.MathUtils.clamp(p.z, -d / 2 + 0.6, d / 2 + 3.5) }),
    );
    const wheel = (e: WheelEvent) => (cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + e.deltaY * 0.006, 2.2, 12));
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      stopPointer();
      el.removeEventListener("wheel", wheel);
      keys.clear();
      nav.target = null;
    };
  }, [gl, camera, w, d]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const W = useWorld.getState();
    const R = useRoom.getState();
    if (R.leaving && !exited.current) {
      if (R.seated) {
        standUp();
        R.set({ seated: null });
      }
      insideOnce.current = true;
      intro.current = 0;
      // route around furniture: walk to the nearest table-free aisle, along it to the open area by the door, then out
      const px = pos.current.x;
      const pz = pos.current.z;
      const free = (x: number) => layout.tables.every((tb) => Math.abs(tb.x - x) > tb.w / 2 + 1.05);
      const aisles = [-9, -6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6, 9].filter(free);
      const aisle = aisles.reduce((best, x) => (Math.abs(x - px) < Math.abs(best - px) ? x : best), aisles[0] ?? layout.door.x);
      const frontZ = d / 2 - 2.4; // open band between the last tables and the door
      if (pz > frontZ - 0.2) nav.target = { x: layout.door.x, z: d / 2 + 1.2 };
      else if (Math.abs(px - aisle) > 0.45) nav.target = { x: aisle, z: pz };
      else nav.target = { x: aisle, z: frontZ + 0.3 };
    }
    const seat = R.seated ? layout.seats.find((s) => s.id === R.seated) : undefined;
    const run = W.input.run || keys.has("ShiftLeft") || keys.has("ShiftRight");
    const wantsToWalk = keys.has("KeyW") || keys.has("ArrowUp") || keys.has("KeyS") || keys.has("ArrowDown") || Math.hypot(W.input.x, W.input.y) > 0.3 || !!nav.target;
    if (seat && wantsToWalk) {
      // walking (keys / joystick / click) while seated = stand up; turning keys don't
      standUp();
      R.set({ seated: null });
    }

    if (seat) {
      // seated on the chair, facing the table
      pos.current.set(seat.x - Math.sin(seat.yaw) * 0.08, 0, seat.z - Math.cos(seat.yaw) * 0.08);
      facing.current = seat.yaw;
      anim.current = SIT_ANIM;
    } else if (intro.current > 0 && !wantsToWalk && !keys.has("KeyA") && !keys.has("KeyD") && !keys.has("ArrowLeft") && !keys.has("ArrowRight")) {
      // automatic entry walk (doors close behind as you move away)
      intro.current -= dt;
      const sp = 1.35 * Math.min(1, intro.current / 0.4 + 0.2);
      pos.current.z -= sp * dt;
      facing.current = Math.PI;
      anim.current = intro.current > 0.05 ? 1 : 0;
    } else {
      intro.current = 0;
      const s = steer({ keys, joyX: W.input.x, joyY: W.input.y, camYaw: cameraState.yaw, facing: facing.current, x: pos.current.x, z: pos.current.z, walkSpeed: WALK_SPEEDS[W.speed] ?? WALK_SPEEDS.slow, run, dt });
      pos.current.x += s.dx;
      pos.current.z += s.dz;
      facing.current = s.facing;
      autoFollow(cameraState, s, dt);
      if (s.moving) anim.current = run || s.speed > 2.6 ? 2 : 1;
      else {
        const e = W.emote;
        anim.current = e && e.until > Date.now() ? e.id : 0;
      }
    }

    if (!seat) {
      // tables + furniture colliders (rect + body radius)
      for (const t of solids) {
        const hx = t.w / 2 + 0.32;
        const hz = t.d / 2 + 0.32;
        const dx = pos.current.x - t.x;
        const dz = pos.current.z - t.z;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
          if (hx - Math.abs(dx) < hz - Math.abs(dz)) pos.current.x = t.x + Math.sign(dx || 1) * hx;
          else pos.current.z = t.z + Math.sign(dz || 1) * hz;
        }
      }
      // chairs (except the one you're about to take — you can walk right up to it) and other people
      const BODY = 0.32;
      const pushOut = (cx: number, cz: number, r: number) => {
        const dx = pos.current.x - cx;
        const dz = pos.current.z - cz;
        const dist = Math.hypot(dx, dz);
        if (dist < r && dist > 1e-4) {
          pos.current.x = cx + (dx / dist) * r;
          pos.current.z = cz + (dz / dist) * r;
        }
      };
      for (const s of layout.seats) {
        // the chair body sits slightly behind the seat point (away from the table)
        const cx = s.x - Math.sin(s.yaw) * 0.1;
        const cz = s.z - Math.cos(s.yaw) * 0.1;
        pushOut(cx, cz, chairR + BODY - 0.08);
      }
      for (const op of Object.values(W.players)) pushOut(op.x / 100, op.z / 100, BODY * 2);
      // walls; the south wall only opens where the auto door is (and only while it is open)
      const outside = pos.current.z > d / 2;
      const inDoorway = Math.abs(pos.current.x - layout.door.x) < layout.door.w / 2 - 0.3;
      if (outside) {
        // only the doorway itself leads out (no porch): stay in line with the door
        pos.current.x = THREE.MathUtils.clamp(pos.current.x, layout.door.x - layout.door.w / 2 + 0.3, layout.door.x + layout.door.w / 2 - 0.3);
      } else {
        insideOnce.current ||= pos.current.z < d / 2 - 1.2;
        pos.current.x = THREE.MathUtils.clamp(pos.current.x, -w / 2 + 0.4, w / 2 - 0.4);
        pos.current.z = Math.max(pos.current.z, -d / 2 + 0.5);
        if (!(inDoorway && R.doorOpen)) pos.current.z = Math.min(pos.current.z, d / 2 - 0.4);
      }
      // stepping back out through the open door (after having been inside) returns to the plaza
      if (insideOnce.current && pos.current.z > d / 2 + 0.5 && !exited.current) {
        exited.current = true;
        onExit();
      }
    }

    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // camera: third person; when seated, over the shoulder towards the table
    const target = new THREE.Vector3(pos.current.x, seat ? 1.0 : 1.55, pos.current.z);
    let cx: number;
    let cy: number;
    let cz: number;
    if (intro.current > 0) {
      // walk-in shot: a camera inside the hall watching you step through the door, then the normal follow
      cx = layout.door.x + 2.6;
      cy = 2.0;
      cz = d / 2 - 5.2;
      target.set(pos.current.x, 1.35, pos.current.z);
    } else if (seat) {
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
    if (intro.current <= 0 && !seat) {
      // furniture occlusion: never let the follow camera sit inside a table, bar or chair
      const inSolid = (x: number, z: number, m: number) =>
        solids.some((t) => Math.abs(x - t.x) < t.w / 2 + m && Math.abs(z - t.z) < t.d / 2 + m) ||
        layout.seats.some((s) => Math.hypot(x - s.x, z - s.z) < chairR + m);
      // 1) the line from the player's head to the camera: pull in in front of the first furniture it crosses (low furniture only blocks low cameras)
      const N = 14;
      for (let k = 2; k <= N; k++) {
        const f = k / N;
        const sx = target.x + (cx - target.x) * f;
        const sz = target.z + (cz - target.z) * f;
        const sy = target.y + (cy - target.y) * f;
        if (sy < 1.25 && inSolid(sx, sz, 0.12)) {
          const keep = Math.max(1.6 / Math.max(1e-3, Math.hypot(cx - target.x, cz - target.z)), (k - 1.5) / N);
          cx = target.x + (cx - target.x) * keep;
          cz = target.z + (cz - target.z) * keep;
          cy = target.y + (cy - target.y) * keep;
          break;
        }
      }
      // 2) still ended up over furniture: lift above it
      if (inSolid(cx, cz, 0.25)) cy = Math.max(cy, 1.45);
      // 3) hanging lamps over the tables (pool shades, ludo globes) must not block the view or swallow the camera
      const inLamp = (x: number, z: number, y: number) =>
        y > 1.3 &&
        y < 2.7 &&
        layout.tables.some((t) => Math.abs(x - t.x) < Math.min(t.w / 2, 1.15) + 0.15 && Math.abs(z - t.z) < Math.min(t.d / 2, 1.15) + 0.15);
      const lampHit = (ax: number, ay: number, az: number) => {
        for (let k = 1; k <= N; k++) {
          const f = k / N;
          if (inLamp(target.x + (ax - target.x) * f, target.z + (az - target.z) * f, target.y + (ay - target.y) * f)) return k;
        }
        return 0;
      };
      const k0 = lampHit(cx, cy, cz);
      if (k0) {
        const keep = (k0 - 1.5) / N;
        if (Math.hypot(cx - target.x, cz - target.z) * keep >= 1.6) {
          cx = target.x + (cx - target.x) * keep;
          cz = target.z + (cz - target.z) * keep;
          cy = target.y + (cy - target.y) * keep;
        } else {
          // too close to pull in: raise the camera until it looks over the lamp
          while (cy < layout.size.h - 0.35 && lampHit(cx, cy, cz)) cy += 0.15;
        }
      }
    }
    // keep the camera inside the room
    cx = THREE.MathUtils.clamp(cx, -w / 2 + 0.3, w / 2 - 0.3);
    cz = THREE.MathUtils.clamp(cz, -d / 2 + 0.3, d / 2 - 0.35); // camera always inside the hall
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
    const nearExit = !seat && pos.current.z > d / 2 - 3 && Math.abs(pos.current.x - layout.door.x) < 2.2 && insideOnce.current;
    if (nearExit !== R.nearExit) R.set({ nearExit });
    if (nearPlayer !== W.nearPlayer) W.set({ nearPlayer });

    sendMove(pos.current.x, pos.current.z, facing.current, anim.current);
    selfPose.x = pos.current.x;
    selfPose.z = pos.current.z;
    selfPose.yaw = facing.current;
  });

  return (
    <>
    <TargetMarker />
    <group ref={group}>
      <Avatar look={look} name={profile.name} level={1} animRef={anim} shadows={tier !== "lite"} showTag={false} />
    </group>
    </>
  );
}

export function sitDown(seatId: string) {
  // a pending click-to-walk target (e.g. the chair itself, now solid) would read as "wants to walk" and stand you up
  nav.target = null;
  sitAt(seatId);
  useRoom.getState().set({ seated: seatId, nearSeat: null });
}
export function getUp() {
  standUp();
  useRoom.getState().set({ seated: null });
}
