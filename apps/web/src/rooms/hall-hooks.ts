import type { HallGame, Rect } from "./layouts";

/**
 * Per-hall extensions of the generic hall controller (RoomPlayer), for halls whose floor plan is more than one open
 * room (the Administrative Block: lobby, corridor, closed offices). Halls without hooks behave as before.
 */
export interface P {
  x: number;
  z: number;
}
export interface HallHooks {
  /** extra solids right now (closed office doors): walking AND camera blockers, like `layout.walls` */
  solids?: () => Rect[];
  /** route from one point to another (through doors / openings); the last point is the destination */
  route?: (from: P, to: P) => P[];
  /** a tap on the floor at `p`: the point to walk to (e.g. the door front of an office you may not enter) */
  tap?: (p: P) => P;
  /* --- halls on several levels (Tournament Arena, P2-ARN-03) --- */
  /** height of the walking surface (stairs, raked rows, sunken floor); 0 everywhere when absent */
  ground?: (x: number, z: number) => number;
  /** may you stand here? A step onto a non-walkable spot slides along the edge or is refused */
  walkable?: (x: number, z: number) => boolean;
  /** chair footprint radius (seat rows: small, so the stair aisles between them stay walkable) */
  chairR?: number;
  /** where you step to after standing up from `seat` (e.g. back to the stair aisle of a seat row) */
  standSpot?: (seatId: string) => P | null;
  /** release the chair on the server (default: the hall `stand` message) */
  stand?: () => void;
  /** last word on the follow camera (keep it inside the bowl, above the rake) */
  camClamp?: (cam: { x: number; y: number; z: number }) => void;
  /** may this chair be offered to you right now ("Sit down" prompt)? (the server has the final say) */
  seatOk?: (id: string) => boolean;
  /** movement input is suspended (a full-screen window has the keyboard, e.g. the office computer) */
  frozen?: () => boolean;
}
export const hallHooks: Partial<Record<HallGame, HallHooks>> = {};

/** Scripted multi-leg walk (consumed by RoomPlayer: the next leg starts when the current nav target is reached). */
export const walkQueue = { legs: [] as P[] };
