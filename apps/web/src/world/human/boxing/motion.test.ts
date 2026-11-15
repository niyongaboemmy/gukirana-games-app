import { describe, expect, it } from "vitest";
import { BOXING_CLIPS, BOXING_CLIP_NAMES, PUNCHES, clipTime, clipTravel, sampleClip, type BoxingClipName } from "./clips";
import { BoxingMotion, boxingPose } from "./motion";
import { GUARD, KNEEL, MIRROR_FLIP, P, POSE_SIZE, mirrorPose, newPose } from "./pose";

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < POSE_SIZE; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

describe("boxing clip table", () => {
  it("has every clip with a sane duration and the impact inside it", () => {
    for (const n of BOXING_CLIP_NAMES) {
      const c = BOXING_CLIPS[n];
      expect(c.duration, n).toBeGreaterThan(0.2);
      if (c.impact !== null) {
        expect(c.impact, n).toBeGreaterThanOrEqual(0);
        expect(c.impact, n).toBeLessThan(c.duration);
      }
      for (const e of c.events) expect(e.t, n).toBeLessThanOrEqual(c.duration);
    }
  });

  it("punches land fast and come back: impact 0.14–0.3 s, recovery = duration − impact, an impact event", () => {
    expect(PUNCHES).toEqual(["jab", "cross", "leadHook", "rearHook", "leadUppercut", "rearUppercut", "leadBody", "rearBody"]);
    for (const n of PUNCHES) {
      const c = BOXING_CLIPS[n];
      expect(c.impact!, n).toBeGreaterThanOrEqual(0.14);
      expect(c.impact!, n).toBeLessThanOrEqual(0.3);
      expect(c.recovery, n).toBeCloseTo(c.duration - c.impact!, 6);
      expect(c.events.filter((e) => e.kind === "impact").map((e) => e.t)).toEqual([c.impact]);
      expect(c.hand && c.target && c.reach).toBeTruthy();
    }
    // the jab is the quickest punch, the rear hand punches take longer than the lead
    expect(BOXING_CLIPS.jab.impact!).toBeLessThan(BOXING_CLIPS.cross.impact!);
    expect(BOXING_CLIPS.leadHook.duration).toBeLessThan(BOXING_CLIPS.rearHook.duration);
  });

  it("the glove is at its farthest at the impact frame (straights) / highest (uppercuts)", () => {
    const wrist = (n: BoxingClipName, t: number) => {
      const p = sampleClip(n, t);
      const lead = BOXING_CLIPS[n].hand === "lead";
      return lead ? [p[P.lx]!, p[P.ly]!, p[P.lz]!] : [p[P.rx]!, p[P.ry]!, p[P.rz]!];
    };
    for (const n of ["jab", "cross", "rearBody"] as const) {
      const imp = BOXING_CLIPS[n].impact!;
      const zi = wrist(n, imp)[2]!;
      for (let t = 0; t <= BOXING_CLIPS[n].duration; t += 0.01) expect(wrist(n, t)[2]!, `${n}@${t}`).toBeLessThanOrEqual(zi + 1e-4);
    }
    for (const n of ["leadUppercut", "rearUppercut"] as const) {
      const imp = BOXING_CLIPS[n].impact!;
      const yi = wrist(n, imp)[1]!;
      for (let t = 0; t <= BOXING_CLIPS[n].duration; t += 0.01) expect(wrist(n, t)[1]!, `${n}@${t}`).toBeLessThanOrEqual(yi + 1e-4);
    }
  });

  it("one-shots start in the pose their predecessor ends in and end in their follow-up's first pose", () => {
    for (const n of BOXING_CLIP_NAMES) {
      const c = BOXING_CLIPS[n];
      if (c.loop || !c.then) continue;
      const end = sampleClip(n, c.duration);
      if (c.travel) continue; // footwork ends in the start frame; checked with travel below
      expect(maxDiff(end, sampleClip(c.then, 0)), `${n} → ${c.then}`).toBeLessThan(1e-5);
    }
    for (const n of PUNCHES) expect(maxDiff(sampleClip(n, 0), GUARD), n).toBeLessThan(1e-6);
    expect(maxDiff(sampleClip("knockdown", BOXING_CLIPS.knockdown.duration), KNEEL)).toBeLessThan(1e-6);
    expect(maxDiff(sampleClip("getUp", BOXING_CLIPS.getUp.duration), GUARD)).toBeLessThan(1e-6);
  });

  it("loops are seamless", () => {
    for (const n of BOXING_CLIP_NAMES.filter((x) => BOXING_CLIPS[x].loop)) {
      const d = BOXING_CLIPS[n].duration;
      expect(maxDiff(sampleClip(n, 0), sampleClip(n, d)), n).toBeLessThan(1e-6);
      expect(clipTime(n, d * 2.25)).toBeCloseTo(d * 0.25, 6);
    }
  });

  it("travelling clips end with the feet back in the stance once the root has moved by the travel", () => {
    const m = new BoxingMotion();
    for (const n of BOXING_CLIP_NAMES.filter((x) => BOXING_CLIPS[x].travel)) {
      m.play({ clip: n, start: 100, blend: 0 });
      const end = m.sample(100 + BOXING_CLIPS[n].duration - 1e-4);
      for (const i of [P.fLx, P.fLz, P.fRx, P.fRz]) expect(end[i]!, `${n} ch${i}`).toBeCloseTo(GUARD[i]!, 2);
      const tr = clipTravel(n, BOXING_CLIPS[n].duration);
      expect(tr).toEqual([...BOXING_CLIPS[n].travel!].map((x) => expect.closeTo(x, 6)));
    }
  });

  it("the pivot keeps the lead foot planted while the root turns", () => {
    const m = new BoxingMotion();
    m.play({ clip: "pivot", start: 0, blend: 0 });
    for (let t = 0; t <= 0.5; t += 0.05) {
      const p = m.sample(t);
      const [tx, tz, ty] = m.travel(t);
      // lead foot back in the start frame: root + Ry(yaw)·foot
      const x = p[P.fLx]!,
        z = p[P.fLz]!;
      const wx = tx + x * Math.cos(ty) + z * Math.sin(ty);
      const wz = tz - x * Math.sin(ty) + z * Math.cos(ty);
      expect(wx).toBeCloseTo(GUARD[P.fLx]!, 3);
      expect(wz).toBeCloseTo(GUARD[P.fLz]!, 3);
    }
  });
});

