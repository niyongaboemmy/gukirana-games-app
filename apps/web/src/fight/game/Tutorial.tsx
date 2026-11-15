"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GraduationCap, X } from "lucide-react";
import type { BoxingAction } from "@gukirana/contracts";
import { boundKey, keyLabel, type BindAction } from "./input-map";
import { useFightPrefs } from "./prefs";
import { ft, type FgKey } from "./strings";
import { useFightUi } from "./ui-store";
import { FOUL_TUTORIAL, fst } from "./scoring-strings";

/**
 * First-fight tutorial (P3-FGT-05): four short steps — guard, jab, power punches, slips / steps — in the words of the
 * device you use (touch / keys / pad, with your own key bindings). It never blocks the fight: each step ticks off when
 * you do it, "Skip" ends it, and it is not shown again (Settings can bring it back).
 */
type Via = "touch" | "key" | "pad";
const STEPS: { id: "guard" | "jab" | "power" | "move"; acts: (BoxingAction | "guard")[] }[] = [
  { id: "guard", acts: ["guard"] },
  { id: "jab", acts: ["jab"] },
  { id: "power", acts: ["cross", "hook", "uppercut"] },
  { id: "move", acts: ["slipL", "slipR", "stepIn", "stepOut"] },
];

export function Tutorial({ touch }: { touch: boolean }) {
  const done = useFightPrefs((s) => s.tutorialDone);
  const keys = useFightPrefs((s) => s.keys);
  const set = useFightPrefs((s) => s.set);
  const counts = useFightUi((s) => s.done);
  const lastVia = useFightUi((s) => s.press?.via);
  const base = useRef<Partial<Record<string, number>> | null>(null);
  if (base.current === null) base.current = { ...counts };
  const [pad, setPad] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setPad([...(navigator.getGamepads?.() ?? [])].some((p) => !!p)), 1000);
    return () => clearInterval(id);
  }, []);
  const via: Via = lastVia === "touch" || (touch && lastVia !== "key" && lastVia !== "pad") ? "touch" : lastVia === "pad" || pad ? "pad" : "key";
  const did = (a: BoxingAction | "guard") => (counts[a] ?? 0) > (base.current?.[a] ?? 0);
  const stepDone = STEPS.map((s) => s.acts.some(did));
  const idx = stepDone.findIndex((d) => !d);
  const finished = idx === -1;
  const vars = useMemo(() => {
    const v: Record<string, string> = {};
    for (const a of ["guard", "jab", "cross", "hook", "uppercut", "slipL", "slipR", "stepIn", "stepOut"] as BindAction[]) v[a] = keyLabel(boundKey(keys, a));
    v.key = v.guard!;
    return v;
  }, [keys]);
  if (done) return null;
  const step = STEPS[finished ? STEPS.length - 1 : idx]!;
  const textKey = `tut.${step.id}.${via}` as FgKey;
  const jabVars = step.id === "jab" ? { ...vars, key: vars.jab! } : vars;
  return (
    <div className="pointer-events-none absolute left-3 top-[17%] w-[min(320px,44vw)] phone:top-auto phone:bottom-[11%] phone:left-1/2 phone:w-[min(360px,44vw)] phone:-translate-x-1/2" role="dialog" aria-label={ft("tut.title")}>
      <div className="glass rounded-card flex flex-col gap-2 p-3 phone:gap-1.5 phone:p-2">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} className="text-gold" />
          <span className="flex-1 font-display text-sm font-black">{ft("tut.title")}</span>
          <span className="text-[11px] font-bold text-on-glass-muted">{ft("tut.step", { n: finished ? STEPS.length : idx + 1, total: STEPS.length })}</span>
          <button type="button" aria-label={ft("tut.skip")} className="icon-button pointer-events-auto grid size-8 place-items-center rounded-full" onClick={() => set({ tutorialDone: true })}>
            <X size={16} />
          </button>
        </div>
        {!finished && <p className="text-sm font-semibold leading-snug phone:text-xs">{ft(textKey, jabVars)}</p>}
        {finished && (
          // the last card: how the fight is scored and the fouls to avoid (P3-FGT-06 rules)
          <div className="pointer-events-auto flex max-h-[38dvh] flex-col gap-1.5 overflow-y-auto text-xs leading-snug phone:max-h-[30dvh]">
            <p className="font-bold">{fst("rules.title")}</p>
            <p className="phone:hidden">{fst("rules.judges", { n: 5 })}</p>
            <p>{fst("rules.ladder", { max: 3 })}</p>
            {FOUL_TUTORIAL.map((r) => (
              <p key={r.foul} className="phone:hidden">
                <span className="font-bold">{fst(r.when)}</span> <span className="text-on-glass-muted">{fst(r.avoid)}</span>
              </p>
            ))}
            <button type="button" className="pbtn pbtn-primary !min-h-9 !text-xs" onClick={() => set({ tutorialDone: true })}>
              {ft("tut.done")}
            </button>
          </div>
        )}
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.id} className={`grid h-5 flex-1 place-items-center rounded-full text-white ${stepDone[i] ? "bg-success/85" : i === idx ? "bg-[#9b6a48]" : "bg-white/15"}`}>
              {stepDone[i] && <Check size={12} />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
