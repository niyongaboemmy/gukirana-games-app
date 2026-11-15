import { TICK_HZ, type FightEvent, type FightPhase, type FighterView, type Punch } from "@gukirana/contracts";
import { BODY, EXHAUSTED_STAMINA, GUARD_WINDUP, MOVE, PUNCH_SPECS, TIRED_STAMINA, TIRED_WINDUP } from "@gukirana/boxing";
import { BOXING_CLIPS, type BoxingClipName } from "@/world/human/boxing/clips";

/**
 * Engine state → believable boxing motion (P3-FGT-05). Pure functions, the same on every screen:
 *  - the engine's act / actT / stage pick the motion library clip, and the clip is TIME-WARPED to the engine's frame
 *    data so the glove lands exactly when the engine's active window opens (a jab's 6–8 tick windup, a hook's 11–15);
 *  - hit reactions scale with the punch's power (a jab barely turns the head, a hook rocks, a low balance staggers);
 *  - ceremony: touching gloves, the stool between rounds, the knee during the count, getting up, the winner's raised
 *    hand, the loser's nod; clinches tie up until the referee breaks them;
 *  - the face: focus in the guard, effort on punches (from the clips), plus moods from the meters — wince after a hit,
 *    fatigue (mouth breathing) when tired, dazed eyes on the knee, relief at the stool, joy / disappointment at the end.
 * No randomness: variety comes from the engine's own numbers (tick, corner).
 */

export interface PoseCmd {
  clip: BoxingClipName;
  /** seconds into the clip (at speed 1 = engine time) */
  offset: number;
  speed: number;
  intensity: number;
  hold: number;
  /** punches: distance to the target (m forward of the root): the glove travels there (motion reach fit) */
  reach?: number;
  /** a new instance of the same clip (restart even if the clip name is unchanged) */
  key: string;
  /** punches: contact IK target (motion.ts fitAim; the renderer fills it from the other fighter's body) */
  aim?: readonly [number, number, number];
}

export interface PresentCtx {
  /** seconds since this fighter's act / the phase last changed (renderer clock; for acts the engine doesn't time) */
  actSince: number;
  phaseSince: number;
  /** the two are tied up (close distance, no punches) */
  clinch: boolean;
  /** the gap on the canvas (m, ringLayout): punches reach the target at it */
  gap?: number;
  /** the snapshot tick (instance keys) */
  tick: number;
  /** engine v2 footwork: the way this boxer is moving relative to where he faces (null = planted) and how fast (m/s) */
  moveDir?: "f" | "b" | "l" | "r" | null;
  moveSpeed?: number;
}

/** engine v2 names the hand: hook = lead hook, rhook = rear hook, uppercut = rear uppercut; body shots dig low */
const punchClip = (p: Punch, _tick: number, body = false): BoxingClipName => {
  void _tick;
  if (body) return p === "jab" ? "jab" : p === "hook" ? "leadBody" : p === "uppercut" ? "rearUppercut" : "rearBody";
  return p === "jab" ? "jab" : p === "cross" ? "cross" : p === "hook" ? "leadHook" : p === "rhook" ? "rearHook" : "rearUppercut";
};

/** the windup (ticks) the engine gave this punch (same formula as the engine's startAct) */
export const windOf = (f: Pick<FighterView, "act" | "guard" | "stamina" | "body">, guardAtStart = f.guard): number => {
  const spec = PUNCH_SPECS[f.act as Punch];
  if (!spec) return 0;
  const tired = f.stamina < EXHAUSTED_STAMINA ? 2 * TIRED_WINDUP : f.stamina < TIRED_STAMINA ? TIRED_WINDUP : 0;
  return spec.windup + (guardAtStart ? GUARD_WINDUP : 0) + tired + (f.body ? BODY.windup : 0);
};

/** clip speed so that the clip's impact lands at engine tick `atTick` (or its whole length fits `ticks`) */
export function warp(clip: BoxingClipName, ticks: number, toImpact: boolean): number {
  const info = BOXING_CLIPS[clip];
  const secs = Math.max(1, ticks) / TICK_HZ;
  const src = toImpact && info.impact !== null ? info.impact : info.duration;
  return Math.min(3.5, Math.max(0.35, src / secs));
}

const cmd = (clip: BoxingClipName, offset: number, key: string, o: Partial<Pick<PoseCmd, "speed" | "intensity" | "hold" | "reach">> = {}): PoseCmd => ({
  clip,
  offset,
  key,
  speed: o.speed ?? 1,
  intensity: o.intensity ?? 1,
  hold: o.hold ?? 0,
  ...(o.reach ? { reach: o.reach } : {}),
});

