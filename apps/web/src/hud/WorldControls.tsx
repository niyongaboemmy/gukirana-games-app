"use client";
import { useEffect } from "react";
import { Footprints, Mic, MicOff, Minus, Plus, Radio } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { useSession } from "@/lib/session";
import { cameraState } from "@/world/Player";
import { enableVoice, disableVoice, setTransmitting, toggleOpenMic, useVoice } from "@/voice/voice";

const SPEEDS = [
  { id: "slow", label: "Slow" },
  { id: "normal", label: "Normal" },
  { id: "fast", label: "Fast" },
] as const;

const btn = "pointer-events-auto grid size-12 place-items-center rounded-2xl border border-white/25 bg-[#22266E]/65 text-white shadow-xl backdrop-blur-md transition active:scale-90";

const zoom = (delta: number) => {
  cameraState.distance = Math.min(18, Math.max(2.5, cameraState.distance + delta));
};

/**
 * Right-edge controls: push-to-talk voice (FR-COM-03), voice on/off, camera zoom, walking speed.
 * Keyboard: hold V to talk · +/- zoom.
 */
export function WorldControls() {
  const authed = useSession((s) => s.status === "authenticated");
  const speed = useWorld((s) => s.speed);
  const { status, transmitting, openMic, selfTalking, connected } = useVoice();
  const on = status === "on";

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "KeyV" && !e.repeat) setTransmitting(true);
      if (e.key === "+" || e.key === "=") zoom(-1.5);
      if (e.key === "-") zoom(1.5);
    };
    const up = (e: KeyboardEvent) => e.code === "KeyV" && setTransmitting(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const setSpeed = (s: (typeof SPEEDS)[number]["id"]) => {
    useWorld.getState().set({ speed: s });
    try {
      localStorage.setItem("gk-speed", s);
    } catch {
      /* private mode */
    }
  };

  return (
    <div className="pointer-events-none fixed right-[max(12px,env(safe-area-inset-right))] top-1/2 z-10 flex -translate-y-1/2 flex-col items-end gap-2">
      {/* voice */}
      {authed && (
        <div className="flex flex-col items-end gap-2">
          {!on ? (
            <button type="button" onClick={() => void enableVoice()} className={`${btn} w-auto gap-2 px-3 text-sm font-bold`} title="Turn on voice chat">
              <MicOff size={18} /> {status === "starting" ? "…" : status === "denied" ? "Mic blocked" : "Voice"}
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label="Hold to talk"
                onPointerDown={() => setTransmitting(true)}
                onPointerUp={() => setTransmitting(false)}
                onPointerLeave={() => setTransmitting(false)}
                className={`${btn} size-16 touch-none select-none ${transmitting ? "border-[#22C55E] bg-[#22C55E]/40 ring-4 ring-[#22C55E]/30" : ""}`}
              >
                <Mic size={24} className={selfTalking ? "animate-pulse" : ""} />
              </button>
              <div className="pointer-events-auto flex items-center gap-1 rounded-xl bg-[#0f1222]/70 px-2 py-1 text-[11px] font-semibold text-white/80 backdrop-blur">
                <span className={`size-1.5 rounded-full ${connected.length ? "bg-[#22C55E]" : "bg-white/40"}`} />
                {connected.length} nearby
                <button type="button" onClick={toggleOpenMic} className={`ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 ${openMic ? "bg-[#22C55E]/30 text-white" : "bg-white/10"}`} title="Open mic: talk without holding">
                  <Radio size={11} /> {openMic ? "Open" : "Hold"}
                </button>
                <button type="button" onClick={disableVoice} className="rounded-md bg-white/10 px-1.5 py-0.5" title="Turn voice off">
                  Off
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* zoom */}
      <div className="flex flex-col gap-2">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(-1.5)} className={btn}>
          <Plus size={20} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1.5)} className={btn}>
          <Minus size={20} />
        </button>
      </div>

      {/* walking speed */}
      <div className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-white/25 bg-[#22266E]/65 text-xs font-bold text-white shadow-xl backdrop-blur-md">
        <span className="flex items-center justify-center gap-1 px-2 pt-1.5 text-[10px] uppercase tracking-wide text-white/60">
          <Footprints size={11} /> Pace
        </span>
        {SPEEDS.map((s) => (
          <button key={s.id} type="button" onClick={() => setSpeed(s.id)} className={`px-3 py-1.5 ${speed === s.id ? "bg-white/20" : "hover:bg-white/10"}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
