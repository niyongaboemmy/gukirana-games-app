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
  /** x of the table-free walking aisles (north–south), used by the Leave route and the table-pick walk */
  aisles: number[];
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

const LEGACY_AISLES = [-9, -6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6, 9];

function build(
  game: HallGame,
  title: string,
  subtitle: string,
  color: string,
  tables: Omit<Table, "id">[],
  seatOffsets: (t: Omit<Table, "id">) => { x: number; z: number }[],
  colliders: Rect[],
  opts: { size?: { w: number; d: number; h: number }; aisles?: number[] } = {},
): HallLayout {
  const size = opts.size ?? { w: W, d: D, h: 4.4 };
  const T = tables.map((t, i) => ({ ...t, id: `t${i}` }));
  const seats: Seat[] = T.flatMap((t, i) =>
    seatOffsets(t).map((o, s) => ({ id: `t${i}s${s}`, table: t.id, x: t.x + o.x, z: t.z + o.z, yaw: face(t.x + o.x, t.z + o.z, t.x, t.z) })),
  );
  const aisles = (opts.aisles ?? LEGACY_AISLES).filter((x) => T.every((tb) => Math.abs(tb.x - x) > tb.w / 2 + 1.05));
  return { game, title, subtitle, color, size, door: { x: 0, w: 2.6 }, spawn: { x: 0, z: size.d / 2 - 2.4 }, tables: T, seats, colliders, aisles };
}

/** Furniture placement shared by the scene (RoomScene + interiors) and the controller (colliders). */
/**
 * Pool Hall (36 × 28 m, 5 m ceiling): 12 nine-foot tables in 3 rows × 4 columns. Every table keeps the real-world
 * 1.5 m cue clearance on all four sides (end gaps 3.3 m, side gaps 4.35 m); the two player chairs stand diagonally
 * opposite on the long sides just outside that zone. Aisles run north–south at x = 0, ±6.2, ±12.4; the west wall
 * is the bar, the east wall the lounge, spectator banquettes line the window wall and the side walls.
 */
export const POOL_SIZE = { w: 36, d: 28, h: 5 };
export const POOL_TABLES_X = [-9.3, -3.1, 3.1, 9.3];
export const POOL_TABLES_Z = [-8, -2, 4];
export const POOL_FRAME = { w: 2.9, d: 1.65, h: 0.8 };
/** chair offset from the table centre (x along the table, z across it) */
export const POOL_CHAIR = { x: 0.9, z: 2.72 };
export const POOL_CUE_CLEARANCE = 1.5;
export const POOL_AISLES = [-12.4, -6.2, 0, 6.2, 12.4];
/** bar on the west wall: counter front (customer side) at x = POOL_BAR.x + 0.45 */
export const POOL_BAR = { x: -15.2, z0: -9, z1: 3 };
export const LUDO_TABLES_X = [-7.5, -2.5, 2.5];
export const LUDO_TABLES_Z = [-4.4, 0.6];
export const IGISORO_TABLES_X = [-6.8, 6.8];
export const IGISORO_TABLES_Z = [-5.2, -1.2, 2.8];
export const IGISORO_TREE = { x: 0, z: -1.6, r: 1.45 };

export const HALLS: Record<HallGame, HallLayout> = {
  // 9-ft tables: playing surface 2.54 × 1.27 m, frame ≈ 2.9 × 1.65 m; club chairs at the table ends.
  // West wall: bar; east wall: chesterfield lounge.
  // 9-ft tables: playing surface 2.54 × 1.27 m, frame ≈ 2.9 × 1.65 m. Chairs diagonally opposite on the long sides.
  pool: build(
    "pool",
    "Pool Hall",
    "8-Ball · twelve tournament tables",
    "#2F80ED",
    POOL_TABLES_Z.flatMap((z) => POOL_TABLES_X.map((x) => ({ x, z, ...POOL_FRAME }))),
    () => [
      { x: -POOL_CHAIR.x, z: POOL_CHAIR.z }, // s0: south side (towards the entrance)
      { x: POOL_CHAIR.x, z: -POOL_CHAIR.z }, // s1: north side
    ],
    [
      { x: POOL_BAR.x, z: (POOL_BAR.z0 + POOL_BAR.z1) / 2, w: 1.0, d: POOL_BAR.z1 - POOL_BAR.z0 }, // bar counter
      { x: -17.55, z: (POOL_BAR.z0 + POOL_BAR.z1) / 2, w: 0.9, d: POOL_BAR.z1 - POOL_BAR.z0 }, // back bar
      // east lounge: two sofas facing each other over a low table, two lounge chairs
      { x: 16.9, z: -2.2, w: 1.0, d: 2.4 },
      { x: 15.2, z: -2.2, w: 0.8, d: 1.2 },
      { x: 13.9, z: -4.1, w: 0.9, d: 0.9 },
      { x: 13.9, z: -0.3, w: 0.9, d: 0.9 },
      // spectator banquettes: window wall (between the window bays' piers), side walls
      { x: -7.5, z: -13.35, w: 9, d: 0.7 },
      { x: 7.5, z: -13.35, w: 9, d: 0.7 },
      { x: 17.6, z: -9.5, w: 0.7, d: 5 },
      { x: 17.6, z: 6, w: 0.7, d: 6 },
      { x: -17.6, z: 8.5, w: 0.7, d: 6 },
      // planters in the corners and flanking the entrance foyer
      { x: -17.3, z: -13.3, w: 0.9, d: 0.9 },
      { x: 17.3, z: -13.3, w: 0.9, d: 0.9 },
      { x: 17.3, z: 13.3, w: 0.9, d: 0.9 },
      { x: -17.3, z: 13.3, w: 0.9, d: 0.9 },
      { x: -4.2, z: 13.3, w: 0.9, d: 0.9 },
      { x: 4.2, z: 13.3, w: 0.9, d: 0.9 },
    ],
    { size: POOL_SIZE, aisles: POOL_AISLES },
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
