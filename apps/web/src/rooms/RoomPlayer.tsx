"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Avatar } from "@/world/Avatar";
import { cameraState, WALK_SPEEDS } from "@/world/Player";
import { lookOf, useProfile } from "@/lib/profile-store";
import { selfPose, useWorld } from "@/lib/world-store";
import { sendMove, sitAt, standUp } from "@/lib/realtime";
import { useRoom } from "./room-store";
import { takeReturnFor } from "@/lib/return-point";
import { autoFollow, nav, onReleaseInput, pointerNav, steer, TargetMarker } from "@/world/navigation";
import { useDoorway } from "@/world/doorway";
import { useWalletSheet } from "@/wallet/WalletSheet";
import { clearHandoff, peekHandoff } from "@/world/stage";
import type { HallLayout, Seat } from "./layouts";
import { freeChair, tableAt } from "./table-status";
import { SEAT_BACK, seatProfileFor, type SeatProfile } from "@/world/human/seat-profiles";
import { hallHooks, walkQueue, type HallHooks } from "./hall-hooks";

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
const qa: {
  teleport: ((x: number, z: number, yaw: number) => void) | null;
  cam: { p: [number, number, number]; l: [number, number, number] } | null;
  layout?: HallLayout;
  sit?: (id: string) => void;
  /** local-only seat (no server claim): office chairs for the seating screenshot review */
  forceSeat?: (id: string) => void;
} = { teleport: null, cam: null };
onReleaseInput(() => keys.clear());

/**
 * Choosing a table (tap a table, or "Find a free table" in the HUD): walk the aisles to the table's nearest free
 * chair and sit down there (the normal staged sit; the server still has the final say on the chair). A table with
 * every chair taken is a match in progress: you walk up beside it to watch instead.
 */
const pick = {
  req: null as string | null,
  table: null as string | null,
  seat: null as string | null,
  route: [] as { x: number; z: number }[],
  /** spectating: the yaw to turn to on arrival */
  face: null as number | null,
};
export function walkToTable(table: string) {
  pick.req = table;
}
export const pickedTable = () => pick.table;
const clearPick = () => Object.assign(pick, { req: null, table: null, seat: null, route: [], face: null });

/**
 * In-room controller: camera-relative movement (same steering as the plaza), wall + table collisions,
 * sit / stand at chairs (server-claimed seats), exit through the auto door.
 */
