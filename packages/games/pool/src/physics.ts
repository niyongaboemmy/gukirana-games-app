/**
 * Deterministic 8-ball physics — integer fixed-point only (plan P1-POOL-01, ADR-0004).
 * Every operation is integer add/sub/mul or Math.trunc of an exact IEEE division of safe integers,
 * so Node and every browser produce bit-identical results. No Math.sin/cos/random.
 *
 * Units: positions in "milli-units" where 1 unit = 0.1 mm (so 1 m = 10 000 000 milli-units).
 * Velocities in milli-units per tick; 1 tick = 1/240 s.
 */
export const TICK_HZ = 240;
export const U = 1000; // milli-units per unit (0.1 mm)
export const TABLE_W = 25400 * U; // 2.54 m playing surface (9 ft)
export const TABLE_H = 12700 * U;
export const R = 286 * U; // 57.2 mm ball
export const CORNER_POCKET = 640 * U; // capture radius around the corner point
export const SIDE_POCKET = 560 * U;
const SIDE_OFFSET = 180 * U; // side pockets sit just outside the rail line
export const POCKETS: readonly [number, number, number][] = [
  [0, 0, CORNER_POCKET],
  [TABLE_W / 2, -SIDE_OFFSET, SIDE_POCKET],
  [TABLE_W, 0, CORNER_POCKET],
  [0, TABLE_H, CORNER_POCKET],
  [TABLE_W / 2, TABLE_H + SIDE_OFFSET, SIDE_POCKET],
  [TABLE_W, TABLE_H, CORNER_POCKET],
];
export const MAX_SPEED = 260 * U; // ≈ 6.2 m/s cue ball
const DECEL = 26; // rolling resistance ≈ 0.15 m/s²
const DRAG_DIV = 1800; // small speed-proportional loss
const STOP = 30;
const CUSHION_E = 78; // % restitution on cushions
const BALL_E = 96; // % restitution ball-ball
const MAX_TICKS = TICK_HZ * 25;
export const FRAME_EVERY = 6; // 40 recorded frames per second for client playback

export interface Ball {
  n: number; // 0 = cue
  x: number;
  y: number;
  vx: number;
  vy: number;
  in: boolean;
}

/** Integer square root (floor) — exact for safe integers. */
export function isqrt(v: number): number {
  if (v <= 0) return 0;
  let x = Math.trunc(Math.sqrt(v)); // seed, then correct to the exact floor
  while (x * x > v) x--;
  while ((x + 1) * (x + 1) <= v) x++;
  return x;
}

const div = (a: number, b: number) => Math.trunc(a / b);

export interface ShotEvents {
  firstHit: number | null;
  pocketed: number[];
  /** pocket index (into POCKETS) for each entry of `pocketed` */
  pockets: number[];
  cushionAfterContact: boolean;
}

export interface ShotResult {
  balls: Ball[];
  events: ShotEvents;
  /** frames: [tick, ...(n, x, y) for balls still on the table] in units (0.1 mm) */
  frames: number[][];
  ticks: number;
}

export function cloneBalls(b: readonly Ball[]): Ball[] {
  return b.map((x) => ({ ...x }));
}

/**
 * Strikes the cue ball along (dx, dy) with power 0–1000 and spin −100…100 (draw/follow),
 * then simulates to rest. Pure: returns new balls + events + playback frames.
 */