describe("mirroring (southpaw)", () => {
  it("flips the x channels and yaw-like angles, and is its own inverse", () => {
    const p = sampleClip("cross", 0.2);
    const m = mirrorPose(p, newPose());
    for (let i = 0; i < POSE_SIZE; i++) expect(m[i]).toBeCloseTo(MIRROR_FLIP.includes(i) ? -p[i]! : p[i]!, 6);
    expect(maxDiff(mirrorPose(m, newPose()), p)).toBeLessThan(1e-7);
    // the southpaw's lead glove is on the right (−x)
    expect(boxingPose({ clip: "guard", start: 0, mirrored: true }, 0.5)[P.lx]!).toBeLessThan(0);
    expect(boxingPose({ clip: "guard", start: 0 }, 0.5)[P.lx]!).toBeGreaterThan(0);
  });

  it("mirrors the travel of footwork", () => {
    expect(clipTravel("stepLeft", 0.4, true)[0]).toBeCloseTo(-BOXING_CLIPS.stepLeft.travel![0], 6);
    expect(clipTravel("pivot", 0.5, true)[2]).toBeCloseTo(-BOXING_CLIPS.pivot.travel![2], 6);
  });
});

describe("blend continuity (no pops)", () => {
  /** the largest per-frame change of any channel over a time span, sampled every `step` s */
  const maxStep = (play: (m: BoxingMotion) => void, t0: number, t1: number, step: number) => {
    const m = new BoxingMotion();
    play(m);
    let prev = new Float32Array(m.sample(t0));
    let worst = 0;
    for (let k = 1; t0 + k * step <= t1; k++) {
      const p = m.sample(t0 + k * step);
      worst = Math.max(worst, maxDiff(p, prev));
      prev = new Float32Array(p);
    }
    return worst;
  };
  /** continuous motion: halving the frame time halves the largest per-frame change (a pop would not shrink) */
  const continuous = (play: (m: BoxingMotion) => void, t0: number, t1: number) => {
    const a = maxStep(play, t0, t1, 1 / 240);
    const b = maxStep(play, t0, t1, 1 / 480);
    expect(b).toBeLessThan(a * 0.62);
  };

  it("a punch thrown from the idle bounce, and its hand-over back to the idle, have no jump", () => {
    continuous((m) => m.play({ clip: "jab", start: 1.37 }), 1.3, 2.2);
    continuous((m) => m.play({ clip: "rearUppercut", start: 0.21 }), 0, 1.2);
  });

  it("a hit reaction interrupting a punch blends from the pose that was showing", () => {
    const m = new BoxingMotion();
    m.play({ clip: "rearHook", start: 0 });
    const before = new Float32Array(m.sample(0.2));
    m.play({ clip: "hitHeadHeavy", start: 0.2 });
    expect(maxDiff(m.sample(0.2), before)).toBeLessThan(1e-6);
    continuous(
      (x) => {
        x.play({ clip: "rearHook", start: 0 });
        x.play({ clip: "hitHeadHeavy", start: 0.2 });
      },
      0.15,
      1.2,
    );
  });

  it("every clip is continuous from the guard and back (or into its follow-up)", () => {
    for (const n of BOXING_CLIP_NAMES) {
      const c = BOXING_CLIPS[n];
      // (walk: entered from standing with its own 0.2 s blend, P3-FGT-13)
      if (c.kind === "referee" || ["count", "cornerRest", "victoryHold", "defeatHold", "getUp", "cornerStand", "walk"].includes(n)) continue;
      continuous((m) => m.play({ clip: n, start: 0.1 }), 0, 0.1 + Math.min(4, c.duration + 0.3));
    }
  });

  it("is deterministic: the same commands give the same poses on every screen, whatever the sample rate", () => {
    const a = new BoxingMotion();
    const b = new BoxingMotion();
    for (const m of [a, b]) {
      m.play({ clip: "jab", start: 0.5 });
      m.play({ clip: "cross", start: 0.75, intensity: 0.6 });
    }
    const checks = [48, 57, 72].map((k) => k / 60);
    const got: Float32Array[] = [];
    // a samples every frame at 60 fps, b only at the check times
    for (let k = 0; k < 90; k++) {
      const p = a.sample(k / 60);
      if (checks.includes(k / 60)) got.push(new Float32Array(p));
    }
    checks.forEach((t, i) => expect(maxDiff(got[i]!, b.sample(t))).toBe(0));
  });
});

