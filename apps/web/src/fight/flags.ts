/**
 * Feature flag for the Fight Games hall + Boxing (P3-FGT-01, docs/FIGHT-GAMES-PLAN.md D11). OFF by default:
 * the building stands on the expansion ring with its doors locked (like the arena with NEXT_PUBLIC_FF_ARENA=0) until
 * NEXT_PUBLIC_FF_FIGHT=1. Staff still switch the `boxing` game on in the console; this only gates the web world.
 */
export const FIGHT_ON = process.env.NEXT_PUBLIC_FF_FIGHT === "1";
