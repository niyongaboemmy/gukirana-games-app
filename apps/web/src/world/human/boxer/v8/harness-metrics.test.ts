import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { angleAt, cavityStats, flexion, footSlide, jointChecks, kneeBehind, score, summary } from "../../../../../../../qa/e2e/fighter-v8/metrics.mjs";

/** P3-FGT-19B: the fighter-v8 harness metrics (qa/e2e/fighter-v8/metrics.mjs) */
describe("fighter-v8 harness metrics", () => {
  it("measures hinge flexion", () => {
    expect(angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(flexion([0, 1, 0], [0, 0, 0], [0, -1, 0])).toBeCloseTo(0);
    expect(flexion([0, 1, 0], [0, 0, 0], [0.5, 0.9, 0])).toBeGreaterThan(150);
  });

  it("finds a knee bent backwards", () => {
    const fwd = [0, 0, 1];
    // a knee forward of the hip–ankle line: fine; behind it: hyperextended
    expect(kneeBehind([0, 1, 0], [0, 0.5, 0.05], [0, 0, 0], fwd)).toBeLessThan(0);
    expect(kneeBehind([0, 1, 0], [0, 0.5, -0.03], [0, 0, 0], fwd)).toBeCloseTo(0.03);
    // the foot pointing along the leg: the bend direction is undetermined (not checked)
    expect(kneeBehind([0, 0.9, 0], [0, 0.45, -0.38], [0, 0.1, -0.75], [0, -0.8, -0.75])).toBeNaN();
    // up on the ball of the foot (toe bone straight below the ankle): judged across the leg, the knee is forward
    expect(kneeBehind([-0.308, 1.55, -0.267], [-0.396, 1.175, -0.245], [-0.669, 0.944, -0.488], [-0.005, -0.062, -0.004])).toBeLessThan(0);
  });

  it("counts joint-limit violations on a skeleton", () => {
    const ok = jointChecks({
      "L.shoulder": [0, 1.4, 0],
      "L.elbow": [0, 1.1, 0.05],
      "L.wrist": [0, 1.3, 0.2],
      "L.knuckle": [0, 1.38, 0.26],
      "L.hip": [0.1, 0.9, 0],
      "L.knee": [0.1, 0.5, 0.06],
      "L.ankle": [0.1, 0.08, 0],
      "L.toe": [0.1, 0.02, 0.15],
      chest: [0, 1.3, 0],
      neck: [0, 1.5, 0],
      head: [0, 1.6, 0.03],
      pelvisFwd: [0, 0, 1],
      chestFwd: [0.5, 0, 1],
    });
    expect(ok.violations).toBe(0);
    expect(ok.checks.map((c) => c.joint)).toEqual(expect.arrayContaining(["L.elbowFlex", "L.kneeBehind", "neckBend", "spineTwist"]));
    const bad = jointChecks({ "R.hip": [0, 1, 0], "R.knee": [0, 0.5, -0.05], "R.ankle": [0, 0, 0], "R.toe": [0, 0, 0.15], chest: [0, 1.3, 0], neck: [0, 1.5, 0], head: [0, 1.5, 0.12] });
    expect(bad.violations).toBe(2);
  });

  it("measures foot sliding only while the foot is planted", () => {
    const frames = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      // L planted, sliding 3 cm over the second; R lifted and swinging (not a slide)
      frames.push({ t, L: [0.03 * t, 0, 0], R: [0.5 * t, 0.1 + 0.3 * t, 0.3] });
    }
    const s = footSlide(frames);
    expect(s.maxSlideCm).toBeCloseTo(3, 1);
    expect(s.slideCmPerS).toBeCloseTo(3, 0);
    // a still foot does not slide
    expect(footSlide(frames.map((f) => ({ t: f.t, L: [0, 0, 0] }))).maxSlideCm).toBe(0);
  });

  it("reads cavity shares from an id render", () => {
    // 4 person pixels: front skin, back skin, back garment, front garment; 1 background
    const px = [0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0];
    const c = cavityStats(px);
    expect(c.personPx).toBe(4);
    expect(c.skinBackShare).toBe(0.25);
    expect(c.garmentBackShare).toBe(0.25);
  });

  it("scores metrics against the acceptance config", () => {
    const m = { tris: { m: 29000 }, cav: { worst: 0.004 }, joints: 0, kind: "v8" };
    const r = score(m, {
      items: [
        { id: "a", label: "tris", metric: "tris.m", max: 30000 },
        { id: "b", label: "cavity", metric: "cav", max: 0.002 },
        { id: "c", label: "not set yet", metric: "joints", max: null },
        { id: "d", label: "not measured", metric: "nope.x", max: 1 },
        { id: "e", label: "generation", metric: "kind", equals: "v8" },
      ],
    });
    expect(r.items.map((i) => i.status)).toEqual(["pass", "fail", "unset", "missing", "pass"]);
    expect(r.ok).toBe(false);
    expect(summary([1, 3, Number.NaN])).toEqual({ mean: 2, worst: 3, min: 1, n: 2 });
  });

  it("ships an acceptance config whose items all name a metric", () => {
    const acc = JSON.parse(readFileSync(new URL("../../../../../../../qa/e2e/fighter-v8/acceptance.json", import.meta.url), "utf8")) as { items: { id: string; metric: string }[] };
    expect(acc.items.length).toBeGreaterThan(10);
    const ids = new Set(acc.items.map((i) => i.id));
    expect(ids.size).toBe(acc.items.length);
    for (const it of acc.items) expect(it.metric).toMatch(/^[a-zA-Z0-9_.-]+$/);
  });
});
