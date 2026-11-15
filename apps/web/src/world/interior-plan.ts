/**
 * What you see through a building's glass (P2-WLD-15): the room behind every glazed shopfront, door vestibule and
 * window, as data. The interior-mapping shader (world/interior-glass.ts) reads one row of this table per building
 * kind; the geometry carries only (kind, view) in its UVs, so every pane in the district shares ONE material and is
 * merged into ONE draw call.
 *
 * Room frame (per pane): u runs along the glass (world metres), y is the height above the plaza floor (the interior
 * floor is level with the paving), depth runs into the building. A room has a back wall at `depth`, a floor, a
 * ceiling at `ceiling` (glass above it shows the spandrel / the storey slab), and two furniture cards standing at
 * `near` and `far` metres behind the glass, drawn from the hall's own furniture (tiled every `tile` m).
 *
 * Content matches the interiors you walk into (rooms/PoolHall, LudoLounge, IgisoroCourt, AdminBlock,
 * TournamentArena, fight/LobbyScene): pool tables under long pendants, Ludo tables with the four-colour boards,
 * low Igisoro boards on stools, the Arena foyer's turnstiles and video wall, the Block's reception desk, the Fight
 * pavilion's training-ring corner and heavy bags.
 */

/** building kinds with a modelled room behind their glass, in shader order (the atlas rows) */
export const INTERIOR_KINDS = ["pool", "ludo", "igisoro", "arena", "admin", "fight"] as const;
export type InteriorKind = (typeof INTERIOR_KINDS)[number];

/**
 * How the pane is seen: a glazed `shopfront` (glass: tint, reflection, pane frames), the open inner doorway at the
 * end of a door `vestibule` (no glass: the hall itself, deeper), or a small `window` (glass, a shallower room).
 */
export const INTERIOR_VIEWS = ["shopfront", "vestibule", "window"] as const;
export type InteriorView = (typeof INTERIOR_VIEWS)[number];

export interface InteriorRoom {
  /** back wall depth behind the glass (m), shopfront / window */
  depth: number;
  /** back wall depth seen through the vestibule's inner doorway (the hall itself, m) */
  hallDepth: number;
  /** ceiling height above the floor (m); glass above it shows the slab edge */
  ceiling: number;
  /** horizontal repeat of the furniture cards and the back wall (m) */
  tile: number;
  /** near / far furniture card depths (m behind the glass) */
  near: number;
  far: number;
  /** spacing of the ceiling downlights / pendants (m) */
  lamps: number;
  /** mullion module of the glazing (m, 0 = framed by the facade's own fins / mullions) and transom height (m) */
  pane: number;
  transom: number;
  /** linear-ish sRGB hex colours: back wall base, floor, ceiling, lamp light, the room's average (distance fade) */
  wall: string;
  floor: string;
  ceil: string;
  lamp: string;
  avg: string;
}

export const INTERIOR_ROOMS: Record<InteriorKind, InteriorRoom> = {
  // the wing's double-height lobby in front of the pool hall: blue-felt tables under long pendants, timber slat walls
  pool: { depth: 7.2, hallDepth: 16, ceiling: 7.0, tile: 6.4, near: 2.6, far: 5.0, lamps: 3.2, pane: 0, transom: 0, wall: "#5a4030", floor: "#3a3836", ceil: "#1c1b1b", lamp: "#fff1df", avg: "#3a302a" },
  // Ludo Lounge: warm herringbone floor, beige plaster walls, globe pendants, tables with the four-colour boards
  ludo: { depth: 6.6, hallDepth: 14, ceiling: 4.8, tile: 5.6, near: 2.2, far: 4.4, lamps: 2.8, pane: 1.6, transom: 3.0, wall: "#c9ab8a", floor: "#c09468", ceil: "#d8c4a4", lamp: "#fff0d0", avg: "#a88a68" },
  // Igisoro Court: dark timber walls with an Imigongo band, terracotta tiles, low carved boards on stools
  igisoro: { depth: 5.2, hallDepth: 13, ceiling: 4.2, tile: 5.2, near: 1.9, far: 3.6, lamps: 2.6, pane: 0, transom: 0, wall: "#4a3020", floor: "#9a4e32", ceil: "#3a2616", lamp: "#ffd79a", avg: "#5e3a26" },
  // Tournament Arena foyer: tall, cool-white light, turnstiles, the video wall in front of the drum
  arena: { depth: 4.6, hallDepth: 18, ceiling: 6.1, tile: 6.0, near: 1.6, far: 3.3, lamps: 2.4, pane: 0, transom: 0, wall: "#3a3b44", floor: "#8e8a84", ceil: "#2c2d33", lamp: "#eef1ff", avg: "#4a4a54" },
  // Administrative Block: light lobby, reception desk in timber and stone, office doors and the directory
  admin: { depth: 7.0, hallDepth: 14, ceiling: 5.0, tile: 7.0, near: 2.8, far: 5.0, lamps: 2.4, pane: 0, transom: 0, wall: "#e2ddd3", floor: "#c4beb3", ceil: "#ece9e2", lamp: "#fff3e0", avg: "#b8b0a2" },
  // Fight Games pavilion: the lit training-ring corner behind the glazing, heavy bags beyond, board-formed concrete walls
  fight: { depth: 8.0, hallDepth: 16, ceiling: 4.4, tile: 7.6, near: 2.0, far: 4.8, lamps: 2.6, pane: 0, transom: 0, wall: "#8a8178", floor: "#6c6a66", ceil: "#18181b", lamp: "#f4f1ea", avg: "#4a4642" },
};

/** The (u, v) a pane's vertices carry: the kind and view, at the centre of their integer cell (exact after merging). */
export function interiorUV(kind: InteriorKind, view: InteriorView): [number, number] {
  return [INTERIOR_KINDS.indexOf(kind) + 0.5, INTERIOR_VIEWS.indexOf(view) + 0.5];
}

/** Inverse of interiorUV (what the shader does with floor()). */
export function decodeInteriorUV(u: number, v: number): { kind: InteriorKind; view: InteriorView } | null {
  const kind = INTERIOR_KINDS[Math.floor(u)];
  const view = INTERIOR_VIEWS[Math.floor(v)];
  return kind && view ? { kind, view } : null;
}

/** Is `kind` a building with a modelled room behind its glass? */
export const hasInterior = (kind: string): kind is InteriorKind => (INTERIOR_KINDS as readonly string[]).includes(kind);

/**
 * Where a ray through the glass ends in the room (the same maths as the shader, for tests and tuning): the glass point
 * at height `y`, the view ray `r` in the pane frame (x along the glass, y up, z into the room, z > 0).
 * Returns what it hits first and how deep.
 */
export function roomHit(room: Pick<InteriorRoom, "depth" | "ceiling">, y: number, r: { x: number; y: number; z: number }) {
  const tBack = room.depth / Math.max(r.z, 1e-4);
  const tFloor = r.y < 0 ? -y / r.y : Infinity;
  const tCeil = r.y > 0 ? (room.ceiling - y) / r.y : Infinity;
  const t = Math.min(tBack, tFloor, tCeil);
  const surface = t === tBack ? "back" : t === tFloor ? "floor" : "ceiling";
  return { surface, t, depth: r.z * t, x: r.x * t, y: y + r.y * t } as const;
}
