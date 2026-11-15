import { P, type Pose } from "./pose";

/**
 * Ring life (P3-FGT-07): nobody stands still while a round is live. An additive layer over the stance clips (the
 * guard, the held guard, footwork) that turns a posed boxer into a live one:
 *  - rhythm: a bounce on the balls of the feet (hips up / down, both heels lifting), faster when fresh, flatter and
 *    slower when tired;
 *  - weight shifts front ↔ back and side to side, the upper body slipping / rolling a little (head off the line);
 *  - gloves: breathing with the bounce, the lead glove pawing / measuring, now and then a feint (a quick shoulder dip
 *    and half-jab that comes straight back), the rear glove circling by the chin; lower when tired;
 *  - shuffle: when the root glides (circling, cutting off) the feet lift alternately on the beat, so the glide reads as
 *    footwork, not sliding.
 * The referee gets a calmer version (weight shifts, small steps when moving, no bounce or gloves).
 * Deterministic: a pure function of the clock, the person's seed and the meters (same pose on every screen).
 */
export interface RingLife {
  /** per-person seed (presentation only: the ring + corner, never game randomness) */
  seed: number;
  /** 0 calm … 1 fresh and busy (from stamina, the round clock) */
  energy: number;
  /** 0 … 1 fatigue (lower gloves, slower rhythm, heavier feet) */
  tired: number;
  /** root speed across the ring right now (m/s; drives the shuffle) */
  move: number;
  /** 0 … 1 shaken (low balance / composure): a slow wobble at the knees and hips, the head rolling (P3-FGT-09) */
  daze?: number;
  /** the referee's calmer variant */
  official?: boolean;
}

const TAU = Math.PI * 2;
/** integer hash → 0..1 (deterministic, no Math.random) */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** the bounce frequency (Hz): ~2.1 fresh, ~1.4 exhausted */
export const bounceHz = (energy: number, tired: number): number => 1.55 + 0.6 * energy - 0.35 * tired;

/** a pulse 0..1..0 over the first `len` of a cycle phase u (0..1) */
const pulse = (u: number, len: number) => (u < len ? Math.sin((Math.PI * u) / len) : 0);

/**
 * Add the life to an ORTHODOX pose in place (before the southpaw mirror). `w` = how much of it this clip takes
 * (stance 1, footwork ~0.5, held guard ~0.6); `hands` = the gloves may paw / feint (0 while the guard is held).
 */
