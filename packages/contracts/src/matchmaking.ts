import { z } from "zod";
import { GameIdSchema, type GameId } from "./games.js";

/**
 * Matchmaking v2 (P2-MM-05, docs/MATCHMAKING-V2.md): one process-wide "find an opponent" queue per game (a ticket
 * carries the stakes it accepts), an "Opponent found → Accept / Decline" step, account-level challenges (invites)
 * that reach the other person in any hall or on the plaza, and a rendezvous: a table / ring is reserved for the two
 * players, both walk there, and the match starts once both are at it (escrow only then, through the API).
 *
 * Kill switch: FF_MATCH_V2=0 on the server (the v1 `quickmatch-*` / `propose` handlers stay), NEXT_PUBLIC_FF_MATCH_V2=0
 * on the web.
 */

/** the times the flows use (seconds) — the product decisions are in docs/MATCHMAKING-V2.md §6 */
export const MM_TIMING = {
  /** "Opponent found": both must accept within this */
  acceptSeconds: 20,
  /** a challenge waits this long for an answer */
  inviteSeconds: 45,
  /** after both said yes: time to walk to the reserved table / ring before the meeting is called off */
  arriveSeconds: 90,
  /** searching this long with nobody found: offer to widen the stake */
  widenAfterSeconds: 30,
  /** searching this long: suggest Practice vs AI */
  practiceAfterSeconds: 60,
} as const;

/** anti-spam: challenges one account may send per minute, and open at once */
export const INVITE_LIMITS = { perMinute: 6, open: 3 } as const;

/** the holder shown in a hall's `seats` map for a chair reserved for a matched player: `~res:<accountId>` */
export const RESERVED_SEAT_PREFIX = "~res:";
export const reservedFor = (holder: string | undefined): string | null => (holder?.startsWith(RESERVED_SEAT_PREFIX) ? holder.slice(RESERVED_SEAT_PREFIX.length) : null);

/** where a game is played: its hall (one per game) */
export const GAME_HALL: Record<GameId, "igisoro" | "ludo" | "pool" | "boxing"> = { igisoro: "igisoro", ludo: "ludo", pool: "pool", boxing: "boxing" };

const Stake = z.number().int().min(0).max(10_000);
const Place = z.string().regex(/^(t\d{1,2}|R\d{1,2})$/);
export const MmVenueSchema = z.object({ place: Place.optional() });
export type MmVenue = z.infer<typeof MmVenueSchema>;

export const MmFindSchema = z.object({
  game: GameIdSchema,
  /** the stakes this player accepts, preferred first (1–5 of them; 0 = Friendly) */
  stakes: z.array(Stake).min(1).max(5),
  venue: MmVenueSchema.optional(),
});
export const MmRespondSchema = z.object({ id: z.string().min(1).max(40), accept: z.boolean() });
export const MmWidenSchema = z.object({ stakes: z.array(Stake).min(1).max(5) });
export const InviteSendSchema = z.object({
  /** the other person's account id */
  to: z.string().min(1).max(64),
  game: GameIdSchema,
  stake: Stake,
  venue: MmVenueSchema.optional(),
});
export const InviteRespondSchema = z.object({ id: z.string().min(1).max(40), accept: z.boolean() });
export const InviteCancelSchema = z.object({ id: z.string().min(1).max(40) });
export const VenuesGetSchema = z.object({ game: GameIdSchema });

/** client → server */
export const MmMsg = {
  find: "mm-find",
  cancel: "mm-cancel",
  widen: "mm-widen",
  respond: "mm-respond",
  invite: "invite-send",
  inviteRespond: "invite-respond",
  inviteCancel: "invite-cancel",
  venues: "venues-get",
  online: "online-get",
} as const;
/** server → client */
export const MmEvt = {
  status: "mm-status",
  found: "mm-found",
  closed: "mm-closed",
  go: "mm-go",
  invite: "invite",
  inviteSent: "invite-sent",
  inviteClosed: "invite-closed",
  venues: "venues",
  online: "online",
} as const;

export interface MmPerson {
  uid: string;
  name: string;
  level?: number;
  color?: string;
}
/** my search: idle, or searching for `game` at `stakes` with `searching` people looking for this game right now */
export interface MmStatusMsg {
  status: "idle" | "searching" | "error";
  game?: GameId;
  stakes?: number[];
  /** ms already waited (a widen keeps the clock) */
  waitedMs?: number;
  /** others searching this game, per stake */
  searching?: Record<string, number>;
  reason?: string;
  limit?: number;
}
export interface MmFoundMsg {
  id: string;
  game: GameId;
  stake: number;
  opponent: MmPerson;
  ttlMs: number;
}
/** why a found match / meeting / invite ended */
export type MmCloseReason =
  | "DECLINED"
  | "EXPIRED"
  | "OPPONENT_DECLINED"
  | "OPPONENT_TIMEOUT"
  | "NO_SHOW"
  | "PLAYER_LEFT"
  | "NO_FREE_PLACE"
  | "BUSY"
  | "OFFLINE"
  | "BLOCKED"
  | "DUPLICATE"
  | "TOO_MANY_OPEN"
  | "RATE_LIMITED"
  | "CANCELLED"
  | "OPPONENT_CANT_PLAY"
  | string;
export interface MmClosedMsg {
  id: string;
  kind: "found" | "meet";
  reason: MmCloseReason;
  /** back in the queue (the other one declined / timed out) */
  requeued?: boolean;
  game?: GameId;
  limit?: number;
}
/** both said yes: walk to this place (another hall: go there first); the match starts once both are at it */
export interface MmGoMsg {
  id: string;
  game: GameId;
  stake: number;
  hall: "igisoro" | "ludo" | "pool" | "boxing";
  /** the hall instance to join (another one would not have the reservation) */
  roomId: string;
  /** table (`t3`) and my chair (`t3s1`); Boxing: the ring is assigned in the hall (boxing-assigned) */
  table?: string;
  seat?: string;
  opponent: MmPerson;
  ttlMs: number;
}
export interface InviteMsg {
  id: string;
  from: MmPerson;
  game: GameId;
  stake: number;
  venue?: { hall: string; place?: string };
  ttlMs: number;
}
export interface InviteSentMsg {
  id: string;
  to: MmPerson;
  game: GameId;
  stake: number;
  ttlMs: number;
}
export interface InviteClosedMsg {
  id: string | null;
  reason: MmCloseReason;
  /** the other person (for the words: "Amani said no") */
  name?: string;
  game?: GameId;
  limit?: number;
}
export type VenueStatus = "free" | "waiting" | "playing" | "held" | "reserved";
export interface VenuesMsg {
  game: GameId;
  hall: string;
  /** table / ring id → status (missing = free) */
  places: Record<string, VenueStatus>;
  /** people searching this game, per stake */
  searching: Record<string, number>;
}
export interface OnlineMsg {
  people: (MmPerson & { where: string; busy: boolean })[];
}
