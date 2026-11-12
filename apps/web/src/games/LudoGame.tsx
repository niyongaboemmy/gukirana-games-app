"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { commitSeed, createFairRng, newSeed, type FairRng } from "@gukirana/fairness";
import { initLudo, ludoBotMove, moveToken, movableTokens, rollDice, SAFE_SQUARES, type LudoState } from "@gukirana/ludo";
import { GameShell, Modal, ResultModal } from "./GameShell";
import { PRACTICE_STAKE, settlePractice } from "./practice";
import { BASE_ORIGIN, HOME_COLUMN, SEAT_COLORS, SEAT_NAMES, SEAT_SHAPES, TRACK_COORDS, tokenCell } from "./ludo-board";
import { levelForXp, useProfile } from "@/lib/profile-store";

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function Die({ value, rolling, color }: { value: number | null; rolling: boolean; color: string }) {
  const [face, setFace] = useState(1);
  useEffect(() => {
    if (!rolling) return;
    let i = 0;
    const id = setInterval(() => setFace((i++ % 6) + 1), 70); // animation only; the result comes from the fair RNG
    return () => clearInterval(id);
  }, [rolling]);
  const v = rolling ? face : (value ?? 1);
  return (
    <div className={`grid size-16 grid-cols-3 grid-rows-3 gap-0.5 rounded-2xl bg-white p-2.5 shadow-[0_8px_20px_-4px_rgba(0,0,0,.6)] ${rolling ? "animate-bounce" : ""}`} style={{ outline: `3px solid ${color}` }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`rounded-full ${PIPS[v]!.includes(i) ? "bg-[#1b1b1b]" : ""}`} />
      ))}
    </div>
  );
}

interface Match {
  seed: string;
  commit: string;
  rng: FairRng;
}
const newMatch = (): Match => {
  const seed = newSeed();
  return { seed, commit: commitSeed(seed), rng: createFairRng(seed, [newSeed()], `practice-${Date.now()}`) };
};

