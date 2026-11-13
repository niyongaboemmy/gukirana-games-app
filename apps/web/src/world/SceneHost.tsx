"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { areaOf, hallOf, stageNav, useStage, viewForPath, type View } from "./stage";
import { useDoorway } from "./doorway";
import { HALLS } from "@/rooms/layouts";

const SceneCanvas = dynamic(() => import("./SceneCanvas"), { ssr: false, loading: () => null });

/** UI strings (to move to @gukirana/i18n keys `boot.*`). */
const STR = {
  brand: "Gukirana",
  sub: "Playground",
  gate: "Arriving at the gate…",
  plaza: "Loading the plaza…",
  hall: (title: string) => `Preparing the ${title}…`,
  last: "Almost there…",
  tip: "Murakaza neza! While the playground loads: tap the ground to walk there, and walk up to any lit door to enter a hall.",
} as const;

const FADE_MS = 520;
/** the HUD comes in once the establishing move has mostly played */
const HUD_DELAY_MS = 1000;

/**
 * Boot screen for cold loads (first visit, reload, deep link): crisp and dark, the wordmark and a real progress bar
 * (asset loading via drei's loading manager, then the GPU warm-up of the area). It fades out onto the LIVE scene
 * once the area is compiled, uploaded and drawing on time; the view then eases in (establishing move) and only then
 * the HUD appears. Crossings between warm areas never show it.
 */
