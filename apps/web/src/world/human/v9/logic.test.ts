import { describe, expect, it } from "vitest";
import { animStride, breath, chooseClip, hash01, hipScale, keepTrack, LOD_M, pickLod, pickPerson, type V9Person } from "./logic";

const person = (id: string, sex: "f" | "m"): V9Person => ({
  id,
  glb: `${id}.glb`,
  height: 1.7,
  sex,
  age: "31-50",
  maps: { desktop: { color: `${id}.ktx2` }, phone: { color: `${id}-1k.ktx2` } },
  credit: "",
});
const PEOPLE = [person("a", "f"), person("b", "m"), person("c", "f"), person("d", "m")];

describe("v9 people: who a seed gets", () => {
  it("hash01 is deterministic and in [0, 1)", () => {
    expect(hash01("campus:fountain-1")).toBe(hash01("campus:fountain-1"));
    for (const s of ["", "a", "campus:x", "crowd-12"]) {
      const h = hash01(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
  it("the same seed always gets the same scanned person, and seeds spread over everyone", () => {
    expect(pickPerson("campus:bus-wait", PEOPLE)).toBe(pickPerson("campus:bus-wait", PEOPLE));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickPerson(`crowd-${i}`, PEOPLE)!.id));
    expect(seen.size).toBe(4);
  });
  it("honours a sex filter, falls back when nobody matches, and returns null for an empty manifest", () => {
    for (let i = 0; i < 20; i++) expect(pickPerson(`s${i}`, PEOPLE, "m")!.sex).toBe("m");
    expect(pickPerson("x", [person("a", "f")], "m")!.id).toBe("a");
    expect(pickPerson("x", [])).toBeNull();
  });
});

describe("v9 people: level of detail", () => {
  it("picks finer meshes nearer, phones switch earlier", () => {
    expect(pickLod(2, 2, "standard")).toBe(0);
    expect(pickLod(15, 0, "standard")).toBe(1);
    expect(pickLod(40, 0, "standard")).toBe(2);
    expect(pickLod(8, 2, "lite")).toBe(1);
    expect(LOD_M.lite[0]).toBeLessThan(LOD_M.standard[0]);
  });
  it("has hysteresis: no flicker on a threshold", () => {
    const [a] = LOD_M.standard;
    expect(pickLod(a + 0.1, 0, "standard")).toBe(1); // coarser right away
    expect(pickLod(a - 0.1, 1, "standard")).toBe(1); // finer only well inside
    expect(pickLod(a * 0.8, 1, "standard")).toBe(0);
  });
  it("steps far animation less often", () => {
    expect(animStride(5)).toBe(1);
    expect(animStride(20)).toBe(2);
    expect(animStride(50)).toBe(3);
  });
});

describe("v9 people: clip choice", () => {
  const base = { anim: 0, speed: 0, talking: false, seated: false, seed: "p", t: 100 };
  it("walks with a stride matched to the ground speed", () => {
    const slow = chooseClip({ ...base, anim: 1, speed: 0.7 });
    expect(slow.clip).toBe("walkSlow");
    expect(slow.rate).toBeCloseTo(0.7 / 0.78, 3);
    const brisk = chooseClip({ ...base, anim: 1, speed: 1.4 });
    expect(brisk.clip).toBe("walk");
    expect(brisk.rate).toBeCloseTo(1.4 / 1.17, 3);
    expect(chooseClip({ ...base, anim: 2, speed: 6 }).rate).toBeLessThanOrEqual(2.2);
  });
  it("maps the actions and sitting", () => {
    expect(chooseClip({ ...base, anim: 10 }).clip).toBe("wave");
    expect(chooseClip({ ...base, anim: 20 }).clip).toBe("cheer");
    expect(chooseClip({ ...base, anim: 12 }).clip).toBe("cheer");
    expect(chooseClip({ ...base, anim: 13 }).clip).toBe("sit");
    expect(chooseClip({ ...base, seated: true, anim: 1 }).clip).toBe("sit");
  });
  it("talkers gesture, idlers cycle through seeded idles, all deterministic", () => {
    expect(["talk", "talk2"]).toContain(chooseClip({ ...base, talking: true }).clip);
    const idles = new Set<string>();
    for (let t = 0; t < 2000; t += 7) idles.add(chooseClip({ ...base, t }).clip);
    expect([...idles].sort()).toEqual(["idle", "idleWait", "lookAround"]);
    expect(chooseClip({ ...base, t: 555 })).toEqual(chooseClip({ ...base, t: 555 }));
  });
});

describe("v9 people: shared clip library", () => {
  it("takes every rotation, the root position only, never scale", () => {
    expect(keepTrack("Bip01_L_Thigh.quaternion")).toBe("rotation");
    expect(keepTrack("Bip01.quaternion")).toBe("rotation");
    expect(keepTrack("Bip01.position")).toBe("root");
    expect(keepTrack("Bip01_Spine.position")).toBeNull();
    expect(keepTrack("Bip01_Head.scale")).toBeNull();
  });
  it("scales the root by the hip-height ratio within adult proportions", () => {
    expect(hipScale(0.95, 0.9)).toBeCloseTo(0.95 / 0.9, 6);
    expect(hipScale(2, 0.9)).toBe(1.35);
    expect(hipScale(0.2, 0.9)).toBe(0.7);
    expect(hipScale(0, 0.9)).toBe(1);
  });
});

describe("v9 people: breathing", () => {
  it("is small, periodic and deeper while walking", () => {
    let max = 0;
    for (let t = 0; t < 10; t += 0.05) max = Math.max(max, Math.abs(breath(t, "p", 0).chest));
    expect(max).toBeGreaterThan(0.005);
    expect(max).toBeLessThan(0.02);
    let maxWalk = 0;
    for (let t = 0; t < 10; t += 0.05) maxWalk = Math.max(maxWalk, Math.abs(breath(t, "p", 1).chest));
    expect(maxWalk).toBeGreaterThan(max);
  });
});
