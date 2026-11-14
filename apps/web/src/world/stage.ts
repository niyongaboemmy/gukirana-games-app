"use client";
import { createContext, useContext } from "react";
import * as THREE from "three";
import { create } from "zustand";
import type { HallGame } from "@/rooms/layouts";
import { selfPose } from "@/lib/world-store";
import { useDoorway } from "./doorway";
import { nav, releaseAllInput } from "./navigation";
import { useGate } from "./gate/gate-store";
import { doorInset, doorLocal, ENTRY_Z, PORTALS, portalTransform } from "./layout";
import { doorHold } from "./transition";
import { HALLS } from "@/rooms/layouts";

/**
 * One persistent 3D stage for the whole session (P1-WLD-05).
 *
 * The app keeps ONE WebGL renderer (world/SceneHost → SceneCanvas, mounted in the root layout). Each place is an
 * "area" with its own THREE.Scene (+ camera) hung under the renderer's root scene; only the area on screen is
 * visible, the others stay mounted, compiled and GPU-resident but are never drawn:
 *   outdoor    the gate AND the plaza (one scene: the arrival gate stands at the south end of the plaza's avenue)
 *   hall:<id>  a hall interior (pool, ludo, igisoro, admin)
 * Routes still exist (deep links, back button, realtime room switching), but they only follow the picture: walking
 * through a door switches the area in the same frame (`crossTo`), and the URL is updated afterwards.
 */
export type View = "gate" | "plaza" | `hall:${HallGame}`;
export type Area = "outdoor" | `hall:${HallGame}`;

export const areaOf = (v: View): Area => (v === "gate" || v === "plaza" ? "outdoor" : v);
export const hallOf = (v: View | Area | null): HallGame | null => (v && v.startsWith("hall:") ? (v.slice(5) as HallGame) : null);

/** Which view a route shows (null = a 2D page: the canvas is hidden and paused, the areas stay warm). */
export function viewForPath(path: string): View | null {
  if (path === "/gate") return "gate";
  if (path === "/world") return "plaza";
  const m = /^\/room\/(pool|ludo|igisoro|admin|arena)\/?$/.exec(path);
  return m ? (`hall:${m[1]}` as View) : null;
}


/** Pose (and optionally camera) the next controller starts from, so the walk carries straight on across a cut. */
export interface Handoff {
  to: View;
  x: number;
  z: number;
  yaw: number;
  /** walking speed to carry on with (m/s) and for how long the scripted walk continues (s) */
  speed: number;
  walk: number;
  cam?: [number, number, number];
  look?: [number, number, number];
  /** stepping out of a hall door (re-entry guard, camera behind towards the door) */
  fromDoor?: boolean;
  at: number;
}

interface StageState {
  /** what is on screen */
  view: View | null;
  /** halls kept mounted + compiled while you are elsewhere (at most one besides the active hall) */
  warm: HallGame[];
  /** area content resolved, shaders compiled, textures uploaded */
  ready: Partial<Record<Area, boolean>>;
  /** bloom composer on (programs are then compiled for render targets) */
  fx: boolean;
  tier: "lite" | "standard";
  /** sign-out walk in progress */
  exiting: boolean;
  /** the HUD may show: false while a cold area boots (boot screen), true from shortly after its reveal */
  hud: boolean;
  /** establishing camera move after a cold reveal (the rendered view eases from wide onto the follow camera) */
  establish: { area: Area; t0: number } | null;
  /** GPU warm-up progress per area (0 → 1: compile, upload, first draw) for the boot screen */
  warmProgress: Partial<Record<Area, number>>;
  /** asset loading progress 0 … 1 (drei loading manager), for the boot screen */
  assets: number;
  /** when the boot screen started revealing the scene (performance.now; 0 = not yet) */
  revealAt: number;
  handoff: Handoff | null;
  show: (view: View | null, handoff?: Omit<Handoff, "to" | "at"> | null) => void;
  warmHall: (g: HallGame) => void;
  coolHall: (g: HallGame) => void;
  setReady: (a: Area, v: boolean) => void;
}

export const useStage = create<StageState>()((set, get) => ({
  view: null,
  warm: [],
  ready: {},
  fx: false,
  tier: "standard",
  exiting: false,
  hud: false,
  establish: null,
  warmProgress: {},
  assets: 0,
  revealAt: 0,
  handoff: null,
  show: (view, handoff) =>
    set({ view, handoff: view && handoff ? { ...handoff, to: view, at: performance.now() } : get().handoff?.to === view ? get().handoff : null }),
  warmHall: (g) => {
    const w = get().warm;
    if (w[0] === g) return;
    set({ warm: [g] }); // the previous warm hall (if not on screen) is released
  },
  coolHall: (g) => {
    if (get().warm.includes(g)) set({ warm: get().warm.filter((x) => x !== g) });
  },
  setReady: (a, v) => {
    if (!!get().ready[a] !== v) set({ ready: { ...get().ready, [a]: v } });
  },
}));

