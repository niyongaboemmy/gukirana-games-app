"use client";
import { ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWorld } from "@/lib/world-store";

/** Bottom-left joystick with a built-in compass ring (DESIGN-SPEC §9.2: 120 px base, 52 px knob). */
export function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  /** on touch screens a full push runs (the phone HUD has no separate Run button) */
  const ranByStick = useRef(false);

  const update = (cx: number, cy: number) => {
    const r = base.current!.getBoundingClientRect();
    let dx = cx - (r.left + r.width / 2);
    let dy = cy - (r.top + r.height / 2);
    const max = r.width / 2 - 20;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob({ x: dx, y: dy });
    const w = useWorld.getState();
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const run = coarse ? len >= max * 0.97 : w.input.run;
    if (coarse) ranByStick.current = run;
    w.set({ input: { ...w.input, x: dx / max, y: -dy / max, run } });
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    const w = useWorld.getState();
    w.set({ input: { ...w.input, x: 0, y: 0, run: ranByStick.current ? false : w.input.run } });
    ranByStick.current = false;
  };

  // the joystick unmounts when the HUD swaps (leaving a hall): never leave a held direction behind
  useEffect(
    () => () => {
      const w = useWorld.getState();
      if (w.input.x !== 0 || w.input.y !== 0) w.set({ input: { ...w.input, x: 0, y: 0, run: false } });
    },
    [],
  );

  return (
    <div
      ref={base}
      className="pointer-events-auto relative size-[124px] phone:size-[104px] touch-none select-none glass controller rounded-full border-2 border-white/12 border-t-white/20"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => active.current !== null && end()}
      aria-label="Move"
    >
      <div className="absolute inset-3 rounded-full border border-white/10 shadow-[inset_0_0_18px_rgb(0_0_0/.35)]" />
      <span className="absolute left-1/2 top-1 -translate-x-1/2 font-display text-[10px] font-bold text-white/80">N</span>
      <div
        className="absolute left-1/2 top-1/2 size-[52px] phone:size-[44px] rounded-full bg-gradient-to-b from-[#f5f5f6] to-[#cbccd0] shadow-[0_6px_16px_-4px_rgb(0_0_0/.6),inset_0_-2px_0_rgb(0_0_0/.15),inset_0_1px_0_#fff]"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      >
        <div className="absolute inset-0 grid place-items-center text-primary">
          <ChevronUp size={18} strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}
