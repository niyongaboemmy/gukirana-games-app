import { BOXING_CLIPS, clipTime, clipTravel, compensateTravel, sampleClip, type BoxingClipName, type ClipEvent } from "./clips";
import { copyPose, GUARD, lerpPose, mirrorPose, newPose, P, type Pose } from "./pose";
import { addRingLife, type RingLife } from "./life";

/**
 * Boxing motion controller (P3-FGT-02): the one object the engine / hall drives per fighter. Commands are stamped with
 * the shared match clock (seconds), so every screen that receives the same commands shows the same pose at the same
 * time (no randomness, no frame-rate dependence):
 *
 *   motion.play({ clip: "jab", start: serverT, mirrored: southpaw, intensity: 0.8 });
 *   motion.sample(now) → Pose            (the rig layer calls this every animation step)
 *   motion.impactTime()                  (when the glove lands: schedule the hit sound / the other's reaction)
 *   motion.events(t0, t1)                (impacts, foot plants, the knockdown landing, count beats crossed)
 *
 * A new command blends from the pose that was showing at its start time (snapshot, 0.1 s; hit reactions 0.05 s), so
 * a punch interrupted by a hit never pops. A one-shot that ends hands over to its `then` clip (guardIdle by default;
 * knockdown → count, victory → victoryHold …) at its end time; loops run until the next command.
 */

export interface BoxingCommand {
  clip: BoxingClipName;
  /** clock time the clip starts (s) */
  start: number;
  /** southpaw (right hand / right foot lead) */
  mirrored?: boolean;
  /** 0…1: punch commitment / reaction size (default 1) */
  intensity?: number;
  /** playback rate (default 1) */
  speed?: number;
  /** extra seconds to stay in the clip's hold window (blocks, raised arms) */
  hold?: number;
  /** cross-fade time from the previous pose (s; default 0.1, reactions 0.05) */
  blend?: number;
  /** punches: distance to the target (m forward of the root); the glove travels there (0 = the clip's own reach) */
  reach?: number;
  /**
   * punches (P3-FGT-13, contact IK): the point the glove lands on at impact, in the root frame of the puncher (reference
   * body units, orthodox authoring frame): the other's face / headgear, stomach / ribs, or gloves when they guard. The
   * glove's path is bent onto it progressively (none at the guard, all of it at impact), so it neither punches air
   * nor passes through the target. Captured when the punch starts: a target that slips or ducks away is missed.
   */
  aim?: readonly [number, number, number];
}

interface Active {
  cmd: Required<Omit<BoxingCommand, "blend" | "aim">> & { blend: number; aim?: readonly [number, number, number] };
  /** the pose showing when this command started (blend source) */
  from: Pose | null;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const _tr: [number, number, number] = [0, 0, 0];

/** reactions scale with intensity (a light tap barely moves the head); punches only in commitment (body turn) */
const SCALED_REACTION = new Set<BoxingClipName>(["hitHeadLight", "hitHeadHeavy", "hitBodyLight", "hitBodyHeavy", "hitHookFromLead", "hitHookFromRear", "hitUppercut", "hitStraight", "hitBodyLead", "hitBodyRear", "blockImpact", "parried"]);
const COMMIT = [P.yaw, P.chest, P.lean, P.bend, P.hx, P.hz, P.fLheel, P.fRheel, P.effort];

export class BoxingMotion {
  private cur: Active;
  private readonly tmp = newPose();
  private readonly tmp2 = newPose();
  private readonly out = newPose();
  /** the default loop when nothing else is playing */
  readonly base: BoxingClipName;

  constructor(opts: { base?: BoxingClipName; mirrored?: boolean; start?: number } = {}) {
    this.base = opts.base ?? "guardIdle";
    this.cur = { cmd: full({ clip: this.base, start: opts.start ?? 0, mirrored: opts.mirrored }), from: null };
  }

  /** the command playing (after any automatic hand-over at `t`) */
  current(t?: number): Readonly<BoxingCommand> {
    if (t !== undefined) this.advance(t);
    return this.cur.cmd;
  }

  /** Start a clip (its `start` may be slightly in the past: network latency is caught up). */
  play(cmd: BoxingCommand) {
    const c = full(cmd);
    // blend source: what was showing at the new command's start (deterministic: computed at that time, not now)
    const from = copyPose(this.sample(c.start), newPose());
    this.cur = { cmd: c, from };
  }

  /** Mirror the whole stance (switching to southpaw / back) from `t` on, blending over 0.3 s. */
  setMirrored(mirrored: boolean, t: number) {
    if (this.cur.cmd.mirrored === mirrored) return;
    this.play({ ...this.cur.cmd, clip: this.base, start: t, mirrored, blend: 0.3 });
  }

