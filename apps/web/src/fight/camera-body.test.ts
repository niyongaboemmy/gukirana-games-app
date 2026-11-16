import { describe, expect, it } from "vitest";
import { bodyWorkShot } from "./camera";

type Snap = Parameters<typeof bodyWorkShot>[0];
const snap = (acts: { act: string; body?: boolean }[], phase = "round") => ({ phase, fighters: acts }) as unknown as Snap;

describe("body work camera (P3-FGT-16)", () => {
  it("wants the puncher's lead (left) side for a lead-hand body shot, and drops lower", () => {
    // pair along +x: fighter 0 at −x faces +x, his left is −z; camera side 1 stands on +z
    expect(bodyWorkShot(snap([{ act: "hook", body: true }, { act: "idle" }]), 1, 0)).toEqual({ side: -1, low: 1 });
    // fighter 1 at +x faces −x, his left is +z
    expect(bodyWorkShot(snap([{ act: "idle" }, { act: "jab", body: true }]), 1, 0)).toEqual({ side: 1, low: 1 });
    // the pair turned: the rule turns with it
    expect(bodyWorkShot(snap([{ act: "hook", body: true }, { act: "idle" }]), 0, 1)?.side).toBe(-1);
  });
  it("does nothing for head shots, rear-hand body shots or outside the round", () => {
    expect(bodyWorkShot(snap([{ act: "hook" }, { act: "idle" }]), 1, 0)).toBeNull();
    expect(bodyWorkShot(snap([{ act: "cross", body: true }, { act: "idle" }]), 1, 0)).toBeNull();
    expect(bodyWorkShot(snap([{ act: "hook", body: true }, { act: "idle" }], "rest"), 1, 0)).toBeNull();
    expect(bodyWorkShot(null, 1, 0)).toBeNull();
  });
});
