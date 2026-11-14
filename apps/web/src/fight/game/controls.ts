"use client";
import { useEffect } from "react";
import type { BoxingAction } from "@gukirana/contracts";
import { fightInput } from "./actions";
import { useFightPrefs } from "./prefs";

/**
 * Keyboard / mouse / gamepad bindings of a fight (FIGHT-GAMES-PLAN §2.8). Every device sends the same presses through
 * `fightInput`: controls never change the rules. Touch lives in TouchPads.tsx.
 */
export const KEY_ACTIONS: Record<string, BoxingAction> = {
  KeyJ: "jab",
  KeyK: "cross",
  KeyL: "hook",
  KeyI: "uppercut",
  KeyA: "slipL",
  KeyD: "slipR",
  KeyW: "stepIn",
  KeyS: "stepOut",
};
/** standard gamepad mapping: 0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 6 LT, 7 RT */
export const PAD_BUTTONS: Record<number, BoxingAction> = { 2: "jab", 3: "cross", 1: "hook", 0: "uppercut" };
export const PAD_GUARD = [6, 7] as const;
const FLICK = 0.6;
const NEUTRAL = 0.3;

/** a swipe on a pad → the action (left pad: slips / steps; right pad: punches). null = a tap. */
export function swipeAction(pad: "guard" | "punch", dx: number, dy: number, min = 36): BoxingAction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < min) return null;
  if (pad === "guard") {
    if (ax >= ay) return dx < 0 ? "slipL" : "slipR";
    return dy < 0 ? "stepIn" : "stepOut";
  }
  // punches: up = uppercut, mostly right = cross, sideways-down = hook
  if (dy < 0 && ay > ax) return "uppercut";
  if (dy > min / 2 && ax > min / 2) return "hook";
  if (ax >= ay) return "cross";
  return "hook";
}

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** binds keys, mouse (on the 3D canvas / fight surface) and gamepads while `active` */
export function useFightControls(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let spaceDown = false;
    let toggled = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat || spaceDown) return;
        spaceDown = true;
        if (useFightPrefs.getState().guardToggle) {
          toggled = !toggled;
          fightInput.guard(toggled);
        } else fightInput.guard(true);
        return;
      }
      const a = KEY_ACTIONS[e.code];
      if (!a || e.repeat) return;
      e.preventDefault();
      fightInput.press(a);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDown = false;
      if (!useFightPrefs.getState().guardToggle) fightInput.guard(false);
    };
    const onSurface = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "CANVAS" || t.dataset.fightSurface === "1");
    const onMouse = (e: MouseEvent) => {
      if (!onSurface(e.target)) return;
      if (e.button === 0) fightInput.press(e.shiftKey ? "hook" : "jab");
      else if (e.button === 2) fightInput.press(e.shiftKey ? "uppercut" : "cross");
    };
    const onMenu = (e: MouseEvent) => {
      if (onSurface(e.target)) e.preventDefault();
    };
    const onBlur = () => {
      if (spaceDown && !useFightPrefs.getState().guardToggle) fightInput.guard(false);
      spaceDown = false;
    };

    // gamepad: edge-triggered buttons, guard on either trigger, stick flicks
    let raf = 0;
    const prevButtons = new Map<number, boolean[]>();
    const stickArmed = new Map<number, boolean>();
    let padGuard = false;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
      let guardNow = false;
      let anyPad = false;
      for (const p of pads) {
        if (!p) continue;
        anyPad = true;
        const prev = prevButtons.get(p.index) ?? [];
        const now = p.buttons.map((b) => b.pressed);
        for (const [i, a] of Object.entries(PAD_BUTTONS)) if (now[+i] && !prev[+i]) fightInput.press(a);
        if (PAD_GUARD.some((i) => now[i])) guardNow = true;
        prevButtons.set(p.index, now);
        const x = p.axes[0] ?? 0;
        const y = p.axes[1] ?? 0;
        const armed = stickArmed.get(p.index) ?? true;
        if (armed && Math.max(Math.abs(x), Math.abs(y)) > FLICK) {
          stickArmed.set(p.index, false);
          if (Math.abs(x) >= Math.abs(y)) fightInput.press(x < 0 ? "slipL" : "slipR");
          else fightInput.press(y < 0 ? "stepIn" : "stepOut");
        } else if (Math.max(Math.abs(x), Math.abs(y)) < NEUTRAL) stickArmed.set(p.index, true);
      }
      if (anyPad && guardNow !== padGuard) {
        padGuard = guardNow;
        fightInput.guard(guardNow);
      }
    };
    raf = requestAnimationFrame(poll);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("contextmenu", onMenu);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("contextmenu", onMenu);
      window.removeEventListener("blur", onBlur);
    };
  }, [active]);
}
