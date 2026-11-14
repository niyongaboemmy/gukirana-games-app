import type { RingId } from "@gukirana/contracts";
import { gameFightActions } from "./game/actions";

/**
 * What the ring prompts and the world ask the boxing client to do (P3-FGT-01). The default is Agent G's
 * `gameFightActions` (fight/game/actions.ts: practice runs the local engine, the live calls go to the hall / fight
 * room client). Behind `?fightmock=1` W's mock (fight/mock.ts) installs a scripted, logging version instead.
 */
export interface FightActions {
  /** step into a free ring and wait for an opponent (stake 0 = friendly) → `boxing-claim` */
  claim(ring: RingId, stake: number): void;
  /** take the blue corner of a waiting ring → `boxing-join` */
  join(ring: RingId): void;
  /** step out of the ring you hold (waiting / practice / after the result) → `boxing-leave` */
  leave(): void;
  /** quick fight at a stake / cancel it → `boxing-quick` / `boxing-quick-cancel` */
  quick(stake: number): void;
  quickCancel(): void;
  /** train against the AI (level 1–5) in a free ring → `boxing-practice` + the local engine */
  practice(ring: RingId, level: number): void;
  /** watch a ring's fight (null stops) → `boxing-watch` */
  watch(ring: RingId | null): void;
}

/** the mock's call log (?fightmock=1 only) */
export const fightLog: { action: keyof FightActions; args: unknown[]; at: number }[] = [];

let current: FightActions = gameFightActions;
/** the live implementation (G's boxing client, or the mock) */
export const fightActions: FightActions = {
  claim: (r, s) => current.claim(r, s),
  join: (r) => current.join(r),
  leave: () => current.leave(),
  quick: (s) => current.quick(s),
  quickCancel: () => current.quickCancel(),
  practice: (r, l) => current.practice(r, l),
  watch: (r) => current.watch(r),
};
export function setFightActions(a: FightActions | null) {
  current = a ?? gameFightActions;
}
