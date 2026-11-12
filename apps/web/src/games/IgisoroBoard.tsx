"use client";
import { useCallback, useRef, useState } from "react";
import type { IgisoroState } from "@gukirana/igisoro";

type Side = 0 | 1;
export type Cell = { side: Side; idx: number };

/** Rows from the viewer's side: opponent outer, opponent inner, my inner, my outer (engine facing rules). */
export function rowsFor(me: Side): Cell[][] {
  const opp = (1 - me) as Side;
  return [
    Array.from({ length: 8 }, (_, c) => ({ side: opp, idx: 8 + c })),
    Array.from({ length: 8 }, (_, c) => ({ side: opp, idx: 7 - c })),
    Array.from({ length: 8 }, (_, c) => ({ side: me, idx: c })),
    Array.from({ length: 8 }, (_, c) => ({ side: me, idx: 15 - c })),
  ];
}

function Seeds({ n }: { n: number }) {
  const shown = Math.min(n, 12);
  return (
    <div className="pointer-events-none absolute inset-[18%] flex flex-wrap content-center items-center justify-center gap-[2px]">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="block size-[22%] rounded-full shadow-[inset_-1px_-2px_2px_rgba(0,0,0,.45)]" style={{ background: `radial-gradient(circle at 35% 30%, #f3e3c3, ${i % 3 ? "#8a5a2b" : "#6e4420"})` }} />
      ))}
    </div>
  );
}

/** Replays sowing events pit by pit (DESIGN-SPEC §11.4). */
export function useSowAnimation(speed: number) {
  const [view, setView] = useState<[number[], number[]] | null>(null);
  const [hl, setHl] = useState<Cell | null>(null);
  const [animating, setAnimating] = useState(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const animate = useCallback(
    (from: IgisoroState, next: IgisoroState) =>
      new Promise<void>((resolve) => {
        setAnimating(true);
        const pits: [number[], number[]] = [[...from.pits[0]], [...from.pits[1]]];
        const ev = next.lastEvents;
        let i = 0;
        const tick = () => {
          const e = ev[i++];
          if (!e) {
            setView(null);
            setHl(null);
            setAnimating(false);
            resolve();
            return;
          }
          if (e.kind === "pickup") {
            pits[e.player][e.pit] = 0;
            setHl({ side: e.player, idx: e.pit });
          } else if (e.kind === "sow") {
            pits[e.player][e.pit]! += 1;
            setHl({ side: e.player, idx: e.pit });
          } else {
            for (const p of e.pits) pits[e.from][p] = 0;
            setHl({ side: e.from, idx: e.pits[0]! });
          }
          setView([[...pits[0]], [...pits[1]]]);
          setTimeout(tick, e.kind === "capture" ? speedRef.current * 4 : speedRef.current);
        };
        tick();
      }),
    [],
  );
  return { view, hl, animating, animate };
}

export function IgisoroBoard({
  pits,
  me,
  legal,
  hl,
  selected,
  onHover,
  onPick,
}: {
  pits: [number[], number[]];
  me: Side;
  legal: number[];
  hl: Cell | null;
  selected: number | null;
  onHover?: (pit: number | null) => void;
  onPick: (pit: number) => void;
}) {
  return (
    <div
      className="aspect-[2/1] w-full max-w-[min(100%,calc((100dvh-150px)*2))] rounded-[28px] border-[6px] border-[#4a2e17] p-[2.2%] shadow-[0_20px_60px_-10px_rgba(0,0,0,.8),inset_0_2px_0_rgba(255,255,255,.15)]"
      style={{ background: "repeating-linear-gradient(95deg,#9a6534 0 18px,#8b5a2d 18px 30px,#a36d3a 30px 44px)" }}
    >
      <div className="grid h-full grid-rows-4 gap-[3%]">
        {rowsFor(me).map((row, r) => (
          <div key={r} className={`grid grid-cols-8 gap-[2%] ${r === 2 ? "border-t-4 border-dashed border-[#B5532A]/60 pt-[1.5%]" : ""}`}>
            {row.map((cell) => {
              const n = pits[cell.side][cell.idx]!;
              const isLegal = cell.side === me && legal.includes(cell.idx);
              const isHl = hl && hl.side === cell.side && hl.idx === cell.idx;
              const isSel = cell.side === me && selected === cell.idx;
              return (
                <button
                  key={`${cell.side}-${cell.idx}`}
                  type="button"
                  disabled={!isLegal}
                  onMouseEnter={() => isLegal && onHover?.(cell.idx)}
                  onMouseLeave={() => onHover?.(null)}
                  onClick={() => onPick(cell.idx)}
                  className={`relative rounded-full transition-all duration-150 ${isLegal ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
                  style={{
                    background: "radial-gradient(circle at 50% 40%, #3b2410 0%, #5a3818 60%, #7a4c22 100%)",
                    boxShadow: isHl ? "0 0 0 3px #FFC83D, 0 0 18px #FFC83D" : isSel ? "0 0 0 3px #22C55E, 0 0 16px #22C55E" : isLegal ? "0 0 0 2px rgba(124,255,170,.55), inset 0 4px 10px rgba(0,0,0,.6)" : "inset 0 4px 10px rgba(0,0,0,.6)",
                  }}
                  aria-label={`${cell.side === me ? "Your" : "Opponent"} pit with ${n} seeds`}
                >
                  <Seeds n={n} />
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-black/70 px-1 text-[10px] font-bold tabular-nums text-white sm:text-xs">{n}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