/** A handoff waiting for `view` (not consumed: StrictMode renders twice; call `clearHandoff` from an effect). */
export function peekHandoff(view: View): Handoff | null {
  const h = useStage.getState().handoff;
  return h && h.to === view && performance.now() - h.at < 4000 ? h : null;
}
export const clearHandoff = (view: View) => {
  if (useStage.getState().handoff?.to === view) useStage.setState({ handoff: null });
};

/* ---------------- area registry: one scene + camera per area, created once, kept for the session ---------------- */

export interface AreaObjects {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}
const areas = new Map<Area, AreaObjects>();
export function getArea(a: Area): AreaObjects {
  let o = areas.get(a);
  if (!o) {
    const scene = new THREE.Scene();
    scene.name = `area:${a}`;
    scene.visible = false;
    const camera = a === "outdoor" ? new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 3200) : new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 120);
    camera.position.set(0, 4, a === "outdoor" ? 24 : 14);
    o = { scene, camera };
    areas.set(a, o);
  }
  return o;
}
export const knownAreas = () => areas;
/** per area: compile / upload whatever appeared after its warm-up (called right before crossing into it) */
export const areaTopUp = new Map<Area, () => Promise<void>>();

/** React context: which area a component renders in (sounds / door sensors only run while it is on screen). */
export const AreaContext = createContext<Area | null>(null);
export const useArea = () => useContext(AreaContext);
/** Is `area` the one on screen right now? (non-reactive, for useFrame / audio) */
export function isOnScreen(area: Area | null): boolean {
  const v = useStage.getState().view;
  return !area || (!!v && areaOf(v) === area);
}

/* ---------------- navigation (the router lives in the DOM tree; SceneHost registers it) ---------------- */

export const stageNav: { push: (href: string) => void; replace: (href: string) => void } = {
  push: (href) => location.assign(href),
  replace: (href) => location.replace(href),
};

/* ---------------- shared frames: plaza door ↔ hall door ---------------- */

/** Door line of each hall building in its plaza door frame (keep in sync with Plaza.tsx `Door` insets). */
const DOOR_INSET: Record<HallGame, number> = { pool: doorInset("pool"), ludo: doorInset("ludo"), igisoro: doorInset("igisoro"), admin: doorInset("admin"), arena: doorInset("arena") };

/**
 * The hall's door line IS the plaza door's line: a position keeps its lateral offset from the door centre, its
 * depth past the door line and its heading relative to the door when it crosses (no jump either way).
 */
export function plazaToHall(game: HallGame, x: number, z: number, yaw: number) {
  const t = portalTransform(PORTALS.find((p) => p.id === game)!);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  const dx = x - t.x;
  const dz = z - t.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c - DOOR_INSET[game];
  const L = HALLS[game];
  return { x: L.door.x + lx, z: L.size.d / 2 + lz, yaw: yaw - t.rotY };
}
export function hallToPlaza(game: HallGame, x: number, z: number, yaw: number) {
  const t = portalTransform(PORTALS.find((p) => p.id === game)!);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  const L = HALLS[game];
  const lx = x - L.door.x;
  const lz = z - L.size.d / 2 + DOOR_INSET[game];
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c, yaw: yaw + t.rotY };
}

/* ---------------- crossings ---------------- */

/**
 * Walking into a warm hall: the plaza camera follows the person through the door (world/Player); the hall takes
 * over the moment the CAMERA is this far past the door line, with the same camera pose mapped through the door
 * frame (the hall's camera is then inside the hall, behind the person, who stays put on screen).
 */
const CAM_PAST_DOOR = 0.45;
/** never wait longer than this for the camera to come through (blocked, turned round …) */
const ENTER_MAX_MS = 4200;
/** once the camera is through: wait at most this long for the late top-up before crossing anyway */
const TOPUP_GRACE_MS = 250;
/** Cold hall: keep walking on into the vestibule (live) this long before falling back to the frozen-frame hold. */
const COLD_LIVE_MS = 4400;
/** Walking out of a hall door before the cut onto the plaza (just past the door line). */
const EXIT_WALK_MS = 380;