export default function LudoGame() {
  const { name, color, xp } = useProfile();
  const [mode, setMode] = useState<2 | 4 | null>(null);
  const [state, setState] = useState<LudoState | null>(null);
  const [match, setMatch] = useState<Match>(newMatch);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<{ won: boolean; starsDelta: number; xp: number } | null>(null);

  const start = (m: 2 | 4) => {
    setMode(m);
    setMatch(newMatch());
    setResult(null);
    setState(initLudo(m === 2 ? [{ id: "you", seat: 0 }, { id: "ai-2", seat: 2 }] : [{ id: "you", seat: 0 }, { id: "ai-1", seat: 1 }, { id: "ai-2", seat: 2 }, { id: "ai-3", seat: 3 }]));
  };

  const current = state?.players[state.turn];
  const myTurn = current?.id === "you" && !state?.winner;
  const movable = state && state.phase === "move" && current ? movableTokens(current, state.dice!) : [];

  const doRoll = useCallback(() => {
    if (!state || rolling) return;
    setRolling(true);
    setTimeout(() => {
      setRolling(false);
      setState((s) => (s ? rollDice(s, match.rng) : s));
    }, 650);
  }, [match.rng, rolling, state]);

  const doMove = useCallback((t: number) => setState((s) => (s && s.phase === "move" ? moveToken(s, t) : s)), []);

  // auto-move when only one token can move (DESIGN-SPEC §11.3), AI turns
  useEffect(() => {
    if (!state || state.winner || rolling) return;
    if (myTurn) {
      if (state.phase === "move" && movable.length === 1) {
        const t = setTimeout(() => doMove(movable[0]!), 900);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => (state.phase === "roll" ? doRoll() : doMove(ludoBotMove(state))), state.phase === "roll" ? 550 : 650);
    return () => clearTimeout(t);
  }, [doMove, doRoll, movable, myTurn, rolling, state]);

  useEffect(() => {
    if (state?.winner && !result) {
      const won = state.winner === "you";
      setResult({ won, ...settlePractice(won) });
    }
  }, [result, state?.winner]);

  const cells = useMemo(() => {
    const map = new Map<string, { bg: string; star?: boolean }>();
    TRACK_COORDS.forEach(([r, c], i) => map.set(`${r},${c}`, { bg: i % 13 === 0 ? SEAT_COLORS[i / 13]! : "#ffffff", star: SAFE_SQUARES.has(i) && i % 13 !== 0 }));
    HOME_COLUMN.forEach((col, s) => col.forEach(([r, c]) => map.set(`${r},${c}`, { bg: SEAT_COLORS[s]! })));
    return map;
  }, []);

  if (!mode || !state) {
    return (
      <GameShell title="Ludo" emoji="🎲" color="#FF8A1F" pot={PRACTICE_STAKE * 2} you={{ name: name || "You", color, level: levelForXp(xp), active: false }} opponents={[]}>
        <Modal>
          <p className="text-center text-xl font-extrabold">🎲 Ludo practice</p>
          <p className="mt-1 text-center text-sm text-white/70">Stake {PRACTICE_STAKE} ⭐ · every dice roll is provably fair</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => start(2)} className="rounded-xl bg-[#FF8A1F] py-3 font-bold">
              1 vs 1
            </button>
            <button type="button" onClick={() => start(4)} className="rounded-xl bg-white/10 py-3 font-bold">
              4 players
            </button>
          </div>
        </Modal>
      </GameShell>
    );
  }

  const seatOf = (id: string) => state.players.find((p) => p.id === id)!.seat;
  const panel = (id: string, label: string, bot: boolean) => {
    const p = state.players.find((x) => x.id === id)!;
    const home = p.tokens.filter((t) => t === 56).length;
    return {
      name: label,
      color: SEAT_COLORS[p.seat]!,
      level: bot ? 8 : levelForXp(xp),
      isBot: bot,
      active: current?.id === id && !state.winner,
      detail: <p className="text-xs font-semibold">{SEAT_SHAPES[p.seat]} {SEAT_NAMES[p.seat]} · 🏠 {home}/4</p>,
    };
  };

  return (
    <GameShell
      title="Ludo"
      emoji="🎲"
      color="#FF8A1F"
      pot={PRACTICE_STAKE * 2}
      fairness={{ commit: match.commit, reveal: state.winner ? match.seed : undefined, rolls: state.rolls }}
      you={{ ...panel("you", name || "You", false) }}
      opponents={state.players.filter((p) => p.id !== "you").map((p) => panel(p.id, `${SEAT_NAMES[p.seat]} AI`, true))}
      footer={
        <div className="flex items-center justify-center gap-4">
          <Die value={state.dice ?? (state.lastEvent?.kind === "roll" ? state.lastEvent.dice : null)} rolling={rolling} color={SEAT_COLORS[current?.seat ?? 0]!} />
          {myTurn && state.phase === "roll" ? (
            <button type="button" onClick={doRoll} disabled={rolling} className="rounded-2xl bg-[#FF8A1F] px-8 py-3 text-lg font-extrabold shadow-lg active:scale-95">
              {rolling ? "Rolling…" : "Roll 🎲"}
            </button>
          ) : (
            <p className="text-sm text-white/70">
              {myTurn ? (movable.length > 1 ? "Tap a glowing token to move" : "Moving…") : `${SEAT_NAMES[current?.seat ?? 0]} AI is playing…`}
              {state.lastEvent?.kind === "pass" && state.lastEvent.reason === "three-sixes" ? " · three 6s, turn lost" : ""}
            </p>
          )}
        </div>
      }
    >
      <div className="relative aspect-square h-full max-h-full w-auto max-w-full overflow-hidden rounded-2xl border-4 border-[#22266E] bg-[#f4efe6] shadow-2xl">
        <div className="grid h-full grid-cols-[repeat(15,1fr)] grid-rows-[repeat(15,1fr)]">
          {Array.from({ length: 225 }, (_, i) => {
            const r = Math.floor(i / 15);
            const c = i % 15;
            const cell = cells.get(`${r},${c}`);
            return (
              <div key={i} className="grid place-items-center text-[10px] text-black/40" style={{ background: cell?.bg ?? "transparent", outline: cell ? "1px solid rgba(0,0,0,.12)" : undefined }}>
                {cell?.star ? "★" : ""}
              </div>
            );
          })}
        </div>
        {/* bases */}
        {BASE_ORIGIN.map(([r, c], s) => (
          <div key={s} className="absolute grid place-items-center rounded-xl" style={{ top: `${(r / 15) * 100}%`, left: `${(c / 15) * 100}%`, width: "40%", height: "40%", background: SEAT_COLORS[s] }}>
            <div className="size-[72%] rounded-xl bg-white/90 shadow-inner" />
          </div>
        ))}
        {/* centre home */}
        <div className="absolute" style={{ top: "40%", left: "40%", width: "20%", height: "20%", background: `conic-gradient(from 45deg, ${SEAT_COLORS[1]} 0 90deg, ${SEAT_COLORS[2]} 0 180deg, ${SEAT_COLORS[3]} 0 270deg, ${SEAT_COLORS[0]} 0 360deg)` }} />
        {/* tokens */}
        {state.players.flatMap((p) =>
          p.tokens.map((pos, t) => {
            const [r, c] = tokenCell(p.seat, pos, t);
            const canMove = p.id === "you" && myTurn && movable.includes(t);
            const stack = state.players.flatMap((q) => q.tokens.map((qp, qt) => ({ q, qp, qt }))).filter(({ q, qp, qt }) => {
              const [rr, cc] = tokenCell(q.seat, qp, qt);
              return rr === r && cc === c;
            });
            const k = stack.findIndex(({ q, qt }) => q.id === p.id && qt === t);
            const off = stack.length > 1 ? (k - (stack.length - 1) / 2) * 0.22 : 0;
            return (
              <button
                key={`${p.id}-${t}`}
                type="button"
                disabled={!canMove}
                onClick={() => doMove(t)}
                className={`absolute grid place-items-center rounded-full border-2 border-white text-[7px] font-black leading-none text-white/90 sm:text-[10px] shadow-[0_3px_6px_rgba(0,0,0,.5)] transition-all duration-300 ${canMove ? "z-20 animate-bounce cursor-pointer ring-4 ring-white/80" : "z-10"}`}
                style={{ width: "5.2%", height: "5.2%", top: `${((r + 0.5 + off * 0.3) / 15) * 100 - 2.6}%`, left: `${((c + 0.5 + off) / 15) * 100 - 2.6}%`, background: SEAT_COLORS[seatOf(p.id)] }}
                aria-label={`${SEAT_NAMES[p.seat]} token ${t + 1}`}
              >
                {SEAT_SHAPES[p.seat]}
              </button>
            );
          }),
        )}
      </div>
      {result && <ResultModal {...result} summary={result.won ? "All four tokens home!" : `${state.winner} brought all tokens home.`} onRematch={() => start(mode)} />}
    </GameShell>
  );
}
