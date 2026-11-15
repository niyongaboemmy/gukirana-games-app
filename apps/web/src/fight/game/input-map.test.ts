import { describe, expect, it } from "vitest";
import {
  boundKey,
  classifyStroke,
  DEFAULT_KEYS,
  evadeOf,
  keyLabel,
  keyTable,
  mouseAction,
  moveOf,
  newPadMemo,
  padStep,
  pressOf,
  rebind,
  stickOf,
  strokeIsBody,
  type BindAction,
  type PadSample,
} from "./input-map";

/** the control scheme v2 (P3-FGT-10): held footwork, punches, defences, modifiers, every device */
const pad = (pressed: number[] = [], axes: number[] = [0, 0, 0, 0], values: Record<number, number> = {}): PadSample => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
  axes,
});
const held = (...a: BindAction[]) => new Set<BindAction>(a);

describe("keyboard bindings", () => {
  it("defaults: WASD / arrows move, J K U I O punch, L guard, Space evade, E body, Q parry, F feint, C clinch", () => {
    const t = keyTable();
    expect(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp"].map((k) => t.get(k))).toEqual(["up", "left", "down", "right", "up"]);
    expect(["KeyJ", "KeyK", "KeyU", "KeyI", "KeyO"].map((k) => t.get(k))).toEqual(["jab", "cross", "hook", "rhook", "uppercut"]);
    expect(["KeyL", "Space", "KeyE", "KeyQ", "KeyF", "KeyC"].map((k) => t.get(k))).toEqual(["guard", "evade", "body", "parry", "feint", "clinch"]);
  });
  it("held keys make the footwork vector; diagonals circle in / out", () => {
    expect(moveOf(held())).toEqual([0, 0]);
    expect(moveOf(held("up"))).toEqual([0, 1]);
    expect(moveOf(held("left", "down"))).toEqual([-1, -1]);
    expect(moveOf(held("left", "right"))).toEqual([0, 0]);
  });
  it("Shift + a direction is a pivot / quick step; Space slips to the side held, else ducks", () => {
    expect(pressOf("left", held(), true)).toBe("pivotL");
    expect(pressOf("right", held(), true)).toBe("pivotR");
    expect(pressOf("up", held(), true)).toBe("stepIn");
    expect(pressOf("down", held(), true)).toBe("stepOut");
    expect(pressOf("left", held(), false)).toBeNull();
    expect(pressOf("evade", held("left"), false)).toBe("slipL");
    expect(pressOf("evade", held("right", "up"), false)).toBe("slipR");
    expect(pressOf("evade", held(), false)).toBe("duck");
    expect(evadeOf([0, -1])).toBe("stepOut");
    expect(pressOf("rhook", held(), false)).toBe("rhook");
    expect(pressOf("guard", held(), false)).toBeNull();
  });
  it("a rebind wins over a default and a key never does two things; Shift is reserved (the pivot modifier)", () => {
    let k = rebind({}, "jab", "KeyH");
    expect(keyTable(k).get("KeyH")).toBe("jab");
    expect(keyTable(k).get("KeyJ")).toBe("jab");
    k = rebind(k, "cross", "KeyH");
    expect(k.jab).toBeUndefined();
    expect(keyTable(k).get("KeyH")).toBe("cross");
    k = rebind({}, "guard", "KeyJ");
    expect(keyTable(k).get("KeyJ")).toBe("guard");
    expect(boundKey(k, "guard")).toBe("KeyJ");
    expect(boundKey({}, "left")).toBe(DEFAULT_KEYS.left[0]);
    expect(rebind({}, "jab", "Escape")).toEqual({});
    expect(rebind({}, "jab", "ShiftLeft")).toEqual({});
  });
  it("labels are short", () => {
    expect(keyLabel("KeyJ")).toBe("J");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("ShiftLeft")).toBe("Shift");
  });
});

describe("mouse", () => {
  it("left jab, right cross, Shift for lead hook / uppercut, middle rear hook", () => {
    expect(mouseAction(0, false)).toBe("jab");
    expect(mouseAction(2, false)).toBe("cross");
    expect(mouseAction(0, true)).toBe("hook");
    expect(mouseAction(2, true)).toBe("uppercut");
    expect(mouseAction(1, false)).toBe("rhook");
    expect(mouseAction(3, false)).toBeNull();
  });
});

