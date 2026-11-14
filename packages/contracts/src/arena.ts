import { z } from "zod";

/**
 * Tournament Arena — shared contract between the 3D arena (web), the realtime room and the API (P2-ARN-01).
 *
 * Access model (three layers, checked on the server; the client only mirrors them):
 *  1. Building:  anyone (guests included) may enter the CONCOURSE while the arena is open (admin switch) and they are not barred.
 *  2. Event:     to take a SEAT in the bowl during an event, the person needs a PASS, which they may claim only if the
 *                event's SCOPE admits them (and capacity is left). With no event running, seating is free for all.
 *  3. Floor:     the competition floor (stage tables) is only for the event's registered PARTICIPANTS and staff.
 * Admins (super_admin or event_manager) open / close the arena, create events and scopes, invite and bar people.
 * No money moves here: entry fees and prizes arrive with the tournament engine (P2-TRN) through LedgerService.
 */

export const ArenaZoneSchema = z.enum(["concourse", "seats", "vip", "floor"]);
export type ArenaZone = z.infer<typeof ArenaZoneSchema>;

/**
 * Who may attend an event (claim a pass). Scopes combine with AND when several are listed in `rules`.
 *  - public:        anyone, guests included
 *  - members:       signed-in players
 *  - min_level:     signed-in players at or above `level`
 *  - invite:        only users on the event's invite list
 *  - participants:  only the event's registered players (plus up to `guests` invited companions each)
 *  - role:          holders of one of `roles` (staff / press / VIP roles from the Admin Block role table)
 *  - age_verified:  players whose age check passed (needed before any cash event; flag from identity)
 */
export const ArenaScopeRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("members") }),
  z.object({ kind: z.literal("min_level"), level: z.number().int().min(1).max(999) }),
  z.object({ kind: z.literal("invite") }),
  z.object({ kind: z.literal("participants"), guests: z.number().int().min(0).max(4).default(0) }),
  z.object({ kind: z.literal("role"), roles: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/)).min(1) }),
  z.object({ kind: z.literal("age_verified") }),
]);
export type ArenaScopeRule = z.infer<typeof ArenaScopeRuleSchema>;

export const ArenaEventStatusSchema = z.enum(["draft", "scheduled", "doors_open", "live", "ended", "cancelled"]);
export type ArenaEventStatus = z.infer<typeof ArenaEventStatusSchema>;

export const ArenaEventKindSchema = z.enum(["tournament", "final", "exhibition", "watch_party", "ceremony"]);

export const ArenaEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(3).max(80),
  kind: ArenaEventKindSchema,
  game: z.enum(["pool", "ludo", "igisoro"]).nullable(),
  status: ArenaEventStatusSchema,
  startsAt: z.string(), // ISO
  endsAt: z.string(),
  doorsOpenAt: z.string(),
  rules: z.array(ArenaScopeRuleSchema).min(1),
  /** seats for spectators (passes); the bowl has ARENA_SEATS seats in total */
  capacity: z.number().int().min(1),
  vipCapacity: z.number().int().min(0),
  passesIssued: z.number().int().nonnegative(),
  description: z.string().max(400).default(""),
  /** P2-ARN-02 additions (optional so older mocks still parse): VIP passes issued (included in passesIssued) */
  vipIssued: z.number().int().nonnegative().optional(),
  /** rules are only `public`: no pass needed to sit, first come first served up to capacity (guests included) */
  openSeating: z.boolean().optional(),
});
export type ArenaEvent = z.infer<typeof ArenaEventSchema>;

