"use client";
import { PaperCard } from "@/ui/PaperCard";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { logout } from "@/lib/session";
import { useTransition } from "./transition";
import { enterHall, signOut as walkOut } from "./stage";
import { PORTALS } from "./layout";

/** UI strings (to move to @gukirana/i18n keys `world.exit.*`). */
const STR = {
  prompt: "Sign out at the gate",
  title: "Sign out and leave the playground?",
  body: "You can come back any time through the gate.",
  cancel: "Stay",
  confirm: "Sign out",
  busy: "Signing out...",
} as const;

/**
 * DOM overlay for the world: (1) the exit-kiosk prompt + confirm sheet ("Sign out at the gate": the person then
 * walks out through the gate, world/stage.ts signOut), and (2) the walk-through door crossing into a hall.
 */
export function WorldOverlays() {
  const nearGateExit = useWorld((s) => s.nearGateExit);
  const entering = useTransition((s) => s.entering);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // door crossing: you keep walking into the vestibule, the (pre-warmed) hall takes over mid-stride
  useEffect(() => {
    if (!entering) return;
    const label = PORTALS.find((p) => p.href === entering)?.label ?? "";
    enterHall(entering, label);
  }, [entering]);
  useEffect(() => () => useTransition.getState().reset(), []);

  useEffect(() => {
    if (!nearGateExit) setConfirm(false);
  }, [nearGateExit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "KeyE" && useWorld.getState().nearGateExit) setConfirm(true);
      if (e.code === "Escape") setConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // the person turns and walks out through the turnstiles; the session ends once the walk has started
  const signOut = () => {
    setBusy(true);
    setConfirm(false);
    walkOut("kiosk", logout);
  };

  return (
    <>
      {nearGateExit && !confirm && (
        <div className="pointer-events-none fixed bottom-[48%] left-1/2 z-20 -translate-x-1/2">
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="chip pointer-events-auto flex items-center gap-3 border-l-primary-400/70 py-2 pl-2 pr-5 text-lg font-semibold"
          >
            <span className="kbd grid size-9 place-items-center rounded-lg text-base font-bold">E</span>
            <LogOut size={20} strokeWidth={1.85} /> {STR.prompt}
          </button>
        </div>
      )}
      {confirm && (
        <div role="dialog" aria-modal="true" aria-label={STR.title} className="pscrim z-50 grid place-items-end p-3 sm:place-items-center">
          <div className="w-full max-w-sm">
            <PaperCard
              title={STR.title}
              icon={LogOut}
              onClose={() => setConfirm(false)}
              closeLabel={STR.cancel}
              footer={
                <>
                  <button type="button" onClick={() => setConfirm(false)} className="pbtn pbtn-secondary flex-1">
                    {STR.cancel}
                  </button>
                  <button type="button" disabled={busy} onClick={signOut} className="pbtn pbtn-danger flex-1">
                    <LogOut size={18} strokeWidth={1.85} /> {busy ? STR.busy : STR.confirm}
                  </button>
                </>
              }
            >
              <p className="pmuted text-sm">{STR.body}</p>
            </PaperCard>
          </div>
        </div>
      )}
    </>
  );
}
