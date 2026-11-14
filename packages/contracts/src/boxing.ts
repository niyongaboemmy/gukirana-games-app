import { z } from "zod";

/**
 * Fight Games hall + Boxing — shared contract between the 3D world (web, Agent W), the boxing engine
 * (packages/games/boxing), the realtime rooms and the games API (Agent G). Task P3-FGT-01, docs/FIGHT-GAMES-PLAN.md.
 *
 * Shape of the feature:
 *  - The Fight hall ("fight") is a lobby with one door per sub-hall. Boxing is open; the others say "coming soon".
 *  - The Boxing sub-hall ("boxing") is its own hall area + hall room. It holds BOXING_RING_COUNT rings (R1..R50;
 *    R1/R2 are the feature rings under the big screen). The hall room keeps the ring registry (who is in which ring,
 *    status) and relays spectator frames; a fight itself runs in its own authoritative "boxing" room at TICK_HZ.
 *  - Inside a ring a fighter wears the boxing kit of their corner (red / blue). The kit is DERIVED by every client from
 *    the ring registry (no avatar state is changed, the saved look is never touched).
 *
 * Everything here is additive and integer-only. Numbers that tune the fight (frame data, damage) live in the engine
 * package; this file only fixes ids, message names, payload shapes and error codes.
 */

/* ---------------------------------------------------------------- ids ---------------------------------------------------------------- */

export const BOXING_GAME_ID = "boxing" as const;
/** the Fight hall lobby (hall id / building id) */
export const FIGHT_HALL_ID = "fight" as const;

/** Sub-halls behind the lobby doors, in door order (left → right). Only `open` ones have a door that opens. */
export const FIGHT_SUBHALLS = [
  { id: "boxing", open: true },
  { id: "kickboxing", open: false },
  { id: "wrestling", open: false },
  { id: "karate", open: false },
] as const;
export type FightSubHallId = (typeof FIGHT_SUBHALLS)[number]["id"];
export const isFightSubHallId = (v: unknown): v is FightSubHallId => FIGHT_SUBHALLS.some((s) => s.id === v);

export const CORNERS = ["red", "blue"] as const;
export type Corner = (typeof CORNERS)[number];
/** corner colours (3D kit + HUD accents; never used for buttons) */
export const CORNER_COLORS: Record<Corner, string> = { red: "#B3261E", blue: "#1F4E9A" };

/* --------------------------------------------------------------- rings --------------------------------------------------------------- */

export const BOXING_RING_COUNT = 50;
/** the two raised feature rings under the big screen (bigger spectator rail, shown on the screen) */
export const FEATURE_RINGS = ["R1", "R2"] as const;
export type RingId = `R${number}`;
export const RING_IDS: readonly RingId[] = Array.from(
  { length: BOXING_RING_COUNT },
  (_, i) => `R${i + 1}` as RingId,
);
const RING_ID_SET = new Set<string>(RING_IDS);
export const isRingId = (v: unknown): v is RingId => typeof v === "string" && RING_ID_SET.has(v);
export const RingIdSchema = z.custom<RingId>(isRingId, "UNKNOWN_RING");

/**
 * Ring status (drives the status lights: free = green, waiting = amber, starting / fighting = red, practice = white,
 * result = red blinking, closed = off).
 *  - free:      nobody in it; anyone may claim it
 *  - waiting:   one fighter is in, waiting for an opponent (open challenge at `stake`)
 *  - starting:  both fighters are in, the match is being created (escrow) / gloving up / intro countdown
 *  - fighting:  rounds in progress (incl. rest between rounds, knockdown counts, pauses)
 *  - result:    the fight ended; the result shows for RING_RESULT_SECONDS, then the fighters step out → free
 *  - practice:  one player training against the AI (local engine; no stake, no escrow)
 *  - closed:    staff closed the ring (maintenance) or the sub-hall is closed
 */
export const RING_STATUSES = [
  "free",
  "waiting",
  "starting",
  "fighting",
  "result",
  "practice",
  "closed",
] as const;
export type RingStatus = (typeof RING_STATUSES)[number];
export const RING_RESULT_SECONDS = 8;

