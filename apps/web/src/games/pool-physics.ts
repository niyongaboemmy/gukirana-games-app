/**
 * Practice-only 2D pool physics (floats). The authoritative, deterministic engine is the Rust
 * fixed-point crate (crates/pool-physics, task P1-POOL-01); this one powers offline practice vs AI.
 */
export const W = 1000;
export const H = 500;
export const R = 13; // slightly larger than real scale for phone readability (DESIGN-SPEC P2)
export const POCKET_R = 27;
export const POCKETS = [
  [0, 0],
  [W / 2, -6],
  [W, 0],
  [0, H],
  [W / 2, H + 6],
  [W, H],
] as const;

export interface Ball {
  n: number; // 0 = cue
  x: number;
  y: number;
  vx: number;
  vy: number;
  in: boolean;
}

export const COLORS: Record<number, string> = {
  0: "#ffffff", 1: "#f7c600", 2: "#1e5bd8", 3: "#d7262b", 4: "#5b2a86", 5: "#f07f1a", 6: "#178a43", 7: "#7a1f22", 8: "#111111",
  9: "#f7c600", 10: "#1e5bd8", 11: "#d7262b", 12: "#5b2a86", 13: "#f07f1a", 14: "#178a43", 15: "#7a1f22",
};

export function rack(): Ball[] {
  const balls: Ball[] = [{ n: 0, x: 250, y: H / 2, vx: 0, vy: 0, in: false }];
  // fixed, legal rack order: 8 in the centre, a solid and a stripe in the back corners
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let k = 0;
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++) {
      balls.push({ n: order[k++]!, x: 720 + row * (R * 2 * 0.87), y: H / 2 + (i - row / 2) * (R * 2 + 0.5), vx: 0, vy: 0, in: false });
    }
  return balls;
}

export interface StepEvents {
  firstHit: number | null;
  pocketed: number[];
}

/** Advances the simulation by dt seconds. Mutates balls. */
export function step(balls: Ball[], dt: number, ev: StepEvents): void {
  const live = balls.filter((b) => !b.in);
  for (const b of live) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - 180 * dt) * (1 - 0.25 * dt);
      b.vx *= ns / sp;
      b.vy *= ns / sp;
      if (ns < 4) b.vx = b.vy = 0;
    }
    for (const [px, py] of POCKETS) {
      if (Math.hypot(b.x - px, b.y - py) < POCKET_R) {
        b.in = true;
        b.vx = b.vy = 0;
        ev.pocketed.push(b.n);
      }
    }
    if (b.in) continue;
    if (b.x < R) { b.x = R; b.vx = -b.vx * 0.8; }
    if (b.x > W - R) { b.x = W - R; b.vx = -b.vx * 0.8; }
    if (b.y < R) { b.y = R; b.vy = -b.vy * 0.8; }
    if (b.y > H - R) { b.y = H - R; b.vy = -b.vy * 0.8; }
  }
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.in || b.in) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d === 0 || d >= 2 * R) continue;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = 2 * R - d;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.y += (ny * overlap) / 2;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const imp = rel * 0.96;
      a.vx -= imp * nx;
      a.vy -= imp * ny;
      b.vx += imp * nx;
      b.vy += imp * ny;
      if (ev.firstHit === null && (a.n === 0 || b.n === 0)) ev.firstHit = a.n === 0 ? b.n : a.n;
    }
}

export const moving = (balls: Ball[]) => balls.some((b) => !b.in && (b.vx !== 0 || b.vy !== 0));

/** Distance from point P to segment AB. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** First ball hit along a ray from the cue ball (for the guide line). */
export function rayHit(balls: Ball[], angle: number): { ball: Ball; t: number } | null {
  const cue = balls[0]!;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: { ball: Ball; t: number } | null = null;
  for (const b of balls) {
    if (b.n === 0 || b.in) continue;
    const fx = cue.x - b.x;
    const fy = cue.y - b.y;
    const bq = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - 4 * R * R;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && (!best || t < best.t)) best = { ball: b, t };
  }
  return best;
}
