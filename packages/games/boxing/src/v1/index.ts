/**
 * Boxing engine v1 (P3-FGT-01 … P3-FGT-09): the one-dimensional engine (distance + presentation orbit). Kept frozen so
 * fights recorded with it (fight logs without `engine: 2`) still replay and verify (P3-FGT-10 migration,
 * docs/FIGHT-GAME-V2.md §8). New fights run engine v2 (../engine.ts).
 */
export * from "./engine.js";
export * from "./bot.js";
export * from "./audit.js";
export * from "./scoring.js";
export * from "./fouls.js";
