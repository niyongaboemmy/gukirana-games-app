import {
  ARENA_TRANSITIONS,
  type ArenaDenial,
  type ArenaEventStatus,
  type ArenaScopeRule,
} from "@gukirana/contracts";

/** Pure arena rules (P2-ARN-02, docs/ARENA-REQUIREMENTS.md §2): scope evaluation, transitions, time moves, overlap. */

/** What is known about the viewer when evaluating an event scope. `userId: null` = guest. */
export interface Viewer {
  userId: string | null;
  level: number;
  roles: string[];
  ageVerified: boolean;
  invited: boolean;
  participant: boolean;
}

/** Fixed order of denials: the first failing rule (in this order) is reported. */
const ORDER: ArenaDenial[] = [
  "LOGIN_REQUIRED",
  "LEVEL_TOO_LOW",
  "NOT_INVITED",
  "NOT_PARTICIPANT",
  "ROLE_REQUIRED",
  "AGE_CHECK_REQUIRED",
];

function check(rule: ArenaScopeRule, v: Viewer): ArenaDenial | null {
  if (rule.kind === "public") return null;
  if (!v.userId) return "LOGIN_REQUIRED"; // every other rule needs an account
  switch (rule.kind) {
    case "members":
      return null;
    case "min_level":
      return v.level >= rule.level ? null : "LEVEL_TOO_LOW";
    case "invite":
      return v.invited ? null : "NOT_INVITED";
    case "participants":
      return v.participant || (rule.guests > 0 && v.invited) ? null : "NOT_PARTICIPANT";
    case "role":
      return rule.roles.some((r) => v.roles.includes(r)) ? null : "ROLE_REQUIRED";
    case "age_verified":
      return v.ageVerified ? null : "AGE_CHECK_REQUIRED";
  }
}

/** All rules must pass (AND). Returns null when admitted, otherwise the first denial in ORDER. */
export function evaluateScope(rules: ArenaScopeRule[], v: Viewer): ArenaDenial | null {
  const fails = new Set(rules.map((r) => check(r, v)).filter((d): d is ArenaDenial => d !== null));
  return ORDER.find((d) => fails.has(d)) ?? null;
}

/** Only `public` rules: open seating, no pass needed. */
export const isOpenSeating = (rules: ArenaScopeRule[]) => rules.length > 0 && rules.every((r) => r.kind === "public");

export const canTransition = (from: ArenaEventStatus, to: ArenaEventStatus) => ARENA_TRANSITIONS[from].includes(to);

export const isTerminal = (s: ArenaEventStatus) => s === "ended" || s === "cancelled";
/** statuses that take part in overlap checks and hold passes */
export const isActive = (s: ArenaEventStatus) => s === "scheduled" || s === "doors_open" || s === "live";

export interface Times {
  doorsOpenAt: Date;
  startsAt: Date;
  endsAt: Date;
}

/** Where time takes a non-draft event: scheduled → doors_open → live → ended. Drafts and terminal states stay. */
export function timeStatus(status: ArenaEventStatus, t: Times, now: Date): ArenaEventStatus {
  if (!isActive(status)) return status;
  const n = now.getTime();
  if (n >= t.endsAt.getTime()) return "ended";
  if (n >= t.startsAt.getTime()) return status === "scheduled" || status === "doors_open" ? "live" : status;
  if (n >= t.doorsOpenAt.getTime()) return status === "scheduled" ? "doors_open" : status;
  return status;
}

const DAY = 24 * 3600_000;
/** null when valid, otherwise a code */
export function validateTimes(t: Times): string | null {
  if (t.doorsOpenAt.getTime() > t.startsAt.getTime()) return "DOORS_AFTER_START";
  if (t.startsAt.getTime() >= t.endsAt.getTime()) return "END_BEFORE_START";
  if (t.endsAt.getTime() - t.doorsOpenAt.getTime() > DAY) return "EVENT_TOO_LONG";
  return null;
}

/** half-open [doorsOpenAt, endsAt) windows overlap */
export const overlaps = (a: Times, b: Times) =>
  a.doorsOpenAt.getTime() < b.endsAt.getTime() && b.doorsOpenAt.getTime() < a.endsAt.getTime();
