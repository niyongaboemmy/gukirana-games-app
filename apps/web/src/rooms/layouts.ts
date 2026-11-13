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
  /** extra solid furniture footprints (bar counters, sofas, planters…), axis-aligned like tables */
  colliders: Rect[];
}
export interface Rect {
  x: number;
  z: number;
  w: number; // along x
  d: number; // along z
}

const W = 24;
const D = 18;
const face = (sx: number, sz: number, tx: number, tz: number) => Math.atan2(tx - sx, tz - sz);

function build(
  game: HallGame,
  title: string,
  subtitle: string,
  color: string,
  tables: Omit<Table, "id">[],
  seatOffsets: (t: Omit<Table, "id">) => { x: number; z: number }[],
  colliders: Rect[],
): HallLayout {
  const T = tables.map((t, i) => ({ ...t, id: `t${i}` }));
  const seats: Seat[] = T.flatMap((t, i) =>
    seatOffsets(t).map((o, s) => ({ id: `t${i}s${s}`, table: t.id, x: t.x + o.x, z: t.z + o.z, yaw: face(t.x + o.x, t.z + o.z, t.x, t.z) })),
  );
  return { game, title, subtitle, color, size: { w: W, d: D, h: 4.4 }, door: { x: 0, w: 2.6 }, spawn: { x: 0, z: 6.6 }, tables: T, seats, colliders };
}

/** Furniture placement shared by the scene (RoomScene + interiors) and the controller (colliders). */
export const POOL_TABLES_X = [-4.2, 4.2];
export const POOL_TABLES_Z = [-4.6, 0.8];
export const LUDO_TABLES_X = [-7.5, -2.5, 2.5];
export const LUDO_TABLES_Z = [-4.4, 0.6];
export const IGISORO_TABLES_X = [-6.8, 6.8];
export const IGISORO_TABLES_Z = [-5.2, -1.2, 2.8];
export const IGISORO_TREE = { x: 0, z: -1.6, r: 1.45 };

export const HALLS: Record<HallGame, HallLayout> = {
  // 9-ft tables: playing surface 2.54 × 1.27 m, frame ≈ 2.9 × 1.65 m; club chairs at the table ends.
  // West wall: bar; east wall: chesterfield lounge.
  pool: build(
    "pool",
    "Pool Hall",
    "8-Ball · four tournament tables",
    "#2F80ED",
    POOL_TABLES_Z.flatMap((z) => POOL_TABLES_X.map((x) => ({ x, z, w: 2.9, d: 1.65, h: 0.8 }))),
    () => [
      { x: -2.4, z: 0 },
      { x: 2.4, z: 0 },
    ],
    [
      { x: -10.75, z: -1, w: 2.5, d: 8.2 }, // bar counter + back bar
      { x: 11.2, z: -1.2, w: 1.2, d: 2.2 }, // chesterfield
      { x: 9.75, z: -1.2, w: 0.7, d: 1.2 }, // coffee table
      { x: 8.7, z: -3.0, w: 0.9, d: 0.9 }, // lounge chairs
      { x: 8.7, z: 0.6, w: 0.9, d: 0.9 },
      { x: -11.3, z: -8.3, w: 0.9, d: 0.9 }, // corner plants
      { x: 11.3, z: -8.3, w: 0.9, d: 0.9 },
      { x: 11.3, z: 8.3, w: 0.9, d: 0.9 },
      { x: -11.3, z: 8.3, w: 0.9, d: 0.9 },
    ],
  ),
  // café tables 1.25 m square, four armchairs each; west wall: coffee bar; east: sofa lounge on a Kitenge rug.
  ludo: build(
    "ludo",
    "Ludo Lounge",
    "Dice & tactics · six tables",
    "#FF8A1F",
    LUDO_TABLES_Z.flatMap((z) => LUDO_TABLES_X.map((x) => ({ x, z, w: 1.25, d: 1.25, h: 0.74 }))),
    () => [
      { x: 0, z: 1.15 },
      { x: 1.15, z: 0 },
      { x: 0, z: -1.15 },
      { x: -1.15, z: 0 },
    ],
    [
      { x: -11.1, z: 0.5, w: 1.8, d: 7.4 }, // coffee counter + back counter
      { x: 11.2, z: -3.4, w: 1.1, d: 2.2 }, // sofas
      { x: 11.2, z: 1.6, w: 1.1, d: 2.2 },
      { x: 9.4, z: -0.9, w: 1.0, d: 1.0 }, // coffee table
      { x: -11.3, z: -8.3, w: 0.9, d: 0.9 }, // plants
      { x: 11.3, z: -8.3, w: 0.9, d: 0.9 },
      { x: 11.3, z: 8.3, w: 0.9, d: 0.9 },
      { x: -11.3, z: 8.3, w: 0.9, d: 0.9 },
    ],
  ),
  // low carved tables 1.7 × 0.85 m in two colonnades; the courtyard tree stands under the skylight.
  igisoro: build(
    "igisoro",
    "Igisoro Court",
    "Rwandan strategy · carved tables",
    "#27AE60",
    IGISORO_TABLES_Z.flatMap((z) => IGISORO_TABLES_X.map((x) => ({ x, z, w: 1.7, d: 0.85, h: 0.6 }))),
    () => [
      { x: 0, z: 0.95 },
      { x: 0, z: -0.95 },
    ],
    [
      { x: IGISORO_TREE.x, z: IGISORO_TREE.z, w: IGISORO_TREE.r * 2, d: IGISORO_TREE.r * 2 }, // tree planter
      { x: 0, z: -4.7, w: 2.4, d: 0.5 }, // benches around the tree
      { x: 0, z: 1.5, w: 2.4, d: 0.5 },
      { x: -3.1, z: -1.6, w: 0.5, d: 2.4 },
      { x: 3.1, z: -1.6, w: 0.5, d: 2.4 },
      { x: -11.3, z: -8.3, w: 0.9, d: 0.9 }, // baskets / plants in the corners
      { x: 11.3, z: -8.3, w: 0.9, d: 0.9 },
      { x: 11.3, z: 8.3, w: 0.9, d: 0.9 },
      { x: -11.3, z: 8.3, w: 0.9, d: 0.9 },
    ],
  ),
};

export const isHallGame = (g: string): g is HallGame => g === "pool" || g === "ludo" || g === "igisoro";
