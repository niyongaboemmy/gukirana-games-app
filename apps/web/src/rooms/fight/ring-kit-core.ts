/**
 * Boxing ring kit, pure part (P3-FGT-02): ring dimensions, where things are on a ring (corners, stools, fighters'
 * spots, referee, steps) and the per-frame LOD / culling selection for a field of rings. No three.js here: the
 * component (ring-kit.tsx) and the hall (layouts, placement) both build on it, and it is unit-tested.
 *
 * Ring frame: origin = the ring centre on the hall floor, +y up, rotY about +y (three.js convention: a point (x, z)
 * of the ring frame is at (x cos + z sin, −x sin + z cos) in the hall). Corners: red at (−p, −p), blue at (+p, +p),
 * the neutral corners at (+p, −p) and (−p, +p), p = RING.post.
 */

export type RingStatus = "free" | "waiting" | "fighting" | "closed";

export interface RingSpec {
  id: string;
  x: number;
  z: number;
  /** rotation about +y (rad) */
  rotY: number;
  status: RingStatus;
  /** the number on the ring boards (default: index + 1) */
  number?: number;
  /** between rounds: the stools are in the corners (otherwise on the floor by the steps) */
  rest?: boolean;
}

export const RING = {
  /** post centres at ±post (inside of the ropes ≈ 5.6 m square, a mid-size pro ring) */
  post: 2.95,
  /** half size of the platform (the apron runs 0.5 m outside the posts) */
  half: 3.45,
  /** canvas height above the hall floor */
  deck: 0.8,
  /** post height above the canvas */
  postH: 1.55,
  /** rope heights above the canvas (18, 30, 42, 54 inches) */
  ropes: [0.46, 0.76, 1.07, 1.37] as const,
  /** rope sag at mid-span (m), top rope … bottom rope */
  sag: [0.045, 0.04, 0.035, 0.03] as const,
  /** spectator rail: half size of its square (1.45 m out from the platform) and height */
  rail: 4.9,
  railH: 1.0,
  /** stool height (the boxing corner-rest pose sits on it: world/human/boxing STOOL_HEIGHT) */
  stoolH: 0.55,
  /** bounding sphere radius of a ring incl. its rail (culling) */
  radius: 7.2,
} as const;

export const STATUS_COLORS: Record<RingStatus, string> = {
  free: "#3ccf7a",
  waiting: "#f0a630",
  fighting: "#ff4d4d",
  closed: "#5c6068",
};

export type CornerId = "red" | "blue" | "neutralA" | "neutralB";
/** corner signs in the ring frame */
export const CORNERS: Record<CornerId, [number, number]> = { red: [-1, -1], blue: [1, 1], neutralA: [1, -1], neutralB: [-1, 1] };

export interface Spot {
  x: number;
  y: number;
  z: number;
  /** facing (rotation about +y; 0 = facing +z) */
  yaw: number;
}

/** ring frame → hall */
export function toHall(r: Pick<RingSpec, "x" | "z" | "rotY">, lx: number, ly: number, lz: number, lyaw = 0): Spot {
  const c = Math.cos(r.rotY),
    s = Math.sin(r.rotY);
  return { x: r.x + lx * c + lz * s, y: ly, z: r.z - lx * s + lz * c, yaw: lyaw + r.rotY };
}

/** yaw that faces from (x, z) towards (tx, tz) */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** Corner post (top of the canvas at its foot). */
export function cornerPost(r: RingSpec, c: CornerId): Spot {
  const [sx, sz] = CORNERS[c];
  return toHall(r, sx * RING.post, RING.deck, sz * RING.post);
}

/** Where a fighter's stool stands in their corner during the rest, facing the ring centre (the root of the
 * corner-rest pose). */
export function stoolSpot(r: RingSpec, c: "red" | "blue"): Spot {
  const [sx, sz] = CORNERS[c];
  const d = RING.post - 0.48;
  return toHall(r, sx * d, RING.deck, sz * d, facing(sx * d, sz * d, 0, 0));
}

/** The stool off duty: on the hall floor outside the corner, by the steps. */
export function stoolParked(r: RingSpec, c: "red" | "blue"): Spot {
  const [sx, sz] = CORNERS[c];
  return toHall(r, sx * (RING.half + 0.45), 0, sz * (RING.post - 0.9), 0);
}

/** Root-to-root distance at which straight punches land (the jab / cross reach of the motion library + the head). */
export const PUNCH_RANGE = 1.0;

