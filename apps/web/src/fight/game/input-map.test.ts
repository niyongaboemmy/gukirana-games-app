import { describe, expect, it } from "vitest";
import { boundKey, classifyStroke, DEFAULT_KEYS, keyLabel, keyTable, mouseAction, newPadMemo, padStep, rebind, type PadSample } from "./input-map";

const pad = (pressed: number[] = [], axes: number[] = [0, 0], values: Record<number, number> = {}): PadSample => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
  axes,
});

describe("keyboard bindings", () => {
  it("defaults: J K L I punches, Space guard, WASD and arrows move", () => {
    const t = keyTable();
    expect(t.get("KeyJ")).toBe("jab");
    expect(t.get("KeyK")).toBe("cross");
    expect(t.get("KeyL")).toBe("hook");
    expect(t.get("KeyI")).toBe("uppercut");
    expect(t.get("Space")).toBe("guard");
    expect(t.get("KeyA")).toBe("slipL");
    expect(t.get("ArrowRight")).toBe("slipR");
    expect(t.get("ArrowUp")).toBe("stepIn");
    expect(t.get("KeyS")).toBe("stepOut");
  });
  it("a rebind wins over a default and a key never does two things", () => {
    let k = rebind({}, "jab", "KeyF");
    expect(keyTable(k).get("KeyF")).toBe("jab");
    expect(keyTable(k).get("KeyJ")).toBe("jab"); // the default stays as a second key while it is free
    k = rebind(k, "cross", "KeyF");
    expect(k.jab).toBeUndefined();
    expect(keyTable(k).get("KeyF")).toBe("cross");
    // binding a default key of another action takes it over
    k = rebind({}, "guard", "KeyJ");
    expect(keyTable(k).get("KeyJ")).toBe("guard");
    expect(boundKey(k, "guard")).toBe("KeyJ");
    expect(boundKey({}, "slipL")).toBe(DEFAULT_KEYS.slipL[0]);
  });
  it("reserved keys can't be bound", () => {
    expect(rebind({}, "jab", "Escape")).toEqual({});
    expect(rebind({}, "jab", "Tab")).toEqual({});
  });
  it("labels are short", () => {
    expect(keyLabel("KeyJ")).toBe("J");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("ShiftLeft")).toBe("Shift");
  });
});

describe("mouse", () => {
  it("left jab, right cross, Shift for hook / uppercut, middle hook", () => {
    expect(mouseAction(0, false)).toBe("jab");
    expect(mouseAction(2, false)).toBe("cross");
    expect(mouseAction(0, true)).toBe("hook");
    expect(mouseAction(2, true)).toBe("uppercut");
    expect(mouseAction(1, false)).toBe("hook");
    expect(mouseAction(3, false)).toBeNull();
  });
});

describe("gamepad (standard mapping)", () => {
  it("face buttons are edge-triggered: X jab, Y cross, B hook, A uppercut", () => {
    const m = newPadMemo();
    expect(padStep(m, pad([2])).presses).toEqual(["jab"]);
    expect(padStep(m, pad([2])).presses).toEqual([]); // held: no repeat
    expect(padStep(m, pad([])).presses).toEqual([]);
    expect(padStep(m, pad([3])).presses).toEqual(["cross"]);
    expect(padStep(m, pad([1])).presses).toEqual(["hook"]);
    expect(padStep(m, pad([0])).presses).toEqual(["uppercut"]);
  });
  it("guard on LT / RT (analog past the threshold) or LB", () => {
    expect(padStep(newPadMemo(), pad([], [0, 0], { 6: 0.8 })).guard).toBe(true);
    expect(padStep(newPadMemo(), pad([], [0, 0], { 7: 0.2 })).guard).toBe(false);
    expect(padStep(newPadMemo(), pad([4])).guard).toBe(true);
  });
  it("left stick flicks slip / step once, re-armed at neutral; the D-pad too", () => {
    const m = newPadMemo();
    expect(padStep(m, pad([], [-0.9, 0])).presses).toEqual(["slipL"]);
    expect(padStep(m, pad([], [-0.95, 0])).presses).toEqual([]);
    expect(padStep(m, pad([], [0, 0])).presses).toEqual([]);
    expect(padStep(m, pad([], [0, -0.9])).presses).toEqual(["stepIn"]);
    padStep(m, pad([], [0, 0]));
    expect(padStep(m, pad([], [0, 0.9])).presses).toEqual(["stepOut"]);
    expect(padStep(newPadMemo(), pad([15])).presses).toEqual(["slipR"]);
  });
});

describe("touch strokes", () => {
  it("guard zone: tap = null, swipe ← / → slip, ↑ / ↓ step", () => {
    expect(classifyStroke("guard", 4, 6, 120)).toBeNull();
    expect(classifyStroke("guard", -70, 8, 150)).toBe("slipL");
    expect(classifyStroke("guard", 70, -8, 150)).toBe("slipR");
    expect(classifyStroke("guard", 5, -70, 150)).toBe("stepIn");
    expect(classifyStroke("guard", 5, 70, 150)).toBe("stepOut");
  });
  it("a short slow drag is a tap, a short quick flick is a swipe", () => {
    expect(classifyStroke("guard", 40, 0, 400)).toBeNull();
    expect(classifyStroke("guard", 40, 0, 80)).toBe("slipR");
  });
  it("punch zone: tap jab (null), ↑ uppercut, inward hook, out cross, ↓ body hook", () => {
    expect(classifyStroke("punch", 2, 3, 90)).toBeNull();
    expect(classifyStroke("punch", 5, -80, 120)).toBe("uppercut");
    expect(classifyStroke("punch", -80, 10, 120)).toBe("hook");
    expect(classifyStroke("punch", 80, -10, 120)).toBe("cross");
    expect(classifyStroke("punch", 6, 80, 120)).toBe("hook");
  });
  it("left-handed mirrors the inward direction", () => {
    expect(classifyStroke("punch", 80, 0, 120, true)).toBe("hook");
    expect(classifyStroke("punch", -80, 0, 120, true)).toBe("cross");
  });
});