/** Why someone may not go further (shown in plain words by the client). */
export const ARENA_DENIALS = [
  "ARENA_CLOSED", // admin switch is off
  "BARRED", // this person is barred from the arena (admin)
  "LOGIN_REQUIRED", // scope needs a signed-in player
  "LEVEL_TOO_LOW",
  "NOT_INVITED",
  "NOT_PARTICIPANT",
  "ROLE_REQUIRED",
  "AGE_CHECK_REQUIRED",
  "SOLD_OUT", // capacity reached
  "NO_PASS", // tried to sit during an event without a pass
  "EVENT_NOT_OPEN", // doors not open yet / ended / cancelled
  "SEAT_TAKEN",
  "RATE_LIMITED",
  // P2-ARN-02 additions
  "PASS_LIMIT", // already holds the maximum number of passes for upcoming events
  "ROOM_FULL", // the arena room reached maxConcourse
] as const;
export type ArenaDenial = (typeof ARENA_DENIALS)[number];

/** GET /arena/status (anyone; guests allowed): what the building shows at the door. */
export const ArenaStatusSchema = z.object({
  open: z.boolean(),
  /** the viewer may walk into the concourse */
  canEnter: z.boolean(),
  denial: z.enum(ARENA_DENIALS).nullable(),
  current: ArenaEventSchema.nullable(), // doors_open or live
  next: ArenaEventSchema.nullable(),
  /** the viewer's pass for `current` (null = none) */
  pass: z.object({ eventId: z.string().uuid(), zone: z.enum(["seats", "vip", "floor"]), seat: z.string().nullable() }).nullable(),
  /** may the viewer claim a pass for `current` right now (scope + capacity), and if not, why */
  canClaim: z.boolean(),
  claimDenial: z.enum(ARENA_DENIALS).nullable(),
  occupancy: z.object({ concourse: z.number().int(), seats: z.number().int() }),
});
export type ArenaStatus = z.infer<typeof ArenaStatusSchema>;

/* Endpoints (API):
 *  GET  /arena/status                         ArenaStatus (guest token or user token)
 *  GET  /arena/events?upcoming=1              ArenaEvent[] (public fields)
 *  POST /arena/events/:id/pass                claim a pass → { pass } | 403 { denial }   (idempotent per user+event)
 *  DELETE /arena/events/:id/pass              give the pass back
 * Admin (RoleGuard: super_admin | event_manager, or x-admin-token), all audited:
 *  GET/PUT  /admin/arena/settings             { open, defaultCapacity, maxConcourse }
 *  GET/POST /admin/arena/events, PATCH/DELETE /admin/arena/events/:id   (status transitions validated)
 *  GET/PUT/DELETE /admin/arena/events/:id/invites      (user id | username | email | phone)
 *  GET/PUT/DELETE /admin/arena/events/:id/participants
 *  GET/POST/DELETE /admin/arena/bars           { user, reason, until? }
 *  GET  /admin/arena/events/:id/attendance     passes + who is inside
 * Internal (x-internal-token, realtime):  GET /internal/arena/access/:userId?event=  → { open, barred, pass, roles, level }
 */

/* ---------------- realtime (hall room with game "arena") ---------------- */

/** client → server */
export const ArenaMsg = {
  /** ask to move into a zone (seats / vip / floor); the server checks the pass and capacity */
  zone: "arena-zone", // { zone }
  /** ask for a specific seat id (see seat ids below) */
  sit: "arena-sit", // { seat }
  stand: "arena-stand", // {}
} as const;

/** server → client */
export const ArenaEvt = {
  zoneOk: "arena-zone-ok", // { zone }
  denied: "arena-denied", // { action: "enter" | "zone" | "sit", reason: ArenaDenial }
  seated: "arena-seated", // { seat }
  /** event state changed (doors open, live, ended) — clients refresh /arena/status */
  event: "arena-event", // { eventId, status }
  occupancy: "arena-occupancy", // { concourse, seats }
  /** admin closed the arena or barred you: walk out to the plaza */
  removed: "arena-removed", // { reason: "ARENA_CLOSED" | "BARRED" }
  /** P2-ARN-02 addition: taken bowl seats in this room (on join and on every change) */
  seats: "arena-seats", // { taken: string[] }
} as const;

