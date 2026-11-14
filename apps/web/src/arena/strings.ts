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
  eyeView: "Eye view",
  behindView: "Behind",
  focusStage: "Focus on stage",
  focusOn: "Focused",
  viewHint: "Drag to look around · pinch, scroll or + / − to zoom · the crowd stays soft while you watch",
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
  PASS_LIMIT: "You already hold the most passes allowed. Give one back to get another.",
  ROOM_FULL: "The arena is full right now. Please try again in a moment.",
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

/** P2-ARN-04: venue interactions (to move to @gukirana/i18n keys `arena.venue.*`). */
export const V = {
  prompt: {
    kiosk: "Tickets & info",
    board: "Today in the arena",
    snack: "Snacks counter",
    drink: "Drinks counter",
    restroom: "Use the restroom",
    photo: "Take a photo here",
    desk: "Commentator desk",
    tunnel: "Players' tunnel",
    gantry: "Climb to the media gantry",
    totem: "Where am I?",
  },
  kioskTitle: "Tickets & info",
  yourSeat: "Your seat",
  noSeatYet: "No seat yet",
  goToMySeat: "Go to my seat",
  returnPass: "Give the pass back",
  boardTitle: "Today in the arena",
  startsIn: (t: string) => `Starts in ${t}`,
  inside: (n: number) => `${n.toLocaleString()} ${n === 1 ? "person" : "people"} inside`,
  seatedCount: (n: number) => `${n.toLocaleString()} in seats`,
  youAreHere: "You are here",
  map: "Arena map",
  exits: "Exit: the entry portal (south), through the lobby to the plaza",
  announcements: "Latest announcement",
  noAnnouncements: "Nothing announced yet",
  matchState: "Feature table",
  noMatch: "No match on the stage right now",
  counterTitle: { snack: "Snacks counter", drink: "Drinks counter" } as Record<"snack" | "drink", string>,
  counterNote: "Free, just for fun: nothing is charged and no Stars are used.",
  menu: {
    drink: ["Coffee", "African tea", "Passion juice", "Water"],
    snack: ["Brochette", "Samosa", "Popcorn", "Roasted maize"],
  } as Record<"snack" | "drink", string[]>,
  enjoying: (item: string) => `Enjoying your ${item.toLowerCase()}`,
  restroomBusy: "Back in a moment…",
  photoTitle: "Photo spot",
  photoHint: "The bowl is behind you. Strike a pose, then take your screenshot.",
  hideHud: "Hide controls",
  showHud: "Show controls",
  done: "Done",
  deskTitle: "Commentator desk",
  onAir: "ON AIR",
  goOnAir: "Take the mic",
  goOffAir: "Leave the mic",
  someoneOnAir: "A commentator is on air",
  deskNote: "While you are on air, people in the arena hear you without distance falloff (up to 8 direct connections until the broadcast audio service is connected).",
  tunnelTitle: "Players' tunnel",
  tunnelNo: "The tunnel and the competition floor are for this event's players and staff only.",
  tunnelYes: "You're a player in this event (or staff). Walk out to the stage.",
  walkOut: "Walk out to the stage",
  cheer: "Cheer",
  clap: "Clap",
  wave: "Wave",
  standCheer: "Stand & cheer",
  sitBack: "Sit back down",
  vipVoice: (box: string) => `VIP box ${box} · private voice`,
} as const;
