"use client";
import { useState } from "react";
import { Check, ChevronsUp, Clapperboard, Copy, DoorOpen, RotateCcw, ShieldCheck, Square, Star, Swords, Trophy, X } from "lucide-react";
import type { BoxingOutcome } from "@gukirana/contracts";
import { PaperCard } from "@/ui/PaperCard";
import { accuracy, judgeGoal, levelGoal, type FightStats, type GoalResult, type LevelGoal } from "./outcome";
import { ft, methodKey, type FgKey } from "./strings";
import { foulText, fst, methodText, tiebreakText } from "./scoring-strings";
import { playHighlights, stopReplay, useReplay } from "./replay";

/**
 * The end of a fight, unmistakable (P3-FGT-09): a big WIN / LOSS / DRAW / NO CONTEST banner with the method, for
 * practice a PASS / FAIL against the level goal with stars and what to improve, the punch stats side by side, every
 * judge's card, a replay of the deciding moments and the next actions; the fight record (id + state hash) so a player
 * or a witness can check it. Spectators get the same card from the neutral side (`me` = null, no goal, no actions).
 * Laid out in two columns on wide / landscape screens, one scrolling column on narrow ones.
 */
export type Verdict = "win" | "loss" | "draw" | "nc" | "void";
export function verdictOf(r: BoxingOutcome, me: 0 | 1 | null): Verdict {
  const method = (r as { method?: string }).method;
  if (method === "DQ" && r.winner === null) return "nc";
  if (r.decision === "void") return "void";
  if (r.winner === null) return "draw";
  if (me === null) return "win";
  return r.winner === me ? "win" : "loss";
}

function methodLine(r: BoxingOutcome): string {
  const x = r as BoxingOutcome & { method?: string; dqFoul?: string; tiebreak?: string };
  if (!x.method) return ft(methodKey(undefined, r.decision));
  let t = fst(methodText(x.method as never));
  if (x.method === "DQ" && x.dqFoul) t += ` · ${fst("method.dqBy", { foul: fst(foulText(x.dqFoul as never)) })}`;
  if (x.tiebreak) t += ` · ${fst(tiebreakText(x.tiebreak as never))}`;
  return t;
}

const TONE: Record<Verdict, { bg: string; fg: string }> = {
  win: { bg: "linear-gradient(135deg,#166534,#15803d)", fg: "#fff" },
  loss: { bg: "linear-gradient(135deg,#7f1d1d,#b42318)", fg: "#fff" },
  draw: { bg: "linear-gradient(135deg,#3f3a36,#5a524b)", fg: "#fff" },
  nc: { bg: "linear-gradient(135deg,#3f3a36,#5a524b)", fg: "#fff" },
  void: { bg: "linear-gradient(135deg,#3f3a36,#5a524b)", fg: "#fff" },
};

function Banner({ r, me, names }: { r: BoxingOutcome; me: 0 | 1 | null; names: [string, string] }) {
  const v = verdictOf(r, me);
  const title =
    v === "nc" ? ft("result.noContest") : v === "void" ? ft("result.void") : v === "draw" ? ft("result.draw") : me === null ? ft("watch.winner", { name: names[r.winner ?? 0] }) : v === "win" ? ft("result.youWin") : ft("result.youLose");
  const votes = (r as { votes?: (0 | 1 | null)[] }).votes;
  const w = r.winner;
  const forW = w !== null && votes ? votes.filter((x) => x === w).length : 0;
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl px-4 py-3 text-center" style={{ background: TONE[v].bg, color: TONE[v].fg }} data-verdict={v} role="status" aria-live="assertive">
      <Trophy size={22} aria-hidden className={v === "win" ? "" : "opacity-60"} />
      <span className="font-display text-4xl font-black uppercase leading-none tracking-wide phone:text-3xl">{title}</span>
      <span className="text-sm font-bold opacity-95">
        {v === "nc" ? ft("result.noContestSub") : `${ft("result.method")} ${methodLine(r)}`}
        {votes?.length && w !== null ? ` · ${ft("round.votes", { a: forW, n: votes.length })}` : ""}
      </span>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5" aria-label={ft("result.starsLabel", { n })}>
      {[0, 1, 2].map((i) => (
        <Star key={i} size={22} className={i < n ? "fill-[#c8963e] text-[#c8963e]" : "text-black/25 dark:text-white/25"} />
      ))}
    </span>
  );
}

