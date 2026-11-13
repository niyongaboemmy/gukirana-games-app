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

/** Hall interiors: tables × chairs per table (apps/web/src/rooms/layouts.ts; the web test checks they match). Seat ids are `t{table}s{chair}`. */
export const HALL_SEATING = {
  pool: { tables: 12, chairs: 2 },
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
export const EmoteSendSchema = z.object({
  emote: z
    .number()
    .int()
    .refine((a) => isEmoteAction(a), "not a player emote"),
  to: z.string().min(1).max(64).optional(),
});
export const CallRespondSchema = z.object({ id: z.string().min(1).max(32), accept: z.boolean() });
export const CallEndSchema = z.object({ id: z.string().min(1).max(32).optional() });
/** Block keys: `u:<userId>` (signed-in, persisted by the API) or `s:<sessionId>` (guest, this session only). */
export const BlockKeySchema = z.string().regex(/^(u|s):[\w-]{1,64}$/);
export const BlockListSchema = z.object({ keys: z.array(BlockKeySchema).max(MAX_BLOCKS) });
export const UnblockSchema = z.object({ key: BlockKeySchema });

/** Reasons offered by the Report sheet (DESIGN-SPEC §12.3). */
export const ReportReasonSchema = z.enum(["harassment", "hate", "scam", "cheating", "inappropriate", "other"]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

// ---------------------------------------------------------------------------------------------------------------
// People actions (P1-WLD-02 / P1-COM-04): the avatar `anim` codes everyone sees in `moves`
// ---------------------------------------------------------------------------------------------------------------

/**
 * Avatar animation / action codes carried in the `anim` field of every pose update (`move` → `moves`). Persistent
 * states (sitting, leaning, drinking a coffee, watching a table) stay in `anim` for as long as they last, so people
 * who arrive later see them too; one-shot emotes are also announced with an `emote` message for an instant start.
 * Automatic idle life (weight shifts, glances, phone checks …) is NOT sent: every client derives it from a seed.
 */
export const ACT = {
  idle: 0,
  walk: 1,
  run: 2,
  wave: 10,
  dance: 11,
  clap: 12,
  sit: 13,
  nod: 14,
  shakeHead: 15,
  laugh: 16,
  thumbsUp: 17,
  point: 18,
  shrug: 19,
  cheer: 20,
  handshake: 21,
  fistBump: 22,
  hug: 23,
  think: 24,
  disappointed: 25,
  chalk: 26,
  phone: 27,
  coffee: 28,
  photo: 29,
  lean: 30,
  watch: 31,
} as const;
export type ActCode = (typeof ACT)[keyof typeof ACT];

/** Two-person contact actions: only while the server has paired both people (consent given). */
export const PAIR_KINDS = ["handshake", "fistBump", "hug"] as const;
export type PairKind = (typeof PAIR_KINDS)[number];
export const PAIR_ACT: Record<PairKind, ActCode> = { handshake: ACT.handshake, fistBump: ACT.fistBump, hug: ACT.hug };
/** Pelvis-to-pelvis distance the two people stand at (m): a handshake at arm's length, a hug close. */
export const PAIR_DISTANCE: Record<PairKind, number> = { handshake: 0.95, fistBump: 0.98, hug: 0.42 };
/** How long the contact lasts once both stand in place (ms). */
export const PAIR_MS: Record<PairKind, number> = { handshake: 2600, fistBump: 1500, hug: 3000 };
/** Max distance (m) between the two people to ask / accept, and how long an invitation waits. */
export const PAIR_RANGE = 3;
export const PAIR_INVITE_MS = 15_000;
/** Time both clients get to walk into place before the contact starts (ms). */
export const PAIR_ALIGN_MS = 650;

const CONTACT = new Set<number>([ACT.handshake, ACT.fistBump, ACT.hug]);
const KNOWN = new Set<number>(Object.values(ACT));
export const isContactAction = (a: number): boolean => CONTACT.has(a);
/** Any code a client may put in its own `anim` (contact codes additionally need an active pair on the server). */
export const isKnownAnim = (a: unknown): a is ActCode => typeof a === "number" && KNOWN.has(a);
/** Codes a player can trigger with an `emote` message (not locomotion, not sitting, not contact). */
export const isEmoteAction = (a: unknown): a is ActCode => isKnownAnim(a) && a >= 10 && a !== ACT.sit && !CONTACT.has(a);

export const PairKindSchema = z.enum(PAIR_KINDS);
export const PairRequestSchema = z.object({ to: z.string().min(1).max(64), kind: PairKindSchema });
export const PairRespondSchema = z.object({ id: z.string().min(1).max(32), accept: z.boolean() });

/** Where each of the two people stands for a contact action: facing each other `PAIR_DISTANCE` apart (m). */
export function pairPlacement(kind: PairKind, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-4 ? dx / d : 0;
  const uz = d > 1e-4 ? dz / d : 1;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const h = PAIR_DISTANCE[kind] / 2;
  const yawA = Math.atan2(ux, uz);
  return {
    a: { x: mx - ux * h, z: mz - uz * h, yaw: yawA },
    b: { x: mx + ux * h, z: mz + uz * h, yaw: Math.atan2(-ux, -uz) },
  };
}
