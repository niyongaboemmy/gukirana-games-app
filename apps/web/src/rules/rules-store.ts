"use client";
import { create } from "zustand";
import { GAME_RULES_VERSION, type GameId, type RulesStatus } from "@gukirana/contracts";
import { api, useSession } from "@/lib/session";

/**
 * Rules to accept before a live match (P2-NET-05). `requireRules(game)` resolves true once the player has accepted the
 * game's current rules version — at once when they already did, otherwise after the rules card (RulesCard, mounted
 * once in the root layout) was accepted; false when they closed it. Live acceptances are stored by the API
 * (POST /games/rules/accept) and the server refuses to seat anyone without one (RULES_NOT_ACCEPTED), so this is only
 * the way in. Practice shows the card once per game and rules version, remembered in this browser.
 *
 * Kill switch: NEXT_PUBLIC_FF_RULES_ACCEPT=0 (the API gate is FF_RULES_ACCEPT=0).
 */
export const RULES_ACCEPT_ON = process.env.NEXT_PUBLIC_FF_RULES_ACCEPT !== "0";

export type RulesMode = "live" | "practice";
interface Ask {
  game: GameId;
  mode: RulesMode;
  resolve: (ok: boolean) => void;
}
interface RulesState {
  accepted: Partial<Record<GameId, number>>;
  loadedFor: string | null;
  ask: Ask | null;
}
export const useRules = create<RulesState>()(() => ({ accepted: {}, loadedFor: null, ask: null }));

const practiceKey = (g: GameId) => `gk-rules-practice:${g}`;
const practiceSeen = (g: GameId): boolean => {
  try {
    return Number(localStorage.getItem(practiceKey(g)) ?? 0) >= GAME_RULES_VERSION[g];
  } catch {
    return false;
  }
};

async function loadStatus(): Promise<void> {
  const uid = useSession.getState().me?.id ?? null;
  if (!uid || useRules.getState().loadedFor === uid) return;
  const r = await api<RulesStatus>("/games/rules");
  const accepted: Partial<Record<GameId, number>> = {};
  for (const g of r.games) if (g.accepted) accepted[g.game] = g.version;
  useRules.setState({ accepted, loadedFor: uid });
}

export const hasAccepted = (g: GameId): boolean => (useRules.getState().accepted[g] ?? 0) >= GAME_RULES_VERSION[g];

/** the player must have accepted `game`'s rules before this goes ahead (opens the card when needed) */
export async function requireRules(game: GameId, mode: RulesMode = "live"): Promise<boolean> {
  if (!RULES_ACCEPT_ON) return true;
  if (mode === "practice") {
    if (practiceSeen(game) || hasAccepted(game)) return true;
  } else {
    // not signed in: the server refuses the live match anyway (sign-in comes first)
    if (useSession.getState().status !== "authenticated") return true;
    await loadStatus().catch(() => undefined);
    if (hasAccepted(game)) return true;
  }
  const prev = useRules.getState().ask;
  prev?.resolve(false);
  return new Promise<boolean>((resolve) => useRules.setState({ ask: { game, mode, resolve } }));
}

/** the card's "Accept and continue" (throws when the API refused / was unreachable: the card says so) */
export async function acceptRules(game: GameId, mode: RulesMode): Promise<void> {
  const version = GAME_RULES_VERSION[game];
  if (useSession.getState().status === "authenticated") {
    await api("/games/rules/accept", { method: "POST", body: JSON.stringify({ game, version }) });
    useRules.setState((s) => ({ accepted: { ...s.accepted, [game]: version } }));
  } else if (mode === "live") throw new Error("SIGN_IN");
  markPracticeSeen(game);
}

export function answerRules(ok: boolean): void {
  const a = useRules.getState().ask;
  useRules.setState({ ask: null });
  // practice: the card is shown once per rules version, read or not (practice is never blocked by it)
  if (a?.mode === "practice") markPracticeSeen(a.game);
  a?.resolve(ok);
}

function markPracticeSeen(game: GameId): void {
  try {
    localStorage.setItem(practiceKey(game), String(GAME_RULES_VERSION[game]));
  } catch {
    /* private mode */
  }
}

/** run `go` only after the rules are accepted (fire and forget, for click handlers / socket sends) */
export const withRules = (game: GameId, go: () => void, mode: RulesMode = "live"): void => {
  void requireRules(game, mode).then((ok) => ok && go());
};

// a different account signed in: its own acceptances
useSession.subscribe((s, p) => {
  if (s.me?.id !== p.me?.id) useRules.setState({ accepted: {}, loadedFor: null });
});
