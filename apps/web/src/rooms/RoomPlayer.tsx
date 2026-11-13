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
import { useDoorway } from "@/world/doorway";
import type { HallLayout } from "./layouts";

const SIT_ANIM = 13;
const SEAT_RANGE = 1.5;
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => t * t * (3 - 2 * t);
/** staged sit: walk to the stand point in front of the chair, turn, then lower onto it while the clip plays */
type SitStage = { id: string; t: number; phase: "walk" | "turn" | "lower" | "seated"; fx: number; fz: number; fyaw: number };
/** staged stand: stay put while rising, then step out to a free spot before steering takes over (from rest) */
type StandStage = { t: number; fx: number; fz: number; tx: number; tz: number; chair: string };
const INTRO_S = 1.9;
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
  // just inside the open doors, facing into the hall (−z), with the follow camera already behind you
  const pos = useRef(back.current ? new THREE.Vector3(back.current.x, 0, back.current.z) : new THREE.Vector3(layout.door.x, 0, layout.size.d / 2 - 1.0));
  const insideOnce = useRef(!!back.current);
  /** scripted entry: a few natural steps into the hall (any input takes over immediately) */
  const intro = useRef(back.current ? 0 : INTRO_S);
  /** the camera snaps (no easing) until the doors have opened, so the first visible frame is already the final pose */
  const snapped = useRef(false);
  const camInit = useRef(false);
  if (!camInit.current) {
    // before the very first rendered frame: behind the player, looking into the hall (no 180° whip-pan on arrival)
    camInit.current = true;
    cameraState.yaw = 0;
    cameraState.pitch = 0.2;
    cameraState.distance = 5.8;
  }
  const facing = useRef(back.current?.yaw ?? Math.PI); // facing into the room (−z)
  const exited = useRef(false);
  const leaveStart = useRef(0);
  const sitStage = useRef<SitStage | null>(null);
  const standStage = useRef<StandStage | null>(null);
  /** after standing up, the chair you left is not offered again until you have moved away or 1.5 s passed */
  const leftChair = useRef<{ id: string; x: number; z: number; at: number } | null>(null);
  /** sit / stand camera moves blend in (critically damped) instead of cutting */
  const camBlendUntil = useRef(0);
  const lookPt = useMemo(() => new THREE.Vector3(), []);
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
      // leaving the hall: stale chair / exit flags would hide the plaza's "Enter …" prompt and swallow E there
      useRoom.getState().set({ nearSeat: null, nearExit: false, seated: null, leaving: false });
    };
  }, [gl, camera, w, d]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const W = useWorld.getState();
    const R = useRoom.getState();
    if (!R.leaving) leaveStart.current = 0;
    if (R.leaving && !exited.current && (leaveStart.current ||= performance.now()) && performance.now() - leaveStart.current > 8000) {
      // fail-safe: whatever blocks the way out (a person in the aisle, a chair), Leave always gets you out
      exited.current = true;
      nav.target = { x: layout.door.x, z: d / 2 + 4 }; // keep walking out while the camera watches
      nav.goal = null;
      onExit();
    }
    if (R.leaving && !exited.current) {
      nav.goal = null; // the leave route is re-planned every frame; no click-to-walk detours fighting it
      nav.progress.detours = 2;
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

    // stood up (or the server refused the chair): rise in place, then step out to a free spot
    if (!seat && sitStage.current) {
      const wasDown = sitStage.current.phase === "lower" || sitStage.current.phase === "seated";
      const from = wasDown ? layout.seats.find((x) => x.id === sitStage.current!.id) : undefined;
      sitStage.current = null;
      if (from) {
        const fwdX = Math.sin(from.yaw);
        const fwdZ = Math.cos(from.yaw);
        const isFree = (x: number, z: number) =>
          solids.every((t) => Math.abs(x - t.x) > t.w / 2 + 0.34 || Math.abs(z - t.z) > t.d / 2 + 0.34) &&
          layout.seats.every((o) => Math.hypot(x - (o.x - Math.sin(o.yaw) * 0.1), z - (o.z - Math.cos(o.yaw) * 0.1)) > chairR + 0.26);
        const out = chairR + 0.3;
        const cands: [number, number][] = [
          [from.x + fwdX * out, from.z + fwdZ * out],
          [from.x + fwdZ * (out + 0.2), from.z - fwdX * (out + 0.2)],
          [from.x - fwdZ * (out + 0.2), from.z + fwdX * (out + 0.2)],
          [from.x - fwdX * (out + 0.25), from.z - fwdZ * (out + 0.25)],
        ];
        const [tx, tz] = cands.find(([x, z]) => isFree(x, z)) ?? cands[0]!;
        standStage.current = { t: 0, fx: pos.current.x, fz: pos.current.z, tx, tz, chair: from.id };
        leftChair.current = { id: from.id, x: tx, z: tz, at: performance.now() };
        camBlendUntil.current = performance.now() + 800;
      }
    }

    const stand = standStage.current;
    if (seat) {
      // staged sit (≈1.3 s): to the stand point in front of the chair, turn to the table, lower onto the seat
      const seatX = seat.x - Math.sin(seat.yaw) * 0.08;
      const seatZ = seat.z - Math.cos(seat.yaw) * 0.08;
      const standX = seat.x + Math.sin(seat.yaw) * (chairR + 0.13);
      const standZ = seat.z + Math.cos(seat.yaw) * (chairR + 0.13);
      let st = sitStage.current;
      if (!st || st.id !== seat.id) {
        standStage.current = null;
        const nearSeatPt = Math.hypot(pos.current.x - seatX, pos.current.z - seatZ) < 0.3; // back from a game: already there
        const nearStand = Math.hypot(pos.current.x - standX, pos.current.z - standZ) < 0.15;
        st = sitStage.current = { id: seat.id, t: 0, phase: nearSeatPt ? "seated" : nearStand ? "turn" : "walk", fx: pos.current.x, fz: pos.current.z, fyaw: facing.current };
        camBlendUntil.current = performance.now() + 1600;
      }
      st.t += dt;
      if (st.phase === "walk") {
        const dx = standX - pos.current.x;
        const dz = standZ - pos.current.z;
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        facing.current += THREE.MathUtils.clamp(wrapA(want - facing.current), -7 * dt, 7 * dt);
        const step = Math.min(dist, 1.2 * dt * Math.max(0, Math.cos(wrapA(want - facing.current))));
        pos.current.x += (dx / Math.max(dist, 1e-4)) * step;
        pos.current.z += (dz / Math.max(dist, 1e-4)) * step;
        anim.current = 1;
        if (dist < 0.06 || st.t > 2.5) Object.assign(st, { phase: "turn", t: 0, fyaw: facing.current });
      } else if (st.phase === "turn") {
        const k = Math.min(1, st.t / 0.35);
        facing.current = st.fyaw + wrapA(seat.yaw - st.fyaw) * ease(k);
        anim.current = 0;
        if (k >= 1) Object.assign(st, { phase: "lower", t: 0, fx: pos.current.x, fz: pos.current.z });
      } else if (st.phase === "lower") {
        const k = Math.min(1, st.t / 0.65);
        pos.current.set(st.fx + (seatX - st.fx) * ease(k), 0, st.fz + (seatZ - st.fz) * ease(k));
        facing.current = seat.yaw;
        anim.current = SIT_ANIM;
        if (k >= 1) st.phase = "seated";
      } else {
        // seated on the chair, facing the table
        pos.current.set(seatX, 0, seatZ);
        facing.current = seat.yaw;
        anim.current = SIT_ANIM;
      }
    } else if (stand) {
      // rising (~0.4 s on the spot), then a short step out (~0.4 s); control returns from rest afterwards
      stand.t += dt;
      const k = ease(THREE.MathUtils.clamp((stand.t - 0.4) / 0.7, 0, 1));
      pos.current.set(stand.fx + (stand.tx - stand.fx) * k, 0, stand.fz + (stand.tz - stand.fz) * k);
      anim.current = stand.t > 0.45 && k < 1 ? 1 : 0;
      if (stand.t >= 1.1) standStage.current = null;
    } else if (intro.current > 0 && !wantsToWalk && !keys.has("KeyA") && !keys.has("KeyD") && !keys.has("ArrowLeft") && !keys.has("ArrowRight")) {
      // automatic entry walk (doors close behind as you move away); waits until the doorway transition has opened
      const ph = useDoorway.getState().phase;
      const shut = ph === "closed"; // the walk-in starts exactly when the arrival dissolve starts
      if (!shut) intro.current -= dt;
      const sp = shut ? 0 : 1.35 * Math.min(1, intro.current / 0.4 + 0.2);
      pos.current.z -= sp * dt;
      facing.current = Math.PI;
      anim.current = intro.current > 0.05 && sp > 0 ? 1 : 0;
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

    if (!seat && !stand) {
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
        // keep walking on out through the door while the camera holds and watches (the frame freezes after ~0.8 s)
        nav.target = { x: layout.door.x, z: d / 2 + 4 };
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
      // walk-in shot: the normal follow camera (behind you, held inside the doorway) looking into the hall; the
      // view settles from the hall ahead onto your shoulders as you step in, ending exactly on the follow pose
      const dd = cameraState.distance;
      cx = pos.current.x + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * dd;
      cz = pos.current.z + Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * dd;
      cy = 1.6 + Math.sin(cameraState.pitch) * dd;
      const k = THREE.MathUtils.smoothstep(1 - intro.current / INTRO_S, 0, 1);
      target.set(pos.current.x, THREE.MathUtils.lerp(1.2, 1.55, k), pos.current.z - (1 - k) * 3.4);
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
    const phNow = useDoorway.getState().phase;
    const doorsShut = phNow === "closed"; // hidden behind the frozen frame: snap, so the first visible frame is final
    if (!snapped.current || doorsShut) camera.position.set(cx, cy, cz);
    else if (performance.now() < camBlendUntil.current) camera.position.lerp(new THREE.Vector3(cx, cy, cz), 1 - Math.exp(-dt * 4)); // sit / stand: ~0.8 s glide
    else camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 6));
    snapped.current = !doorsShut;
    // the look point glides too during a sit / stand (no cut from head height to the table)
    if (!snapped.current || doorsShut || performance.now() >= camBlendUntil.current) lookPt.copy(target);
    else lookPt.lerp(target, 1 - Math.exp(-dt * 4));
    camera.lookAt(lookPt);

    // nearest free chair / nearest signed-in player
    let nearSeat: string | null = null;
    let best = SEAT_RANGE;
    const lc = leftChair.current;
    if (lc && (performance.now() - lc.at > 1500 || Math.hypot(pos.current.x - lc.x, pos.current.z - lc.z) > 1)) leftChair.current = null;
    if (!seat && !stand)
      for (const s of layout.seats) {
        const holder = W.seats[s.id];
        if (holder && holder !== W.you) continue;
        if (leftChair.current) continue; // just stood up: no "Sit down" straight back
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
    const nearExit = !seat && intro.current <= 0 && pos.current.z > d / 2 - 3 && Math.abs(pos.current.x - layout.door.x) < 2.2 && insideOnce.current;
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
