import { ease, lerpPose, POSE_LEN, POSES, quat, type EaseName, type PoseName, type Pose, type Q, type V3 } from "./rig";

/**
 * Keyframed motion for the game hands (P2-GAME-07). Pure and deterministic: the overlay samples these every frame,
 * the unit tests sample them at chosen times. Presentation only — the die value and the seed moves always come from
 * the server / fairness RNG and the engine event log; a clip just shows them.
 *
 * Positions are in the hand's *local board frame*: u → right, v ↓ down, in board widths/heights (0–1 on the board),
 * as if the player sat at the bottom edge; the renderer turns that frame to the hand's real side. `h` is the height
 * of the anchor (fist centre or pinch point) above the board in metres of hand size.
 */

/** Timings at Normal speed (ms); every one is multiplied by the speed setting's animScale. */
export const LUDO_TIMING = {
  /** the practice shake / the live minimum before the server value arrives (LudoGame, LiveMatch) */
  grab: 600,
  /** the die tumble (LudoBoard TUMBLE_MS) — the die settles before this ends */
  tumble: 700,
  /** after the tumble the 3D die rests this long, then fades */
  rest: 300,
  fade: 260,
} as const;

/** Half the die's edge (m at hand scale: a 27 mm die, readable on a phone board). */
export const DIE_HALF = 0.0135;

export interface DieFrame {
  visible: boolean;
  /** riding in the hand (the renderer glues it to the hand's hold anchor) */
  held: boolean;
  u: number;
  v: number;
  h: number;
  q: Q;
  opacity: number;
}
export interface HandFrame {
  visible: boolean;
  u: number;
  v: number;
  h: number;
  /** yaw on top of the automatic shoulder-to-hand heading (rad) */
  yaw: number;
  /** forearm elevation (rad) and roll about the forearm (rad, + = thumb up) */
  pitch: number;
  roll: number;
  pose: Pose;
  anchor: "palm" | "pinch";
  seeds: number;
  die: DieFrame;
}

export function newFrame(): HandFrame {
  return {
    visible: false,
    u: 0.5,
    v: 1.4,
    h: 0.1,
    yaw: 0,
    pitch: 0.4,
    roll: 0,
    pose: new Float32Array(POSE_LEN),
    anchor: "palm",
    seeds: 0,
    die: { visible: false, held: false, u: 0, v: 0, h: DIE_HALF, q: [0, 0, 0, 1], opacity: 1 },
  };
}

/* ---------- keyframes ---------- */

export interface Key {
  t: number;
  u: number;
  v: number;
  h: number;
  pitch: number;
  roll: number;
  yaw?: number;
  pose: PoseName | Pose;
  /** ease into this key from the previous one */
  ease?: EaseName;
}
const D = Math.PI / 180;
const poseOf = (p: PoseName | Pose) => (typeof p === "string" ? POSES[p] : p);

/** Samples a key track at time t (clamped to the ends). Writes the hand fields of `out`. */
export function sampleKeys(keys: Key[], t: number, out: HandFrame): HandFrame {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1]!.t) i++;
  const a = keys[i]!;
  const b = keys[Math.min(i + 1, keys.length - 1)]!;
  const span = b.t - a.t;
  const x = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
  const e = ease[b.ease ?? "inOut"](x);
  out.u = a.u + (b.u - a.u) * e;
  out.v = a.v + (b.v - a.v) * e;
  out.h = a.h + (b.h - a.h) * e;
  out.pitch = a.pitch + (b.pitch - a.pitch) * e;
  out.roll = a.roll + (b.roll - a.roll) * e;
  out.yaw = (a.yaw ?? 0) + ((b.yaw ?? 0) - (a.yaw ?? 0)) * e;
  lerpPose(out.pose, poseOf(a.pose), poseOf(b.pose), e);
  return out;
}

function snapshot(f: HandFrame, t: number): Key {
  return { t, u: f.u, v: f.v, h: f.h, pitch: f.pitch, roll: f.roll, yaw: f.yaw, pose: Float32Array.from(f.pose) };
}

/* ---------- die orientation ---------- */

/** Die face normals in die space: 1 +Z, 6 −Z, 2 +Y, 5 −Y, 3 +X, 4 −X (opposite faces sum to 7). */
export const DIE_NORMALS: Record<number, V3> = { 1: [0, 0, 1], 6: [0, 0, -1], 2: [0, 1, 0], 5: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0] };

