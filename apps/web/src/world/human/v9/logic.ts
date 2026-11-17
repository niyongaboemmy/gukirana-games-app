/**
 * P2-AVA-13: the pure rules of the v9 scanned people (docs/design/human-v9/README.md), kept free of three.js state so
 * they are unit-tested: which scanned person a seed gets, which level of detail a distance shows, how often a far
 * person's animation is stepped, which clip an action plays and how fast, which clip tracks a body may take from the
 * shared library, and the breathing on top of the clips. Cosmetic only: never game or money logic; every choice is a
 * function of a seed and the clock (no Math.random), so every screen shows the same person doing the same thing.
 */

export type V9Tier = "lite" | "standard";
export type AgeBand = "18-30" | "31-50" | "50+";

export interface V9Person {
  id: string;
  glb: string;
  /** standing height the scan was scaled to (m) */
  height: number;
  sex: "f" | "m";
  age: AgeBand;
  maps: Record<"desktop" | "phone", { color: string; normal?: string }>;
  /** skin mask (R = skin), 1k KTX2 */
  mask?: string;
  credit: string;
}

export interface V9Manifest {
  clips: string;
  people: V9Person[];
}

/** FNV-1a 32-bit hash of a string to [0, 1) (the same seed gives the same person on every screen). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // avalanche (murmur3 fmix32): FNV alone leaves the high bits nearly equal for seeds that differ only at the end
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The scanned person for a seed (optionally only one sex), or null when the manifest is empty. */
export function pickPerson(seed: string, people: readonly V9Person[], sex?: "f" | "m"): V9Person | null {
  const pool = sex ? people.filter((p) => p.sex === sex) : people;
  const list = pool.length ? pool : people;
  if (!list.length) return null;
  return list[Math.floor(hash01(`v9:${seed}`) * list.length) % list.length]!;
}

/**
 * Level of detail by camera distance (m): 0 = full scan (≤ 20k triangles), 1 = ~6k, 2 = ~1.5k. Phones switch nearer.
 * Hysteresis: a person only goes back to the finer level 12 % inside the threshold, so standing on a threshold never
 * flickers between two meshes.
 */
export const LOD_M: Record<V9Tier, [number, number]> = { standard: [9, 24], lite: [5.5, 14] };
export function pickLod(dist: number, current: 0 | 1 | 2, tier: V9Tier): 0 | 1 | 2 {
  const [a, b] = LOD_M[tier];
  const want: 0 | 1 | 2 = dist < a ? 0 : dist < b ? 1 : 2;
  if (want >= current) return want;
  // getting finer: only once clearly inside the finer band
  const edge = current === 2 ? b : a;
  return dist < edge * 0.88 ? want : current;
}

/** Step the animation every n-th frame by distance (a far person moves at 30 / 20 fps; nobody sees the difference). */
export function animStride(dist: number): 1 | 2 | 3 {
  return dist < 14 ? 1 : dist < 30 ? 2 : 3;
}

/** The clip names in the shared library (apps/web/scripts/human-v9/human-clips.json). */
export type V9Clip = "idle" | "idleWait" | "lookAround" | "walk" | "walkSlow" | "talk" | "talk2" | "wave" | "cheer" | "sit" | "sitDown" | "standUp" | "jump";

/** ground speed (m/s) of one playback of each walk clip as recorded (the mocap's own stride, measured by step 4) */
export const WALK_SPEED: Partial<Record<V9Clip, number>> = { walk: 1.17, walkSlow: 0.78 };

export interface ClipState {
  /** packages/contracts ACT code (0 idle, 1 walk, 2 run, 10 wave, 12 clap, 13 sit, 20 cheer, 16 laugh …) */
  anim: number;
  /** measured ground speed (m/s) */
  speed: number;
  talking: boolean;
  seated: boolean;
  seed: string;
  /** wall clock (s) */
  t: number;
}

/**
 * The clip an action plays and its playback rate. Walking picks the slow or normal walk by speed and scales the rate
 * so the stride matches the ground speed (no skating; the foot lock removes the rest). Standing people cycle between
 * the idle variants on a seeded 9–16 s schedule; talkers alternate two gesture takes.
 */
export function chooseClip(s: ClipState): { clip: V9Clip; rate: number } {
  if (s.seated || s.anim === 13) return { clip: "sit", rate: 1 };
  if (s.anim === 1 || s.anim === 2 || s.speed > 0.25) {
    const v = Math.max(0.3, s.speed || (s.anim === 2 ? 2.6 : 1.2));
    const clip: V9Clip = v < 0.95 ? "walkSlow" : "walk";
    return { clip, rate: Math.min(2.2, Math.max(0.6, v / WALK_SPEED[clip]!)) };
  }
  if (s.anim === 10) return { clip: "wave", rate: 1 };
  if (s.anim === 20 || s.anim === 12 || s.anim === 16 || s.anim === 11) return { clip: "cheer", rate: 1 };
  if (s.anim === 32) return { clip: "jump", rate: 1 };
  const h = hash01(s.seed);
  if (s.talking) {
    const slot = Math.floor((s.t + h * 40) / 11);
    return { clip: hash01(`${s.seed}:${slot}`) < 0.7 ? "talk" : "talk2", rate: 0.9 + h * 0.2 };
  }
  const len = 9 + h * 7;
  const slot = Math.floor((s.t + h * 100) / len);
  const r = hash01(`${s.seed}:idle:${slot}`);
  return { clip: r < 0.6 ? "idle" : r < 0.85 ? "idleWait" : "lookAround", rate: 0.92 + h * 0.16 };
}

/**
 * Which tracks of the shared clip library a body takes: every bone's rotation, but a position only for the root
 * (Bip01, scaled to the body's hip height): the library was retargeted on one person, and its other position tracks
 * would force that person's bone lengths onto everybody. Scale tracks are never taken.
 */
export function keepTrack(name: string): "rotation" | "root" | null {
  const dot = name.lastIndexOf(".");
  const bone = name.slice(0, dot);
  const prop = name.slice(dot + 1);
  if (prop === "quaternion") return "rotation";
  if (prop === "position" && bone === "Bip01") return "root";
  return null;
}

/** The hip-height ratio the root track is scaled by (body / library), clamped to adult proportions. */
export function hipScale(bodyHip: number, libraryHip: number): number {
  if (!(bodyHip > 0) || !(libraryHip > 0)) return 1;
  return Math.min(1.35, Math.max(0.7, bodyHip / libraryHip));
}

/**
 * Breathing on top of the clips (rad about the side axis): the chest lifts ~0.6° and the shoulders ~0.4°, 12–16
 * breaths a minute (seeded), a little faster and deeper while walking.
 */
export function breath(t: number, seed: string, moving: number): { chest: number; shoulders: number } {
  const h = hash01(`${seed}:breath`);
  const rate = (12 + h * 4 + moving * 6) / 60;
  // inhale a little shorter than exhale (a skewed sine)
  const ph = (t * rate + h) % 1;
  const w = ph < 0.42 ? Math.sin((ph / 0.42) * (Math.PI / 2)) : Math.cos(((ph - 0.42) / 0.58) * (Math.PI / 2));
  const amp = 1 + moving * 0.5;
  return { chest: 0.0105 * w * amp, shoulders: 0.007 * w * amp };
}