export function addRingLife(out: Pose, t: number, l: RingLife, w: number, hands: number): Pose {
  if (w <= 0.001) return out;
  const s = l.seed;
  const so = (s % 997) / 997;
  const so2 = ((s >>> 10) % 991) / 991;
  if (l.official) {
    // the referee: weight from foot to foot, a little forward lean, a step when moving
    const ws = Math.sin(TAU * (0.21 * t + so));
    out[P.hx] = out[P.hx]! + 0.03 * ws * w;
    out[P.bend] = out[P.bend]! + 0.03 * ws * w;
    out[P.hyaw] = out[P.hyaw]! + 0.12 * Math.sin(TAU * (0.13 * t + so2)) * w;
    shuffle(out, t * 1.6, l.move, w, 0.045);
    return out;
  }
  const tired = Math.min(1, Math.max(0, l.tired));
  const energy = Math.min(1, Math.max(0, l.energy));
  const amp = (0.65 + 0.35 * energy) * (1 - 0.55 * tired);
  const f = bounceHz(energy, tired);
  const ph = TAU * (f * t + so);
  // bounce: down on the beat (knees give), up on the balls of the feet in between
  const b = 0.5 - 0.5 * Math.cos(ph);
  out[P.hy] = out[P.hy]! + (0.012 - 0.03 * b) * amp * w;
  out[P.fLheel] = out[P.fLheel]! + 0.22 * (1 - b) * amp * w;
  out[P.fRheel] = out[P.fRheel]! + 0.2 * (1 - b) * amp * w;
  // weight shifts: front ↔ back (lean + hips), side to side; the upper body slips / rolls off the centre line
  const fb = Math.sin(TAU * (0.31 * t + so2));
  const lr = Math.sin(TAU * (0.19 * t + so * 1.7));
  const slip = Math.sin(TAU * (0.47 * t + so2 * 2.3)) * (0.6 + 0.4 * Math.sin(TAU * 0.11 * t));
  out[P.hz] = out[P.hz]! + 0.035 * fb * w;
  out[P.hx] = out[P.hx]! + 0.022 * lr * w;
  // tired: slouched (more lean, chin dropping), shoulders heaving with heavy breaths (P3-FGT-09)
  out[P.lean] = out[P.lean]! + (0.05 * fb + 0.09 * tired) * w;
  const breath = Math.sin(TAU * ((0.42 + 0.25 * tired) * t + so2));
  out[P.shrugL] = Math.min(1, Math.max(0, out[P.shrugL]! + 0.18 * tired * breath * w));
  out[P.shrugR] = Math.min(1, Math.max(0, out[P.shrugR]! + 0.18 * tired * breath * w));
  out[P.hp] = out[P.hp]! + 0.06 * tired * w;
  // shaken: the legs go soft — a slow lurch at the hips and knees, the head rolling with it
  const daze = Math.min(1, Math.max(0, l.daze ?? 0));
  if (daze > 0.001) {
    const wob = Math.sin(TAU * (0.6 * t + so)) * daze * w;
    out[P.hx] = out[P.hx]! + 0.05 * wob;
    out[P.hy] = out[P.hy]! - 0.025 * daze * w * (0.5 + 0.5 * Math.sin(TAU * 1.1 * t));
    out[P.bend] = out[P.bend]! + 0.08 * wob;
    out[P.hroll] = out[P.hroll]! - 0.12 * wob;
    out[P.ly] = out[P.ly]! - 0.05 * daze * w;
    out[P.ry] = out[P.ry]! - 0.05 * daze * w;
  }
  out[P.bend] = out[P.bend]! + 0.07 * slip * w;
  out[P.chest] = out[P.chest]! + 0.06 * Math.sin(TAU * (0.37 * t + so)) * w;
  out[P.hroll] = out[P.hroll]! + 0.06 * slip * w;
  out[P.hyaw] = out[P.hyaw]! + 0.05 * lr * w;
  out[P.hp] = out[P.hp]! + 0.03 * b * w;
  // gloves ride the bounce and breathe; lower and wider when tired
  const ride = (0.012 * Math.sin(ph) - 0.07 * tired) * w;
  out[P.ly] = out[P.ly]! + ride;
  out[P.ry] = out[P.ry]! + ride;
  out[P.rx] = out[P.rx]! + 0.012 * Math.sin(TAU * (0.8 * t + so)) * w * hands;
  out[P.rz] = out[P.rz]! + 0.015 * Math.cos(TAU * (0.8 * t + so)) * w * hands;
  // the lead glove measures: a paw most beats, a feint now and then (shoulder dip + half jab, straight back)
  if (hands > 0.001) {
    const rate = 0.75 + 0.35 * energy;
    const cyc = t * rate + so2 * 3;
    const n = Math.floor(cyc);
    const u = cyc - n;
    const r = hash01(n, s);
    if (r < 0.55) {
      const k = pulse(u, 0.32) * (0.55 + 0.45 * energy) * w * hands;
      out[P.lz] = out[P.lz]! + 0.11 * k;
      out[P.ly] = out[P.ly]! + 0.015 * k;
      out[P.lx] = out[P.lx]! - 0.015 * k;
    } else if (r < 0.55 + 0.2 * (1 - tired)) {
      const k = pulse(u, 0.22) * w * hands;
      out[P.lz] = out[P.lz]! + 0.2 * k;
      out[P.yaw] = out[P.yaw]! - 0.1 * k;
      out[P.lean] = out[P.lean]! + 0.06 * k;
      out[P.hy] = out[P.hy]! - 0.025 * k;
      out[P.shrugL] = Math.min(1, out[P.shrugL]! + 0.6 * k);
      out[P.effort] = Math.max(out[P.effort]!, 0.4 * k);
    }
  }
  shuffle(out, (ph / TAU) * 0.5, l.move, w, 0.04);
  return out;
}

/** alternate foot lifts on the beat while the root glides (cycle phase c: one lead + one rear lift per unit) */
function shuffle(out: Pose, c: number, move: number, w: number, lift: number) {
  const m = sm(Math.min(1, Math.abs(move) / 0.35));
  if (m <= 0.001) return;
  const u = c - Math.floor(c);
  out[P.fLy] = out[P.fLy]! + lift * pulse(u, 0.5) * m * w;
  out[P.fRy] = out[P.fRy]! + lift * pulse(u - 0.5 < 0 ? 1 : u - 0.5, 0.5) * m * w;
}
