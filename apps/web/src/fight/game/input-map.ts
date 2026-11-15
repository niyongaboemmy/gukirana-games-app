import type { BoxingAction } from "@gukirana/contracts";

/**
 * Boxing control scheme, every device (P3-FGT-05, FIGHT-GAMES-PLAN §2.8). Pure mapping only (tested); the hooks that
 * listen to the devices are controls.ts (keys / mouse / gamepad) and TouchPads.tsx (touch). Every device ends in the
 * same `fightInput.press(action)` / `fightInput.guard(held)`: controls never change the rules.
 *
 *  Desktop   J jab · K cross · L hook · I uppercut · Space (hold) guard · A / D (or ← / →) slip · W / S (or ↑ / ↓) step
 *            mouse: left = jab, right = cross, Shift + left = hook, Shift + right = uppercut, middle = hook
 *  Gamepad   X jab · Y cross · B hook · A uppercut · LT / RT / LB hold guard · left stick flick or D-pad = slip / step
 *  Phone     left thumb zone: hold = guard, swipe ← / → = slip, ↑ / ↓ = step in / out
 *            right thumb zone: tap = jab, swipe ↑ = uppercut, swipe across (inward) = hook, swipe out = cross,
 *            swipe ↓ = hook to the body; or the four big punch buttons
 * Keys are rebindable (prefs.keys); the defaults always stay as a second binding where they do not clash.
 */
export type BindAction = BoxingAction | "guard";
export const BIND_ACTIONS: readonly BindAction[] = ["jab", "cross", "hook", "uppercut", "guard", "slipL", "slipR", "stepIn", "stepOut"];

export const DEFAULT_KEYS: Record<BindAction, readonly string[]> = {
  jab: ["KeyJ"],
  cross: ["KeyK"],
  hook: ["KeyL"],
  uppercut: ["KeyI"],
  guard: ["Space"],
  slipL: ["KeyA", "ArrowLeft"],
  slipR: ["KeyD", "ArrowRight"],
  stepIn: ["KeyW", "ArrowUp"],
  stepOut: ["KeyS", "ArrowDown"],
};
/** keys a binding may never take (the browser / the HUD need them) */
export const RESERVED_KEYS = new Set(["Escape", "Tab", "Enter", "F5", "F11", "F12", "MetaLeft", "MetaRight"]);

export type KeyBinds = Partial<Record<BindAction, string>>;

/** the full key table: the player's own binding first, then the defaults that are not taken by another action */
export function keyTable(custom: KeyBinds = {}): Map<string, BindAction> {
  const m = new Map<string, BindAction>();
  for (const a of BIND_ACTIONS) {
    const c = custom[a];
    if (c && !RESERVED_KEYS.has(c)) m.set(c, a);
  }
  for (const a of BIND_ACTIONS) for (const k of DEFAULT_KEYS[a]) if (!m.has(k)) m.set(k, a);
  return m;
}

/** rebind `a` to `code`: whatever action had that code loses it (no key does two things) */
export function rebind(custom: KeyBinds, a: BindAction, code: string): KeyBinds {
  if (RESERVED_KEYS.has(code)) return custom;
  const next: KeyBinds = { ...custom, [a]: code };
  for (const b of BIND_ACTIONS) if (b !== a && next[b] === code) delete next[b];
  return next;
}

/** the key shown for an action (custom or the first default), as a short label */
export function keyLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const arrows: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  if (arrows[code]) return arrows[code]!;
  return code.replace(/Left$|Right$/, "");
}
export const boundKey = (custom: KeyBinds, a: BindAction): string => custom[a] ?? DEFAULT_KEYS[a][0]!;

/** mouse button (0 left, 1 middle, 2 right) → punch */
export function mouseAction(button: number, shift: boolean): BoxingAction | null {
  if (button === 0) return shift ? "hook" : "jab";
  if (button === 2) return shift ? "uppercut" : "cross";
  if (button === 1) return "hook";
  return null;
}

/* ------------------------------------------------------------ gamepad (standard mapping) ------------------------------------------------------------ */

/** 0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 4 LB, 5 RB, 6 LT, 7 RT, 12–15 D-pad up / down / left / right */
export const PAD_BUTTONS: Record<number, BoxingAction> = { 2: "jab", 3: "cross", 1: "hook", 0: "uppercut", 5: "jab", 12: "stepIn", 13: "stepOut", 14: "slipL", 15: "slipR" };
export const PAD_GUARD = [4, 6, 7] as const;
const FLICK = 0.6;
const NEUTRAL = 0.3;
const TRIGGER = 0.35;

export interface PadSample {
  buttons: readonly { pressed: boolean; value?: number }[];
  axes: readonly number[];
}
export interface PadMemo {
  prev: boolean[];
  armed: boolean;
}
export const newPadMemo = (): PadMemo => ({ prev: [], armed: true });

/** one poll of one pad: edge-triggered presses, the guard held state, stick flicks (re-armed at neutral) */
export function padStep(memo: PadMemo, p: PadSample): { presses: BoxingAction[]; guard: boolean } {
  const now = p.buttons.map((b, i) => b.pressed || ((i === 6 || i === 7) && (b.value ?? 0) > TRIGGER));
  const presses: BoxingAction[] = [];
  for (const [i, a] of Object.entries(PAD_BUTTONS)) if (now[+i] && !memo.prev[+i]) presses.push(a);
  const guard = PAD_GUARD.some((i) => now[i]);
  memo.prev = now;
  const x = p.axes[0] ?? 0;
  const y = p.axes[1] ?? 0;
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (memo.armed && m > FLICK) {
    memo.armed = false;
    if (Math.abs(x) >= Math.abs(y)) presses.push(x < 0 ? "slipL" : "slipR");
    else presses.push(y < 0 ? "stepIn" : "stepOut");
  } else if (m < NEUTRAL) memo.armed = true;
  return { presses, guard };
}

/* ------------------------------------------------------------ touch gestures ------------------------------------------------------------ */

/** a finished stroke on a thumb zone: null = a tap (no clear swipe) */
export function classifyStroke(zone: "guard" | "punch", dx: number, dy: number, ms: number, mirrored = false): BoxingAction | null {
  const dist = Math.hypot(dx, dy);
  // a swipe is long enough, or quick enough (a flick)
  if (dist < 26 || (dist < 56 && dist / Math.max(1, ms) < 0.25)) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (zone === "guard") {
    if (ax >= ay) return dx < 0 ? "slipL" : "slipR";
    return dy < 0 ? "stepIn" : "stepOut";
  }
  // the right thumb (mirrored for the left-handed layout): "in" = towards the screen centre
  const inward = mirrored ? dx > 0 : dx < 0;
  if (dy < 0 && ay > ax * 1.2) return "uppercut";
  if (dy > 0 && ay > ax * 1.2) return "hook"; // down: a hook to the body
  if (inward) return "hook";
  return "cross";
}

/** old name kept for callers: a swipe on a pad (null = a tap) */
export function swipeAction(pad: "guard" | "punch", dx: number, dy: number, min = 36): BoxingAction | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  return classifyStroke(pad, dx, dy, 100);
}

/** is the event target a text field (typing never fights) */
export const isTyping = (t: EventTarget | null): boolean =>
  !!t && typeof HTMLElement !== "undefined" && t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
