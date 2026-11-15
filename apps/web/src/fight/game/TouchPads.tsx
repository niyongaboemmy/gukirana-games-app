"use client";
import { useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Shield } from "lucide-react";
import type { BoxingAction } from "@gukirana/contracts";
import { fightInput } from "./actions";
import { classifyStroke, stickOf, strokeIsBody } from "./input-map";
import { BUTTON_PX, useFightPrefs } from "./prefs";
import { actionKey, ft } from "./strings";
import { useFightUi } from "./ui-store";

/**
 * Phone controls (P3-FGT-05, scheme in input-map.ts): two big thumb zones over the lower screen.
 *  - Left zone (anywhere in it, not only on the circle): a floating stick (P3-FGT-10). Touch = guard up (or tap to
 *    toggle), drag = walk / circle (the boxer keeps facing the opponent), a quick flick ← / → slips, ↑ / ↓ steps.
 *  - Right zone: four large punch buttons (fire on touch-down, no wait), and strokes anywhere else in the zone: tap =
 *    jab, swipe ↑ = uppercut, across (inward) = hook, out = cross, ↓ = hook to the body.
 * Multi-touch (guard held with the left thumb while the right one punches), every press vibrates a short tick and
 * lights up at once; the engine then confirms it (HUD). Left-handed mirrors the zones.
 */
