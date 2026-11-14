/**
 * Seated activities (P2-HAL-10): what a person does while sitting at a hall table, besides sitting.
 *
 * - board   (Ludo armchair): leans in over the board, forearms on the table edge, now and then reaches out to move a
 *           counter, sometimes sits back for a moment;
 * - sow     (Igisoro stool): leans over the low board, the right hand sows seeds pit by pit along the row (a dip at
 *           every pit), then rests the hands by the board;
 * - type    (officer's desk, the receptionist): types at the keyboard, pauses to read, takes notes now and then;
 * - visit   (visitor chair facing the officer): sits upright, hands in the lap, nods in conversation;
 * - meet    (meeting table): forearms on the table, nods;
 * - watch   (pool lounge chairs, arena seats): eyes on the table / the stage, leaning in when it gets interesting.
 *
 * The schedule is a pure function of the person's seed and the wall clock (no Math.random, no network traffic):
 * every client computes the same beat for the same person at the same moment, so others see you do exactly what
 * you see yourself do. Each beat fades in and out inside its period, so the pose is continuous over time. Cosmetic
 * only; never game or money logic.
 */

export type SeatedActivityKind = "board" | "sow" | "type" | "visit" | "meet" | "watch";

export interface SeatActivity {
  kind: SeatedActivityKind;
  /** table / desk / board surface height above the floor (m) */
  deskH: number;
  /** distance from the seated origin to the near edge of the table, along the facing (m) */
  reach: number;
  /** world point the person looks at by default (the board, the screen, the stage); null = straight ahead */
  focus: { x: number; y: number; z: number } | null;
}

export interface ActivityPose {
  /** the body slides forward on the seat (m): onto the front of a low stool to reach the board */
  slide: number;
  /** forward torso lean (rad) */
  lean: number;
  /** extra head pitch down (rad), on top of the lean */
  headDown: number;
  /** 0…1 forearms / hands resting on the table edge */
  hands: number;
  /** 0…1 hands at the keyboard, typing */
  type: number;
  /** 0…1 right hand writing notes */
  write: number;
  /** 0…1 right hand reaching out over the board (move a counter / sow seeds) */
  move: number;
  /** lateral position of the reaching hand (m, avatar frame: + = the person's left) */
  moveX: number;
  /** 0…1 the reaching hand dips onto the board (a counter, a pit) */
  dip: number;
  /** nod (rad, signed, already oscillating) */
  nod: number;
  /** seconds into the current beat (finger tapping, writing strokes) */
  t: number;
}

export const emptyPose = (): ActivityPose => ({ slide: 0, lean: 0, headDown: 0, hands: 0, type: 0, write: 0, move: 0, moveX: 0, dip: 0, nod: 0, t: 0 });

/** Beat period per activity (s): every person repeats their own pattern with a fresh variation each period. */
export const PERIOD: Record<SeatedActivityKind, number> = { board: 11, sow: 9.5, type: 15, visit: 8, meet: 10, watch: 14 };

const ss = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 0 → 1 over [a, a + r], 1 → 0 over [b − r, b]; 0 outside [a, b] */
export const win = (t: number, a: number, b: number, r = 0.5) => Math.min(ss((t - a) / r), ss((b - t) / r));