export interface RingFighter {
  /** hall-room session id (the avatar to dress in the kit) */
  sid: string;
  /** signed-in user id (absent for a guest practising) */
  userId?: string;
  name: string;
  corner: Corner;
  level?: number;
}

/** One ring in the hall registry (hall room → clients, full list on join, then deltas). */
export interface RingState {
  id: RingId;
  status: RingStatus;
  /** fighters by corner; a waiting ring has only `red` */
  red?: RingFighter;
  blue?: RingFighter;
  /** Stars each (0 = friendly); set while waiting / starting / fighting */
  stake?: number;
  /** live fight summary (fighting / result): for the status board and far-away rings */
  round?: number;
  rounds?: number;
  /** points so far, by corner */
  score?: Record<Corner, number>;
  /** fight room id + API match id once created (fighters join the room; spectators watch through the hall room) */
  roomId?: string;
  matchId?: string;
  /** spectators watching this ring right now */
  watchers: number;
  /** server time (ms) of the last status change */
  since: number;
}

/* ------------------------------------------------------------ the kit ------------------------------------------------------------ */

/**
 * Boxing kit override (amateur style, sporty and respectful for every body type): corner-colour vest + trunks with a
 * white waistband, gloves, boxing boots, optional headgear (hair goes under it). The player's own skin, face, body
 * and hair are kept; the override is applied by the renderer while the person is a fighter inside a ring and removed
 * when they step out. It is never encoded into the look code and never saved.
 */
export interface BoxingKit {
  corner: Corner;
  vest: string;
  trunks: string;
  trim: string;
  gloves: string;
  boots: string;
  headgear: boolean;
}
export function boxingKit(corner: Corner, headgear = true): BoxingKit {
  const c = CORNER_COLORS[corner];
  return { corner, vest: c, trunks: c, trim: "#F2F2F0", gloves: c, boots: "#1B1B1B", headgear };
}
/** which kit (if any) a hall session wears given the ring registry: only fighters, only while they hold a ring */
export function kitFor(sid: string, rings: Iterable<RingState>): BoxingKit | null {
  for (const r of rings) {
    if (r.status === "free" || r.status === "closed") continue;
    if (r.red?.sid === sid) return boxingKit("red");
    if (r.blue?.sid === sid) return boxingKit("blue");
  }
  return null;
}

/* ------------------------------------------------------------ fight input ------------------------------------------------------------ */

/** one-shot actions (a press); the guard is a held state sent with every input */
export const BOXING_ACTIONS = [
  "jab",
  "cross",
  "hook",
  "uppercut",
  "slipL",
  "slipR",
  "stepIn",
  "stepOut",
] as const;
export type BoxingAction = (typeof BOXING_ACTIONS)[number];
export const PUNCHES = ["jab", "cross", "hook", "uppercut"] as const;
export type Punch = (typeof PUNCHES)[number];
export const isPunch = (a: unknown): a is Punch => (PUNCHES as readonly unknown[]).includes(a);

/** fixed simulation tick of every fight (Hz). Rules are in ticks; game speed / settings never change it. */
export const TICK_HZ = 30;
/** fight room → fighters snapshot rate; hall room → spectators frame rate (Hz) */
export const FIGHTER_SNAPSHOT_HZ = 15;
export const SPECTATOR_FRAME_HZ = 10;
/** inputs a client may send per second (a held guard is resent only on change; extra messages are dropped) */
export const MAX_INPUTS_PER_SECOND = 20;
/** a press is buffered at most this many ticks while the fighter is busy (then dropped) */
export const INPUT_BUFFER_TICKS = 6;

/** client → fight room `in`: `seq` strictly increases per connection; `a` = a press (optional); `g` = guard held */
export const FightInputSchema = z.object({
  seq: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1),
  a: z.enum(BOXING_ACTIONS).optional(),
  g: z.boolean(),
});
export type FightInput = z.infer<typeof FightInputSchema>;

/* ------------------------------------------------------------ fight state ------------------------------------------------------------ */

export const FIGHT_PHASES = ["intro", "countdown", "round", "rest", "knockdown", "paused", "over"] as const;
export type FightPhase = (typeof FIGHT_PHASES)[number];