/** the motion for one fighter right now */
export function presentFighter(f: FighterView, phase: FightPhase, ctx: PresentCtx, won: boolean | null = null): PoseCmd {
  const engineT = f.actT / TICK_HZ;
  const inst = `${f.act}@${ctx.tick - f.actT}`;
  if (phase === "rest") return ctx.actSince < 0.9 ? cmd("cornerSit", ctx.phaseSince, "sit") : cmd("cornerRest", ctx.phaseSince, "rest");
  if (phase === "intro") return ctx.phaseSince < 1.3 ? cmd("touchGloves", ctx.phaseSince, "touch") : cmd("guardIdle", 0, "guard");
  if (phase === "over") {
    if (won === true || f.act === "celebrate") return ctx.phaseSince < 2.4 ? cmd("victory", ctx.phaseSince, "victory") : cmd("winnerRaised", ctx.phaseSince - 2.4, "raised");
    if (won === false || f.act === "dejected") return cmd("defeat", ctx.phaseSince, "defeat");
    return cmd("guard", 0, "guardLow");
  }
  if (f.act === "down") return cmd("knockdown", ctx.actSince, `down@${ctx.tick - Math.round(ctx.actSince * TICK_HZ)}`);
  if (phase === "knockdown") return cmd("guard", 0, "neutral");
  if (f.act === "rising") return cmd("getUp", engineT, inst, { speed: warp("getUp", MOVE.rising, false) });
  const p = f.act as Punch;
  if (PUNCH_SPECS[p]) {
    const clip = punchClip(p, ctx.tick - f.actT, !!f.body);
    const tired = f.stamina < TIRED_STAMINA;
    return cmd(clip, engineT, inst, { speed: warp(clip, windOf(f), true), intensity: tired ? 0.7 : 1, reach: ctx.gap ? ctx.gap - TARGET_FWD : undefined });
  }
  switch (f.act) {
    case "slipL":
    case "slipR": {
      const clip = f.act === "slipL" ? "slipLeft" : "slipRight";
      return cmd(clip, engineT, inst, { speed: warp(clip, MOVE.slip.ticks, false) });
    }
    case "stepIn":
    case "stepOut": {
      const clip = f.act === "stepIn" ? "stepForward" : "stepBack";
      return cmd(clip, engineT, inst, { speed: warp(clip, MOVE.step.ticks, false) });
    }
    case "blockHit":
      return cmd("blockHigh", engineT, inst, { speed: 1.4 });
    case "parry":
      // a short, sharp hand-off of the straight
      return cmd("blockHigh", engineT, inst, { speed: 2.2, intensity: 0.85 });
    case "duck":
      return cmd("duck", engineT, inst, { speed: warp("duck", MOVE.duck.ticks, false) });
    case "pivotL":
    case "pivotR": {
      const clip = f.act === "pivotL" ? "stepLeft" : "stepRight";
      return cmd(clip, engineT, inst, { speed: warp(clip, MOVE.pivot.ticks, false) });
    }
    case "clinch":
      return cmd("clinch", ctx.actSince, "clinch");
    case "staggered":
      // the hit reaction itself is layered from the hit event (reactionFor); the body stays in a loose guard
      return f.composure < 300 ? cmd("stagger", engineT, inst, { intensity: 0.9 }) : cmd("guard", 0, "guardLow");
    default:
      break;
  }
  if (ctx.clinch && phase === "round") return cmd("clinch", ctx.actSince, "clinch");
  // footwork (engine v2): real steps in the direction of travel — the lead foot leads, the rear foot follows
  if (ctx.moveDir && (ctx.moveSpeed ?? 0) > 0.22) {
    const clip: BoxingClipName = ctx.moveDir === "f" ? "stepForward" : ctx.moveDir === "b" ? "stepBack" : ctx.moveDir === "l" ? "stepLeft" : "stepRight";
    const len = BOXING_CLIPS[clip].duration;
    // one step cycle per ~0.32 m travelled at a boxer's shuffle
    const speed = Math.min(2.2, Math.max(0.7, ((ctx.moveSpeed ?? 0) / 0.32) * len));
    return cmd(clip, ctx.actSince % Math.max(0.1, len / speed), `${clip}:walk`, { speed, intensity: f.guard ? 0.9 : 1 });
  }
  // idle: a tight high guard while the guard is held, the bouncing stance otherwise (gloves lower when exhausted)
  if (f.guard) return cmd("blockHigh", 0.3, "guardHeld", { hold: 600 });
  if (f.stamina < 200) return cmd("guard", 0, "guardTired");
  return cmd("guardIdle", 0, "guard");
}

