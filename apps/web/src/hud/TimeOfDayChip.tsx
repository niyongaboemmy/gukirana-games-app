"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, Moon, Sun, Sunrise, Sunset, type LucideIcon } from "lucide-react";
import { PaperCard } from "@/ui/PaperCard";
import { chooseTime, scrubberOn, TOD_ON, tod, useTimeOfDay } from "@/world/time-of-day/store";
import { clockLabel, MODES, presetMinutes, type TodMode } from "@/world/time-of-day/clock";
import type { Phase } from "@/world/time-of-day/look";
import { kigaliMinutes } from "@/world/time-of-day/solar";
import { TOD_STR } from "@/world/time-of-day/strings";
import { usePhoneHud } from "./usePhoneHud";

/** The chip's icon follows the sky: sun by day, sunrise / sunset glyphs at the ends of the day, the moon at night. */
const PHASE_ICON: Record<Phase, LucideIcon> = {
  night: Moon,
  dawn: Sunrise,
  sunrise: Sunrise,
  morning: Sun,
  midday: Sun,
  afternoon: Sun,
  golden: Sunset,
  sunset: Sunset,
  dusk: Moon,
};
const MODE_ICON: Record<Exclude<TodMode, "custom">, LucideIcon> = {
  now: Clock,
  morning: Sunrise,
  midday: Sun,
  sunset: Sunset,
  night: Moon,
};

const hm = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;

/**
 * Time-of-day chip (P2-WLD-19): the shown Kigali time with an icon of the sky, top right beside the Stars; it opens
 * a small card — Now in Rwanda (the real clock, the default) or one of four presets — like a weather app's time
 * picker. Per player, remembered on this device; the change animates over a few seconds. A test scrubber appears
 * in development builds (or with ?tod=1).
 */
export function TimeOfDayChip() {
  const label = useTimeOfDay((s) => s.label);
  const phase = useTimeOfDay((s) => s.phase);
  const mode = useTimeOfDay((s) => s.mode);
  const [open, setOpen] = useState(false);
  const phone = usePhoneHud();
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const scrub = useMemo(scrubberOn, []);
  // the card hangs under the chip, in a layer above the whole HUD (the right-edge controls are a separate fixed layer)
  const [at, setAt] = useState({ top: 64, right: 12 });
  useEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    setAt({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down, true);
    };
  }, [open]);

  if (!TOD_ON) return null;
  const Icon = PHASE_ICON[phase];
  const today = Date.now();
  const sub = (m: Exclude<TodMode, "custom">) =>
    m === "now" ? TOD_STR.nowSub(clockLabel(today)) : hm(presetMinutes(m, today));
  const pick = (m: TodMode) => {
    chooseTime(m);
    setOpen(false);
  };

  return (
    <div ref={wrap} className="pointer-events-auto relative">
      <button
        type="button"
        data-tod-chip
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={TOD_STR.chipLabel(label, TOD_STR.phase[phase])}
        title={`${TOD_STR.title}: ${TOD_STR.phase[phase]}`}
        onClick={() => setOpen((o) => !o)}
        className="glass press num flex items-center gap-1.5 rounded-card px-3 py-2.5 text-base font-extrabold tabular-nums phone:gap-1 phone:rounded-full phone:px-2.5 phone:py-1 phone:text-sm"
      >
        <Icon size={phone ? 15 : 18} strokeWidth={2} className="text-gold" aria-hidden />
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="dialog"
            aria-label={TOD_STR.title}
            style={{ top: at.top, right: at.right }}
            className="pointer-events-auto fixed z-40 w-[300px] text-white phone:w-[min(300px,48vw)]"
            data-tod-menu
          >
            <PaperCard
              title={TOD_STR.title}
              icon={Clock}
              size="sm"
              onClose={() => setOpen(false)}
              closeLabel={TOD_STR.close}
              bodyClassName={phone ? "max-h-[calc(100dvh-80px)] overflow-y-auto" : ""}
            >
              <div className="plist" role="radiogroup" aria-label={TOD_STR.title}>
                {MODES.map((m) => {
                  const MIcon = MODE_ICON[m as Exclude<TodMode, "custom">];
                  const on = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="prow prow-pick w-full text-left phone:min-h-11! phone:py-1.5!"
                      onClick={() => pick(m)}
                    >
                      <span className="prow-icon phone:size-8!">
                        <MIcon size={phone ? 16 : 18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="prow-title block truncate">{TOD_STR.mode[m]}</span>
                        <span className="prow-sub num block truncate">
                          {sub(m as Exclude<TodMode, "custom">)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {scrub && <Scrubber active={mode === "custom"} />}
              {!phone && <p className="pnote mt-3 text-xs">{TOD_STR.note}</p>}
            </PaperCard>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Testing only: any minute of the day (instant while dragging, so the look can be checked frame by frame). */
function Scrubber({ active }: { active: boolean }) {
  const [v, setV] = useState(() => Math.round(kigaliMinutes(tod.t)));
  return (
    <label className="mt-3 block">
      <span className="plabel flex items-center justify-between text-xs">
        <span>{TOD_STR.scrubber}</span>
        <span className={`num ${active ? "font-bold" : ""}`}>{hm(v)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1439}
        step={5}
        value={v}
        aria-label={TOD_STR.scrubber}
        className="mt-1 w-full accent-[#8c684a]"
        onChange={(e) => {
          const m = Number(e.target.value);
          setV(m);
          chooseTime("custom", { minutes: m, instant: true });
        }}
      />
    </label>
  );
}