  /** the end time of the current clip (Infinity for loops) */
  endTime(): number {
    const c = this.cur.cmd;
    const info = BOXING_CLIPS[c.clip];
    return info.loop ? Infinity : c.start + (info.duration + c.hold) / c.speed;
  }

  /** clock time the current clip's glove lands / defence peaks (null when it has none) */
  impactTime(): number | null {
    const c = this.cur.cmd;
    const imp = BOXING_CLIPS[c.clip].impact;
    if (imp === null) return null;
    return c.start + imp / c.speed;
  }

  /** a one-shot that has ended hands over to its `then` clip at its end time */
  private advance(t: number) {
    for (let guard = 0; guard < 4; guard++) {
      const c = this.cur.cmd;
      const info = BOXING_CLIPS[c.clip];
      if (info.loop) return;
      const end = c.start + (info.duration + c.hold) / c.speed;
      if (t < end) return;
      const next = info.then ?? this.base;
      // the one-shot ends exactly on its last key = the next clip's first key: no blend needed
      this.cur = { cmd: full({ clip: next, start: end, mirrored: c.mirrored, intensity: 1 }), from: null };
    }
  }

  /**
   * Face moods on top of the clips' own expressions (P3-FGT-05: wince after a hit, fatigue breathing, dazed eyes,
   * relief, joy, disappointment). Each channel takes max(clip, mood); 0 = the clip alone.
   */
  readonly mood = { focus: 0, wince: 0, smile: 0, jaw: 0, eyes: 0 };
  setMood(m: Partial<BoxingMotion["mood"]>) {
    Object.assign(this.mood, m);
  }

  /**
   * Ring life (P3-FGT-07, life.ts): the bounce, weight shifts, pawing and feints added over the stance clips while a
   * round is live (null = the clips alone). Set it every frame from the meters; it never changes which clip plays.
   */
  private life: RingLife | null = null;
  setLife(l: RingLife | null) {
    this.life = l;
  }

  /** The pose at clock time `t` (owned by the controller: copy it to keep it). */
  sample(t: number): Pose {
    this.advance(t);
    const { cmd, from } = this.cur;
    this.raw(cmd, t, this.tmp);
    if (from && cmd.blend > 0) {
      const w = smooth((t - cmd.start) / cmd.blend);
      if (w < 1) {
        lerpPose(from, this.tmp, w, this.out);
        return this.withMood(this.out);
      }
    }
    this.out.set(this.tmp);
    return this.withMood(this.out);
  }

  private withMood(out: Pose): Pose {
    const m = this.mood;
    if (m.focus) out[P.focus] = Math.max(out[P.focus]!, m.focus);
    if (m.wince) out[P.wince] = Math.max(out[P.wince]!, m.wince);
    if (m.smile) out[P.smile] = Math.max(out[P.smile]!, m.smile);
    if (m.jaw) out[P.jaw] = Math.max(out[P.jaw]!, m.jaw);
    if (m.eyes) out[P.eyes] = Math.max(out[P.eyes]!, m.eyes);
    return out;
  }

  /** a command's own pose at `t` (orthodox authoring → intensity → travel compensation → mirror) */
  private raw(cmd: Active["cmd"], t: number, out: Pose): Pose {
    const local = (t - cmd.start) * cmd.speed;
    const ct = clipTime(cmd.clip, local, cmd.hold);
    sampleClip(cmd.clip, ct, out);
    const k = cmd.intensity;
    if (k < 0.999) {
      const kind = BOXING_CLIPS[cmd.clip].kind;
      if (SCALED_REACTION.has(cmd.clip)) {
        lerpPose(GUARD, out, Math.max(0.25, k), this.tmp2);
        // (feet stay authored: a scaled reaction must still plant where it travels)
        this.tmp2[P.fLx] = out[P.fLx]!;
        this.tmp2[P.fLz] = out[P.fLz]!;
        this.tmp2[P.fRx] = out[P.fRx]!;
        this.tmp2[P.fRz] = out[P.fRz]!;
        out.set(this.tmp2);
      } else if (kind === "punch") {
        const c = 0.55 + 0.45 * k;
        for (const i of COMMIT) out[i] = GUARD[i]! + (out[i]! - GUARD[i]!) * c;
      }
    }
    if (BOXING_CLIPS[cmd.clip].travel) compensateTravel(out, clipTravel(cmd.clip, ct, false, _tr));
    if (cmd.aim) fitAim(cmd.clip, out, cmd.aim);
    else if (cmd.reach) fitReach(cmd.clip, out, cmd.reach);
    if (this.life) {
      const [w, hands] = lifeWeight(cmd.clip, this.life);
      // eased in from the clip's start: a one-shot ends exactly in the guard, the life grows from there (no pop)
      if (w > 0) addRingLife(out, t, this.life, w * smooth((t - cmd.start) / 0.25), hands);
    }
    if (cmd.mirrored) mirrorPose(out);
    return out;
  }

