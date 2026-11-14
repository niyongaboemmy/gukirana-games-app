/** Ludo board geometry on a 15×15 grid: [row, col]. Track index 0 = seat 0 (red) start, clockwise. */
type RC = [number, number];
const seg = (a: RC[], ...pts: RC[]) => a.push(...pts);

export const TRACK_COORDS: RC[] = (() => {
  const t: RC[] = [];
  for (let c = 1; c <= 5; c++) seg(t, [6, c]);
  for (let r = 5; r >= 0; r--) seg(t, [r, 6]);
  seg(t, [0, 7], [0, 8]);
  for (let r = 1; r <= 5; r++) seg(t, [r, 8]);
  for (let c = 9; c <= 14; c++) seg(t, [6, c]);
  seg(t, [7, 14], [8, 14]);
  for (let c = 13; c >= 9; c--) seg(t, [8, c]);
  for (let r = 9; r <= 14; r++) seg(t, [r, 8]);
  seg(t, [14, 7], [14, 6]);
  for (let r = 13; r >= 9; r--) seg(t, [r, 6]);
  for (let c = 5; c >= 0; c--) seg(t, [8, c]);
  seg(t, [7, 0], [6, 0]);
  return t;
})();

export const HOME_COLUMN: RC[][] = [
  [1, 2, 3, 4, 5].map((c) => [7, c] as RC),
  [1, 2, 3, 4, 5].map((r) => [r, 7] as RC),
  [13, 12, 11, 10, 9].map((c) => [7, c] as RC),
  [13, 12, 11, 10, 9].map((r) => [r, 7] as RC),
];

export const BASE_ORIGIN: RC[] = [
  [0, 0],
  [0, 9],
  [9, 9],
  [9, 0],
];
const BASE_SLOTS: RC[] = [
  [1.5, 1.5],
  [1.5, 3.5],
  [3.5, 1.5],
  [3.5, 3.5],
];
const HOME_SPOT: RC[] = [
  [7, 6.35],
  [6.35, 7],
  [7, 7.65],
  [7.65, 7],
];

/** Cell-space position (row, col) of a token; the token centre is at (row + .5, col + .5). */
export function tokenCell(seat: number, progress: number, token: number): RC {
  if (progress === -1) {
    const [r0, c0] = BASE_ORIGIN[seat]!;
    const [dr, dc] = BASE_SLOTS[token]!;
    return [r0 + dr, c0 + dc];
  }
  if (progress <= 50) return TRACK_COORDS[(seat * 13 + progress) % 52]!;
  if (progress <= 55) return HOME_COLUMN[seat]![progress - 51]!;
  return HOME_SPOT[seat]!;
}

export const SEAT_COLORS = ["#E53935", "#43A047", "#FDD835", "#1E88E5"];
/** Colour-blind friendly seat colours (Okabe–Ito: vermillion, bluish green, yellow, blue), same seat order. */
export const SEAT_COLORS_CB = ["#D55E00", "#009E73", "#F0E442", "#0072B2"];
export const SEAT_NAMES = ["Red", "Green", "Yellow", "Blue"];
export const seatColors = (colorBlind: boolean) => (colorBlind ? SEAT_COLORS_CB : SEAT_COLORS);

export type Side = "top" | "right" | "bottom" | "left";
/** Side of the centre square a cell of the cross lies on. */
export const sideOfCell = ([r, c]: RC): Side => (c < 6 ? "left" : c > 8 ? "right" : r < 6 ? "top" : r > 8 ? "bottom" : c < 7 ? "left" : c > 7 ? "right" : r < 7 ? "top" : "bottom");
/**
 * Which side of the centre square each seat's home column enters from (derived from HOME_COLUMN, so the centre
 * triangles can never drift from the columns): the triangle on that side is the seat's home.
 */
export const CENTRE_SIDE: Side[] = HOME_COLUMN.map((col) => sideOfCell(col[col.length - 1]!));
/** Centre triangle polygons (percent of the centre square) for clip-path. */
export const TRIANGLE_CLIP: Record<Side, string> = {
  top: "polygon(0 0, 100% 0, 50% 50%)",
  right: "polygon(100% 0, 100% 100%, 50% 50%)",
  bottom: "polygon(0 100%, 100% 100%, 50% 50%)",
  left: "polygon(0 0, 0 100%, 50% 50%)",
};
