import { PUNCH_SPECS, TIRED_STAMINA } from "@gukirana/boxing";
import type { BoxingSnapshot, FightEvent } from "@gukirana/contracts";
import type { FgKey } from "./strings";

/**
 * The in-fight coach (P3-FGT-07): one short, plain tip at a time, only when it helps — the player is standing idle,
 * keeps missing, keeps hitting the guard, keeps getting hit, or is out of breath. Rate-limited (one tip on screen,
 * a gap between tips, the same tip not again for a while) so a fight never turns into a wall of text, and silent
 * once the player is doing fine. Pure: the HUD feeds it the snapshot, the event feed and the last press time.
 */
export type CoachTip = Extract<FgKey, `coach.${string}`>;

export interface CoachInput {
  snap: Pick<BoxingSnapshot, "phase" | "dist" | "fighters">;
  me: 0 | 1;
  /** recent fight events with their local receive time (ms) */
  feed: readonly { e: FightEvent; at: number }[];
  /** ms: now and my last press (any action) */
  now: number;
  lastPress: number;
  /** ms since the round (or the fight) started: no tips in the first seconds */
  roundAge: number;
}

/** how far back the coach looks at what happened (ms) */
export const COACH_WINDOW = 6000;
/** idle this long in a live round before a nudge (ms) */
export const IDLE_NUDGE = 4500;

/** the tip that fits right now (null = nothing worth saying) */
export function coachTip(i: CoachInput): CoachTip | null {
  if (i.snap.phase !== "round" || i.roundAge < 2500) return null;
  const me = i.snap.fighters[i.me];
  const recent = i.feed.filter((f) => i.now - f.at < COACH_WINDOW).map((f) => f.e);
  const mine = (k: FightEvent["k"]) => recent.filter((e) => e.k === k && "by" in e && e.by === i.me).length;
  const theirs = (k: FightEvent["k"]) => recent.filter((e) => e.k === k && "by" in e && e.by !== i.me).length;
  const myHits = mine("hit");
  // out of breath: guard and let the stamina come back
  if (me.stamina < TIRED_STAMINA - 50) return "coach.tired";
  // taking shots with the hands down
  if (theirs("hit") >= 3 && !me.guard) return "coach.guardUp";
  // swinging at air
  if (mine("whiff") >= 2 && myHits === 0) return i.snap.dist > PUNCH_SPECS.jab.reach ? "coach.stepIn" : "coach.timing";
  // everything lands on the gloves
  if (mine("block") >= 3 && myHits === 0) return "coach.mixUp";
  // they keep slipping
  if (mine("evade") >= 2 && myHits === 0) return "coach.feint";
  // standing still in a live round
  if (i.now - i.lastPress > IDLE_NUDGE) return i.snap.dist > PUNCH_SPECS.jab.reach ? "coach.stepIn" : "coach.jab";
  // they throw, I never defend: a slip or a guard
  if (theirs("hit") >= 2 && mine("hit") === 0 && theirs("block") === 0 && theirs("evade") === 0) return "coach.defend";
  return null;
}

/** the rate limit: may a tip show now? (one at a time, GAP between tips, the same tip not again within REPEAT) */
export const COACH_SHOW_MS = 3200;
export const COACH_GAP_MS = 7000;
export const COACH_REPEAT_MS = 25000;
export function coachMayShow(tip: CoachTip, now: number, last: { tip: CoachTip | null; at: number }, history: Partial<Record<CoachTip, number>>): boolean {
  if (now - last.at < COACH_SHOW_MS + COACH_GAP_MS) return false;
  const prev = history[tip];
  return prev === undefined || now - prev > COACH_REPEAT_MS;
}
