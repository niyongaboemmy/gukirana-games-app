"use client";
import { createContext, useContext } from "react";
import * as THREE from "three";
import { create } from "zustand";
import type { HallGame } from "@/rooms/layouts";
import { selfPose } from "@/lib/world-store";
import { useDoorway } from "./doorway";
import { nav } from "./navigation";
import { useGate } from "./gate/gate-store";

/**
 * One persistent 3D stage for the whole session (P1-WLD-05).
 *
 * The app keeps ONE WebGL renderer (world/SceneHost → SceneCanvas, mounted in the root layout). Each place is an
 * "area" with its own THREE.Scene (+ camera) hung under the renderer's root scene; only the area on screen is
 * visible, the others stay mounted, compiled and GPU-resident but are never drawn:
 *   outdoor    the gate AND the plaza (one scene: the arrival gate stands at the south end of the plaza's avenue)
 *   hall:<id>  a hall interior (pool, ludo, igisoro)
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
  const m = /^\/room\/(pool|ludo|igisoro)\/?$/.exec(path);
  return m ? (`hall:${m[1]}` as View) : null;
}

/** Arrival gate on the southern avenue vs the plaza's entry gate: the same structure, 64.5 m apart along z. */
export const GATE_TO_PLAZA_DZ = 64.5;

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
  handoff: null,
  show: (view, handoff) =>
    set({ view, handoff: view && handoff ? { ...handoff, to: view, at: performance.now() } : get().handoff?.to === view ? get().handoff : null }),
  warmHall: (g) => {
    const w = get().warm;
    if (w[0] === g) return;
    set({ warm: [g] }); // the previous warm hall (if not on screen) is released
  },
  coolHall: (g) => set({ warm: get().warm.filter((x) => x !== g) }),
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

/* ---------------- crossings ---------------- */

/** How long you keep walking into the doorway (live) before the cut into a warm hall. */
const ENTER_WALK_MS = 850;
/** Cold hall: keep walking on into the vestibule (live) this long before falling back to the frozen-frame hold. */
const COLD_LIVE_MS = 2300;
/** Walking out of a hall door before the cut onto the plaza. */
const EXIT_WALK_MS = 380;

let crossing = false;

/**
 * Cut to another view: the current frame is captured and dissolves out over ~260 ms while the destination is
 * already live underneath (the person mid-stride in both), then the URL follows.
 */
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

export function crossTo(view: View, href: string | null, handoff?: HandoffIn | (() => HandoffIn) | null) {
  useDoorway.getState().cut(() => {
    walkTarget(null); // a walk target from the place you left must not drive the next controller
    // the pose is read at the cut itself (after the outgoing frame was captured), so nothing jumps
    useStage.getState().show(view, (typeof handoff === "function" ? handoff() : handoff) ?? null);
    if (href && location.pathname !== href) stageNav.push(href);
    crossing = false;
  });
}

/** Plaza door crossed (Player sets `useTransition.entering`): walk on into the vestibule, cut into the hall. */
export function enterHall(href: string, label: string) {
  if (crossing) return;
  const game = href.split("/").pop() as HallGame;
  const area: Area = `hall:${game}`;
  crossing = true;
  useStage.getState().warmHall(game);
  const t0 = performance.now();
  const tick = () => {
    const st = useStage.getState();
    if (st.view !== "plaza") return void (crossing = false); // signed out / navigated away meanwhile
    const el = performance.now() - t0;
    if (st.ready[area] && el >= ENTER_WALK_MS) return crossTo(`hall:${game}`, href);
    if (el >= COLD_LIVE_MS) {
      // cold (first visit before the hall finished loading): hold the last frame until the hall is ready
      crossing = false;
      useDoorway.getState().pass(label, () => {
        useStage.getState().show(`hall:${game}`);
        stageNav.push(href);
      }, 0);
      return;
    }
    setTimeout(tick, 16);
  };
  tick();
}

/** Walked out through a hall door (RoomPlayer `onExit`): the plaza is kept warm, so the step-out continues live. */
export function leaveHall() {
  if (crossing) return;
  crossing = true;
  try {
    sessionStorage.setItem("gk-from-room", "1");
  } catch {
    /* private mode */
  }
  const t0 = performance.now();
  const tick = () => {
    const el = performance.now() - t0;
    if (useStage.getState().ready.outdoor && el >= EXIT_WALK_MS) return crossTo("plaza", "/world");
    if (el >= 1200) {
      crossing = false;
      useDoorway.getState().pass("Gukirana Plaza", () => {
        useStage.getState().show("plaza");
        stageNav.push("/world");
      }, 0);
      return;
    }
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
}

/**
 * Signing out: the person turns and walks out through the gate (never a cut to a sign-in screen).
 *   kiosk → from the exit kiosk at the plaza entry gate: a few steps to the turnstile lane, then the same walk
 *           continues through the arrival gate's turnstiles (same structure, 64.5 m down the avenue)
 *   menu  → from anywhere: a few steps, then a short dissolve onto the person mid-walk through the turnstiles
 * `logout()` runs once the walk has started, so the network never blocks the picture.
 */
export function signOut(source: "kiosk" | "menu", logout: () => Promise<void>) {
  const st = useStage.getState();
  if (st.exiting) return;
  useStage.setState({ exiting: true });
  const view = st.view;
  let delay = 0;
  if (view === "plaza") {
    if (source === "kiosk") walkTarget({ x: -0.2, z: 27.4 }); // towards the centre turnstile lane
    else {
      // turn towards the way out (the entry gate) and start walking
      const dx = -selfPose.x;
      const dz = 27.4 - selfPose.z;
      const d = Math.max(1e-3, Math.hypot(dx, dz));
      walkTarget(d < 3.5 ? { x: 0, z: 27.4 } : { x: selfPose.x + (dx / d) * 3, z: selfPose.z + (dz / d) * 3 });
    }
    delay = source === "kiosk" ? 1000 : 700;
  } else if (view && view.startsWith("hall:")) {
    void import("@/rooms/room-store").then(({ useRoom }) => useRoom.getState().set({ leaving: true }));
    delay = 700;
  }
  setTimeout(() => {
    const { camera } = getArea("outdoor");
    let hand: HandoffIn;
    if (view === "plaza" && source === "kiosk") {
      // same scene: shift person + camera down the avenue onto the arrival gate's matching spot
      const dz = GATE_TO_PLAZA_DZ;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      hand = {
        x: selfPose.x,
        z: selfPose.z + dz,
        yaw: selfPose.yaw,
        speed: 1.4,
        walk: 0,
        cam: [camera.position.x, camera.position.y, camera.position.z + dz],
        look: [camera.position.x + fwd.x * 6, camera.position.y + fwd.y * 6, camera.position.z + dz + fwd.z * 6],
      };
    } else {
      // mid-walk in the centre lane, just before the turnstile, heading out (+z), camera behind
      hand = { x: 0, z: 96 - 1.1, yaw: 0, speed: 1.4, walk: 0, cam: [-0.5, 2.3, 96 - 5.6], look: [0, 1.3, 96 + 1.4] };
    }
    walkTarget(null);
    useGate.setState({ step: "leaving", code: "", devCode: null, error: null, busy: false });
    crossTo("gate", "/gate", hand);
    void logout().finally(() => useStage.setState({ exiting: false }));
  }, delay);
}
