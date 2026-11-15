/**
 * Soft bodies (P3-FGT-08): people the hall controller (RoomPlayer) slides around instead of walking through, besides
 * the remote players it already knows — the halls' local staff (gym coaches, the cleaner, the referee on rounds) and
 * your own stand-in at a bag. Layers write their current position every frame and delete it on unmount. Cheap: a few
 * entries, one distance test each per frame.
 */
export const softBodies = new Map<string, { x: number; z: number; r: number }>();
