export interface LobbyGame {
  id: "pool-8ball" | "ludo" | "igisoro" | "soon";
  name: string;
  emoji: string;
  colorVar: string;
  live: number;
}

/** Placeholder data until the lobby API exists (P1-LOB-01). */
export const LOBBY_GAMES: LobbyGame[] = [
  { id: "pool-8ball", name: "8-Ball Pool", emoji: "🎱", colorVar: "var(--game-pool)", live: 0 },
  { id: "ludo", name: "Ludo", emoji: "🎲", colorVar: "var(--game-ludo)", live: 0 },
  { id: "igisoro", name: "Igisoro", emoji: "🌰", colorVar: "var(--game-igisoro)", live: 0 },
  { id: "soon", name: "Coming soon", emoji: "✨", colorVar: "var(--game-soon)", live: 0 },
];
