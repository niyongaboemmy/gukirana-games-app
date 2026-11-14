import type { FightInput } from "@gukirana/contracts";
import type { GameRng } from "@gukirana/game-kit";
import type { FightState } from "./engine.js";

/** Practice sparring partner levels (1 = beginner … 5 = champion). Practice only: never in live / staked fights. */
export type BotLevel = 1 | 2 | 3 | 4 | 5;

/**
 * The AI's input for this tick (null = nothing new). Deterministic given the rng (practice seeds it from
 * @gukirana/fairness; tests use a fixed seed). STUB: keeps its guard up; Agent G writes the policy (reaction delay by
 * level, reads the opponent's windup, stamina management, combos).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: level + rng are the public signature Agent G fills in
export function boxingBotInput(s: FightState, me: 0 | 1, _level: BotLevel, _rng: GameRng): FightInput | null {
  const f = s.fighters[me];
  if (s.phase !== "round" || f.guard) return null;
  return { seq: f.seq + 1, g: true };
}
