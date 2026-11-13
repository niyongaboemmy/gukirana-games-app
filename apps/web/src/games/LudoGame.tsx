"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { returnLabel, returnPath } from "@/lib/return-point";
import { commitSeed, createFairRng, newSeed, type FairRng } from "@gukirana/fairness";
import { initLudo, ludoBotMove, moveToken, movableTokens, rollDice, type LudoState } from "@gukirana/ludo";
import { GameShell, Modal, ResultModal } from "./GameShell";
import { Die, LudoBoard, SeatLabel } from "./LudoBoard";
import { settlePractice } from "./practice";
import { SEAT_COLORS, SEAT_NAMES } from "./ludo-board";
import { DieIcon } from "@/ui/game-icons";
import { levelForXp, useProfile } from "@/lib/profile-store";

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
      setResult({ won, starsDelta: 0, xp: 0 });
      void settlePractice("ludo", won).then((r) => setResult({ won, ...r }));
    }
  }, [result, state?.winner]);

  if (!mode || !state) {
    return (
      <GameShell title="Ludo" icon={DieIcon} color="#FF8A1F" pot={0} you={{ name: name || "You", color, level: levelForXp(xp), active: false }} opponents={[]}>
        <Modal>
          <p className="text-center text-xl font-extrabold">Ludo practice</p>
          <p className="mt-1 text-center text-sm text-white/70">Practice (no stake) · every dice roll is provably fair</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => start(2)} className="press rounded-xl bg-game-ludo py-3 font-bold">1 vs 1</button>
            <button type="button" onClick={() => start(4)} className="btn-secondary rounded-xl py-3 font-bold">4 players</button>
          </div>
          <Link href={returnPath()} className="mt-3 block text-center text-sm font-semibold text-white/60 hover:text-white">
            {returnLabel()}
          </Link>
        </Modal>
      </GameShell>
    );
  }

  const panel = (id: string, label: string, bot: boolean) => {
    const p = state.players.find((x) => x.id === id)!;
    return { name: label, color: SEAT_COLORS[p.seat]!, level: bot ? 8 : levelForXp(xp), isBot: bot, active: current?.id === id && !state.winner, detail: <SeatLabel seat={p.seat} home={p.tokens.filter((t) => t === 56).length} /> };
  };

  return (
    <GameShell
      title="Ludo"
      icon={DieIcon}
      color="#FF8A1F"
      pot={0}
      fairness={{ commit: match.commit, reveal: state.winner ? match.seed : undefined, rolls: state.rolls }}
      you={panel("you", name || "You", false)}
      opponents={state.players.filter((p) => p.id !== "you").map((p) => panel(p.id, `${SEAT_NAMES[p.seat]} AI`, true))}
      footer={
        <div className="flex items-center justify-center gap-4">
          <Die value={state.dice ?? (state.lastEvent?.kind === "roll" ? state.lastEvent.dice : null)} rolling={rolling} color={SEAT_COLORS[current?.seat ?? 0]!} />
          {myTurn && state.phase === "roll" ? (
            <button type="button" onClick={doRoll} disabled={rolling} className="flex items-center gap-2 press rounded-2xl bg-game-ludo px-8 py-3 text-lg font-extrabold shadow-[inset_0_1px_0_rgb(255_255_255/.3),0_10px_24px_-10px_rgb(255_138_31/.8)]">
              <DieIcon size={20} /> {rolling ? "Rolling…" : "Roll"}
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
      <LudoBoard state={state} movable={myTurn ? movable : []} onMove={doMove} myId="you" />
      {result && <ResultModal {...result} summary={result.won ? "All four tokens home!" : `${state.winner} brought all tokens home.`} onRematch={() => start(mode)} />}
    </GameShell>
  );
}
