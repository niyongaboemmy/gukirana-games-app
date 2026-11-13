import type { BaseClipKey, LifeClipKey } from "./meta";

/**
 * Everyday life for avatars (docs/PEOPLE-BEHAVIOUR.md): which clip an action code plays, and the automatic idle
 * behaviour of a person standing or sitting around — a seeded schedule per person, so two people never fidget in
 * lockstep and the same person behaves the same way on every screen (cosmetic only: never game or money logic).
 */

/** Life clips that play once (and hold their last frame while fading out). The rest loop. */
export const ONE_SHOT_LIFE: LifeClipKey[] = ["look", "phone", "stretch", "dust", "nod", "shake", "laugh", "shrug", "think", "cheer", "photo", "sitlook"];

/** anim code (packages/contracts ACT) → clip. Procedural actions (hands, contact) run on the idle pose. */
const ACTION_CLIP: Record<number, BaseClipKey | LifeClipKey> = {
  10: "wave",
  11: "dance",
  12: "clap",
  14: "nod",
  15: "shake",
  16: "laugh",
  17: "idle",
  18: "idle",
  19: "shrug",
  20: "cheer",
  21: "idle",
  22: "idle",
  23: "idle",
  24: "think",
  25: "shake",
  26: "idle",
  27: "phone",
  28: "drink",
  29: "photo",
  30: "idle2",
  31: "fold",
};
const BASE = new Set<string>(["idle", "talk", "wave", "clap", "dance"]);

/** The clip for an action code; before the life clips have streamed in, a close base clip (or idle). */
export function actionClip(anim: number, hasLife: boolean): BaseClipKey | LifeClipKey | null {
  const c = ACTION_CLIP[anim];
  if (!c) return null;
  if (hasLife || BASE.has(c)) return c;
  return anim === 16 ? "talk" : "idle";
}

/** Small seeded PRNG (mulberry32) — cosmetic variety only. */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a person id (session id / user id). */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface IdleChoice {
  key: number;
  clip: LifeClipKey | "sit";
}

type Weights = [LifeClipKey, number][];
/** On their own: glance around, shift weight, check the phone, hands on hips, brush the clothes, stretch. */
const ALONE: Weights = [
  ["look", 28],
  ["idle2", 22],
  ["phone", 16],
  ["fold", 12],
  ["dust", 9],
  ["stretch", 4],
];
/** Someone stands close by: attentive (listening pose, glances, the odd nod), the phone stays mostly away. */
const COMPANY: Weights = [
  ["listen", 30],
  ["idle2", 20],
  ["look", 14],
  ["fold", 12],
  ["nod", 12],
  ["phone", 4],
];
/** Someone is talking nearby: listen and nod (listeners nod ~7 times a minute). */
const LISTENING: Weights = [
  ["listen", 45],
  ["nod", 40],
  ["fold", 15],
];
const LEN: Partial<Record<LifeClipKey, number>> = { idle2: 7000, listen: 8000, fold: 9000 };

function pick(r: () => number, w: Weights): LifeClipKey {
  let total = 0;
  for (const [, n] of w) total += n;
  let x = r() * total;
  for (const [k, n] of w) {
    x -= n;
    if (x <= 0) return k;
  }
  return w[0]![0];
}

export class IdleDirector {
  private r: () => number;
  private cur: IdleChoice | null = null;
  private until = 0;
  private next = 0;
  private seq = 0;
  private seatCur: IdleChoice | null = null;
  private seatUntil = 0;
  private seatNext = 0;
  private readonly seatBase: "sit" | "sitb";
  /** clip lengths (ms), provided by the animator once the clips are known */
  lengths: Partial<Record<LifeClipKey, number>> = {};

  constructor(seed: number) {
    this.r = rng(seed ^ 0x9e3779b9);
    this.seatBase = seed % 2 ? "sitb" : "sit";
  }

  private len(k: LifeClipKey) {
    return LEN[k] ?? this.lengths[k] ?? 4000;
  }

  /** Standing still: the current fidget (or null = plain idle). */
  standing(now: number, ctx: { listening: boolean; company: boolean }): IdleChoice | null {
    if (!this.next) this.next = now + 1500 + this.r() * 6000;
    if (this.cur && now < this.until) return this.cur;
    this.cur = null;
    if (now < this.next) return null;
    const w = ctx.listening ? LISTENING : ctx.company ? COMPANY : ALONE;
    const clip = pick(this.r, w);
    const len = this.len(clip);
    this.cur = { key: ++this.seq, clip };
    this.until = now + len;
    // pauses between fidgets: 7–14 s alone, 3–6 s while listening
    this.next = this.until + (ctx.listening ? 3000 + this.r() * 3000 : 7000 + this.r() * 7000);
    return this.cur;
  }

  /** Not idle (walking, talking, an action): the fidget stops and the next one waits a little. */
  pause(now: number) {
    if (this.cur) this.cur = null;
    this.next = Math.max(this.next, now + 3500);
  }

  /** Seated: the person's own way of sitting, with an occasional look around. */
  seated(now: number): IdleChoice {
    if (!this.seatNext) this.seatNext = now + 8000 + this.r() * 10000;
    if (this.seatCur && now < this.seatUntil) return this.seatCur;
    this.seatCur = null;
    if (now >= this.seatNext) {
      this.seatCur = { key: ++this.seq, clip: "sitlook" };
      this.seatUntil = now + this.len("sitlook");
      this.seatNext = this.seatUntil + 14000 + this.r() * 12000;
      return this.seatCur;
    }
    return { key: -1, clip: this.seatBase };
  }
}