export function simulateShot(input: readonly Ball[], dx: number, dy: number, power: number, spin: number): ShotResult {
  const balls = cloneBalls(input);
  const cue = balls.find((b) => b.n === 0)!;
  const len = isqrt(dx * dx + dy * dy) || 1;
  const speed = div(MAX_SPEED * Math.max(0, Math.min(1000, power)), 1000);
  cue.vx = div(dx * speed, len);
  cue.vy = div(dy * speed, len);
  const dirX = div(dx * 10000, len);
  const dirY = div(dy * 10000, len);
  const ev: ShotEvents = { firstHit: null, pocketed: [], pockets: [], cushionAfterContact: false };
  const frames: number[][] = [];
  let tick = 0;
  let spinApplied = spin === 0;

  for (; tick < MAX_TICKS; tick++) {
    let moving = false;
    for (const b of balls) {
      if (b.in) continue;
      b.x += b.vx;
      b.y += b.vy;
      const s = isqrt(b.vx * b.vx + b.vy * b.vy);
      if (s > 0) {
        let ns = s - DECEL;
        ns -= div(ns, DRAG_DIV);
        if (ns < STOP) {
          b.vx = 0;
          b.vy = 0;
        } else {
          b.vx = div(b.vx * ns, s);
          b.vy = div(b.vy * ns, s);
          moving = true;
        }
      }
      // pockets first, then cushions
      for (let p = 0; p < POCKETS.length; p++) {
        const [px, py, pr] = POCKETS[p]!;
        const ddx = b.x - px;
        const ddy = b.y - py;
        if (ddx * ddx + ddy * ddy < pr * pr) {
          b.in = true;
          b.vx = 0;
          b.vy = 0;
          ev.pocketed.push(b.n);
          ev.pockets.push(p);
          break;
        }
      }
      if (b.in) continue;
      let hitCushion = false;
      if (b.x < R) {
        b.x = 2 * R - b.x;
        b.vx = div(-b.vx * CUSHION_E, 100);
        hitCushion = true;
      }
      if (b.x > TABLE_W - R) {
        b.x = 2 * (TABLE_W - R) - b.x;
        b.vx = div(-b.vx * CUSHION_E, 100);
        hitCushion = true;
      }
      if (b.y < R) {
        b.y = 2 * R - b.y;
        b.vy = div(-b.vy * CUSHION_E, 100);
        hitCushion = true;
      }
      if (b.y > TABLE_H - R) {
        b.y = 2 * (TABLE_H - R) - b.y;
        b.vy = div(-b.vy * CUSHION_E, 100);
        hitCushion = true;
      }
      if (hitCushion && ev.firstHit !== null) ev.cushionAfterContact = true;
    }
    // ball–ball collisions (equal mass, along the line of centres)
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]!;
      if (a.in) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]!;
        if (b.in) continue;
        const ddx = b.x - a.x;
        const ddy = b.y - a.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = isqrt(d2);
        const nx = div(ddx * 10000, d);
        const ny = div(ddy * 10000, d);
        const overlap = div(2 * R - d, 2);
        a.x -= div(nx * overlap, 10000);
        a.y -= div(ny * overlap, 10000);
        b.x += div(nx * overlap, 10000);
        b.y += div(ny * overlap, 10000);
        const rel = div((a.vx - b.vx) * nx + (a.vy - b.vy) * ny, 10000);
        if (rel <= 0) continue;
        const imp = div(rel * BALL_E, 100);
        a.vx -= div(imp * nx, 10000);
        a.vy -= div(imp * ny, 10000);
        b.vx += div(imp * nx, 10000);
        b.vy += div(imp * ny, 10000);
        moving = true;
        if (ev.firstHit === null && (a.n === 0 || b.n === 0)) ev.firstHit = a.n === 0 ? b.n : a.n;
        // draw / follow: after the first contact the cue ball keeps a share of its original line
        if (!spinApplied && (a.n === 0 || b.n === 0)) {
          spinApplied = true;
          const c = a.n === 0 ? a : b;
          const boost = div(speed * spin, 260);
          c.vx += div(dirX * boost, 10000);
          c.vy += div(dirY * boost, 10000);
        }
      }
    }
    if (tick % FRAME_EVERY === 0) frames.push(frameOf(tick, balls));
    if (!moving) break;
  }
  frames.push(frameOf(tick, balls));
  for (const b of balls) {
    b.vx = 0;
    b.vy = 0;
  }
  return { balls, events: ev, frames, ticks: tick };
}

function frameOf(tick: number, balls: Ball[]): number[] {
  const f = [tick];
  for (const b of balls) if (!b.in) f.push(b.n, div(b.x, U), div(b.y, U));
  return f;
}

/** Standard triangle rack: apex on the foot spot, 8 in the centre, one solid + one stripe in the back corners. */
export function rack(order: readonly number[]): Ball[] {
  const balls: Ball[] = [{ n: 0, x: div(TABLE_W, 4), y: div(TABLE_H, 2), vx: 0, vy: 0, in: false }];
  const footX = div(TABLE_W * 3, 4);
  const rowDx = div(2 * R * 866, 1000); // √3/2 · 2R
  let k = 0;
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++) {
      balls.push({ n: order[k++]!, x: footX + row * rowDx, y: div(TABLE_H, 2) + (2 * i - row) * (R + 2 * U), vx: 0, vy: 0, in: false });
    }
  return balls;
}

/** True when a ball centred at (x, y) lies on the cloth and touches no other ball on the table. */
export function isClearSpot(balls: readonly Ball[], x: number, y: number, ignore: number): boolean {
  if (x < R || x > TABLE_W - R || y < R || y > TABLE_H - R) return false;
  for (const [px, py, pr] of POCKETS) if ((x - px) ** 2 + (y - py) ** 2 < (pr + R) * (pr + R)) return false;
  return balls.every((b) => b.n === ignore || b.in || (b.x - x) ** 2 + (b.y - y) ** 2 >= 4 * R * R);
}

/** Puts the 8-ball back on the foot spot (sliding towards the foot rail while the spot is taken). */
export function respotEight(balls: Ball[]): void {
  const eight = balls.find((b) => b.n === 8);
  if (!eight) return;
  eight.in = false;
  eight.vx = 0;
  eight.vy = 0;
  const y = div(TABLE_H, 2);
  for (let x = div(TABLE_W * 3, 4); x < TABLE_W - R; x += R) {
    if (isClearSpot(balls, x, y, 8)) {
      eight.x = x;
      eight.y = y;
      return;
    }
  }
  for (let x = div(TABLE_W * 3, 4); x > R; x -= R) {
    if (isClearSpot(balls, x, y, 8)) {
      eight.x = x;
      eight.y = y;
      return;
    }
  }
}

/** Places the cue ball on the head spot, sliding along the head string until clear. */
export function respotCue(balls: Ball[]): void {
  const cue = balls.find((b) => b.n === 0)!;
  cue.in = false;
  cue.vx = 0;
  cue.vy = 0;
  cue.x = div(TABLE_W, 4);
  for (let tries = 0; tries < 40; tries++) {
    cue.y = div(TABLE_H, 2) + (tries % 2 ? 1 : -1) * div(tries + 1, 2) * 3 * R;
    const clear = balls.every((b) => b === cue || b.in || (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2 > 4 * R * R + R);
    if (clear && cue.y > R && cue.y < TABLE_H - R) return;
  }
}