  /** Root travel of the current clip at `t` ([x, z, yaw] in its start frame, mirrored as played). */
  travel(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    this.advance(t);
    const c = this.cur.cmd;
    return clipTravel(c.clip, clipTime(c.clip, (t - c.start) * c.speed, c.hold), c.mirrored, out);
  }

  /**
   * Events crossed in (t0, t1] by the current clip (and the clips it hands over to): impacts, foot plants, the
   * knockdown landing, the referee's count beats. Times are clock times.
   */
  events(t0: number, t1: number): { t: number; kind: ClipEvent["kind"]; clip: BoxingClipName }[] {
    const out: { t: number; kind: ClipEvent["kind"]; clip: BoxingClipName }[] = [];
    if (t1 <= t0) return out;
    this.advance(t0);
    let c: Active["cmd"] = this.cur.cmd;
    for (let n = 0; n < 4; n++) {
      const info = BOXING_CLIPS[c.clip];
      const end = info.loop ? Infinity : c.start + (info.duration + c.hold) / c.speed;
      for (const e of info.events) {
        if (info.loop) {
          const cyc = info.duration / c.speed;
          const first = Math.floor((t0 - c.start - e.t / c.speed) / cyc) + 1;
          for (let k = Math.max(0, first); ; k++) {
            const at = c.start + e.t / c.speed + k * cyc;
            if (at > t1) break;
            if (at > t0) out.push({ t: at, kind: e.kind, clip: c.clip });
          }
        } else {
          const hold = info.hold && e.t > info.hold[0] ? c.hold : 0;
          const at = c.start + (e.t + hold) / c.speed;
          if (at > t0 && at <= t1) out.push({ t: at, kind: e.kind, clip: c.clip });
        }
      }
      if (end >= t1) break;
      c = full({ clip: info.then ?? this.base, start: end, mirrored: c.mirrored });
    }
    return out.sort((a, b) => a.t - b.t);
  }
}

/** how much ring life a clip takes: [body, gloves] (stance 1, footwork half, the held guard bounces with the gloves home) */
function lifeWeight(clip: BoxingClipName, l: RingLife): [number, number] {
  const kind = BOXING_CLIPS[clip].kind;
  if (l.official) return clip === "refIdle" ? [1, 0] : [0, 0];
  if (kind === "stance") return [1, clip === "guard" ? 0.5 : 1];
  if (kind === "footwork") return [0.5, 0.4];
  if (clip === "blockHigh") return [0.6, 0];
  return [0, 0];
}

/**
 * Reach fit (P3-FGT-07): a punch's glove travels to where the target really is. The clips are authored for one range
 * (`reach`, m forward of the root); `want` is the distance to the target this time. The striking glove's travel away
 * from the guard is scaled to land there (0.7…1.25 ×), and a reach past the clip's own (a whiff, a long jab) also
 * carries the body after it (more lean, hips forward, rear heel up): misses over-extend.
 */
export function reachScale(clip: BoxingClipName, want: number): number {
  const info = BOXING_CLIPS[clip];
  if (info.kind !== "punch" || !info.reach) return 1;
  return Math.min(1.25, Math.max(0.7, want / info.reach));
}
function fitReach(clip: BoxingClipName, out: Pose, want: number) {
  const info = BOXING_CLIPS[clip];
  const k = reachScale(clip, want);
  if (k === 1) return;
  const [x, y, z] = info.hand === "rear" ? [P.rx, P.ry, P.rz] : [P.lx, P.ly, P.lz];
  out[x] = GUARD[x]! + (out[x]! - GUARD[x]!) * Math.min(k, 1.05);
  out[y] = GUARD[y]! + (out[y]! - GUARD[y]!) * Math.min(k, 1.05);
  out[z] = GUARD[z]! + (out[z]! - GUARD[z]!) * k;
  if (k > 1) {
    const over = k - 1;
    const ext = Math.max(0, (out[z]! - GUARD[z]!) / Math.max(0.05, (info.reach ?? 0.7) - GUARD[z]!));
    out[P.lean] = out[P.lean]! + 0.45 * over * ext;
    out[P.hz] = out[P.hz]! + 0.25 * over * ext;
    out[P.fRheel] = out[P.fRheel]! + 0.8 * over * ext;
  }
}

/** the striking glove at the clip's impact (cached per clip) */
const impactGlove = new Map<BoxingClipName, [number, number, number]>();
function gloveAtImpact(clip: BoxingClipName): [number, number, number] {
  let g = impactGlove.get(clip);
  if (!g) {
    const info = BOXING_CLIPS[clip];
    const p = sampleClip(clip, info.impact ?? 0);
    const i = info.hand === "rear" ? P.rx : P.lx;
    g = [p[i]!, p[i + 1]!, p[i + 2]!];
    impactGlove.set(clip, g);
  }
  return g;
}
/**
 * Contact IK (P3-FGT-13): bend the striking glove's path so it arrives at `aim` at impact. The share of the correction
 * follows how far the glove has travelled from the guard towards its impact position (0 in the guard, 1 at impact,
 * back to 0 in the recovery), so the punch keeps its shape and its timing. A target past the clip's reach also carries
 * the body after it (an over-extended miss leans in); the correction is capped at 40 cm.
 */
export function fitAim(clip: BoxingClipName, out: Pose, aim: readonly [number, number, number]) {
  const info = BOXING_CLIPS[clip];
  if (info.kind !== "punch") return;
  const i = info.hand === "rear" ? P.rx : P.lx;
  const imp = gloveAtImpact(clip);
  const g0 = GUARD[i]!,
    g1 = GUARD[i + 1]!,
    g2 = GUARD[i + 2]!;
  const tx = imp[0] - g0,
    ty = imp[1] - g1,
    tz = imp[2] - g2;
  const L2 = tx * tx + ty * ty + tz * tz;
  if (L2 < 1e-6) return;
  const k = Math.min(1, Math.max(0, ((out[i]! - g0) * tx + (out[i + 1]! - g1) * ty + (out[i + 2]! - g2) * tz) / L2));
  let ox = aim[0] - imp[0],
    oy = aim[1] - imp[1],
    oz = aim[2] - imp[2];
  const ol = Math.hypot(ox, oy, oz);
  if (ol > 0.4) {
    ox *= 0.4 / ol;
    oy *= 0.4 / ol;
    oz *= 0.4 / ol;
  }
  out[i] = out[i]! + ox * k;
  out[i + 1] = out[i + 1]! + oy * k;
  out[i + 2] = out[i + 2]! + oz * k;
  // P3-FGT-16 keyed arms: the contact point and how far along the punch is (arm-fk.ts aimArm bends the keyed arm)
  out[P.aimK] = k;
  out[P.ax] = imp[0] + ox;
  out[P.ay] = imp[1] + oy;
  out[P.az] = imp[2] + oz;
  out[P.aimRear] = i === P.rx ? 1 : 0;
  // a lower target takes the body down with it (knees and waist), a farther one leans in after it
  if (oy < 0) {
    out[P.hy] = out[P.hy]! + oy * 0.35 * k;
    out[P.lean] = out[P.lean]! - oy * 0.4 * k;
  }
  if (oz > 0) {
    out[P.lean] = out[P.lean]! + 0.5 * oz * k;
    out[P.hz] = out[P.hz]! + 0.3 * oz * k;
    out[i === P.rx ? P.fRheel : P.fLheel] = out[i === P.rx ? P.fRheel : P.fLheel]! + 0.8 * oz * k;
  }
}

function full(cmd: BoxingCommand): Active["cmd"] {
  const kind = BOXING_CLIPS[cmd.clip].kind;
  return {
    ...(cmd.aim ? { aim: cmd.aim } : {}),
    reach: cmd.reach ?? 0,
    clip: cmd.clip,
    start: cmd.start,
    mirrored: !!cmd.mirrored,
    intensity: Math.min(1, Math.max(0, cmd.intensity ?? 1)),
    speed: Math.max(0.1, cmd.speed ?? 1),
    hold: Math.max(0, cmd.hold ?? 0),
    blend: cmd.blend ?? (kind === "reaction" ? 0.05 : 0.1),
  };
}

/** Pure one-shot form: the pose of `cmd` at `t` without blending (for previews, tests, thumbnails). */
export function boxingPose(cmd: BoxingCommand, t: number, out: Pose = newPose()): Pose {
  const m = new BoxingMotion({ base: BOXING_CLIPS[cmd.clip].kind === "referee" ? "refIdle" : "guardIdle" });
  m.play({ ...cmd, blend: 0 });
  out.set(m.sample(t));
  return out;
}
