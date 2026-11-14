import { SEED_OFFICES } from "@gukirana/contracts";

/**
 * Administrative Block floor plan (P2-ADM-02): pure data, shared by the interior (rooms/AdminBlock.tsx), the hall
 * layout (rooms/layouts.ts HALLS.admin: walls + furniture colliders), the door / route logic (admin-block/doors.ts)
 * and the tests. Metres, hall frame: x ∈ [−18, 18], z ∈ [−14, 14], the entrance door on the south wall (+z).
 *
 *   z −14  ┌──────────┬──────────┬──────────┬──────────┐  north glazing (the view to the Virungas)
 *          │  SUPER   │    IT    │ ACCOUNT- │ CUSTOMER │  four closed offices, 9 × 12.4 m each
 *          │  ADMIN   │  OFFICE  │   ANT    │ SUPPORT  │
 *   z −1.6 └────╫─────┴────╫─────┴────╫─────┴────╫─────┘  office fronts: solid doors, frosted side lights,
 *               ║  corridor (4.2 m, carpet runner)  ║         nameplates and status lamps
 *   z  2.6 ━━━━━━━━━━━━━━━┓   opening   ┏━━━━━━━━━━━━━━━  lobby screen wall (Imigongo art, directory board)
 *          reception desk ┃             ┃ directory board
 *          + receptionist      LOBBY          waiting lounge (sofa, armchairs)
 *   z  14 ━━━━━━━━━━━━━━━━━━━━  door  ━━━━━━━━━━━━━━━━━━━  entrance (auto door to the plaza)
 */
export const ADMIN_SIZE = { w: 36, d: 28, h: 3.8 } as const;
export const ADMIN_COLOR = "#C9A96B";
export const WALL_T = 0.16;
/** office front wall (the doors) and the corridor / lobby screen wall */
export const FRONT_Z = -1.6;
export const SCREEN_Z = 2.6;
/** the open passage from the lobby into the corridor */
export const OPENING = { x0: -3.2, x1: 3.2 } as const;
/** office door: clear opening width, leaf height */
export const DOOR_W = 1.2;
export const DOOR_H = 2.25;
/** frosted side light beside each door (east of the leaf) */
export const SIDELIGHT = { x0: DOOR_W / 2 + 0.1, x1: DOOR_W / 2 + 0.62 } as const;

export type OfficeTheme = "executive" | "it" | "finance" | "support";
export interface OfficePlan {
  id: string;
  name: string;
  theme: OfficeTheme;
  accent: string;
  plate: string;
  x0: number;
  x1: number;
  cx: number;
}

/** theme, accent colour and the nameplate's second line (3D signage, to move to @gukirana/i18n with the rest) */
const THEMES: Record<string, { theme: OfficeTheme; accent: string; plate: string }> = {
  "super-admin": { theme: "executive", accent: "#C9A96B", plate: "Compound management" },
  "it-office": { theme: "it", accent: "#5B9BD5", plate: "Systems and accounts" },
  accountant: { theme: "finance", accent: "#5FAE8B", plate: "Ledger and payouts" },
  "customer-support": { theme: "support", accent: "#D98C5F", plate: "Player help desk" },
};

/** The four seeded offices, west → east along the corridor. */
export const OFFICE_PLANS: OfficePlan[] = SEED_OFFICES.map((o, i) => {
  const x0 = -ADMIN_SIZE.w / 2 + i * 9;
  return { id: o.id, name: o.name, ...THEMES[o.id]!, x0, x1: x0 + 9, cx: x0 + 4.5 };
});
export const officePlan = (id: string) => OFFICE_PLANS.find((o) => o.id === id);

export interface P {
  x: number;
  z: number;
}
export interface WallRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** where you stand to knock (corridor side) and where you are once in (office side) */
export const doorFront = (o: OfficePlan): P => ({ x: o.cx, z: FRONT_Z + 0.95 });
export const doorInside = (o: OfficePlan): P => ({ x: o.cx, z: FRONT_Z - 1.3 });
/** the door leaf while closed (a collider for anyone not admitted) */
export const doorRect = (o: OfficePlan): WallRect => ({ x: o.cx, z: FRONT_Z, w: DOOR_W, d: WALL_T + 0.04 });

const seg = (x0: number, x1: number, z: number): WallRect => ({ x: (x0 + x1) / 2, z, w: x1 - x0, d: WALL_T });