/**
 * The reaction on the target of a hit (P3-FGT-13, docs/FIGHT-REALISM-V3.md §4): where it lands and which way the punch
 * travels decide the clip, the punch's weight the size.
 *  - head: a straight snaps the head straight back; a lead hook (the attacker's lead hand, from the target's right)
 *    turns it to the target's left, a rear hook to the right; an uppercut snaps the chin up. A heavy straight (a
 *    counter, or the balance low) rocks the fighter back a step.
 *  - body: a straight / uppercut folds the torso over the stomach (the guard drops, a breath out); a lead hook lands on
 *    the right side (the liver) and folds to the right, a rear hook on the left side.
 *  - partial (through the guard / smothered): the same direction, a third of the size.
 * Both fighters are orthodox in the motion library (a southpaw mirrors the sides).
 */
export function reactionFor(e: Extract<FightEvent, { k: "hit" }>, composureAfter: number, southpawAttacker = false): { clip: BoxingClipName; intensity: number } {
  const power = e.punch === "jab" ? 0.5 : e.punch === "cross" || e.punch === "hook" ? 0.78 : 1;
  const partial = e.combo === 0;
  const body = !!e.body;
  const lead = e.punch === "hook" ? !southpawAttacker : e.punch === "rhook" ? southpawAttacker : null;
  let clip: BoxingClipName;
  if (body) clip = lead === null ? (power >= 0.78 && !partial ? "hitBodyHeavy" : "hitBodyLight") : lead ? "hitBodyLead" : "hitBodyRear";
  else if (e.punch === "uppercut") clip = "hitUppercut";
  else if (lead !== null) clip = lead ? "hitHookFromLead" : "hitHookFromRear";
  else clip = !partial && (e.counter || composureAfter < 300) && e.punch === "cross" ? "hitHeadHeavy" : "hitStraight";
  const shaky = composureAfter < 350 ? 1.15 : 1;
  const counter = e.counter ? 1.12 : 1;
  return { clip, intensity: Math.min(1, (partial ? 0.34 : power) * shaky * counter) };
}

/** the defender's response to a punch landing on the guard: the gloves driven back (head) / the elbows clamped (body) */
export function blockReaction(e: Extract<FightEvent, { k: "block" }>): { clip: BoxingClipName; intensity: number } {
  const power = e.punch === "jab" ? 0.45 : e.punch === "cross" || e.punch === "hook" ? 0.75 : 1;
  return { clip: e.body ? "blockLow" : "blockImpact", intensity: power };
}

/** face moods on top of the clips' own expressions (0..1 each) */
export interface Mood {
  wince: number;
  jaw: number;
  eyes: number;
  smile: number;
  focus: number;
}
export function moodOf(f: FighterView, phase: FightPhase, sinceHit: number, won: boolean | null): Mood {
  const tired = f.stamina < 350 ? (350 - f.stamina) / 350 : 0;
  const m: Mood = { wince: 0, jaw: tired * 0.75, eyes: 0, smile: 0, focus: phase === "round" ? 0.6 : 0.2 };
  if (sinceHit < 0.45) m.wince = 1 - sinceHit / 0.45;
  if (f.composure < 300 && phase === "round") m.eyes = 0.2;
  if (f.act === "down") {
    m.eyes = 0.55;
    m.jaw = 0.5;
  }
  if (phase === "rest") {
    m.jaw = Math.max(m.jaw, 0.55); // breathing hard on the stool
    m.smile = f.knockdowns === 0 ? 0.18 : 0; // relief
  }
  if (phase === "over") {
    if (won === true) m.smile = 1;
    if (won === false) {
      m.eyes = 0.3; // lids lowered: disappointment, then the respectful nod (clip)
      m.focus = 0;
    }
  }
  return m;
}

/** camera trauma a fight event adds (big moments only) */
export function shakeFor(e: FightEvent): number {
  if (e.k === "knockdown") return 0.9;
  if (e.k === "hit" && (e.punch === "hook" || e.punch === "rhook" || e.punch === "uppercut") && e.points >= 3) return 0.5;
  if (e.k === "hit" && e.punch === "cross" && e.counter) return 0.3;
  return 0;
}

/**
 * Feel of a connection (P3-FGT-07), presentation only: `stop` = hit-stop seconds (the ring's motion clock holds for a
 * few frames at the connection, then catches up), `kick` = a small camera punch towards the action (m). Scaled by the
 * punch's weight; my own landed punches hit a little harder on screen. Blocks give a tiny stop, whiffs nothing.
 */
