"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Armchair, Mic, MicOff, Phone, PhoneOff, Users, X } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { setCallMuted, useVoice } from "@/voice/voice";
import { answerCall, hangUp } from "@/voice/call";
import { tracks } from "./motion";
import { PersonMenu } from "./PersonMenu";
import { useSocial } from "./social-store";
import { PairInvitePrompt, PairPendingChip, SpotPrompt } from "./ActionPrompts";

/**
 * Screen-space social UI shared by the plaza and the halls: person menu, call bar (incoming / calling / in call),
 * notices ("Aline waved at you"), and the people sheet (everyone here, nearest first).
 */
const glass = "rounded-2xl border border-white/20 bg-[#151935]/90 text-white shadow-2xl backdrop-blur-xl";

function useNow(on: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function CallBar() {
  const call = useSocial((s) => s.call);
  const callMuted = useVoice((s) => s.callMuted);
  const peerTalking = useVoice((s) => s.callPeerTalking);
  const now = useNow(call.status !== "idle");
  if (call.status === "idle" || !call.peer) return null;
  const peer = call.peer;
  const dot = (
    <span className="relative grid size-9 shrink-0 place-items-center rounded-full text-sm font-black" style={{ background: peer.color }}>
      {peer.name.slice(0, 1).toUpperCase()}
      {peerTalking && <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-[#22C55E]" />}
    </span>
  );
  if (call.status === "incoming")
    return (
      <div role="alertdialog" aria-label={`${peer.name} is calling you`} className={`${glass} pointer-events-auto flex w-[min(380px,92vw)] items-center gap-3 p-3`}>
        {dot}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold">{peer.name} is calling you</p>
          <p className="text-xs text-white/60">Private voice call · {Math.max(0, 30 - Math.floor((now - (call.since ?? now)) / 1000))}s</p>
        </div>
        <button type="button" onClick={() => void answerCall(false)} aria-label="Decline call" className="grid size-11 place-items-center rounded-full bg-[#EF4444]">
          <PhoneOff size={20} />
        </button>
        <button type="button" onClick={() => void answerCall(true)} aria-label="Accept call" className="grid size-11 place-items-center rounded-full bg-[#22C55E] text-[#06210f]">
          <Phone size={20} />
        </button>
      </div>
    );
  return (
    <div className={`${glass} pointer-events-auto flex items-center gap-2 py-1.5 pl-1.5 pr-1.5`}>
      {dot}
      <div className="min-w-0 leading-tight">
        <p className="max-w-[10rem] truncate text-sm font-bold">{call.status === "outgoing" ? `Calling ${peer.name}…` : peer.name}</p>
        <p className="text-[11px] text-white/60">{call.status === "active" ? `Private call · ${mmss(now - (call.since ?? now))}` : "Waiting for an answer"}</p>
      </div>
      {call.status === "active" && (
        <button type="button" onClick={() => setCallMuted(!callMuted)} aria-label={callMuted ? "Unmute my microphone" : "Mute my microphone"} aria-pressed={callMuted} className={`grid size-10 place-items-center rounded-full ${callMuted ? "bg-[#EF4444]/80" : "bg-white/15"}`}>
          {callMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      )}
      <button type="button" onClick={hangUp} aria-label={call.status === "active" ? "End call" : "Cancel call"} className="grid size-10 place-items-center rounded-full bg-[#EF4444]">
        <PhoneOff size={18} />
      </button>
    </div>
  );
}

function Notices() {
  const notices = useSocial((s) => s.notices);
  if (!notices.length) return null;
  return (
    <div className="flex flex-col items-center gap-1.5" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`${glass} pointer-events-auto flex items-center gap-3 px-4 py-2 text-sm font-semibold`}>
          {n.text}
          {n.action && (
            <button
              type="button"
              onClick={() => {
                n.action!.run();
                useSocial.setState((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) }));
              }}
              className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold"
            >
              {n.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function PeopleSheet() {
  const open = useSocial((s) => s.peopleOpen);
  const players = useWorld((s) => s.players);
  const seats = useWorld((s) => s.seats);
  const talking = useVoice((s) => s.talking);
  const now = useNow(open, 1000);
  if (!open) return null;
  void now; // refresh distances once a second while open
  const seated = new Set(Object.values(seats));
  const people = Object.values(players)
    .map((p) => ({ p, d: tracks.get(p.id)?.dist ?? 999 }))
    .sort((a, b) => a.d - b.d);
  const close = () => useSocial.setState({ peopleOpen: false });
  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-start justify-start bg-black/20 p-3 pt-[72px]" onClick={close}>
      <div role="dialog" aria-label="People here" className={`${glass} max-h-[78vh] w-[min(320px,90vw)] overflow-y-auto p-2`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 px-2 py-1">
          <Users size={16} />
          <p className="flex-1 text-sm font-extrabold">People here · {people.length + 1}</p>
          <button type="button" onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-lg bg-white/10">
            <X size={16} />
          </button>
        </div>
        {people.length === 0 && <p className="px-2 py-3 text-xs text-white/60">Nobody else is here right now.</p>}
        {people.map(({ p, d }) => (
          <button key={p.id} type="button" onClick={() => useSocial.setState({ menu: p.id, peopleOpen: false })} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/5">
            <span className="relative grid size-8 shrink-0 place-items-center rounded-full text-xs font-black" style={{ background: p.color }}>
              {p.name.slice(0, 1).toUpperCase()}
              {talking[p.id] && <Mic size={11} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[#22C55E] p-0.5 text-white" />}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">{p.name}</span>
              <span className="flex items-center gap-1 text-[11px] text-white/55">
                Lvl {p.level} · {d < 999 ? `${Math.round(d)} m` : "—"}
                {seated.has(p.id) && (
                  <>
                    {" "}
                    · <Armchair size={11} /> seated
                  </>
                )}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SocialOverlay() {
  // portal: the HUD is its own stacking context; the menu / call bar must sit above every other HUD layer
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="text-white">
      <div className="pointer-events-none fixed left-1/2 top-[max(116px,calc(env(safe-area-inset-top)+108px))] z-30 flex -translate-x-1/2 flex-col items-center gap-2">
        <CallBar />
        <PairInvitePrompt />
        <PairPendingChip />
        <Notices />
        <SpotPrompt />
      </div>
      <PeopleSheet />
      <PersonMenu />
    </div>,
    document.body,
  );
}
