"use client";
import { reportPractice, useSession } from "@/lib/session";

/**
 * Practice vs AI never moves Stars (no client-side minting); the server grants +2 XP,
 * max 20/day (SRS §5.9.1). Stars only change in server-authoritative matches.
 */
export async function settlePractice(game: string, won: boolean): Promise<{ starsDelta: number; xp: number }> {
  const xp = useSession.getState().status === "authenticated" ? await reportPractice(game, won) : 0;
  return { starsDelta: 0, xp };
}
