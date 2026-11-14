import * as THREE from "three";
import { ANIM_SETS, SIT_TIMING, type ClipKey, type LifeClipKey } from "./meta";
import { actionClip, ONE_SHOT_LIFE, type IdleChoice, IdleDirector } from "./life";

/**
 * Animation state machine for one realistic avatar.
 *
 * Locomotion is a speed-driven 1D blend (walk → fast walk → run → sprint) with one shared, phase-synced gait
 * cycle: every locomotion clip is sampled at the same normalised phase, and the phase advances by
 * ground speed / blended stride length, so the feet match the ground (no sliding, no "slow-motion running").
 * Walking stays a walk up to ~2.0 m/s and becomes a run from ~2.8 m/s, cross-fading in between.
 * - starting: the gait blends in at 10/s from the measured speed (no glide at full stride);
 * - stopping: the phase stops with the body and eases to the nearest double-support foot plant (heel strikes at
 *   phase 0.25 / 0.75) while the gait fades out, so the front foot never slides after the body has stopped;
 * - turning on the spot: small walk steps (≤ 45 % weight) whose phase follows the yaw rate (~0.18 m per radian);
 * - walking backwards: the walk cycle runs in reverse (walk clip only) instead of moonwalking.
 *
 * Everything else is a weighted set of "static" actions cross-faded with smoothed weights: idle, talk, the
 * base emotes, sit-down / seated / stand-up (trimmed transitions with the clip's own root motion), plus the
 * lazily loaded everyday-life clips (life-*.glb): idle fidgets chosen by a per-person seeded IdleDirector,
 * emotes (nod, laugh, shrug, cheer …) and context actions (coffee, photo, phone, hands on hips, thinking).
 */

export const ANIM_IDLE = 0;
export const ANIM_WALK = 1;
export const ANIM_RUN = 2;
export const ANIM_WAVE = 10;
export const ANIM_DANCE = 11;
export const ANIM_CLAP = 12;
export const ANIM_SIT = 13;

const LOCO: ClipKey[] = ["walk", "walkfast", "run", "sprint"];
const BASE_STATIC: ClipKey[] = ["idle", "talk", "wave", "clap", "dance", "sit", "sitdown", "standup"];
const BASE_ONE_SHOT: ClipKey[] = ["sitdown", "standup"];
/** clips restarted from the beginning whenever they fade in */
const RESTART = new Set<ClipKey>(["wave", "clap", "dance", ...ONE_SHOT_LIFE]);
/** double-support foot plants of the gait cycle (right / left heel strike) */
const PLANTS = [0.25, 0.75];

/** Clips per animation set with the root translation rescaled to a model's hip height (cached per ratio). */
const clipCache = new Map<string, Map<ClipKey, THREE.AnimationClip>>();
export function clipsFor(set: "m" | "f", source: THREE.AnimationClip[], hipY: number, tag = "base"): Map<ClipKey, THREE.AnimationClip> {
  const ratio = hipY / ANIM_SETS[set].rootY;
  const key = `${tag}|${set}|${ratio.toFixed(4)}`;
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
  /** signed speed along the facing (m/s): negative = walking backwards */
  forward?: number;
  /** yaw rate (rad/s), for turning on the spot */
  yawRate: number;
  talking: boolean;
  /** someone close by is talking to / near this person (listening: fewer fidgets) */
  listening?: boolean;
  /** another person stands within conversation distance (≈ 1.8 m) */
  company?: boolean;
  /**
   * Sit-down / stand-up root motion:
   * - "clip" (plaza benches): the origin is on the seat while sitting down and already at the standing spot while
   *   standing up; the transition clip's own root motion moves the body between the two;
   * - "inPlace" (default; hall chairs): the controller moves the origin itself, the clips play in place.
   */
  rootMotion?: "clip" | "inPlace";
  /** wall clock (ms) for the seeded idle schedule */
  now?: number;
}

export interface FootStep {
  /** 0 walk · 1 run · 2 brushed (turning on the spot) */
  kind: 0 | 1 | 2;
  /** 0..1 */
  level: number;
}