let crossing = false;
/** a live cut updates the route this long after the switch (the dissolve is running) */
const URL_AFTER_CUT_MS = 340;

type HandoffIn = Omit<Handoff, "to" | "at">;

/**
 * Scripted walk target. Also resets the click-to-walk progress tracker: a stale one (the hall's Leave route pins
 * `detours` at 2) made the next programmatic target give up after 450 ms ("can't walk straight back in").
 */
function walkTarget(t: { x: number; z: number } | null) {
  nav.target = t;
  nav.goal = null;
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
}

/**
 * Switch the view. Between areas the current frame is captured and dissolves out over ~260 ms while the destination
 * is already live underneath (the person mid-stride in both); within the same scene (gate ↔ plaza) it is a plain
 * hand-over between controllers (`dissolve: false`). The pose is read at the switch itself; the URL follows.
 */
export function crossTo(view: View, href: string | null, handoff?: HandoffIn | (() => HandoffIn) | null, opts: { dissolve?: boolean } = {}) {
  const go = () => {
    walkTarget(null); // a walk target from the place you left must not drive the next controller
    releaseAllInput(); // nor a key / joystick held across the switch (its key-up / pointer-up may never arrive)
    useStage.getState().show(view, (typeof handoff === "function" ? handoff() : handoff) ?? null);
    // the URL (and with it the page HUD swap and the realtime room switch) follows a moment later, once the cut
    // frame is on screen: never in the same frame as the area switch
    if (href && location.pathname !== href) {
      if (opts.dissolve === false) stageNav.push(href);
      else setTimeout(() => location.pathname !== href && useStage.getState().view === view && stageNav.push(href), URL_AFTER_CUT_MS);
    }
    crossing = false;
  };
  if (opts.dissolve === false) go();
  else useDoorway.getState().cut(go);
}

/** Plaza door crossed (Player sets `useTransition.entering`): walk on through the door, continue inside the hall. */
export function enterHall(href: string, label: string) {
  if (crossing) return;
  const game = href.split("/").pop() as HallGame;
  const area: Area = `hall:${game}`;
  crossing = true;
  useStage.getState().warmHall(game);
  const t0 = performance.now();
  let topped: "no" | "running" | "done" = "no";
  const portal = PORTALS.find((p) => p.id === game)!;
  const cam = getArea("outdoor").camera;
  let throughAt = 0;
  const camThrough = () => {
    // the camera is through the door line, and behind the person (who is further in)
    const c = doorLocal(portal, cam.position.x, cam.position.z).lz;
    return c < DOOR_INSET[game] - CAM_PAST_DOOR && doorLocal(portal, selfPose.x, selfPose.z).lz < c - 1.0;
  };
  const inside = (): HandoffIn => {
    // the camera pose crosses the door frame with the person: same position and aim relative to them
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const c = plazaToHall(game, cam.position.x, cam.position.z, 0);
    const l = plazaToHall(game, cam.position.x + fwd.x * 4, cam.position.z + fwd.z * 4, 0);
    return {
      ...plazaToHall(game, selfPose.x, selfPose.z, selfPose.yaw),
      speed: 1.35,
      walk: 1.9,
      cam: [c.x, cam.position.y, c.z],
      look: [l.x, cam.position.y + fwd.y * 4, l.z],
    };
  };
  const tick = () => {
    const st = useStage.getState();
    if (st.view !== "plaza") return void (crossing = false); // signed out / navigated away meanwhile
    const el = performance.now() - t0;
    if (st.ready[area] && topped === "no") {
      topped = "running";
      void (areaTopUp.get(area)?.() ?? Promise.resolve()).finally(() => (topped = "done"));
    }
    const through = camThrough() || el >= ENTER_MAX_MS;
    if (through) throughAt ||= performance.now();
    // the top-up (parts that streamed in late) gets a moment, but never holds the person up in the lobby
    if (st.ready[area] && through && (topped === "done" || performance.now() - throughAt > TOPUP_GRACE_MS)) return crossTo(`hall:${game}`, href, inside);
    if (el >= COLD_LIVE_MS && !st.ready[area]) {
      // cold (first visit before the hall finished loading): hold the last frame until the hall is ready
      crossing = false;
      const h = inside();
      useDoorway.getState().pass(label, () => useStage.getState().show(`hall:${game}`, h), 0);
      stageNav.push(href);
      return;
    }
    setTimeout(tick, 16);
  };
  tick();
}