/**
 * Fighters' spots on the red–blue diagonal, `gap` metres apart (root to root), facing each other: the start of a
 * round / touching gloves (world/human/boxing TOUCH_DISTANCE ≈ 0.92 m) or fighting range (PUNCH_RANGE).
 */
export function fightSpots(r: RingSpec, gap = PUNCH_RANGE): { red: Spot; blue: Spot } {
  const h = gap / 2 / Math.SQRT2;
  return { red: toHall(r, -h, RING.deck, -h, facing(-h, -h, 0, 0)), blue: toHall(r, h, RING.deck, h, facing(h, h, 0, 0)) };
}

/** Each fighter's corner start: 0.9 m out of the corner on the diagonal, facing the centre. */
export function cornerStart(r: RingSpec, c: "red" | "blue"): Spot {
  const [sx, sz] = CORNERS[c];
  const d = RING.post - 0.9;
  return toHall(r, sx * d, RING.deck, sz * d, facing(sx * d, sz * d, 0, 0));
}

/** The referee's spot: off the fighters' diagonal, towards a neutral corner, facing the centre. */
export function refereeSpot(r: RingSpec): Spot {
  const d = 1.1;
  return toHall(r, d, RING.deck, -d, facing(d, -d, 0, 0));
}

/**
 * The steps up into a fighter's corner (outside the platform, along the side next to the corner): `foot` = on the
 * hall floor at the bottom, `top` = on the apron, `in` = through the ropes onto the canvas, each facing the way in.
 */
export function ringSteps(r: RingSpec, c: "red" | "blue"): { foot: Spot; top: Spot; in: Spot } {
  const [sx, sz] = CORNERS[c];
  const z = sz * (RING.post - 0.7);
  const yaw = facing(sx, 0, 0, 0);
  return {
    foot: toHall(r, sx * (RING.half + 1.1), 0, z, yaw),
    top: toHall(r, sx * (RING.half - 0.2), RING.deck, z, yaw),
    in: toHall(r, sx * (RING.post - 0.6), RING.deck, z, yaw),
  };
}

/* ---------------- LOD / culling ---------------- */

export type RingLod = "near" | "far" | "culled";

export interface LodOptions {
  /** rings closer than this (m) get the detailed kit */
  near: number;
  /** extra distance before a near ring drops back to far (no flicker at the threshold) */
  hysteresis: number;
  /** beyond this nothing is drawn (fog / hall walls) */
  max: number;
}

export const LOD_BY_TIER: Record<"lite" | "standard", LodOptions> = {
  standard: { near: 26, hysteresis: 3, max: 220 },
  lite: { near: 14, hysteresis: 2, max: 140 },
};

/**
 * Pick a level per ring: `near` within opts.near (kept until near + hysteresis), `far` up to max, `culled` outside
 * the view (`visible(ring)`: a bounding-sphere frustum test supplied by the renderer) or beyond max. The feature
 * ring is always near (unless culled). Deterministic and allocation-light (reuses `out`).
 */
export function selectLods(rings: readonly RingSpec[], cam: { x: number; y: number; z: number }, opts: LodOptions, visible: (r: RingSpec) => boolean, prev: readonly RingLod[] | null, feature: string | null, out: RingLod[] = []): RingLod[] {
  out.length = rings.length;
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]!;
    const d = Math.hypot(r.x - cam.x, RING.deck - cam.y, r.z - cam.z);
    if (d > opts.max + RING.radius || !visible(r)) {
      out[i] = "culled";
      continue;
    }
    if (r.id === feature) {
      out[i] = "near";
      continue;
    }
    const wasNear = prev?.[i] === "near";
    out[i] = d < opts.near + (wasNear ? opts.hysteresis : 0) ? "near" : "far";
  }
  return out;
}

/** Draw calls of the whole ring field (all rings together), per tier: the budget check for the hall. */
export function ringDrawCalls(tier: "lite" | "standard", o: { anyNear: boolean; anyFar: boolean; feature: boolean; boards: boolean; shadows?: boolean }): number {
  let n = 0;
  if (o.anyNear) n += 1 + 1; // near kit + stools
  if (o.anyFar) n += 1; // far kit
  if (o.anyNear || o.anyFar) n += 2; // status lamps + canvas (printed on standard, plain on lite)
  if (tier === "standard") {
    if (o.boards && (o.anyNear || o.anyFar)) n += 1; // number boards
    if (o.feature) n += 1; // feature-ring extras
    if (o.shadows && o.anyNear) n += 2; // the near kit + stools in one shadow map
  }
  return n;
}
