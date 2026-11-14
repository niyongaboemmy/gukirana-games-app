import { describe, expect, it } from "vitest";
import { moveConfig, MoveGuard } from "./movement.js";

/** a walk/run at `mps` metres per second, one move every `stepMs`, for `ms` */
function walk(g: MoveGuard, mps: number, ms: number, stepMs = 66, t0 = 1_000) {
  let pos = { x: 0, z: 0 };
  g.apply("p", pos, pos, t0);
  let clamped = 0;
  for (let t = stepMs; t <= ms; t += stepMs) {
    const want = { x: pos.x + (mps * 100 * stepMs) / 1000, z: pos.z };
    const r = g.apply("p", pos, want, t0 + t);
    if (r.clamped) clamped++;
    pos = { x: r.x, z: r.z };
  }
  return { pos, clamped };
}

describe("movement clamp (GAP-014)", () => {
  it("the first position after joining is taken as sent (spawn / door arrival / respawn)", () => {
    const g = new MoveGuard();
    expect(g.apply("p", { x: 0, z: 0 }, { x: 4500, z: -3000 }, 0)).toEqual({ x: 4500, z: -3000, clamped: false });
  });

  it("walking and the fastest run (3.2 m/s × 1.8) are never touched", () => {
    expect(walk(new MoveGuard(), 1.4, 10_000).clamped).toBe(0);
    expect(walk(new MoveGuard(), 5.8, 10_000).clamped).toBe(0);
    expect(walk(new MoveGuard(), 5.8, 10_000, 250).clamped).toBe(0); // a slow network: fewer, longer steps
  });

  it("a seat snap / VR teleport step (≤ 8 m) is allowed at once", () => {
    const g = new MoveGuard();
    g.apply("p", { x: 0, z: 0 }, { x: 0, z: 0 }, 0);
    expect(g.apply("p", { x: 0, z: 0 }, { x: 600, z: 300 }, 2_000).clamped).toBe(false);
  });

  it("a teleport across the plaza is clamped along its direction; it takes real time to get there", () => {
    const g = new MoveGuard();
    g.apply("p", { x: 0, z: 0 }, { x: 0, z: 0 }, 0);
    const r = g.apply("p", { x: 0, z: 0 }, { x: 5000, z: 0 }, 5_000);
    expect(r.clamped).toBe(true);
    expect(r).toMatchObject({ x: moveConfig.burstCm, z: 0 });
    // asking again right away gains nothing; a second later only speed × 1 s more
    expect(g.apply("p", r, { x: 5000, z: 0 }, 5_010).x).toBeLessThan(moveConfig.burstCm + 20);
    const later = g.apply("p", { x: moveConfig.burstCm, z: 0 }, { x: 5000, z: 0 }, 6_010);
    expect(later.x).toBeLessThanOrEqual(moveConfig.burstCm + moveConfig.speedCmS + 10);
  });

  it("a speed hack (20 m/s) is held to the maximum speed", () => {
    const { pos, clamped } = walk(new MoveGuard(), 20, 10_000);
    expect(clamped).toBeGreaterThan(0);
    expect(pos.x / 100).toBeLessThan((moveConfig.speedCmS / 100) * 10 + moveConfig.burstCm / 100 + 1);
  });

  it("forgetting a session (leave) makes the next join a fresh first fix", () => {
    const g = new MoveGuard();
    g.apply("p", { x: 0, z: 0 }, { x: 0, z: 0 }, 0);
    g.forget("p");
    expect(g.apply("p", { x: 0, z: 0 }, { x: 5000, z: 5000 }, 1).clamped).toBe(false);
  });
});
