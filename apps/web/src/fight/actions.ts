import type { RingId } from "@gukirana/contracts";

/**
 * What the ring prompts and the world ask the boxing client to do (P3-FGT-01). Agent G implements it (hall-room
 * `BoxingHallMsg` messages, the practice engine) and installs it with `setFightActions`; until then the default logs
 * every call, and W's mock (fight/mock.ts) installs a scripted version that updates the bridge.
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

export const fightLog: { action: keyof FightActions; args: unknown[]; at: number }[] = [];
const logging = (): FightActions => {
  const log =
    (action: keyof FightActions) =>
    (...args: unknown[]) => {
      fightLog.push({ action, args, at: Date.now() });
      if (fightLog.length > 50) fightLog.shift();
      if (process.env.NODE_ENV !== "production") console.info("[fightActions]", action, ...args);
    };
  return { claim: log("claim"), join: log("join"), leave: log("leave"), quick: log("quick"), quickCancel: log("quickCancel"), practice: log("practice"), watch: log("watch") };
};

let current: FightActions = logging();
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
  current = a ?? logging();
}
