"use client";
import { useEffect, useState } from "react";
import en from "@gukirana/i18n/messages/en.json";
import { HALLS } from "@/rooms/layouts";
import { useStage } from "./stage";

/** i18n keys `world.entry.*` (@gukirana/i18n messages; English shown until the web app switches locales) */
const T = en.world.entry;
/** a hall that is ready within this long never shows the hint at all (no flash) */
const SHOW_AFTER_MS = 350;

/**
 * P3-FGT-25: the only sign that a hall is still being made ready while you travel to it (world/stage `travelTo`). The
 * world stays live and your person keeps moving behind it: a small dark-glass pill at the top (under the place name), no full-screen
 * cover, no input blocked (pointer-events none), gone the moment the live cut lands.
 */
export function EntryHint() {
  const preparing = useStage((s) => s.preparing);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!preparing) return void setShown(false);
    const t = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [preparing]);
  if (!preparing || !shown) return null;
  const text = preparing === "boxing" ? T.ring : T.hall.replace("{hall}", HALLS[preparing].title);
  return (
    <div
      role="status"
      aria-live="polite"
      data-gk-entry-hint=""
      className="gk-fade-up pointer-events-none fixed left-1/2 top-[max(64px,calc(env(safe-area-inset-top)+56px))] z-[45] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-[#141517]/85 px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_28px_-10px_rgba(0,0,0,0.7)] backdrop-blur-md phone:top-[max(12px,env(safe-area-inset-top))] phone:px-3 phone:py-1.5"
    >
      <span aria-hidden className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-400/70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
      </span>
      {text}
    </div>
  );
}
