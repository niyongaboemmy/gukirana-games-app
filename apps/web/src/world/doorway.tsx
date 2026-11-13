"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { addAfterEffect } from "@react-three/fiber";
import { create } from "zustand";

/**
 * Screen-level part of moving between areas. The 3D stage is persistent (world/stage.ts), so the normal path never
 * freezes:
 *   cut      → warm destination: the last frame of the place you leave is captured and dissolves out (~260 ms) while
 *              the destination is already live underneath (a match cut through the doorway, the person mid-stride)
 * Fallbacks only for cold cases:
 *   closing  → (pass) the person keeps walking through the real door, the camera holds and watches
 *   closed   → the last frame is held (slow push-in) until the destination area reports ready
 *   opening  → it cross-dissolves (400 ms) onto the destination
 * `hold` (reload / deep link before the stage has anything to show) starts from a soft exposure haze instead.
 * A 9 s safety always reveals.
 */
type Phase = "idle" | "closing" | "closed" | "cut" | "opening";
type DoorwayState = {
  phase: Phase;
  label: string;
  /** snapshot of the last frame of the area you are leaving (null = haze) */
  frame: HTMLCanvasElement | null;
  /** the frame on screen belongs to a live cut (quick dissolve, no push-in, input passes through) */
  live: boolean;
  pass: (label: string, go: () => void, walkMs?: number) => void;
  /** arriving without having walked through a door (back from a game, page reload) */
  hold: (label: string) => void;
  /** live cut: capture the frame, run `go` (switches the area), dissolve the capture out */
  cut: (go: () => void) => void;
  ready: () => void;
};

const WALK_MS = 800; // the person walks on through the door before the frame freezes
const DISSOLVE_MS = 400;
const CUT_MS = 260;
const HAZE_MS = 300;
const MAX_CLOSED_MS = 9000; // never trap anyone behind a frozen frame if a scene is slow or fails
/** Reload / first load: show the live scene (the person and the room shell are ready early) rather than a long haze. */
const MAX_HOLD_MS = 2500;

let openTimer: ReturnType<typeof setTimeout> | undefined;
let safety: ReturnType<typeof setTimeout> | undefined;
/** the page a passage started from: until the route has actually changed, nothing may reveal */
let fromPath = "";

/**
 * Copy the WebGL canvas into a 2D canvas right after the next render (same task, so no preserveDrawingBuffer
 * needed; includes post-processing). Half resolution is plenty for a frame that is dissolving.
 */
function captureFrame(maxW = 1280): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const gl = (document.querySelector("canvas[data-gk-stage]") as HTMLCanvasElement | null) ?? [...document.querySelectorAll("canvas")].find((c) => c.width > 0 && !c.dataset.gkFrame);
    if (!gl || !gl.width || gl.offsetParent === null) return resolve(null);
    let done = false;
    const finish = (c: HTMLCanvasElement | null) => {
      if (done) return;
      done = true;
      unsub();
      resolve(c);
    };
    const unsub = addAfterEffect(() => {
      try {
        const out = document.createElement("canvas");
        const k = Math.min(1, maxW / Math.max(1, gl.width));
        out.width = Math.round(gl.width * k);
        out.height = Math.round(gl.height * k);
        out.dataset.gkFrame = "1";
        out.getContext("2d")!.drawImage(gl, 0, 0, out.width, out.height);
        finish(out);
      } catch {
        finish(null);
      }
    });
    setTimeout(() => finish(null), 250); // no render loop running
  });
}

export const useDoorway = create<DoorwayState>()((set, get) => ({
  phase: "idle",
  label: "",
  frame: null,
  live: false,
  pass: (label, go, walkMs = WALK_MS) => {
    if (get().phase !== "idle") return;
    fromPath = location.pathname;
    set({ phase: "closing", label, frame: null, live: false });
    setTimeout(() => {
      void captureFrame().then((frame) => {
        set({ phase: "closed", frame });
        go();
        clearTimeout(safety);
        safety = setTimeout(() => get().ready(), MAX_CLOSED_MS);
      });
    }, walkMs);
  },
  hold: (label) => {
    if (get().phase !== "idle") return;
    fromPath = "";
    set({ phase: "closed", label, frame: null, live: false });
    clearTimeout(safety);
    safety = setTimeout(() => get().ready(), MAX_HOLD_MS);
  },
  cut: (go) => {
    if (get().phase !== "idle") return void go();
    void captureFrame(960).then((frame) => {
      go();
      if (!frame) return;
      set({ phase: "cut", frame, label: "", live: true });
      clearTimeout(openTimer);
      // next paint shows the capture at full opacity, the one after starts the dissolve
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (get().phase !== "cut") return;
          set({ phase: "opening" });
          openTimer = setTimeout(() => set({ phase: "idle", frame: null }), CUT_MS + 40);
        }),
      );
    });
  },
  ready: () => {
    if (get().phase !== "closed") return;
    clearTimeout(safety);
    set({ phase: "opening" });
    clearTimeout(openTimer);
    openTimer = setTimeout(() => set({ phase: "idle", frame: null }), get().frame ? DISSOLVE_MS : HAZE_MS);
  },
}));

// dev-only hook for automated walk-through tests (like window.__gkNav)
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined") (window as unknown as { __gkDoorway: typeof useDoorway }).__gkDoorway = useDoorway;

/** Is the doorway currently covering the screen with a held (frozen) frame or haze? */
export const doorwayHeld = () => useDoorway.getState().phase === "closed";

export function DoorTransition() {
  const phase = useDoorway((s) => s.phase);
  const frame = useDoorway((s) => s.frame);
  const live = useDoorway((s) => s.live);
  const path = usePathname();
  const host = useRef<HTMLDivElement>(null);
  // pages without a 3D scene (game boards) have nothing to wait for: reveal as soon as they are there
  useEffect(() => {
    if (phase !== "closed" || path === fromPath || path === "/world" || path === "/gate" || path.startsWith("/room/")) return;
    const t = setTimeout(() => useDoorway.getState().ready(), 120);
    return () => clearTimeout(t);
  }, [phase, path]);
  // (no timer cleanup on unmount: this overlay lives in the root layout, and StrictMode's mount→unmount→mount in
  // dev would otherwise cancel the safety reveal that the page's hold() just armed → stuck on the haze forever)
  useEffect(() => {
    const el = host.current;
    if (!el || !frame) return;
    frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
    el.appendChild(frame);
    return () => frame.remove();
  }, [frame]);
  if (phase === "idle" || phase === "closing") return null;
  const out = phase === "opening";
  if (!frame) {
    // no previous frame: a soft over-exposure that clears as the destination's first frames appear (never black)
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60]"
        style={{ background: "#e9eef1", opacity: out ? 0 : 0.92, transition: out ? `opacity ${HAZE_MS}ms ease-out` : undefined }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${live ? "pointer-events-none" : "pointer-events-auto"} fixed inset-0 z-[60] overflow-hidden`}
      style={{ opacity: out ? 0 : 1, transition: out ? `opacity ${live ? CUT_MS : DISSOLVE_MS}ms ${live ? "ease-out" : "ease-in-out"}` : undefined }}
    >
      {/* the held last frame keeps drifting forward (a slow push-in) while the next place loads */}
      <div ref={host} className={live ? "absolute inset-0" : "gk-frame-push absolute inset-0"} />
    </div>
  );
}
