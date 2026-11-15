"use client";
import type { BoxingSnapshot, FighterView } from "@gukirana/contracts";
import { LIFE, TIRED_STAMINA } from "@gukirana/boxing";
import { useFightUi } from "./ui-store";
import { ft, type FgKey } from "./strings";

/**
 * Fighter life on the HUD (P3-FGT-13, docs/FIGHT-REALISM-V3.md §5): head and body damage under the stamina / balance
 * meters, the get-up task during a count, the standing count, the second wind and the corner's advice between rounds.
 * Everything is read from the engine's snapshot and events (the server decides; nothing here changes the fight).
 */
const glass = "rounded-xl border border-white/10 bg-[rgb(18_18_20/0.78)] text-on-glass shadow-lg backdrop-blur";

/** damage meters (0…1000, filling up): head = wear, body = body wear */
export function DamageBars({ f, flip }: { f: FighterView; flip?: boolean }) {
  if (f.bodyWear === undefined) return null;
  const bar = (v: number, label: string) => {
    const pct = Math.max(0, Math.min(100, v / 10));
    const color = v > 600 ? "#ef4444" : v > 300 ? "#f59e0b" : "#a8a29e";
    return (
      <div className={`flex flex-1 items-center gap-1 ${flip ? "flex-row-reverse" : ""}`} aria-label={`${label} ${Math.round(pct)}%`}>
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-on-glass-muted">{label}</span>
        <div className={`relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 ${flip ? "rotate-180" : ""}`}>
          <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
    );
  };
  return (
    <div className={`flex gap-2 ${flip ? "flex-row-reverse" : ""}`}>
      {bar(f.wear ?? 0, ft("life.head"))}
      {bar(f.bodyWear ?? 0, ft("life.body"))}
    </div>
  );
}

/** the get-up task while I am down: steady presses counted / needed, and whether the next press is allowed yet */
export function GetUpPanel({ snap, me, now, touch }: { snap: BoxingSnapshot; me: 0 | 1; now: number; touch: boolean }) {
  const feed = useFightUi((s) => s.feed);
  const f = snap.fighters[me];
  const rise = f.rise;
  if (snap.phase !== "knockdown" || f.act !== "down" || !rise) return null;
  const mine = [...feed].reverse().find((x) => x.e.k === "rise" && x.e.to === me);
  const gapMs = ((LIFE.rise.gap + (f.stamina < TIRED_STAMINA ? LIFE.rise.tiredGap : 0)) * 1000) / 30;
  const since = mine ? now - mine.at : Infinity;
  const ready = since >= gapMs;
  const panic = mine && mine.e.k === "rise" && !mine.e.ok && since < 700;
  const k = Math.min(1, since / gapMs);
  return (
    <div className={`${glass} flex flex-col items-center gap-1.5 px-5 py-2.5 phone:px-3 phone:py-1.5`} role="status" aria-live="polite" data-getup="1">
      <span className="font-display text-xl font-black phone:text-base">{ft("life.getUp")}</span>
      <span className="text-xs font-semibold text-on-glass-muted phone:text-[10px]">{ft(touch ? "life.getUpTouch" : "life.getUpHow")}</span>
      <div className="flex gap-1" aria-label={`${rise.got} / ${rise.need}`}>
        {Array.from({ length: rise.need }, (_, i) => (
          <span key={i} className="size-3 rounded-full phone:size-2.5" style={{ background: i < rise.got ? "#22c55e" : "rgb(255 255 255 / 0.18)" }} />
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs font-bold">
        <span className="relative block h-1.5 w-24 overflow-hidden rounded-full bg-white/12">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${k * 100}%`, background: ready ? "#22c55e" : "#f59e0b" }} />
        </span>
        <span style={{ color: panic ? "#ef4444" : ready ? "#22c55e" : "#f59e0b" }}>{ft(panic ? "life.panic" : ready ? "life.ready" : "life.wait")}</span>
      </div>
    </div>
  );
}

/** the corner's advice between rounds (P3-FGT-13): one plain line from the meters and the score */
export function cornerAdvice(snap: Pick<BoxingSnapshot, "fighters">, me: 0 | 1): FgKey {
  const a = snap.fighters[me];
  const b = snap.fighters[(1 - me) as 0 | 1];
  if ((a.wear ?? 0) > 400) return "corner.head";
  if ((a.bodyWear ?? 0) > 350) return "corner.body";
  if (a.stamina < 400) return "corner.breathe";
  if ((b.wear ?? 0) > 400) return "corner.pressure";
  if ((b.bodyWear ?? 0) > 300) return "corner.bodyAttack";
  return a.points < b.points ? "corner.jab" : "corner.defend";
}

export function CornerCard({ snap, me }: { snap: BoxingSnapshot; me: 0 | 1 }) {
  if (snap.phase !== "rest" || !snap.life) return null;
  return (
    <div className={`${glass} gk-fade-up flex max-w-md flex-col items-center px-6 py-2.5 text-center phone:px-3 phone:py-1.5`} role="status" data-corner-advice="1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-on-glass-muted">{ft("life.corner")}</span>
      <span className="text-sm font-bold phone:text-xs">{ft(cornerAdvice(snap, me))}</span>
    </div>
  );
}
