/** Administrative Block UI strings (to move to @gukirana/i18n keys `adminBlock.*`). Plain, polite, professional. */
export const S = {
  title: "Administrative Block",
  subtitle: "Reception · four offices",
  leave: "Leave",
  leaving: "Leaving…",
  welcome: "Welcome to the Administrative Block",
  welcomeSub: "Choose the office you are visiting. Staff walk straight in; visitors knock.",
  directory: "Office directory",
  directoryBoard: "OFFICE DIRECTORY",
  offices: "Offices",
  choose: "Choose an office",
  goTo: "Go to office",
  going: "Walking there…",
  close: "Close",
  open: "Offices",
  youCanEnter: "You can enter",
  visitorsKnock: "Visitors knock",
  vacant: "Vacant",
  staffInside: (n: number) => (n === 1 ? "Staff inside" : `${n} staff inside`),
  busy: "In a meeting",
  enter: (name: string) => `Enter ${name}`,
  knock: "Knock",
  knockOn: (name: string) => `Knock on ${name}`,
  knocking: "Knocking…",
  waiting: "Waiting for an answer",
  knockingSub: (s: number) => `${s}s`,
  cancel: "Stop waiting",
  opening: "Opening the door…",
  refused: {
    DECLINED: "They can't see you right now. Please try again later.",
    EXPIRED: "No answer. Please try again in a moment.",
    NOBODY_INSIDE: "Nobody is in this office right now.",
    NOT_ALLOWED: "This office is for staff only.",
    LOGIN_REQUIRED: "Sign in at the gate to visit an office.",
    RATE_LIMITED: "Please wait a moment before knocking again.",
  } as Record<string, string>,
  refusedTitle: {
    DECLINED: "Declined",
    EXPIRED: "No answer",
    NOBODY_INSIDE: "Nobody inside",
    NOT_ALLOWED: "Staff only",
    LOGIN_REQUIRED: "Sign in first",
    RATE_LIMITED: "One moment",
  } as Record<string, string>,
  isKnocking: (name: string) => `${name} is knocking`,
  atYourDoor: (office: string) => `at the ${office} door`,
  letIn: "Let in",
  decline: "Decline",
  inOffice: (name: string) => `You are in the ${name}`,
  leaveOffice: "Step out",
  offline: "Directory from the building plan (live status unavailable)",
  reception: "RECEPTION",
  officesSign: "OFFICES",
  exitSign: "EXIT · PLAZA",
} as const;

/** the status of an office door, from the number of staff inside */
export type DoorStatus = "vacant" | "staff" | "busy";
export const doorStatus = (occupants: number): DoorStatus => (occupants <= 0 ? "vacant" : occupants === 1 ? "staff" : "busy");
export const statusLabel = (occupants: number) => {
  const s = doorStatus(occupants);
  return s === "vacant" ? S.vacant : s === "staff" ? S.staffInside(occupants) : S.busy;
};
/** lamp / dot colours: vacant = neutral grey, staff inside = green, in a meeting = amber */
export const STATUS_HEX: Record<DoorStatus, string> = { vacant: "#8a9099", staff: "#22c55e", busy: "#f59e0b" };