/** Die rotation that shows `value` on top (+Z, towards the viewer), turned `yaw` about the vertical. */
export function dieUpQ(value: number, yaw: number): Q {
  const n = DIE_NORMALS[value] ?? DIE_NORMALS[1]!;
  let toUp: Q;
  if (n[2] > 0.99) toUp = quat.id();
  else if (n[2] < -0.99) toUp = quat.axis([1, 0, 0], Math.PI);
  else toUp = quat.axis([n[1], -n[0], 0], Math.acos(Math.max(-1, Math.min(1, n[2]))));
  return quat.mul(quat.axis([0, 0, 1], yaw), toUp);
}
/** Face on top (+Z) for a die rotation. */
export function topFaceOf(q: Q): number {
  let best = 1, bz = -2;
  for (let v = 1; v <= 6; v++) {
    const z = quat.rotate(q, DIE_NORMALS[v]!)[2];
    if (z > bz) {
      bz = z;
      best = v;
    }
  }
  return best;
}

/** Cosmetic per-roll variety from the roll counter (deterministic, never Math.random). */
export function rollJitter(rollId: number, salt: number): number {
  let x = (Math.imul(rollId | 0, 2654435761) + Math.imul(salt | 0, 40503)) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 2246822519) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  return (x % 10000) / 10000;
}

/* ---------- Ludo: grab, cup, close, shake, flick ---------- */

export interface LudoRollOptions {
  /** animScale (Relaxed 1.5, Normal 1, Fast 0.55); 0 never builds a clip */
  k: number;
  /** where the die lies before the hand picks it up (local frame) */
  pickup: { u: number; v: number };
  /** the face shown before the throw (the last roll) */
  prevValue?: number | null;
  /** the die is visible at the pickup spot from the start (yours: it is the die you just saw) */
  dieVisibleAtStart?: boolean;
}

/**
 * One roll of the die. `grab(t0)` starts the hand: in from the player's side, open, cup over the die, close into a
 * fist and shake (looping until the value is known). `throw(t, value, rollId)` opens the hand and flicks the die
 * onto the board, where it tumbles and settles showing `value` before the tumble time ends; the hand withdraws at
 * once so the result stays readable. A throw without a grab (an opponent's roll seen live) plays a compressed grab
 * inside the same tumble time, so nothing waits longer than today's die animation.
 */
export class LudoRoll {
  readonly k: number;
  readonly G: number;
  readonly T: number;
  private o: LudoRollOptions;
  private grabAt: number | null = null;
  private throwAt: number | null = null;
  private grabKeys: Key[] = [];
  private throwKeys: Key[] = [];
  /** compressed grab (no shake loop) played inside the throw window */
  private compressed = false;
  private value = 1;
  private rollId = 0;
  private landing = { u: 0.56, v: 0.6 };
  private release = { t: 0, u: 0, v: 0, h: 0 };
  private qFinal: Q = [0, 0, 0, 1];
  private spinAxis: V3 = [1, 0, 0];
  private spin = 0;
  private shake = { from: 0, period: 0 };
  private tmp = newFrame();

  constructor(o: LudoRollOptions) {
    this.o = o;
    this.k = o.k;
    this.G = LUDO_TIMING.grab * o.k;
    this.T = LUDO_TIMING.tumble * o.k;
  }

  private buildGrab(t0: number, G: number) {
    const p = this.o.pickup;
    const sc = { u: 0.6, v: 0.84 };
    this.grabKeys = [
      { t: t0, u: p.u + 0.06, v: p.v + 0.6, h: 0.11, pitch: 24 * D, roll: -6 * D, pose: "relaxed" },
      { t: t0 + 0.32 * G, u: p.u + 0.01, v: p.v + 0.03, h: 0.052, pitch: 22 * D, roll: -4 * D, pose: "open", ease: "out" },
      { t: t0 + 0.45 * G, u: p.u, v: p.v - 0.005, h: 0.03, pitch: 20 * D, roll: 0, pose: "cup", ease: "inOut" },
      { t: t0 + 0.56 * G, u: sc.u, v: sc.v, h: 0.075, pitch: 22 * D, roll: 6 * D, pose: "fist", ease: "inOut" },
    ];
    this.shake = { from: t0 + 0.56 * G, period: 0.18 * G };
  }

  /** The hand starts reaching for the die (your roll request, or the AI's). */
  grab(t0: number) {
    if (this.grabAt !== null) return;
    this.grabAt = t0;
    this.buildGrab(t0, this.G);
  }