/** Full-height interior walls (block walking AND the follow camera). The door gaps are left open (doorRect). */
export const ADMIN_WALLS: WallRect[] = (() => {
  const { w, d } = ADMIN_SIZE;
  const out: WallRect[] = [];
  for (const o of OFFICE_PLANS) {
    out.push(seg(o.x0, o.cx - DOOR_W / 2, FRONT_Z), seg(o.cx + DOOR_W / 2, o.x1, FRONT_Z));
  }
  // party walls between the offices
  for (const x of [-9, 0, 9]) out.push({ x, z: (-d / 2 + FRONT_Z) / 2, w: WALL_T, d: FRONT_Z + d / 2 });
  // lobby screen with the central opening
  out.push(seg(-w / 2, OPENING.x0, SCREEN_Z), seg(OPENING.x1, w / 2, SCREEN_Z));
  return out;
})();

export type Zone = { kind: "lobby" } | { kind: "corridor" } | { kind: "office"; office: OfficePlan };
export function zoneOf(x: number, z: number): Zone {
  if (z > SCREEN_Z) return { kind: "lobby" };
  if (z >= FRONT_Z) return { kind: "corridor" };
  const office = OFFICE_PLANS.find((o) => x >= o.x0 && x < o.x1) ?? (x < 0 ? OFFICE_PLANS[0]! : OFFICE_PLANS[OFFICE_PLANS.length - 1]!);
  return { kind: "office", office };
}
export const officeAt = (x: number, z: number): OfficePlan | null => {
  const zn = zoneOf(x, z);
  return zn.kind === "office" ? zn.office : null;
};

const clampX = (x: number) => Math.max(OPENING.x0 + 1.0, Math.min(OPENING.x1 - 1.0, x));

/**
 * Walking route between two points of the block: through the office door, along the corridor, through the lobby
 * opening (each leg is a straight, furniture-free line). The last point is the destination.
 */
