"use client";
import { useRef, useState } from "react";
import { Shield } from "lucide-react";
import type { BoxingAction } from "@gukirana/contracts";
import { fightInput } from "./actions";
import { swipeAction } from "./controls";
import { BUTTON_PX, useFightPrefs } from "./prefs";
import { actionKey, ft } from "./strings";

/**
 * Phone controls (FIGHT-GAMES-PLAN §2.8): left thumb = big Guard pad (hold, or tap to toggle; swipe left / right =
 * slip, up / down = step in / out); right thumb = 4 punch buttons in an arc (Jab top-left, Cross top-right, Hook
 * bottom-left, Uppercut bottom-right), a swipe on the pad also punches. Left-handed mirrors the pads.
 */
function GuardPad({ size }: { size: number }) {
  const toggle = useFightPrefs((s) => s.guardToggle);
  const [on, setOn] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; swiped: boolean } | null>(null);
  const set = (g: boolean) => {
    setOn(g);
    fightInput.guard(g);
  };
  return (
    <div
      role="button"
      aria-pressed={on}
      aria-label={ft("action.guard")}
      className={`pointer-events-auto flex touch-none select-none flex-col items-center justify-center gap-1 rounded-full font-display font-black text-white ${on ? "pbtn-primary" : "glass"}`}
      style={{ width: size, height: size, boxShadow: on ? undefined : "inset 0 0 0 3px rgb(155 106 72 / 0.85)" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiped: false };
        if (!toggle) set(true);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.swiped || s.id !== e.pointerId) return;
        const a = swipeAction("guard", e.clientX - s.x, e.clientY - s.y);
        if (a) {
          s.swiped = true;
          fightInput.press(a);
        }
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== e.pointerId) return;
        if (toggle) {
          if (!s.swiped) set(!on);
        } else set(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        if (!toggle) set(false);
      }}
    >
      <Shield size={Math.round(size / 4)} />
      <span className="text-base">{ft("action.guard")}</span>
      <span className="max-w-[80%] text-center text-[10px] font-semibold leading-tight text-white/75">
        {ft(toggle ? "action.guardToggleHint" : "action.guardHint")}
      </span>
    </div>
  );
}

const ARC: { a: BoxingAction; col: 1 | 2; row: 1 | 2 }[] = [
  { a: "jab", col: 1, row: 1 },
  { a: "cross", col: 2, row: 1 },
  { a: "hook", col: 1, row: 2 },
  { a: "uppercut", col: 2, row: 2 },
];

function PunchPad({ size, mirrored }: { size: number; mirrored: boolean }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const gap = Math.round(size * 0.14);
  return (
    <div
      className="pointer-events-auto grid touch-none select-none"
      style={{ gridTemplateColumns: `${size}px ${size}px`, gap, padding: gap }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = (e.clientX - s.x) * (mirrored ? -1 : 1);
        fightInput.press(swipeAction("punch", dx, e.clientY - s.y) ?? "jab");
      }}
    >
      {ARC.map(({ a, col, row }) => (
        <button
          key={a}
          type="button"
          aria-label={ft(actionKey(a))}
          className="pbtn pbtn-primary !rounded-full !p-0 !text-sm"
          style={{
            width: size,
            height: size,
            gridColumn: mirrored ? 3 - col : col,
            gridRow: row,
            // the arc: the outer column sits a little lower
            transform: `translateY(${(mirrored ? col === 1 : col === 2) ? Math.round(size * 0.18) : 0}px)`,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            fightInput.press(a);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ft(actionKey(a))}
        </button>
      ))}
    </div>
  );
}

export function TouchPads() {
  const sizeKey = useFightPrefs((s) => s.buttonSize);
  const left = useFightPrefs((s) => s.leftHanded);
  const size = BUTTON_PX[sizeKey];
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-4 phone:px-3 phone:pb-3 ${left ? "flex-row-reverse" : ""}`}
    >
      <div className="pb-1">
        <GuardPad size={Math.round(size * 1.7)} />
      </div>
      <PunchPad size={size} mirrored={left} />
    </div>
  );
}
