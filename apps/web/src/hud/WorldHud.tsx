"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Joystick } from "./Joystick";
import { PORTALS } from "@/world/layout";
import { useWorld } from "@/lib/world-store";
import { sendChat, sendEmote } from "@/lib/realtime";
import { levelForXp, totalXpForLevel, useProfile } from "@/lib/profile-store";
import { xrStore } from "@/world/WorldCanvas";

const EMOTES = [
  { id: 10, icon: "👋", label: "Wave" },
  { id: 11, icon: "💃", label: "Dance" },
  { id: 12, icon: "👏", label: "Clap" },
];

function RoundButton({ icon, label, onPress, onRelease, big, active }: { icon: string; label: string; onPress?: () => void; onRelease?: () => void; big?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPress}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      className={`pointer-events-auto grid ${big ? "size-[72px] text-3xl" : "size-16 text-2xl"} touch-none select-none place-items-center rounded-full border-2 shadow-lg backdrop-blur-md transition active:scale-90 ${
        active ? "border-[#FFC83D] bg-[#22266E]/85 text-white ring-4 ring-[#FFC83D]/40" : "border-white/40 bg-[#22266E]/55 text-white"
      }`}
    >
      {icon}
    </button>
  );
}

export function WorldHud() {
  const router = useRouter();
  const { name, color, xp, stars } = useProfile();
  const level = levelForXp(xp);
  const progress = (xp - totalXpForLevel(level)) / (totalXpForLevel(level + 1) - totalXpForLevel(level));
  const { nearPortal, nearPlayer, players, connected, chat } = useWorld();
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [vr, setVr] = useState(false);
  const [msg, setMsg] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);
  const portal = PORTALS.find((p) => p.id === nearPortal);
  const other = nearPlayer ? players[nearPlayer] : undefined;

  useEffect(() => {
    void navigator.xr?.isSessionSupported("immersive-vr").then(setVr).catch(() => setVr(false));
  }, []);
  useEffect(() => chatEnd.current?.scrollIntoView({ block: "end" }), [chat.length, chatOpen]);

  const emote = (id: number) => {
    useWorld.getState().set({ emote: { id, until: Date.now() + 2500 } });
    sendEmote(id);
    setEmotesOpen(false);
  };
  const interact = () => {
    if (portal?.href) router.push(portal.href);
    else if (other) emote(10);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "KeyE") interact();
      if (e.code === "KeyG") setEmotesOpen((v) => !v);
      if (e.code === "KeyT" || e.code === "Enter") {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setRun = (run: boolean) => {
    const w = useWorld.getState();
    w.set({ input: { ...w.input, run } });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-10 select-none p-[max(12px,env(safe-area-inset-top))_max(12px,env(safe-area-inset-right))_max(12px,env(safe-area-inset-bottom))_max(12px,env(safe-area-inset-left))] text-white">
      {/* top-left profile chip */}
      <div className="pointer-events-auto absolute left-[max(12px,env(safe-area-inset-left))] top-3 flex items-center gap-3 rounded-2xl border border-white/30 bg-[#22266E]/70 py-2 pl-2 pr-4 shadow-xl backdrop-blur-md">
        <div className="relative grid size-12 place-items-center rounded-full" style={{ background: `conic-gradient(#FFC83D ${progress * 360}deg, rgba(255,255,255,.2) 0)` }}>
          <div className="grid size-10 place-items-center rounded-full text-xl" style={{ background: color }}>
            🙂
          </div>
        </div>
        <div className="leading-tight">
          <p className="max-w-[9rem] truncate text-base font-extrabold">{name}</p>
          <p className="text-sm font-semibold text-[#FFC83D]">★ Level {level}</p>
        </div>
      </div>

      {/* top-center breadcrumb */}
      <div className="absolute left-1/2 top-3 hidden -translate-x-1/2 rounded-full bg-[#22266E]/55 px-4 py-1.5 text-sm font-semibold backdrop-blur-md sm:block">
        Gukirana Plaza ·{" "}
        <span className={connected ? "text-[#22C55E]" : "text-white/60"}>
          {connected ? `● ${Object.keys(players).length + 1} online` : "○ solo"}
        </span>
      </div>

      {/* top-right currency + settings */}
      <div className="absolute right-[max(12px,env(safe-area-inset-right))] top-3 flex items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/30 bg-[#22266E]/70 px-4 py-2.5 text-lg font-extrabold tabular-nums shadow-xl backdrop-blur-md" title="Stars: practice currency, no cash value">
          <span className="grid size-7 place-items-center rounded-full bg-[#7CC4FF] text-sm">⭐</span>
          {stars.toLocaleString()}
        </div>
        {vr && (
          <button type="button" onClick={() => void xrStore.enterVR()} className="pointer-events-auto rounded-2xl border border-white/30 bg-[#9B51E0]/80 px-3 py-2.5 text-sm font-bold shadow-xl backdrop-blur-md">
            🥽 Enter VR
          </button>
        )}
        <Link href="/" aria-label="Lobby" className="pointer-events-auto grid size-12 place-items-center rounded-2xl border border-white/30 bg-[#22266E]/70 text-2xl shadow-xl backdrop-blur-md">
          ⚙️
        </Link>
      </div>

      {/* chat */}
      <div className="absolute bottom-[150px] left-[max(12px,env(safe-area-inset-left))] w-[min(360px,45vw)] sm:bottom-40">
        {chatOpen ? (
          <div className="pointer-events-auto flex max-h-[38vh] flex-col rounded-2xl border border-white/20 bg-[#0f1222]/75 backdrop-blur-md">
            <div className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
              {chat.length === 0 && <p className="text-white/50">Say hi to the plaza 👋</p>}
              {chat.map((c, i) =>
                c.system ? (
                  <p key={i} className="text-xs italic text-[#FFC83D]/90">
                    {c.text}
                  </p>
                ) : (
                  <p key={i}>
                    <span className="font-bold" style={{ color: c.color }}>
                      {c.name}:
                    </span>{" "}
                    {c.text}
                  </p>
                ),
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="flex gap-2 border-t border-white/10 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (msg.trim()) sendChat(msg.trim());
                setMsg("");
              }}
            >
              <input
                autoFocus
                value={msg}
                maxLength={200}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setChatOpen(false)}
                placeholder={connected ? "Message the plaza…" : "Offline: start the realtime server"}
                className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/40"
              />
              <button type="button" onClick={() => setChatOpen(false)} className="rounded-lg px-2 text-white/60">
                ✕
              </button>
            </form>
          </div>
        ) : (
          chat.slice(-2).map((c, i) => (
            <p key={i} className="mb-1 w-fit max-w-full truncate rounded-lg bg-[#0f1222]/55 px-2 py-1 text-xs backdrop-blur-sm">
              {c.system ? <span className="italic text-[#FFC83D]">{c.text}</span> : <><b style={{ color: c.color }}>{c.name}:</b> {c.text}</>}
            </p>
          ))
        )}
      </div>

      {/* proximity prompt */}
      {(portal || other) && (
        <div className="absolute bottom-[38%] left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={interact}
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/30 bg-[#22266E]/85 py-2 pl-2 pr-5 text-lg font-bold shadow-2xl backdrop-blur-md active:scale-95"
          >
            <span className="grid size-9 place-items-center rounded-full bg-white text-base font-black text-[#22266E]">E</span>
            {portal ? (portal.href ? `Enter ${portal.label}` : `${portal.label} · ${portal.sub}`) : `Wave to ${other!.name}`}
          </button>
        </div>
      )}

      {/* bottom-left joystick */}
      <div className="absolute bottom-[max(14px,env(safe-area-inset-bottom))] left-[max(14px,env(safe-area-inset-left))]">
        <Joystick />
      </div>

      {/* bottom-right actions */}
      <div className="absolute bottom-[max(14px,env(safe-area-inset-bottom))] right-[max(14px,env(safe-area-inset-right))] flex items-end gap-3">
        <div className="flex flex-col gap-3">
          <RoundButton icon="💬" label="Chat" onPress={() => setChatOpen((v) => !v)} />
        </div>
        <RoundButton icon="🏃" label="Run" onPress={() => setRun(true)} onRelease={() => setRun(false)} />
        <div className="relative">
          {emotesOpen && (
            <div className="pointer-events-auto absolute bottom-20 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl bg-[#22266E]/85 p-2 backdrop-blur-md">
              {EMOTES.map((e) => (
                <button key={e.id} type="button" onClick={() => emote(e.id)} className="grid size-12 place-items-center rounded-xl bg-white/10 text-2xl" aria-label={e.label}>
                  {e.icon}
                </button>
              ))}
            </div>
          )}
          <RoundButton icon="🙋" label="Emote" onPress={() => setEmotesOpen((v) => !v)} />
        </div>
        <RoundButton icon="✋" label="Interact" big active={!!(portal || other)} onPress={interact} />
      </div>

      {/* desktop hint */}
      <p className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 text-xs text-white/70 [@media(pointer:fine)]:block">
        WASD move · Shift run · drag to look · E interact · G emote · T chat
      </p>
    </div>
  );
}
