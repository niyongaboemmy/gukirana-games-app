"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFrame } from "@react-three/fiber";
import { create } from "zustand";

/**
 * Walking through a hall door, end to end:
 *   closing → the glass doors slide shut in front of you (and the view eases forward, as if stepping in)
 *   closed  → the next place loads behind the closed doors (navigation happens here)
 *   opening → once the new 3D scene has drawn real frames, the doors slide apart and you step through
 * The overlay lives in the root layout, so it stays on screen across the route change: there is never a
 * flat placeholder, a black screen, or a half-loaded scene in between.
 */
type Phase = "idle" | "closing" | "closed" | "opening";
type DoorwayState = {
  phase: Phase;
  label: string;
  pass: (label: string, go: () => void) => void;
  /** arriving without having walked through a door (back from a game, page reload): start with the doors shut */
  hold: (label: string) => void;
  ready: () => void;
};

// a warm passage (scene already cached) takes < 1 s door-to-door: 350 ms close, a few frames to settle, 450 ms open
const CLOSE_MS = 350;
const OPEN_MS = 450;
const MAX_CLOSED_MS = 9000; // never trap anyone behind closed doors if a scene is slow or fails

let openTimer: ReturnType<typeof setTimeout> | undefined;
let safety: ReturnType<typeof setTimeout> | undefined;

export const useDoorway = create<DoorwayState>()((set, get) => ({
  phase: "idle",
  label: "",
  pass: (label, go) => {
    if (get().phase !== "idle") return;
    set({ phase: "closing", label });
    setTimeout(() => {
      set({ phase: "closed" });
      go();
      clearTimeout(safety);
      safety = setTimeout(() => get().ready(), MAX_CLOSED_MS);
    }, CLOSE_MS);
  },
  hold: (label) => {
    if (get().phase !== "idle") return;
    set({ phase: "closed", label });
    clearTimeout(safety);
    safety = setTimeout(() => get().ready(), MAX_CLOSED_MS);
  },
  ready: () => {
    if (get().phase !== "closed") return;
    clearTimeout(safety);
    set({ phase: "opening" });
    clearTimeout(openTimer);
    openTimer = setTimeout(() => set({ phase: "idle" }), OPEN_MS);
  },
}));

// dev-only hook for automated walk-through tests (like window.__gkNav)
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __gkDoorway: typeof useDoorway }).__gkDoorway = useDoorway;

let frames = 0;

/**
 * Put inside the destination's main <Suspense>: opens the doors once the scene has rendered real frames AND a frame
 * has settled (rendered on time, i.e. shader compiles / texture uploads are done), so the doors never open onto a
 * hitch or a camera still easing into place. A slow device still opens after ~40 frames.
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

/** One door leaf: anodised steel frame, smoked safety glass with a soft reflection, a long steel pull bar. */
function Leaf({ side }: { side: "left" | "right" }) {
  const edge = side === "left" ? "right" : "left";
  return (
    <div
      className="relative h-full w-full"
      style={{
        background: "linear-gradient(180deg,#30343b 0%,#1f2227 100%)",
        boxShadow: side === "left" ? "inset -2px 0 0 #0c0d10, 18px 0 40px rgba(0,0,0,0.35)" : "inset 2px 0 0 #0c0d10, -18px 0 40px rgba(0,0,0,0.35)",
      }}
    >
      {/* glass pane inside the frame */}
      <div
        className="absolute overflow-hidden"
        style={{
          top: "6%",
          bottom: "7%",
          left: side === "left" ? "7%" : "5%",
          right: side === "left" ? "5%" : "7%",
          background: "linear-gradient(180deg, rgba(44,58,66,0.94) 0%, rgba(26,34,40,0.96) 55%, rgba(18,22,26,0.97) 100%)",
          boxShadow: "inset 0 0 0 2px #15171b, inset 0 0 60px rgba(0,0,0,0.45)",
        }}
      >
        {/* diagonal reflection band and a faint second one */}
        <div className="absolute -inset-1/2" style={{ background: "linear-gradient(115deg, transparent 38%, rgba(255,255,255,0.09) 44%, rgba(255,255,255,0.025) 50%, transparent 56%)" }} />
        <div className="absolute -inset-1/2" style={{ background: "linear-gradient(115deg, transparent 60%, rgba(255,255,255,0.05) 63%, transparent 67%)" }} />
        {/* frosted manifestation band at eye level (safety marking on real glass doors) */}
        <div className="absolute inset-x-0" style={{ top: "44%", height: "4%", background: "rgba(220,230,236,0.16)", backdropFilter: "blur(2px)" }} />
      </div>
      {/* vertical pull bar near the meeting edge */}
      <div
        className="absolute"
        style={{
          [edge]: "9%",
          top: "30%",
          height: "34%",
          width: "clamp(8px,1.1vw,14px)",
          borderRadius: 999,
          background: "linear-gradient(90deg,#6e737b,#d9dde2 45%,#8a9097 70%,#5d6168)",
          boxShadow: "0 6px 14px rgba(0,0,0,0.45)",
        }}
      />
      {/* rubber seal on the meeting edge */}
      <div className="absolute inset-y-0" style={{ [edge]: 0, width: 3, background: "#0a0b0d" }} />
    </div>
  );
}

