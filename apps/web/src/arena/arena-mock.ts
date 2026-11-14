import type { ArenaDenial, ArenaEvent, ArenaScopeRule, ArenaStatus } from "@gukirana/contracts";

/**
 * MOCK arena service — used only while the API answers 404 for /arena/* (the backend for P2-ARN-02 is being built
 * in parallel). It fakes, on this device only:
 *  - GET  /arena/status   one event ("Musanze Weekend Cup", Pool, doors open now, ends in 2 h) with the scope chosen
 *                          by `?arenaMock=` (public | members | level | invite | participants | none | closed | barred)
 *  - POST /arena/events/:id/pass   checks that scope against your session (level, signed in) and capacity
 *  - realtime arena-sit / arena-stand   confirms any valid seat after 350 ms (no other people's seats)
 * Nothing here is ever authoritative: the real server replaces all of it (arena-client switches automatically).
 */
export type MockScenario = "public" | "members" | "level" | "invite" | "participants" | "none" | "closed" | "barred";

const EVENT_ID = "00000000-0000-4000-8000-00000000a7e1";
let passFor: string | null = null;

/** QA only (dev builds, or NEXT_PUBLIC_GK_QA=1): `?arenaMock=…` forces the mock even when the API is live. */
export function mockForced(): boolean {
  if (typeof window === "undefined" || (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_GK_QA !== "1")) return false;
  try {
    return new URLSearchParams(location.search).has("arenaMock") || !!sessionStorage.getItem("gk-arena-mock");
  } catch {
    return false;
  }
}

export function mockScenario(): MockScenario {
  if (typeof window === "undefined") return "public";
  const q = new URLSearchParams(location.search).get("arenaMock");
  try {
    if (q) sessionStorage.setItem("gk-arena-mock", q);
    return ((q ?? sessionStorage.getItem("gk-arena-mock")) as MockScenario | null) ?? "public";
  } catch {
    return (q as MockScenario | null) ?? "public";
  }
}

function rulesFor(s: MockScenario): ArenaScopeRule[] {
  switch (s) {
    case "members":
      return [{ kind: "members" }];
    case "level":
      return [{ kind: "min_level", level: 5 }];
    case "invite":
      return [{ kind: "invite" }];
    case "participants":
      return [{ kind: "participants", guests: 1 }];
    default:
      return [{ kind: "public" }];
  }
}

function mockEvent(s: MockScenario, offsetH = 0): ArenaEvent {
  // whole hours on this device's clock: stable across reloads within the hour (no randomness)
  const h0 = Math.floor(Date.now() / 3_600_000) * 3_600_000 + offsetH * 3_600_000;
  return {
    id: EVENT_ID,
    title: offsetH ? "Igisoro Masters" : "Musanze Weekend Cup",
    kind: offsetH ? "final" : "tournament",
    game: offsetH ? "igisoro" : "pool",
    status: offsetH ? "scheduled" : "doors_open",
    doorsOpenAt: new Date(h0 - 1_800_000).toISOString(),
    startsAt: new Date(h0 + 1_800_000).toISOString(),
    endsAt: new Date(h0 + 7_200_000).toISOString(),
    rules: rulesFor(s),
    capacity: 900,
    vipCapacity: 24,
    passesIssued: 312 + (passFor ? 1 : 0),
    description: offsetH ? "" : "Sixteen players, single knockout. The final is played on the feature table.",
  };
}

function scopeDenial(rules: ArenaScopeRule[], me: { signedIn: boolean; level: number }): ArenaDenial | null {
  for (const r of rules) {
    if (r.kind === "members" && !me.signedIn) return "LOGIN_REQUIRED";
    if (r.kind === "min_level") {
      if (!me.signedIn) return "LOGIN_REQUIRED";
      if (me.level < r.level) return "LEVEL_TOO_LOW";
    }
    if (r.kind === "invite") return "NOT_INVITED";
    if (r.kind === "participants") return "NOT_PARTICIPANT";
    if (r.kind === "role") return "ROLE_REQUIRED";
    if (r.kind === "age_verified") return "AGE_CHECK_REQUIRED";
  }
  return null;
}

export function mockStatus(me: { signedIn: boolean; level: number }): ArenaStatus {
  const s = mockScenario();
  const closed = s === "closed";
  const barred = s === "barred";
  const running = s !== "none" && !closed && !barred;
  const current = running ? mockEvent(s) : null;
  const denial = current ? (current.passesIssued >= current.capacity ? "SOLD_OUT" : scopeDenial(current.rules, me)) : null;
  return {
    open: !closed,
    canEnter: !closed && !barred,
    denial: closed ? "ARENA_CLOSED" : barred ? "BARRED" : null,
    current,
    next: mockEvent("public", running ? 26 : 2),
    pass: current && passFor === current.id ? { eventId: current.id, zone: "seats", seat: null } : null,
    canClaim: !!current && passFor !== current.id && !denial,
    claimDenial: current && passFor !== current.id ? denial : null,
    occupancy: { concourse: 41, seats: 312 },
  };
}

export function mockClaim(eventId: string, me: { signedIn: boolean; level: number }): { pass: NonNullable<ArenaStatus["pass"]> } | { denial: ArenaDenial } {
  const st = mockStatus(me);
  if (!st.current || st.current.id !== eventId) return { denial: "EVENT_NOT_OPEN" };
  if (st.pass) return { pass: st.pass };
  if (st.claimDenial) return { denial: st.claimDenial };
  passFor = eventId;
  return { pass: { eventId, zone: "seats", seat: null } };
}