describe("motion controller", () => {
  it("hands one-shots over to their follow-up at the end time", () => {
    const m = new BoxingMotion();
    m.play({ clip: "knockdown", start: 10 });
    expect(m.current(10.5).clip).toBe("knockdown");
    expect(m.current(10 + BOXING_CLIPS.knockdown.duration + 0.01).clip).toBe("count");
    m.play({ clip: "getUp", start: 20 });
    expect(m.current(20 + BOXING_CLIPS.getUp.duration + 0.01).clip).toBe("guardIdle");
    m.play({ clip: "victory", start: 30 });
    expect(m.current(31).clip).toBe("victoryHold");
  });

  it("exposes impact times for sound / reaction sync, scaled by speed", () => {
    const m = new BoxingMotion();
    m.play({ clip: "cross", start: 5, speed: 1.25 });
    expect(m.impactTime()).toBeCloseTo(5 + 0.2 / 1.25, 6);
    const ev = m.events(5, 5.3);
    expect(ev.find((e) => e.kind === "impact")?.t).toBeCloseTo(5.16, 6);
  });

  it("reports footwork plants, the knockdown landing and the referee's count beats", () => {
    const m = new BoxingMotion();
    m.play({ clip: "stepForward", start: 0 });
    expect(m.events(0, 0.5).filter((e) => e.kind === "step")).toHaveLength(2);
    m.play({ clip: "knockdown", start: 1 });
    expect(m.events(1, 2).map((e) => e.kind)).toContain("land");
    const ref = new BoxingMotion({ base: "refIdle" });
    ref.play({ clip: "refCount", start: 0 });
    expect(ref.events(0, 8).filter((e) => e.kind === "beat")).toHaveLength(8);
  });

  it("holds a block for as long as asked", () => {
    const m = new BoxingMotion();
    m.play({ clip: "blockHigh", start: 0, hold: 1 });
    const a = new Float32Array(m.sample(0.3));
    const b = m.sample(1.0);
    expect(maxDiff(a, b)).toBeLessThan(1e-6);
    expect(m.endTime()).toBeCloseTo(1.5, 6);
  });

  it("scales a light reaction down but keeps a punch's reach", () => {
    const light = boxingPose({ clip: "hitHeadHeavy", start: 0, intensity: 0.3 }, 0.07);
    const full = boxingPose({ clip: "hitHeadHeavy", start: 0, intensity: 1 }, 0.07);
    expect(Math.abs(light[P.hp]! - GUARD[P.hp]!)).toBeLessThan(Math.abs(full[P.hp]! - GUARD[P.hp]!));
    const soft = boxingPose({ clip: "jab", start: 0, intensity: 0.2 }, 0.14);
    const hard = boxingPose({ clip: "jab", start: 0, intensity: 1 }, 0.14);
    expect(soft[P.lz]).toBeCloseTo(hard[P.lz]!, 6);
    expect(Math.abs(soft[P.yaw]! - GUARD[P.yaw]!)).toBeLessThan(Math.abs(hard[P.yaw]! - GUARD[P.yaw]!));
  });
});