  /** The value is known: open, flick, withdraw; the die tumbles onto the board and settles on `value`. */
  throw(t: number, value: number, rollId: number) {
    if (this.throwAt !== null) return;
    this.value = value;
    this.rollId = rollId;
    let T = this.T;
    let t0 = t;
    if (this.grabAt === null) {
      // nobody saw the grab (live opponent): a quick one inside the tumble window
      this.compressed = true;
      this.grabAt = t;
      this.buildGrab(t, 0.4 * this.T);
      this.shake = { from: t + 0.4 * 0.56 * this.T, period: 0.4 * 0.18 * this.T };
      t0 = t + 0.4 * this.T;
      T = 0.6 * this.T;
    }
    this.throwAt = t0;
    const start = this.sampleGrab(t0, this.tmp);
    const s = snapshot(start, t0);
    const j = (salt: number) => rollJitter(rollId, salt) - 0.5;
    this.landing = { u: 0.46 + j(1) * 0.18, v: 0.62 + j(2) * 0.05 };
    this.throwKeys = [
      s,
      { t: t0 + 0.12 * T, u: s.u + 0.01, v: s.v + 0.035, h: 0.1, pitch: 26 * D, roll: 4 * D, pose: "windup", ease: "out" },
      { t: t0 + 0.22 * T, u: s.u - 0.02, v: s.v - 0.075, h: 0.078, pitch: 18 * D, roll: -8 * D, pose: "flick", ease: "out" },
      { t: t0 + 0.3 * T, u: s.u - 0.03, v: s.v - 0.09, h: 0.085, pitch: 18 * D, roll: -10 * D, pose: "flick", ease: "linear" },
      { t: t0 + 0.62 * T, u: s.u + 0.16, v: 1.95, h: 0.13, pitch: 26 * D, roll: -4 * D, pose: "relaxed", ease: "in" },
    ];
    const rk = sampleKeys(this.throwKeys, t0 + 0.17 * T, this.tmp);
    // the die pops out over the opening fingers (drawn above them), so it is never hidden under the hand
    this.release = { t: t0 + 0.17 * T, u: rk.u - 0.01, v: rk.v - 0.06, h: rk.h + 0.022 };
    this.qFinal = dieUpQ(value, (j(3) * 1.2 + 0.3) * Math.PI);
    const ax = j(4) * Math.PI;
    this.spinAxis = [Math.cos(ax), Math.sin(ax), 0.25];
    // whole turns: the spin unwinds to exactly the final rotation
    this.spin = Math.PI * 2 * (2 + (rollId % 2));
    this.throwT = T;
  }
  private throwT = 0;

  /** When the die has settled (≤ throw time + tumble). */
  get settledAt(): number {
    return this.throwAt === null ? Infinity : this.throwAt + 0.78 * this.throwT;
  }
  /** When the hand has left the screen. */
  get handGoneAt(): number {
    return this.throwAt === null ? Infinity : this.throwAt + 0.62 * this.throwT;
  }
  /** When the whole clip (die rest + fade included) is over. */
  get endAt(): number {
    if (this.throwAt === null) return Infinity;
    const tumbleEnd = this.compressed ? this.throwAt + this.throwT : this.throwAt + this.T;
    return tumbleEnd + (LUDO_TIMING.rest + LUDO_TIMING.fade) * this.k;
  }
  /** End of the tumble window (the 2D die shows the value from here). */
  get tumbleEnd(): number {
    if (this.throwAt === null) return Infinity;
    return this.compressed ? this.throwAt + this.throwT : this.throwAt + this.T;
  }

  private sampleGrab(t: number, out: HandFrame): HandFrame {
    sampleKeys(this.grabKeys, t, out);
    if (t > this.shake.from && this.shake.period > 0) {
      const ph = (t - this.shake.from) / this.shake.period;
      const amp = Math.min(1, ph / 0.3);
      const s = Math.sin(ph * Math.PI * 2);
      const c = Math.cos(ph * Math.PI * 2);
      out.u += 0.012 * c * amp;
      out.v += 0.03 * s * amp;
      out.h += 0.014 * Math.abs(s) * amp;
      out.roll += 0.24 * s * amp;
      out.pose[0] = out.pose[0]! + 0.35 * s * amp; // the wrist snaps with each shake
    }
    out.anchor = "palm";
    out.seeds = 0;
    return out;
  }

