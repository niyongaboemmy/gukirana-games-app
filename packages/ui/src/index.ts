/** Design tokens (DESIGN-SPEC-3D-VR §5.3–5.6). Keep in sync with tokens.css. */
export const colors = {
  brand: { indigo: "#22266E", sky: "#3DA9FC", gold: "#FFC83D" },
  imigongo: { ochre: "#B5532A", black: "#1B1B1B", white: "#F4EFE6" },
  env: { hill: "#4E9F5B" },
  game: { pool: "#2F80ED", ludo: "#FF8A1F", igisoro: "#27AE60", arena: "#9B51E0", soon: "#8A94A6" },
  semantic: { coin: "#F5B301", star: "#7CC4FF", success: "#22C55E", warning: "#F59E0B", danger: "#EF4444" },
} as const;

export const motion = {
  panel: 200,
  proposal: 240,
  cameraToTable: 1200,
  vrFade: 300,
  coinFlow: 750,
} as const;

export const ludoSeats = [
  { color: "#E53935", shape: "circle" },
  { color: "#43A047", shape: "triangle" },
  { color: "#FDD835", shape: "square" },
  { color: "#1E88E5", shape: "diamond" },
] as const;
