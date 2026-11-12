"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0b0d1a]/95 p-8 text-center text-white">
      <div className="flex flex-col items-center gap-5">
        <div className="animate-[spin_2.4s_ease-in-out_infinite] text-6xl">📱</div>
        <p className="text-2xl font-extrabold">Rotate your phone</p>
        <p className="max-w-xs text-sm text-white/70">The games world is built for landscape. Turn your phone sideways to play.</p>
        <Link href="/" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold">
          Use the Classic lobby instead
        </Link>
      </div>
    </div>
  );
}
