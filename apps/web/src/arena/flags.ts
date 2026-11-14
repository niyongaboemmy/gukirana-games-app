/**
 * Feature flag for the Tournament Arena interior (P2-ARN-03). On by default; NEXT_PUBLIC_FF_ARENA=0 keeps the arena
 * building on the plaza with its doors locked, until the flag service (OpenFeature / Unleash, plan §4) takes over.
 */
export const ARENA_ON = process.env.NEXT_PUBLIC_FF_ARENA !== "0";

/**
 * The arena's plaza doors (world/Plaza AutoDoors) open only while the last GET /arena/status said `canEnter`
 * (arena/ArenaDoorWatch keeps this fresh while you are near the door). Plain mutable state, read every frame.
 */
export const arenaGate = { canEnter: false, checkedAt: 0 };
