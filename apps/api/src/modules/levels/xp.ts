/** XP rules (SRS §5.9.1, plan Appendix D.1). Pure and unit-tested. */
export const DAILY_XP_CAP = 400;
export const PRACTICE_DAILY_CAP = 20;

export const totalXpForLevel = (level: number) => 25 * level * (level - 1);
export const levelForXp = (xp: number) => Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2);

export interface XpInput {
  outcome: "win" | "loss" | "draw" | "forfeit";
  beatHigherRated: boolean;
  firstWinToday: boolean;
  sameOpponentCountToday: number;
}

export function xpForMatch(m: XpInput, todayXp: number): number {
  if (m.outcome === "forfeit" || m.sameOpponentCountToday >= 5) return 0;
  let xp = 10;
  if (m.outcome === "win") xp += 10;
  if (m.outcome === "draw") xp += 5;
  if (m.outcome === "win" && m.beatHigherRated) xp += 5;
  if (m.outcome === "win" && m.firstWinToday) xp += 20;
  return Math.max(0, Math.min(xp, DAILY_XP_CAP - todayXp));
}

/** Pairwise Elo by rank (P1-MM-02 will move this to Glicko-2). */
export function eloUpdate(players: { id: string; rating: number; rank: number }[], k = 32): Record<string, number> {
  const out: Record<string, number> = {};
  const kk = k / Math.max(1, players.length - 1);
  for (const p of players) {
    let delta = 0;
    for (const q of players) {
      if (p === q) continue;
      const expected = 1 / (1 + 10 ** ((q.rating - p.rating) / 400));
      const actual = p.rank < q.rank ? 1 : p.rank === q.rank ? 0.5 : 0;
      delta += kk * (actual - expected);
    }
    out[p.id] = Math.round(p.rating + delta);
  }
  return out;
}