/** Stable 0…1 variation for (seed, period index) — integer hash, cosmetic only. */
export function vary(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 0x632be5ab, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Two nods over [a, a + 1.4 s]: the head dips and comes back up twice (≈ 0.11 rad). */
const nods = (t: number, a: number, amp = 0.11) => (t > a && t < a + 1.4 ? Math.sin(((t - a) / 1.4) * Math.PI * 4 - Math.PI / 2) * 0.5 + 0.5 : 0) * amp * win(t, a, a + 1.4, 0.2);

/**
 * The activity pose of a person (`seed`) at wall-clock time `nowMs`. Writes into `out` (no allocation per frame).
 * `attend` (0…1) = someone needs their attention (a visitor at the reception counter): tasks pause, the person sits up.
 */
export function activityPose(kind: SeatedActivityKind, seed: number, nowMs: number, out: ActivityPose, attend = 0): ActivityPose {
  const P = PERIOD[kind];
  // per-person offset so neighbours are never in step
  const T = nowMs / 1000 + (seed % 9973) * 0.37;
  const n = Math.floor(T / P);
  const t = T - n * P;
  const r = vary(seed, n);
  const o = out;
  o.slide = o.lean = o.headDown = o.hands = o.type = o.write = o.move = o.moveX = o.dip = o.nod = 0;
  o.t = t;
  switch (kind) {
    case "board": {
      // sit back for a few seconds in about a third of the periods
      const back = r < 0.35 ? win(t, 6.2, 10.2, 0.8) : 0;
      o.lean = 0.17 * (1 - back) + 0.02 * back;
      o.headDown = 0.2 * (1 - back * 0.6);
      o.hands = 1 - back;
      if (r >= 0.2) {
        // reach out and move a counter
        o.move = win(t, 2.4, 4.4, 0.55) * (1 - back);
        o.moveX = (vary(seed, n + 7) * 2 - 1) * 0.16;
        o.dip = win(t, 3.0, 3.85, 0.25);
        o.lean += 0.07 * o.move;
      }
      break;
    }
    case "sow": {
      // low stool, low board: well forward over it (Igisoro players sit on the front of the stool, bent over the pits)
      o.slide = 0.07;
      o.lean = 0.4;
      o.headDown = 0.14;
      o.hands = 1;
      // sow along the row: from the left end to the right end of the near row, a dip at every pit
      const a = 1.4;
      const b = 6.2;
      o.move = win(t, a, b, 0.6);
      const k = Math.min(1, Math.max(0, (t - a - 0.4) / (b - a - 0.8)));
      const dir = r < 0.5 ? 1 : -1;
      o.moveX = dir * (0.3 - 0.6 * k);
      o.dip = o.move * Math.abs(Math.sin(k * Math.PI * 7));
      o.lean += 0.08 * o.move;
      break;
    }
    case "type": {
      o.hands = 1;
      o.type = win(t, 0.4, 8.8, 0.6);
      // pause to read (sit up a little), then notes in about half of the periods, else more typing
      const notes = r < 0.5;
      o.write = notes ? win(t, 10.4, 14.4, 0.6) : 0;
      if (!notes) o.type = Math.max(o.type, win(t, 10.6, 14.4, 0.6));
      o.lean = 0.12 * o.type + 0.15 * o.write;
      o.headDown = 0.1 * o.type + 0.36 * o.write;
      break;
    }
    case "visit": {
      o.lean = 0.04;
      o.nod = r < 0.7 ? nods(t, 3.4) : 0;
      break;
    }
    case "meet": {
      o.hands = 0.85;
      o.lean = 0.09;
      o.headDown = 0.05;
      o.nod = r < 0.6 ? nods(t, 4.6) : 0;
      break;
    }
    case "watch": {
      const keen = r > 0.55 ? win(t, 3, 9.5, 1.2) : 0;
      o.lean = 0.04 + 0.1 * keen;
      break;
    }
  }
  if (attend > 0) {
    // someone at the counter: tasks pause, the person sits up and looks at them (the head turn is the look-at layer)
    const k = 1 - Math.min(1, attend);
    o.type *= k;
    o.write *= k;
    o.move *= k;
    o.lean *= k;
    o.headDown *= k;
    o.hands = o.hands * k + 0.6 * (1 - k);
  }
  return o;
}

/**
 * Distance along a ray (from `ox, oz` heading `yaw`, forward = (sin yaw, cos yaw)) to where it enters an
 * axis-aligned rectangle; Infinity when it misses (slab method).
 */
export function edgeAhead(ox: number, oz: number, yaw: number, r: { x: number; z: number; w: number; d: number }): number {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, c, h] of [
    [ox, dx, r.x, r.w / 2],
    [oz, dz, r.z, r.d / 2],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o - c) > h) return Infinity;
      continue;
    }
    const a = (c - h - o) / d;
    const b = (c + h - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
}

/** The current hall's seat → activity lookup (set by the hall controller; others' avatars read it too). */
export const seatActivities: { fn: ((seatId: string) => SeatActivity | null) | null } = { fn: null };
export const seatActivityOf = (seatId: string | null | undefined): SeatActivity | null => (seatId && seatActivities.fn ? seatActivities.fn(seatId) : null);
