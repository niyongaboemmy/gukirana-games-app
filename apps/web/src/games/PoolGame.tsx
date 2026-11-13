"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { commitSeed, createFairRng, newSeed } from "@gukirana/fairness";
import { initPool, inGroup, onTheEight, playShot, poolBotShot, remaining, type Group, type PoolIntent, type PoolState } from "@gukirana/pool";
import { GameShell, PrefToggle, ResultModal } from "./GameShell";
import { PoolBallIcon } from "@/ui/game-icons";
import { settlePractice } from "./practice";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { PoolTable } from "./PoolTable";
import { useGamePrefs } from "./feedback";
import { t } from "./i18n";

const ME = 0 as const;
const AI = 1 as const;

function newGame() {
  const seed = newSeed();
  // the rack shuffle comes from the fair RNG, exactly like a live match
  return { seed, commit: commitSeed(seed), state: initPool(["you", "ai"], createFairRng(seed, [newSeed()], `practice-pool-${seed.slice(0, 8)}`)) };
}

export function groupLabel(s: PoolState, side: 0 | 1) {
  const g: Group = s.groups[side];
  if (!g) return t("pool.openTable");
  if (onTheEight(s, side)) return t("pool.onEight");
  return t("pool.groupLeft", { group: t(g === "solids" ? "pool.solids" : "pool.stripes"), n: remaining(s, g) });
}

/** Group chips: the balls still to pot, so players see their targets at a glance. */
export function GroupBalls({ s, side }: { s: PoolState; side: 0 | 1 }) {
  const g = s.groups[side];
  if (!g) return <p className="text-xs font-semibold">{t("pool.openTable")}</p>;
  const left = s.balls.filter((b) => !b.in && inGroup(b.n, g)).map((b) => b.n);
  return (
    <div>
      <p className="text-xs font-semibold">{groupLabel(s, side)}</p>
      <div className="mt-1 flex flex-wrap gap-0.5" aria-hidden>
        {(left.length ? left : [8]).map((n) => (
          <span key={n} className="num grid size-5 place-items-center rounded-full text-[0.6rem] font-bold text-black ring-1 ring-black/30" style={{ background: n >= 9 ? `linear-gradient(#fff 22%, var(--b) 22% 78%, #fff 78%)` : "var(--b)", ["--b" as string]: n === 8 ? "#111" : ["#f7c600", "#1e5bd8", "#d7262b", "#5b2a86", "#f07f1a", "#178a43", "#7a1f22"][(n - 1) % 8] }}>
            <span className="grid size-3 place-items-center rounded-full bg-white">{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Practice vs AI on the authoritative integer engine (same rules and physics as a live match). */
export default function PoolGame() {
  const { name, color, xp } = useProfile();
  const level = useGamePrefs((s) => s.aiLevel);
  const fullGuide = useGamePrefs((s) => s.fullGuide);
  const [game, setGame] = useState(newGame);
  const s = game.state;
  const [settled, setSettled] = useState(true); // the replay of the last shot finished
  const [result, setResult] = useState<{ won: boolean; starsDelta: number; xp: number } | null>(null);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // panels and messages keep showing the position before the shot until its replay ends (no spoilers)
  const before = useRef<PoolState | null>(null);
  const apply = useCallback((intent: PoolIntent) => {
    setSettled(false);
    setGame((g) => {
      before.current = g.state;
      return { ...g, state: playShot(g.state, intent) };
    });
  }, []);
  const d = !settled && before.current ? before.current : s;

  // the AI shoots once the previous shot has finished playing back
  useEffect(() => {
    if (s.winner !== null || s.turn !== AI || !settled) return;
    aiTimer.current = setTimeout(() => apply(poolBotShot(s, level)), 900);
    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
  }, [apply, level, s, settled]);

  useEffect(() => {
    if (s.winner === null || !settled || result) return;
    const won = s.winner === ME;
    setResult({ won, starsDelta: 0, xp: 0 });
    void settlePractice("pool", won).then((r) => setResult({ won, ...r }));
  }, [result, s.winner, settled]);

  const restart = () => {
    setGame(newGame());
    setResult(null);
    setSettled(true);
  };

  const levels = [
    { v: 1 as const, k: "game.easy" as const },
    { v: 3 as const, k: "game.normal" as const },
    { v: 5 as const, k: "game.hard" as const },
  ];

  return (
    <GameShell
      game="pool"
      title={t("pool.title")}
      icon={PoolBallIcon}
      color="#2F80ED"
      pot={0}
      fairness={{ commit: game.commit, reveal: s.winner !== null ? game.seed : undefined }}
      you={{ name: name || "You", color, level: levelForXp(xp), active: d.turn === ME && d.winner === null, detail: <GroupBalls s={d} side={ME} /> }}
      opponents={[{ name: "Cue AI", color: "#6b7280", level: level * 3, isBot: true, active: d.turn === AI && d.winner === null, detail: <GroupBalls s={d} side={AI} /> }]}
      menuExtras={() => (
        <>
          <PrefToggle k="fullGuide" label="game.aimGuide" />
          <div className="flex items-center justify-between gap-2 rounded-control px-1">
            <span className="text-sm font-semibold">{t("game.difficulty")}</span>
            <div className="flex gap-1">
              {levels.map((l) => (
                <button key={l.v} type="button" aria-pressed={level === l.v} onClick={() => useGamePrefs.getState().set({ aiLevel: l.v })} className={`min-h-10 rounded-full px-3 text-sm font-bold ${level === l.v ? "bg-primary text-white" : "btn-secondary"}`}>
                  {t(l.k)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      footer={<p className="text-center text-xs text-on-glass-muted sm:text-sm">{d.winner === null ? (d.turn === ME ? (d.shots === 0 ? `${t("pool.yourBreak")} · ${t("pool.aimHint")}` : (d.lastShot?.message ?? t("pool.aimHint"))) : t("pool.aiThinking")) : d.lastShot?.message}</p>}
    >
      <PoolTable state={s} mySide={ME} myTurn={s.turn === ME && s.winner === null && settled} fullGuide={fullGuide} names={[name || "You", "Cue AI"]} onShoot={apply} onReplayDone={() => setSettled(true)} />
      {result && <ResultModal {...result} summary={s.lastShot?.message ?? ""} onRematch={restart} />}
    </GameShell>
  );
}
