import { describe, expect, it } from "vitest";
import { TICK_HZ, type FighterView } from "@gukirana/contracts";
import { BODY_SEP, PUNCH_SPECS } from "@gukirana/boxing";
import { BOXING_CLIPS } from "@/world/human/boxing/clips";
import { canvasGapOf, clampInRing, gapOf, hitFeel, layoutOf, moodOf, presentFighter, reactionFor, refereeSpot, ringLayout, shakeFor, TARGET_FWD, warp, windOf } from "./present";
import { hitStopAt, resetRingClock, ringTimeAt } from "./ring-clock";

const f = (p: Partial<FighterView> = {}): FighterView => ({
  id: "a",
  corner: "red",
  act: "idle",
  actT: 0,
  stage: "none",
  guard: false,
  stamina: 1000,
  composure: 1000,
  points: 0,
  knockdowns: 0,
  warnings: 0,
  connected: true,
  ...p,
});
const ctx = { actSince: 0, phaseSince: 0, clinch: false, tick: 100 };

describe("engine → motion (present.ts)", () => {
  it("punch clips are time-warped so the glove lands when the engine's active window opens", () => {
    const v = f({ act: "jab", actT: 3 });
    const c = presentFighter(v, "round", ctx);
    expect(c.clip).toBe("jab");
    const wind = windOf(v);
    expect(wind).toBe(PUNCH_SPECS.jab.windup);
    // at the engine's first active tick the clip is at its impact time
    expect((wind / TICK_HZ) * c.speed).toBeCloseTo(BOXING_CLIPS.jab.impact!, 5);
    expect(windOf(f({ act: "hook", guard: true, stamina: 200 }))).toBe(PUNCH_SPECS.hook.windup + 4);
  });
  it("ceremony and phases: stool, glove touch, knee + get up, winner raised, loser's nod", () => {
    expect(presentFighter(f(), "rest", { ...ctx, actSince: 0.2 }).clip).toBe("cornerSit");
    expect(presentFighter(f(), "rest", { ...ctx, actSince: 2 }).clip).toBe("cornerRest");
    expect(presentFighter(f(), "intro", ctx).clip).toBe("touchGloves");
    expect(presentFighter(f({ act: "down" }), "knockdown", ctx).clip).toBe("knockdown");
    expect(presentFighter(f(), "knockdown", ctx).clip).toBe("guard");
    expect(presentFighter(f({ act: "rising", actT: 4 }), "round", ctx).clip).toBe("getUp");
    expect(presentFighter(f({ act: "celebrate" }), "over", { ...ctx, phaseSince: 1 }, true).clip).toBe("victory");
    expect(presentFighter(f({ act: "celebrate" }), "over", { ...ctx, phaseSince: 3 }, true).clip).toBe("winnerRaised");
    expect(presentFighter(f({ act: "dejected" }), "over", ctx, false).clip).toBe("defeat");
  });
  it("guard held = tight high guard; idle = bouncing stance; exhausted = low hands; clinch ties up", () => {
    expect(presentFighter(f({ guard: true }), "round", ctx).clip).toBe("blockHigh");
    expect(presentFighter(f(), "round", ctx).clip).toBe("guardIdle");
    expect(presentFighter(f({ stamina: 100 }), "round", ctx).clip).toBe("guard");
    expect(presentFighter(f(), "round", { ...ctx, clinch: true }).clip).toBe("clinch");
  });
  it("the same act instance keeps its key (a confirmed prediction does not restart)", () => {
    const a = presentFighter(f({ act: "cross", actT: 2 }), "round", { ...ctx, tick: 102 });
    const b = presentFighter(f({ act: "cross", actT: 5 }), "round", { ...ctx, tick: 105 });
    expect(a.key).toBe(b.key);
  });
  it("hit reactions scale with power", () => {
    const jab = reactionFor({ k: "hit", t: 2, by: 1, punch: "jab", points: 1, counter: false, combo: 1 }, 900);
    const hook = reactionFor({ k: "hit", t: 2, by: 1, punch: "hook", points: 3, counter: false, combo: 1 }, 900);
    expect(jab.intensity).toBeLessThan(hook.intensity);
    expect(jab.clip).toBe("hitHeadLight");
    expect(hook.clip).toBe("hitHeadHeavy");
    const partial = reactionFor({ k: "hit", t: 2, by: 1, punch: "uppercut", points: 1, counter: false, combo: 0 }, 900);
    expect(partial.intensity).toBeLessThan(0.5);
  });
  it("moods: wince after a hit, breathing when tired, joy / disappointment at the end", () => {
    expect(moodOf(f(), "round", 0.1, null).wince).toBeGreaterThan(0.5);
    expect(moodOf(f(), "round", 2, null).wince).toBe(0);
    expect(moodOf(f({ stamina: 100 }), "round", 2, null).jaw).toBeGreaterThan(0.4);
    expect(moodOf(f(), "over", 2, true).smile).toBe(1);
    expect(moodOf(f(), "over", 2, false).eyes).toBeGreaterThan(0);
    expect(moodOf(f({ act: "down" }), "knockdown", 2, null).eyes).toBeGreaterThan(0.4);
  });
  it("camera shake only on big moments", () => {
    expect(shakeFor({ k: "hit", t: 1, by: 0, punch: "jab", points: 1, counter: false, combo: 1 })).toBe(0);
    expect(shakeFor({ k: "hit", t: 1, by: 0, punch: "hook", points: 3, counter: false, combo: 1 })).toBeGreaterThan(0);
    expect(shakeFor({ k: "knockdown", t: 1, to: 1, points: 5 })).toBeGreaterThan(0.5);
    expect(shakeFor({ k: "block", t: 1, by: 0, punch: "hook" })).toBe(0);
  });
  it("the referee counts over the downed fighter, raises the winner, breaks clinches", () => {
    expect(refereeSpot("knockdown", { dist: 200, down: 1, winner: null, breaking: false, half: 2.45 }).clip).toBe("refCount");
    expect(refereeSpot("over", { dist: 200, down: -1, winner: 0, breaking: false, half: 2.45 }).clip).toBe("refRaise");
    expect(refereeSpot("round", { dist: 70, down: -1, winner: null, breaking: true, half: 2.45 }).clip).toBe("refBreak");
    expect(refereeSpot("round", { dist: 200, down: -1, winner: null, breaking: false, half: 2.45 }).clip).toBe("refIdle");
  });
  it("ring layout: real exchange range, circling, never past the ropes (P3-FGT-07)", () => {
    // v1 snapshots / far-ring loops (cm): the P3-FGT-07 mapping
    expect(gapOf(190)).toBeCloseTo(0.98, 2);
    expect(gapOf(130)).toBeLessThan(gapOf(190));
    expect(gapOf(30)).toBe(gapOf(70));
    expect(gapOf(1000)).toBe(gapOf(360));
    // engine v2 (mm): a jab landing at its reach fits the reach-fit clamp; bodies at the body line stay apart
    expect(canvasGapOf(PUNCH_SPECS.jab.reach)).toBeCloseTo(0.98, 2);
    expect(canvasGapOf(PUNCH_SPECS.jab.reach) - TARGET_FWD).toBeGreaterThan(0.7);
    expect(canvasGapOf(BODY_SEP)).toBeGreaterThanOrEqual(0.62);
    expect(canvasGapOf(PUNCH_SPECS.hook.reach)).toBeLessThan(canvasGapOf(PUNCH_SPECS.cross.reach));
    // v2 layout = the engine's places (a turned ring is turned)
    const snap2 = { dist: 100, orbit: 0, tick: 0, engine: 2, fighters: [{ x: -500, z: 0 }, { x: 500, z: 0 }] };
    const l2 = layoutOf(snap2, 2.45, 7, 0);
    expect(l2.cx).toBeCloseTo(0);
    expect(l2.th).toBeCloseTo(0);
    expect(l2.half * 2).toBeCloseTo(canvasGapOf(1000));
    expect(layoutOf(snap2, 2.45, 7, Math.PI / 2).th).toBeCloseTo(-Math.PI / 2);
    const a = ringLayout({ dist: 200, orbit: 0, tick: 0 }, 2.45, 7);
    const b = ringLayout({ dist: 200, orbit: 0, tick: 300 }, 2.45, 7);
    expect(a).toEqual(ringLayout({ dist: 200, orbit: 0, tick: 0 }, 2.45, 7));
    expect(a.th).not.toBeCloseTo(b.th, 2);
    for (let tick = 0; tick < 6000; tick += 97) {
      const l = ringLayout({ dist: 360, orbit: 0, tick }, 2.45, 99);
      for (const s of [-1, 1]) {
        const x = l.cx + s * l.half * Math.cos(l.th);
        const z = l.cz + s * l.half * Math.sin(l.th);
        expect(Math.hypot(x, z)).toBeLessThan(2.45 - 0.3);
      }
    }
    const c = clampInRing(3, -3, Math.PI / 2, 1.5);
    expect(Math.abs(c.x)).toBeCloseTo(1.5);
    expect(Math.abs(c.z)).toBeCloseTo(1.5);
  });
  it("hit feel: heavier punches stop longer, whiffs nothing", () => {
    const jab = hitFeel({ k: "hit", t: 1, by: 0, punch: "jab", points: 1, counter: false, combo: 1 }, true);
    const hook = hitFeel({ k: "hit", t: 1, by: 0, punch: "hook", points: 3, counter: false, combo: 1 }, true);
    expect(hook.stop).toBeGreaterThan(jab.stop);
    expect(hook.kick).toBeGreaterThan(jab.kick);
    expect(hitFeel({ k: "knockdown", t: 1, to: 1, points: 5 }, false).stop).toBeLessThanOrEqual(0.15);
  });
  it("the ring clock holds during a hit-stop and catches up after", () => {
    resetRingClock();
    ringTimeAt(10);
    hitStopAt(0.08, 10);
    expect(ringTimeAt(10.05)).toBeCloseTo(10, 5);
    const after = ringTimeAt(10.1);
    expect(after).toBeLessThan(10.1);
    let t = 10.1;
    for (let i = 0; i < 60; i++) ringTimeAt((t += 1 / 60));
    expect(ringTimeAt(t)).toBeCloseTo(t, 5);
    resetRingClock();
  });
  it("warp stays in a sane range", () => {
    expect(warp("jab", 1, true)).toBeLessThanOrEqual(3.5);
    expect(warp("getUp", 400, false)).toBeGreaterThanOrEqual(0.35);
  });
});
