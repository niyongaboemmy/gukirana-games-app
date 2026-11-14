import { describe, expect, it } from "vitest";
import { activityPose, edgeAhead, emptyPose, PERIOD, vary, win, type SeatedActivityKind } from "./activity";
import { handTargets } from "./seated-layer";

const KINDS: SeatedActivityKind[] = ["board", "sow", "type", "visit", "meet", "watch"];
const FIELDS = ["lean", "headDown", "hands", "type", "write", "move", "dip", "nod"] as const;

describe("seated activity schedule (P2-HAL-10)", () => {
  it("is deterministic: the same person at the same moment does the same thing on every screen", () => {
    for (const k of KINDS)
      for (const ms of [0, 1234, 98_765_432, 1_731_600_000_000]) {
        const a = activityPose(k, 4242, ms, emptyPose());
        const b = activityPose(k, 4242, ms, emptyPose());
        expect(a).toEqual(b);
      }
  });

  it("is continuous over time, also across period boundaries (no pops)", () => {
    for (const k of KINDS)
      for (const seed of [77, 0xdeadbeef]) {
        const prev = emptyPose();
        const cur = emptyPose();
        activityPose(k, seed, 0, prev);
        // 3 periods at 60 fps (plain comparisons: fast)
        let worst = 0;
        for (let ms = 1000 / 60; ms < PERIOD[k] * 3000; ms += 1000 / 60) {
          activityPose(k, seed, ms, cur);
          for (const f of FIELDS) worst = Math.max(worst, Math.abs(cur[f] - prev[f]));
          Object.assign(prev, cur);
        }
        expect(worst, `${k} seed ${seed}`).toBeLessThan(0.2);
      }
  }, 20_000);

  it("stays in natural ranges (lean ≤ 0.5 rad, weights 0…1)", () => {
    for (const k of KINDS)
      for (let ms = 0; ms < 120_000; ms += 97) {
        const p = activityPose(k, 99, ms, emptyPose());
        expect(p.lean).toBeGreaterThanOrEqual(0);
        expect(p.lean).toBeLessThanOrEqual(0.5);
        expect(p.slide).toBeLessThanOrEqual(0.08);
        expect(p.headDown).toBeLessThanOrEqual(0.45);
        expect(Math.abs(p.nod)).toBeLessThanOrEqual(0.12);
        for (const f of ["hands", "type", "write", "move", "dip"] as const) {
          expect(p[f]).toBeGreaterThanOrEqual(0);
          expect(p[f]).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(p.moveX)).toBeLessThanOrEqual(0.31);
      }
  });

  it("neighbours are not in lockstep (per-person offsets and variations)", () => {
    let differ = 0;
    for (let ms = 0; ms < 60_000; ms += 500) {
      const a = activityPose("type", 11, ms, emptyPose());
      const b = activityPose("type", 12, ms, emptyPose());
      if (Math.abs(a.type - b.type) > 0.3 || Math.abs(a.write - b.write) > 0.3) differ++;
    }
    expect(differ).toBeGreaterThan(10);
  });

  it("every activity actually happens: Ludo players move counters, Igisoro players sow, officers type and write", () => {
    const seen = (k: SeatedActivityKind, f: (typeof FIELDS)[number], seed = 5) => {
      let max = 0;
      for (let ms = 0; ms < 10 * PERIOD[k] * 1000; ms += 100) max = Math.max(max, Math.abs(activityPose(k, seed, ms, emptyPose())[f]));
      return max;
    };
    expect(seen("board", "move")).toBeGreaterThan(0.9);
    expect(seen("sow", "move")).toBeGreaterThan(0.9);
    expect(seen("sow", "dip")).toBeGreaterThan(0.9);
    expect(seen("type", "type")).toBeGreaterThan(0.9);
    expect(seen("type", "write")).toBeGreaterThan(0.9);
    expect(seen("visit", "nod")).toBeGreaterThan(0.08);
    expect(seen("watch", "type")).toBe(0);
    expect(seen("visit", "hands")).toBe(0);
  });

  it("sowing walks the hand along the row pit by pit (several dips per beat)", () => {
    const seed = 3;
    let dips = 0;
    let was = false;
    for (let ms = 0; ms < PERIOD.sow * 1000; ms += 20) {
      const p = activityPose("sow", seed, ms, emptyPose());
      const down = p.dip > 0.7;
      if (down && !was) dips++;
      was = down;
    }
    expect(dips).toBeGreaterThanOrEqual(5);
  });

  it("attending someone pauses the task and sits up", () => {
    for (let ms = 0; ms < 30_000; ms += 250) {
      const p = activityPose("type", 8, ms, emptyPose(), 1);
      expect(p.type).toBe(0);
      expect(p.write).toBe(0);
      expect(p.lean).toBe(0);
    }
  });

  it("helpers: win ramps, vary is a stable 0…1 hash", () => {
    expect(win(0, 1, 3)).toBe(0);
    expect(win(2, 1, 3)).toBe(1);
    expect(win(3.5, 1, 3)).toBe(0);
    expect(vary(1, 2)).toBe(vary(1, 2));
    expect(vary(1, 2)).not.toBe(vary(1, 3));
    for (let i = 0; i < 200; i++) {
      const v = vary(i * 7919, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("edgeAhead (distance to the table edge along the facing)", () => {
  const table = { x: 0, z: 0, w: 1.1, d: 1.1 };
  it("hits the near edge straight ahead", () => {
    // seated 1.08 m south of the centre, facing north (yaw π → forward −z)
    expect(edgeAhead(0, 1.08, Math.PI, table)).toBeCloseTo(0.53, 5);
    expect(edgeAhead(0, -1.08, 0, table)).toBeCloseTo(0.53, 5);
    expect(edgeAhead(-2, 0, Math.PI / 2, table)).toBeCloseTo(1.45, 5);
  });
  it("misses when facing away or beside it", () => {
    expect(edgeAhead(0, 1.08, 0, table)).toBe(Infinity);
    expect(edgeAhead(2, 1.08, Math.PI, table)).toBe(Infinity);
  });
  it("is 0 from inside", () => {
    expect(edgeAhead(0, 0, 1, table)).toBe(0);
  });
});

describe("hand targets", () => {
  const act = { kind: "board" as const, deskH: 0.74, reach: 0.53 };
  const pose = { type: 0, write: 0, move: 0, moveX: 0, dip: 0, t: 0 };
  it("rest on the table, just inside the edge, right hand on the right (−x)", () => {
    const R = { x: 0, y: 0, z: 0 };
    const L = { x: 0, y: 0, z: 0 };
    handTargets(act, pose, R, L);
    expect(R.x).toBeLessThan(0);
    expect(L.x).toBeGreaterThan(0);
    expect(R.y).toBeGreaterThan(act.deskH);
    expect(R.y).toBeLessThan(act.deskH + 0.08);
    expect(R.z).toBeGreaterThan(act.reach);
    expect(R.z).toBeLessThan(act.reach + 0.2);
  });
  it("reaching out over the board goes further in and dips onto it, never below the surface", () => {
    const R = { x: 0, y: 0, z: 0 };
    const L = { x: 0, y: 0, z: 0 };
    handTargets(act, { ...pose, move: 1, dip: 1, moveX: 0.1 }, R, L);
    expect(R.z).toBeGreaterThan(act.reach + 0.25);
    expect(R.y).toBeGreaterThan(act.deskH);
    expect(R.x).toBeCloseTo(0.06, 5);
  });
  it("typing keeps both hands on the keyboard (above the desk)", () => {
    const R = { x: 0, y: 0, z: 0 };
    const L = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < 3; t += 0.05) {
      handTargets({ ...act, kind: "type" }, { ...pose, type: 1, t }, R, L);
      expect(R.y).toBeGreaterThanOrEqual(act.deskH + 0.05);
      expect(R.y).toBeLessThanOrEqual(act.deskH + 0.061);
      expect(Math.abs(R.x - L.x)).toBeCloseTo(0.2, 5);
    }
  });
});