export function DoorTransition() {
  const phase = useDoorway((s) => s.phase);
  const label = useDoorway((s) => s.label);
  const path = usePathname();
  // pages without a 3D scene (game boards, the gate) have nothing to wait for: open as soon as they are there
  useEffect(() => {
    if (phase !== "closed" || path === "/world" || path.startsWith("/room/")) return;
    const t = setTimeout(() => useDoorway.getState().ready(), 120);
    return () => clearTimeout(t);
  }, [phase, path]);
  // a page refresh mid-transition must not leave anything stuck
  useEffect(() => () => clearTimeout(safety), []);
  if (phase === "idle") return null;
  const shut = phase === "closing" || phase === "closed";
  return (
    <div aria-hidden className="pointer-events-auto fixed inset-0 z-[60] overflow-hidden" style={{ perspective: "900px" }}>
      <div
        className="absolute inset-0"
        style={{
          // stepping forward: the doorway grows towards you as the leaves close, and you walk through as they open
          transform: phase === "opening" ? "scale(1.22)" : phase === "closing" ? "scale(1.0)" : "scale(1.04)",
          opacity: phase === "opening" ? 0 : 1,
          transition:
            phase === "opening"
              ? `transform ${OPEN_MS}ms cubic-bezier(.4,0,.2,1), opacity ${OPEN_MS * 0.5}ms ease-in ${OPEN_MS * 0.5}ms`
              : `transform ${CLOSE_MS * 2.5}ms ease-out`,
        }}
      >
        {/* door leaves */}
        <div className="gk-door-leaf absolute inset-y-0 left-0 w-1/2" style={{ transform: shut ? "translateX(0)" : "translateX(-101%)", animation: phase === "closing" ? `gk-door-close-l ${CLOSE_MS}ms cubic-bezier(.3,.0,.2,1) both` : undefined, transition: `transform ${OPEN_MS}ms cubic-bezier(.5,0,.2,1)` }}>
          <Leaf side="left" />
        </div>
        <div className="gk-door-leaf absolute inset-y-0 right-0 w-1/2" style={{ transform: shut ? "translateX(0)" : "translateX(101%)", animation: phase === "closing" ? `gk-door-close-r ${CLOSE_MS}ms cubic-bezier(.3,.0,.2,1) both` : undefined, transition: `transform ${OPEN_MS}ms cubic-bezier(.5,0,.2,1)` }}>
          <Leaf side="right" />
        </div>
        {/* lintel with the hall's name, and the threshold strip */}
        <div className="absolute inset-x-0 top-0 grid place-items-center" style={{ height: "7%", minHeight: 34, background: "linear-gradient(180deg,#17191d,#24272c)", boxShadow: "0 6px 18px rgba(0,0,0,0.5)" }}>
          {label && <span className="text-[clamp(11px,1.5vw,16px)] font-bold uppercase tracking-[0.35em] text-[#e9dcc0]/85">{label}</span>}
        </div>
        <div className="absolute inset-x-0 bottom-0" style={{ height: "3%", background: "linear-gradient(180deg,#5a5e64,#2b2e33)" }} />
        {/* a quiet "opening" indicator only if loading takes a while */}
        {phase === "closed" && (
          <div className="gk-door-wait absolute bottom-[9%] left-1/2 flex -translate-x-1/2 gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 rounded-full bg-white/70" style={{ animation: `gk-door-dot 1.1s ease-in-out ${i * 0.18}s infinite` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
