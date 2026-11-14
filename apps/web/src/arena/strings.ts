import type { ArenaDenial, ArenaEvent, ArenaScopeRule } from "@gukirana/contracts";

/** Tournament Arena UI strings (to move to @gukirana/i18n keys `arena.*`). Plain words, no jargon. */
export const A = {
  title: "Tournament Arena",
  leave: "Leave",
  leaving: "Leaving…",
  people: (n: number) => `${n} here`,
  welcome: "You're in the Tournament Arena",
  welcomeSub: "Walk through the entry portal to the bowl · the exit is behind you",
  closedTitle: "The arena is closed",
  barredTitle: "You can't enter the arena",
  nextEvent: "Next event",
  noEvent: "No event planned yet",
  ok: "OK",
  close: "Close",
  event: "Event",
  eventCard: "Today in the arena",
  freeSeating: "No event right now: sit anywhere you like.",
  getPass: "Get a pass",
  gettingPass: "Getting your pass…",
  havePass: "You have a pass",
  passZone: (z: "seats" | "vip" | "floor") => (z === "vip" ? "VIP box pass" : z === "floor" ? "Player pass: the floor is open to you" : "Bowl seat pass"),
  findSeat: "Find a seat",
  seatFinder: "Find a seat",
  tierLower: "Lower bowl",
  tierUpper: "Upper tier",
  tierVip: "VIP boxes",
  bestFree: "Go to the best free seat",
  goTo: (id: string) => `Walk to seat ${id}`,
  takeSeat: (id: string) => `Take seat ${id}`,
  walkingTo: (id: string) => `Walking to seat ${id}…`,
  pending: (id: string) => `Asking for seat ${id}…`,
  seated: (id: string) => `Seat ${id}`,
  standUp: "Stand up",
  cancel: "Cancel",
  sectionFull: "Every seat in this section is taken.",
  leavePrompt: "Leave to the plaza",
  floorOnly: "Players only",
  removed: { ARENA_CLOSED: "The arena has closed. You were walked out to the plaza.", BARRED: "You were asked to leave the arena." } as Record<string, string>,
  noAnswer: "The arena did not answer. Try again in a moment.",
  mock: "Preview mode: the arena service is not live yet.",
  status: {
    draft: "Being planned",
    scheduled: "Scheduled",
    doors_open: "Doors open",
    live: "Live now",
    ended: "Ended",
    cancelled: "Cancelled",
  } as Record<ArenaEvent["status"], string>,
  kind: {
    tournament: "Tournament",
    final: "Final",
    exhibition: "Exhibition",
    watch_party: "Watch party",
    ceremony: "Ceremony",
  } as Record<ArenaEvent["kind"], string>,
  game: { pool: "Pool", ludo: "Ludo", igisoro: "Igisoro" } as Record<string, string>,
};

/** Why someone may not go further, in plain words. */
export const DENIAL: Record<ArenaDenial, string> = {
  ARENA_CLOSED: "The arena is closed right now.",
  BARRED: "You are not allowed in the arena at the moment.",
  LOGIN_REQUIRED: "Sign in at the gate to get a pass for this event.",
  LEVEL_TOO_LOW: "This event is for higher-level players. Keep playing to level up.",
  NOT_INVITED: "This event is for invited guests only.",
  NOT_PARTICIPANT: "This event is for its players and their guests only.",
  ROLE_REQUIRED: "This event is for staff and invited press only.",
  AGE_CHECK_REQUIRED: "This event needs an age check first.",
  SOLD_OUT: "All passes for this event are taken.",
  NO_PASS: "You need a pass for this event to sit in the bowl.",
  EVENT_NOT_OPEN: "The doors for this event are not open yet.",
  SEAT_TAKEN: "Someone just took that seat. Try another one.",
  RATE_LIMITED: "Slow down a little and try again.",
};
export const denialText = (d: string | null | undefined) => (d && d in DENIAL ? DENIAL[d as ArenaDenial] : "That is not possible right now.");

/** The event's scope (who may attend) in plain words. */
export function scopeWords(rules: ArenaScopeRule[]): string {
  const parts = rules.map((r) => {
    switch (r.kind) {
      case "public":
        return "Open to everyone";
      case "members":
        return "Signed-in players";
      case "min_level":
        return `Signed-in players level ${r.level}+`;
      case "invite":
        return "Invited guests only";
      case "participants":
        return r.guests > 0 ? "Players and their guests" : "Registered players only";
      case "role":
        return "Staff and press only";
      case "age_verified":
        return "Age-checked players only";
    }
  });
  return [...new Set(parts)].join(" · ");
}

export function whenWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
