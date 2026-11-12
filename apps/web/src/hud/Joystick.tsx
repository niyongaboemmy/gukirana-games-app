"use client";
import { ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import { useWorld } from "@/lib/world-store";

/** Bottom-left joystick with a built-in compass ring (DESIGN-SPEC §9.2: 120 px base, 52 px knob). */
export function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

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
    w.set({ input: { ...w.input, x: dx / max, y: -dy / max } });
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    const w = useWorld.getState();
    w.set({ input: { ...w.input, x: 0, y: 0 } });
  };

  return (
    <div
      ref={base}
      className="pointer-events-auto relative size-[124px] touch-none select-none rounded-full border-2 border-white/40 bg-[#22266E]/45 shadow-lg backdrop-blur-md"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Move"
    >
      <div className="absolute inset-3 rounded-full border border-dashed border-white/25" />
      <span className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] font-bold text-white/80">N</span>
      <div
        className="absolute left-1/2 top-1/2 size-[52px] rounded-full bg-gradient-to-b from-white to-[#cfe3ff] shadow-md"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      >
        <div className="absolute inset-0 grid place-items-center text-[#3DA9FC]">
          <ChevronUp size={18} strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}
