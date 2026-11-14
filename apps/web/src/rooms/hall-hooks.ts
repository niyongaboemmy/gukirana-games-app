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
}
export const hallHooks: Partial<Record<HallGame, HallHooks>> = {};

/** Scripted multi-leg walk (consumed by RoomPlayer: the next leg starts when the current nav target is reached). */
export const walkQueue = { legs: [] as P[] };
