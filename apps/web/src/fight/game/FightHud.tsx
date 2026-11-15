"use client";
import { CornerCard, DamageBars, GetUpPanel } from "./LifeHud";
import { useEffect, useRef, useState } from "react";
import { Check, Clapperboard, DoorOpen, Flag, GlassWater, GraduationCap, Hourglass, Megaphone, SlidersHorizontal, Square, Video } from "lucide-react";
import { CORNER_COLORS, TICK_HZ, type BoxingSnapshot, type Corner, type FightEvent, type FighterView } from "@gukirana/contracts";
import { Modal } from "@/games/GameShell";
import { useFightBridge, type MyFight } from "../bridge";
import { BOOST_ON, buyCornerRefresh, gameFightActions, startPractice } from "./actions";
import { CORNER_REFRESH_PRICE_STARS, CORNER_REFRESH_STAMINA } from "@gukirana/money";
import { eventFx } from "./fx";
import { FightSettings } from "./FightSettings";
import { actionKey, foulKey, ft, type FgKey } from "./strings";
import { foulText, fst, levelText, type FsKey } from "./scoring-strings";
import { stopReplay, useReplay } from "./replay";
import { useFightUi } from "./ui-store";
import { useFightPrefs } from "./prefs";
import { COACH_SHOW_MS, coachMayShow, coachTip, type CoachTip } from "./coach";
import { judgeGoal, levelGoal, liveRound, OUTCOME_COLOR, punchVerdict, roundVerdict, type RoundReason } from "./outcome";
import { ResultPanel } from "./ResultPanel";
import { useFightUi as useWorldUi } from "../ui-store";

/**
 * The fight HUD (FIGHT-GAMES-PLAN §12 Do 5): both names with corner badges, points, round + clock, stamina and
 * balance (composure) bars, round cards, the knockdown count, warnings, combo / counter pops, the result card and the
 * Leave dialog (exit rules). Reads only the bridge + the HUD feed; works the same for practice and live.
 */