function GoalBlock({ goal, res }: { goal: LevelGoal; res: GoalResult }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border-2 p-3 ${res.pass ? "border-[var(--plus)]" : "border-[var(--minus)]"}`} data-goal={res.pass ? "pass" : "fail"}>
      <div className="flex items-center gap-2">
        <span className={`grid size-9 place-items-center rounded-full text-white ${res.pass ? "bg-[var(--plus)]" : "bg-[var(--minus)]"}`}>{res.pass ? <Check size={20} /> : <X size={20} />}</span>
        <span className="font-display text-3xl font-black uppercase leading-none" style={{ color: res.pass ? "var(--plus)" : "var(--minus)" }}>
          {ft(res.pass ? "result.pass" : "result.fail")}
        </span>
        <span className="ml-auto">
          <Stars n={res.stars} />
        </span>
      </div>
      <p className="text-sm font-semibold">
        <span className="font-bold">{ft("result.goal")}: </span>
        {ft(`result.goal.${goal.kind}` as FgKey, { n: goal.n })} · {ft("result.progress", res.progress)}
      </p>
      {res.tips.length > 0 && (
        <div className="text-xs">
          <span className="font-bold">{ft(res.pass && res.tips[0] === "tip.nextLevel" ? "result.next" : "result.improve")}: </span>
          {res.tips.map((t) => ft(t as FgKey)).join(" ")}
        </div>
      )}
    </div>
  );
}

function StatsTable({ stats, me, r }: { stats: FightStats; me: 0 | 1; r: BoxingOutcome }) {
  const a = stats.sides[me];
  const b = stats.sides[1 - me]!;
  const rows: [string, string, string][] = [
    [ft("hud.points"), String(r.points[me]), String(r.points[1 - me])],
    [ft("result.thrown"), String(a.thrown), String(b.thrown)],
    [ft("result.landedPct"), `${a.landed} (${accuracy(a)}%)`, `${b.landed} (${accuracy(b)}%)`],
    [ft("result.powerLanded"), String(a.powerLanded), String(b.powerLanded)],
    [ft("result.knockdowns"), String(r.knockdowns[1 - me]), String(r.knockdowns[me])],
    [ft("result.fouls"), String((r as { warnings?: [number, number] }).warnings?.[me] ?? a.warnings), String((r as { warnings?: [number, number] }).warnings?.[1 - me] ?? b.warnings)],
  ];
  return (
    <table className="w-full text-sm tabular-nums" aria-label={ft("result.stats")}>
      <thead>
        <tr className="text-[11px] uppercase tracking-wide opacity-70">
          <th className="text-left font-bold">{ft("result.stats")}</th>
          <th className="w-20 text-right font-bold">{ft("result.you")}</th>
          <th className="w-20 text-right font-bold">{ft("result.them")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, x, y]) => (
          <tr key={k} className="border-t border-black/10 dark:border-white/10">
            <td className="py-0.5 font-semibold">{k}</td>
            <td className="py-0.5 text-right font-bold">{x}</td>
            <td className="py-0.5 text-right">{y}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Card = { round: number; judges: [number, number][]; deductions?: [number, number] };
function JudgesTable({ r, me }: { r: BoxingOutcome; me: 0 | 1 }) {
  const cards = ((r as { cards?: Card[] }).cards ?? []).filter((c) => c.judges?.length);
  const totals = (r as { totals?: [number, number][] }).totals;
  if (!cards.length) return null;
  const n = cards[0]!.judges.length;
  return (
    <table className="w-full text-xs tabular-nums" aria-label={ft("result.judgesTable")}>
      <thead>
        <tr className="text-[11px] uppercase tracking-wide opacity-70">
          <th className="text-left font-bold">{ft("result.judgesTable")}</th>
          {cards.map((c) => (
            <th key={c.round} className="text-right font-bold">
              {ft("hud.liveRound", { n: c.round })}
            </th>
          ))}
          <th className="text-right font-bold">{ft("result.total")}</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: n }, (_, j) => {
          const t = totals?.[j];
          const up = t ? t[me] > t[1 - me]! : false;
          const down = t ? t[me] < t[1 - me]! : false;
          return (
            <tr key={j} className="border-t border-black/10 dark:border-white/10">
              <td className="py-0.5 font-semibold">{ft("result.judge", { n: j + 1 })}</td>
              {cards.map((c) => (
                <td key={c.round} className="py-0.5 text-right">
                  {(c.judges[j]?.[me] ?? 0) - (c.deductions?.[me] ?? 0)}–{(c.judges[j]?.[1 - me] ?? 0) - (c.deductions?.[1 - me] ?? 0)}
                </td>
              ))}
              <td className={`py-0.5 text-right font-black ${up ? "text-[var(--plus)]" : down ? "text-[var(--minus)]" : ""}`}>{t ? `${t[me]}–${t[1 - me]}` : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RecordBlock({ record }: { record: { id: string; hash: string | null; kind: "match" | "practice" } | null }) {
  const [copied, setCopied] = useState(false);
  if (!record) return null;
  const line = `${record.id} · ${record.hash ?? ""}`;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-black/5 p-2 text-[11px] dark:bg-white/5" data-fight-record>
      <div className="flex items-center gap-1.5 font-bold">
        <ShieldCheck size={14} className="text-[var(--plus)]" /> {ft("result.record")}
        <button
          type="button"
          className="pbtn pbtn-secondary ml-auto !min-h-7 !px-2 !py-0.5 !text-[11px]"
          onClick={() => {
            void navigator.clipboard?.writeText(line).then(() => setCopied(true), () => undefined);
          }}
        >
          <Copy size={12} /> {ft(copied ? "result.copied" : "result.copy")}
        </button>
      </div>
      <div className="break-all font-mono">
        <span className="font-sans font-bold">{ft("result.recordId")}: </span>
        {record.id}
      </div>
      <div className="break-all font-mono">
        <span className="font-sans font-bold">{ft("result.recordHash")}: </span>
        {record.hash ?? ft("result.recordPending")}
      </div>
      <div className="opacity-75">{ft(record.kind === "practice" ? "result.recordPractice" : "result.recordNote")}</div>
    </div>
  );
}

function ReplayButton() {
  const count = useReplay((s) => s.count);
  const playing = useReplay((s) => s.playing);
  if (!count) return null;
  return (
    <button type="button" className="pbtn pbtn-secondary flex-1" onClick={() => (playing ? stopReplay() : playHighlights())}>
      {playing ? <Square size={16} /> : <Clapperboard size={18} />} {ft(playing ? "result.highlightsStop" : "result.decidingMoment")}
    </button>
  );
}

export interface ResultActions {
  retry?: () => void;
  nextLevel?: () => void;
  findOpponent?: () => void;
  leave: () => void;
  /** the leave button's words (default "Step out"; spectators: "Close") */
  leaveKey?: FgKey;
}

export function ResultPanel({
  result,
  me,
  names,
  stats,
  practiceLevel,
  record,
  settledLine,
  actions,
}: {
  result: BoxingOutcome;
  /** my side, or null for a spectator */
  me: 0 | 1 | null;
  names: [string, string];
  stats: FightStats | null;
  practiceLevel?: number;
  record: { id: string; hash: string | null; kind: "match" | "practice" } | null;
  settledLine?: React.ReactNode;
  actions?: ResultActions;
}) {
  const goal = practiceLevel !== undefined && me !== null && stats ? levelGoal(practiceLevel) : null;
  const res = goal && stats && me !== null ? judgeGoal(goal, result, stats, me) : null;
  const side = me ?? 0;
  const v = verdictOf(result, me);
  return (
    <div className="pscrim z-40 grid place-items-center p-3 phone:p-1.5" data-fight-result={v}>
      <div role="dialog" aria-modal="true" aria-label={ft("watch.result")} className="w-full max-w-3xl">
        <PaperCard title={ft("watch.result")} icon={Swords} className="max-h-[94dvh]" bodyClassName="!p-3 phone:!p-2">
          <div className="grid gap-3 md:grid-cols-2 phone:grid-cols-2 phone:gap-2">
            <div className="flex flex-col gap-2">
              <Banner r={result} me={me} names={names} />
              {goal && res && <GoalBlock goal={goal} res={res} />}
              {settledLine}
              {actions && (
                <div className="flex flex-wrap gap-2">
                  {actions.retry && (
                    <button type="button" className="pbtn pbtn-primary flex-1" data-autofocus onClick={actions.retry}>
                      <RotateCcw size={18} /> {ft("result.retry")}
                    </button>
                  )}
                  {actions.nextLevel && (
                    <button type="button" className="pbtn pbtn-primary flex-1" onClick={actions.nextLevel}>
                      <ChevronsUp size={18} /> {ft("result.nextLevel")}
                    </button>
                  )}
                  {actions.findOpponent && (
                    <button type="button" className="pbtn pbtn-secondary flex-1" onClick={actions.findOpponent}>
                      <Swords size={18} /> {ft("result.findOpponent")}
                    </button>
                  )}
                  <ReplayButton />
                  <button type="button" className="pbtn pbtn-secondary flex-1" onClick={actions.leave}>
                    <DoorOpen size={18} /> {ft(actions.leaveKey ?? "result.leave")}
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {stats && me !== null && <StatsTable stats={stats} me={side} r={result} />}
              <JudgesTable r={result} me={side} />
              <RecordBlock record={record} />
            </div>
          </div>
        </PaperCard>
      </div>
    </div>
  );
}
