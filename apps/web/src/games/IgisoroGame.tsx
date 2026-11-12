"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { igisoroBotMove, initIgisoro, legalPits, playIgisoro, type IgisoroState } from "@gukirana/igisoro";
import { GameShell, ResultModal } from "./GameShell";
import { PRACTICE_STAKE, settlePractice } from "./practice";
import { levelForXp, useProfile } from "@/lib/profile-store";

const ME = 0 as const;
const BOT = 1 as const;
type Cell = { side: 0 | 1; idx: number };

/** Board layout from my point of view (see engine facing rules). */
const ROWS: Cell[][] = [
  Array.from({ length: 8 }, (_, c) => ({ side: BOT, idx: 8 + c })), // opponent outer
  Array.from({ length: 8 }, (_, c) => ({ side: BOT, idx: 7 - c })), // opponent inner
  Array.from({ length: 8 }, (_, c) => ({ side: ME, idx: c })), // my inner
  Array.from({ length: 8 }, (_, c) => ({ side: ME, idx: 15 - c })), // my outer
];

function Seeds({ n }: { n: number }) {
  const shown = Math.min(n, 12);
  return (
    <div className="pointer-events-none absolute inset-[18%] flex flex-wrap content-center items-center justify-center gap-[2px]">
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className="block size-[22%] rounded-full shadow-[inset_-1px_-2px_2px_rgba(0,0,0,.45)]"
          style={{ background: `radial-gradient(circle at 35% 30%, #f3e3c3, ${i % 3 ? "#8a5a2b" : "#6e4420"})` }}
        />
      ))}
    </div>
  );
}

export default function IgisoroGame() {
  const { name, color, xp } = useProfile();
  const [state, setState] = useState<IgisoroState>(() => initIgisoro(["you", "ai"]));
  const [view, setView] = useState<[number[], number[]]>(state.pits);
  const [hl, setHl] = useState<Cell | null>(null);
  const [animating, setAnimating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ won: boolean; starsDelta: number; xp: number } | null>(null);
  const [speed, setSpeed] = useState(110);
  const coarse = useRef(false);

  useEffect(() => {
    coarse.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

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
            setView(next.pits);
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
          setTimeout(tick, e.kind === "capture" ? speed * 4 : speed);
        };
        tick();
      }),
    [speed],
  );

  const finish = useCallback((s: IgisoroState) => {
    if (s.winner === null) return;
    const won = s.winner === ME;
    setResult({ won, ...settlePractice(won) });
  }, []);

  const play = useCallback(
    async (pit: number) => {
      if (animating || state.turn !== ME || state.winner !== null || !legalPits(state).includes(pit)) return;
      setSelected(null);
      const next = playIgisoro(state, pit);
      await animate(state, next);
      setState(next);
      finish(next);
    },
    [animate, animating, finish, state],
  );

  // AI turn (practice only)
  useEffect(() => {
    if (state.turn !== BOT || state.winner !== null || animating) return;
    const t = setTimeout(async () => {
      const next = playIgisoro(state, igisoroBotMove(state, 3));
      await animate(state, next);
      setState(next);
      finish(next);
    }, 650);
    return () => clearTimeout(t);
  }, [animate, animating, finish, state]);

  const rematch = () => {
    const s = initIgisoro(["you", "ai"]);
    setState(s);
    setView(s.pits);
    setResult(null);
  };

  const legal = state.turn === ME && !animating ? legalPits(state) : [];
  const preview = selected !== null ? playIgisoro(state, selected) : null;
  const gain = preview ? preview.pits[ME].reduce((a, b) => a + b, 0) - state.pits[ME].reduce((a, b) => a + b, 0) : 0;
  const mySeeds = view[ME].reduce((a, b) => a + b, 0);
  const aiSeeds = view[BOT].reduce((a, b) => a + b, 0);

  return (
    <GameShell
      title="Igisoro"
      emoji="🌰"
      color="#27AE60"
      pot={PRACTICE_STAKE * 2}
      you={{ name: name || "You", color, level: levelForXp(xp), active: state.turn === ME && state.winner === null, detail: <p className="text-sm font-bold tabular-nums">🌰 {mySeeds} seeds</p> }}
      opponents={[{ name: "Umukuru AI", color: "#B5532A", level: 12, isBot: true, active: state.turn === BOT && state.winner === null, detail: <p className="text-sm font-bold tabular-nums">🌰 {aiSeeds} seeds</p> }]}
      footer={
        <div className="flex items-center justify-center gap-3 text-xs text-white/70">
          <span>{state.turn === ME ? (selected !== null ? `Preview: ${gain >= 0 ? "+" : ""}${gain} seeds · tap again to play` : "Your move: pick a pit with 2+ seeds") : "AI is thinking…"}</span>
          <label className="flex items-center gap-1">
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded bg-white/10 px-1 py-0.5">
              <option value={180}>Normal</option>
              <option value={110}>Fast</option>
              <option value={30}>Instant</option>
            </select>
          </label>
        </div>
      }
    >
      <div
        className="aspect-[2/1] w-full max-w-[min(100%,calc((100dvh-150px)*2))] rounded-[28px] border-[6px] border-[#4a2e17] p-[2.2%] shadow-[0_20px_60px_-10px_rgba(0,0,0,.8),inset_0_2px_0_rgba(255,255,255,.15)]"
        style={{ background: "repeating-linear-gradient(95deg,#9a6534 0 18px,#8b5a2d 18px 30px,#a36d3a 30px 44px)" }}
      >
        <div className="grid h-full grid-rows-4 gap-[3%]">
          {ROWS.map((row, r) => (
            <div key={r} className={`grid grid-cols-8 gap-[2%] ${r === 2 ? "border-t-4 border-dashed border-[#B5532A]/60 pt-[1.5%]" : ""}`}>
              {row.map((cell) => {
                const n = view[cell.side][cell.idx]!;
                const isLegal = cell.side === ME && legal.includes(cell.idx);
                const isHl = hl && hl.side === cell.side && hl.idx === cell.idx;
                const isSel = cell.side === ME && selected === cell.idx;
                return (
                  <button
                    key={`${cell.side}-${cell.idx}`}
                    type="button"
                    disabled={!isLegal}
                    onMouseEnter={() => !coarse.current && isLegal && setSelected(cell.idx)}
                    onMouseLeave={() => !coarse.current && setSelected(null)}
                    onClick={() => (coarse.current && selected !== cell.idx ? setSelected(cell.idx) : void play(cell.idx))}
                    className={`relative rounded-full transition-all duration-150 ${isLegal ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
                    style={{
                      background: "radial-gradient(circle at 50% 40%, #3b2410 0%, #5a3818 60%, #7a4c22 100%)",
                      boxShadow: isHl
                        ? "0 0 0 3px #FFC83D, 0 0 18px #FFC83D"
                        : isSel
                          ? "0 0 0 3px #22C55E, 0 0 16px #22C55E"
                          : isLegal
                            ? "0 0 0 2px rgba(124,255,170,.55), inset 0 4px 10px rgba(0,0,0,.6)"
                            : "inset 0 4px 10px rgba(0,0,0,.6)",
                    }}
                    aria-label={`${cell.side === ME ? "Your" : "AI"} pit with ${n} seeds`}
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
      {result && (
        <ResultModal
          {...result}
          summary={result.won ? "The AI has no legal moves left." : "You ran out of legal moves."}
          onRematch={rematch}
        />
      )}
    </GameShell>
  );
}