  /** Writes the frame at time t; returns false once the clip is over. */
  sample(t: number, out: HandFrame): boolean {
    if (this.grabAt === null) {
      out.visible = false;
      out.die.visible = false;
      return true;
    }
    const d = out.die;
    const pickT = this.grabAt + 0.45 * (this.compressed ? 0.4 * this.T : this.G);
    if (this.throwAt === null || t < this.throwAt) {
      this.sampleGrab(Math.max(t, this.grabAt), out);
      out.visible = true;
      d.visible = true;
      d.held = t >= pickT;
      if (!d.held) {
        d.u = this.o.pickup.u;
        d.v = this.o.pickup.v;
        d.h = DIE_HALF;
        const q = dieUpQ(this.o.prevValue ?? 1, 0.3);
        d.q[0] = q[0]; d.q[1] = q[1]; d.q[2] = q[2]; d.q[3] = q[3];
        d.opacity = this.o.dieVisibleAtStart ? 1 : Math.min(1, (t - this.grabAt) / Math.max(1, pickT - this.grabAt) * 1.6);
      } else d.opacity = 1;
      return true;
    }
    if (t >= this.endAt) {
      out.visible = false;
      d.visible = false;
      return false;
    }
    sampleKeys(this.throwKeys, t, out);
    out.anchor = "palm";
    out.seeds = 0;
    out.visible = t < this.handGoneAt;
    d.visible = true;
    if (t < this.release.t) {
      d.held = true;
      d.opacity = 1;
      return true;
    }
    d.held = false;
    this.dieAt(t, d);
    return true;
  }

  /** Die flight: a throw arc, one small bounce, a short slide; the spin unwinds onto the final face. */
  private dieAt(t: number, d: DieFrame) {
    const r = this.release, L = this.landing;
    const T = this.throwT;
    const tr = r.t, tb = this.throwAt! + 0.48 * T, tc = this.throwAt! + 0.64 * T, ts = this.settledAt;
    const bu = r.u + (L.u - r.u) * 0.8, bv = r.v + (L.v - r.v) * 0.8;
    if (t < tb) {
      const x = (t - tr) / (tb - tr);
      d.u = r.u + (bu - r.u) * x;
      d.v = r.v + (bv - r.v) * x;
      // parabola from the hand's height down to the board, peaking a little above the release
      d.h = r.h * (1 - x) + DIE_HALF * x + 4 * 0.03 * x * (1 - x);
    } else if (t < tc) {
      const x = (t - tb) / (tc - tb);
      const cu = bu + (L.u - bu) * 0.75, cv = bv + (L.v - bv) * 0.75;
      d.u = bu + (cu - bu) * x;
      d.v = bv + (cv - bv) * x;
      d.h = DIE_HALF + 4 * 0.012 * x * (1 - x);
    } else {
      const x = Math.min(1, (t - tc) / Math.max(1, ts - tc));
      const cu = bu + (L.u - bu) * 0.75, cv = bv + (L.v - bv) * 0.75;
      const e = ease.out(x);
      d.u = cu + (L.u - cu) * e;
      d.v = cv + (L.v - cv) * e;
      d.h = DIE_HALF;
    }
    const sx = Math.min(1, Math.max(0, (t - tr) / Math.max(1, ts - tr)));
    const left = this.spin * (1 - ease.out(sx));
    const q = left > 1e-6 ? quat.mul(this.qFinal, quat.axis(this.spinAxis, left)) : this.qFinal;
    d.q[0] = q[0]; d.q[1] = q[1]; d.q[2] = q[2]; d.q[3] = q[3];
    const fadeFrom = this.endAt - LUDO_TIMING.fade * this.k;
    d.opacity = t < fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / Math.max(1, LUDO_TIMING.fade * this.k));
  }

  /** Landing spot (local frame) of the current throw. */
  get landingSpot() {
    return this.landing;
  }
}

/* ---------- Igisoro: scoop, sow seed by seed, sweep captures ---------- */

export type SowKind = "pickup" | "sow" | "capture";
export interface SowStep {
  kind: SowKind;
  /** pit centre, local frame */
  u: number;
  v: number;
  /** seeds in the hand after this step */
  seeds: number;
  /** the board's base step time at the current speed (SOW_MS × animScale) */
  stepMs: number;
}

/** Duration of the hand's motion for a step (matches the old CSS grab: 1.5 × the step for scoops / sweeps). */
export const sowStepMs = (s: Pick<SowStep, "kind" | "stepMs">) => (s.kind === "sow" ? s.stepMs : s.kind === "pickup" ? 1.5 * s.stepMs : 1.6 * s.stepMs);

/**
 * The sowing hand follows the engine's event replay (useSowAnimation) step by step: it never decides anything, it
 * eases towards the pit each step names. Scoop = open, dip, close round the seeds; sow = a thumb roll that lets one
 * seed go into the pit under it; capture = a flat sweep across the pit, then close. `end()` withdraws to the side.
 */
