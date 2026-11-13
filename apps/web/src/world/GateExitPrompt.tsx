"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { logout } from "@/lib/session";
import { useTransition } from "./transition";

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
 * DOM overlay for the world: (1) the exit-kiosk prompt + confirm sheet ("Sign out at the gate"), and (2) the
 * walk-through door transition (soft fade to black, then navigate to the room).
 */
export function WorldOverlays() {
  const router = useRouter();
  const nearGateExit = useWorld((s) => s.nearGateExit);
  const entering = useTransition((s) => s.entering);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // door transition: fade, then navigate (the room route starts the player on its own porch)
  useEffect(() => {
    if (!entering) return;
    const t = setTimeout(() => router.push(entering), 650);
    return () => clearTimeout(t);
  }, [entering, router]);
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

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      router.push("/gate");
    }
  };

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40 bg-black transition-opacity duration-500 ease-in"
        style={{ opacity: entering ? 1 : 0 }}
      />
      {nearGateExit && !confirm && (
        <div className="pointer-events-none fixed bottom-[48%] left-1/2 z-20 -translate-x-1/2">
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/30 bg-[#22266E]/85 py-2 pl-2 pr-5 text-lg font-bold text-white shadow-2xl backdrop-blur-md active:scale-95"
          >
            <span className="grid size-9 place-items-center rounded-full bg-white text-base font-black text-[#22266E]">E</span>
            <LogOut size={20} strokeWidth={1.85} /> {STR.prompt}
          </button>
        </div>
      )}
      {confirm && (
        <div role="dialog" aria-modal="true" aria-label={STR.title} className="fixed inset-0 z-50 grid place-items-end bg-[#05060f]/55 p-3 sm:place-items-center">
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#0f1222]/95 p-5 text-white shadow-2xl backdrop-blur-md">
            <h2 className="text-lg font-extrabold">{STR.title}</h2>
            <p className="mt-1 text-sm text-white/70">{STR.body}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirm(false)} className="flex-1 rounded-full bg-white/10 py-2.5 font-bold hover:bg-white/20">
                {STR.cancel}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void signOut()}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#E5484D] py-2.5 font-bold disabled:opacity-60"
              >
                <LogOut size={18} strokeWidth={1.85} /> {busy ? STR.busy : STR.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
