import * as THREE from "three";
import { ANIM_SETS, type ClipKey } from "./meta";

/**
 * Animation state machine for one realistic avatar.
 *
 * Locomotion is a speed-driven 1D blend (walk → fast walk → run → sprint) with one shared, phase-synced gait
 * cycle: every locomotion clip is sampled at the same normalised phase, and the phase advances by
 * ground speed / blended stride length, so the feet match the ground (no sliding, no "slow-motion running").
 * Walking stays a walk up to ~2.0 m/s and becomes a run from ~2.8 m/s, cross-fading in between.
 *
 * Everything else (idle, talk, wave, clap, dance, sit, sit-down/stand-up) is a weighted set of "static" actions
 * cross-faded with smoothed weights, so state changes never snap.
 */

export const ANIM_IDLE = 0;
export const ANIM_WALK = 1;
export const ANIM_RUN = 2;
export const ANIM_WAVE = 10;
export const ANIM_DANCE = 11;
export const ANIM_CLAP = 12;
export const ANIM_SIT = 13;

const LOCO: ClipKey[] = ["walk", "walkfast", "run", "sprint"];
const STATIC: ClipKey[] = ["idle", "talk", "wave", "clap", "dance", "sit", "sitdown", "standup"];
const ONE_SHOT: ClipKey[] = ["sitdown", "standup"];

/** Clips per animation set with the root translation rescaled to a model's hip height (cached per ratio). */
const clipCache = new Map<string, Map<ClipKey, THREE.AnimationClip>>();
export function clipsFor(set: "m" | "f", source: THREE.AnimationClip[], hipY: number): Map<ClipKey, THREE.AnimationClip> {
  const ratio = hipY / ANIM_SETS[set].rootY;
  const key = `${set}|${ratio.toFixed(4)}`;
  const hit = clipCache.get(key);
  if (hit) return hit;
  const out = new Map<ClipKey, THREE.AnimationClip>();
  for (const c of source) {
    const clip = c.clone();
    for (const t of clip.tracks) {
      if (t.name === "Bip01.position") {
        const v = t.values;
        for (let i = 0; i < v.length; i++) v[i] = v[i]! * ratio;
      }
    }
    out.set(clip.name as ClipKey, clip);
  }
  clipCache.set(key, out);
  return out;
}

export interface AnimInput {
  anim: number;
  /** measured ground speed (m/s) */
  speed: number;
  /** yaw rate (rad/s), for turning on the spot */
  yawRate: number;
  talking: boolean;
}