type SitState = "none" | "down" | "sit" | "up";

export class HumanAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private dur = new Map<ClipKey, number>();
  private native: Partial<Record<ClipKey, number>>;
  private anchors: { s: number; clip: ClipKey }[];
  private phase = 0;
  private moveW = 0;
  private sw = new Map<ClipKey, number>([["idle", 1]]);
  private statics: ClipKey[] = [...BASE_STATIC];
  private sit: SitState = "none";
  private first = true;
  private readonly set: "m" | "f";
  private readonly root: THREE.Object3D;
  private hips: THREE.Object3D | null = null;
  private rootTrack = new Map<"sitdown" | "standup", THREE.Interpolant>();
  private upEnd = new THREE.Vector3();
  private director: IdleDirector;
  private idleChoice: IdleChoice | null = null;
  private steps: FootStep[] = [];
  /** per-frame outputs for the avatar layer (props, procedural layers) */
  readonly out = { phone: 0, cup: 0, seated: false, moveW: 0, sit: "none" as SitState, fidget: "" as string, sitW: 0 };

  constructor(root: THREE.Object3D, clips: Map<ClipKey, THREE.AnimationClip>, set: "m" | "f", seed = 1) {
    this.root = root;
    this.set = set;
    this.mixer = new THREE.AnimationMixer(root);
    this.native = ANIM_SETS[set].speed;
    this.director = new IdleDirector(seed);
    this.addClips(clips, true);
    // every person breathes / shifts at their own time and pace (no crowd in lockstep)
    const idle = this.actions.get("idle");
    if (idle) {
      idle.time = (seed % 997) / 997 * (this.dur.get("idle") ?? 1);
      idle.timeScale = 0.92 + ((seed >>> 4) % 17) / 100;
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

  /** Add clips (the base set on construction, the everyday-life set when it has streamed in). */
  addClips(clips: Map<ClipKey, THREE.AnimationClip>, base = false) {
    for (const [k, clip] of clips) {
      if (this.actions.has(k)) continue;
      const a = this.mixer.clipAction(clip);
      this.dur.set(k, clip.duration);
      if (BASE_ONE_SHOT.includes(k) || ONE_SHOT_LIFE.includes(k as LifeClipKey)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      if (LOCO.includes(k)) a.timeScale = 0; // sampled manually at the shared gait phase
      a.setEffectiveWeight(k === "idle" ? 1 : 0);
      a.play();
      this.actions.set(k, a);
      if (!base && !LOCO.includes(k)) {
        this.statics.push(k);
        this.director.lengths[k as LifeClipKey] = clip.duration * 1000;
      }
      if (k === "sitdown" || k === "standup") {
        const t = clip.tracks.find((x) => x.name === "Bip01.position");
        if (t) this.rootTrack.set(k, new THREE.LinearInterpolant(t.times, t.values, 3, new Float32Array(3)));
      }
    }
    if (base) {
      const up = this.rootTrack.get("standup");
      if (up) this.upEnd.fromArray(up.evaluate(SIT_TIMING[this.set].up.done) as unknown as number[]);
    }
  }

  get hasLife() {
    return this.actions.has("nod");
  }

  private cycle(k: ClipKey) {
    return (this.native[k] ?? 1) * (this.dur.get(k) ?? 1);
  }

  private locoWeights(s: number): [ClipKey, number][] {
    const A = this.anchors;
    if (s <= A[0]!.s) return [[A[0]!.clip, 1]];
    for (let i = 0; i < A.length - 1; i++) {
      const a = A[i]!,
        b = A[i + 1]!;
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

  /** Foot plants since the last call (for footstep sounds). */
  takeSteps(): FootStep[] {
    if (!this.steps.length) return this.steps;
    const s = this.steps;
    this.steps = [];
    return s;
  }

  private advancePhase(d: number, kind: FootStep["kind"], level: number) {
    const before = this.phase;
    for (const p of PLANTS) {
      const gap = d >= 0 ? (((p - before) % 1) + 1) % 1 : (((before - p) % 1) + 1) % 1;
      if (gap > 0 && gap <= Math.abs(d) && this.steps.length < 4) this.steps.push({ kind, level });
    }
    this.phase = (((this.phase + d) % 1) + 1) % 1;
  }

  update(dt: number, inp: AnimInput) {
    const T = SIT_TIMING[this.set];
    const sitReq = inp.anim === ANIM_SIT;
    // ---- seated state machine (13 = sit, with trimmed sit-down / stand-up transitions)
    if (this.first) {
      this.first = false;
      if (sitReq) {
        this.sit = "sit";
        this.sw = new Map([["sit", 1]]);
      }
    }
    if (sitReq && (this.sit === "none" || this.sit === "up")) {
      this.sit = "down";
      this.restart("sitdown", T.down.offset, T.down.scale);
    } else if (!sitReq && (this.sit === "down" || this.sit === "sit")) {
      this.sit = "up";
      this.restart("standup", T.up.offset, T.up.scale);
    }
    if (this.sit === "down" && this.time("sitdown") >= T.down.done) this.sit = "sit";
    if (this.sit === "up" && this.time("standup") >= T.up.done) this.sit = "none";
    const seated = this.sit !== "none";

    // ---- locomotion
    const s = inp.speed;
    const fwd = inp.forward ?? s;
    let moving = s > 0.15 && !seated;
    const backward = moving && fwd < -0.1 && fwd < -0.5 * s;
    const turning = !moving && !seated && Math.abs(inp.yawRate) > 0.6;
    let want = moving ? 1 : 0;
    if (turning) want = Math.min(0.45, Math.abs(inp.yawRate) / 4);
    this.moveW += (want - this.moveW) * (1 - Math.exp(-dt * 10));
    let lw: [ClipKey, number][];
    if (moving) {
      lw = backward ? [["walk", 1]] : this.locoWeights(Math.max(s, 0.2));
      let cyc = 0;
      for (const [c, w] of lw) cyc += w * this.cycle(c);
      this.advancePhase(((backward ? -1 : 1) * Math.max(s, 0.2) * dt) / Math.max(cyc, 0.1), s > 2.4 ? 1 : 0, Math.min(1, 0.45 + s / 4));
    } else if (turning) {
      lw = [["walk", 1]];
      this.advancePhase((Math.abs(inp.yawRate) * 0.18 * dt) / Math.max(this.cycle("walk"), 0.1), 2, 0.35);
    } else {
      // stopped: hold the gait where the body stopped and settle into the nearest double-support plant
      lw = this.lastLw ?? [["walk", 1]];
      if (this.moveW > 0.01) {
        let bd = 9;
        for (const p of PLANTS) {
          const d = Math.atan2(Math.sin((p - this.phase) * Math.PI * 2), Math.cos((p - this.phase) * Math.PI * 2)) / (Math.PI * 2);
          if (Math.abs(d) < Math.abs(bd)) bd = d;
        }
        if (this.moveW < 0.6) this.phase = (((this.phase + bd * (1 - Math.exp(-dt * 12))) % 1) + 1) % 1;
      }
    }
    if (moving || turning) this.lastLw = lw;
    for (const c of LOCO) {
      const a = this.actions.get(c);
      if (!a) continue;
      const w = lw.find((x) => x[0] === c)?.[1] ?? 0;
      a.time = this.phase * (this.dur.get(c) ?? 1);
      a.setEffectiveWeight(w * this.moveW);
    }
    moving = moving || turning;

    // ---- static layer targets
    const target = new Map<ClipKey, number>();
    const now = inp.now ?? Date.now();
    const anim = inp.anim;
    const actClip = anim >= 10 && anim !== ANIM_SIT ? actionClip(anim, this.hasLife) : null;
    let fidget: IdleChoice | null = null;
    let standingIdle = false;
    if (this.sit === "down") target.set("sitdown", 1);
    else if (this.sit === "up") target.set("standup", 1);
    else if (this.sit === "sit") {
      // seated: the person's own way of sitting (upright / leaning back), an occasional look around
      fidget = this.hasLife ? this.director.seated(now) : null;
      target.set((fidget?.clip ?? "sit") as ClipKey, 1);
    } else if (actClip) target.set(actClip, 1);
    else if (inp.talking) {
      target.set("idle", 0.45);
      target.set("talk", 0.55);
    } else if (!moving && this.hasLife) {
      standingIdle = true;
      fidget = this.director.standing(now, { listening: !!inp.listening, company: !!inp.company });
      if (fidget) target.set(fidget.clip as ClipKey, 1);
      else target.set("idle", 1);
    } else target.set("idle", 1);
    if (!standingIdle) this.director.pause(now);
    // a fidget that was interrupted (walking, talking, an emote) starts over next time
    if (fidget?.key !== this.idleChoice?.key) this.idleChoice = fidget;
    const rate = this.sit === "down" || this.sit === "up" ? 9 : 4.5;
    const ks = 1 - Math.exp(-dt * rate);
    let sum = 0;
    for (const c of this.statics) {
      const prev = this.sw.get(c) ?? 0;
      const next = prev + ((target.get(c) ?? 0) - prev) * ks;
      if (prev < 0.02 && next >= 0.02 && RESTART.has(c)) this.restart(c);
      this.sw.set(c, next);
      sum += next;
    }
    for (const c of this.statics) {
      const a = this.actions.get(c);
      if (!a) continue;
      a.setEffectiveWeight(((this.sw.get(c) ?? 0) / Math.max(sum, 1e-4)) * (1 - this.moveW));
    }
    this.mixer.update(dt);

    // ---- sit / stand root: the transition clip alone decides where the hips are (no blend drift into the bench)
    if (this.sit === "down" || this.sit === "up") {
      const hips = this.hips ?? (this.hips = this.root.getObjectByName("Bip01") ?? null);
      const k = this.sit === "down" ? "sitdown" : "standup";
      const it = this.rootTrack.get(k);
      if (hips && it && inp.rootMotion === "clip") {
        const v = it.evaluate(this.time(k)) as unknown as number[];
        if (k === "standup") hips.position.set(v[0]! - this.upEnd.x, hips.position.y, v[2]! - this.upEnd.z);
        else hips.position.set(v[0]!, hips.position.y, v[2]!);
      } else if (hips) {
        // in place: the controller carries the person between the standing spot and the seat
        hips.position.x = 0;
        hips.position.z = 0;
      }
    }

    // ---- outputs for props / procedural layers
    const w = (k: ClipKey) => (this.sw.get(k) ?? 0) / Math.max(sum, 1e-4) * (1 - this.moveW);
    const tIn = (k: ClipKey, a: number, b: number) => {
      const t = this.time(k);
      return t > a && t < (this.dur.get(k) ?? 0) - b ? 1 : 0;
    };
    this.out.phone = Math.max(w("phone") * tIn("phone", 0.9, 0.9), w("photo") * tIn("photo", 0.75, 1.1));
    this.out.cup = w("drink");
    this.out.seated = seated;
    this.out.sit = this.sit;
    // seated blend for the seat fit layer: follows the body down onto the seat / up off it (no pop at either end)
    this.out.sitW = this.sit === "sit" ? 1 : this.sit === "down" ? this.prog("sitdown", T.down) : this.sit === "up" ? 1 - this.prog("standup", T.up) : 0;
    this.out.moveW = this.moveW;
    this.out.fidget = fidget?.clip ?? "";
  }

  private lastLw: [ClipKey, number][] | null = null;

  /** eased progress (0…1) of a sit-down / stand-up transition between its trimmed start and its end */
  private prog(k: "sitdown" | "standup", tm: { offset: number; done: number }) {
    const x = THREE.MathUtils.clamp((this.time(k) - tm.offset) / Math.max(1e-3, tm.done - tm.offset), 0, 1);
    return x * x * (3 - 2 * x);
  }

  private time(k: ClipKey) {
    return this.actions.get(k)?.time ?? 0;
  }

  private restart(k: ClipKey, offset = 0, scale = 1) {
    const a = this.actions.get(k);
    if (!a) return;
    a.reset();
    a.play();
    a.time = offset;
    a.timeScale = scale;
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