describe("gamepad (standard mapping)", () => {
  it("face buttons are edge-triggered: X jab, Y cross, B lead hook, RB rear hook, A uppercut", () => {
    const m = newPadMemo();
    expect(padStep(m, pad([2])).presses).toEqual(["jab"]);
    expect(padStep(m, pad([2])).presses).toEqual([]);
    expect(padStep(m, pad([])).presses).toEqual([]);
    expect(padStep(m, pad([3])).presses).toEqual(["cross"]);
    expect(padStep(m, pad([1])).presses).toEqual(["hook"]);
    expect(padStep(m, pad([5])).presses).toEqual(["rhook"]);
    expect(padStep(m, pad([0])).presses).toEqual(["uppercut"]);
  });
  it("left stick walks; LT guard, RT body; LB evades by the stick side", () => {
    expect(padStep(newPadMemo(), pad([], [0.9, -0.8, 0, 0])).mv).toEqual([1, 1]);
    expect(padStep(newPadMemo(), pad([], [0.1, 0.1, 0, 0])).mv).toEqual([0, 0]);
    expect(padStep(newPadMemo(), pad([], [0, 0, 0, 0], { 6: 0.8 })).guard).toBe(true);
    expect(padStep(newPadMemo(), pad([], [0, 0, 0, 0], { 7: 0.8 })).body).toBe(true);
    expect(padStep(newPadMemo(), pad([4], [-0.9, 0, 0, 0])).presses).toEqual(["slipL"]);
    expect(padStep(newPadMemo(), pad([4])).presses).toEqual(["duck"]);
  });
  it("right stick flicks pivot / quick-step once, re-armed at neutral; the D-pad parries, clinches, feints", () => {
    const m = newPadMemo();
    expect(padStep(m, pad([], [0, 0, -0.9, 0])).presses).toEqual(["pivotL"]);
    expect(padStep(m, pad([], [0, 0, -0.95, 0])).presses).toEqual([]);
    padStep(m, pad());
    expect(padStep(m, pad([], [0, 0, 0, -0.9])).presses).toEqual(["stepIn"]);
    expect(padStep(newPadMemo(), pad([12])).presses).toEqual(["parry"]);
    expect(padStep(newPadMemo(), pad([13])).presses).toEqual(["clinch"]);
    expect(padStep(newPadMemo(), pad([14])).presses).toEqual(["feint"]);
  });
});

describe("touch", () => {
  it("left stick: a dead zone, then 8 directions", () => {
    expect(stickOf(5, 5)).toEqual([0, 0]);
    expect(stickOf(60, 0)).toEqual([1, 0]);
    expect(stickOf(0, -60)).toEqual([0, 1]);
    expect(stickOf(-50, 50)).toEqual([-1, -1]);
  });
  it("a quick flick slips / steps", () => {
    expect(classifyStroke("guard", 4, 6, 120)).toBeNull();
    expect(classifyStroke("guard", -70, 8, 150)).toBe("slipL");
    expect(classifyStroke("guard", 5, 70, 150)).toBe("stepOut");
    expect(classifyStroke("guard", 40, 0, 400)).toBeNull();
    expect(classifyStroke("guard", 40, 0, 80)).toBe("slipR");
  });
  it("punch zone: tap jab (null), ↑ uppercut, inward lead hook, out cross, ↓ rear hook to the body", () => {
    expect(classifyStroke("punch", 2, 3, 90)).toBeNull();
    expect(classifyStroke("punch", 5, -80, 120)).toBe("uppercut");
    expect(classifyStroke("punch", -80, 10, 120)).toBe("hook");
    expect(classifyStroke("punch", 80, -10, 120)).toBe("cross");
    expect(classifyStroke("punch", 6, 80, 120)).toBe("rhook");
    expect(strokeIsBody(6, 80)).toBe(true);
    expect(classifyStroke("punch", 80, 0, 120, true)).toBe("hook");
  });
});
