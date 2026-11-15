"use client";
import type { Punch } from "@gukirana/contracts";
import type { BoxingSnapshot, FightEvent } from "@gukirana/contracts";
import { bell, buzz, crowdReact, outcomeCue, punchSound, say } from "./audio";
import { punchVerdict } from "./outcome";
import { foulKey, ft, type FgKey } from "./strings";
import { useFightUi } from "./ui-store";
import { foulText, fst } from "./scoring-strings";

/**
 * What an event of my fight sounds and feels like (P3-FGT-05). Played on engine events only — never on a predicted
 * hit (plan §3.3). The referee's calls and the corner's advice are captioned (always) and spoken (voices on).
 */
const line = (key: FgKey, who: "referee" | "corner", vars?: Record<string, string | number>) => {
  const text = ft(key, vars);
  useFightUi.getState().captionSet(text, who);
  say(text, who);
};
let cornerTimer: ReturnType<typeof setTimeout> | null = null;
/** minimum gap between two sounds of the same kind (ms): a flurry of blocks is one tap (P3-FGT-04 rule) */
const GAP: Record<string, number> = { hit: 110, block: 160, whiff: 200, evade: 200, knockdown: 1500, bell: 1200, roundEnd: 1200 };
const lastAt: Record<string, number> = {};
const due = (k: string) => {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (now - (lastAt[k] ?? -1e9) < (GAP[k] ?? 0)) return false;
  lastAt[k] = now;
  return true;
};

/** the corner's advice between rounds: from the round's score and the fighter's state (no randomness) */
export function cornerLine(snap: BoxingSnapshot | null | undefined, me: 0 | 1, round: [number, number]): FgKey {
  const f = snap?.fighters[me];
  if (f && f.knockdowns > 0 && round[me] < round[1 - me]!) return "corner.down";
  if (f && f.stamina < 400) return "corner.tired";
  if (round[me] > round[1 - me]!) return "corner.ahead";
  if (round[me] < round[1 - me]!) return "corner.behind";
  return "corner.even";
}

/** play the feedback of one event for the local fighter `me` */
export function eventFx(e: FightEvent, me: 0 | 1, snap?: BoxingSnapshot | null): void {
  const mine = "by" in e ? e.by === me : "to" in e ? e.to === me : false;
  const k = e.k as string;
  // my punch's outcome tone (P3-FGT-09), one per punch, before the flurry throttle
  const v = punchVerdict(e, me);
  if (v?.mine) outcomeCue(v.outcome);
  if (!due(k)) return;
  switch (e.k) {
    case "bell":
      bell(1);
      line("voice.box", "referee");
      crowdReact("roar");
      break;
    case "roundEnd":
      bell(3);
      line("voice.time", "referee");
      if (cornerTimer) clearTimeout(cornerTimer);
      cornerTimer = setTimeout(() => line(cornerLine(snap, me, e.points), "corner"), 3200);
      break;
    case "hit": {
      punchSound(soundOf(e.punch), "hit", e.t, true);
      const big = (e.punch === "hook" || e.punch === "uppercut") && e.points >= 3;
      if (big || e.combo >= 3) crowdReact("roar");
      buzz(mine ? 14 : big ? 45 : 28, mine ? 0.3 : big ? 1 : 0.6);
      break;
    }
    case "block":
    case "parry":
      punchSound(soundOf(e.punch), "block", e.t, true);
      if (!mine) buzz(10, 0.25);
      break;
    case "whiff":
    case "evade":
      punchSound(soundOf(e.punch), "whiff", e.t, true);
      break;
    case "knockdown":
      crowdReact("ooh");
      buzz(80, 1);
      break;
    case "count":
      if (e.n >= 1 && e.n <= 10) line(`voice.count.${e.n}` as FgKey, "referee");
      break;
    case "up":
      line("voice.fightOn", "referee");
      break;
    case "warning":
      line("voice.warning", "referee", { foul: fst(foulText(e.foul)) ?? ft(foulKey(e.foul)) });
      break;
    case "stoppage":
      line("voice.stop", "referee");
      break;
    case "over": {
      crowdReact("cheer");
      const w = e.result.winner;
      setTimeout(() => line(w === null ? "voice.draw" : w === 0 ? "voice.winnerRed" : "voice.winnerBlue", "referee"), 1400);
      break;
    }
    default:
      // events added by the scoring rules (read defensively)
      if (k === "break") line("voice.break", "referee");
      if (k === "ko") line("voice.count.10", "referee");
      if (k === "dq") line("voice.stop", "referee");
      break;
  }
}

/** the punch sound set has one hook: the rear hook sounds like it (heavier by the engine's points already) */
function soundOf(p: Punch): Exclude<Punch, "rhook"> {
  return p === "rhook" ? "hook" : p;
}
