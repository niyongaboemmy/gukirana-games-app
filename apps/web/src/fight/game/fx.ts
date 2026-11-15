"use client";
import type { BoxingSnapshot, FightEvent } from "@gukirana/contracts";
import { bell, buzz, crowdReact, punchSound, say } from "./audio";
import { foulKey, ft, type FgKey } from "./strings";
import { useFightUi } from "./ui-store";

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
      punchSound(e.punch, "hit", e.t, true);
      const big = (e.punch === "hook" || e.punch === "uppercut") && e.points >= 3;
      if (big || e.combo >= 3) crowdReact("roar");
      buzz(mine ? 14 : big ? 45 : 28, mine ? 0.3 : big ? 1 : 0.6);
      break;
    }
    case "block":
      punchSound(e.punch, "block", e.t, true);
      if (!mine) buzz(10, 0.25);
      break;
    case "whiff":
    case "evade":
      punchSound(e.punch, "whiff", e.t, true);
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
      line("voice.warning", "referee", { foul: ft(foulKey(e.foul)) });
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
