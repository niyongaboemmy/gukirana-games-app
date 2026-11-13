"use client";
import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";

/** Phones must play in landscape (SRS UI-04). Portrait shows this screen + a Classic 2D option. */
export function RotateGuard() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse) and (orientation: portrait)");
    const on = () => setShow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/95 p-8 text-center text-white">
      <div className="flex flex-col items-center gap-5">
        <div className="animate-[spin_2.4s_ease-in-out_infinite]">
          <Smartphone size={64} strokeWidth={1.75} />
        </div>
        <p className="text-2xl font-extrabold">Rotate your phone</p>
        <p className="max-w-xs text-sm text-white/70">The games world is built for landscape. Turn your phone sideways to play.</p>
        <p className="text-xs text-white/50">Tip: lock rotation off in your phone settings.</p>
      </div>
    </div>
  );
}
