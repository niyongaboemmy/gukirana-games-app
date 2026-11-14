"use client";
import { useEffect } from "react";
import { MonitorSmartphone } from "lucide-react";
import { useOffices } from "@/admin-block/office-client";
import { openConsole, useConsole } from "./console-store";

/**
 * Administrative Block: inside your own office, "Use computer" opens the staff console full screen (C key too).
 * The office scene can call openConsole({ office, from: monitorRect }) directly from the desk computer instead.
 */
export function ConsoleLauncher() {
  const inside = useOffices((s) => s.inside);
  const mine = useOffices((s) => (s.inside ? s.roles.offices.includes(s.inside) || s.offices.find((o) => o.id === s.inside)?.canEnter === true : false));
  const knocks = useOffices((s) => s.incoming.filter((k) => k.office === s.inside).length);
  const open = useConsole((s) => s.open);
  useEffect(() => {
    if (!inside || !mine) return;
    const k = (e: KeyboardEvent) => {
      if (e.code !== "KeyC" || useConsole.getState().open || (e.target as HTMLElement)?.tagName === "INPUT") return;
      openConsole({ office: inside });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [inside, mine]);
  // the office overlay shows its own knock card (Let in / Decline) at the same spot: step aside while it is up
  if (!inside || !mine || open || knocks > 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(64px,calc(env(safe-area-inset-top)+58px))] z-30 -translate-x-1/2 phone:top-[46px]">
      <button
        type="button"
        onClick={() => openConsole({ office: inside })}
        className="chip pointer-events-auto relative flex items-center gap-2 px-4 py-2 text-sm font-bold phone:px-3 phone:py-1.5 phone:text-xs"
      >
        <MonitorSmartphone size={16} className="text-[#d6a06c]" /> Use computer
        <span className="kbd ml-1 rounded px-1.5 text-[11px] phone:hidden">C</span>
      </button>
    </div>
  );
}