export function hitFeel(e: FightEvent, mine: boolean): { stop: number; kick: number } {
  if (e.k === "knockdown") return { stop: 0.12, kick: 0.09 };
  if (e.k === "block") return { stop: 0.025, kick: 0 };
  if (e.k !== "hit") return { stop: 0, kick: 0 };
  const w = e.punch === "jab" ? 0.4 : e.punch === "cross" ? 0.7 : 1;
  const partial = e.combo === 0 ? 0.4 : 1;
  const k = w * partial * (e.counter ? 1.2 : 1);
  return { stop: 0.035 + 0.05 * k, kick: (mine ? 0.05 : 0.03) * k };
}

/* ------------------------------------------------------------ ring layout (P3-FGT-07) ------------------------------------------------------------ */

/**
 * Engine distance (cm, centre to centre; DIST.min 70 … max 360) → the gap on the canvas (m, root to root). The engine's
 * reaches are game numbers (a jab lands from 190); on the canvas a jab lands at about an arm + a step (~1 m) and hooks /
 * uppercuts inside that. Piecewise linear through the punch reaches, so a punch that lands in the engine visibly
 * reaches its target (with the reach fit, motion.ts), and out of range they stand a real step or two apart.
 */
const GAP_KEYS: readonly (readonly [number, number])[] = [
  [70, 0.66],
  [110, 0.76], // v1 reaches (cm): uppercut 110, hook 130, jab 190
  [130, 0.82],
  [190, 0.98],
  [260, 1.42],
  [360, 2.1],
];
export function gapOf(dist: number): number {
  if (dist <= GAP_KEYS[0]![0]) return GAP_KEYS[0]![1];
  for (let i = 1; i < GAP_KEYS.length; i++) {
    const [d1, g1] = GAP_KEYS[i]!;
    const [d0, g0] = GAP_KEYS[i - 1]!;
    if (dist <= d1) return g0 + ((g1 - g0) * (dist - d0)) / (d1 - d0);
  }
  return GAP_KEYS[GAP_KEYS.length - 1]![1];
}
/** the target (chin / body) is this far forward of the other fighter's root (m): a punch reaches gap − this */
export const TARGET_FWD = 0.17;

export interface RingLayout {
  /** the pair's middle (m from the ring centre, world axes) */
  cx: number;
  cz: number;
  /** the pair axis angle (rad): red at −half along it, blue at +half */
  th: number;
  /** half the gap (m) */
  half: number;
}

/**
 * Where the pair stands (presentation only; the engine has no ring position): the gap from the distance, the axis
 * from the engine's orbit plus a slow circling (they keep turning round each other, changing direction), and the
 * pair's middle drifting round the ring (to the ropes, into a corner, back to the centre) — never past the ropes.
 * A pure function of the snapshot tick + the ring's seed: the same on every screen, no randomness.
 */
export function ringLayout(snap: { dist: number; orbit: number; tick: number }, ringHalf: number, seed: number): RingLayout {
  const t = snap.tick / TICK_HZ;
  const so = (seed % 997) / 997;
  const so2 = ((seed >>> 10) % 991) / 991;
  const half = Math.min(gapOf(snap.dist) / 2, ringHalf - 0.8);
  const spin = 1.1 * Math.sin(0.17 * t + so * 6.28) + 0.5 * Math.sin(0.061 * t + so2 * 6.28);
  const th = ((snap.orbit / 10) * Math.PI) / 180 + spin;
  // ropes at ~ringHalf − 0.3; a fighter keeps ~0.4 m off them
  const room = Math.max(0, ringHalf - 0.3 - 0.42 - half);
  const cx = room * Math.sin(0.083 * t + so * 6.28);
  const cz = room * 0.9 * Math.sin(0.061 * t + so2 * 6.28 + 1.1);
  return { cx, cz, th, half };
}

/** engine v2 mm → canvas metres (the engine's ring is 4.3 m inside the ropes; its reaches match a real arm + step) */
export const CANVAS_SCALE = 0.9 / 1000;
/**
 * Engine v2 centre-to-centre gap (mm) → the gap on the canvas (m, root to root), piecewise linear through the body line
 * and the punch reaches: bodies at BODY_SEP stand chest to chest without the torsos or guards passing into each other,
 * a punch that lands in the engine reaches its target with the motion reach fit, out of range they stand apart.
 */
