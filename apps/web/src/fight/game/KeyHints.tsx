"use client";
import { useState } from "react";
import { Keyboard } from "lucide-react";
import { boundKey, keyLabel, type BindAction } from "./input-map";
import { useFightPrefs } from "./prefs";
import { actionKey, ft } from "./strings";
import { useFightUi } from "./ui-store";

/**
 * On-screen key hints for keyboard players (P3-FGT-10): the player's own bindings, grouped (move / punch / defend /
 * more). The held direction and the last press light up, so the keys and the boxer read as one thing. Collapsible.
 */
const GROUPS: { title: "keys.move" | "keys.punch" | "keys.defend" | "keys.extra"; keys: BindAction[] }[] = [
  { title: "keys.move", keys: ["up", "left", "down", "right"] },
  { title: "keys.punch", keys: ["jab", "cross", "hook", "rhook", "uppercut"] },
  { title: "keys.defend", keys: ["guard", "evade", "parry", "clinch"] },
  { title: "keys.extra", keys: ["body", "feint"] },
];

export function KeyHints() {
  const keys = useFightPrefs((s) => s.keys);
  const press = useFightUi((s) => s.press);
  const mv = useFightUi((s) => s.mv);
  const [open, setOpen] = useState(true);
  const lit = (a: BindAction): boolean => {
    if (a === "left") return mv[0] < 0;
    if (a === "right") return mv[0] > 0;
    if (a === "up") return mv[1] > 0;
    if (a === "down") return mv[1] < 0;
    const p = press?.a;
    if (!p || performance.now() - (press?.at ?? 0) > 300) return false;
    return p === a || (a === "evade" && (p === "slipL" || p === "slipR" || p === "duck"));
  };
  return (
    <div className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 phone:hidden" data-key-hints>
      {open ? (
        <div className="glass flex items-start gap-3 rounded-card px-3 py-1.5 text-[11px] text-white">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{ft(g.title)}</span>
              <div className="flex flex-wrap gap-1">
                {g.keys.map((a) => (
                  <span key={a} className={`flex items-center gap-1 rounded px-1 ${lit(a) ? "bg-white/25" : ""}`} title={ft(actionKey(a))}>
                    <span className="kbd px-1 text-[10px]">{keyLabel(boundKey(keys, a))}</span>
                    <span className="opacity-90">{ft(actionKey(a))}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col items-end gap-1 self-stretch">
            <span className="max-w-44 text-right text-[10px] opacity-80">{ft("keys.pivot")}</span>
            <button type="button" className="text-[10px] underline opacity-80" onClick={() => setOpen(false)}>
              {ft("keys.hide")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="glass flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white" onClick={() => setOpen(true)}>
          <Keyboard size={14} /> {ft("keys.show")}
        </button>
      )}
    </div>
  );
}
