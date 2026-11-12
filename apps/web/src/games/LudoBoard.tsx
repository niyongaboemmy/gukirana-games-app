"use client";
import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { SAFE_SQUARES, type LudoState } from "@gukirana/ludo";
import { BASE_ORIGIN, HOME_COLUMN, SEAT_COLORS, SEAT_NAMES, TRACK_COORDS, tokenCell } from "./ludo-board";
import { SeatShape } from "@/ui/game-icons";

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** Outcome-first die: the face animation is cosmetic, the value always comes from the fair RNG. */
export function Die({ value, rolling, color }: { value: number | null; rolling: boolean; color: string }) {
  const [face, setFace] = useState(1);
  useEffect(() => {
    if (!rolling) return;
    let i = 0;
    const id = setInterval(() => setFace((i++ % 6) + 1), 70);
    return () => clearInterval(id);
  }, [rolling]);
  const v = rolling ? face : (value ?? 1);
  return (
    <div className={`grid size-16 grid-cols-3 grid-rows-3 gap-0.5 rounded-2xl bg-white p-2.5 shadow-[0_8px_20px_-4px_rgba(0,0,0,.6)] ${rolling ? "animate-bounce" : ""}`} style={{ outline: `3px solid ${color}` }} aria-label={`Die showing ${v}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`rounded-full ${PIPS[v]!.includes(i) ? "bg-[#1b1b1b]" : ""}`} />
      ))}
    </div>
  );
}

export function LudoBoard({ state, movable, onMove, myId }: { state: LudoState; movable: number[]; onMove: (token: number) => void; myId: string }) {
  const cells = useMemo(() => {
    const map = new Map<string, { bg: string; star?: boolean }>();
    TRACK_COORDS.forEach(([r, c], i) => map.set(`${r},${c}`, { bg: i % 13 === 0 ? SEAT_COLORS[i / 13]! : "#ffffff", star: SAFE_SQUARES.has(i) && i % 13 !== 0 }));
    HOME_COLUMN.forEach((col, s) => col.forEach(([r, c]) => map.set(`${r},${c}`, { bg: SEAT_COLORS[s]! })));
    return map;
  }, []);
  const all = state.players.flatMap((q) => q.tokens.map((qp, qt) => ({ q, qp, qt, cell: tokenCell(q.seat, qp, qt) })));
  const me = state.players.find((p) => p.id === myId);
  const myTurn = state.players[state.turn]?.id === myId && !state.winner;

  return (
    <div className="relative aspect-square h-full max-h-full w-auto max-w-full overflow-hidden rounded-2xl border-4 border-[#22266E] bg-[#f4efe6] shadow-2xl">
      <div className="grid h-full grid-cols-[repeat(15,1fr)] grid-rows-[repeat(15,1fr)]">
        {Array.from({ length: 225 }, (_, i) => {
          const cell = cells.get(`${Math.floor(i / 15)},${i % 15}`);
          return (
            <div key={i} className="grid place-items-center text-black/30" style={{ background: cell?.bg ?? "transparent", outline: cell ? "1px solid rgba(0,0,0,.12)" : undefined }}>
              {cell?.star && <Star className="size-[60%] fill-current" />}
            </div>
          );
        })}
      </div>
      {BASE_ORIGIN.map(([r, c], s) => (
        <div key={s} className="absolute grid place-items-center rounded-xl" style={{ top: `${(r / 15) * 100}%`, left: `${(c / 15) * 100}%`, width: "40%", height: "40%", background: SEAT_COLORS[s] }}>
          <div className="grid size-[72%] place-items-center rounded-xl bg-white/90 shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-black/25 sm:text-xs">{SEAT_NAMES[s]}</span>
          </div>
        </div>
      ))}
      <div className="absolute" style={{ top: "40%", left: "40%", width: "20%", height: "20%", background: `conic-gradient(from 45deg, ${SEAT_COLORS[1]} 0 90deg, ${SEAT_COLORS[2]} 0 180deg, ${SEAT_COLORS[3]} 0 270deg, ${SEAT_COLORS[0]} 0 360deg)` }} />
      {all.map(({ q: p, qp, qt: t, cell: [r, c] }) => {
        const canMove = p.id === myId && myTurn && movable.includes(t);
        const stack = all.filter((x) => x.cell[0] === r && x.cell[1] === c);
        const k = stack.findIndex((x) => x.q.id === p.id && x.qt === t);
        const off = stack.length > 1 ? (k - (stack.length - 1) / 2) * 0.22 : 0;
        return (
          <button
            key={`${p.id}-${t}`}
            type="button"
            disabled={!canMove}
            onClick={() => onMove(t)}
            className={`absolute grid place-items-center rounded-full border-2 border-white text-white/90 shadow-[0_3px_6px_rgba(0,0,0,.5)] transition-all duration-300 ${canMove ? "z-20 animate-bounce cursor-pointer ring-4 ring-white/80" : "z-10"} ${qp === 56 ? "scale-75" : ""}`}
            style={{ width: "5.2%", height: "5.2%", top: `${((r + 0.5 + off * 0.3) / 15) * 100 - 2.6}%`, left: `${((c + 0.5 + off) / 15) * 100 - 2.6}%`, background: SEAT_COLORS[p.seat] }}
            aria-label={`${SEAT_NAMES[p.seat]} token ${t + 1}${p.id === me?.id ? " (yours)" : ""}`}
          >
            <SeatShape seat={p.seat} size={9} />
          </button>
        );
      })}
    </div>
  );
}

export function SeatLabel({ seat, home }: { seat: number; home: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold">
      <span style={{ color: SEAT_COLORS[seat] }}><SeatShape seat={seat} size={11} /></span>
      {SEAT_NAMES[seat]} · home {home}/4
    </p>
  );
}
