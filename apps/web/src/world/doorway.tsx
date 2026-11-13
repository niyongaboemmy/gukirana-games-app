"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { addAfterEffect, useFrame } from "@react-three/fiber";
import { create } from "zustand";

/**
 * Moving between areas without a loading picture: you keep watching your person.
 *   closing → the person keeps walking through the real 3D door, the camera holds still and watches (~0.8 s)
 *   closed  → the current 3D frame is frozen on screen (a slow push-in with a faint blur) while the next place loads
 *             behind it; navigation happens at the freeze
 *   opening → once the destination has drawn real frames plus a settled one, the frozen frame cross-dissolves out
 *             (400 ms) onto the destination, where the person is already mid-step coming through its door (the hall
 *             walk-in / plaza step-out start exactly here, keyed off this phase)
 * Arriving without a previous frame (page reload, back from a 2D game: `hold`) starts from a soft exposure haze that
 * fades out over the first rendered frames (never black). The overlay lives in the root layout, so it survives the
 * route change. 2D game pages open immediately. A 9 s safety always reveals.
 */
type Phase = "idle" | "closing" | "closed" | "opening";
type DoorwayState = {
  phase: Phase;
  label: string;
  /** snapshot of the last frame of the area you are leaving (null = haze) */
  frame: HTMLCanvasElement | null;
  pass: (label: string, go: () => void) => void;
  /** arriving without having walked through a door (back from a game, page reload) */
  hold: (label: string) => void;
  ready: () => void;
};

const WALK_MS = 800; // the person walks on through the door before the frame freezes
const DISSOLVE_MS = 400;
const HAZE_MS = 300;
const MAX_CLOSED_MS = 9000; // never trap anyone behind a frozen frame if a scene is slow or fails

let openTimer: ReturnType<typeof setTimeout> | undefined;
let safety: ReturnType<typeof setTimeout> | undefined;
/** the page a passage started from: until the route has actually changed, nothing may reveal */
let fromPath = "";

/**
 * Copy the WebGL canvas into a 2D canvas right after the next render (same task, so no preserveDrawingBuffer
 * needed; includes post-processing). Half resolution is plenty for a frame that is blurred and dissolving.
 */
function captureFrame(): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const gl = [...document.querySelectorAll("canvas")].find((c) => c.width > 0 && !c.dataset.gkFrame);
    if (!gl) return resolve(null);
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
        const k = Math.min(1, 1280 / Math.max(1, gl.width));
        out.width = Math.round(gl.width * k);
        out.height = Math.round(gl.height * k);
        out.dataset.gkFrame = "1";
        out.getContext("2d")!.drawImage(gl, 0, 0, out.width, out.height);
        finish(out);
      } catch {
        finish(null);
      }
    });
    setTimeout(() => finish(null), 250); // no render loop running: fall back to the haze
  });
}

export const useDoorway = create<DoorwayState>()((set, get) => ({
  phase: "idle",
  label: "",
  frame: null,
  pass: (label, go) => {
    if (get().phase !== "idle") return;
    fromPath = location.pathname;
    set({ phase: "closing", label, frame: null });
    setTimeout(() => {
      void captureFrame().then((frame) => {
        set({ phase: "closed", frame });
        go();
        clearTimeout(safety);
        safety = setTimeout(() => get().ready(), MAX_CLOSED_MS);
      });
    }, WALK_MS);
  },
  hold: (label) => {
    if (get().phase !== "idle") return;
    fromPath = "";
    set({ phase: "closed", label, frame: null });
    clearTimeout(safety);
    safety = setTimeout(() => get().ready(), MAX_CLOSED_MS);
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
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __gkDoorway: typeof useDoorway }).__gkDoorway = useDoorway;

let frames = 0;

/**
 * Put inside the destination's main <Suspense>: reveals once the scene has rendered real frames AND a frame has
 * settled (rendered on time: shader compiles / uploads done), so the dissolve never lands on a hitch. A slow
 * device still reveals after ~40 frames.
 */
export function SceneReady() {
  useEffect(() => {
    frames = 0;
  }, []);
  useFrame((_, dt) => {
    frames++;
    if (frames < 3 || frames > 41) return;
    if (dt < 1 / 24 || frames === 41) useDoorway.getState().ready();
  });
  return null;
}

export function DoorTransition() {
  const phase = useDoorway((s) => s.phase);
  const frame = useDoorway((s) => s.frame);
  const path = usePathname();
  const host = useRef<HTMLDivElement>(null);
  // pages without a 3D scene (game boards, the gate form) have nothing to wait for: reveal as soon as they are there
  useEffect(() => {
    if (phase !== "closed" || path === fromPath || path === "/world" || path.startsWith("/room/")) return;
    const t = setTimeout(() => useDoorway.getState().ready(), 120);
    return () => clearTimeout(t);
  }, [phase, path]);
  useEffect(() => () => clearTimeout(safety), []);
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
    <div aria-hidden className="pointer-events-auto fixed inset-0 z-[60] overflow-hidden" style={{ opacity: out ? 0 : 1, transition: out ? `opacity ${DISSOLVE_MS}ms ease-in-out` : undefined }}>
      {/* the frozen last frame keeps drifting forward (a slow push-in) with a faint blur while the next place loads */}
      <div ref={host} className="gk-frame-push absolute inset-0" />
    </div>
  );
}
