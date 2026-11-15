"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GraduationCap, X } from "lucide-react";
import { boundKey, keyLabel, type BindAction } from "./input-map";
import { useFightPrefs } from "./prefs";
import { ft, type FgKey } from "./strings";
import { useFightUi } from "./ui-store";
import { FOUL_TUTORIAL, fst } from "./scoring-strings";
import { useFightBridge } from "../bridge";

/**
 * First-fight training drill (P3-FGT-09; was the P3-FGT-05 tutorial): under a minute, four things done for real in the
 * fight — throw a jab, block one of their punches, slip one, land a combo — each ticked off the moment the engine says
 * it happened, in the words of the device you use (touch / keys / pad, your own bindings). A 60 s clock shows; it never
 * blocks the fight, "Skip" ends it, and it is not shown again (Settings can bring it back). The last card is the
 * scoring and fouls summary.
 */
type Via = "touch" | "key" | "pad";
type StepId = "jab" | "block" | "slip" | "combo";
const STEPS: { id: StepId; text: "jab" | "guard" | "move" | "power" }[] = [
  { id: "jab", text: "jab" },
  { id: "block", text: "guard" },
  { id: "slip", text: "move" },
  { id: "combo", text: "power" },
];
export const DRILL_SECONDS = 60;

/** which drill steps the fight so far has shown (pure; tested) */
export function drillDone(input: { jabs: number; blocked: number; slipped: number; combo: boolean }): Record<StepId, boolean> {
  return { jab: input.jabs > 0, block: input.blocked > 0, slip: input.slipped > 0, combo: input.combo };
}

export function Tutorial({ touch }: { touch: boolean }) {
  const done = useFightPrefs((s) => s.tutorialDone);
  const keys = useFightPrefs((s) => s.keys);
  const set = useFightPrefs((s) => s.set);
  const counts = useFightUi((s) => s.done);
  const lastVia = useFightUi((s) => s.press?.via);
  const stats = useFightUi((s) => s.stats);
  const feed = useFightUi((s) => s.feed);
  const me = useFightBridge((s) => (s.mine?.corner === "blue" ? 1 : 0)) as 0 | 1;
  const phase = useFightBridge((s) => s.mine?.snap?.phase);
  const base = useRef<Partial<Record<string, number>> | null>(null);
  if (base.current === null) base.current = { ...counts };
  const combo = useRef(false);
  if (feed.some((f) => f.e.k === "hit" && f.e.by === me && f.e.combo >= 2)) combo.current = true;
  const [pad, setPad] = useState(false);
  const started = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setPad([...(navigator.getGamepads?.() ?? [])].some((p) => !!p));
      setNow(performance.now());
    }, 500);
    return () => clearInterval(id);
  }, []);
  if (phase === "round" && started.current === null && now > 0) started.current = now;
  const via: Via = lastVia === "touch" || (touch && lastVia !== "key" && lastVia !== "pad") ? "touch" : lastVia === "pad" || pad ? "pad" : "key";
  const got = drillDone({
    jabs: (counts.jab ?? 0) - (base.current?.jab ?? 0),
    blocked: stats.sides[1 - me]!.blocked,
    slipped: stats.sides[1 - me]!.slipped,
    combo: combo.current,
  });
  const stepDone = STEPS.map((st) => got[st.id]);
  const idx = stepDone.findIndex((d) => !d);
  const left = started.current === null ? DRILL_SECONDS : Math.max(0, DRILL_SECONDS - Math.floor((now - started.current) / 1000));
  const finished = idx === -1 || left === 0;
  const vars = useMemo(() => {
    const v: Record<string, string> = {};
    for (const a of ["guard", "jab", "cross", "hook", "uppercut", "slipL", "slipR", "stepIn", "stepOut"] as BindAction[]) v[a] = keyLabel(boundKey(keys, a));
    v.key = v.guard!;
    return v;
  }, [keys]);
  if (done) return null;
  const step = STEPS[finished ? STEPS.length - 1 : idx]!;
  const textKey = `tut.${step.text}.${via}` as FgKey;
  const stepVars = step.id === "jab" ? { ...vars, key: vars.jab! } : vars;
  return (
    <div className="pointer-events-none absolute left-3 top-[17%] w-[min(320px,44vw)] phone:top-auto phone:bottom-[11%] phone:left-1/2 phone:w-[min(360px,44vw)] phone:-translate-x-1/2" role="dialog" aria-label={ft("drill.title")} data-drill={finished ? "done" : step.id}>
      <div className="glass rounded-card flex flex-col gap-2 p-3 phone:gap-1.5 phone:p-2">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} className="text-gold" />
          <span className="flex-1 font-display text-sm font-black">{ft("drill.title")}</span>
          <span className="rounded bg-white/10 px-1.5 text-[11px] font-black tabular-nums" aria-label={ft("drill.left", { s: left })}>
            {ft("drill.left", { s: left })}
          </span>
          <button type="button" aria-label={ft("drill.skip")} className="icon-button pointer-events-auto grid size-8 place-items-center rounded-full" onClick={() => set({ tutorialDone: true })}>
            <X size={16} />
          </button>
        </div>
        {!finished && (
          <>
            <p className="font-display text-base font-black leading-tight phone:text-sm">{ft(`drill.${step.id}` as FgKey)}</p>
            <p className="text-xs font-semibold leading-snug text-on-glass-muted">{ft(textKey, stepVars)}</p>
          </>
        )}
        {finished && (
          // the last card: the drill result, how the fight is scored and the fouls to avoid (P3-FGT-06 rules)
          <div className="pointer-events-auto flex max-h-[38dvh] flex-col gap-1.5 overflow-y-auto text-xs leading-snug phone:max-h-[30dvh]">
            <p className="font-display text-sm font-black">{ft("drill.done")}</p>
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
          {STEPS.map((st, i) => (
            <span key={st.id} className={`grid h-5 flex-1 place-items-center rounded-full text-[10px] font-bold text-white ${stepDone[i] ? "bg-success/85" : i === idx ? "bg-[#9b6a48]" : "bg-white/15"}`}>
              {stepDone[i] ? <Check size={12} /> : i + 1}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
