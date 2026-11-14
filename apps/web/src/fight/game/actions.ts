"use client";
import type { BoxingAction, RingId } from "@gukirana/contracts";
import { createFairRng, newSeed } from "@gukirana/fairness";
import type { BotLevel } from "@gukirana/boxing";
import { useFightBridge } from "../bridge";
import { PracticeRunner, PracticeSession } from "./practice";
import { practiceHz, useFightPrefs } from "./prefs";
import { useFightUi } from "./ui-store";

/**
 * The boxing game side of the ring prompts (FIGHT-GAMES-PLAN §7.2, §12 Do 5). W's prompts call these (through the
 * `fightActions` interface in apps/web/src/fight/actions.ts); practice is implemented here, the live calls are
 * forwarded to the hall-room / fight-room client that G2 registers from fight/game/net/ (`registerLiveFight`).
 */
export interface GameFightActions {
  /** wait for an opponent in a free ring (stake 0 = friendly) */
  claim(ring: RingId, stake: number): void;
  /** take the blue corner of a waiting ring */
  join(ring: RingId): void;
  /** step out of the ring I hold (waiting / practice / after the result); a live fight goes through the Leave dialog */
  leave(): void;
  quick(stake: number): void;
  quickCancel(): void;
  /** practice vs the AI in a free ring (local engine, no stake, never counted) */
  practice(ring: RingId, level: number): void;
  watch(ring: RingId | null): void;
}

/** what the live client (G2, fight/game/net/) plugs in. Every member is optional until it lands. */
export interface LiveFight {
  claim?(ring: RingId, stake: number): void;
  join?(ring: RingId): void;
  /** leave the ring / forfeit-or-void the live fight per exit rules (the server decides which) */
  leave?(): void;
  quick?(stake: number): void;
  quickCancel?(): void;
  watch?(ring: RingId | null): void;
  /** hall room: this ring is now my practice ring (status `practice`) */
  practiceStart?(ring: RingId): void;
  /** hall room: practice summary for spectators (`boxing-practice-score`) */
  practiceScore?(ring: RingId, round: number, score: [number, number]): void;
  /** live fight controls (`in` messages): one press, guard held state */
  press?(a: BoxingAction): void;
  guard?(g: boolean): void;
}
let live: LiveFight = {};
/** G2: register the live client (call again with {} to unregister) */
export function registerLiveFight(impl: LiveFight): void {
  live = impl;
}

/* ------------------------------------------------------------ practice ------------------------------------------------------------ */

let session: PracticeSession | null = null;
let runner: PracticeRunner | null = null;
let unsubSpeed: (() => void) | null = null;

const clampLevel = (n: number): BotLevel => Math.min(5, Math.max(1, Math.round(n))) as BotLevel;

/** start (or restart) a practice fight in `ring` against the AI at `level` */
export function startPractice(ring: RingId, level: number, name = ""): PracticeSession {
  stopPractice(false);
  const seed = newSeed();
  // practice AI variety only; the fight itself has no randomness (plan §3.1)
  const rng = createFairRng(seed, [newSeed()], `practice-boxing-${ring}-${seed.slice(0, 8)}`);
  useFightUi.getState().clear();
  session = new PracticeSession({
    ring,
    level: clampLevel(level),
    rng,
    name,
    onRoundEnd: (round, score) => live.practiceScore?.(ring, round, score),
  });
  runner = new PracticeRunner(session, practiceHz(useFightPrefs.getState().speed));
  runner.run();
  unsubSpeed = useFightPrefs.subscribe((p) => runner?.setHz(practiceHz(p.speed)));
  live.practiceStart?.(ring);
  return session;
}

/** end the practice fight; `clear` also removes it from the bridge (the player stepped out) */
export function stopPractice(clear = true): void {
  runner?.stop();
  unsubSpeed?.();
  unsubSpeed = null;
  runner = null;
  session = null;
  if (clear) {
    const mine = useFightBridge.getState().mine;
    if (mine?.mode === "practice") useFightBridge.setState({ mine: null, myEvents: [] });
    useFightUi.getState().clear();
  }
}
export const practiceSession = (): PracticeSession | null => session;

/* ------------------------------------------------------------ controls → the fight ------------------------------------------------------------ */

/** every control (touch, keys, mouse, pad) ends here: the same presses for every device (plan §2.8) */
export const fightInput = {
  press(a: BoxingAction): void {
    const mine = useFightBridge.getState().mine;
    if (!mine) return;
    if (mine.mode === "practice") session?.pressAction(a);
    else live.press?.(a);
  },
  guard(g: boolean): void {
    const mine = useFightBridge.getState().mine;
    if (!mine) return;
    if (mine.mode === "practice") session?.setGuard(g);
    else live.guard?.(g);
  },
};

/* ------------------------------------------------------------ the prompts' actions ------------------------------------------------------------ */

export const gameFightActions: GameFightActions = {
  claim: (ring, stake) => live.claim?.(ring, stake),
  join: (ring) => live.join?.(ring),
  quick: (stake) => live.quick?.(stake),
  quickCancel: () => live.quickCancel?.(),
  watch: (ring) => live.watch?.(ring),
  practice: (ring, level) => {
    startPractice(ring, level, useFightBridge.getState().mine?.names?.[0] ?? "");
  },
  leave: () => {
    const mine = useFightBridge.getState().mine;
    if (mine?.mode === "practice") stopPractice(true);
    live.leave?.();
  },
};
