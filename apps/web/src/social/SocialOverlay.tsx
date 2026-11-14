"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PaperCard } from "@/ui/PaperCard";
import { Armchair, Mic, MicOff, Phone, PhoneOff, Users } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { setCallMuted, useVoice } from "@/voice/voice";
import { answerCall, hangUp } from "@/voice/call";
import { tracks } from "./motion";
import { PersonMenu } from "./PersonMenu";
import { useSocial } from "./social-store";
import { PairInvitePrompt, PairPendingChip, SpotPrompt } from "./ActionPrompts";
import { SO } from "./strings";

/**
 * Screen-space social UI shared by the plaza and the halls: person menu, call bar (incoming / calling / in call),
 * notices ("Aline waved at you"), and the people sheet (everyone here, nearest first).
 */
const glass = "glass-elevated rounded-card";

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
      {peerTalking && <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-success" />}
    </span>
  );
  if (call.status === "incoming")
    return (
      <div role="alertdialog" aria-label={`${peer.name} is calling you`} className="pcard pcard-sm pointer-events-auto !flex-row w-[min(380px,92vw)] items-center gap-3 p-3">
        {dot}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold">{peer.name} is calling you</p>
          <p className="text-xs text-on-glass-muted">Private voice call · {Math.max(0, 30 - Math.floor((now - (call.since ?? now)) / 1000))}s</p>
        </div>
        <button type="button" onClick={() => void answerCall(false)} aria-label="Decline call" className="btn-danger grid size-11 place-items-center rounded-full">
          <PhoneOff size={20} />
        </button>
        <button type="button" onClick={() => void answerCall(true)} aria-label="Accept call" className="btn-success grid size-11 place-items-center rounded-full">
          <Phone size={20} />
        </button>
      </div>
    );
  return (
    <div className={`${glass} pointer-events-auto flex items-center gap-2 py-1.5 pl-1.5 pr-1.5`}>
      {dot}
      <div className="min-w-0 leading-tight">
        <p className="max-w-[10rem] truncate text-sm font-bold">{call.status === "outgoing" ? `Calling ${peer.name}…` : peer.name}</p>
        <p className="text-[11px] text-on-glass-muted">{call.status === "active" ? `Private call · ${mmss(now - (call.since ?? now))}` : "Waiting for an answer"}</p>
      </div>
      {call.status === "active" && (
        <button type="button" onClick={() => setCallMuted(!callMuted)} aria-label={callMuted ? "Unmute my microphone" : "Mute my microphone"} aria-pressed={callMuted} className={`press grid size-10 place-items-center rounded-full ${callMuted ? "btn-danger" : "btn-secondary"}`}>
          {callMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      )}
      <button type="button" onClick={hangUp} aria-label={call.status === "active" ? "End call" : "Cancel call"} className="btn-danger grid size-10 place-items-center rounded-full">
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
        <div key={n.id} className="toast pointer-events-auto flex items-center gap-3 rounded-card px-4 py-2 text-sm font-semibold">
          {n.text}
          {n.action && (
            <button
              type="button"
              onClick={() => {
                n.action!.run();
                useSocial.setState((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) }));
              }}
              className="btn-primary rounded-lg px-2.5 py-1 text-xs font-bold"
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
    <div className="pscrim pointer-events-auto z-30 flex items-start justify-start !bg-black/15 p-3 pt-[72px]" onClick={close}>
      <div role="dialog" aria-label="People here" className="w-[min(340px,90vw)]" onClick={(e) => e.stopPropagation()}>
        <PaperCard size="sm" title={`People here · ${people.length + 1}`} icon={Users} onClose={close} className="max-h-[78vh]" bodyClassName="!p-2.5">
          {people.length === 0 ? (
            <p className="pnote text-xs">{SO.nobodyNow}</p>
          ) : (
            <div className="plist">
              {people.map(({ p, d }) => (
                <button key={p.id} type="button" onClick={() => useSocial.setState({ menu: p.id, peopleOpen: false })} className="prow w-full text-left">
                  <span className="relative grid size-9 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: p.color }}>
                    {p.name.slice(0, 1).toUpperCase()}
                    {talking[p.id] && <Mic size={11} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-success p-0.5 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="prow-title block truncate">{p.name}</span>
                    <span className="prow-sub flex items-center gap-1">
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
          )}
        </PaperCard>
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
