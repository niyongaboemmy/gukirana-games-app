"use client";
import { useEffect, useRef, useState } from "react";
import { DoorOpen, Flag, RotateCcw, SlidersHorizontal, Trophy } from "lucide-react";
import { CORNER_COLORS, TICK_HZ, type BoxingSnapshot, type Corner, type FighterView } from "@gukirana/contracts";
import { Modal } from "@/games/GameShell";
import { useFightBridge, type MyFight } from "../bridge";
import { gameFightActions, startPractice } from "./actions";
import { eventFx } from "./fx";
import { FightSettings } from "./FightSettings";
import { decisionKey, foulKey, ft, type FgKey } from "./strings";
import { useFightUi } from "./ui-store";

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
  const color = tone === "stamina" ? (low ? "#f59e0b" : "#22c55e") : low ? "#ef4444" : "#f2f3f5";
  return (
    <div className="flex items-center gap-1.5" aria-label={`${label} ${Math.round(pct)}%`}>
      <span className={`w-14 shrink-0 text-[10px] font-bold uppercase tracking-wide text-on-glass-muted phone:hidden ${flip ? "order-2 text-right" : ""}`}>
        {label}
      </span>
      <div className={`relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/12 phone:h-2 ${flip ? "rotate-180" : ""}`}>
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150" style={{ width: `${pct}%`, background: color }} />
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

function CenterClock({ snap, practiceLevel }: { snap: BoxingSnapshot; practiceLevel?: number }) {
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
        {snap.phase === "knockdown" ? clock(0) : clock(snap.left)}
      </span>
      {practiceLevel !== undefined && (
        <span className="text-[10px] font-bold text-on-glass-muted">{ft("hud.practiceLevel", { n: practiceLevel })}</span>
      )}
    </div>
  );
}

