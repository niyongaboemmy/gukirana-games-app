"use client";
import { useEffect } from "react";
import { ArrowDown, ArrowUp, BarChart3, Medal, Trophy, X } from "lucide-react";
import { fightTierOf, type FightRatingChange, type FightStatLine } from "@gukirana/contracts";
import { PaperCard } from "@/ui/PaperCard";
import { ft, type FgKey } from "./strings";
import { RATING_ON, SKILL_ROWS, skillEdge, useFightRating, type SkillPair, type SkillRow } from "./rating";

/**
 * The skill report, the rating change and the leaderboard (P3-FGT-10, docs/FIGHT-GAME-V2.md §6–7). Pure views of
 * server numbers: the skill lines are the fight room's own (signed with the result; practice: the local engine's),
 * the rating comes from the API's settlement.
 */
const fmt = (r: SkillRow, v: number | undefined): string => {
  if (v === undefined) return "–";
  switch (r.fmt) {
    case "pct":
      return ft("skill.pct", { n: v });
    case "secs":
      return ft("skill.secs", { n: v });
    case "perMin":
      return ft("skill.perMin", { n: (v / 10).toFixed(1) });
    case "signed":
      return `${v > 0 ? "+" : ""}${v}`;
    default:
      return String(v);
  }
};

export function SkillReport({ pair, avg }: { pair: SkillPair; avg?: Partial<FightStatLine> | null }) {
  const edge = skillEdge(pair);
  return (
    <div className="flex flex-col gap-1" data-skill-report>
      <div className="flex items-center gap-1.5 text-xs font-bold">
        <BarChart3 size={14} /> {ft("skill.title")}
        <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5 text-[11px] dark:bg-white/10">{ft("skill.better", { n: edge.better, total: edge.total })}</span>
      </div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide opacity-70">
            <th className="text-left font-bold" />
            <th className="w-16 text-right font-bold">{ft("skill.you")}</th>
            <th className="w-16 text-right font-bold">{ft("skill.them")}</th>
            {avg && <th className="w-16 text-right font-bold">{ft("skill.avg")}</th>}
          </tr>
        </thead>
        <tbody>
          {SKILL_ROWS.map((r) => {
            const a = pair.mine[r.k];
            const b = pair.theirs[r.k];
            const won = r.k === "diff" ? a > 0 : r.up ? a > b : a < b;
            const lost = r.k === "diff" ? a < 0 : r.up ? a < b : a > b;
            const mine = avg?.[r.k];
            return (
              <tr key={r.k} className="border-t border-black/10 dark:border-white/10" data-skill={r.k}>
                <td className="py-0.5 font-semibold">{ft(r.label as FgKey)}</td>
                <td className={`py-0.5 text-right font-black ${won ? "text-[var(--plus)]" : lost ? "text-[var(--minus)]" : ""}`}>{fmt(r, a)}</td>
                <td className="py-0.5 text-right">{r.k === "diff" ? fmt(r, -a) : fmt(r, b)}</td>
                {avg && (
                  <td className="py-0.5 text-right opacity-80">
                    {fmt(r, mine)}
                    {mine !== undefined && a !== mine && (r.up ? a > mine : a < mine) ? <ArrowUp size={10} className="ml-0.5 inline text-[var(--plus)]" /> : null}
                    {mine !== undefined && a !== mine && (r.up ? a < mine : a > mine) ? <ArrowDown size={10} className="ml-0.5 inline text-[var(--minus)]" /> : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[10px] opacity-70">{ft("skill.note")}</p>
    </div>
  );
}

export function RatingBlock({ change, practice }: { change: FightRatingChange | null; practice: boolean }) {
  if (!RATING_ON) return null;
  if (practice) return <p className="pnote text-center text-[11px]">{ft("rating.practice")}</p>;
  if (!change) return <p className="pnote text-center text-[11px]">{ft("rating.pending")}</p>;
  const d = change.after - change.before;
  return (
    <div className="flex items-center gap-2 rounded-xl border-2 border-black/10 p-2 dark:border-white/15" data-rating-change={d}>
      <Medal size={22} className="text-[#c8963e]" />
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{ft("rating.title")}</span>
        <span className="font-display text-xl font-black tabular-nums">{ft("rating.change", { before: change.before, after: change.after })}</span>
        <span className="text-[11px] font-semibold">
          {ft(`rating.tier.${change.tierAfter}` as FgKey)}
          {change.provisional ? ` · ${ft("rating.provisional", { n: Math.min(5, change.games) })}` : ""}
        </span>
      </div>
      <span className={`ml-auto font-display text-2xl font-black tabular-nums ${d > 0 ? "text-[var(--plus)]" : d < 0 ? "text-[var(--minus)]" : ""}`}>
        {ft("rating.delta", { sign: d > 0 ? "+" : d < 0 ? "−" : "±", n: Math.abs(d) })}
      </span>
    </div>
  );
}

/** the leaderboard dialog: real players with rated live fights only (the API never lists bots or practice) */
export function Leaderboard() {
  const open = useFightRating((s) => s.open);
  const board = useFightRating((s) => s.board);
  const state = useFightRating((s) => s.boardState);
  const setOpen = useFightRating((s) => s.setOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!RATING_ON || !open) return null;
  const me = board?.me;
  return (
    <div className="pscrim z-50 grid place-items-center p-3 phone:p-1.5" data-leaderboard>
      <div role="dialog" aria-modal="true" aria-label={ft("lb.title")} className="w-full max-w-xl">
        <PaperCard title={ft("lb.title")} icon={Trophy} className="max-h-[92dvh]" bodyClassName="!p-3 phone:!p-2">
          <div className="flex flex-col gap-2">
            {state === "loading" && !board && <p className="text-sm">{ft("lb.loading")}</p>}
            {state === "error" && <p className="text-sm text-[var(--minus)]">{ft("lb.error")}</p>}
            {board && board.rows.length === 0 && <p className="text-sm">{ft("lb.empty")}</p>}
            {board && board.rows.length > 0 && (
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide opacity-70">
                    <th className="w-8 text-left">{ft("lb.rank")}</th>
                    <th className="text-left">{ft("lb.boxer")}</th>
                    <th className="text-left">{ft("lb.tier")}</th>
                    <th className="text-right">{ft("lb.rating")}</th>
                    <th className="text-right">{ft("lb.record")}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((r) => (
                    <tr key={r.userId} className={`border-t border-black/10 dark:border-white/10 ${me?.userId === r.userId ? "font-black" : ""}`}>
                      <td className="py-0.5">{r.rank}</td>
                      <td className="py-0.5">{r.name ?? "–"}</td>
                      <td className="py-0.5">{ft(`rating.tier.${r.tier}` as FgKey)}</td>
                      <td className="py-0.5 text-right">
                        {r.rating}
                        {r.provisional ? "?" : ""}
                      </td>
                      <td className="py-0.5 text-right">
                        {r.wins}-{r.losses}-{r.draws}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {me && (
              <div className="flex items-center gap-2 rounded-lg bg-black/5 px-2 py-1 text-sm dark:bg-white/10" data-leaderboard-me>
                <span className="font-bold">{ft("lb.you")}</span>
                <span>{ft(`rating.tier.${fightTierOf(me.rating)}` as FgKey)}</span>
                <span className="ml-auto tabular-nums">
                  {me.rating}
                  {me.provisional ? "?" : ""} · {me.wins}-{me.losses}-{me.draws}
                  {me.rank ? ` · ${ft("rating.rank", { n: me.rank })}` : ""}
                </span>
              </div>
            )}
            <p className="text-[11px] opacity-75">{ft("lb.note")}</p>
            <button type="button" className="pbtn pbtn-secondary" onClick={() => setOpen(false)} data-autofocus>
              <X size={16} /> {ft("lb.close")}
            </button>
          </div>
        </PaperCard>
      </div>
    </div>
  );
}