/** what a fighter is doing (engine-owned; the renderer maps each to a procedural pose) */
export const FIGHTER_ACTS = [
  "idle",
  ...BOXING_ACTIONS,
  "blockHit",
  "staggered",
  "down",
  "rising",
  "celebrate",
  "dejected",
] as const;
export type FighterAct = (typeof FIGHTER_ACTS)[number];

/** Punch phases in an action's life (frame data in the engine): windup → active (can land) → recovery. */
export type ActStage = "windup" | "active" | "recovery" | "none";

export interface FighterView {
  id: string;
  corner: Corner;
  /** current action + ticks since it started + its stage (presentation only; the server decided) */
  act: FighterAct;
  actT: number;
  stage: ActStage;
  guard: boolean;
  /** 0..1000 */
  stamina: number;
  /** 0..1000 — the balance / composure meter (NOT health: no injury visuals); 0 → knockdown */
  composure: number;
  points: number;
  knockdowns: number;
  warnings: number;
  connected: boolean;
}

/** fight room → fighters (`snap`, FIGHTER_SNAPSHOT_HZ) and hall room → watchers (`boxing-frame`, SPECTATOR_FRAME_HZ) */
export interface BoxingSnapshot {
  ring: RingId;
  tick: number;
  phase: FightPhase;
  round: number;
  rounds: number;
  /** ticks left in the current phase (round clock, rest, count, pause) */
  left: number;
  /** distance between the fighters (cm, integer) */
  dist: number;
  /** presentation-only orbit angle of the pair around the ring centre (deg × 10, integer; derived deterministically) */
  orbit: number;
  fighters: [FighterView, FighterView];
  /** referee count during a knockdown (1..8) */
  count?: number;
}

/* ------------------------------------------------------------ events ------------------------------------------------------------ */

