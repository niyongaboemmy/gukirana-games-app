import { TICK_HZ, type FightEvent, type FightPhase, type FighterView, type Punch } from "@gukirana/contracts";
import { GUARD_WINDUP, MOVE, PUNCH_SPECS, TIRED_STAMINA, TIRED_WINDUP } from "@gukirana/boxing";
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
  /** a new instance of the same clip (restart even if the clip name is unchanged) */
  key: string;
}

export interface PresentCtx {
  /** seconds since this fighter's act / the phase last changed (renderer clock; for acts the engine doesn't time) */
  actSince: number;
  phaseSince: number;
  /** the two are tied up (close distance, no punches) */
  clinch: boolean;
  /** the snapshot tick (instance keys) */
  tick: number;
}

const punchClip = (p: Punch, tick: number): BoxingClipName =>
  p === "jab" ? "jab" : p === "cross" ? "cross" : p === "hook" ? ((tick >> 4) % 3 === 2 ? "rearHook" : "leadHook") : (tick >> 4) % 3 === 2 ? "leadUppercut" : "rearUppercut";

/** the windup (ticks) the engine gave this punch (same formula as the engine's startAct) */
export const windOf = (f: Pick<FighterView, "act" | "guard" | "stamina">, guardAtStart = f.guard): number => {
  const spec = PUNCH_SPECS[f.act as Punch];
  if (!spec) return 0;
  return spec.windup + (guardAtStart ? GUARD_WINDUP : 0) + (f.stamina < TIRED_STAMINA ? TIRED_WINDUP : 0);
};

/** clip speed so that the clip's impact lands at engine tick `atTick` (or its whole length fits `ticks`) */
export function warp(clip: BoxingClipName, ticks: number, toImpact: boolean): number {
  const info = BOXING_CLIPS[clip];
  const secs = Math.max(1, ticks) / TICK_HZ;
  const src = toImpact && info.impact !== null ? info.impact : info.duration;
  return Math.min(3.5, Math.max(0.35, src / secs));
}

const cmd = (clip: BoxingClipName, offset: number, key: string, o: Partial<Pick<PoseCmd, "speed" | "intensity" | "hold">> = {}): PoseCmd => ({
  clip,
  offset,
  key,
  speed: o.speed ?? 1,
  intensity: o.intensity ?? 1,
  hold: o.hold ?? 0,
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
    const clip = punchClip(p, ctx.tick - f.actT);
    const tired = f.stamina < TIRED_STAMINA;
    return cmd(clip, engineT, inst, { speed: warp(clip, windOf(f), true), intensity: tired ? 0.7 : 1 });
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
    case "staggered":
      // the hit reaction itself is layered from the hit event (reactionFor); the body stays in a loose guard
      return f.composure < 300 ? cmd("stagger", engineT, inst, { intensity: 0.9 }) : cmd("guard", 0, "guardLow");
    default:
      break;
  }
  if (ctx.clinch && phase === "round") return cmd("clinch", ctx.actSince, "clinch");
  // idle: a tight high guard while the guard is held, the bouncing stance otherwise (gloves lower when exhausted)
  if (f.guard) return cmd("blockHigh", 0.3, "guardHeld", { hold: 600 });
  if (f.stamina < 200) return cmd("guard", 0, "guardTired");
  return cmd("guardIdle", 0, "guard");
}

/** a hit reaction on the target of a clean hit (power-scaled); partial uppercut hits through the guard are small */
export function reactionFor(e: Extract<FightEvent, { k: "hit" }>, composureAfter: number): { clip: BoxingClipName; intensity: number } {
  const power = e.punch === "jab" ? 0.45 : e.punch === "cross" ? 0.75 : 1;
  const partial = e.points <= 1 && e.punch === "uppercut";
  const body = e.punch === "hook" && (e.t & 1) === 1;
  const heavy = power >= 0.75 && !partial;
  const clip: BoxingClipName = body ? (heavy ? "hitBodyHeavy" : "hitBodyLight") : heavy ? "hitHeadHeavy" : "hitHeadLight";
  const shaky = composureAfter < 350 ? 1.15 : 1;
  return { clip, intensity: Math.min(1, (partial ? 0.35 : power) * shaky) };
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
  if (e.k === "hit" && (e.punch === "hook" || e.punch === "uppercut") && e.points >= 3) return 0.5;
  if (e.k === "hit" && e.punch === "cross" && e.counter) return 0.3;
  return 0;
}

/** where the referee stands (ring-local metres; +x along the pair axis, +z its perpendicular) */
export function refereeSpot(phase: FightPhase, ctx: { dist: number; down: 0 | 1 | -1; winner: 0 | 1 | null; breaking: boolean; half: number }): { x: number; z: number; clip: BoxingClipName; face: number } {
  const half = Math.min(ctx.dist / 200, ctx.half - 0.8);
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
  return { x: 0, z: 1.25, clip: "refIdle", face: 0 };
}
