import type { BoxingAction } from "@gukirana/contracts";

/**
 * Boxing control scheme v2, every device (P3-FGT-10, docs/FIGHT-GAME-V2.md §9). Pure mapping only (tested); the hooks
 * that listen to the devices are controls.ts (keys / mouse / gamepad) and TouchPads.tsx (touch). Every device ends in
 * the same three calls: `fightInput.move([lateral, forward])` (held footwork), `fightInput.guard(held)` and
 * `fightInput.press(action, via, body)`. Controls never change the rules.
 *
 *  Keyboard  W A S D (or arrows) move: A / D side-step, combined with W / S they circle in or out; the boxer always faces
 *            the opponent. Shift + A / D = pivot (quick angle step), Shift + W / S = quick step in / out.
 *            J jab · K cross · U lead hook · I rear hook · O uppercut · hold E = to the body
 *            hold L = guard · Space = slip (with A / D held: that side) or duck / roll (no side) · Q parry · F feint ·
 *            C clinch
 *  Mouse     left jab · right cross · Shift + left lead hook · Shift + right uppercut · middle rear hook
 *  Gamepad   left stick moves · X jab · Y cross · B lead hook · RB rear hook · A uppercut · LT hold guard ·
 *            RT hold = body · LB evade (slip by the stick side, else duck) · right stick flick: ← / → pivot,
 *            ↑ / ↓ quick step · D-pad ↑ parry · ↓ clinch · ← feint
 *  Phone     left thumb: a floating stick (drag = move) that holds the guard while touched; a quick flick slips (← / →)
 *            or steps (↑ / ↓). Right thumb: punch buttons, or strokes: tap jab, ↑ uppercut, across hook, out cross,
 *            ↓ rear hook to the body.
 * Keys are rebindable (prefs.keys); the defaults stay as a second binding where they do not clash.
 */
export type BindAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "jab"
  | "cross"
  | "hook"
  | "rhook"
  | "uppercut"
  | "guard"
  | "evade"
  | "body"
  | "parry"
  | "feint"
  | "clinch";
export const BIND_ACTIONS: readonly BindAction[] = ["up", "down", "left", "right", "jab", "cross", "hook", "rhook", "uppercut", "guard", "evade", "body", "parry", "feint", "clinch"];
export const MOVE_BINDS = new Set<BindAction>(["up", "down", "left", "right"]);
/** binds that are held states (not presses) */
export const HELD_BINDS = new Set<BindAction>(["up", "down", "left", "right", "guard", "body"]);

