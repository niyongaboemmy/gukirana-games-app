import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ACT } from "@gukirana/contracts";
import { actionClip, IdleDirector, seedOf } from "./life";
import { HumanAnimator } from "./animator";
import { SIT_TIMING, sitDownSeconds, standUpSeconds } from "./meta";
import { PROC_ACTIONS } from "./procedural";

describe("idle life (seeded, per person)", () => {
  it("is deterministic per person and differs between people", () => {
    const run = (id: string) => {
      const d = new IdleDirector(seedOf(id));
      const out: string[] = [];
      for (let t = 0; t < 120_000; t += 250) {
        const c = d.standing(t, { listening: false, company: false });
        if (c && out.at(-1) !== `${c.key}:${c.clip}`) out.push(`${c.key}:${c.clip}`);
      }
      return out;
    };
    expect(run("alice")).toEqual(run("alice"));
    expect(run("alice")).not.toEqual(run("bruno"));
    // a person alone fidgets several times in two minutes, with pauses in between (not constantly)
    const n = run("alice").length;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(16);
  });
  it("listening means nods and a listening pose, more often", () => {
    const d = new IdleDirector(seedOf("chantal"));
    const seen = new Set<string>();
    let picks = 0;
    let last = -1;
    for (let t = 0; t < 60_000; t += 200) {
      const c = d.standing(t, { listening: true, company: true });
      if (c && c.key !== last) {
        last = c.key;
        picks++;
        seen.add(c.clip);
      }
    }
    expect([...seen].every((c) => ["listen", "nod", "fold"].includes(c))).toBe(true);
    expect(seen.has("nod")).toBe(true);
    expect(picks).toBeGreaterThanOrEqual(5);
  });
  it("walking or talking pauses the fidgets", () => {
    const d = new IdleDirector(seedOf("dan"));
    let t = 0;
    while (!d.standing(t, { listening: false, company: false })) t += 100;
    d.pause(t);
    expect(d.standing(t + 100, { listening: false, company: false })).toBeNull();
  });
  it("seated: each person has their own way of sitting", () => {
    const kinds = new Set(["a", "b", "c", "d", "e", "f"].map((id) => new IdleDirector(seedOf(id)).seated(0).clip));
    expect(kinds.size).toBe(2);
  });
});

describe("action codes", () => {
  it("every action code maps to a clip or a procedural layer", () => {
    for (const [name, code] of Object.entries(ACT)) {
      if (code < 10 || code === ACT.sit) continue;
      expect(actionClip(code, true), name).not.toBeNull();
    }
    for (const code of [ACT.thumbsUp, ACT.point, ACT.handshake, ACT.fistBump, ACT.hug, ACT.chalk]) expect(PROC_ACTIONS[code]).toBeDefined();
    // before the life clips stream in, base clips stand in
    expect(actionClip(ACT.laugh, false)).toBe("talk");
    expect(actionClip(ACT.photo, false)).toBe("idle");
    expect(actionClip(ACT.wave, false)).toBe("wave");
  });
  it("sit-down / stand-up transitions are short (motion review: ≈ 1.2–1.5 s, not 3–5 s)", () => {
    for (const set of ["m", "f"] as const) {
      expect(sitDownSeconds(set)).toBeGreaterThan(1.0);
      expect(sitDownSeconds(set)).toBeLessThan(1.6);
      expect(standUpSeconds(set)).toBeGreaterThan(0.9);
      expect(standUpSeconds(set)).toBeLessThan(1.4);
      expect(SIT_TIMING[set].front).toBeGreaterThan(0.3);
    }
  });
});

/** A tiny two-bone rig with synthetic clips: enough to drive the animator's gait logic. */
function rig() {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = "Bip01";
  root.add(hips);
  const q = (n: string, d: number) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, [0, d], [0, 0, 0, 1, 0, 0, 0, 1]);
  const p = (d: number, z0 = 0, z1 = 0) => new THREE.VectorKeyframeTrack("Bip01.position", [0, d], [0, 0.9, z0, 0, 0.9, z1]);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const [k, d] of [
    ["idle", 10],
    ["walk", 1.2],
    ["walkfast", 1.07],
    ["run", 0.73],
    ["sprint", 0.6],
    ["talk", 8],
    ["wave", 2.8],
    ["clap", 5],
    ["dance", 10],
    ["sit", 10],
  ] as const)
    clips.set(k, new THREE.AnimationClip(k, d, [q("Bip01", d), p(d)]));
  clips.set("sitdown", new THREE.AnimationClip("sitdown", 2.9, [q("Bip01", 2.9), p(2.9, 0.46, 0)]));
  clips.set("standup", new THREE.AnimationClip("standup", 2.5, [q("Bip01", 2.5), p(2.5, 0, 0.42)]));
  return { root, hips, clips: clips as never };
}

describe("locomotion (motion review batch 1)", () => {
  const inp = (o: Partial<Parameters<HumanAnimator["update"]>[1]>) => ({ anim: 0, speed: 0, yawRate: 0, talking: false, now: 0, ...o });
  it("footsteps come from foot plants: two per gait cycle while walking", () => {
    const { root, clips } = rig();
    const a = new HumanAnimator(root, clips, "m", 7);
    let steps = 0;
    // 1.0 m/s for 6 s → stride cycle 1.2 s × 1.012 m/s ≈ 1.21 m → ~5 cycles → ~10 steps
    for (let i = 0; i < 360; i++) {
      a.update(1 / 60, inp({ anim: 1, speed: 1.0, forward: 1.0 }));
      steps += a.takeSteps().length;
    }
    expect(steps).toBeGreaterThanOrEqual(8);
    expect(steps).toBeLessThanOrEqual(12);
  });
  it("stopping: the gait fades out within ~0.4 s and adds no more steps", () => {
    const { root, clips } = rig();
    const a = new HumanAnimator(root, clips, "m", 7);
    for (let i = 0; i < 120; i++) a.update(1 / 60, inp({ anim: 1, speed: 1.3, forward: 1.3 }));
    a.takeSteps();
    let steps = 0;
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60, inp({ speed: 0 }));
      steps += a.takeSteps().length;
    }
    expect(steps).toBe(0);
    expect(a.out.moveW).toBeLessThan(0.06);
  });
  it("turning on the spot: small steps, at most 45 % gait weight, brushed footsteps", () => {
    const { root, clips } = rig();
    const a = new HumanAnimator(root, clips, "m", 7);
    const kinds = new Set<number>();
    for (let i = 0; i < 120; i++) {
      a.update(1 / 60, inp({ yawRate: 2.4 }));
      a.takeSteps().forEach((s) => kinds.add(s.kind));
    }
    expect(a.out.moveW).toBeLessThanOrEqual(0.451);
    expect(a.out.moveW).toBeGreaterThan(0.3);
    expect([...kinds]).toEqual([2]);
  });
  it("sitting down: the clip's root motion places the hips, starting where the person stands", () => {
    const { root, hips, clips } = rig();
    const a = new HumanAnimator(root, clips, "m", 7);
    a.update(1 / 60, inp({}));
    a.update(1 / 60, inp({ anim: ACT.sit, rootMotion: "clip" }));
    expect(a.out.sit).toBe("down");
    expect(hips.position.z).toBeGreaterThan(0.3); // still in front of the seat
    for (let i = 0; i < 120; i++) a.update(1 / 60, inp({ anim: ACT.sit }));
    expect(a.out.sit).toBe("sit");
  });
});
