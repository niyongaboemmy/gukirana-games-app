"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { igisoroBotMove, initIgisoro, legalPits, playIgisoro, type IgisoroState } from "@gukirana/igisoro";
import { GameShell, ResultModal, TurnBanner } from "./GameShell";
import { SeedsIcon } from "@/ui/game-icons";
import { IgisoroBoard, previewMove, useSowAnimation } from "./IgisoroBoard";
import { settlePractice } from "./practice";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { useGamePrefs } from "./feedback";
import { t } from "./i18n";

const ME = 0 as const;
const BOT = 1 as const;

export function SpeedPicker({ speed, onChange }: { speed: number; onChange: (v: number) => void }) {
  const opts = [
    { v: 180, k: "igisoro.normal" as const },
    { v: 110, k: "igisoro.fast" as const },
    { v: 0, k: "igisoro.instant" as const },
  ];
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-sm font-semibold">{t("igisoro.speed")}</span>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button key={o.v} type="button" aria-pressed={speed === o.v} onClick={() => onChange(o.v)} className={`min-h-10 rounded-full px-3 text-sm font-bold ${speed === o.v ? "bg-primary text-white" : "btn-secondary"}`}>
            {t(o.k)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function IgisoroGame() {
  const { name, color, xp } = useProfile();
  const level = useGamePrefs((s) => s.aiLevel);
  const [state, setState] = useState<IgisoroState>(() => initIgisoro(["you", "ai"]));
  const [speed, setSpeed] = useState(110);
  const { view, hl, hand, captured, lastCapture, animating, animate } = useSowAnimation(speed);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ won: boolean; draw: boolean; starsDelta: number; xp: number } | null>(null);
  const coarse = useRef(false);
  useEffect(() => {
    coarse.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

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
    }, 650);
    return () => clearTimeout(tm);
  }, [animate, animating, finish, level, state]);

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
      menuExtras={() => <SpeedPicker speed={speed} onChange={setSpeed} />}
      footer={
        <p className="min-h-6 text-center text-sm text-on-glass-muted" aria-live="polite">
          {myMove ? (preview ? (coarse.current ? t("igisoro.previewTouch", { gain }) : t("igisoro.preview", { gain })) : t("igisoro.pick")) : state.winner === null && state.turn === BOT ? t("game.aiTurn") : ""}
        </p>
      }
    >
      <IgisoroBoard
        pits={pits}
        me={ME}
        legal={legal}
        hl={hl}
        hand={hand}
        captured={captured}
        preview={preview}
        selected={selected}
        autoFocus={myMove}
        onHover={(p) => (!coarse.current || p !== null) && setSelected(p)}
        onPick={(p) => (coarse.current && selected !== p ? setSelected(p) : void play(p))}
      />
      {lastCapture && <TurnBanner key={lastCapture.id} text={t("igisoro.capture", { n: lastCapture.seeds })} tone="good" />}
      {result && (
        <ResultModal
          {...result}
          summary={result.draw ? "Move limit reached with equal seeds." : result.won ? t("igisoro.youWin") : t("igisoro.aiWins")}
          onRematch={() => {
            setState(initIgisoro(["you", "ai"]));
            setResult(null);
          }}
        />
      )}
    </GameShell>
  );
}