export function RoomPlayer({ layout, onExit, tier }: { layout: HallLayout; onExit: () => void; tier: "lite" | "standard" }) {
  const group = useRef<THREE.Group>(null);
  const anim = useRef(0);
  const walletOpen = useWalletSheet((s) => s.open);
  // back from a game → same spot / same chair; otherwise appear in the open doorway and walk in automatically
  // read once on mount (a useRef(initial) argument is evaluated on EVERY render: a re-render just after "Practice vs
  // AI" wrote the return point consumed it, so the game said "Back to the plaza" and you were not re-seated)
  const [backOnce] = useState(() => (typeof window !== "undefined" ? takeReturnFor(`/room/${layout.game}`) : null));
  const back = useRef(backOnce);
  // walked in through the plaza door: the exact spot / heading / pace you crossed the door line with (world/stage.ts
  // maps the plaza door frame onto this door); otherwise (reload, deep link) just inside the open doors
  const [hand] = useState(() => (typeof window !== "undefined" ? peekHandoff(`hall:${layout.game}`) : null));
  useEffect(() => clearHandoff(`hall:${layout.game}`), [layout.game]);
  // dev QA (like window.__gkNav): place the person / pin the camera for screenshot tours
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_GK_QA !== "1") return;
    qa.teleport = (x: number, z: number, yaw: number) => {
      pos.current.set(x, 0, z);
      facing.current = yaw;
      intro.current = 0;
      insideOnce.current = true;
    };
    qa.layout = layout;
    qa.sit = sitDown;
    qa.forceSeat = (id: string) => useRoom.getState().set({ seated: id, nearSeat: null });
    (window as unknown as { __gkRoomQA: typeof qa }).__gkRoomQA = qa;
    return () => {
      qa.teleport = null;
      qa.cam = null;
    };
  }, [layout]);
  // you just walked through the open door: it is open on the very first frame (whatever order the door sensor and
  // this controller run in, the wall clamp would otherwise snap you 0.2 m inwards)
  useLayoutEffect(() => {
    if (!hand) return;
    useRoom.getState().set({ doorOpen: true });
    // and the hall door sensor sees you where you are from its very first frame
    selfPose.x = hand.x;
    selfPose.z = hand.z;
  }, [hand]);
  const pos = useRef(
    back.current
      ? new THREE.Vector3(back.current.x, 0, back.current.z)
      : hand
        ? new THREE.Vector3(hand.x, 0, hand.z)
        : new THREE.Vector3(layout.door.x, 0, layout.size.d / 2 - 1.0),
  );
  const introSpeed = hand?.speed ?? 1.35;
  /** the plaza camera's orbit around you at the crossing (walked in through the door), see the intro shot below */
  const [handCam] = useState(() => {
    if (!hand?.cam) return null;
    const [x, y, z] = hand.cam;
    const dx = x - hand.x;
    const dz = z - hand.z;
    const dist = Math.max(0.5, Math.hypot(dx, dz, y - 1.6));
    return { yaw: Math.atan2(dx, dz), pitch: Math.asin(THREE.MathUtils.clamp((y - 1.6) / dist, -1, 1)), dist };
  });
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
  const facing = useRef(back.current?.yaw ?? hand?.yaw ?? Math.PI); // facing into the room (−z)
  const exited = useRef(false);
  const leaveStart = useRef(0);
  /** fail-safe time for this Leave: the aisle route length at a brisk walk + slack (big halls are > 8 s from the door) */
  const leaveLimit = useRef(8000);
  /** progress watchdog: if the walk out makes no headway for 3 s (someone blocking the aisle), the fail-safe fires early */
  const leaveProgress = useRef({ best: Infinity, at: 0 });
  const sitStage = useRef<SitStage | null>(null);
  /** the chair you sit on: fits your seated pose to it (same profile everyone else sees you with) */
  const seatProf = useRef<SeatProfile | null>(null);
  const standStage = useRef<StandStage | null>(null);
  /** after standing up, the chair you left is not offered again until you have moved away or 1.5 s passed */
  const leftChair = useRef<{ id: string; x: number; z: number; at: number } | null>(null);
  /** sit / stand camera moves blend in (critically damped) instead of cutting */
  const camBlendUntil = useRef(0);
  // arena spectator eye view: the follow-camera state when it began (restored on leaving) and the lens it had
  const eyeView = useRef({ on: false, baseYaw: 0, basePitch: 0.2, baseDist: 5.8, fov0: 50 });
  const lookPt = useMemo(() => new THREE.Vector3(), []);
  const { camera, gl } = useThree();
  const profile = useProfile();
  const look = lookOf(profile);
  const { w, d } = layout.size;
  const solids = useMemo(() => [...layout.tables, ...layout.colliders], [layout]);
  /** full-height walls (static) — blockers for walking and for the follow camera */
  const walls = useMemo(() => layout.walls ?? [], [layout]);
  const hooks = hallHooks[layout.game];
  /** chairs / stools are solid too (round footprint at the seat, sized per hall's furniture) */
  const chairR = hooks?.chairR ?? (layout.game === "pool" ? 0.42 : layout.game === "ludo" ? 0.38 : 0.28);
  /** release the chair (the hall's own message when it has one) */
  const releaseSeat = () => (hooks?.stand ?? standUp)();
  /** smoothed height of the walking surface under you (halls on several levels) */
  const groundY = useRef<number | null>(null);
  /** where you stood before this frame's step (the walkable check slides back from here) */
  const walkFrom = useRef({ x: 0, z: 0 }).current;

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
      (p) => {
        // a tap on a table (its top, seen along the view ray, or its base) picks that table: walk there and sit
        const c = camera.position;
        const hTop = layout.tables[0]?.h ?? 0.8;
        const f = c.y > hTop ? (c.y - hTop) / c.y : 1;
        const tb = tableAt(layout, c.x + (p.x - c.x) * f, c.z + (p.z - c.z) * f, 0.12) ?? tableAt(layout, p.x, p.z, 0.05);
        if (tb && !useRoom.getState().leaving) {
          pick.req = tb.id;
          return null;
        }
        clearPick();
        const q = { x: THREE.MathUtils.clamp(p.x, -w / 2 + 0.5, w / 2 - 0.5), z: THREE.MathUtils.clamp(p.z, -d / 2 + 0.6, d / 2 + 3.5) };
        const hk = hallHooks[layout.game];
        if (!hk?.route) return q;
        // halls with rooms off a corridor: walk there through the doors / openings, leg by leg
        const legs = hk.route({ x: pos.current.x, z: pos.current.z }, hk.tap ? hk.tap(q) : q);
        walkQueue.legs = legs.slice(1);
        return legs[0] ?? q;
      },
      () => hallHooks[layout.game]?.pick,
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
      walkQueue.legs = [];
      clearPick();
      // leaving the hall: stale chair / exit flags would hide the plaza's "Enter …" prompt and swallow E there
      useRoom.getState().set({ nearSeat: null, nearExit: false, seated: null, leaving: false });
    };
  }, [gl, camera, w, d]);

  /** where you stand to take a chair (the staged sit starts here) */
  const standOf = (s: Seat) => ({ x: s.x + Math.sin(s.yaw) * (chairR + 0.13), z: s.z + Math.cos(s.yaw) * (chairR + 0.13) });
  /** aisle route: along the nearest table-free aisle, into the open strip between the table and its chairs, along it */
  const routeTo = (tx: number, tz: number, zs: number) => {
    const px = pos.current.x;
    const pz = pos.current.z;
    if ((layout.game !== "pool" && layout.game !== "igisoro" && !layout.lanes?.length) || !layout.aisles.length) return [{ x: tx, z: tz }];
    const a0 = layout.aisles.reduce((b, x) => (Math.abs(x - px) < Math.abs(b - px) ? x : b), layout.aisles[0]!);
    const out: { x: number; z: number }[] = [];
    if (Math.abs(pz - zs) > 0.6) {
      if (Math.abs(px - a0) > 0.45) out.push({ x: a0, z: pz });
      out.push({ x: a0, z: zs });
    }
    if (Math.abs(tx - (out.at(-1)?.x ?? px)) > 0.45) out.push({ x: tx, z: zs });
    out.push({ x: tx, z: tz });
    return out;
  };
  const startRoute = (route: { x: number; z: number }[]) => {
    pick.route = route;
    nav.goal = null;
    nav.target = pick.route.shift() ?? null;
    nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
    intro.current = 0;
  };
  const planPick = (tableId: string) => {
    pick.req = null;
    const t = layout.tables.find((x) => x.id === tableId);
    if (!t) return clearPick();
    const W = useWorld.getState();
    const s = freeChair(layout, t.id, W.seats, W.you, pos.current.x, pos.current.z);
    pick.table = t.id;
    /** halls with cross aisles (Ludo): walk along the cross aisle on that side of the table (nearest to z) */
    const laneOf = (z: number, side: number) => {
      const ls = layout.lanes ?? [];
      const own = ls.filter((l) => (l - t.z) * side > 0);
      const from = own.length ? own : ls;
      return from.reduce((b, l) => (Math.abs(l - z) < Math.abs(b - z) ? l : b), from[0] ?? z);
    };
    if (s) {
      pick.seat = s.id;
      pick.face = null;
      const st = standOf(s);
      const side = Math.sign(s.z - t.z || 1);
      const off = Math.abs(s.z - t.z);
      if (layout.game === "igisoro" && off - t.d / 2 - chairR < 1.0) {
        // a low Igisoro stool hugs the table: along the walkway beyond the stools, then in past the table end into
        // the gap between table and stool (the staged sit walks the last metre)
        const sg = Math.sign(pos.current.x - t.x || 1);
        startRoute(routeTo(t.x + sg * (t.w / 2 + 0.42), st.z, t.z + side * (off + chairR + 0.6)));
      } else if (Math.abs(st.x - t.x) < t.w / 2 + 0.32 && Math.abs(st.z - t.z) < t.d / 2 + 0.32) {
        // a café armchair tucked up to a small table: its stand point is under the table edge, so walk up beside the
        // chair (the side you come from) and let the staged sit step in from there
        const ox = -Math.sin(s.yaw);
        const oz = -Math.cos(s.yaw);
        const lat = Math.sign((pos.current.x - s.x) * oz - (pos.current.z - s.z) * ox || 1);
        const ax = s.x + ox * 0.3 + oz * lat * 0.8;
        const az = s.z + oz * 0.3 - ox * lat * 0.8;
        startRoute(routeTo(ax, az, layout.lanes?.length ? laneOf(az, side) : az));
      } else startRoute(routeTo(st.x, st.z, layout.lanes?.length ? laneOf(st.z, side) : t.z + side * (t.d / 2 + 0.75)));
    } else {
      // all chairs taken: a match in progress → watch from beside the table (spectators stand in the open strip)
      pick.seat = null;
      const side = Math.sign(pos.current.z - t.z || 1);
      const sx = t.x + Math.sign(pos.current.x - t.x || 1) * 1.6;
      const sz = t.z + side * (t.d / 2 + 0.75);
      pick.face = Math.atan2(t.x - sx, t.z - sz);
      startRoute(routeTo(sx, sz, layout.lanes?.length ? laneOf(sz, side) : sz));
    }
  };
  const followPick = () => {
    const W = useWorld.getState();
    const manual = ["KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some((k) => keys.has(k)) || Math.hypot(W.input.x, W.input.y) > 0.15;
    if (manual) return clearPick();
    if (pick.seat) {
      const s = layout.seats.find((x) => x.id === pick.seat);
      const holder = s ? W.seats[s.id] : undefined;
      if (s && holder && holder !== W.you) {
        // someone sat there first: the other chair of that table, else watch
        const t = pick.table!;
        clearPick();
        return void (pick.req = t);
      }
      if (!s) return clearPick();
      const st = standOf(s);
      const dist = Math.hypot(pos.current.x - st.x, pos.current.z - st.z);
      if (dist < 0.7 || (!nav.target && !pick.route.length && dist < 2.5)) {
        clearPick();
        sitDown(s.id);
      } else if (!nav.target) {
        const nx = pick.route.shift();
        if (nx) startRoute([nx, ...pick.route]);
        else clearPick();
      }
      return;
    }
    if (!nav.target) {
      const nx = pick.route.shift();
      if (nx) return startRoute([nx, ...pick.route]);
      // arrived beside a busy table: turn to watch (social/people.ts hallLife starts the spectator pose)
      if (pick.face != null) {
        const err = wrapA(pick.face - facing.current);
        facing.current += THREE.MathUtils.clamp(err, -0.12, 0.12);
        if (Math.abs(err) < 0.03) clearPick();
      } else clearPick();
    }
  };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const W = useWorld.getState();
    const R = useRoom.getState();
    if (!R.leaving) leaveStart.current = 0;
    if (R.leaving && !exited.current && !leaveStart.current) {
      leaveStart.current = performance.now();
      // Manhattan route along the aisles to the door (or the hall's own route through its doors), walked at
      // ~2.3 m/s, + 3 s slack; never less than 8 s
      const route = hooks?.route
        ? routeLen(pos.current, hooks.route({ x: pos.current.x, z: pos.current.z }, { x: layout.door.x, z: d / 2 + 1.2 })) + 2
        : Math.abs(pos.current.x - layout.door.x) + Math.abs(d / 2 - pos.current.z) + 2;
      leaveLimit.current = Math.max(8000, (route / 2.3) * 1000 + 3000);
      leaveProgress.current = { best: Infinity, at: leaveStart.current };
    }
    if (R.leaving && !exited.current) {
      // progress = the remaining length of the aisle route (stepping sideways to an aisle is progress, even though
      // it does not bring you closer to the door in a straight line, e.g. from behind the Igisoro courtyard tree)
      const px = pos.current.x;
      const pz = pos.current.z;
      const fz = d / 2 - 2.4;
      const ax = layout.aisles.reduce((b, x) => (Math.abs(x - px) < Math.abs(b - px) ? x : b), layout.aisles[0] ?? layout.door.x);
      const toDoor = hooks?.route
        ? routeLen(pos.current, hooks.route({ x: px, z: pz }, { x: layout.door.x, z: d / 2 + 1.2 }))
        : pz > fz - 0.2
          ? Math.hypot(px - layout.door.x, pz - d / 2)
          : Math.abs(px - ax) + (fz - pz) + Math.hypot(ax - layout.door.x, d / 2 - fz);
      if (toDoor < leaveProgress.current.best - 0.3) leaveProgress.current = { best: toDoor, at: performance.now() };
    }
    const stalled = R.leaving && performance.now() - leaveProgress.current.at > 3000;
    if (R.leaving && !exited.current && (stalled || performance.now() - leaveStart.current > leaveLimit.current)) {
      // fail-safe: whatever blocks the way out (a person in the aisle, a chair), Leave always gets you out
      exited.current = true;
      // a big hall can be further than 8 s from the door: step through it now, so the plaza hand-off (mapped through
      // the door frame) starts you just outside the plaza door, never inside the building
      if (pos.current.z < d / 2 - 0.2) {
        pos.current.set(layout.door.x, 0, d / 2 + 0.6);
        facing.current = 0;
        selfPose.x = pos.current.x;
        selfPose.z = pos.current.z;
        selfPose.yaw = 0;
      }
      nav.target = { x: layout.door.x, z: d / 2 + 4 }; // keep walking out while the camera watches
      nav.goal = null;
      onExit();
    }
    if (R.leaving && !exited.current) {
      nav.goal = null; // the leave route is re-planned every frame; no click-to-walk detours fighting it
      nav.progress.detours = 2;
      if (R.seated) {
        releaseSeat();
        R.set({ seated: null });
      }
      insideOnce.current = true;
      intro.current = 0;
      // route around furniture: walk to the nearest table-free aisle, along it to the open area by the door, then out
      const px = pos.current.x;
      const pz = pos.current.z;
      const aisles = layout.aisles; // table-free north–south aisles (rooms/layouts.ts)
      const aisle = aisles.reduce((best, x) => (Math.abs(x - px) < Math.abs(best - px) ? x : best), aisles[0] ?? layout.door.x);
      const frontZ = d / 2 - 2.4; // open band between the last tables and the door
      walkQueue.legs = [];
      if (hooks?.route) nav.target = hooks.route({ x: px, z: pz }, { x: layout.door.x, z: d / 2 + 1.2 })[0] ?? { x: layout.door.x, z: d / 2 + 1.2 };
      else if (pz > frontZ - 0.2) nav.target = { x: layout.door.x, z: d / 2 + 1.2 };
      else if (Math.abs(px - aisle) > 0.45) nav.target = { x: aisle, z: pz };
      else nav.target = { x: aisle, z: frontZ + 0.3 };
    }
    if (R.leaving) {
      if (pick.table || pick.req) clearPick();
    } else if (R.seated) {
      // seated and tapped another table: stand up and go there (tapping your own table does nothing)
      const mine = layout.seats.find((x) => x.id === R.seated)?.table;
      if (pick.req && pick.req !== mine) {
        releaseSeat();
        R.set({ seated: null });
      } else if (pick.req || pick.table) clearPick();
    } else if (pick.req) planPick(pick.req);
    else if (pick.table) followPick();
    const seat = R.seated ? layout.seats.find((s) => s.id === R.seated) : undefined;
    seatProf.current = seat ? seatProfileFor(layout.game, seat.id) : null;
    const frozen = !!hooks?.frozen?.();
    if (frozen) {
      // a full-screen window has the keyboard (the office computer): no walking, no standing up, until it closes
      keys.clear();
      nav.target = null;
      walkQueue.legs = [];
    }
    const run = W.input.run || keys.has("ShiftLeft") || keys.has("ShiftRight") || R.leaving; // Leave: a brisk walk out
    const wantsToWalk = !frozen && (keys.has("KeyW") || keys.has("ArrowUp") || keys.has("KeyS") || keys.has("ArrowDown") || Math.hypot(W.input.x, W.input.y) > 0.3 || !!nav.target);
    if (seat && wantsToWalk) {
      // walking (keys / joystick / click) while seated = stand up; turning keys don't
      releaseSeat();
      R.set({ seated: null });
    }

    // stood up (or the server refused the chair): rise in place, then step out to a free spot
    if (!seat && sitStage.current) {
      const wasDown = sitStage.current.phase === "lower" || sitStage.current.phase === "seated";
      // (halls with a stand spot, e.g. arena seat rows: always step back out to it, even from half way along the row)
      const from = wasDown || hooks?.standSpot ? layout.seats.find((x) => x.id === sitStage.current!.id) : undefined;
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
        const spot = hooks?.standSpot?.(from.id);
        const [tx, tz] = spot ? [spot.x, spot.z] : (cands.find(([x, z]) => isFree(x, z)) ?? cands[0]!);
        standStage.current = { t: 0, fx: pos.current.x, fz: pos.current.z, tx, tz, chair: from.id };
        leftChair.current = { id: from.id, x: tx, z: tz, at: performance.now() };
        camBlendUntil.current = performance.now() + 800;
        // the seated camera sits behind the chair: continue from there instead of swinging back to the old yaw
        cameraState.yaw = from.yaw + Math.PI;
        cameraState.pitch = 0.25;
        nav.lastManualCam = performance.now(); // hold auto-follow while you step out, so it doesn't swing again
      }
    }

    const stand = standStage.current;
    if (seat) {
      // staged sit (≈1.3 s): to the stand point in front of the chair, turn to the table, lower onto the seat
      const seatX = seat.x - Math.sin(seat.yaw) * SEAT_BACK;
      const seatZ = seat.z - Math.cos(seat.yaw) * SEAT_BACK;
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
      const sp = shut ? 0 : introSpeed * Math.min(1, intro.current / 0.4 + 0.2);
      // carry on along the heading you came in with, easing round to face into the hall
      facing.current += wrapA(Math.PI - facing.current) * Math.min(1, dt * 3);
      pos.current.x += Math.sin(facing.current) * sp * dt;
      pos.current.z += Math.cos(facing.current) * sp * dt;
      anim.current = intro.current > 0.05 && sp > 0 ? 1 : 0;
    } else {
      intro.current = 0;
      // multi-leg scripted walk (routes through doors): the next leg once the current one is reached
      if (!nav.target && walkQueue.legs.length && !R.leaving) {
        nav.target = walkQueue.legs.shift()!;
        nav.goal = null;
        nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
      }
      const s = steer({ keys, joyX: frozen ? 0 : W.input.x, joyY: frozen ? 0 : W.input.y, camYaw: cameraState.yaw, facing: facing.current, x: pos.current.x, z: pos.current.z, walkSpeed: WALK_SPEEDS[W.speed] ?? WALK_SPEEDS.slow, run, dt });
      pos.current.x += s.dx;
      pos.current.z += s.dz;
      facing.current = s.facing;
      if (s.mode === "keys" || s.mode === "joy") walkQueue.legs = []; // manual input takes over
      // a heading the hall asks for while you stand still (e.g. facing the camera at a photo spot)
      const faceTo = !s.moving && !nav.target ? hooks?.face?.() : null;
      if (faceTo != null) facing.current += wrapA(faceTo - facing.current) * Math.min(1, dt * 6);
      autoFollow(cameraState, s, dt);
      if (s.moving) anim.current = run || s.speed > 2.6 ? 2 : 1;
      else {
        const e = W.emote;
        anim.current = e && e.until > Date.now() ? e.id : 0;
      }
    }

    if (!seat && !stand) {
      // tables + furniture colliders + walls + dynamic solids (closed doors) (rect + body radius)
      const dyn = hooks?.solids?.() ?? [];
      for (const t of walls.length || dyn.length ? [...solids, ...walls, ...dyn] : solids) {
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

    if (hooks?.walkable && !seat && !stand && !hooks.walkable(pos.current.x, pos.current.z) && hooks.walkable(walkFrom.x, walkFrom.z)) {
      // levels with stairs and seat rows: slide along the edge of the walkable space, never onto the rows
      if (hooks.walkable(pos.current.x, walkFrom.z)) pos.current.z = walkFrom.z;
      else if (hooks.walkable(walkFrom.x, pos.current.z)) pos.current.x = walkFrom.x;
      else pos.current.set(walkFrom.x, 0, walkFrom.z);
    }
    walkFrom.x = pos.current.x;
    walkFrom.z = pos.current.z;
    if (hooks?.ground) {
      const gy = seat ? hooks.ground(seat.x, seat.z) : hooks.ground(pos.current.x, pos.current.z);
      groundY.current = groundY.current == null ? gy : groundY.current + (gy - groundY.current) * Math.min(1, dt * 14);
      pos.current.y = groundY.current;
    } else pos.current.y = 0;
    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = facing.current;
    }

    // camera: third person; when seated, over the shoulder towards the table (or the arena's spectator eye view)
    const target = new THREE.Vector3(pos.current.x, seat ? 1.0 : 1.55, pos.current.z);
    let sv: ReturnType<NonNullable<HallHooks["seatedView"]>> = null;
    let cx: number;
    let cy: number;
    let cz: number;
    if (intro.current > 0 && handCam) {
      // walked in through the plaza door: the camera arrives exactly where the plaza camera was (mapped through the
      // door frame: behind you, over the shoulder, just inside the door) and opens out onto the normal follow pose
      // as you walk on in, so you stay put on screen across the crossing
      const k = THREE.MathUtils.smoothstep(1 - intro.current / INTRO_S, 0, 1);
      const yaw = handCam.yaw + wrapA(0 - handCam.yaw) * k;
      const pitch = THREE.MathUtils.lerp(handCam.pitch, cameraState.pitch, k);
      const dd = THREE.MathUtils.lerp(handCam.dist, cameraState.distance, k);
      cx = pos.current.x + Math.sin(yaw) * Math.cos(pitch) * dd;
      cz = pos.current.z + Math.cos(yaw) * Math.cos(pitch) * dd;
      cy = 1.6 + Math.sin(pitch) * dd;
      // same aim as the plaza's door follow (a little ahead of you at chest height), settling onto the head
      const fx = Math.sin(facing.current);
      const fz = Math.cos(facing.current);
      target.set(pos.current.x + fx * 1.2 * (1 - k), THREE.MathUtils.lerp(1.45, 1.55, k), pos.current.z + fz * 1.2 * (1 - k));
    } else if (intro.current > 0) {
      // walk-in shot: the normal follow camera (behind you, held inside the doorway) looking into the hall; the
      // view settles from the hall ahead onto your shoulders as you step in, ending exactly on the follow pose
      const dd = cameraState.distance;
      cx = pos.current.x + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * dd;
      cz = pos.current.z + Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * dd;
      cy = 1.6 + Math.sin(cameraState.pitch) * dd;
      const k = THREE.MathUtils.smoothstep(1 - intro.current / INTRO_S, 0, 1);
      target.set(pos.current.x, THREE.MathUtils.lerp(1.2, 1.55, k), pos.current.z - (1 - k) * 3.4);
    } else if (seat && (sv = hooks?.seatedView?.(seat.id) ?? null)) {
      // spectator eye view (arena): the camera at your own eyes, facing the podium; drag looks around within a
      // natural head turn, pinch / wheel zooms, "focus" narrows the lens onto the stage. Heights are relative to the
      // seat's surface (the multi-level rig below adds it back).
      const gy = pos.current.y;
      const e = eyeView.current;
      if (!e.on) {
        e.on = true;
        e.baseYaw = cameraState.yaw;
        e.basePitch = cameraState.pitch;
        e.baseDist = cameraState.distance;
        e.fov0 = (camera as THREE.PerspectiveCamera).fov;
        camBlendUntil.current = performance.now() + 900; // glide from behind the seat into your eyes
      }
      const dx = sv.look.x - sv.eye.x;
      const dz = sv.look.z - sv.eye.z;
      const flat = Math.hypot(dx, dz) || 1;
      const yaw0 = Math.atan2(dx, dz);
      const pitch0 = Math.atan2(sv.look.y - sv.eye.y, flat);
      const yaw = yaw0 + THREE.MathUtils.clamp(wrapA(cameraState.yaw - e.baseYaw), -1.45, 1.45);
      const pitch = THREE.MathUtils.clamp(pitch0 - (cameraState.pitch - e.basePitch) * 0.9, -1.0, 0.55);
      cx = sv.eye.x;
      cz = sv.eye.z;
      cy = sv.eye.y - gy;
      target.set(sv.eye.x + Math.sin(yaw) * Math.cos(pitch) * 10, sv.eye.y - gy + Math.sin(pitch) * 10, sv.eye.z + Math.cos(yaw) * Math.cos(pitch) * 10);
      // lens: wheel / pinch zoom (the follow distance range 2.2–12 maps to 24°–58°); focus = a tight podium lens
      const zoom = THREE.MathUtils.clamp(cameraState.distance - e.baseDist, -6, 6);
      const want = sv.focus ? 22 : THREE.MathUtils.clamp(48 + zoom * 4, 24, 58);
      const pc = camera as THREE.PerspectiveCamera;
      if (Math.abs(pc.fov - want) > 0.05) {
        pc.fov += (want - pc.fov) * Math.min(1, dt * 5);
        pc.updateProjectionMatrix();
      }
    } else if (seat) {
      const tb = layout.tables.find((t) => t.id === seat.table);
      if (tb && tb.w < 1.5 && tb.d < 1.5) {
        // a small board-game table (Ludo): high over the shoulder, looking down onto the board over your own head
        cx = pos.current.x - Math.sin(seat.yaw) * 1.3;
        cz = pos.current.z - Math.cos(seat.yaw) * 1.3;
        cy = 2.55;
        target.set(tb.x, tb.h, tb.z);
      } else {
        cx = pos.current.x - Math.sin(seat.yaw) * 2.2;
        cz = pos.current.z - Math.cos(seat.yaw) * 2.2;
        cy = 2.2;
        target.set(seat.x + Math.sin(seat.yaw) * 0.9, 0.8, seat.z + Math.cos(seat.yaw) * 0.9);
      }
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
    const ev = eyeView.current;
    if (!sv && ev.on) {
      // back from the eye view: the normal lens and the follow distance / angle you had before
      ev.on = false;
      const pc = camera as THREE.PerspectiveCamera;
      pc.fov = ev.fov0;
      pc.updateProjectionMatrix();
      cameraState.yaw = ev.baseYaw;
      cameraState.pitch = ev.basePitch;
      cameraState.distance = ev.baseDist;
      camBlendUntil.current = performance.now() + 900;
    }
    // your own avatar is hidden in the eye view (you look out of its eyes; nothing of you blocks the stage)
    if (group.current) group.current.visible = !sv;
    if (walls.length && !sv) {
      // full-height walls and closed doors: the camera stays on your side of them (pulled in along the view line,
      // at any height), so it never looks at a wall from behind or into the office next door
      const tall = [...walls, ...(hooks?.solids?.() ?? [])];
      const inWall = (x: number, z: number, m: number) => tall.some((t) => Math.abs(x - t.x) < t.w / 2 + m && Math.abs(z - t.z) < t.d / 2 + m);
      const N = 24;
      for (let k = 1; k <= N; k++) {
        const f = k / N;
        if (inWall(target.x + (cx - target.x) * f, target.z + (cz - target.z) * f, 0.2)) {
          const keep = Math.max(0, (k - 1.3) / N);
          cx = target.x + (cx - target.x) * keep;
          cz = target.z + (cz - target.z) * keep;
          cy = target.y + (cy - target.y) * Math.max(keep, 0.2);
          break;
        }
      }
    }
    // keep the camera inside the room
    cx = THREE.MathUtils.clamp(cx, -w / 2 + 0.3, w / 2 - 0.3);
    cz = THREE.MathUtils.clamp(cz, -d / 2 + 0.3, d / 2 - 0.35); // camera always inside the hall
    cy = Math.min(cy, layout.size.h - 0.3);
    if (hooks?.ground) {
      // halls on several levels: the whole rig rides on the surface you stand on, never below the rake behind you
      const gy = pos.current.y;
      cy += gy;
      target.y += gy;
      cy = Math.max(cy, hooks.ground(cx, cz) + 0.9);
      const c = { x: cx, y: cy, z: cz };
      hooks.camClamp?.(c);
      cx = c.x;
      cy = c.y;
      cz = c.z;
    }
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
    if (qa.cam) {
      // dev QA: a fixed camera pose for screenshots
      camera.position.set(...qa.cam.p);
      camera.lookAt(...qa.cam.l);
    }

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
        if (hooks?.seatOk && !hooks.seatOk(s.id)) continue; // e.g. an office chair you may not take
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
      <Avatar look={look} name={profile.name} level={1} animRef={anim} shadows={tier !== "lite"} showTag={false} self holdWallet={walletOpen} seatRef={seatProf} />
    </group>
    </>
  );
}

const routeLen = (from: { x: number; z: number }, route: { x: number; z: number }[]) => {
  let len = 0;
  let at = from;
  for (const p of route) {
    len += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return len;
};

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
