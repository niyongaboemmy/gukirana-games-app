/** Hall interiors (metres, DESIGN-SPEC §6.1/§6.4). Room spans x ∈ [-W/2, W/2], z ∈ [-D/2, D/2]; entrance door on the south wall (+z). */
import { ADMIN_COLLIDERS, ADMIN_COLOR, ADMIN_SIZE, ADMIN_WALLS } from "@/admin-block/plan";

export type HallGame = "pool" | "ludo" | "igisoro" | "admin";

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
  /**
   * z of the table- and chair-free cross aisles (east–west) between the table rows, for halls whose chairs are tucked
   * close to small tables (Ludo): the table-pick walk goes along an aisle, along the cross aisle, then up beside the
   * chair. Halls without lanes walk the open strip between the table and its chairs (Pool).
   */
  lanes?: number[];
  /**
   * Full-height interior walls (Administrative Block offices / corridor): solid for walking AND for the follow
   * camera (it pulls in in front of them at any height, unlike low furniture). Halls without partitions have none.
   */
  walls?: Rect[];
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
  opts: { size?: { w: number; d: number; h: number }; aisles?: number[]; lanes?: number[]; walls?: Rect[] } = {},
): HallLayout {
  const size = opts.size ?? { w: W, d: D, h: 4.4 };
  const T = tables.map((t, i) => ({ ...t, id: `t${i}` }));
  const seats: Seat[] = T.flatMap((t, i) =>
    seatOffsets(t).map((o, s) => ({ id: `t${i}s${s}`, table: t.id, x: t.x + o.x, z: t.z + o.z, yaw: face(t.x + o.x, t.z + o.z, t.x, t.z) })),
  );
  const aisles = (opts.aisles ?? LEGACY_AISLES).filter((x) => T.every((tb) => Math.abs(tb.x - x) > tb.w / 2 + 1.05));
  const layout: HallLayout = { game, title, subtitle, color, size, door: { x: 0, w: 2.6 }, spawn: { x: 0, z: size.d / 2 - 2.4 }, tables: T, seats, colliders, aisles };
  if (opts.lanes) layout.lanes = opts.lanes;
  if (opts.walls) layout.walls = opts.walls;
  return layout;
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
/**
 * Ludo Lounge (34 × 26 m, 4.6 m ceiling): sixteen 1.1 m café tables in 4 rows × 4 columns on a 4.8 m grid. Live Ludo
 * matches are 1-v-1 (matchmaking pairs two players, seats red + yellow), so each table has two server-claimed player
 * armchairs facing each other across the board (s0 south, s1 north) and two low watchers' poufs on the east / west
 * sides (furniture, not claimed). North–south aisles at x = 0, ±4.8, ±9.6; east–west cross aisles between the rows.
 * West wall: the coffee bar; east wall: two sofa lounges; north: the window banquette; south: the entrance foyer.
 */
export const LUDO_SIZE = { w: 34, d: 26, h: 4.6 };
export const LUDO_TABLES_X = [-7.2, -2.4, 2.4, 7.2];
export const LUDO_TABLES_Z = [-8.4, -3.6, 1.2, 6.0];
export const LUDO_TABLE = { w: 1.1, d: 1.1, h: 0.74 };
/** player armchair: distance of the seat point from the table centre (along z) */
export const LUDO_CHAIR = 1.0;
/** watchers' poufs: offset from the table centre (along x) and footprint */
export const LUDO_POUF = { x: 1.38, s: 0.6 };
export const LUDO_AISLES = [-9.6, -4.8, 0, 4.8, 9.6];
export const LUDO_LANES = [-10.8, -6.0, -1.2, 3.6, 8.4];
/** coffee bar on the west wall: counter front (customer side) at x = LUDO_BAR.x + 0.5 */
export const LUDO_BAR = { x: -14.0, z0: -6.5, z1: 3.5 };
/** planters: corners, window centre, bar ends */
export const LUDO_PLANTERS: [number, number][] = [
  [-16.3, -12.3],
  [16.3, -12.3],
  [16.3, 12.3],
  [-16.3, 12.3],
  [0, -12.35],
  [-16.3, -8.0],
  [-16.3, 5.0],
];
/**
 * Igisoro Court (34 × 26 m, 5 m ceiling): 16 low Igisoro tables in two wings of 2 columns × 4 rows either side of the
 * central courtyard (the elders' tree under the skylight, ringed by a built-in bench). The two players sit on low
 * cushioned stools on the long sides, facing each other across the 4 × 8-pit board. Every table cluster keeps a
 * ≥ 1.2 m walkway round it; aisles run north–south at x = ±4.6 (courtyard edges), ±9.8 (between the wing columns) and
 * ±15.2 (along the side walls). North: full-width daylight glazing with the spectator lounge in front of it; east: the
 * Imigongo feature wall over a long spectator banquette; west: tall windows with timber window seats.
 */
export const IGISORO_SIZE = { w: 34, d: 26, h: 5 };
export const IGISORO_TABLES_X = [-12.2, -7.4, 7.4, 12.2];
export const IGISORO_TABLES_Z = [-8.4, -3.6, 1.2, 6.0];
/** low Igisoro table: top 1.7 × 0.84 m at 0.55 m (the board sits on it) */
export const IGISORO_TABLE = { w: 1.7, d: 0.84, h: 0.55 };
/** stool centre distance from the table centre (across the table, z): close enough to reach the far pits */
export const IGISORO_STOOL_Z = 1.18;
export const IGISORO_AISLES = [-15.2, -9.8, -4.6, 4.6, 9.8, 15.2];
export const IGISORO_TREE = { x: 0, z: -1.2, r: 1.45 };
/** built-in ring bench round the tree planter (outer radius) */
export const IGISORO_TREE_BENCH = 1.9;
/** west-wall window bays (centre z), each with a timber window seat */
export const IGISORO_WEST_WINDOWS = [-8, -4, 0, 4, 8];
/** spectator lounge in front of the north glazing */
export const IGISORO_LOUNGE = { x: 0, z: -10.2 };

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
  // café tables 1.1 m square: two player armchairs across the board, two watchers' poufs at the sides.
  ludo: build(
    "ludo",
    "Ludo Lounge",
    "Dice & tactics · sixteen tables",
    "#FF8A1F",
    LUDO_TABLES_Z.flatMap((z) => LUDO_TABLES_X.map((x) => ({ x, z, ...LUDO_TABLE }))),
    () => [
      { x: 0, z: LUDO_CHAIR }, // s0: south side (towards the entrance)
      { x: 0, z: -LUDO_CHAIR }, // s1: north side
    ],
    [
      { x: LUDO_BAR.x, z: (LUDO_BAR.z0 + LUDO_BAR.z1) / 2, w: 1.0, d: LUDO_BAR.z1 - LUDO_BAR.z0 }, // coffee counter
      { x: -16.55, z: (LUDO_BAR.z0 + LUDO_BAR.z1) / 2, w: 0.9, d: LUDO_BAR.z1 - LUDO_BAR.z0 }, // back counter
      // watchers' poufs beside every table
      ...LUDO_TABLES_Z.flatMap((z) => LUDO_TABLES_X.flatMap((x) => [-1, 1].map((s) => ({ x: x + s * LUDO_POUF.x, z, w: LUDO_POUF.s, d: LUDO_POUF.s })))),
      // east lounge A: sofa on the wall, two armchairs, coffee table (under the giant die)
      { x: 16.3, z: -3.6, w: 1.0, d: 2.3 },
      { x: 14.6, z: -3.6, w: 0.8, d: 1.2 },
      { x: 13.0, z: -5.0, w: 0.9, d: 0.9 },
      { x: 13.0, z: -2.2, w: 0.9, d: 0.9 },
      // east lounge B: two sofas facing over a low table
      { x: 14.6, z: 3.9, w: 2.3, d: 1.0 },
      { x: 14.6, z: 8.1, w: 2.3, d: 1.0 },
      { x: 14.6, z: 6.0, w: 1.2, d: 0.8 },
      // window banquette (two runs either side of the centre planter)
      { x: -6.0, z: -12.35, w: 10.4, d: 0.7 },
      { x: 6.0, z: -12.35, w: 10.4, d: 0.7 },
      // board-game library on the west wall (south of the bar)
      { x: -16.75, z: 8.0, w: 0.5, d: 3.4 },
      ...LUDO_PLANTERS.map(([x, z]) => ({ x, z, w: 0.9, d: 0.9 })),
    ],
    { size: LUDO_SIZE, aisles: LUDO_AISLES, lanes: LUDO_LANES },
  ),
  // 16 low tables in two wings round the courtyard tree; two cushioned stools per table on the long sides.
  igisoro: build(
    "igisoro",
    "Igisoro Court",
    "Rwandan strategy · sixteen boards",
    "#27AE60",
    IGISORO_TABLES_Z.flatMap((z) => IGISORO_TABLES_X.map((x) => ({ x, z, ...IGISORO_TABLE }))),
    () => [
      { x: 0, z: IGISORO_STOOL_Z }, // s0: south side (towards the entrance)
      { x: 0, z: -IGISORO_STOOL_Z }, // s1: north side
    ],
    [
      // courtyard: tree planter with its built-in ring bench
      { x: IGISORO_TREE.x, z: IGISORO_TREE.z, w: IGISORO_TREE_BENCH * 2, d: IGISORO_TREE_BENCH * 2 },
      // spectator lounge (north glazing): sofa, coffee table, two lounge chairs
      { x: IGISORO_LOUNGE.x, z: IGISORO_LOUNGE.z - 1.45, w: 2.3, d: 0.95 },
      { x: IGISORO_LOUNGE.x, z: IGISORO_LOUNGE.z - 0.1, w: 1.3, d: 0.7 },
      { x: IGISORO_LOUNGE.x - 2.3, z: IGISORO_LOUNGE.z, w: 0.9, d: 0.9 },
      { x: IGISORO_LOUNGE.x + 2.3, z: IGISORO_LOUNGE.z, w: 0.9, d: 0.9 },
      // spectator banquette under the Imigongo feature wall (east)
      { x: 16.45, z: -0.6, w: 0.7, d: 19 },
      // timber window seats in the west window bays
      ...IGISORO_WEST_WINDOWS.map((z) => ({ x: -16.55, z, w: 0.6, d: 2.2 })),
      // tall plants in the four corners
      { x: -16.3, z: -12.3, w: 0.9, d: 0.9 },
      { x: 16.3, z: -12.3, w: 0.9, d: 0.9 },
      { x: 16.3, z: 12.3, w: 0.9, d: 0.9 },
      { x: -16.3, z: 12.3, w: 0.9, d: 0.9 },
    ],
    { size: IGISORO_SIZE, aisles: IGISORO_AISLES },
  ),
  // Administrative Block (P2-ADM-02): no game tables. Reception lobby, a corridor and four closed offices
  // (admin-block/plan.ts); the walls are solid for walking and the camera, the office doors are dynamic colliders.
  admin: build("admin", "Administrative Block", "Reception · four offices", ADMIN_COLOR, [], () => [], ADMIN_COLLIDERS, {
    size: { ...ADMIN_SIZE },
    aisles: [0],
    walls: ADMIN_WALLS,
  }),
};

export const isHallGame = (g: string): g is HallGame => g === "pool" || g === "ludo" || g === "igisoro" || g === "admin";
/** halls with game tables (seats claimed through the realtime server) */
export const isGameHall = (g: string): g is Exclude<HallGame, "admin"> => g === "pool" || g === "ludo" || g === "igisoro";
