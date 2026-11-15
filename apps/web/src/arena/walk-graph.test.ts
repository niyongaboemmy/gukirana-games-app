import { describe, expect, it } from "vitest";
import {
  ARENA_DOOR_Z,
  BOWL_SEATS,
  CONCOURSE,
  FLOOR_R,
  GANTRY,
  LOWER,
  LOWER_AISLES,
  LOWER_BACK,
  OUTER_R,
  STAIRS,
  STAIR,
  UPPER,
  UPPER_AISLES,
  UPPER_BACK,
  VIP,
  groundAt,
  polar,
  routeBetween,
  seatFront,
  walkable,
  type P,
  type WalkOpts,
} from "./bowl";

/**
 * P2-WLD-17: the arena interior as one walking graph. A 0.1 m grid over the whole hall; two neighbouring cells are
 * linked when both are walkable and the ground between them changes by no more than one step. Flood-filled from the
 * door, every walkable cell must be reached (no islands: nothing you can stand on that you cannot walk to), and the
 * walking surface never jumps by more than a stair riser (no hidden ledges or holes along any walkable line).
 */
const STEP = 0.1;
/** the highest riser in the venue: the lower bowl's last aisle steps, the VIP / upper stairs (a little float slack) */
const MAX_RISE = 0.3;

function grid(opts: WalkOpts) {
  const x0 = -OUTER_R - 3;
  const z0 = -OUTER_R - 1;
  const z1 = ARENA_DOOR_Z + 0.5;
  const nx = Math.ceil((2 * -x0) / STEP) + 1;
  const nz = Math.ceil((z1 - z0) / STEP) + 1;
  const ok = new Uint8Array(nx * nz);
  const y = new Float32Array(nx * nz);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      if (walkable(x, z, opts)) {
        ok[i * nz + j] = 1;
        y[i * nz + j] = groundAt(x, z);
      }
    }
  return { x0, z0, nx, nz, ok, y, cell: (x: number, z: number) => Math.round((x - x0) / STEP) * nz + Math.round((z - z0) / STEP) };
}

function flood(g: ReturnType<typeof grid>, from: number) {
  const seen = new Uint8Array(g.ok.length);
  const q = new Int32Array(g.ok.length);
  let h = 0;
  let t = 0;
  seen[from] = 1;
  q[t++] = from;
  while (h < t) {
    const c = q[h++]!;
    const i = Math.floor(c / g.nz);
    const j = c % g.nz;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
      const n = ii * g.nz + jj;
      if (seen[n] || !g.ok[n] || Math.abs(g.y[n]! - g.y[c]!) > MAX_RISE) continue;
      seen[n] = 1;
      q[t++] = n;
    }
  }
  return seen;
}

