/**
 * Glicko-2 skill rating for live boxing (P3-FGT-10, docs/FIGHT-GAME-V2.md §7; Glickman, "Example of the Glicko-2
 * system", 2013). Pure functions; the API applies them on settlement only (never from client input) and stores the
 * floats. Practice, voided fights and bots never reach this code.
 *
 *  - rating r (1500 scale), deviation RD (uncertainty, starts 350 = brand new), volatility σ (how erratic results are);
 *  - one fight = one rating period (both fighters updated from their PRE-fight values, so the order never matters);
 *  - inactivity: RD grows back towards 350 with idle time (σ per idle week), so a returning player moves faster;
 *  - the conservative skill r − 2·RD sorts the leaderboard: a lucky newcomer can't top it after two wins.
 */
export interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}
export const GLICKO_DEFAULT: Glicko = { rating: 1500, rd: 350, vol: 0.06 };
/** system constant τ (Glickman: 0.3–1.2; small = volatility changes slowly). 0.5 like the paper's example. */
export const GLICKO_TAU = 0.5;
export const GLICKO_SCALE = 173.7178;
const EPS = 0.000001;
/** RD never grows past a new player's, never shrinks below this floor (keeps ratings responsive) */
export const RD_MAX = 350;
export const RD_MIN = 45;

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expect_ = (mu: number, muj: number, phij: number): number => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/** the expected score of `a` against `b` (0..1): the matchmaker's "fair fight" measure */
export function expectedScore(a: Glicko, b: Glicko): number {
  const mu = (a.rating - 1500) / GLICKO_SCALE;
  const mub = (b.rating - 1500) / GLICKO_SCALE;
  const phi = Math.sqrt(a.rd * a.rd + b.rd * b.rd) / GLICKO_SCALE;
  return expect_(mu, mub, phi);
}

/**
 * One rating period for player `p` against the given opponents and scores (1 win, 0.5 draw, 0 loss).
 * With no games, only the RD grows (step 6 of the paper).
 */
export function glickoUpdate(p: Glicko, games: readonly { opp: Glicko; score: number }[], tau = GLICKO_TAU): Glicko {
  const mu = (p.rating - 1500) / GLICKO_SCALE;
  const phi = p.rd / GLICKO_SCALE;
  const sigma = p.vol;
  if (!games.length) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: p.rating, rd: Math.min(RD_MAX, phiStar * GLICKO_SCALE), vol: sigma };
  }
  const opp = games.map((x) => ({
    mu: (x.opp.rating - 1500) / GLICKO_SCALE,
    phi: x.opp.rd / GLICKO_SCALE,
    s: x.score,
  }));
  // step 3: estimated variance v; step 4: improvement Δ
  let vInv = 0;
  let dSum = 0;
  for (const o of opp) {
    const gj = g(o.phi);
    const e = expect_(mu, o.mu, o.phi);
    vInv += gj * gj * e * (1 - e);
    dSum += gj * (o.s - e);
  }
  const v = 1 / vInv;
  const delta = v * dSum;
  // step 5: new volatility (Illinois algorithm)
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let n = 0; Math.abs(B - A) > EPS && n < 100; n++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const sigma2 = Math.exp(A / 2);
  // step 6 / 7: new RD and rating
  const phiStar = Math.sqrt(phi * phi + sigma2 * sigma2);
  const phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu2 = mu + phi2 * phi2 * dSum;
  return {
    rating: mu2 * GLICKO_SCALE + 1500,
    rd: Math.min(RD_MAX, Math.max(RD_MIN, phi2 * GLICKO_SCALE)),
    vol: sigma2,
  };
}

/** RD after `days` without a rated fight (one rating period per idle week) */
export function decayForIdle(p: Glicko, days: number): Glicko {
  const weeks = Math.max(0, Math.floor(days / 7));
  if (!weeks) return p;
  const phi = p.rd / GLICKO_SCALE;
  const phiStar = Math.sqrt(phi * phi + weeks * p.vol * p.vol);
  return { ...p, rd: Math.min(RD_MAX, phiStar * GLICKO_SCALE) };
}

/** one live boxing fight: both fighters from their pre-fight values. `scoreA`: 1 A won, 0 B won, 0.5 draw. */
export function rateFight(a: Glicko, b: Glicko, scoreA: number): [Glicko, Glicko] {
  return [glickoUpdate(a, [{ opp: b, score: scoreA }]), glickoUpdate(b, [{ opp: a, score: 1 - scoreA }])];
}

/** the leaderboard's conservative skill */
export const conservativeSkill = (p: Pick<Glicko, "rating" | "rd">): number => Math.round(p.rating - 2 * p.rd);
