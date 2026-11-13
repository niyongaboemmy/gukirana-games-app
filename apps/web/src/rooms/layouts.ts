/** Hall interiors (metres, DESIGN-SPEC §6.1/§6.4). Room spans x ∈ [-W/2, W/2], z ∈ [-D/2, D/2]; entrance door on the south wall (+z). */
export type HallGame = "pool" | "ludo" | "igisoro";

export interface Table {
  id: string;
  x: number;
  z: number;
  w: number; // along x
  d: number; // along z
  h: number;
}
export interface Seat {
  id: string; // t{table}s{seat}
  table: string;
  x: number;
  z: number;
  /** avatar rotation.y when seated (faces the table) */
  yaw: number;
}
export interface HallLayout {
  game: HallGame;
  title: string;
  subtitle: string;
  color: string;
  size: { w: number; d: number; h: number };
  door: { x: number; w: number };
  spawn: { x: number; z: number };
  tables: Table[];
  seats: Seat[];
}

const W = 24;
const D = 18;
const face = (sx: number, sz: number, tx: number, tz: number) => Math.atan2(tx - sx, tz - sz);

function build(game: HallGame, title: string, subtitle: string, color: string, tables: Omit<Table, "id">[], seatOffsets: (t: Omit<Table, "id">) => { x: number; z: number }[]): HallLayout {
  const T = tables.map((t, i) => ({ ...t, id: `t${i}` }));
  const seats: Seat[] = T.flatMap((t, i) =>
    seatOffsets(t).map((o, s) => ({ id: `t${i}s${s}`, table: t.id, x: t.x + o.x, z: t.z + o.z, yaw: face(t.x + o.x, t.z + o.z, t.x, t.z) })),
  );
  return { game, title, subtitle, color, size: { w: W, d: D, h: 4.4 }, door: { x: 0, w: 2.6 }, spawn: { x: 0, z: 6.6 }, tables: T, seats };
}

export const HALLS: Record<HallGame, HallLayout> = {
  // 9-ft tables: playing surface 2.54 × 1.27 m, frame ≈ 2.9 × 1.65 m; stools at the table ends
  pool: build(
    "pool",
    "Pool Hall",
    "8-Ball · four tournament tables",
    "#2F80ED",
    [
      { x: -5.5, z: -4.2, w: 2.9, d: 1.65, h: 0.8 },
      { x: 5.5, z: -4.2, w: 2.9, d: 1.65, h: 0.8 },
      { x: -5.5, z: 1.2, w: 2.9, d: 1.65, h: 0.8 },
      { x: 5.5, z: 1.2, w: 2.9, d: 1.65, h: 0.8 },
    ],
    () => [
      { x: -2.35, z: 0 },
      { x: 2.35, z: 0 },
    ],
  ),
  ludo: build(
    "ludo",
    "Ludo Lounge",
    "Dice & tactics · six tables",
    "#FF8A1F",
    [-6, 0, 6].flatMap((x) => [
      { x, z: -4, w: 1.25, d: 1.25, h: 0.74 },
      { x, z: 1.4, w: 1.25, d: 1.25, h: 0.74 },
    ]),
    () => [
      { x: 0, z: 1.05 },
      { x: 1.05, z: 0 },
      { x: 0, z: -1.05 },
      { x: -1.05, z: 0 },
    ],
  ),
  igisoro: build(
    "igisoro",
    "Igisoro Court",
    "Rwandan strategy · carved tables",
    "#27AE60",
    [-6, 0, 6].flatMap((x) => [
      { x, z: -4.4, w: 1.7, d: 0.85, h: 0.72 },
      { x, z: 1.0, w: 1.7, d: 0.85, h: 0.72 },
    ]),
    () => [
      { x: 0, z: 0.95 },
      { x: 0, z: -0.95 },
    ],
  ),
};

export const isHallGame = (g: string): g is HallGame => g === "pool" || g === "ludo" || g === "igisoro";