const tick = (ms = 9) => {
  if (useFightPrefs.getState().vibration && typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
};

function GuardZone({ size, mirrored }: { size: number; mirrored: boolean }) {
  const toggle = useFightPrefs((s) => s.guardToggle);
  const [on, setOn] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState<BoxingAction | null>(null);
  const start = useRef<{ x: number; y: number; id: number; t: number; swiped: boolean; mv: [number, number] } | null>(null);
  const walk = (s: NonNullable<typeof start.current>, mv: [number, number]) => {
    if (mv[0] === s.mv[0] && mv[1] === s.mv[1]) return;
    s.mv = mv;
    fightInput.move(mv, "touch");
  };
  const zone = useRef<HTMLDivElement>(null);
  const set = (g: boolean) => {
    setOn(g);
    fightInput.guard(g, "touch");
  };
  const swipe = (dx: number, dy: number, ms: number, s: NonNullable<typeof start.current>) => {
    const a = classifyStroke("guard", dx, dy, ms);
    if (!a) return;
    s.swiped = true;
    tick(14);
    setFlash(a);
    setTimeout(() => setFlash(null), 260);
    fightInput.press(a, "touch");
  };
  return (
    <div
      ref={zone}
      data-zone="guard"
      className="pointer-events-auto relative h-full touch-none select-none"
      style={{ width: "42%" }}
      onPointerDown={(e) => {
        if (start.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.timeStamp, swiped: false, mv: [0, 0] };
        setAt({ x: e.clientX - r.left, y: e.clientY - r.top });
        if (!toggle) {
          tick();
          set(true);
        }
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        const ms = e.timeStamp - s.t;
        // a quick flick (fast, early) slips / steps once; a slower drag walks
        if (!s.swiped && ms < 160 && Math.hypot(dx, dy) > 48) return swipe(dx, dy, ms, s);
        walk(s, stickOf(dx, dy));
      }}
      onPointerUp={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        start.current = null;
        setAt(null);
        const walked = s.mv[0] !== 0 || s.mv[1] !== 0;
        walk(s, [0, 0]);
        if (!s.swiped && !walked) swipe(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t, s);
        if (toggle) {
          if (!s.swiped) set(!on);
        } else set(false);
      }}
      onPointerCancel={() => {
        if (start.current) walk(start.current, [0, 0]);
        start.current = null;
        setAt(null);
        if (!toggle) set(false);
      }}
    >
      <div
        role="button"
        aria-pressed={on}
        aria-label={ft("action.guard")}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full font-display font-black text-white transition-[transform,background] duration-75 ${on ? "pbtn-primary scale-95" : "glass"}`}
        style={{
          width: size,
          height: size,
          left: at ? at.x : mirrored ? `calc(100% - ${size / 2 + 8}px)` : size / 2 + 8,
          top: at ? at.y : `calc(100% - ${size / 2 + 8}px)`,
          boxShadow: on ? "0 0 0 4px rgb(255 255 255 / 0.25)" : "inset 0 0 0 3px rgb(155 106 72 / 0.85)",
        }}
      >
        <ChevronUp size={18} className={`absolute top-2 ${flash === "stepIn" ? "text-white" : "text-white/45"}`} />
        <ChevronDown size={18} className={`absolute bottom-2 ${flash === "stepOut" ? "text-white" : "text-white/45"}`} />
        <ChevronLeft size={18} className={`absolute left-2 ${flash === "slipL" ? "text-white" : "text-white/45"}`} />
        <ChevronRight size={18} className={`absolute right-2 ${flash === "slipR" ? "text-white" : "text-white/45"}`} />
        <Shield size={Math.round(size / 4.5)} />
        <span className="text-sm">{flash ? ft(actionKey(flash)) : ft("action.guard")}</span>
      </div>
      {!at && (
        <span className="absolute bottom-1 text-[10px] font-semibold text-white/70" style={mirrored ? { right: 12 } : { left: 12 }}>
          {toggle ? ft("action.guardToggleHint") : ft("action.stickHint")}
        </span>
      )}
    </div>
  );
}

const ARC: { a: BoxingAction; col: 1 | 2; row: 1 | 2 }[] = [
  { a: "jab", col: 1, row: 1 },
  { a: "cross", col: 2, row: 1 },
  { a: "hook", col: 1, row: 2 },
  { a: "uppercut", col: 2, row: 2 },
];

function PunchZone({ size, mirrored }: { size: number; mirrored: boolean }) {
  const strokes = useRef(new Map<number, { x: number; y: number; t: number }>());
  const press = useFightUi((s) => s.press);
  const [lit, setLit] = useState<{ a: BoxingAction; n: number } | null>(null);
  const fire = (a: BoxingAction, body = false) => {
    tick();
    setLit({ a, n: Date.now() });
    setTimeout(() => setLit((l) => (l && Date.now() - l.n >= 170 ? null : l)), 190);
    fightInput.press(a, "touch", body);
  };
  const gap = Math.round(size * 0.16);
  return (
    <div
      data-zone="punch"
      className={`pointer-events-auto relative flex h-full touch-none select-none items-end ${mirrored ? "justify-start" : "justify-end"}`}
      style={{ width: "50%" }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        strokes.current.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      }}
      onPointerUp={(e) => {
        const s = strokes.current.get(e.pointerId);
        strokes.current.delete(e.pointerId);
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        const a = classifyStroke("punch", dx, dy, e.timeStamp - s.t, mirrored);
        fire(a ?? "jab", !!a && strokeIsBody(dx, dy));
      }}
      onPointerCancel={(e) => strokes.current.delete(e.pointerId)}
    >
      <div className="grid" style={{ gridTemplateColumns: `${size}px ${size}px`, gap, padding: gap }}>
        {ARC.map(({ a, col, row }) => {
          const on = lit?.a === a && Date.now() - lit.n < 180;
          const confirmed = press?.a === a && press.state === "confirmed" && performance.now() - press.at < 500;
          return (
            <button
              key={a}
              type="button"
              aria-label={ft(actionKey(a))}
              className={`pbtn pbtn-primary !rounded-full !p-0 !text-sm transition-transform duration-75 ${on ? "scale-90 brightness-125" : ""}`}
              style={{
                width: size,
                height: size,
                gridColumn: mirrored ? 3 - col : col,
                gridRow: row,
                // the arc: the outer column sits a little lower
                transform: `translateY(${(mirrored ? col === 1 : col === 2) ? Math.round(size * 0.18) : 0}px)${on ? " scale(0.9)" : ""}`,
                boxShadow: confirmed ? "0 0 0 4px rgb(34 197 94 / 0.75)" : undefined,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                fire(a);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {ft(actionKey(a))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TouchPads() {
  const sizeKey = useFightPrefs((s) => s.buttonSize);
  const left = useFightPrefs((s) => s.leftHanded);
  const size = BUTTON_PX[sizeKey];
  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex h-[62%] items-stretch justify-between px-2 pb-2 ${left ? "flex-row-reverse" : ""}`}>
      <GuardZone size={Math.round(size * 1.6)} mirrored={left} />
      <PunchZone size={size} mirrored={left} />
    </div>
  );
}
