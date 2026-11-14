import { describe, expect, it } from "vitest";
import { animScale } from "../feedback";
import { DIE_HALF, LUDO_TIMING, LudoRoll, SowHand, dieUpQ, newFrame, rollJitter, sampleKeys, sowStepMs, topFaceOf, type Key } from "./clips";
import { B, POSES, POSE_LEN, ease, forward, lerpPose, makePose, poseRotations, quat, BONE_COUNT, v3, type Pose } from "./rig";

const SPEEDS = [
  { speed: "relaxed", k: 1.5 },
  { speed: "normal", k: 1 },
  { speed: "fast", k: 0.55 },
] as const;

describe("hand rig and poses", () => {
  it("lerps poses exactly at the ends and halfway", () => {
    const out = new Float32Array(POSE_LEN);
    lerpPose(out, POSES.open, POSES.fist, 0);
    expect([...out]).toEqual([...POSES.open]);
    lerpPose(out, POSES.open, POSES.fist, 1);
    expect([...out]).toEqual([...POSES.fist]);
    lerpPose(out, POSES.open, POSES.fist, 0.5);
    for (let i = 0; i < POSE_LEN; i++) expect(out[i]!).toBeCloseTo((POSES.open[i]! + POSES.fist[i]!) / 2, 6);
  });

  it("eases start at 0 and end at 1", () => {
    for (const f of Object.values(ease)) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
  });

  it("writes unit quaternions for every bone", () => {
    const r = poseRotations(POSES.fist, new Float32Array(BONE_COUNT * 4));
    for (let i = 0; i < BONE_COUNT; i++) expect(Math.hypot(r[i * 4]!, r[i * 4 + 1]!, r[i * 4 + 2]!, r[i * 4 + 3]!)).toBeCloseTo(1, 5);
  });

  it("curls the fingertips into the palm for a fist and spreads them for the open hand", () => {
    const open = forward(POSES.open);
    const fist = forward(POSES.fist);
    const palm: [number, number, number] = [0, 0.06, -0.012];
    for (let f = 0; f < 4; f++) {
      expect(v3.len(v3.sub(fist.tips[f]!, palm))).toBeLessThan(0.055);
      expect(open.tips[f]![1]).toBeGreaterThan(0.15);
      // the fist's fingertips end on the palm side
      expect(fist.tips[f]![2]).toBeLessThan(-0.005);
    }
    // the open hand's index and pinky tips are far apart (spread)
    expect(Math.abs(open.tips[0]![0] - open.tips[3]![0])).toBeGreaterThan(0.075);
  });

  it("raises the bridge thumb above the knuckles (the cue rests in the V)", () => {
    // in the hand's own frame (the wrist extension of the bridge lifts the whole hand): the thumb tip stays on the
    // back-of-hand side of the palm plane next to the index knuckle, unlike a fist's thumb wrapped under
    const local = (f: ReturnType<typeof forward>, p: [number, number, number]) => quat.rotate(quat.conj(f.rot[B.hand]!), v3.sub(p, f.pos[B.hand]!));
    const br = forward(POSES.bridge);
    const fist = forward(POSES.fist);
    expect(local(br, br.tips[4]!)[2]).toBeGreaterThan(-0.004);
    expect(local(br, br.tips[4]!)[2]).toBeGreaterThan(local(fist, fist.tips[4]!)[2] + 0.01);
  });

  it("builds poses from degrees", () => {
    const p: Pose = makePose({ fingers: [90, 0, 0], thumb: [0, 0, 0, 0] });
    expect(p[3]).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("keyframe sampling", () => {
  const keys: Key[] = [
    { t: 0, u: 0, v: 0, h: 0, pitch: 0, roll: 0, pose: "open" },
    { t: 100, u: 1, v: 2, h: 0.1, pitch: 1, roll: -1, pose: "fist", ease: "linear" },
  ];
  it("clamps before and after, interpolates inside", () => {
    const f = newFrame();
    sampleKeys(keys, -50, f);
    expect(f.u).toBe(0);
    sampleKeys(keys, 50, f);
    expect(f.u).toBeCloseTo(0.5);
    expect(f.v).toBeCloseTo(1);
    sampleKeys(keys, 500, f);
    expect(f.h).toBeCloseTo(0.1);
    expect(f.pose[3]).toBeCloseTo(POSES.fist[3]!, 6);
  });
});

describe("die orientation", () => {
  it("shows every value on top for any yaw", () => {
    for (let v = 1; v <= 6; v++) for (const yaw of [0, 0.7, 2.1, -1.3]) expect(topFaceOf(dieUpQ(v, yaw))).toBe(v);
  });
  it("is deterministic per roll (no randomness)", () => {
    expect(rollJitter(7, 1)).toBe(rollJitter(7, 1));
    expect(rollJitter(7, 1)).not.toBe(rollJitter(8, 1));
    for (let i = 0; i < 50; i++) {
      const x = rollJitter(i, 3);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("Ludo roll clip", () => {
  for (const { speed, k } of SPEEDS) {
    it(`matches the ${speed} speed setting (${k}×) and lands the server value`, () => {
      expect(animScale({ speed, skipAnim: false })).toBe(k);
      for (let value = 1; value <= 6; value++) {
        const r = new LudoRoll({ k, pickup: { u: 0.6, v: 1.08 }, prevValue: 3, dieVisibleAtStart: true });
        const f = newFrame();
        r.grab(0);
        // the hand is a fist round the die by the end of the grab time
        r.sample(LUDO_TIMING.grab * k, f);
        expect(f.visible).toBe(true);
        expect(f.die.held).toBe(true);
        expect(f.pose[3]!).toBeGreaterThan(POSES.cup[3]!);
        const tThrow = LUDO_TIMING.grab * k;
        r.throw(tThrow, value, 40 + value);
        // never longer than today's tumble: settled, hand gone, 2D die back at the end of the tumble
        expect(r.settledAt).toBeLessThanOrEqual(tThrow + LUDO_TIMING.tumble * k + 1e-6);
        expect(r.handGoneAt).toBeLessThan(r.settledAt);
        expect(r.tumbleEnd).toBeCloseTo(tThrow + LUDO_TIMING.tumble * k, 6);
        r.sample(r.settledAt, f);
        expect(f.visible).toBe(false); // the hand is out of the way when the die settles
        expect(f.die.held).toBe(false);
        expect(f.die.h).toBeCloseTo(DIE_HALF, 6);
        expect(topFaceOf(f.die.q)).toBe(value);
        r.sample(r.tumbleEnd, f);
        expect(topFaceOf(f.die.q)).toBe(value);
        expect(r.sample(r.endAt + 1, f)).toBe(false);
      }
    });
  }

  it("keeps shaking while the server value is on its way (live), then throws", () => {
    const r = new LudoRoll({ k: 1, pickup: { u: 0.6, v: 1.08 } });
    const f = newFrame();
    r.grab(0);
    const us: number[] = [];
    for (let t = 650; t < 1600; t += 40) {
      r.sample(t, f);
      us.push(f.v);
      expect(f.die.held).toBe(true);
    }
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.03);
    r.throw(1600, 5, 9);
    r.sample(r.settledAt, f);
    expect(topFaceOf(f.die.q)).toBe(5);
  });

  it("shakes two to three times inside the practice grab", () => {
    const r = new LudoRoll({ k: 1, pickup: { u: 0.6, v: 1.08 } });
    const f = newFrame();
    r.grab(0);
    let crossings = 0;
    let prev = 0;
    for (let t = 0.56 * 600; t <= 600; t += 2) {
      r.sample(t, f);
      const s = Math.sign(f.roll - 6 * (Math.PI / 180));
      if (prev !== 0 && s !== prev) crossings++;
      if (s !== 0) prev = s;
    }
    // each full shake crosses the rest roll twice
    expect(crossings / 2).toBeGreaterThanOrEqual(2);
    expect(crossings / 2).toBeLessThanOrEqual(3.2);
  });

  it("fits a compressed grab + throw inside the tumble when no grab was seen (live opponent)", () => {
    for (const { k } of SPEEDS) {
      const r = new LudoRoll({ k, pickup: { u: 0.5, v: 1.1 } });
      const f = newFrame();
      r.throw(1000, 6, 3);
      r.sample(1000 + 10, f);
      expect(f.visible).toBe(true);
      expect(r.settledAt).toBeLessThanOrEqual(1000 + LUDO_TIMING.tumble * k);
      expect(r.tumbleEnd).toBeCloseTo(1000 + LUDO_TIMING.tumble * k, 6);
      r.sample(r.settledAt, f);
      expect(topFaceOf(f.die.q)).toBe(6);
    }
  });

  it("does not allocate per frame (same frame object, same pose buffer)", () => {
    const r = new LudoRoll({ k: 1, pickup: { u: 0.6, v: 1.08 } });
    const f = newFrame();
    const pose = f.pose, q = f.die.q;
    r.grab(0);
    r.throw(600, 2, 1);
    for (let t = 0; t < r.endAt; t += 16) r.sample(t, f);
    expect(f.pose).toBe(pose);
    expect(f.die.q).toBe(q);
  });
});

describe("Igisoro sowing hand", () => {
  it("follows each pit, scoops, releases seed by seed and withdraws, scaled by the speed", () => {
    for (const { k } of SPEEDS) {
      const stepMs = 170 * k;
      const h = new SowHand(k);
      const f = newFrame();
      let t = 0;
      const run = (until: number) => {
        for (; t < until; t += 8) h.sample(t, 8, f);
      };
      h.step(t, { kind: "pickup", u: 0.2, v: 0.7, seeds: 4, stepMs });
      run(t + sowStepMs({ kind: "pickup", stepMs }));
      expect(Math.abs(f.u - 0.2)).toBeLessThan(0.02);
      expect(f.seeds).toBe(4);
      // a sow step: the release pulse peaks mid-step
      const u0 = 0.32;
      h.step(t, { kind: "sow", u: u0, v: 0.7, seeds: 3, stepMs });
      const t0 = t;
      run(t0 + stepMs * 0.55);
      expect(f.pose[19]!).toBeLessThan(POSES.hold[19]!); // thumb lifts off the seeds
      run(t0 + stepMs);
      expect(Math.abs(f.u - u0)).toBeLessThan(0.03);
      h.end(t);
      const leave = 420 * k;
      let alive = true;
      for (const end = t + leave + 16; t < end; t += 8) alive = h.sample(t, 8, f);
      expect(alive).toBe(false);
      expect(f.visible).toBe(false);
    }
  });
});
