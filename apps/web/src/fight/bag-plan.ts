import type { GymProp } from "./gym-plan";

/**
 * Bag work, pure part (P3-FGT-08): where you stand at a training-wall station, which clip each punch input plays,
 * the auto combos, and how hard each punch moves the bag. No three.js, no clock: unit-tested; fight/bag-work.tsx
 * drives the avatar with it. Cosmetic only (no Stars, no score).
 */

export type BagPunch = "jab" | "cross" | "hook" | "uppercut" | "body";
export type BagClip = "jab" | "cross" | "leadHook" | "rearHook" | "leadUppercut" | "rearUppercut" | "leadBody" | "rearBody";

/** root → bag centre in the guard: a jab (reach 0.78) lands on the bag's face (radius 0.19) */
export const BAG_R = { heavyBag: 0.92, speedBag: 0.5, mirror: 0 } as const;
/** how far round the bag the footwork may circle (rad, either side of square on) */
export const ORBIT_MAX = 0.5;
/** one side step of the footwork clips (m of arc) */
export const STEP_ARC = 0.25;

export type BagStation = "heavyBag" | "speedBag" | "mirror";
export const isBagStation = (k: GymProp["kind"]): k is BagStation => k === "heavyBag" || k === "speedBag" || k === "mirror";

/**
 * Where the root stands and faces at `orbit` rad round the station (0 = square on, towards the wall at +z). The
 * mirror has no bag: you shadow-box on its stand line facing the glass.
 */
export function bagStance(p: Pick<GymProp, "kind" | "x" | "z" | "stand">, orbit = 0): { x: number; z: number; yaw: number } {
  if (p.kind === "mirror") return { x: p.stand.x + Math.sin(orbit) * 0.6, z: p.stand.z, yaw: 0 };
  const r = BAG_R[p.kind as "heavyBag" | "speedBag"] ?? 0.9;
  const o = p.kind === "speedBag" ? 0 : orbit;
  return { x: p.x - Math.sin(o) * r, z: p.z - Math.cos(o) * r, yaw: o };
}

/** the clip for a punch input; hooks / uppercuts / body shots alternate hands (`n` = how many of that kind so far) */
export function bagClip(p: BagPunch, n: number): BagClip {
  const lead = n % 2 === 0;
  switch (p) {
    case "jab":
      return "jab";
    case "cross":
      return "cross";
    case "hook":
      return lead ? "leadHook" : "rearHook";
    case "uppercut":
      return lead ? "rearUppercut" : "leadUppercut";
    case "body":
      return lead ? "leadBody" : "rearBody";
  }
}

/** how hard each clip moves the bag (0…1) and to which side (−1 the bag's left … +1 its right, seen by the boxer) */
export const BAG_HIT: Record<BagClip, { power: number; side: number }> = {
  jab: { power: 0.45, side: -0.2 },
  cross: { power: 0.9, side: 0.25 },
  leadHook: { power: 0.75, side: 0.9 },
  rearHook: { power: 0.8, side: -0.9 },
  leadUppercut: { power: 0.55, side: 0.1 },
  rearUppercut: { power: 0.6, side: -0.1 },
  leadBody: { power: 0.7, side: 0.6 },
  rearBody: { power: 0.75, side: -0.6 },
};

/** the auto-combo cycle: punch inputs, then a footwork move ("L" / "R" a side step round the bag, "" none) */
export const AUTO_COMBOS: { punches: BagPunch[]; step: "L" | "R" | "" }[] = [
  { punches: ["jab", "jab", "cross"], step: "" },
  { punches: ["jab", "cross", "hook"], step: "L" },
  { punches: ["jab", "body", "hook"], step: "" },
  { punches: ["cross", "hook", "cross"], step: "R" },
  { punches: ["jab", "uppercut", "hook", "cross"], step: "R" },
  { punches: ["jab", "jab", "cross", "hook"], step: "L" },
];

/** the next orbit after a side step (clamped; at the limit a step goes back the other way) */
export function stepOrbit(orbit: number, dir: "L" | "R"): number {
  const k = STEP_ARC / BAG_R.heavyBag;
  const next = orbit + (dir === "L" ? -k : k);
  if (Math.abs(next) > ORBIT_MAX + 1e-6) return orbit + (dir === "L" ? k : -k);
  return next;
}

/** speed-bag work: fast light alternating strikes (the motion library's jab / cross at a quick rate, low commitment) */
export const SPEED_BAG = { speed: 1.9, intensity: 0.25 };
