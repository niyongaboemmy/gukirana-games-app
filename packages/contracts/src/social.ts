import { z } from "zod";

/**
 * Shared social contracts (SRS §8.4, FR-COM-*, SAFE-*): seat ids the realtime server validates, chat scopes,
 * DM / call / block messages. Positions are metres in plaza / hall space (same frame as apps/web/src/world).
 */

// ---------------------------------------------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------------------------------------------

/** Plaza benches: timber benches on lava-stone plinths around the fountain (apps/web/src/world/layout.ts BENCHES). */
export const PLAZA_BENCH_ANGLES = [30, 90, 150, -30, -90, -150] as const;
export const PLAZA_BENCH_RADIUS = 11;
/** Three places per 2.1 m bench, facing the fountain. Offsets along the bench (m). */
export const PLAZA_BENCH_SLOTS = [-0.68, 0, 0.68] as const;
/** Seat surface height of the plaza benches (m). The seated animation is authored for a 0.46 m seat. */
export const PLAZA_BENCH_SEAT_Y = 0.46;

export interface SeatPose {
  id: string;
  /** seat centre on the floor (m) */
  x: number;
  z: number;
  /** avatar rotation.y when seated (forward = (sin yaw, cos yaw)) */
  yaw: number;
}

function benchSeat(bench: number, slot: number): SeatPose {
  const deg = PLAZA_BENCH_ANGLES[bench]!;
  const a = (deg * Math.PI) / 180;
  const bx = PLAZA_BENCH_RADIUS * Math.sin(a);
  const bz = -PLAZA_BENCH_RADIUS * Math.cos(a);
  const o = PLAZA_BENCH_SLOTS[slot]!;
  // bench local +x in world = (cos a, sin a); local +z (towards the fountain) = (-sin a, cos a) → yaw = -a
  return { id: `b${bench}s${slot}`, x: bx + o * Math.cos(a), z: bz + o * Math.sin(a), yaw: -a };
}

export const PLAZA_SEATS: readonly SeatPose[] = PLAZA_BENCH_ANGLES.flatMap((_, b) => PLAZA_BENCH_SLOTS.map((__, s) => benchSeat(b, s)));
const PLAZA_SEAT_IDS = new Set(PLAZA_SEATS.map((s) => s.id));

/** Hall interiors: tables × chairs per table (apps/web/src/rooms/layouts.ts). Seat ids are `t{table}s{chair}`. */
export const HALL_SEATING = {
  pool: { tables: 4, chairs: 2 },
  ludo: { tables: 6, chairs: 4 },
  igisoro: { tables: 6, chairs: 2 },
} as const;
export type HallId = keyof typeof HALL_SEATING;
export const isHallId = (g: unknown): g is HallId => g === "pool" || g === "ludo" || g === "igisoro";

/** `plaza` → bench seats; a hall id → that hall's chairs. Anything else (or an unknown id) is rejected. */
export function isValidSeat(place: "plaza" | HallId, seat: unknown): seat is string {
  if (typeof seat !== "string" || seat.length > 8) return false;
  if (place === "plaza") return PLAZA_SEAT_IDS.has(seat);
  const m = /^t(\d{1,2})s(\d)$/.exec(seat);
  if (!m) return false;
  const { tables, chairs } = HALL_SEATING[place];
  return Number(m[1]) < tables && Number(m[2]) < chairs;
}

export const plazaSeat = (id: string): SeatPose | undefined => PLAZA_SEATS.find((s) => s.id === id);

// ---------------------------------------------------------------------------------------------------------------
// Chat / DMs / calls / blocks
// ---------------------------------------------------------------------------------------------------------------

/** Nearby text chat reaches players within this distance of the sender (m). */
export const NEARBY_CHAT_RANGE = 12;
export const EMOTE_COOLDOWN_MS = 1500;
export const CHAT_MIN_INTERVAL_MS = 800;
export const CALL_RING_MS = 30_000;
export const MAX_BLOCKS = 500;

export const ChatScopeSchema = z.enum(["nearby", "room"]);
export type ChatScope = z.infer<typeof ChatScopeSchema>;

export const ChatSendSchema = z.object({ text: z.string().min(1).max(400), scope: ChatScopeSchema.default("room") });
export const DmSendSchema = z.object({ to: z.string().min(1).max(64), text: z.string().min(1).max(400) });
export const TargetSchema = z.object({ to: z.string().min(1).max(64) });
export const EmoteSendSchema = z.object({ emote: z.number().int().min(10).max(20), to: z.string().min(1).max(64).optional() });
export const CallRespondSchema = z.object({ id: z.string().min(1).max(32), accept: z.boolean() });
export const CallEndSchema = z.object({ id: z.string().min(1).max(32).optional() });
/** Block keys: `u:<userId>` (signed-in, persisted by the API) or `s:<sessionId>` (guest, this session only). */
export const BlockKeySchema = z.string().regex(/^(u|s):[\w-]{1,64}$/);
export const BlockListSchema = z.object({ keys: z.array(BlockKeySchema).max(MAX_BLOCKS) });
export const UnblockSchema = z.object({ key: BlockKeySchema });

/** Reasons offered by the Report sheet (DESIGN-SPEC §12.3). */
export const ReportReasonSchema = z.enum(["harassment", "hate", "scam", "cheating", "inappropriate", "other"]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;