export class HumanAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private dur = new Map<ClipKey, number>();
  private native: Partial<Record<ClipKey, number>>;
  private anchors: { s: number; clip: ClipKey }[];
  private phase = 0;
  private moveW = 0;
  private sw = new Map<ClipKey, number>([["idle", 1]]);
  private sit: "none" | "down" | "sit" | "up" = "none";
  private first = true;

  constructor(root: THREE.Object3D, clips: Map<ClipKey, THREE.AnimationClip>, set: "m" | "f") {
    this.mixer = new THREE.AnimationMixer(root);
    this.native = ANIM_SETS[set].speed;
    for (const [k, clip] of clips) {
      const a = this.mixer.clipAction(clip);
      this.dur.set(k, clip.duration);
      if (ONE_SHOT.includes(k)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      if (LOCO.includes(k)) a.timeScale = 0; // sampled manually at the shared gait phase
      a.setEffectiveWeight(k === "idle" ? 1 : 0);
      a.play();
      this.actions.set(k, a);
    }
    const n = this.native;
    const walk = n.walk ?? 1;
    const fast = Math.max(n.walkfast ?? 1.5, walk + 0.1);
    const run = Math.max(n.run ?? 2.85, 2.8);
    const sprint = Math.max(n.sprint ?? 5.6, run + 0.5);
    this.anchors = [
      { s: walk, clip: "walk" },
      { s: fast, clip: "walkfast" },
      { s: Math.max(2.0, fast + 0.05), clip: "walkfast" },
      { s: run, clip: "run" },
      { s: sprint, clip: "sprint" },
    ];
  }

  private cycle(k: ClipKey) {
    return (this.native[k] ?? 1) * (this.dur.get(k) ?? 1);
  }

  private locoWeights(s: number): [ClipKey, number][] {
    const A = this.anchors;
    if (s <= A[0]!.s) return [[A[0]!.clip, 1]];
    for (let i = 0; i < A.length - 1; i++) {
      const a = A[i]!, b = A[i + 1]!;
      if (s < b.s) {
        const t = (s - a.s) / (b.s - a.s);
        return a.clip === b.clip ? [[a.clip, 1]] : [
          [a.clip, 1 - t],
          [b.clip, t],
        ];
      }
    }
    return [[A[A.length - 1]!.clip, 1]];
  }

  update(dt: number, inp: AnimInput) {
    const sitReq = inp.anim === ANIM_SIT;
    // ---- seated state machine (13 = sit, with sit-down / stand-up transitions)
    if (this.first) {
      this.first = false;
      if (sitReq) {
        this.sit = "sit";
        this.sw = new Map([["sit", 1]]);
      }
    }
    if (sitReq && (this.sit === "none" || this.sit === "up")) {
      this.sit = "down";
      this.restart("sitdown");
    } else if (!sitReq && (this.sit === "down" || this.sit === "sit")) {
      this.sit = "up";
      this.restart("standup");
    }
    if (this.sit === "down" && this.time("sitdown") >= (this.dur.get("sitdown") ?? 1) - 0.35) this.sit = "sit";
    if (this.sit === "up" && this.time("standup") >= (this.dur.get("standup") ?? 1) - 0.35) this.sit = "none";
    const seated = this.sit !== "none";

    // ---- locomotion
    let s = inp.speed;
    let moving = s > 0.15;
    if (!moving && Math.abs(inp.yawRate) > 1.1) {
      // turning on the spot: small steps
      s = 0.55;
      moving = true;
    }
    if (seated) moving = false;
    const k = 1 - Math.exp(-dt * (moving ? 7 : 5));
    this.moveW += ((moving ? 1 : 0) - this.moveW) * k;
    const lw = this.locoWeights(Math.max(s, 0.2));
    let cyc = 0;
    for (const [c, w] of lw) cyc += w * this.cycle(c);
    this.phase = (this.phase + (Math.max(s, 0.2) * dt) / Math.max(cyc, 0.1)) % 1;
    for (const c of LOCO) {
      const a = this.actions.get(c);
      if (!a) continue;
      const w = lw.find((x) => x[0] === c)?.[1] ?? 0;
      a.time = this.phase * (this.dur.get(c) ?? 1);
      a.setEffectiveWeight(w * this.moveW);
    }

    // ---- static layer targets
    const target = new Map<ClipKey, number>();
    if (this.sit === "down") target.set("sitdown", 1);
    else if (this.sit === "up") target.set("standup", 1);
    else if (this.sit === "sit") target.set("sit", 1);
    else if (inp.anim === ANIM_WAVE) target.set("wave", 1);
    else if (inp.anim === ANIM_DANCE) target.set("dance", 1);
    else if (inp.anim === ANIM_CLAP) target.set("clap", 1);
    else if (inp.talking) {
      target.set("idle", 0.45);
      target.set("talk", 0.55);
    } else target.set("idle", 1);
    const rate = this.sit === "down" || this.sit === "up" ? 9 : 4.5;
    const ks = 1 - Math.exp(-dt * rate);
    let sum = 0;
    for (const c of STATIC) {
      const prev = this.sw.get(c) ?? 0;
      const next = prev + ((target.get(c) ?? 0) - prev) * ks;
      if (prev < 0.02 && next >= 0.02 && (c === "wave" || c === "clap" || c === "dance")) this.restart(c);
      this.sw.set(c, next);
      sum += next;
    }
    for (const c of STATIC) {
      const a = this.actions.get(c);
      if (!a) continue;
      a.setEffectiveWeight(((this.sw.get(c) ?? 0) / Math.max(sum, 1e-4)) * (1 - this.moveW));
    }
    this.mixer.update(dt);
  }

  private time(k: ClipKey) {
    return this.actions.get(k)?.time ?? 0;
  }

  private restart(k: ClipKey) {
    const a = this.actions.get(k);
    if (!a) return;
    a.reset();
    a.play();
    if (LOCO.includes(k)) a.timeScale = 0;
  }

  /** (Re)start all actions — called on mount (safe with React StrictMode's mount → unmount → mount). */
  start() {
    for (const [k, a] of this.actions) {
      a.play();
      if (LOCO.includes(k)) a.timeScale = 0;
    }
  }

  stop() {
    this.mixer.stopAllAction();
  }
}
