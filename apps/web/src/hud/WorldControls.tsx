"use client";
import { useEffect } from "react";
import { Lock, Mic, MicOff, Minus, Plus } from "lucide-react";
import { useSession } from "@/lib/session";
import { cameraState } from "@/world/Player";
import { enableVoice, disableVoice, pttDown, pttUp, toggleOpenMic, useVoice } from "@/voice/voice";


const btn = "pointer-events-auto grid size-12 place-items-center rounded-2xl border border-white/25 bg-[#22266E]/65 text-white shadow-xl backdrop-blur-md transition active:scale-90 phone:size-9 phone:rounded-full";

const zoom = (delta: number) => {
  cameraState.distance = Math.min(18, Math.max(2.5, cameraState.distance + delta));
};

/**
 * Right-edge controls: push-to-talk voice (FR-COM-03), voice on/off, camera zoom. (Walking pace is in Settings.)
 * Mic button / V: hold to talk, a quick tap locks the mic open (tap again to unlock). "N can hear you" shows who
 * is in range while you talk. Keyboard: V talk · +/- zoom.
 */
export function WorldControls() {
  const authed = useSession((s) => s.status === "authenticated");
  const { status, transmitting, openMic, selfTalking, connected, hearers } = useVoice();
  const on = status === "on";

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "KeyV" && !e.repeat) pttDown();
      if (e.key === "+" || e.key === "=") zoom(-1.5);
      if (e.key === "-") zoom(1.5);
    };
    const up = (e: KeyboardEvent) => e.code === "KeyV" && pttUp();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);


  return (
    // phone (landscape): one slim row under the Stars pill instead of a column in the middle of the right edge
    <div className="pointer-events-none fixed right-[max(12px,env(safe-area-inset-right))] top-[40%] z-10 flex -translate-y-1/2 flex-col items-end gap-2 phone:top-[48px] phone:translate-y-0 phone:flex-row phone:items-start phone:gap-1.5">
      {/* voice */}
      {authed && (
        <div className="flex flex-col items-end gap-2 phone:gap-1">
          {!on ? (
            <button type="button" onClick={() => void enableVoice()} className={`${btn} w-auto gap-2 px-3 text-sm font-bold phone:w-auto phone:gap-1 phone:px-2.5 phone:text-xs`} title="Turn on voice chat">
              <MicOff size={16} /> {status === "starting" ? "…" : status === "denied" ? "Mic blocked" : "Voice"}
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label={openMic ? "Mic locked open: tap to turn off" : "Hold to talk, tap to lock the mic open"}
                aria-pressed={transmitting}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  pttDown();
                }}
                onPointerUp={pttUp}
                onPointerCancel={pttUp}
                onContextMenu={(e) => e.preventDefault()}
                className={`${btn} relative size-16 touch-none select-none phone:size-11 ${transmitting ? "border-[#22C55E] bg-[#22C55E]/40 ring-4 ring-[#22C55E]/30" : ""}`}
              >
                <Mic size={24} className={selfTalking ? "animate-pulse" : ""} />
                {openMic && <Lock size={13} className="absolute bottom-1.5 right-1.5 text-[#bff5cf]" />}
              </button>
              {transmitting && (
                <div role="status" className="pointer-events-none rounded-xl bg-[#0f1222]/75 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
                  {hearers === 0 ? "Nobody nearby can hear you" : hearers === 1 ? "1 person can hear you" : `${hearers} people can hear you`}
                </div>
              )}
              <div className="pointer-events-auto flex items-center gap-1 rounded-xl bg-[#0f1222]/70 px-2 py-1 text-[11px] font-semibold text-white/80 backdrop-blur">
                <span className={`size-1.5 rounded-full ${connected.length ? "bg-[#22C55E]" : "bg-white/40"}`} />
                {connected.length} in voice
                <button type="button" onClick={toggleOpenMic} aria-pressed={openMic} className={`ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 ${openMic ? "bg-[#22C55E]/30 text-white" : "bg-white/10"}`} title="Lock the mic open (talk without holding)">
                  <Lock size={11} /> {openMic ? "Open" : "Hold"}
                </button>
                <button type="button" onClick={disableVoice} className="rounded-md bg-white/10 px-1.5 py-0.5" title="Turn voice off">
                  Off
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* zoom (pace lives in Settings) */}
      <div className="flex flex-col gap-2 [@media(max-height:430px)]:flex-row phone:gap-1.5">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(-1.5)} className={btn}>
          <Plus size={20} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1.5)} className={btn}>
          <Minus size={20} />
        </button>
      </div>

    </div>
  );
}