describe("arena walking graph (P2-WLD-17)", () => {
  const door = { x: 0, z: ARENA_DOOR_Z - 1.5 };

  for (const [label, opts] of [
    ["spectator", {}],
    ["participant (floor + tunnel)", { floor: true }],
  ] as [string, WalkOpts][]) {
    it(`${label}: every walkable spot is reachable from the door, without climbing more than a step`, () => {
      const g = grid(opts);
      const seen = flood(g, g.cell(door.x, door.z));
      const islands: string[] = [];
      for (let c = 0; c < g.ok.length; c++)
        if (g.ok[c] && !seen[c]) {
          const x = g.x0 + Math.floor(c / g.nz) * STEP;
          const z = g.z0 + (c % g.nz) * STEP;
          if (islands.length < 12) islands.push(`(${x.toFixed(1)}, ${z.toFixed(1)}) y ${g.y[c]!.toFixed(2)}`);
          else break;
        }
      expect(islands, "walkable but unreachable").toEqual([]);
    });
  }

  it("every seat's front, every aisle and every stair top is in the door's walking graph", () => {
    const g = grid({});
    const seen = flood(g, g.cell(door.x, door.z));
    const reach = (x: number, z: number) => {
      // the nearest walkable grid cell (the grid is 0.1 m: a spot may fall between cells)
      for (const [dx, dz] of [
        [0, 0],
        [STEP, 0],
        [-STEP, 0],
        [0, STEP],
        [0, -STEP],
      ] as [number, number][])
        if (seen[g.cell(x + dx, z + dz)]) return true;
      return false;
    };
    for (const s of BOWL_SEATS) {
      const f = seatFront(s);
      expect(reach(f.x, f.z), `${s.id} front`).toBe(true);
    }
    for (const a of LOWER_AISLES) for (const r of [LOWER.front + 0.3, (LOWER.front + LOWER_BACK) / 2, LOWER_BACK - 0.2]) expect(reach(polar(r, a).x, polar(r, a).z), `lower aisle ${a} @ ${r}`).toBe(true);
    for (const a of UPPER_AISLES) for (const r of [UPPER.r0 + 0.3, UPPER_BACK - 0.3]) expect(reach(polar(r, a).x, polar(r, a).z), `upper aisle ${a} @ ${r}`).toBe(true);
    for (const f of STAIRS) {
      const top = polar(f.r1 + (f.top === VIP.floorY ? 0.3 : 0.2), f.a);
      expect(reach(top.x, top.z), `stair ${f.a} top`).toBe(true);
    }
    const gantry = polar(GANTRY.r0 + 1.4, 175);
    expect(reach(gantry.x, gantry.z), "media gantry").toBe(true);
  });

  it("stairs rise in equal steps no higher than a riser, landing flush on the level they serve", () => {
    for (const f of STAIRS) {
      let prev = 0;
      const rise = f.top / f.steps;
      expect(rise, `stair ${f.a}`).toBeLessThanOrEqual(0.2);
      for (let r = STAIR.r0 - 0.2; r < f.r1 - 0.01; r += 0.02) {
        const p = polar(r, f.a);
        const y = groundAt(p.x, p.z);
        expect(y - prev, `stair ${f.a} @ ${r.toFixed(2)}`).toBeLessThanOrEqual(rise + 1e-6);
        expect(y, `stair ${f.a} @ ${r.toFixed(2)}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
      expect(prev).toBeCloseTo(f.top, 5);
    }
    // the lower aisles: half-row steps and the climb to the concourse never exceed a riser
    for (const a of LOWER_AISLES) {
      let prev = groundAt(polar(LOWER.front + 0.02, a).x, polar(LOWER.front + 0.02, a).z);
      for (let r = LOWER.front + 0.02; r < CONCOURSE.r0 + 0.3; r += 0.02) {
        const y = groundAt(polar(r, a).x, polar(r, a).z);
        expect(y - prev, `lower aisle ${a} @ ${r.toFixed(2)}`).toBeLessThanOrEqual(0.2);
        prev = y;
      }
      expect(prev).toBe(0);
    }
    // the players' tunnel: twelve equal steps from the concourse to the floor
    let prev = 0;
    for (let z = -CONCOURSE.r0 - 0.2; z < -FLOOR_R + 0.5; z += 0.02) {
      const y = groundAt(0, z);
      expect(prev - y, `tunnel @ ${z.toFixed(2)}`).toBeLessThanOrEqual(0.3);
      prev = y;
    }
  });

  it("inside a VIP box, between the floor behind the seats and the seat fronts, the route rounds the row", () => {
    const ok = (from: P, route: P[]) => {
      let at = from;
      for (const p of route) {
        const n = Math.max(2, Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.05));
        for (let k = 0; k <= n; k++) if (!walkable(at.x + ((p.x - at.x) * k) / n, at.z + ((p.z - at.z) * k) / n)) return false;
        at = p;
      }
      return true;
    };
    for (const s of BOWL_SEATS.filter((x) => x.table.startsWith("V"))) {
      const f = seatFront(s);
      for (const back of [polar(24.2, s.a), polar(25.0, s.a + 3)]) {
        if (!walkable(back.x, back.z)) continue;
        expect(ok(back, routeBetween(back, f)), `${s.id} from behind`).toBe(true);
        expect(ok(f, routeBetween(f, back)), `${s.id} to behind`).toBe(true);
      }
    }
  });
});
