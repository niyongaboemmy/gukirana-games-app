"use client";
import { useProfile } from "@/lib/profile-store";

export const PRACTICE_STAKE = 50;

/** Practice settlement with Stars (no cash value). XP per SRS §5.9.1: practice vs AI = +2. */
export function settlePractice(won: boolean): { starsDelta: number; xp: number } {
  const p = useProfile.getState();
  const starsDelta = won ? PRACTICE_STAKE : -Math.min(PRACTICE_STAKE, p.stars);
  p.addStars(starsDelta);
  const xp = p.addXp(2);
  return { starsDelta, xp };
}
