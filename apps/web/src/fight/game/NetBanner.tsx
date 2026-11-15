"use client";
import { useEffect, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { mmss, tr } from "@/rules/strings";
import { useBoxingNet } from "./net/client";

/**
 * P2-NET-05 in the Boxing hall: "Reconnecting… n s" while my fight connection is retried, and the referee time-out
 * countdown while my opponent is away (the fight is paused for both; the server forfeits them when it runs out).
 */
export function FightNetBanner() {
  const reconnecting = useBoxingNet((s) => s.reconnecting);
  const away = useBoxingNet((s) => s.oppAway);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!reconnecting && !away) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [reconnecting, away]);
  if (!reconnecting && !away) return null;
  const secs = Math.max(0, ((reconnecting ?? away)!.until - now) / 1000);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-3 phone:top-2">
      <div role="status" aria-live="polite" data-testid={reconnecting ? "reconnecting" : "opponent-waiting"} className="glass flex max-w-[92vw] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-warning-soft">
        {reconnecting ? <Loader2 size={16} className="shrink-0 animate-spin" /> : <WifiOff size={16} className="shrink-0" />}
        {reconnecting ? tr("net.reconnecting", { secs: Math.ceil(secs) }) : tr("net.fightPaused", { name: away!.name || "Your opponent", time: mmss(secs) })}
      </div>
    </div>
  );
}