const GAP_V2: readonly (readonly [number, number])[] = [
  [640, 0.64],
  [PUNCH_SPECS.uppercut.reach, 0.74],
  [PUNCH_SPECS.hook.reach, 0.8],
  [PUNCH_SPECS.jab.reach, 0.98],
  [1800, 1.55],
  [3600, 3.2],
];
export function canvasGapOf(mm: number): number {
  if (mm <= GAP_V2[0]![0]) return GAP_V2[0]![1];
  for (let i = 1; i < GAP_V2.length; i++) {
    const [d1, g1] = GAP_V2[i]!;
    const [d0, g0] = GAP_V2[i - 1]!;
    if (mm <= d1) return g0 + ((g1 - g0) * (mm - d0)) / (d1 - d0);
  }
  return GAP_V2.at(-1)![1];
}
/** ring-local engine axes → hall-local axes of a ring turned by rotY (inverse of clampInRing's rotation) */
export function ringToHall(x: number, z: number, rotY: number): { x: number; z: number } {
  const c = Math.cos(rotY);
  const sn = Math.sin(rotY);
  return { x: x * c + z * sn, z: -x * sn + z * c };
}
/**
 * Where the pair stands: engine v2 snapshots carry each boxer's real place on the canvas (free footwork, solid bodies,
 * the ropes) — the layout is exactly that. Older (v1) snapshots and the sparring loops of far rings use ringLayout.
 */
export function layoutOf(snap: { dist: number; orbit: number; tick: number; engine?: number; fighters: readonly { x?: number; z?: number }[] }, ringHalf: number, seed: number, rotY = 0): RingLayout {
  const [a0, b0] = snap.fighters;
  if (snap.engine === 2 && a0?.x !== undefined && b0?.x !== undefined) {
    const a = ringToHall(a0.x * CANVAS_SCALE, (a0.z ?? 0) * CANVAS_SCALE, rotY);
    const b = ringToHall(b0.x * CANVAS_SCALE, (b0.z ?? 0) * CANVAS_SCALE, rotY);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const mm = Math.hypot(b0.x - a0.x, (b0.z ?? 0) - (a0.z ?? 0));
    return { cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, th: Math.atan2(dz, dx), half: canvasGapOf(mm) / 2 };
  }
  return ringLayout(snap, ringHalf, seed);
}

/** a ring's presentation seed (FNV-1a of its id): the same on every screen */
export function ringSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** keep a ring-local point inside the ropes (square ring turned by rotY), `lim` m from the centre on each axis */
export function clampInRing(x: number, z: number, rotY: number, lim: number): { x: number; z: number } {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const lx = Math.max(-lim, Math.min(lim, x * c - z * s));
  const lz = Math.max(-lim, Math.min(lim, x * s + z * c));
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/** where the referee stands (ring-local metres; +x along the pair axis, +z its perpendicular) */
export function refereeSpot(phase: FightPhase, ctx: { dist: number; down: 0 | 1 | -1; winner: 0 | 1 | null; breaking: boolean; half: number; t?: number; gap?: number }): { x: number; z: number; clip: BoxingClipName; face: number } {
  const half = ctx.gap !== undefined ? ctx.gap / 2 : Math.min(gapOf(ctx.dist) / 2, ctx.half - 0.8);
  if (phase === "knockdown" && ctx.down !== -1) {
    const s = ctx.down === 0 ? -1 : 1;
    return { x: s * (half - 0.7), z: 0.75, clip: "refCount", face: s };
  }
  if (phase === "over" && ctx.winner !== null) {
    const s = ctx.winner === 0 ? -1 : 1;
    return { x: s * half - s * 0.0, z: 0.62, clip: "refRaise", face: 0 };
  }
  if (ctx.breaking) return { x: 0, z: 0.35, clip: "refBreak", face: 0 };
  if (phase === "intro" || phase === "countdown") return { x: 0, z: 0.9, clip: "refStart", face: 0 };
  if (phase === "rest") return { x: 0, z: ctx.half - 0.9, clip: "refIdle", face: 0 };
  // the round: the "V" with both boxers in view (never behind one, never between them), a little closer in when they
  // are close, and always moving with the action (ref manuals: keep as much of each boxer's target in view as possible)
  const t = ctx.t ?? 0;
  const close = half < 0.5 ? 0.85 : 1;
  // the apex of the V: well off the pair line (seen in the gap between them, never hidden behind a boxer), drifting
  // from one side to the other now and then
  const side = Math.tanh(3 * Math.sin(0.07 * t + 0.6));
  // ~2 m off the pair line (inside the ropes) so his body never reads as touching a boxer from the oblique cameras
  const off = Math.min((1.95 + 0.15 * Math.sin(0.31 * t + 0.4)) * close, ctx.half - 0.6);
  return { x: 0.55 * side + 0.12 * Math.sin(0.71 * t + 1), z: off, clip: "refIdle", face: 0 };
}
