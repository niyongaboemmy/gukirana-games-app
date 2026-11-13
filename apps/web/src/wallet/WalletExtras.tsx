"use client";
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { api } from "@/lib/session";

export type Limits = {
  dailyStakeLimit: number | null;
  pendingStakeLimit: number | null;
  pendingFrom: string | null;
  reminderMinutes: number;
  selfExcludedUntil: string | null;
};

/** Gentle play-time reminder (setting from the wallet). Mounted once in the HUD; counts time with the tab visible. */
export function PlayReminder() {
  const [shown, setShown] = useState<number | null>(null);
  const minutes = useRef(60);
  useEffect(() => {
    void api<Limits>("/wallet/limits")
      .then((l) => (minutes.current = l.reminderMinutes))
      .catch(() => undefined);
    let played = 0;
    let next = 1;
    const t = setInterval(() => {
      if (document.hidden || !minutes.current) return;
      played += 1;
      if (played >= minutes.current * next) {
        setShown(played);
        next++;
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  if (shown === null) return null;
  return (
    <div
      role="status"
      className="toast pointer-events-auto fixed left-1/2 top-20 z-[60] flex -translate-x-1/2 items-center gap-3 px-4 py-2.5 text-sm"
    >
      <Clock size={16} /> You have been playing for {shown} minutes. Time for a stretch?
      <button
        type="button"
        onClick={() => setShown(null)}
        className="btn-secondary press px-2.5 py-1 text-xs font-bold"
      >
        OK
      </button>
    </div>
  );
}
