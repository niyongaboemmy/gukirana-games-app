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
        <div className="glass flex max-w-[min(1000px,96vw)] flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 rounded-full px-3 py-1 text-[10px] text-white">
          {GROUPS.map((g) =>
            g.keys.map((a) => (
              <span key={a} className={`flex items-center gap-0.5 rounded px-0.5 ${lit(a) ? "bg-white/25" : ""}`} title={ft(actionKey(a))}>
                <span className="kbd px-1 text-[10px]">{keyLabel(boundKey(keys, a))}</span>
                <span className="opacity-85">{ft(actionKey(a))}</span>
              </span>
            )),
          )}
          <span className="opacity-70">{ft("keys.pivot")}</span>
          <button type="button" className="underline opacity-70" onClick={() => setOpen(false)}>
            {ft("keys.hide")}
          </button>
        </div>
      ) : (
        <button type="button" className="glass flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white" onClick={() => setOpen(true)}>
          <Keyboard size={14} /> {ft("keys.show")}
        </button>
      )}
    </div>
  );
}
