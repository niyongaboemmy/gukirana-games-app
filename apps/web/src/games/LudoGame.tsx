"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { returnLabel, returnPath } from "@/lib/return-point";
import { commitSeed, createFairRng, newSeed, type FairRng } from "@gukirana/fairness";
import { HOME, initLudo, ludoBotMove, moveToken, movableTokens, rollDice, type LudoState } from "@gukirana/ludo";
import { GameShell, Modal, PrefToggle, ResultModal, TurnBanner } from "./GameShell";
import { LudoBoard, LudoControls, SeatLabel, STEP_MS } from "./LudoBoard";
import { settlePractice } from "./practice";
import { SEAT_COLORS, SEAT_NAMES } from "./ludo-board";
import { DieIcon } from "@/ui/game-icons";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { useGamePrefs } from "./feedback";
import { t } from "./i18n";

interface Match {
  seed: string;
  commit: string;
  rng: FairRng;
}
const newMatch = (): Match => {
  const seed = newSeed();
  return { seed, commit: commitSeed(seed), rng: createFairRng(seed, [newSeed()], `practice-${seed.slice(0, 12)}`) };
};

/** How long the last event takes to show (token hops), so the next action waits for it. */
export const eventMs = (s: LudoState) => (s.lastEvent?.kind === "move" ? (s.lastEvent.from === -1 ? 1 : s.lastEvent.to - s.lastEvent.from) * STEP_MS : 0);

/** Banner text for what just happened (no moves, three sixes, capture). */
export function ludoNotice(s: LudoState, nameOf: (id: string) => string): { text: string; tone: "info" | "good" | "bad" } | null {
  const ev = s.lastEvent;
  if (!ev) return null;
  if (ev.kind === "pass" && ev.reason === "three-sixes") return { text: `${nameOf(ev.player)}: ${t("ludo.threeSixes")}`, tone: "bad" };
  if (ev.kind === "roll" && ev.movable.length === 0) return { text: `${nameOf(ev.player)}: ${t("ludo.noMoves", { dice: ev.dice })}`, tone: "info" };
  if (ev.kind === "move" && ev.captured.length) return { text: `${nameOf(ev.player)}: ${t("ludo.captured")}`, tone: "good" };
  return null;
}