export const FOULS = ["PASSIVITY", "IDLE"] as const;
export type Foul = (typeof FOULS)[number];
export const PAUSE_REASONS = ["DISCONNECT", "STAFF"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** fight room → fighters (`ev`, batched per tick) and hall room → watchers. `t` = tick. `by` / `to` = fighter index 0 (red) | 1 (blue). */
export type FightEvent =
  | { k: "bell"; t: number; round: number }
  | { k: "roundEnd"; t: number; round: number; points: [number, number] }
  | { k: "hit"; t: number; by: 0 | 1; punch: Punch; points: number; counter: boolean; combo: number }
  | { k: "block"; t: number; by: 0 | 1; punch: Punch }
  | { k: "evade"; t: number; by: 0 | 1; punch: Punch }
  | { k: "whiff"; t: number; by: 0 | 1; punch: Punch }
  | { k: "knockdown"; t: number; to: 0 | 1; points: number }
  | { k: "count"; t: number; n: number }
  | { k: "up"; t: number; to: 0 | 1 }
  | { k: "warning"; t: number; to: 0 | 1; foul: Foul; penalty: number }
  | { k: "pause"; t: number; reason: PauseReason; who?: 0 | 1 }
  | { k: "resume"; t: number }
  | { k: "stoppage"; t: number; winner: 0 | 1 }
  | { k: "over"; t: number; result: BoxingOutcome };

/** how the fight was decided (FIGHT-GAMES-PLAN §2.6) */
export const BOXING_DECISIONS = ["points", "stoppage", "draw", "forfeit", "void"] as const;
export type BoxingDecision = (typeof BOXING_DECISIONS)[number];
export interface BoxingOutcome {
  decision: BoxingDecision;
  /** fighter index of the winner; null = draw / void */
  winner: 0 | 1 | null;
  points: [number, number];
  knockdowns: [number, number];
  /** clean power punches landed (cross / hook / uppercut): the first tie-breaker after knockdowns */
  power: [number, number];
  /** points per round, by fighter */
  rounds: [number, number][];
}

/* ------------------------------------------------------------ rules (game_settings) ------------------------------------------------------------ */

/** the fight block of the boxing game_settings (games.ts GameSettings.fight); bounds enforced by the API */
export const FIGHT_RULE_BOUNDS = {
  rounds: { min: 1, max: 5 },
  roundSeconds: { min: 30, max: 180 },
  restSeconds: { min: 10, max: 60 },
  idleSeconds: { min: 10, max: 60 },
} as const;
const FB = FIGHT_RULE_BOUNDS;
const fint = (b: { min: number; max: number }) =>
  z.number().int("WHOLE_NUMBER").min(b.min, "TOO_SMALL").max(b.max, "TOO_BIG");
export const FightRulesSchema = z.object({
  rounds: fint(FB.rounds),
  roundSeconds: fint(FB.roundSeconds),
  restSeconds: fint(FB.restSeconds),
  /** a fighter with no input for this long in a round gets an IDLE strike (maxTimeouts strikes in a row → forfeit) */
  idleSeconds: fint(FB.idleSeconds),
});
export type FightRules = z.infer<typeof FightRulesSchema>;
export const DEFAULT_FIGHT_RULES: FightRules = {
  rounds: 3,
  roundSeconds: 60,
  restSeconds: 15,
  idleSeconds: 20,
};

/* ------------------------------------------------------------ realtime messages ------------------------------------------------------------ */

/** client → Boxing sub-hall room (hall room with game "boxing") */
export const BoxingHallMsg = {
  /** step into a free ring and wait for an opponent (open challenge): { ring, stake } */
  claim: "boxing-claim",
  /** take the blue corner of a waiting ring: { ring } (stake = the ring's stake) */
  join: "boxing-join",
  /** step out of the ring you hold (waiting / practice / after the result): {} */
  leave: "boxing-leave",
  /** quick fight: any opponent at this stake; the server picks a free ring: { stake } */
  quick: "boxing-quick",
  /** cancel quick fight: {} */
  quickCancel: "boxing-quick-cancel",
  /** train against the AI in a free ring: { ring } (no stake) */
  practice: "boxing-practice",
  /** watch a ring (spectator frames; at most one at a time; null stops): { ring: RingId | null } */
  watch: "boxing-watch",
  /** practice only: the local engine's summary so spectators see the score: { round, score } */
  practiceScore: "boxing-practice-score",
} as const;
/** Boxing sub-hall room → clients */
export const BoxingHallEvt = {
  /** full registry on join: RingState[] */
  rings: "boxing-rings",
  /** one ring changed: RingState */
  ring: "boxing-ring",
  /** a request was refused: { action, reason: BoxingDenial, ring? } */
  denied: "boxing-denied",
  /** you hold this ring now (walk in, kit on): { ring, corner } */
  assigned: "boxing-assigned",
  /** your fight room is ready: { ring, roomId, matchId, corner, stake, rules: FightRules } */
  fightReady: "boxing-fight-ready",
  /** spectator frame for the ring you watch: BoxingSnapshot */
  frame: "boxing-frame",
  /** events of the ring you watch: FightEvent[] */
  events: "boxing-events",
} as const;

/** client → fight room (`boxing` room); server → client names */
export const FightMsg = {
  input: "in",
  ready: "ready",
  resign: "resign",
  sync: "sync",
  ping: "ping",
} as const;
export const FightEvt = {
  snap: "snap",
  events: "ev",
  result: "result",
  rejected: "rejected",
  pong: "pong",
  pause: "pause",
} as const;

export const BoxingClaimSchema = z.object({ ring: RingIdSchema, stake: z.number().int().min(0).max(10_000) });
export const BoxingRingMsgSchema = z.object({ ring: RingIdSchema });
export const BoxingQuickSchema = z.object({ stake: z.number().int().min(0).max(10_000) });
export const BoxingWatchSchema = z.object({ ring: RingIdSchema.nullable() });

/* ------------------------------------------------------------ errors ------------------------------------------------------------ */

/**
 * Why a ring / fight request was refused (`boxing-denied`). Personal money / eligibility reasons reuse the games
 * contract (games.ts MatchRefusal: INSUFFICIENT_FUNDS, FRIENDLY_LIMIT_REACHED, ALREADY_IN_MATCH, GAME_DISABLED, …).
 */
export const BOXING_DENIALS = [
  "UNKNOWN_RING",
  "RING_TAKEN", // someone else holds it (or both corners are full)
  "RING_CLOSED",
  "NOT_IN_RING", // leave / practice score without holding a ring
  "ALREADY_IN_RING", // one ring per person
  "TOO_FAR", // must stand at the ring steps (server checks the last position)
  "SIGN_IN_REQUIRED", // live fights need an account (guests may practise)
  "OWN_RING", // can't take the blue corner of your own waiting ring
  "STAKE_MISMATCH",
  "HIGH_LATENCY", // ping too high for a live fight (see plan §3.4)
  "HALL_FULL",
  "RATE_LIMITED",
  "SUBHALL_CLOSED",
] as const;
export type BoxingDenial = (typeof BOXING_DENIALS)[number];
/** fight room `rejected` reasons for an input */
export const FIGHT_INPUT_REJECTIONS = ["BAD_INPUT", "RATE_LIMITED", "STALE_SEQ", "NOT_FIGHTING"] as const;
export type FightInputRejection = (typeof FIGHT_INPUT_REJECTIONS)[number];

/* ------------------------------------------------------------ capacity ------------------------------------------------------------ */

/** one Boxing sub-hall room instance: 50 rings × 2 fighters + spectators; a full instance opens "Boxing Hall 2" */
export const BOXING_HALL_CAPACITY = 160;
/** world-move area of interest in the Boxing sub-hall (m): moves further away are not sent */
export const BOXING_AOI_RADIUS = 24;
/** spectators per ring that get frames (feature rings: twice that) */
export const RING_WATCHERS_MAX = 30;
/** must stand within this distance of a ring's steps to claim / join it (m) */
export const RING_REACH_M = 4;
/** ping above which a live fight can't be started (ms, median of the last pings) */
export const MAX_FIGHT_PING_MS = 300;

/* ------------------------------------------------------------ motion seam (P3-FGT-02 assets) ------------------------------------------------------------ */

/**
 * Clip names of the procedural boxing motion library (apps/web/src/world/human/boxing/*, task P3-FGT-02, owned by the
 * assets agent). The renderer asks the library for the pose of a clip at a time; the engine never sees clips.
 * Orthodox stance: lead = left hand.
 */
export const BOXING_CLIPS = [
  "guard",
  "guardLow", // tired / resting guard
  "stepIn",
  "stepOut",
  "sideStepL",
  "sideStepR",
  "pivot",
  "jab",
  "cross",
  "hookL",
  "hookR",
  "uppercutL",
  "uppercutR",
  "blockHigh",
  "blockLow",
  "slipL",
  "slipR",
  "duck",
  "hitHeadLight",
  "hitHeadHeavy",
  "hitBodyLight",
  "hitBodyHeavy",
  "knockdown",
  "getUp",
  "countIdle", // the standing fighter in the neutral corner during a count
  "victory",
  "defeat",
  "stoolRest",
  "gloveTouch",
] as const;
export type BoxingClip = (typeof BOXING_CLIPS)[number];

/** engine action → clip (the default hand of each punch; the engine has one hook and one uppercut) */
export const ACT_CLIP: Record<FighterAct, BoxingClip> = {
  idle: "guard",
  jab: "jab",
  cross: "cross",
  hook: "hookL",
  uppercut: "uppercutR",
  slipL: "slipL",
  slipR: "slipR",
  stepIn: "stepIn",
  stepOut: "stepOut",
  blockHit: "blockHigh",
  staggered: "hitHeadHeavy",
  down: "knockdown",
  rising: "getUp",
  celebrate: "victory",
  dejected: "defeat",
};

/** short reaction clip on the TARGET of a clean hit (`hit` event), blended over its current clip */
export const HIT_REACTION: Record<Punch, BoxingClip> = {
  jab: "hitHeadLight",
  cross: "hitHeadHeavy",
  hook: "hitHeadHeavy",
  uppercut: "hitBodyHeavy",
};

/**
 * The clip a fighter shows, a pure function of the server view + phase (every viewer computes the same):
 * rest → stool, intro → glove touch, knockdown → `countIdle` for the standing fighter, idle → guard (guardLow when
 * tired or the guard is down). Clip time = `actT / TICK_HZ` s, time-scaled by the renderer to the action's frame data.
 */
export function clipFor(f: FighterView, phase: FightPhase): BoxingClip {
  if (phase === "rest") return "stoolRest";
  if (phase === "intro") return "gloveTouch";
  if (phase === "knockdown" && f.act !== "down" && f.act !== "rising") return "countIdle";
  if (f.act === "idle") return f.stamina < 300 || !f.guard ? "guardLow" : "guard";
  return ACT_CLIP[f.act];
}
