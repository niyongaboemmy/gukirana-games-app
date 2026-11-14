"use client";
import { useCallback, useEffect, useState } from "react";
import { igisoroBotMove, initIgisoro, legalPits, playIgisoro, type IgisoroState } from "@gukirana/igisoro";
import { GameShell, ResultModal, TurnBanner } from "./GameShell";
import { SeedsIcon } from "@/ui/game-icons";
import { IgisoroBoard, previewMove, useConfirmTap, useSowAnimation } from "./IgisoroBoard";
import { settlePractice } from "./practice";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { animScale, useGamePrefs } from "./feedback";
import { t } from "./i18n";

const ME = 0 as const;
const BOT = 1 as const;

export default function IgisoroGame() {
  const { name, color, xp } = useProfile();
  const level = useGamePrefs((s) => s.aiLevel);
  const [state, setState] = useState<IgisoroState>(() => initIgisoro(["you", "ai"]));
  const autoMove = useGamePrefs((s) => s.autoMove);
  const { view, hl, hand, step, captured, lastCapture, animating, animate } = useSowAnimation();
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ won: boolean; draw: boolean; starsDelta: number; xp: number } | null>(null);
  const confirm = useConfirmTap();

  const finish = useCallback(async (s: IgisoroState) => {
    if (s.winner === null && !s.draw) return;
    const won = s.winner === ME;
    setResult({ won, draw: !!s.draw, ...(await settlePractice("igisoro", won)) });
  }, []);

  const play = useCallback(
    async (pit: number) => {
      if (animating || state.turn !== ME || state.winner !== null || state.draw || !legalPits(state).includes(pit)) return;
      setSelected(null);
      const next = playIgisoro(state, pit);
      await animate(state, next);
      setState(next);
      void finish(next);
    },
    [animate, animating, finish, state],
  );

  useEffect(() => {
    if (state.turn !== BOT || state.winner !== null || state.draw || animating) return;
    const tm = setTimeout(async () => {
      const next = playIgisoro(state, igisoroBotMove(state, level));
      await animate(state, next);
      setState(next);
      void finish(next);
    }, 650 * Math.max(0.3, animScale()));
    return () => clearTimeout(tm);
  }, [animate, animating, finish, level, state]);

  // auto-move when only one pit can be played (settings)
  useEffect(() => {
    if (!autoMove || state.turn !== ME || animating || state.winner !== null || state.draw) return;
    const legal = legalPits(state);
    if (legal.length !== 1) return;
    const tm = setTimeout(() => void play(legal[0]!), 700 * Math.max(0.3, animScale()));
    return () => clearTimeout(tm);
  }, [animating, autoMove, play, state]);

  const pits = view ?? state.pits;
  const myMove = state.turn === ME && !animating && state.winner === null && !state.draw;
  const legal = myMove ? legalPits(state) : [];
  const preview = myMove && selected !== null && legal.includes(selected) ? previewMove(state, selected) : null;
  const seeds = (s: 0 | 1) => pits[s].reduce((a, b) => a + b, 0);
  const gain = preview ? `${preview.gain >= 0 ? "+" : ""}${preview.gain}` : "";

  return (
    <GameShell
      game="igisoro"
      title={t("igisoro.title")}
      icon={SeedsIcon}
      color="#27AE60"
      pot={0}
      you={{ name: name || "You", color, level: levelForXp(xp), active: myMove, detail: <p className="num flex items-center gap-1 text-sm font-bold tabular-nums"><SeedsIcon size={14} /> {t("igisoro.seeds", { n: seeds(ME) })}</p> }}
      opponents={[{ name: "Umukuru AI", color: "#B5532A", level: level * 3, isBot: true, active: state.turn === BOT && state.winner === null && !state.draw, detail: <p className="num flex items-center gap-1 text-sm font-bold tabular-nums"><SeedsIcon size={14} /> {t("igisoro.seeds", { n: seeds(BOT) })}</p> }]}
      footer={
        <p className="min-h-6 text-center text-sm text-on-glass-muted" aria-live="polite">
          {myMove ? (preview ? (confirm ? t("igisoro.previewTouch", { gain }) : t("igisoro.preview", { gain })) : t("igisoro.pick")) : state.winner === null && state.turn === BOT ? t("game.aiTurn") : ""}
        </p>
      }
    >
      <IgisoroBoard
        pits={pits}
        me={ME}
        legal={legal}
        hl={hl}
        hand={hand}
        step={step}
        captured={captured}
        preview={preview}
        selected={selected}
        autoFocus={myMove}
        onHover={(p) => (!confirm || p !== null) && setSelected(p)}
        onPick={(p) => (confirm && selected !== p ? setSelected(p) : void play(p))}
      />
      {lastCapture && <TurnBanner key={lastCapture.id} text={t("igisoro.capture", { n: lastCapture.seeds })} tone="good" />}
      {result && (
        <ResultModal
          {...result}
          summary={result.draw ? t("igisoro.drawSummary") : result.won ? t("igisoro.youWin") : t("igisoro.aiWins")}
          onRematch={() => {
            setState(initIgisoro(["you", "ai"]));
            setResult(null);
          }}
        />
      )}
    </GameShell>
  );
}