export const ArenaZoneMsgSchema = z.object({ zone: z.enum(["seats", "vip", "floor"]) });

/**
 * Bowl seat ids: `{section}-{row}-{seat}`; sections A..L (lower bowl, 12 sections) and U1..U8 (upper bowl),
 * V1..V4 = VIP boxes. Rows/seats per section are fixed here so the server can validate without the 3D scene.
 */
export const ARENA_BOWL = {
  lower: { sections: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"], rows: 6, seats: 10 },
  upper: { sections: ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"], rows: 5, seats: 12 },
  vip: { sections: ["V1", "V2", "V3", "V4"], rows: 1, seats: 6 },
} as const;
export const ARENA_SEATS =
  ARENA_BOWL.lower.sections.length * ARENA_BOWL.lower.rows * ARENA_BOWL.lower.seats +
  ARENA_BOWL.upper.sections.length * ARENA_BOWL.upper.rows * ARENA_BOWL.upper.seats; // 720 + 480 = 1200 (VIP extra: 24)

export const ArenaSeatSchema = z.string().regex(/^(?:[A-L]|U[1-8]|V[1-4])-\d{1,2}-\d{1,2}$/);

export function isValidArenaSeat(seat: unknown): seat is string {
  if (!ArenaSeatSchema.safeParse(seat).success) return false;
  const [sec, r, s] = (seat as string).split("-") as [string, string, string];
  const row = Number(r);
  const n = Number(s);
  const tier = (Object.values(ARENA_BOWL) as { sections: readonly string[]; rows: number; seats: number }[]).find((t) => t.sections.includes(sec));
  return !!tier && row >= 1 && row <= tier.rows && n >= 1 && n <= tier.seats;
}

export const arenaSeatZone = (seat: string): "seats" | "vip" => (seat.startsWith("V") ? "vip" : "seats");

/* ---------------- P2-ARN-02 additions ---------------- */

/** GET/PUT /admin/arena/settings */
export const ArenaSettingsSchema = z.object({
  open: z.boolean(),
  /** default spectator capacity for new events (≤ ARENA_SEATS) */
  defaultCapacity: z.number().int().min(1).max(ARENA_SEATS),
  /** people in one arena room (realtime refuses more with ROOM_FULL) */
  maxConcourse: z.number().int().min(1).max(500),
});
export type ArenaSettings = z.infer<typeof ArenaSettingsSchema>;

/** Manual status moves allowed by PATCH /admin/arena/events/:id { status }. Time moves scheduled → doors_open → live → ended on their own. */
export const ARENA_TRANSITIONS: Record<ArenaEventStatus, readonly ArenaEventStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["draft", "doors_open", "cancelled"],
  doors_open: ["live", "cancelled"],
  live: ["ended", "cancelled"],
  ended: [],
  cancelled: [],
};

/** VIP box seats in the bowl (ARENA_BOWL.vip): 24 */
export const ARENA_VIP_SEATS = ARENA_BOWL.vip.sections.length * ARENA_BOWL.vip.rows * ARENA_BOWL.vip.seats;

/** Staff roles: enter a closed arena, walk the floor, never walked out by a close; manage /admin/arena. */
export const ARENA_STAFF_ROLES = ["super_admin", "event_manager"] as const;

/** GET /internal/arena/state (realtime polls it every ~5 s): building switch, current event, active bars. */
export interface ArenaRealtimeState {
  open: boolean;
  maxConcourse: number;
  current: { id: string; status: ArenaEventStatus; openSeating: boolean; capacity: number; vipCapacity: number; passesIssued: number } | null;
  /** user ids with an active bar */
  barred: string[];
}

/** GET /internal/arena/access/:userId?event= */
export interface ArenaUserAccess {
  open: boolean;
  barred: boolean;
  pass: { eventId: string; zone: "seats" | "vip" | "floor"; seat: string | null } | null;
  roles: string[];
  level: number;
}
