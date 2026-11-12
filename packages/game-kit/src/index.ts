import type { z } from "zod";

export type PlayerId = string;

export interface PlayerRef {
  id: PlayerId;
  seat: number;
  team?: number;
  rating: number;
}

/** Randomness is injected — modules never create their own (plan §4.4). */
export interface GameRng {
  int(min: number, max: number): number;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export interface MatchResult {
  /** Rank per player: 1 = winner. Equal ranks mean a draw. */
  ranks: Record<PlayerId, number>;
  scores?: Record<PlayerId, number>;
  reason: "normal" | "forfeit" | "timeout" | "void";
}

export interface GameMeta {
  id: string;
  version: string;
  minPlayers: number;
  maxPlayers: number;
  usesRandomness: boolean;
  skillClassification: "pure-skill" | "skill-dominant" | "mixed";
  realtime: "turn-based" | "simultaneous" | "async-same-seed";
}

/** The contract every game implements (SRS §10.1, plan Appendix B.1). Must be pure and deterministic. */
export interface GameModule<State, Intent, Config = Record<string, never>> {
  meta: GameMeta;
  intentSchema: z.ZodType<Intent>;
  init(config: Config, players: readonly PlayerRef[], rng: GameRng): State;
  validate(state: State, player: PlayerId, intent: Intent): ValidationResult;
  apply(state: State, player: PlayerId, intent: Intent, rng: GameRng): State;
  onTimeout(state: State, player: PlayerId): State;
  currentTurn(state: State): PlayerId | PlayerId[] | null;
  isTerminal(state: State): boolean;
  result(state: State): MatchResult;
  viewFor(state: State, viewer: PlayerId | "spectator"): unknown;
  hash(state: State): string;
}

/** Stable JSON stringify (sorted keys) used by modules to build state hashes. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
