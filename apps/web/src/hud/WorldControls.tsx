"use client";
import { useEffect } from "react";
import { Loader2, Lock, Mic, MicOff, Minus, Plus } from "lucide-react";
import { useSession } from "@/lib/session";
import { cameraState, MAX_ORBIT } from "@/world/Player";
import { enableVoice, disableVoice, pttDown, pttUp, toggleOpenMic, useVoice } from "@/voice/voice";
import { H } from "./strings";


const btn = "icon-button pointer-events-auto size-12 rounded-card phone:size-9 phone:rounded-full";

const zoom = (delta: number) => {
  cameraState.distance = Math.min(MAX_ORBIT, Math.max(2.5, cameraState.distance + delta));
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
            <button
              type="button"
              onClick={() => void enableVoice()}
              aria-label={status === "denied" ? "Microphone blocked: allow it in the browser to use voice" : "Turn on voice chat"}
              title={status === "denied" ? "Microphone blocked in the browser" : "Turn on voice chat (V to talk)"}
              className={`${btn} relative flex! flex-col items-center justify-center gap-0.5`}
            >
              {status === "starting" ? <Loader2 size={18} className="animate-spin" /> : <MicOff size={18} strokeWidth={1.9} />}
              {/* desktop: a small caption under the icon; phone: icon only (same size as the zoom buttons) */}
              <span className="label text-[9px] leading-none tracking-[0.14em] text-on-glass-muted phone:hidden">{H.voice}</span>
              {status === "denied" && <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger ring-2 ring-ink-900" />}
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
                className={`${btn} relative flex! flex-col items-center justify-center gap-0.5 touch-none select-none ${transmitting ? "border-success! bg-success/35! ring-4 ring-success/25" : ""}`}
              >
                <Mic size={18} strokeWidth={1.9} className={selfTalking ? "animate-pulse" : ""} />
                <span className="label text-[9px] leading-none tracking-[0.14em] text-on-glass-muted phone:hidden">{transmitting ? "Live" : "Talk"}</span>
                {openMic && <Lock size={11} className="absolute right-1 top-1 text-success-soft" />}
              </button>
              {transmitting && (
                <div role="status" className="glass-solid pointer-events-none rounded-xl px-2 py-1 text-[11px] font-bold">
                  {hearers === 0 ? "Nobody nearby can hear you" : hearers === 1 ? "1 person can hear you" : `${hearers} people can hear you`}
                </div>
              )}
              <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-semibold text-on-glass-muted">
                <span className={`size-1.5 rounded-full ${connected.length ? "bg-success" : "bg-white/40"}`} />
                {connected.length} in voice
                <button type="button" onClick={toggleOpenMic} aria-pressed={openMic} className={`ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 ${openMic ? "bg-success/30 text-white" : "btn-secondary"}`} title="Lock the mic open (talk without holding)">
                  <Lock size={11} /> {openMic ? "Open" : "Hold"}
                </button>
                <button type="button" onClick={disableVoice} className="btn-secondary rounded-md px-1.5 py-0.5" title="Turn voice off">
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