/** Walked out through a hall door (RoomPlayer `onExit`): the plaza is kept warm, so the walk continues outside. */
export function leaveHall() {
  if (crossing) return;
  const game = hallOf(useStage.getState().view);
  if (!game) return;
  crossing = true;
  try {
    sessionStorage.setItem("gk-from-room", "1");
  } catch {
    /* private mode */
  }
  // the plaza door opens for you before you reach it (its sensor cannot see you while you are inside)
  doorHold[game] = performance.now() + 4000;
  const t0 = performance.now();
  let topped: "no" | "running" | "done" = "no";
  const hcam = getArea(`hall:${game}`).camera;
  const out = (): HandoffIn => {
    // the hall's camera (inside, behind you) carries on as the plaza camera in the doorway behind you
    const c = hallToPlaza(game, hcam.position.x, hcam.position.z, 0);
    return { ...hallToPlaza(game, selfPose.x, selfPose.z, selfPose.yaw), speed: 1.35, walk: 2.0, fromDoor: true, cam: [c.x, hcam.position.y, c.z] };
  };
  const tick = () => {
    const el = performance.now() - t0;
    const ready = !!useStage.getState().ready.outdoor;
    if (ready && topped === "no") {
      topped = "running";
      void (areaTopUp.get("outdoor")?.() ?? Promise.resolve()).finally(() => (topped = "done"));
    }
    if (ready && topped === "done" && el >= EXIT_WALK_MS) return crossTo("plaza", "/world", out);
    if (el >= 1200) {
      crossing = false;
      const h = out();
      useDoorway.getState().pass("Gukirana Plaza", () => useStage.getState().show("plaza", h), 0);
      stageNav.push("/world");
      return;
    }
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
}

/**
 * Signing out: the person turns and walks out through the plaza's entry gate onto the avenue (never a cut to a
 * sign-in screen); the gate controller (world/gate/GateCanvas Rig, step "leaving") takes over in the same scene.
 *   kiosk (or anywhere near the entry gate) → the same person, same spot, keeps walking: no cut at all
 *   menu from elsewhere → a few steps, then a short dissolve onto the person mid-walk in the turnstile lane
 * `logout()` runs once the walk has started, so the network never blocks the picture.
 */
export function signOut(source: "kiosk" | "menu", logout: () => Promise<void>) {
  const st = useStage.getState();
  if (st.exiting) return;
  useStage.setState({ exiting: true });
  const view = st.view;
  const nearGate = view === "plaza" && (source === "kiosk" || Math.hypot(selfPose.x, selfPose.z - ENTRY_Z) < 9);
  let delay = 0;
  if (view === "plaza" && !nearGate) {
    // turn towards the way out (the entry gate) and start walking
    const dx = -selfPose.x;
    const dz = ENTRY_Z - 4 - selfPose.z;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    walkTarget({ x: selfPose.x + (dx / d) * 3, z: selfPose.z + (dz / d) * 3 });
    delay = 700;
  } else if (view && view.startsWith("hall:")) {
    void import("@/rooms/room-store").then(({ useRoom }) => useRoom.getState().set({ leaving: true }));
    delay = 700;
  }
  setTimeout(() => {
    walkTarget(null);
    useGate.setState({ step: "leaving", code: "", devCode: null, error: null, busy: false });
    if (nearGate) {
      // same scene, same spot: the gate controller simply carries on walking this person out
      const { camera } = getArea("outdoor");
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      crossTo(
        "gate",
        "/gate",
        () => ({
          x: selfPose.x,
          z: selfPose.z,
          yaw: selfPose.yaw,
          speed: 1.4,
          walk: 0,
          cam: [camera.position.x, camera.position.y, camera.position.z],
          look: [camera.position.x + fwd.x * 6, camera.position.y + fwd.y * 6, camera.position.z + fwd.z * 6],
        }),
        { dissolve: false },
      );
    } else {
      // mid-walk in the centre lane of the entry gate, heading out (+z), camera behind
      crossTo("gate", "/gate", { x: 0, z: ENTRY_Z - 1.4, yaw: 0, speed: 1.4, walk: 0, cam: [-0.5, 2.3, ENTRY_Z - 5.9], look: [0, 1.3, ENTRY_Z + 1.1] });
    }
    void logout().finally(() => useStage.setState({ exiting: false }));
  }, delay);
}

// QA hook (dev, or a production build with NEXT_PUBLIC_GK_QA=1), like window.__gkNav
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined")
  Object.assign(window as unknown as Record<string, unknown>, { __gkStage: useStage, __gkMap: { plazaToHall, hallToPlaza } });
