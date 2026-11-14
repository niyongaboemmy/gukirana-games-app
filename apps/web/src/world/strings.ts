/**
 * World (plaza) UI strings, English catalogue (i18n-ready like admin-block/strings.ts and arena/strings.ts; to move to
 * @gukirana/i18n with the rest).
 */
export const W = {
  /** door of a building that is closed for you */
  closedTitle: (place: string) => `${place} is closed`,
  closedFallback: "Please come back later.",
  closedSign: "CLOSED",
  closedAction: "Closed",
  closedPrompt: (place: string, msg: string) => `${place} is closed${msg ? ` · ${msg}` : ""}`,
  dismiss: "Close",
  enterAction: "Enter",
  enterPrompt: (place: string) => `Enter ${place}`,
  /** desktop control hints: the full line for the first minute, then the short one */
  hintFull: "W/S walk · A/D turn · click to walk · click a person for options · drag to look · Shift run · E interact · T chat · V talk",
  hintShort: "E interact · T chat · G emotes · V talk",
} as const;

/** Plaza activities (P2-WLD-09), i18n keys `plaza.activity.*` (English catalogue). */
export const PA = {
  prompt: {
    lean: "Lean here",
    coffee: "Café counter",
    water: "Drink some water",
    board: "Read the notice board",
    photo: "Photo of the volcanoes",
  },
  action: { lean: "Lean", coffee: "Order", water: "Drink", board: "Read", photo: "Photo" },
  cafeTitle: "Café counter",
  cafeNote: "On the house: drinks are free here. No Stars, nothing is charged.",
  drinks: { coffee: "Rwandan coffee", tea: "African tea (icyayi)", juice: "Passion-fruit juice" },
  drinkSub: { coffee: "Musanze highland beans", tea: "Milky, with ginger", juice: "Fresh, no sugar added" },
  boardTitle: "Notice board",
  arenaHead: "Tournament Arena",
  hallsHead: "Halls today",
  loading: "Checking the latest…",
  noEvents: "No events published yet. Check back soon.",
  scheduleOffline: "The arena schedule is not available right now.",
  arenaClosed: "The arena is closed right now.",
  arenaOpen: "The arena is open: walk in and take a seat.",
  live: "On now",
  next: "Next",
  open: "Open",
  closed: "Closed",
  comingSoon: "Coming soon",
  sourceNote: "Live from the arena schedule and the hall status set by staff.",
  photoTaken: "Photo taken: the Virunga volcanoes, Bisoke straight ahead.",
  close: "Close",
} as const;