function BootScreen({ pathView }: { pathView: View | null }) {
  const storeView = useStage((s) => s.view);
  const view = storeView ?? pathView;
  const area = view ? areaOf(view) : null;
  // a hall deep link also waits for the plaza to be built (behind the boot screen, never as a stall in the hall)
  const ready = useStage((s) => (area ? !!s.ready[area] && (area === "outdoor" || !!s.ready.outdoor) : true));
  const warm = useStage((s) => (area ? (s.warmProgress[area] ?? 0) : 0));
  const holding = useDoorway((s) => s.phase !== "idle"); // a cold crossing holds its own frame instead
  const progress = useStage((s) => s.assets); // 0 … 1, published by the lazily loaded canvas (drei loading manager)
  const [state, setState] = useState<"on" | "fading" | "off">(() => (pathView ? "on" : "off"));
  const [shown, setShown] = useState(0);
  // on a slow network a friendly line appears after ~4 s (the bar keeps moving; never a frozen screen)
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state !== "on") return void setSlow(false);
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [state]);

  // (re)enter boot when the area on screen is not ready (and no crossing is holding a frame)
  useEffect(() => {
    if (!area || ready || holding) return;
    setShown(0);
    setState("on");
    useStage.setState({ hud: false });
  }, [area, ready, holding]);

  // ready: wait for a few on-time frames (the people have mounted, nothing is compiling), then reveal
  useEffect(() => {
    if (state !== "on" || !area) return;
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let good = 0;
    const t0 = last;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = () => {
      const now = performance.now();
      good = now - last < 50 ? good + 1 : 0;
      last = now;
      // ~0.2 s of on-time frames: the people are mounted and the follow camera has settled behind them
      if ((good >= 8 && now - t0 > 180) || now - t0 > 1400) {
        setState("fading");
        useStage.setState({ revealAt: performance.now() });
        // the gate has its own fly-in; the plaza and halls get the establishing move
        if (useStage.getState().view !== "gate") useStage.setState({ establish: { area, t0: performance.now() } });
        timers.push(setTimeout(() => setState("off"), FADE_MS));
        // at the gate the tablet may come up sooner (during the short fly-in)
        timers.push(setTimeout(() => useStage.setState({ hud: true }), useStage.getState().view === "gate" ? 600 : HUD_DELAY_MS));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // keep the reveal timers once fading has started (StrictMode re-runs must not strand the HUD)
    };
  }, [state, area, ready]);

  // no 3D route at all (2D pages): nothing to boot; the HUD rule only applies to 3D views
  useEffect(() => {
    if (!area && state !== "off") setState("off");
  }, [area, state]);

  // the bar never runs backwards
  const value = Math.max(shown, 0.06 + 0.62 * (warm > 0 ? 1 : progress) + 0.32 * warm);
  useEffect(() => {
    if (value > shown) setShown(value);
  }, [value, shown]);

  if (state === "off") return null;
  const g = hallOf(view);
  const status = warm > 0.45 ? STR.last : g ? STR.hall(HALLS[g].title) : view === "gate" ? STR.gate : STR.plaza;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={status}
      className="gk-boot fixed inset-0 z-55 grid place-items-center text-white"
      style={{ opacity: state === "fading" ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out`, pointerEvents: state === "fading" ? "none" : "auto" }}
    >
      <div className="gk-boot-sweep pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col items-center">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" width={44} height={44} className="size-11 rounded-xl shadow-lg" />
          <div className="leading-none">
            <p className="text-2xl font-black tracking-tight">{STR.brand}</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.32em] text-[#7CC4FF]">{STR.sub}</p>
          </div>
        </div>
        <div className="mt-7 h-0.75 w-56 overflow-hidden rounded-full bg-white/12">
          <div className="h-full rounded-full bg-linear-to-r from-[#3DA9FC] to-[#FFC83D]" style={{ transform: `scaleX(${value.toFixed(3)})`, transformOrigin: "left", transition: "transform 220ms ease-out" }} />
        </div>
        <p className="mt-3 text-xs font-semibold text-white/70">{status}</p>
        {slow && <p className="gk-fade-up mt-5 max-w-xs text-center text-xs text-white/55">{STR.tip}</p>}
      </div>
      {/* layout skeletons where the real UI will appear, so nothing jumps when it arrives */}
      {view === "gate" ? (
        <>
          <div className="gk-skel absolute left-[max(12px,env(safe-area-inset-left))] top-3 h-8 w-64 rounded-full phone:w-52" />
          <div className="absolute right-[max(16px,env(safe-area-inset-right))] top-1/2 hidden w-[min(340px,40vw)] -translate-y-1/2 flex-col gap-3 rounded-[28px] border border-white/10 bg-white/[0.04] p-5 sm:flex phone:flex phone:w-[min(300px,42vw)] phone:gap-2 phone:p-3">
            <div className="gk-skel relative h-4 w-24 rounded-full" />
            <div className="gk-skel relative h-6 w-48 rounded-lg" />
            <div className="gk-skel relative h-11 w-full rounded-xl" />
            <div className="gk-skel relative h-11 w-full rounded-xl" />
            <div className="gk-skel relative h-3 w-40 rounded-full" />
          </div>
        </>
      ) : (
        <>
          <div className="gk-skel absolute left-3 top-3 h-16 w-52 rounded-2xl phone:h-11 phone:w-40" />
          <div className="gk-skel absolute left-1/2 top-3 h-8 w-48 -translate-x-1/2 rounded-full" />
          <div className="gk-skel absolute right-3 top-3 h-12 w-36 rounded-2xl phone:h-8 phone:w-28" />
          <div className="gk-skel absolute bottom-[max(14px,env(safe-area-inset-bottom))] left-[max(14px,env(safe-area-inset-left))] size-28 rounded-full phone:size-20" />
        </>
      )}
    </div>
  );
}

/**
 * Root-layout host of the persistent 3D stage (P1-WLD-05). Pages no longer own a <Canvas>: the route only says
 * which view is on screen (/gate, /world, /room/<game>; anything else hides and pauses the canvas while the areas
 * stay warm). Walking through a door switches the view first and updates the URL after, so the picture never
 * waits for the router. Cold loads boot behind a crisp boot screen (never a haze or a half-drawn canvas).
 */
export function SceneHost() {
  const path = usePathname();
  const router = useRouter();
  const pathView = viewForPath(path);
  const [on, setOn] = useState(false);
  const view = useStage((s) => s.view);

  useEffect(() => {
    stageNav.push = (href) => router.push(href);
    stageNav.replace = (href) => router.replace(href);
  }, [router]);

  // the route decides the view on deep links, reloads and back / forward (a crossing has already set it)
  useEffect(() => {
    if (pathView) setOn(true);
    if (useStage.getState().view !== pathView) useStage.getState().show(pathView);
  }, [pathView]);

  return (
    <>
      {on && (
        <div aria-hidden={!view} className="fixed inset-0 z-0 bg-[#0b0d1a]" style={{ visibility: view ? "visible" : "hidden" }}>
          <SceneCanvas />
        </div>
      )}
      <BootScreen pathView={pathView} />
    </>
  );
}
