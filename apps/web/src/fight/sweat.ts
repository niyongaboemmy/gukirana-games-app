/**
 * The fighters' sweat (presentation of the engine's stamina; P3-FGT-09 / P3-FGT-18; kept by P3-FGT-19B, SPEC §6):
 * dry at the first bell (the shader's wet lobe starts above 0.2), rising with the work done in a round and with every
 * round after the first, capped at 1. `v7` false keeps the P3-FGT-17 formula (constant base, no rounds).
 */
export function sweatOf(stamina: number, round: number, v7 = true): number {
  const work = Math.min(1, Math.max(0, (1000 - stamina) / 700));
  return v7 ? Math.min(1, 0.22 + 0.5 * work + 0.14 * Math.max(0, round - 1)) : 0.3 + 0.6 * work;
}
