"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Armchair, Bot, ChevronLeft, Loader2, Star, Users, X, Zap } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { useMatch, STAKES } from "@/lib/match-store";
import { quickMatchJoin, quickMatchLeave } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { useRoom } from "./room-store";
import { getUp, sitDown } from "./RoomPlayer";
import type { HallLayout } from "./layouts";

const glass = "rounded-2xl border border-white/20 bg-[#151935]/85 text-white shadow-2xl backdrop-blur-xl";

/** Hall HUD: room title, sit prompt, seat panel (practice / find opponent here / stand). */
export function RoomOverlay({ layout }: { layout: HallLayout }) {
  const router = useRouter();
  const { nearSeat, seated } = useRoom();
  const seats = useWorld((s) => s.seats);
  const you = useWorld((s) => s.you);
  const seatTaken = useWorld((s) => s.seatTaken);
  const others = useWorld((s) => Object.keys(s.players).length);
  const quick = useMatch((s) => s.quick);
  const authed = useSession((s) => s.status === "authenticated");
  const stars = useSession((s) => s.me?.stars ?? 0);
  const [stake, setStake] = useState(25);
  const livePlay = layout.game !== "pool"; // live Pool needs the deterministic physics engine (P1-POOL-01)

  // the server refused our chair (someone sat first) → stand back up
  useEffect(() => {
    if (seated && seats[seated] && seats[seated] !== you) getUp();
  }, [seatTaken, seats, seated, you]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.code !== "KeyE") return;
      const r = useRoom.getState();
      if (r.seated) getUp();
      else if (r.nearSeat) sitDown(r.nearSeat);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const table = seated ? layout.seats.find((s) => s.id === seated)?.table : null;
  const tableNo = table ? Number(table.slice(1)) + 1 : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-white">
      {/* room title + back */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2">
        <Link href="/world" className={`${glass} pointer-events-auto flex items-center gap-1 px-3 py-2 text-sm font-semibold`}>
          <ChevronLeft size={16} /> Plaza
        </Link>
        <div className={`${glass} flex items-center gap-2 px-4 py-2 text-sm font-bold`}>
          <span className="size-2.5 rounded-full" style={{ background: layout.color }} />
          {layout.title}
          <span className="flex items-center gap-1 font-semibold text-white/60">
            <Users size={14} /> {others + 1}
          </span>
        </div>
      </div>

      {/* sit prompt */}
      {nearSeat && !seated && (
        <div className="absolute bottom-[34%] left-1/2 -translate-x-1/2">
          <button type="button" onClick={() => sitDown(nearSeat)} className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/30 bg-[#22266E]/90 py-2 pl-2 pr-5 text-lg font-bold shadow-2xl backdrop-blur-md active:scale-95">
            <span className="grid size-9 place-items-center rounded-full bg-white text-base font-black text-[#22266E]">E</span>
            <Armchair size={20} /> Sit down
          </button>
        </div>
      )}

      {/* seat panel */}
      {seated && (
        <div className={`${glass} pointer-events-auto absolute bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 w-[min(520px,92vw)] -translate-x-1/2 p-4`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-extrabold">
              Table {tableNo} · {layout.title}
            </p>
            <button type="button" onClick={getUp} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold">
              <X size={14} /> Stand up
            </button>
          </div>
          {quick.status === "waiting" ? (
            <button type="button" onClick={quickMatchLeave} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-3 font-bold">
              <Loader2 size={18} className="animate-spin" /> Waiting for an opponent at your table… (cancel)
            </button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => router.push(`/play/${layout.game}`)} className="flex items-center justify-center gap-2 rounded-xl bg-white/10 py-3 font-bold hover:bg-white/15">
                <Bot size={18} /> Practice vs AI
              </button>
              {livePlay && authed ? (
                <button type="button" onClick={() => quickMatchJoin(layout.game as "igisoro" | "ludo", stake)} className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold" style={{ background: layout.color }}>
                  <Zap size={18} /> Find an opponent
                </button>
              ) : (
                <div className="grid place-items-center rounded-xl bg-white/5 px-3 py-3 text-center text-xs text-white/60">{livePlay ? "Sign in at the gate to play people" : "Live Pool matches arrive with the server physics engine. Practice now."}</div>
              )}
            </div>
          )}
          {livePlay && authed && quick.status !== "waiting" && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-white/50">Stake</span>
              {STAKES.map((s) => (
                <button key={s} type="button" disabled={s > stars} onClick={() => setStake(s)} className={`flex items-center gap-1 rounded-full px-3 py-1 font-bold disabled:opacity-30 ${stake === s ? "bg-[#7CC4FF] text-[#0b0d1a]" : "bg-white/10"}`}>
                  {s === 0 ? "Friendly" : <>{s} <Star size={11} className="fill-current" /></>}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-white/50">Tip: stand near another player and use Challenge to play them directly.</p>
        </div>
      )}
    </div>
  );
}