export function routeBetween(from: P, to: P): P[] {
  const a = zoneOf(from.x, from.z);
  const b = zoneOf(to.x, to.z);
  const out: P[] = [];
  const same = a.kind === b.kind && (a.kind !== "office" || (b.kind === "office" && a.office.id === b.office.id));
  if (!same) {
    // leave the start zone
    if (a.kind === "office") out.push(doorInside(a.office), doorFront(a.office));
    if (a.kind === "lobby") {
      const x = clampX(b.kind === "office" ? b.office.cx : to.x);
      out.push({ x, z: SCREEN_Z + 1.0 }, { x, z: SCREEN_Z - 0.9 });
    }
    // enter the destination zone
    if (b.kind === "lobby") {
      const x = clampX(to.x);
      if (a.kind !== "lobby") out.push({ x, z: SCREEN_Z - 0.9 }, { x, z: SCREEN_Z + 1.0 });
    }
    if (b.kind === "office") out.push(doorFront(b.office), doorInside(b.office));
  }
  out.push(to);
  // drop points we are already standing on
  while (out.length > 1 && Math.hypot(out[0]!.x - from.x, out[0]!.z - from.z) < 0.35) out.shift();
  return out;
}
export const routeLength = (from: P, route: P[]) => {
  let len = 0;
  let at = from;
  for (const p of route) {
    len += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return len;
};

/** the entrance door (inside face) and the point just outside it (the Leave route ends there) */
export const ENTRANCE: P = { x: 0, z: ADMIN_SIZE.d / 2 };
export const EXIT_POINT: P = { x: 0, z: ADMIN_SIZE.d / 2 + 1.2 };

/* ---------------- furniture (shared by the scene and the colliders) ---------------- */

/** reception counter (lobby, west of the entry axis); the receptionist sits behind it (north), facing the door */
export const RECEPTION = { x: -7.5, z: 7.4, w: 4.4, d: 0.85, h: 1.08 } as const;
export const RECEPTIONIST = { x: -7.5, z: 6.55 } as const;
/** directory board on the lobby face of the screen wall, east of the opening */
export const DIRECTORY = { x: 7.3, w: 3.6, y: 1.9, h: 2.1 } as const;
/** waiting lounge (east lobby): sofa on the wall, two armchairs, coffee table */
export const LOUNGE = {
  sofa: { x: 17.0, z: 8.6, w: 1.0, d: 2.4 },
  chairs: [
    { x: 14.4, z: 7.2 },
    { x: 14.4, z: 10.0 },
  ],
  table: { x: 15.6, z: 8.6, w: 0.7, d: 1.2 },
} as const;
/** upholstered waiting benches along the screen wall (facing the door) */
export const BENCHES = [
  { x: -13.6, z: 3.1, w: 3.2, d: 0.62 },
  { x: 12.6, z: 3.1, w: 3.2, d: 0.62 },
] as const;
export const LOBBY_PLANTERS: [number, number][] = [
  [-17.3, 13.3],
  [17.3, 13.3],
  [-17.3, 3.35],
  [17.3, 3.35],
  [-3.85, 3.35],
  [3.85, 3.35],
  [-4.2, 13.3],
  [4.2, 13.3],
];

export interface OfficeFurniture {
  desks: (WallRect & { h: number })[];
  chairs: P[];
  visitors: P[];
  /** units against a side wall: shelving, server racks, filing cabinets, credenza */
  units: (WallRect & { h: number; kind: "shelf" | "rack" | "files" | "credenza" })[];
  meeting: P;
  plant: P;
}
export const MEETING_R = 0.55;
export const MEETING_CHAIR_R = 0.98;
export const DESK_Z = -10.3;

export function officeFurniture(o: OfficePlan): OfficeFurniture {
  const cx = o.cx;
  const desks: OfficeFurniture["desks"] =
    o.theme === "support"
      ? [-2.6, 0, 2.6].map((dx) => ({ x: cx + dx, z: DESK_Z, w: 1.6, d: 0.8, h: 0.74 }))
      : [{ x: cx, z: DESK_Z, w: o.theme === "executive" ? 2.4 : 2.0, d: o.theme === "executive" ? 1.0 : 0.9, h: 0.75 }];
  const chairs = desks.map((d) => ({ x: d.x, z: DESK_Z - 0.9 }));
  const visitors = o.theme === "support" ? [] : [-0.65, 0.65].map((dx) => ({ x: cx + dx, z: DESK_Z + 1.15 }));
  const units: OfficeFurniture["units"] = [{ x: o.x1 - 0.3, z: -9.75, w: 0.42, d: 5.0, h: 2.1, kind: "shelf" }];
  if (o.theme === "it") units.push({ x: o.x0 + 0.62, z: -11.7, w: 1.0, d: 1.9, h: 2.0, kind: "rack" });
  if (o.theme === "finance") units.push({ x: o.x0 + 0.38, z: -10.2, w: 0.6, d: 3.6, h: 1.32, kind: "files" });
  if (o.theme === "executive" || o.theme === "support") units.push({ x: o.x0 + 0.3, z: -9.6, w: 0.45, d: 3.0, h: 0.75, kind: "credenza" });
  return { desks, chairs, visitors, units, meeting: { x: cx - 2.4, z: -4.6 }, plant: { x: o.x1 - 0.65, z: FRONT_Z - 0.75 } };
}

/** Axis-aligned furniture footprints for the controller (rooms/layouts.ts HALLS.admin.colliders). */
export const ADMIN_COLLIDERS: WallRect[] = [
  { x: RECEPTION.x, z: RECEPTION.z, w: RECEPTION.w, d: RECEPTION.d },
  { x: RECEPTION.x - RECEPTION.w / 2 + 0.3, z: RECEPTION.z - 0.85, w: 0.6, d: 0.9 }, // counter return
  { x: RECEPTIONIST.x, z: RECEPTIONIST.z - 0.1, w: 0.6, d: 0.6 },
  LOUNGE.sofa,
  LOUNGE.table,
  ...LOUNGE.chairs.map((c) => ({ x: c.x, z: c.z, w: 0.9, d: 0.9 })),
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })),
  ...LOBBY_PLANTERS.map(([x, z]) => ({ x, z, w: 0.8, d: 0.8 })),
  ...OFFICE_PLANS.flatMap((o) => {
    const f = officeFurniture(o);
    return [
      ...f.desks.map(({ x, z, w, d }) => ({ x, z, w, d })),
      ...f.chairs.map((c) => ({ x: c.x, z: c.z, w: 0.6, d: 0.6 })),
      ...f.visitors.map((c) => ({ x: c.x, z: c.z, w: 0.55, d: 0.55 })),
      ...f.units.map(({ x, z, w, d }) => ({ x, z, w, d })),
      { x: f.meeting.x, z: f.meeting.z, w: 2.5, d: 2.5 },
      { x: f.plant.x, z: f.plant.z, w: 0.7, d: 0.7 },
    ];
  }),
];