const glass = "glass rounded-card";
const clock = (ticks: number) => {
  const s = Math.max(0, Math.ceil(ticks / TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(ms = 100): number {
  const [now, setNow] = useState(() => (typeof performance !== "undefined" ? performance.now() : 0));
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Meter({ value, label, tone, flip }: { value: number; label: string; tone: "stamina" | "composure"; flip?: boolean }) {
  const pct = Math.max(0, Math.min(100, value / 10));
  const low = value < 300;
  // power fades green -> amber -> red as the engine's stamina drains (P3-FGT-09); balance white -> red
  const color = tone === "stamina" ? (value < 300 ? "#ef4444" : value < 550 ? "#f59e0b" : "#22c55e") : low ? "#ef4444" : "#f2f3f5";
  return (
    <div className="flex items-center gap-1.5" aria-label={`${label} ${Math.round(pct)}%`}>
      <span className={`w-14 shrink-0 text-[10px] font-bold uppercase tracking-wide text-on-glass-muted phone:hidden ${flip ? "order-2 text-right" : ""}`}>
        {label}
      </span>
      <div className={`relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/12 phone:h-2 ${flip ? "rotate-180" : ""}`}>
        <div className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-150 ${low ? "gk-pulse" : ""}`} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Badge({ corner }: { corner: Corner }) {
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-md text-sm font-black text-white phone:size-6 phone:text-xs"
      style={{
        background: CORNER_COLORS[corner],
        // colour-blind safe: a pattern on blue, solid red, plus the letter
        backgroundImage: corner === "blue" ? "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.16) 0 3px, transparent 3px 7px)" : undefined,
      }}
      aria-label={ft(corner === "red" ? "hud.redCorner" : "hud.blueCorner")}
    >
      {ft(corner === "red" ? "hud.redBadge" : "hud.blueBadge")}
    </span>
  );
}

function FighterPanel({ f, name, me, side }: { f: FighterView; name: string; me: boolean; side: "left" | "right" }) {
  const right = side === "right";
  return (
    <div className={`${glass} flex min-w-0 flex-1 flex-col gap-1 px-3 py-2 phone:px-2 phone:py-1.5`}>
      <div className={`flex items-center gap-2 ${right ? "flex-row-reverse" : ""}`}>
        <Badge corner={f.corner} />
        <span className={`min-w-0 flex-1 truncate font-display text-base font-black phone:text-sm ${right ? "text-right" : ""}`}>
          {name}
          {me && <span className="ml-1.5 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase">{ft("hud.you")}</span>}
        </span>
        <span className="font-display text-3xl font-black tabular-nums leading-none phone:text-2xl" aria-label={ft("hud.points")}>
          {f.points}
        </span>
      </div>
      <Meter value={f.stamina} label={ft("hud.stamina")} tone="stamina" flip={right} />
      <Meter value={f.composure} label={ft("hud.composure")} tone="composure" flip={right} />
      <DamageBars f={f} flip={right} />
      {(((f as { deductions?: number }).deductions ?? 0) > 0 || ((f as { cautions?: number }).cautions ?? 0) > 0) && (
        <div className={`flex gap-2 text-[10px] font-bold uppercase text-on-glass-muted ${right ? "justify-end" : ""}`}>
          {((f as { cautions?: number }).cautions ?? 0) > 0 && <span>{ft("hud.caution")} {(f as { cautions?: number }).cautions}</span>}
          {((f as { deductions?: number }).deductions ?? 0) > 0 && <span className="text-danger">−{(f as { deductions?: number }).deductions}</span>}
        </div>
      )}
      {f.warnings > 0 && (
        <div className={`flex gap-1 ${right ? "justify-end" : ""}`} aria-label={`${ft("hud.warning")} ${f.warnings}`}>
          {Array.from({ length: Math.min(5, f.warnings) }, (_, i) => (
            <Flag key={i} size={12} className="text-warning" />
          ))}
        </div>
      )}
    </div>
  );
}

function CenterClock({ snap, practiceLevel, me }: { snap: BoxingSnapshot; practiceLevel?: number; me: 0 | 1 }) {
  const held = useRef(0);
  const stats = useFightUi((s) => s.stats);
  const live = liveRound(stats, me);
  if (snap.phase === "round") held.current = snap.left;
  const label =
    snap.phase === "rest"
      ? ft("hud.rest")
      : snap.phase === "countdown"
        ? ft("hud.countdown")
        : snap.phase === "intro"
          ? ft("hud.intro")
          : snap.phase === "paused"
            ? ft("hud.paused")
            : ft("hud.round", { n: Math.max(1, snap.round), total: snap.rounds });
  return (
    <div className={`${glass} flex shrink-0 flex-col items-center px-4 py-1.5 phone:px-3 phone:py-1`}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-on-glass-muted">{label}</span>
      <span className="font-display text-3xl font-black tabular-nums leading-tight phone:text-2xl">
        {snap.phase === "knockdown" ? clock(held.current) : clock(snap.left)}
      </span>
      {live && (snap.phase === "round" || snap.phase === "knockdown") ? (
        <span
          className="rounded px-1.5 text-[11px] font-black tabular-nums"
          style={{ background: live.mine > live.theirs ? "#15803d" : live.mine < live.theirs ? "#b42318" : "rgb(255 255 255 / 0.15)" }}
          aria-label={ft("hud.liveRoundLabel", { a: live.mine, b: live.theirs })}
          data-live-round
        >
          {ft("hud.liveRound", { n: live.round })} {live.mine}–{live.theirs}
        </span>
      ) : (
        practiceLevel !== undefined && <span className="text-[10px] font-bold text-on-glass-muted">{ft("hud.practiceLevel", { n: practiceLevel })}</span>
      )}
    </div>
  );
}

/** big centre cards: bell / end of round / knockdown count / stoppage; small pops: combo, counter, block, warnings */
function Callouts({ snap, me, now }: { snap: BoxingSnapshot; me: 0 | 1; now: number }) {
  const feed = useFightUi((s) => s.feed);
  const hintKey = useFightUi((s) => s.hintKey);
  const hintAt = useFightUi((s) => s.hintAt);
  let card: { title: string; sub?: string; why?: string; tone?: "me" | "them" | "even" } | null = null;
  const pops: { id: number; text: string; good: boolean }[] = [];
  const phone = typeof window !== "undefined" && window.matchMedia?.("(max-height: 500px) and (pointer: coarse)").matches;
  /** every punch's outcome (P3-FGT-09): my punches big, theirs smaller, one colour per outcome */
  const outs: { id: number; word: string; sub: string; color: string; mine: boolean }[] = [];
  for (const { e, at, id } of feed) {
    const age = now - at;
    if (e.k === "bell" && age < 1600) card = { title: ft("hud.bell", { n: e.round }) };
    if (e.k === "roundEnd" && age < 4200) {
      // who took the round on the cards, and why (P3-FGT-09)
      const v = roundVerdict(e, useFightUi.getState().stats.rounds.find((r) => r.round === e.round), me);
      const n = v.votes[0] + v.votes[1] + v.votes[2];
      card = {
        title: ft(v.winner === "me" ? "round.youWon" : v.winner === "them" ? "round.theyWon" : "round.even"),
        sub: `${ft("hud.roundEnd", { n: e.round })} · ${roundCardText(e, me)}`,
        why: [n > 1 ? ft("round.votes", { a: v.winner === "them" ? v.votes[1] : v.votes[0], n }) : "", ...v.reasons.map(reasonText)].filter(Boolean).join(" · "),
        tone: v.winner,
      };
    }
    if (e.k === "stoppage" && age < 3000) card = { title: ft("hud.stoppage") };
    const k = e.k as string;
    if (k === "ko" && age < 3500) card = { title: ft("hud.ko") };
    if (k === "dq" && age < 3500) card = { title: ft("hud.dq") };
    if (k === "break" && age < 1200) card = { title: ft("hud.break") };
    if (age > 1400) continue;
    // every punch's outcome and why it scored or not (P3-FGT-07 reasons, P3-FGT-09 words + colours)
    const pv = age < 900 ? punchVerdict(e, me) : null;
    if (pv) {
      const why =
        pv.outcome === "landed" || pv.outcome === "counter"
          ? e.k === "hit" && e.combo >= 2
            ? ft("hud.combo", { n: e.combo })
            : e.k === "hit" && e.counter
              ? ft("hud.counter")
              : ft("out.points", { n: pv.points })
          : pv.mine
            ? ft(
                pv.outcome === "blocked"
                  ? "hud.onGuard"
                  : pv.outcome === "parried"
                    ? "hud.theyParried"
                    : pv.outcome === "slipped" || pv.outcome === "ducked"
                      ? "hud.theySlipped"
                      : pv.offLine
                        ? "hud.offLine"
                        : "hud.missedFar",
              )
            : "";
      outs.push({ id, word: ft(`out.${pv.outcome}` as FgKey), sub: pv.mine ? why : ft("out.theirs", { punch: ft(actionKey(pv.punch)) }), color: OUTCOME_COLOR[pv.outcome], mine: pv.mine });
    }
    if (e.k === "secondWind" && age < 1600) pops.push({ id, text: ft(e.to === me ? "life.secondWind" : "life.theirSecondWind"), good: e.to === me });
    if (e.k === "warning" && age < 1400 && e.to === me)
      pops.push({
        id,
        text: warningText(e),
        good: false,
      });
  }
  if (hintKey && now - hintAt < 1000) pops.push({ id: -1, text: ft(hintKey as FgKey), good: false });
  const breakLeft = (snap as { breakLeft?: number }).breakLeft ?? 0;
  if (breakLeft > 0) pops.push({ id: -2, text: ft("hud.waitBreak"), good: false });
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[28%] flex flex-col items-center gap-2 phone:top-[21%]">
      {snap.phase === "knockdown" && snap.count !== undefined && (
        <div className={`${glass} flex flex-col items-center px-8 py-3 phone:px-4 phone:py-1`} role="status" aria-live="assertive">
          <span className="text-xs font-bold uppercase tracking-widest text-on-glass-muted">{ft(snap.counted?.standing ? "life.standing" : "hud.knockdown")}</span>
          <span className="font-display text-6xl font-black tabular-nums phone:text-3xl">{snap.count}</span>
        </div>
      )}
      <GetUpPanel snap={snap} me={me} now={now} touch={!!phone} />
      {!card && <CornerCard snap={snap} me={me} />}
      {snap.phase !== "knockdown" && card && (
        <div
          className={`${glass} gk-fade-up flex flex-col items-center px-8 py-3 phone:px-4 phone:py-1.5`}
          role="status"
          data-round-card={card.tone ?? ""}
          style={card.tone ? { boxShadow: `inset 0 -4px 0 ${card.tone === "me" ? "#22c55e" : card.tone === "them" ? "#ef4444" : "#a8a29e"}` } : undefined}
        >
          <span className="font-display text-3xl font-black phone:text-2xl">{card.title}</span>
          {card.sub && <span className="text-sm font-semibold text-on-glass-muted phone:text-xs">{card.sub}</span>}
          {card.why && <span className="text-sm font-bold phone:text-xs">{card.why}</span>}
        </div>
      )}
      {outs.length > 0 && snap.phase === "round" && (
        <div className="flex flex-col items-center gap-1" aria-live="polite" data-punch-outcome={outs.at(-1)!.word}>
          {outs.slice(phone ? -1 : -2).map((o) => (
            <span
              key={o.id}
              className={`gk-fade-up flex items-baseline gap-2 rounded-full px-4 font-display font-black uppercase tracking-wide text-black/90 ${o.mine ? "py-1 text-2xl phone:text-lg" : "py-0.5 text-base opacity-90 phone:text-sm"}`}
              style={{ background: o.color }}
            >
              {o.word}
              {o.sub && <span className="font-sans text-xs font-bold normal-case tracking-normal">{o.sub}</span>}
            </span>
          ))}
        </div>
      )}
      {snap.phase === "countdown" && (
        <div className={`${glass} px-6 py-2 font-display text-4xl font-black tabular-nums`}>{Math.max(1, Math.ceil(snap.left / TICK_HZ))}</div>
      )}
      {snap.phase === "paused" && (
        <div className={`${glass} max-w-sm px-5 py-3 text-center`} role="status">
          <p className="font-display text-xl font-black">{ft("hud.paused")}</p>
          <p className="text-sm text-on-glass-muted">{ft("hud.pausedSub")}</p>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2" aria-live="polite">
        {pops.filter((p, i) => !pops.slice(i + 1).some((q) => q.text === p.text)).slice(-3).map((p) => (
          <span
            key={p.id}
            className={`gk-fade-up rounded-full px-3 py-1 text-sm font-black text-white ${p.good ? "bg-success/85" : "bg-danger/85"}`}
          >
            {p.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function reasonText(r: RoundReason): string {
  return ft(`round.why.${r.k}` as FgKey, { a: r.mine, b: r.theirs });
}

/** the edge flash of a connection (P3-FGT-09): green when I land, red when I am hit; brief, never with reduced motion */
function HitFlash({ me, now }: { me: 0 | 1; now: number }) {
  const feed = useFightUi((s) => s.feed);
  const reduced = useFightPrefs((s) => s.reducedMotion);
  if (reduced) return null;
  const last = [...feed].reverse().find((f) => f.e.k === "hit" && now - f.at < 260);
  if (!last || last.e.k !== "hit") return null;
  const mine = last.e.by === me;
  const a = 1 - (now - last.at) / 260;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ boxShadow: `inset 0 0 ${mine ? 60 : 110}px ${mine ? 10 : 26}px ${mine ? "rgb(34 197 94 / " : "rgb(239 68 68 / "}${(0.55 * a).toFixed(2)})` }}
    />
  );
}

/** the low power / shaken warning (P3-FGT-09): the engine's stamina and composure, said plainly */
function PowerWarning({ snap, me }: { snap: BoxingSnapshot; me: 0 | 1 }) {
  if (snap.phase !== "round") return null;
  const f = snap.fighters[me];
  const text = f.composure < 300 ? ft("hud.shaken") : f.stamina < 300 ? ft("hud.lowPower") : null;
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[19%] -translate-x-1/2 phone:top-[27%]" role="status" data-power-warning>
      <span className="gk-pulse flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#b42318]/90 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">{text}</span>
    </div>
  );
}

/**
 * The corner refresh (P3-FGT-09): practice fights against the AI only, behind NEXT_PUBLIC_FF_FIGHT_BOOST. Once per round;
 * the stamina comes back only after the API confirmed the Stars spend. Never shown in a fight against a player.
 */
function CornerRefresh({ mine }: { mine: MyFight }) {
  const [state, setState] = useState<{ round: number; s: "idle" | "pending" | "done" | "failed" }>({ round: 0, s: "idle" });
  const snap = mine.snap;
  if (!BOOST_ON || mine.mode !== "practice" || !snap || (snap.phase !== "round" && snap.phase !== "rest")) return null;
  const round = Math.max(1, snap.round);
  const cur = state.round === round ? state.s : "idle";
  const used = cur === "done";
  return (
    <div className="pointer-events-auto absolute bottom-[22%] right-3 flex max-w-[15rem] flex-col items-end gap-1 phone:bottom-[40%] phone:right-2" data-corner-refresh={cur}>
      <button
        type="button"
        className="pbtn pbtn-primary !min-h-10 !px-3 !py-1 !text-xs"
        disabled={used || cur === "pending"}
        title={ft("boost.practiceOnly")}
        onClick={() => {
          setState({ round, s: "pending" });
          void buyCornerRefresh().then((r) => setState({ round, s: r.ok ? "done" : "failed" }));
        }}
      >
        <GlassWater size={16} />
        <span className="flex flex-col items-start leading-tight">
          <span>{ft(used ? "boost.used" : cur === "pending" ? "boost.pending" : "boost.label")}</span>
          {!used && cur !== "pending" && <span className="text-[10px] font-semibold opacity-90">{ft("boost.price", { n: CORNER_REFRESH_PRICE_STARS })} · +{CORNER_REFRESH_STAMINA}</span>}
        </span>
      </button>
      {cur === "failed" && <span className={`${glass} px-2 py-1 text-[11px] font-semibold`}>{ft("boost.failed")}</span>}
      {cur === "done" && <span className={`${glass} px-2 py-1 text-[11px] font-semibold`}>{ft("boost.done", { n: CORNER_REFRESH_STAMINA })}</span>}
    </div>
  );
}

/** camera choice (P3-FGT-09): side broadcast (default), behind your boxer, or auto */
function CameraToggle() {
  const cam = useWorldUi((s) => s.fightCam);
  const next = cam === "fight" ? "behind" : cam === "behind" ? "auto" : "fight";
  return (
    <button
      type="button"
      className={`${glass} icon-button pointer-events-auto flex h-12 shrink-0 items-center gap-1.5 px-3 text-xs font-bold phone:h-10 phone:px-2`}
      aria-label={`${ft("cam.label")}: ${ft(`cam.${cam}` as FgKey)}`}
      onClick={() => useWorldUi.getState().set({ fightCam: next })}
    >
      <Video size={16} /> <span className="phone:hidden">{ft(`cam.${cam}` as FgKey)}</span>
    </button>
  );
}

/** foul pop: the referee's words for the foul and the ladder level (scoring rules), older events fall back */
function warningText(e: Extract<FightEvent, { k: "warning" }>): string {
  const level = (e as { level?: string }).level;
  const foul = fst(foulText(e.foul as never) as FsKey) ?? ft(foulKey(e.foul));
  if (level) return `${fst(levelText(level as never))}: ${foul}`;
  return `${ft("hud.warning")}: ${foul}${e.penalty ? ` · ${ft("hud.penalty", { n: e.penalty })}` : ""}`;
}
/** end-of-round card: the judges' cards when scoring is open ("10–9 · 10–9 · …" from my side), else the points */
function roundCardText(e: Extract<FightEvent, { k: "roundEnd" }>, me: 0 | 1): string {
  const card = (e as { card?: { judges?: [number, number][] } }).card;
  if (card?.judges?.length) return `${ft("hud.judges")}: ${card.judges.map((j) => `${j[me]}–${j[1 - me]}`).join(" · ")}`;
  return ft("hud.roundScore", { a: e.points[me], b: e.points[1 - me]! });
}

/** the referee / corner line under the scoreboard (captions are always on) */
function Caption({ now, hide }: { now: number; hide?: boolean }) {
  const c = useFightUi((s) => s.caption);
  if (!c || now - c.at > 2600 || hide) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[19%] flex justify-center phone:top-[24%]" aria-live="polite">
      <div className={`${glass} gk-fade-up flex items-center gap-2 px-4 py-1.5 text-sm font-bold phone:text-xs`}>
        <Megaphone size={14} className="text-gold" />
        <span className="text-on-glass-muted">{ft(c.who === "referee" ? "caption.referee" : "caption.corner")}</span>
        <span>{c.text}</span>
      </div>
    </div>
  );
}

/** instant feedback for every press: what you pressed, then the engine's verdict (confirmed / queued / dropped) */
function PressChip({ now }: { now: number }) {
  const p = useFightUi((s) => s.press);
  if (!p || now - p.at > 900) return null;
  const icon = p.state === "confirmed" ? <Check size={14} /> : p.state === "buffered" ? <Hourglass size={14} /> : null;
  const tone = p.state === "confirmed" ? "bg-success/85" : p.state === "dropped" ? "bg-danger/75" : "bg-black/55";
  return (
    <div className="pointer-events-none absolute bottom-[8%] left-1/2 -translate-x-1/2 phone:bottom-[3%]" data-press-state={p.state} data-press-action={p.a}>
      <span key={p.n} className={`gk-fade-up flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black text-white ${tone}`}>
        {icon}
        {ft(actionKey(p.a))}
        {p.state === "buffered" && <span className="font-semibold opacity-80">· {ft("hud.buffered")}</span>}
      </span>
    </div>
  );
}

function ReplayBadge() {
  const playing = useReplay((s) => s.playing);
  if (!playing) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[19%] flex -translate-x-1/2 items-center gap-2">
      <span className={`${glass} flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wide`}>
        <Clapperboard size={14} /> {ft("result.replaying")}
      </span>
      <button type="button" className="pbtn pbtn-primary !min-h-9 !px-3 !py-1 !text-xs" onClick={stopReplay}>
        <Square size={14} /> {ft("result.highlightsStop")}
      </button>
    </div>
  );
}

/**
 * The coach (P3-FGT-07, coach.ts): one short tip, only when the player is stuck (idle, missing, on the guard, getting
 * hit, out of breath), rate-limited, a single line above the press chip (clear of the thumbs on phones). Off in
 * Settings; never during the first-fight tutorial (it already guides).
 */
function Coach({ snap, me, now }: { snap: BoxingSnapshot; me: 0 | 1; now: number }) {
  const on = useFightPrefs((s) => s.coach);
  const tutorialDone = useFightPrefs((s) => s.tutorialDone);
  const st = useRef({ tip: null as CoachTip | null, at: -1e9, history: {} as Partial<Record<CoachTip, number>>, roundAt: 0, round: -1, phase: "" });
  const S = st.current;
  if (snap.round !== S.round || (snap.phase === "round" && S.phase !== "round")) {
    S.round = snap.round;
    S.roundAt = now;
  }
  S.phase = snap.phase;
  if (on && tutorialDone && now - S.at > COACH_SHOW_MS) {
    const ui = useFightUi.getState();
    const tip = coachTip({ snap, me, feed: ui.feed, now, lastPress: Math.max(ui.press?.at ?? 0, S.roundAt), roundAge: now - S.roundAt });
    if (tip && coachMayShow(tip, now, S, S.history)) {
      S.tip = tip;
      S.at = now;
      S.history[tip] = now;
    }
  }
  if (!on || !S.tip || now - S.at > COACH_SHOW_MS || snap.phase !== "round") return null;
  return (
    <div className="pointer-events-none absolute bottom-[15%] left-1/2 w-max max-w-[min(30rem,70vw)] -translate-x-1/2 phone:bottom-[13%]" role="status" aria-live="polite">
      <div key={S.at} className={`${glass} gk-fade-up flex items-center gap-2 px-4 py-2 text-sm font-semibold phone:px-3 phone:py-1 phone:text-xs`}>
        <GraduationCap size={15} className="shrink-0 text-gold" />
        <span className="sr-only">{ft("coach.label")}: </span>
        <span>{ft(S.tip)}</span>
      </div>
    </div>
  );
}

function ResultCard({ mine, onLeave }: { mine: MyFight; onLeave: () => void }) {
  const result = useFightUi((s) => s.result);
  const stats = useFightUi((s) => s.stats);
  const record = useFightUi((s) => s.record);
  const skill = useFightUi((s) => s.skill);
  if (!result) return null;
  const me = mine.corner === "red" ? 0 : 1;
  const practice = mine.mode === "practice";
  const level = mine.level ?? 3;
  const name = mine.names?.[0] ?? "";
  const names: [string, string] = [mine.names?.[0] || ft("hud.redCorner"), mine.names?.[1] || (practice ? ft("hud.practiceLevel", { n: level }) : ft("hud.blueCorner"))];
  const passed = practice && judgeGoal(levelGoal(level), result, stats, me).pass;
  const settledLine = practice ? (
    <p className="pnote text-center text-xs">{ft("result.practiceNote")}</p>
  ) : mine.settled ? (
    <p className="text-center font-bold">
      <span className={mine.settled.stars >= 0 ? "text-[var(--plus)]" : "text-[var(--minus)]"}>{ft("result.stars", { n: `${mine.settled.stars >= 0 ? "+" : "−"}${Math.abs(mine.settled.stars)}` })}</span>
      {" · "}
      {ft("result.xp", { n: mine.settled.xp })}
    </p>
  ) : null;
  return (
    <ResultPanel
      result={result}
      me={me}
      names={names}
      stats={stats}
      practiceLevel={practice ? level : undefined}
      record={record}
      settledLine={settledLine}
      skill={skill}
      live={!practice}
      actions={{
        retry: practice ? () => startPractice(mine.ring, level, name) : undefined,
        nextLevel: practice && passed && level < 5 ? () => startPractice(mine.ring, level + 1, name) : undefined,
        findOpponent: () => {
          onLeave();
          gameFightActions.quick(0);
        },
        leave: onLeave,
      }}
    />
  );
}

function LeaveDialog({ mine, onStay, onLeave }: { mine: MyFight; onStay: () => void; onLeave: () => void }) {
  const text =
    mine.mode === "practice"
      ? ft("leave.practice")
      : !mine.begun
        ? ft("leave.beforeStart")
        : mine.stake > 0
          ? ft("leave.forfeit", { n: mine.stake * 2 })
          : ft("leave.forfeitFriendly");
  const forfeit = mine.mode === "live" && mine.begun;
  return (
    <Modal onClose={onStay} label={ft("leave.title")} title={ft("leave.title")} icon={DoorOpen}>
      <div className="flex flex-col gap-4">
        <p className="text-sm font-semibold">{text}</p>
        <div className="flex gap-2">
          <button type="button" className="pbtn pbtn-primary flex-1" data-autofocus onClick={onStay}>
            {ft("leave.stay")}
          </button>
          <button type="button" className={`pbtn flex-1 ${forfeit ? "pbtn-danger" : "pbtn-secondary"}`} onClick={onLeave}>
            {ft("leave.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function FightHud() {
  const mine = useFightBridge((s) => s.mine);
  const [leaving, setLeaving] = useState(false);
  const [settings, setSettings] = useState(false);
  const replaying = useReplay((s) => s.playing);
  // the result card waits ~3.5 s: the bell, the referee raising the winner's hand, the crowd (P3-FGT-05)
  const overAt = useRef<number | null>(null);
  const phaseNow = mine?.snap?.phase;
  if (phaseNow === "over" && overAt.current === null) overAt.current = typeof performance !== "undefined" ? performance.now() : 0;
  if (phaseNow !== "over") overAt.current = null;
  const now = useNow(100);
  const ceremony = overAt.current !== null && now - overAt.current < 3500;
  const feed = useFightUi((s) => s.feed);
  // only events that arrive while this HUD is up make a sound: a HUD that (re)mounts mid-fight must not replay the
  // whole recent feed as a burst of sounds
  const played = useRef<number>(useFightUi.getState().feed.at(-1)?.id ?? 0);
  const me: 0 | 1 = mine?.corner === "blue" ? 1 : 0;

  // sounds / haptics on new events (never on predictions)
  useEffect(() => {
    for (const { e, id } of feed) {
      if (id <= played.current) continue;
      played.current = id;
      eventFx(e, me, useFightBridge.getState().mine?.snap);
    }
  }, [feed, me]);

  if (!mine?.snap) return null;
  const snap = mine.snap;
  const names: [string, string] = [
    mine.names?.[0] || ft("hud.redCorner"),
    mine.names?.[1] || (mine.mode === "practice" ? ft("hud.practiceLevel", { n: mine.level ?? 1 }) : ft("hud.blueCorner")),
  ];
  const leave = () => {
    setLeaving(false);
    gameFightActions.leave();
  };
  return (
    <div className="pointer-events-none absolute inset-0 text-white">
      <div className="absolute inset-x-0 top-0 flex items-start gap-2 p-3 phone:gap-1.5 phone:p-2">
        <button
          type="button"
          className={`${glass} icon-button pointer-events-auto flex h-12 shrink-0 items-center gap-1.5 px-3 text-sm font-bold phone:h-10`}
          onClick={() => (snap.phase === "over" ? leave() : setLeaving(true))}
        >
          <DoorOpen size={18} /> <span className="phone:hidden">{ft("hud.leave")}</span>
        </button>
        <FighterPanel f={snap.fighters[0]} name={names[0]} me={me === 0} side="left" />
        <CenterClock snap={snap} me={me} practiceLevel={mine.mode === "practice" ? mine.level : undefined} />
        <FighterPanel f={snap.fighters[1]} name={names[1]} me={me === 1} side="right" />
        <CameraToggle />
        <button
          type="button"
          aria-label={ft("hud.settings")}
          className={`${glass} icon-button pointer-events-auto grid size-12 shrink-0 place-items-center phone:size-10`}
          onClick={() => setSettings(true)}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>
      <HitFlash me={me} now={now} />
      <Callouts snap={snap} me={me} now={now} />
      <PowerWarning snap={snap} me={me} />
      <CornerRefresh mine={mine} />
      <Caption now={now} hide={snap.phase === "knockdown" && useFightUi.getState().caption?.who === "referee"} />
      <PressChip now={now} />
      <Coach snap={snap} me={me} now={now} />
      <ReplayBadge />
      <div className="pointer-events-auto">
        {snap.phase === "over" && !replaying && !ceremony && <ResultCard mine={mine} onLeave={leave} />}
        {leaving && snap.phase !== "over" && <LeaveDialog mine={mine} onStay={() => setLeaving(false)} onLeave={leave} />}
        {settings && <FightSettings live={mine.mode === "live"} onClose={() => setSettings(false)} />}
      </div>
    </div>
  );
}
