"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { igisoroBotMove, initIgisoro, legalPits, playIgisoro, type IgisoroState } from "@gukirana/igisoro";
import { GameShell, ResultModal } from "./GameShell";
import { SeedsIcon } from "@/ui/game-icons";
import { IgisoroBoard, useSowAnimation } from "./IgisoroBoard";
import { settlePractice } from "./practice";
import { levelForXp, useProfile } from "@/lib/profile-store";

const ME = 0 as const;
const BOT = 1 as const;

export default function IgisoroGame() {
  const { name, color, xp } = useProfile();
  const [state, setState] = useState<IgisoroState>(() => initIgisoro(["you", "ai"]));
  const [speed, setSpeed] = useState(110);
  const { view, hl, animating, animate } = useSowAnimation(speed);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ won: boolean; starsDelta: number; xp: number } | null>(null);
  const coarse = useRef(false);
  useEffect(() => {
    coarse.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

  const finish = useCallback(async (s: IgisoroState) => {
    if (s.winner === null) return;
    const won = s.winner === ME;
    setResult({ won, ...(await settlePractice("igisoro", won)) });
  }, []);

  const play = useCallback(
    async (pit: number) => {
      if (animating || state.turn !== ME || state.winner !== null || !legalPits(state).includes(pit)) return;
      setSelected(null);
      const next = playIgisoro(state, pit);
      await animate(state, next);
      setState(next);
      void finish(next);
    },
    [animate, animating, finish, state],
  );

  useEffect(() => {
    if (state.turn !== BOT || state.winner !== null || animating) return;
    const t = setTimeout(async () => {
      const next = playIgisoro(state, igisoroBotMove(state, 3));
      await animate(state, next);
      setState(next);
      void finish(next);
    }, 650);
    return () => clearTimeout(t);
  }, [animate, animating, finish, state]);

  const pits = view ?? state.pits;
  const legal = state.turn === ME && !animating ? legalPits(state) : [];
  const preview = selected !== null ? playIgisoro(state, selected) : null;
  const gain = preview ? preview.pits[ME].reduce((a, b) => a + b, 0) - state.pits[ME].reduce((a, b) => a + b, 0) : 0;
  const seeds = (s: 0 | 1) => pits[s].reduce((a, b) => a + b, 0);

  return (
    <GameShell
      title="Igisoro"
      icon={SeedsIcon}
      color="#27AE60"
      pot={0}
      you={{ name: name || "You", color, level: levelForXp(xp), active: state.turn === ME && state.winner === null, detail: <p className="flex items-center gap-1 text-sm font-bold tabular-nums"><SeedsIcon size={14} /> {seeds(ME)} seeds</p> }}
      opponents={[{ name: "Umukuru AI", color: "#B5532A", level: 12, isBot: true, active: state.turn === BOT && state.winner === null, detail: <p className="flex items-center gap-1 text-sm font-bold tabular-nums"><SeedsIcon size={14} /> {seeds(BOT)} seeds</p> }]}
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
      <IgisoroBoard
        pits={pits}
        me={ME}
        legal={legal}
        hl={hl}
        selected={selected}
        onHover={(p) => !coarse.current && setSelected(p)}
        onPick={(p) => (coarse.current && selected !== p ? setSelected(p) : void play(p))}
      />
      {result && (
        <ResultModal
          {...result}
          summary={result.won ? "The AI has no legal moves left." : "You ran out of legal moves."}
          onRematch={() => {
            setState(initIgisoro(["you", "ai"]));
            setResult(null);
          }}
        />
      )}
    </GameShell>
  );
}