export class SowHand {
  private k: number;
  private cur: SowStep | null = null;
  private stepAt = 0;
  private endAt: number | null = null;
  private pos = { u: 0.5, v: 1.4, h: 0.1 };
  private started = false;
  private poseBuf = new Float32Array(POSE_LEN);
  private home = { u: 0.62, v: 1.45 };

  constructor(k: number) {
    this.k = k;
  }

  step(t: number, s: SowStep) {
    if (!this.started) {
      this.started = true;
      this.pos = { u: s.u + 0.08, v: Math.max(1.25, s.v + 0.75), h: 0.1 };
    }
    this.cur = s;
    this.stepAt = t;
    this.endAt = null;
  }
  end(t: number) {
    if (this.endAt === null) this.endAt = t;
  }
  /** withdraw time after end() */
  get leaveMs() {
    return 420 * this.k;
  }

  /** Target for the current phase (anchor = pinch point between thumb and index). */
  private target(t: number, out: HandFrame) {
    const s = this.cur!;
    const D_ = sowStepMs(s);
    const x = Math.min(1, (t - this.stepAt) / Math.max(1, D_));
    let h = 0.045, du = 0, pose: Pose = POSES.hold;
    const P = this.poseBuf;
    if (s.kind === "pickup") {
      if (x < 0.45) {
        lerpPose(P, POSES.hold, POSES.cup, ease.out(x / 0.45));
        h = 0.045;
      } else if (x < 0.7) {
        lerpPose(P, POSES.cup, POSES.cup, 1);
        h = 0.045 - 0.032 * ease.inOut((x - 0.45) / 0.25);
      } else {
        lerpPose(P, POSES.cup, POSES.hold, ease.inOut((x - 0.7) / 0.3));
        h = 0.013 + 0.034 * ease.out((x - 0.7) / 0.3);
      }
      pose = P;
    } else if (s.kind === "sow") {
      // the thumb rolls one seed off the index and the fingers part briefly
      const pulse = x > 0.25 && x < 0.85 ? Math.sin(((x - 0.25) / 0.6) * Math.PI) : 0;
      lerpPose(P, POSES.hold, POSES.release, pulse);
      pose = P;
      h = 0.042 - 0.008 * pulse;
    } else {
      if (x < 0.3) {
        lerpPose(P, POSES.hold, POSES.sweep, ease.out(x / 0.3));
        h = 0.04 - 0.02 * ease.inOut(x / 0.3);
      } else if (x < 0.7) {
        lerpPose(P, POSES.sweep, POSES.sweep, 1);
        h = 0.016;
        du = Math.sin(((x - 0.3) / 0.4) * Math.PI) * 0.035;
      } else {
        lerpPose(P, POSES.sweep, POSES.hold, ease.inOut((x - 0.7) / 0.3));
        h = 0.016 + 0.028 * ease.out((x - 0.7) / 0.3);
      }
      pose = P;
    }
    out.pose.set(pose);
    return { u: s.u + du, v: s.v, h };
  }

  /** Advances the hand to time t (dt = ms since the last frame); returns false once it has left. */
  sample(t: number, dt: number, out: HandFrame): boolean {
    out.die.visible = false;
    out.anchor = "pinch";
    if (!this.cur) {
      out.visible = false;
      return true;
    }
    let tgt: { u: number; v: number; h: number };
    if (this.endAt !== null && t >= this.endAt) {
      const x = Math.min(1, (t - this.endAt) / Math.max(1, this.leaveMs));
      lerpPose(out.pose, POSES.hold, POSES.relaxed, ease.inOut(x));
      tgt = { u: this.home.u, v: this.home.v, h: 0.12 };
      out.seeds = 0;
      if (x >= 1) {
        out.visible = false;
        return false;
      }
    } else {
      tgt = this.target(t, out);
      out.seeds = this.cur.seeds;
    }
    // critically damped chase: smooth, never overshoots, keeps up with fast relay chains
    const tau = Math.min(110, Math.max(22, this.cur.stepMs * 0.22));
    const a = 1 - Math.exp(-Math.max(0, dt) / tau);
    this.pos.u += (tgt.u - this.pos.u) * a;
    this.pos.v += (tgt.v - this.pos.v) * a;
    this.pos.h += (tgt.h - this.pos.h) * Math.min(1, a * 1.6);
    out.u = this.pos.u;
    out.v = this.pos.v;
    out.h = this.pos.h;
    out.pitch = 24 * D;
    out.roll = -6 * D;
    out.yaw = 0;
    out.visible = true;
    return true;
  }
}