export const DEFAULT_KEYS: Record<BindAction, readonly string[]> = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jab: ["KeyJ"],
  cross: ["KeyK"],
  hook: ["KeyU"],
  rhook: ["KeyI"],
  uppercut: ["KeyO"],
  guard: ["KeyL"],
  evade: ["Space"],
  body: ["KeyE"],
  parry: ["KeyQ"],
  feint: ["KeyF"],
  clinch: ["KeyC"],
};
/** keys a binding may never take (the browser / the HUD / the pivot modifier need them) */
export const RESERVED_KEYS = new Set(["Escape", "Tab", "Enter", "F5", "F11", "F12", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"]);

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

export function keyLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const arrows: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  if (arrows[code]) return arrows[code]!;
  return code.replace(/Left$|Right$/, "");
}
export const boundKey = (custom: KeyBinds, a: BindAction): string => custom[a] ?? DEFAULT_KEYS[a][0]!;

/** held direction keys → the footwork vector [lateral (+1 right), forward (+1 towards the opponent)] */
export function moveOf(held: ReadonlySet<BindAction>): [number, number] {
  const lat = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
  const fwd = (held.has("up") ? 1 : 0) - (held.has("down") ? 1 : 0);
  return [lat, fwd];
}

/** what a key press does given the held keys and Shift: a punch / defence press (null = only a held state) */
export function pressOf(a: BindAction, held: ReadonlySet<BindAction>, shift: boolean): BoxingAction | null {
  if (MOVE_BINDS.has(a)) {
    if (!shift) return null;
    return a === "left" ? "pivotL" : a === "right" ? "pivotR" : a === "up" ? "stepIn" : "stepOut";
  }
  switch (a) {
    case "evade":
      return evadeOf(moveOf(held));
    case "jab":
    case "cross":
    case "hook":
    case "rhook":
    case "uppercut":
    case "parry":
    case "feint":
    case "clinch":
      return a;
    default:
      return null;
  }
}
/** the evade button: a slip to the side held, else a duck / roll (a step back with ↓ held) */
export const evadeOf = (mv: readonly [number, number]): BoxingAction => (mv[0] < 0 ? "slipL" : mv[0] > 0 ? "slipR" : mv[1] < 0 ? "stepOut" : "duck");

/** mouse button (0 left, 1 middle, 2 right) → punch */
export function mouseAction(button: number, shift: boolean): BoxingAction | null {
  if (button === 0) return shift ? "hook" : "jab";
  if (button === 2) return shift ? "uppercut" : "cross";
  if (button === 1) return "rhook";
  return null;
}

/* ------------------------------------------------------------ gamepad (standard mapping) ------------------------------------------------------------ */

/** 0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 4 LB, 5 RB, 6 LT, 7 RT, 12–15 D-pad up / down / left / right */
export const PAD_BUTTONS: Record<number, BoxingAction> = { 2: "jab", 3: "cross", 1: "hook", 5: "rhook", 0: "uppercut", 12: "parry", 13: "clinch", 14: "feint" };
export const PAD_GUARD = [6] as const;
export const PAD_BODY = 7;
export const PAD_EVADE = 4;
const FLICK = 0.6;
const NEUTRAL = 0.3;
const TRIGGER = 0.35;
const STICK = 0.4;

export interface PadSample {
  buttons: readonly { pressed: boolean; value?: number }[];
  axes: readonly number[];
}
export interface PadMemo {
  prev: boolean[];
  armed: boolean;
}
export const newPadMemo = (): PadMemo => ({ prev: [], armed: true });

/** one poll of one pad: footwork from the left stick, edge-triggered presses, guard / body held, right-stick flicks */
export function padStep(memo: PadMemo, p: PadSample): { presses: BoxingAction[]; guard: boolean; body: boolean; mv: [number, number] } {
  const now = p.buttons.map((b, i) => b.pressed || ((i === 6 || i === 7) && (b.value ?? 0) > TRIGGER));
  const lx = p.axes[0] ?? 0;
  const ly = p.axes[1] ?? 0;
  const mv: [number, number] = [Math.abs(lx) > STICK ? Math.sign(lx) : 0, Math.abs(ly) > STICK ? -Math.sign(ly) : 0];
  const presses: BoxingAction[] = [];
  for (const [i, a] of Object.entries(PAD_BUTTONS)) if (now[+i] && !memo.prev[+i]) presses.push(a);
  if (now[PAD_EVADE] && !memo.prev[PAD_EVADE]) presses.push(evadeOf(mv));
  const guard = PAD_GUARD.some((i) => now[i]);
  const body = !!now[PAD_BODY];
  memo.prev = now;
  const x = p.axes[2] ?? 0;
  const y = p.axes[3] ?? 0;
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (memo.armed && m > FLICK) {
    memo.armed = false;
    if (Math.abs(x) >= Math.abs(y)) presses.push(x < 0 ? "pivotL" : "pivotR");
    else presses.push(y < 0 ? "stepIn" : "stepOut");
  } else if (m < NEUTRAL) memo.armed = true;
  return { presses, guard, body, mv };
}

/* ------------------------------------------------------------ touch gestures ------------------------------------------------------------ */

/** a finished stroke on a thumb zone: null = a tap (no clear swipe) */
export function classifyStroke(zone: "guard" | "punch", dx: number, dy: number, ms: number, mirrored = false): BoxingAction | null {
  const dist = Math.hypot(dx, dy);
  if (dist < 26 || (dist < 56 && dist / Math.max(1, ms) < 0.25)) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (zone === "guard") {
    if (ax >= ay) return dx < 0 ? "slipL" : "slipR";
    return dy < 0 ? "stepIn" : "stepOut";
  }
  const inward = mirrored ? dx > 0 : dx < 0;
  if (dy < 0 && ay > ax * 1.2) return "uppercut";
  if (dy > 0 && ay > ax * 1.2) return "rhook"; // down: the rear hook, to the body (TouchPads sends it with the body flag)
  if (inward) return "hook";
  return "cross";
}
/** a stroke that goes to the body (the ↓ stroke) */
export const strokeIsBody = (dx: number, dy: number): boolean => dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2;

/** a drag on the left stick → the footwork vector (dead zone `dead` px) */
export function stickOf(dx: number, dy: number, dead = 22): [number, number] {
  const r = Math.hypot(dx, dy);
  if (r < dead) return [0, 0];
  const lat = Math.abs(dx) / r > 0.38 ? Math.sign(dx) : 0;
  const fwd = Math.abs(dy) / r > 0.38 ? -Math.sign(dy) : 0;
  return [lat, fwd];
}

/** old name kept for callers: a swipe on a pad (null = a tap) */
export function swipeAction(pad: "guard" | "punch", dx: number, dy: number, min = 36): BoxingAction | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  return classifyStroke(pad, dx, dy, 100);
}

/** is the event target a text field (typing never fights) */
export const isTyping = (t: EventTarget | null): boolean =>
  !!t && typeof HTMLElement !== "undefined" && t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
