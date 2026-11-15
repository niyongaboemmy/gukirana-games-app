"use client";
import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, Check, Clock, LogOut, ShieldCheck, Star, Trophy, WifiOff } from "lucide-react";
import { DEFAULT_FIGHT_RULES, DEFAULT_GAME_SETTINGS, GAME_NAMES, GAME_RULES_VERSION, isFightGame, rulesOf, type GameId, type MatchRules } from "@gukirana/contracts";
import { PaperCard } from "@/ui/PaperCard";
import { gameOffer, useGameOffer } from "@/lib/games-offer";
import { acceptRules, answerRules, useRules, type RulesMode } from "./rules-store";
import { gameKey, tr } from "./strings";

/** the numbers on the card: the game's live settings (GET /games/offer), else the seeded defaults */
function useRulesNumbers(game: GameId): { rules: MatchRules; stakes: number[]; fee: number } {
  const offer = useGameOffer((s) => s.offer);
  useEffect(() => void useGameOffer.getState().load(), []);
  const g = gameOffer(offer, game);
  const rules = g?.rules ?? rulesOf(DEFAULT_GAME_SETTINGS[game], 0);
  const stakes = g ? g.stakes.map((s) => s.stake) : DEFAULT_GAME_SETTINGS[game].stakes;
  // fees come from the server (packages/money via the API); the card never computes one
  const fee = g?.stakes.reduce((m, s) => Math.max(m, s.fee), 0) ?? 0;
  return { rules, stakes, fee };
}

export function RulesBody({ game, mode }: { game: GameId; mode: RulesMode }) {
  const { rules, stakes, fee } = useRulesNumbers(game);
  const name = GAME_NAMES[game];
  const fight = isFightGame(game);
  const fr = rules.fight ?? DEFAULT_FIGHT_RULES;
  const wait = rules.reconnectSeconds;
  const drops = rules.maxDisconnects ?? 3;
  const budget = rules.reconnectBudgetSeconds ?? (fight ? wait : 2 * wait);
  const sections: { icon: typeof Clock; head: string; body: string[] }[] = [
    { icon: BookOpen, head: tr("rules.h.howTo"), body: [tr(gameKey(game, "howTo"))] },
    { icon: Trophy, head: tr("rules.h.win"), body: [tr(gameKey(game, "win"), { rounds: fr.rounds, roundSecs: fr.roundSeconds })] },
    {
      icon: Clock,
      head: tr("rules.h.time"),
      body: [fight ? tr("rules.time.fight", { idle: fr.idleSeconds, maxTimeouts: rules.maxTimeouts }) : tr("rules.time.turn", { turn: rules.turnSeconds, maxTimeouts: rules.maxTimeouts }), tr("rules.time.match", { maxMin: rules.maxMatchMinutes })],
    },
    { icon: WifiOff, head: tr("rules.h.connection"), body: [tr(fight ? "rules.connection.fight" : "rules.connection.turn", { wait }), tr("rules.connection.budget", { drops, budget })] },
    { icon: LogOut, head: tr("rules.h.leave"), body: [tr("rules.leave.text")] },
    {
      icon: Star,
      head: tr("rules.h.stakes"),
      body: [stakes.length ? tr("rules.stakes.text", { game: name, stakes: stakes.join(", "), fee: fee > 0 ? tr("rules.stakes.feeEach", { fee }) : tr("rules.stakes.feeNone") }) : tr("rules.stakes.none", { game: name })],
    },
    { icon: ShieldCheck, head: tr("rules.h.fair"), body: [tr("rules.fair.text")] },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm pmuted">{tr(mode === "practice" ? "rules.introPractice" : "rules.intro", { game: name })}</p>
      {sections.map((s) => (
        <section key={s.head} className="flex gap-2.5">
          <s.icon size={18} className="mt-0.5 shrink-0 opacity-80" aria-hidden />
          <div>
            <h3 className="font-display text-sm font-bold">{s.head}</h3>
            {s.body.map((b) => (
              <p key={b} className="text-sm leading-snug">
                {b}
              </p>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs pmuted">{tr("rules.version", { v: GAME_RULES_VERSION[game] })}</p>
    </div>
  );
}

/**
 * The rules card (P2-NET-05): one per game, shown before a live match (and once per version before practice). The
 * player ticks "I accept" to continue. House style: PaperCard (cream / dark glass via the paper theme), chocolate
 * buttons, keyboard (Tab, Space on the tick, Enter, Escape = Not now) and touch; scrolls inside on a phone in landscape.
 */
export function RulesCard() {
  const ask = useRules((s) => s.ask);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tickId = useId();

  useEffect(() => {
    setTicked(false);
    setErr(null);
    setBusy(false);
    if (!ask) return;
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input[type=checkbox]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      answerRules(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      opener?.focus?.({ preventScroll: true });
    };
  }, [ask]);

  if (!ask) return null;
  const name = GAME_NAMES[ask.game];
  const go = async () => {
    if (!ticked || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await acceptRules(ask.game, ask.mode);
      answerRules(true);
    } catch {
      setErr(tr("rules.failed"));
      setBusy(false);
    }
  };
  return (
    <div className="pscrim fixed inset-0 z-[70] grid place-items-center p-3 phone:p-2" onClick={() => answerRules(false)}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={tr("rules.title", { game: name })} className="w-full max-w-lg" onClick={(e) => e.stopPropagation()} data-testid="rules-card">
        <PaperCard
          title={tr("rules.title", { game: name })}
          icon={BookOpen}
          onClose={() => answerRules(false)}
          closeLabel={tr("rules.cancel")}
          className="max-h-[92dvh]"
          bodyClassName="max-h-[56dvh] overflow-y-auto phone:max-h-[48dvh]"
          footer={
            <div className="flex w-full flex-col gap-2">
              <label htmlFor={tickId} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-semibold">
                <input id={tickId} type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ticked ? void go() : setTicked(true))} className="size-5 shrink-0 accent-[#7a4e33]" />
                {tr("rules.accept")}
              </label>
              {err && (
                <p role="alert" className="pnote text-xs! font-semibold">
                  {err}
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" className="pbtn pbtn-leather flex-1" onClick={() => answerRules(false)}>
                  {tr("rules.cancel")}
                </button>
                <button type="button" className="pbtn pbtn-primary flex-1" disabled={!ticked || busy} onClick={() => void go()}>
                  <Check size={18} /> {busy ? tr("rules.saving") : tr("rules.continue")}
                </button>
              </div>
            </div>
          }
        >
          <RulesBody game={ask.game} mode={ask.mode} />
        </PaperCard>
      </div>
    </div>
  );
}