export default function LudoGame() {
  const { name, color, xp } = useProfile();
  const autoMove = useGamePrefs((s) => s.autoMove);
  const [mode, setMode] = useState<2 | 4 | null>(null);
  const [state, setState] = useState<LudoState | null>(null);
  const [match, setMatch] = useState<Match>(newMatch);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<{ won: boolean; starsDelta: number; xp: number } | null>(null);
  const [banner, setBanner] = useState<{ id: number; text: string; tone: "info" | "good" | "bad" } | null>(null);
  const bannerId = useRef(0);

  const start = (m: 2 | 4) => {
    setMode(m);
    setMatch(newMatch());
    setResult(null);
    setState(initLudo(m === 2 ? [{ id: "you", seat: 0 }, { id: "ai-2", seat: 2 }] : [{ id: "you", seat: 0 }, { id: "ai-1", seat: 1 }, { id: "ai-2", seat: 2 }, { id: "ai-3", seat: 3 }]));
  };

  const current = state?.players[state.turn];
  const myTurn = current?.id === "you" && !state?.winner;
  const movable = state && state.phase === "move" && current ? movableTokens(current, state.dice!) : [];
  const nameOf = useCallback((id: string) => (id === "you" ? name || "You" : `${SEAT_NAMES[state?.players.find((p) => p.id === id)?.seat ?? 0]} AI`), [name, state?.players]);

  const doRoll = useCallback(() => {
    if (!state || rolling) return;
    setRolling(true);
    setTimeout(() => {
      setRolling(false);
      setState((s) => (s ? rollDice(s, match.rng) : s));
    }, 650);
  }, [match.rng, rolling, state]);
  const doMove = useCallback((tok: number) => setState((s) => (s && s.phase === "move" ? moveToken(s, tok) : s)), []);

  // banners for passes / captures
  useEffect(() => {
    if (!state) return;
    const n = ludoNotice(state, nameOf);
    if (n) setBanner({ id: ++bannerId.current, ...n });
  }, [state?.lastEvent]);

  // AI turns, and your auto-move when only one token can move (menu setting); waits for the hop animation
  useEffect(() => {
    if (!state || state.winner || rolling) return;
    const wait = eventMs(state);
    if (myTurn) {
      if (autoMove && state.phase === "move" && movable.length === 1) {
        const tm = setTimeout(() => doMove(movable[0]!), 700 + wait);
        return () => clearTimeout(tm);
      }
      return;
    }
    const tm = setTimeout(() => (state.phase === "roll" ? doRoll() : doMove(ludoBotMove(state))), (state.phase === "roll" ? 600 : 650) + wait);
    return () => clearTimeout(tm);
  }, [autoMove, doMove, doRoll, movable, myTurn, rolling, state]);

  useEffect(() => {
    if (state?.winner && !result) {
      const won = state.winner === "you";
      const tm = setTimeout(() => {
        setResult({ won, starsDelta: 0, xp: 0 });
        void settlePractice("ludo", won).then((r) => setResult({ won, ...r }));
      }, eventMs(state) + 300);
      return () => clearTimeout(tm);
    }
  }, [result, state]);

  if (!mode || !state) {
    return (
      <GameShell game="ludo" title={t("ludo.title")} icon={DieIcon} color="#FF8A1F" pot={0} you={{ name: name || "You", color, level: levelForXp(xp), active: false }} opponents={[]}>
        <Modal label={t("ludo.mode")}>
          <p className="text-center font-display text-xl font-bold">{t("ludo.mode")}</p>
          <p className="mt-1 text-center text-sm text-on-glass-muted">{t("ludo.modeHint")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" data-autofocus onClick={() => start(2)} className="press min-h-12 rounded-control bg-game-ludo font-bold text-white">
              {t("ludo.oneVsOne")}
            </button>
            <button type="button" onClick={() => start(4)} className="btn-secondary min-h-12 rounded-control font-bold">
              {t("ludo.four")}
            </button>
          </div>
          <Link href={returnPath()} className="mt-3 block min-h-10 text-center text-sm font-semibold text-on-glass-muted hover:text-white">
            {returnLabel()}
          </Link>
        </Modal>
      </GameShell>
    );
  }

  const panel = (id: string, label: string, bot: boolean) => {
    const p = state.players.find((x) => x.id === id)!;
    return { name: label, color: SEAT_COLORS[p.seat]!, level: bot ? 8 : levelForXp(xp), isBot: bot, active: current?.id === id && !state.winner, detail: <SeatLabel seat={p.seat} home={p.tokens.filter((x) => x === HOME).length} /> };
  };
  const hint = myTurn ? (movable.length > 1 || !autoMove ? t("ludo.pickToken") : t("ludo.moving")) : t("game.theirTurn", { name: nameOf(current?.id ?? "") });

  return (
    <GameShell
      game="ludo"
      title={t("ludo.title")}
      icon={DieIcon}
      color="#FF8A1F"
      pot={0}
      fairness={{ commit: match.commit, reveal: state.winner ? match.seed : undefined, rolls: state.rolls }}
      you={panel("you", name || "You", false)}
      opponents={state.players.filter((p) => p.id !== "you").map((p) => panel(p.id, `${SEAT_NAMES[p.seat]} AI`, true))}
      menuExtras={() => <PrefToggle k="autoMove" label="game.autoMove" />}
      footer={<LudoControls die={state.dice ?? (state.lastEvent?.kind === "roll" ? state.lastEvent.dice : null)} rolling={rolling} color={SEAT_COLORS[current?.seat ?? 0]!} canRoll={!!myTurn && state.phase === "roll"} onRoll={doRoll} hint={hint} />}
    >
      <LudoBoard state={state} movable={myTurn ? movable : []} onMove={doMove} myId="you" />
      {banner && <TurnBanner key={banner.id} text={banner.text} tone={banner.tone} />}
      {result && <ResultModal {...result} summary={result.won ? "All four tokens home!" : `${nameOf(state.winner ?? "")} brought all tokens home.`} onRematch={() => start(mode)} />}
    </GameShell>
  );
}