/** big centre cards: bell / end of round / knockdown count / stoppage; small pops: combo, counter, block, warnings */
function Callouts({ snap, me, now }: { snap: BoxingSnapshot; me: 0 | 1; now: number }) {
  const feed = useFightUi((s) => s.feed);
  const hintKey = useFightUi((s) => s.hintKey);
  const hintAt = useFightUi((s) => s.hintAt);
  let card: { title: string; sub?: string } | null = null;
  const pops: { id: number; text: string; good: boolean }[] = [];
  for (const { e, at, id } of feed) {
    const age = now - at;
    if (e.k === "bell" && age < 1600) card = { title: ft("hud.bell", { n: e.round }) };
    if (e.k === "roundEnd" && age < 2600)
      card = { title: ft("hud.roundEnd", { n: e.round }), sub: ft("hud.roundScore", { a: e.points[me], b: e.points[1 - me]! }) };
    if (e.k === "stoppage" && age < 3000) card = { title: ft("hud.stoppage") };
    if (age > 1400) continue;
    if (e.k === "hit" && e.by === me) {
      if (e.combo >= 2) pops.push({ id, text: ft("hud.combo", { n: e.combo }), good: true });
      else if (e.counter) pops.push({ id, text: ft("hud.counter"), good: true });
    }
    if (e.k === "block" && e.by !== me) pops.push({ id, text: ft("hud.blocked"), good: true });
    if (e.k === "evade" && e.by !== me) pops.push({ id, text: ft("hud.evaded"), good: true });
    if (e.k === "whiff" && e.by === me) pops.push({ id, text: ft("hud.missed"), good: false });
    if (e.k === "warning" && age < 1400 && e.to === me)
      pops.push({
        id,
        text: `${ft("hud.warning")}: ${ft(foulKey(e.foul))}${e.penalty ? ` · ${ft("hud.penalty", { n: e.penalty })}` : ""}`,
        good: false,
      });
  }
  if (hintKey && now - hintAt < 1000) pops.push({ id: -1, text: ft(hintKey as FgKey), good: false });
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[28%] flex flex-col items-center gap-2 phone:top-[30%]">
      {snap.phase === "knockdown" && snap.count !== undefined && (
        <div className={`${glass} flex flex-col items-center px-8 py-3`} role="status" aria-live="assertive">
          <span className="text-xs font-bold uppercase tracking-widest text-on-glass-muted">{ft("hud.knockdown")}</span>
          <span className="font-display text-6xl font-black tabular-nums phone:text-5xl">{snap.count}</span>
        </div>
      )}
      {snap.phase !== "knockdown" && card && (
        <div className={`${glass} gk-fade-up flex flex-col items-center px-8 py-3`} role="status">
          <span className="font-display text-3xl font-black phone:text-2xl">{card.title}</span>
          {card.sub && <span className="text-sm font-semibold text-on-glass-muted">{card.sub}</span>}
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
        {pops.slice(-3).map((p) => (
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

function ResultCard({ mine, onLeave }: { mine: MyFight; onLeave: () => void }) {
  const result = useFightUi((s) => s.result);
  if (!result) return null;
  const me = mine.corner === "red" ? 0 : 1;
  const won = result.winner === me;
  const title =
    result.decision === "void" ? ft("result.void") : result.winner === null ? ft("result.draw") : won ? ft("result.win") : ft("result.loss");
  const practice = mine.mode === "practice";
  return (
    <Modal label={title} title={title} icon={Trophy}>
      <div className="flex flex-col gap-3">
        <p className="text-center text-sm font-semibold">{ft(decisionKey(result.decision))}</p>
        <p className="text-center font-display text-4xl font-black tabular-nums">
          {ft("result.score", { a: result.points[me], b: result.points[1 - me]! })}
        </p>
        <div className="plist">
          <div className="prow">
            <span className="prow-title">{ft("result.rounds")}</span>
            <span className="prow-sub ml-auto tabular-nums">{result.rounds.map((r) => `${r[me]}–${r[1 - me]}`).join(" · ")}</span>
          </div>
          <div className="prow">
            <span className="prow-title">{ft("result.knockdowns")}</span>
            <span className="prow-sub ml-auto tabular-nums">
              {result.knockdowns[1 - me]} – {result.knockdowns[me]}
            </span>
          </div>
          <div className="prow">
            <span className="prow-title">{ft("result.power")}</span>
            <span className="prow-sub ml-auto tabular-nums">
              {result.power[me]} – {result.power[1 - me]}
            </span>
          </div>
        </div>
        {practice ? (
          <p className="pnote text-center text-sm">{ft("result.practiceNote")}</p>
        ) : (
          mine.settled && (
            <p className="text-center font-bold">
              <span className={mine.settled.stars >= 0 ? "text-[var(--plus)]" : "text-[var(--minus)]"}>
                {ft("result.stars", { n: `${mine.settled.stars >= 0 ? "+" : "−"}${Math.abs(mine.settled.stars)}` })}
              </span>
              {" · "}
              {ft("result.xp", { n: mine.settled.xp })}
            </p>
          )
        )}
        <div className="flex gap-2">
          {practice && (
            <button type="button" className="pbtn pbtn-primary flex-1" data-autofocus onClick={() => startPractice(mine.ring, mine.level ?? 3, mine.names?.[0] ?? "")}>
              <RotateCcw size={18} /> {ft("result.again")}
            </button>
          )}
          <button type="button" className={`pbtn flex-1 ${practice ? "pbtn-secondary" : "pbtn-primary"}`} onClick={onLeave}>
            <DoorOpen size={18} /> {ft("result.leave")}
          </button>
        </div>
      </div>
    </Modal>
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
  const now = useNow(100);
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
      eventFx(e, me);
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
        <CenterClock snap={snap} practiceLevel={mine.mode === "practice" ? mine.level : undefined} />
        <FighterPanel f={snap.fighters[1]} name={names[1]} me={me === 1} side="right" />
        <button
          type="button"
          aria-label={ft("hud.settings")}
          className={`${glass} icon-button pointer-events-auto grid size-12 shrink-0 place-items-center phone:size-10`}
          onClick={() => setSettings(true)}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>
      <Callouts snap={snap} me={me} now={now} />
      <div className="pointer-events-auto">
        {snap.phase === "over" && <ResultCard mine={mine} onLeave={leave} />}
        {leaving && snap.phase !== "over" && <LeaveDialog mine={mine} onStay={() => setLeaving(false)} onLeave={leave} />}
        {settings && <FightSettings live={mine.mode === "live"} onClose={() => setSettings(false)} />}
      </div>
    </div>
  );
}
